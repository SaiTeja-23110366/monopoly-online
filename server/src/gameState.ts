import { GameState, Player, PropertyState, TradeOffer, ActiveCard } from '../../shared/types';
import { BOARD_DATA, BoardSquare } from './boardData';

const CHEST_CARDS: Omit<ActiveCard, 'deck'>[] = [
  { text: "Get Out of Jail Free! Keep this card.", action: "get_out_of_jail" },
  { text: "Bank error in your favor. Collect $200.", action: "add_money", amount: 200 },
  { text: "Doctor's fees. Pay $50.", action: "deduct_money", amount: 50 },
  { text: "Life insurance matures. Collect $100.", action: "add_money", amount: 100 },
];

const CHANCE_CARDS: Omit<ActiveCard, 'deck'>[] = [
  { text: "Bank Robbery! You got away with $500.", action: "add_money", amount: 500 },
  { text: "Hacked! You lose $300.", action: "deduct_money", amount: 300 },
  { text: "Advance to Start. Collect $1000.", action: "go_to_start" },
  { text: "Go directly to Jail. Do not pass Start.", action: "go_to_jail" },
  { text: "Go back 3 spaces.", action: "go_back_3" }
];

const RISK_CARDS: Omit<ActiveCard, 'deck'>[] = [
  { text: "Market Crash! Lose 50% of your cash.", action: "market_crash" },
  { text: "Lose a Property! The bank reclaims one of your random properties.", action: "lose_property" },
  { text: "Accidental Transfer! You mistakenly give a random property to an opponent.", action: "transfer_property" },
  { text: "Sabotage! Choose an opponent's property to destroy completely.", action: "sabotage" },
  { text: "Protect Your Place! Choose one of your properties to make it immune to Risk cards.", action: "protect" }
];

export class MonopolyGame {
  state: GameState;
  roomCode: string;

  constructor(roomCode: string) {
    this.roomCode = roomCode;
    this.state = {
      roomCode,
      state: 'lobby',
      players: [],
      turnIndex: 0,
      properties: {},
      trades: {},
      logs: ['Game created!'],
      diceValues: [1, 1],
      doublesCount: 0,
      hasRolled: false,
      awaitingBuyDecision: null,
      awaitingDebtResolution: null,
      awaitingFlightDecision: null,
      startingCash: 1500,
      activeTradeId: null,
      vacationJackpot: 0,
      activeCard: null,
      awaitingSabotage: false,
      awaitingProtection: false
    };
    
    // Initialize properties
    BOARD_DATA.forEach(sq => {
      if (sq.type === 'property' || sq.type === 'railroad' || sq.type === 'utility') {
        this.state.properties[sq.id] = {
          id: sq.id,
          ownerId: null,
          houses: 0,
          mortgaged: false
        };
      }
    });
  }

  addPlayer(id: string, socketId: string, name: string, color: string) {
    const existingPlayer = this.state.players.find(p => p.id === id);
    if (existingPlayer) {
      existingPlayer.socketId = socketId;
      this.log(`${name} reconnected to the game.`);
      return true;
    }
    if (this.state.state !== 'lobby') return false;
    this.state.players.push({
      id,
      socketId,
      name,
      color,
      money: 1500,
      position: 0,
      status: 'active',
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      flightChances: 1,
      skipNextTurn: false
    });
    this.log(`${name} joined the game.`);
    return true;
  }

  changeColor(playerId: string, newColor: string) {
    if (this.state.state !== 'lobby') return false;
    const player = this.getPlayer(playerId);
    if (player) {
      player.color = newColor;
      return true;
    }
    return false;
  }

  setStartingCash(cash: number) {
    if (this.state.state !== 'lobby') return false;
    this.state.startingCash = cash;
    return true;
  }

  startGame() {
    if (this.state.players.length < 1) return false; // Dev mode: allow 1 player
    
    // Set all players to the configured starting cash
    this.state.players.forEach(p => {
      p.money = this.state.startingCash;
    });

    this.state.state = 'playing';
    this.log('Game started!');
    return true;
  }

  log(msg: string) {
    this.state.logs.push(msg);
    if (this.state.logs.length > 50) this.state.logs.shift();
  }

  getCurrentPlayer(): Player | null {
    if (this.state.players.length === 0) return null;
    return this.state.players[this.state.turnIndex];
  }

  getPlayer(playerId: string): Player | null {
    return this.state.players.find(p => p.id === playerId) || null;
  }

  // Basic dice roll logic
  rollDice(playerId: string) {
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) return;
    if (this.state.hasRolled) return; // Prevent multiple rolls
    
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    this.state.diceValues = [d1, d2];
    
    const isDouble = d1 === d2;
    this.state.hasRolled = !isDouble; // If doubles, they get to roll again

    this.log(`${player.name} rolled a ${d1} and ${d2}.`);

    if (player.inJail) {
      if (isDouble) {
        player.inJail = false;
        player.jailTurns = 0;
        this.log(`${player.name} rolled doubles and got out of jail!`);
        this.movePlayer(player, d1 + d2);
      } else {
        player.jailTurns++;
        if (player.jailTurns >= 3) {
           player.inJail = false;
           player.jailTurns = 0;
           this.log(`${player.name} failed to roll doubles 3 times! They are released for free and can roll normally next turn.`);
        } else {
           this.log(`${player.name} did not roll doubles.`);
        }
        this.endTurn(playerId); // Turn ends
      }
      return;
    }

    if (isDouble) {
      this.state.doublesCount++;
      if (this.state.doublesCount === 3) {
        this.log(`${player.name} rolled 3 doubles! Go to jail!`);
        this.goToJail(player);
        this.endTurn(playerId);
        return;
      }
    } else {
      this.state.doublesCount = 0; // Turn will end normally after movement
    }

    this.movePlayer(player, d1 + d2);
  }

  movePlayer(player: Player, spaces: number) {
    const newPosition = (player.position + spaces) % 56;
    
    if (newPosition < player.position) {
      // Passed Start
      const isLandingOnStart = newPosition === 0;
      const passStartMoney = isLandingOnStart ? 1000 : 750;
      player.money += passStartMoney;
      player.flightChances = 1;
      
      let mineCount = 0;
      Object.values(this.state.properties).forEach(prop => {
         if (prop.ownerId === player.id && BOARD_DATA[prop.id].type === 'utility') {
             mineCount++;
         }
      });
      
      let mineBonus = 0;
      if (mineCount === 1) mineBonus = 200;
      else if (mineCount === 2) mineBonus = 500;
      else if (mineCount === 3) mineBonus = 1000;
      else if (mineCount === 4) mineBonus = 2000;

      if (mineBonus > 0) {
          player.money += mineBonus;
          this.log(`${player.name} ${isLandingOnStart ? 'landed on' : 'passed'} Start, collected $${passStartMoney}, gained a flight chance, and got a $${mineBonus} bonus from their Mines!`);
      } else {
          this.log(`${player.name} ${isLandingOnStart ? 'landed on' : 'passed'} Start, collected $${passStartMoney}, and gained a flight chance.`);
      }
    }

    player.position = newPosition;
    const sq = BOARD_DATA[newPosition];
    this.log(`${player.name} landed on ${sq.name}.`);

    const needsBuyDecision = this.handleLanding(player, sq);
    
    // Check if debt resolution or flight decision was triggered during landing
    if (this.state.awaitingDebtResolution) {
      return; // Do not end turn, waiting for player to sell
    }

    if (this.state.awaitingFlightDecision !== null) {
      return; // Do not end turn, waiting for player to decide on flight
    }

    if (this.state.activeCard !== null) {
      return; // Do not end turn, waiting for card acknowledgment
    }

    if (needsBuyDecision) {
      this.state.awaitingBuyDecision = newPosition;
    } else {
      this.endTurn(player.id);
    }
  }

  handleLanding(player: Player, sq: BoardSquare): boolean {
    if (sq.type === 'tax') {
      let taxAmount = 0;
      if (sq.name === 'Money Tax') {
        taxAmount = Math.floor(Math.max(0, player.money) * 0.10);
      } else if (sq.name === 'Property Tax') {
        let totalAssetValue = 0;
        Object.values(this.state.properties).forEach(prop => {
           if (prop.ownerId === player.id) {
              const propSq = BOARD_DATA[prop.id];
              const baseValue = propSq.price || 0;
              const houseValue = prop.houses * (propSq.houseCost || 0);
              totalAssetValue += baseValue + houseValue;
           }
        });
        taxAmount = Math.floor(totalAssetValue * 0.05);
      } else {
        taxAmount = sq.price || 0;
      }
      
      player.money -= taxAmount;
      this.state.vacationJackpot += taxAmount;
      this.log(`${player.name} paid $${taxAmount} for ${sq.name}.`);
      return this.checkDebt(player.id);
    }
    
    if (sq.type === 'corner') {
      if (sq.name === 'Go to Jail') {
        player.position = 14; // Jail index
        player.inJail = true;
        this.state.hasRolled = true; // Ends turn
        this.log(`${player.name} goes to Jail!`);
      } else if (sq.name === 'Vacation') {
        if (this.state.vacationJackpot > 0) {
          player.money += this.state.vacationJackpot;
          this.log(`${player.name} landed on Vacation and won the $${this.state.vacationJackpot} jackpot! They will skip their next turn.`);
          this.state.vacationJackpot = 0;
        } else {
          this.log(`${player.name} landed on Vacation. They will skip their next turn.`);
        }
        player.skipNextTurn = true;
      }
      return false;
    }

    if (sq.type === 'chance' || sq.type === 'chest') {
      let deckType: 'chest' | 'chance' | 'risk' = sq.type === 'chest' ? 'chest' : (sq.name === 'Risk' ? 'risk' : 'chance');
      let cardList = deckType === 'chest' ? CHEST_CARDS : (deckType === 'chance' ? CHANCE_CARDS : RISK_CARDS);
      let card = cardList[Math.floor(Math.random() * cardList.length)];
      
      this.state.activeCard = { ...card, deck: deckType };
      this.log(`${player.name} drew a ${deckType} card.`);
      return false;
    }

    // It's a property, railroad, or utility
    const propState = this.state.properties[sq.id];
    if (propState.ownerId && propState.ownerId !== player.id && !propState.mortgaged) {
      // Pay rent
      const owner = this.getPlayer(propState.ownerId);
      if (owner) {
        let rent = 0;
        if (sq.type === 'property' && sq.rent) {
          rent = sq.rent[propState.houses];
        } else if ((sq.type === 'railroad' || sq.type === 'utility') && sq.rent) {
           const ownedCount = Object.values(this.state.properties).filter(
             p => p.ownerId === owner.id && BOARD_DATA[p.id].type === sq.type
           ).length;
           rent = sq.rent[Math.max(0, ownedCount - 1)]; 
        }

        player.money -= rent;
        owner.money += rent;
        this.log(`${player.name} paid $${rent} rent to ${owner.name}.`);
      }
      
      const isInDebt = this.checkDebt(player.id);
      
      // If landed on opponent's airport, not in debt, and has flight chances -> prompt flight
      if (!isInDebt && sq.type === 'railroad' && player.flightChances > 0) {
        this.state.awaitingFlightDecision = player.position;
      }
      
      return isInDebt;
    } else if (propState.ownerId === null) {
      // Unowned property! Player can buy it.
      if (player.money >= (sq.price || 0)) {
        return true; // Wait for decision
      }
      return false; // Can't afford it, auto-pass
    } else if (propState.ownerId === player.id && sq.type === 'property') {
      // Landed on own property. Check if upgrade is possible.
      if (propState.houses < 5) {
         const sameColorProps = BOARD_DATA.filter(p => p.colorGroup === sq.colorGroup).map(p => p.id);
         const ownsAll = sameColorProps.every(id => this.state.properties[id].ownerId === player.id);
         
         // Can build houses up to 4 anytime they land. Can build hotel (5) if they own full set.
         if (propState.houses < 4 || (propState.houses === 4 && ownsAll)) {
            return true; // Wait for upgrade decision
         }
      }
      return false;
    } else if (propState.ownerId === player.id && sq.type === 'railroad' && player.flightChances > 0) {
      // Landed on own airport and has flight chances -> prompt flight
      this.state.awaitingFlightDecision = player.position;
      return false;
    }
    
    return false; // Already owned by current player or mortgaged
  }

  buyProperty(playerId: string, propertyIndex: number, housesToBuy: number = 0) {
    const player = this.getPlayer(playerId);
    if (!player || this.state.awaitingBuyDecision !== propertyIndex) return;

    const sq = BOARD_DATA[propertyIndex];
    const propState = this.state.properties[propertyIndex];

    const totalCost = (sq.price || 0) + (housesToBuy * (sq.houseCost || 0));

    if (propState.ownerId === null && player.money >= totalCost) {
      player.money -= totalCost;
      propState.ownerId = player.id;
      propState.houses = housesToBuy;
      this.log(`${player.name} bought ${sq.name}${housesToBuy > 0 ? ` with ${housesToBuy} house(s)` : ''} for $${totalCost}.`);
    }

    this.state.awaitingBuyDecision = null;
    this.endTurn(playerId);
  }

  upgradeProperty(playerId: string, propertyIndex: number, housesToBuy: number) {
    const player = this.getPlayer(playerId);
    if (!player || this.state.awaitingBuyDecision !== propertyIndex) return;

    const sq = BOARD_DATA[propertyIndex];
    const propState = this.state.properties[propertyIndex];

    if (propState.ownerId === player.id && housesToBuy > 0) {
       const cost = housesToBuy * (sq.houseCost || 0);
       if (player.money >= cost) {
          player.money -= cost;
          propState.houses += housesToBuy;
          
          if (propState.houses === 5) {
             this.log(`${player.name} upgraded ${sq.name} to a Hotel for $${cost}.`);
          } else {
             this.log(`${player.name} bought ${housesToBuy} house(s) on ${sq.name} for $${cost}.`);
          }
       }
    }

    this.state.awaitingBuyDecision = null;
    this.endTurn(playerId);
  }

  sellPropertyToBank(playerId: string, propertyIndex: number) {
    const player = this.getPlayer(playerId);
    if (!player || this.state.awaitingDebtResolution !== playerId) return;

    const sq = BOARD_DATA[propertyIndex];
    const propState = this.state.properties[propertyIndex];

    if (propState.ownerId === playerId) {
      const baseValue = sq.price || 0;
      const houseValue = propState.houses * (sq.houseCost || 0);
      const sellValue = Math.floor((baseValue + houseValue) * 0.75);

      player.money += sellValue;
      propState.ownerId = null;
      propState.houses = 0;
      propState.protected = false;

      this.log(`${player.name} sold ${sq.name} to the bank for $${sellValue}.`);

      if (player.money >= 0) {
        this.state.awaitingDebtResolution = null;
        this.log(`${player.name} has resolved their debt.`);
        this.endTurn(playerId);
      } else {
        this.checkDebt(playerId);
        if (!this.state.awaitingDebtResolution) {
          this.endTurn(playerId);
        }
      }
    }
  }

  passProperty(playerId: string) {
    const player = this.getPlayer(playerId);
    if (!player || this.state.awaitingBuyDecision === null) return;

    const sq = BOARD_DATA[this.state.awaitingBuyDecision];
    this.log(`${player.name} chose not to buy ${sq.name}.`);
    
    this.state.awaitingBuyDecision = null;
    this.endTurn(playerId);
  }

  goToJail(player: Player) {
    player.position = 14; // Assuming 14 is Jail in 56-block array (0-based)
    player.inJail = true;
    player.jailTurns = 0;
    this.state.doublesCount = 0;
  }

  payJailFine(playerId: string) {
    const player = this.getPlayer(playerId);
    if (!player || !player.inJail || this.state.players[this.state.turnIndex].id !== playerId || this.state.hasRolled) return;
    
    if (player.money >= 200) {
       player.money -= 200;
       this.state.vacationJackpot += 200;
       player.inJail = false;
       player.jailTurns = 0;
       this.log(`${player.name} paid $200 to get out of jail.`);
    }
  }

  useJailCard(playerId: string) {
    const player = this.getPlayer(playerId);
    if (!player || !player.inJail || this.state.players[this.state.turnIndex].id !== playerId || this.state.hasRolled) return;
    
    if (player.getOutOfJailCards > 0) {
       player.getOutOfJailCards--;
       player.inJail = false;
       player.jailTurns = 0;
       this.log(`${player.name} used a Get Out of Jail Free card!`);
    }
  }

  acknowledgeCard(playerId: string) {
    if (this.state.players[this.state.turnIndex].id !== playerId) return;
    const card = this.state.activeCard;
    if (!card) return;

    const player = this.getPlayer(playerId);
    if (!player) return;

    let needsTarget = false;

    if (card.action === 'get_out_of_jail') {
       player.getOutOfJailCards++;
    } else if (card.action === 'add_money') {
       player.money += card.amount || 0;
    } else if (card.action === 'deduct_money') {
       player.money -= card.amount || 0;
       this.state.vacationJackpot += card.amount || 0;
    } else if (card.action === 'go_to_start') {
       this.state.activeCard = null;
       this.movePlayer(player, (56 - player.position) % 56);
       return; // movePlayer will handle the rest
    } else if (card.action === 'go_to_jail') {
       this.goToJail(player);
       this.state.activeCard = null;
       this.endTurn(player.id);
       return;
    } else if (card.action === 'go_back_3') {
       this.state.activeCard = null;
       this.movePlayer(player, 53); // move forward 53 spaces = go back 3
       return;
    } else if (card.action === 'market_crash') {
       player.money = Math.floor(player.money / 2);
    } else if (card.action === 'lose_property') {
       const ownedProps = Object.values(this.state.properties).filter(p => p.ownerId === player.id && !p.protected);
       if (ownedProps.length > 0) {
          const randomProp = ownedProps[Math.floor(Math.random() * ownedProps.length)];
          randomProp.ownerId = null;
          randomProp.houses = 0;
          this.log(`${player.name} lost ${BOARD_DATA[randomProp.id].name} to the Bank!`);
       } else {
          this.log(`${player.name} had no unprotected properties to lose.`);
       }
    } else if (card.action === 'transfer_property') {
       const ownedProps = Object.values(this.state.properties).filter(p => p.ownerId === player.id && !p.protected);
       const otherPlayers = this.state.players.filter(p => p.id !== player.id && p.status !== 'bankrupt');
       if (ownedProps.length > 0 && otherPlayers.length > 0) {
          const randomProp = ownedProps[Math.floor(Math.random() * ownedProps.length)];
          const randomPlayer = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
          randomProp.ownerId = randomPlayer.id;
          randomProp.houses = 0;
          this.log(`${player.name} accidentally transferred ${BOARD_DATA[randomProp.id].name} to ${randomPlayer.name}!`);
       } else {
          this.log(`${player.name} had no unprotected properties or no opponents exist.`);
       }
    } else if (card.action === 'sabotage') {
       needsTarget = true;
       this.state.awaitingSabotage = true;
    } else if (card.action === 'protect') {
       needsTarget = true;
       this.state.awaitingProtection = true;
    }

    this.state.activeCard = null;

    if (!needsTarget) {
       if (this.checkDebt(player.id)) {
          // Debt will pause it
       } else {
          this.endTurn(player.id);
       }
    }
  }

  executeSabotage(playerId: string, propertyIndex: number) {
     if (this.state.players[this.state.turnIndex].id !== playerId) return;
     if (!this.state.awaitingSabotage) return;

     const prop = this.state.properties[propertyIndex];
     const player = this.getPlayer(playerId);
     
     if (!prop || !prop.ownerId || prop.ownerId === playerId) {
        return; // Invalid target (must be an opponent's property)
     }

     if (prop.protected) {
        prop.protected = false;
        this.log(`${player?.name} tried to sabotage ${BOARD_DATA[propertyIndex].name}, but its Shield absorbed the attack! The Shield was destroyed.`);
     } else {
        prop.houses = 0;
        prop.ownerId = null;
        this.log(`${player?.name} sabotaged ${BOARD_DATA[propertyIndex].name}! The property was destroyed and returned to the Bank.`);
     }

     this.state.awaitingSabotage = false;
     this.endTurn(playerId);
  }

  executeProtection(playerId: string, propertyIndex: number) {
     if (this.state.players[this.state.turnIndex].id !== playerId) return;
     if (!this.state.awaitingProtection) return;

     const prop = this.state.properties[propertyIndex];
     const player = this.getPlayer(playerId);
     
     if (!prop || prop.ownerId !== playerId) {
        return;
     }

     prop.protected = true;
     this.state.awaitingProtection = false;
     this.log(`${player?.name} applied protection to ${BOARD_DATA[propertyIndex].name}! It is now immune to Risk cards.`);
     
     this.endTurn(playerId);
  }

  endTurn(playerId: string) {
    if (this.state.players[this.state.turnIndex].id !== playerId) return;
    if (!this.state.hasRolled) return;
    if (this.state.awaitingBuyDecision !== null || this.state.awaitingDebtResolution) return;

    this.state.hasRolled = false;
    
    // Skip bankrupt and vacation-skipped players
    let loopCount = 0;
    do {
      this.state.turnIndex = (this.state.turnIndex + 1) % this.state.players.length;
      const nextPlayer = this.state.players[this.state.turnIndex];
      
      if (nextPlayer.status === 'bankrupt') continue;
      
      if (nextPlayer.skipNextTurn) {
        nextPlayer.skipNextTurn = false;
        this.log(`${nextPlayer.name} skips this turn because they are on Vacation!`);
        continue;
      }
      
      break;
    } while (loopCount++ < this.state.players.length * 2);

    const activePlayers = this.state.players.filter(p => p.status === 'active');
    if (activePlayers.length <= 1 && this.state.players.length > 1) {
      this.log(`${activePlayers[0]?.name || 'Nobody'} wins the game!`);
      this.state.state = 'ended';
      return;
    }

    if (this.state.doublesCount > 0 && !this.getCurrentPlayer()?.inJail) {
      this.log(`${this.getCurrentPlayer()?.name} gets another turn!`);
    } else {
      this.state.doublesCount = 0;
      const nextPlayer = this.getCurrentPlayer();
      this.log(`It is now ${nextPlayer?.name}'s turn.`);
    }
  }

  checkDebt(playerId: string): boolean {
    const player = this.getPlayer(playerId);
    if (!player) return false;

    if (player.money < 0) {
      const ownedProperties = Object.values(this.state.properties).filter(p => p.ownerId === playerId);
      if (ownedProperties.length === 0) {
        // No properties to sell, automatic bankruptcy
        this.checkBankruptcy(player);
        return false; // Turn can end
      } else {
        // Has properties, must sell
        this.state.awaitingDebtResolution = playerId;
        return true; // Must wait for resolution
      }
    }
    return false; // Not in debt
  }

  checkBankruptcy(player: Player) {
    if (player.money < 0) {
       this.log(`${player.name} is bankrupt!`);
       player.status = 'bankrupt';
       // Return properties to bank
       Object.values(this.state.properties).forEach(p => {
         if (p.ownerId === player.id) {
           p.ownerId = null;
           p.houses = 0;
           p.mortgaged = false;
           p.protected = false;
         }
       });
       
       // Check win condition
       const activePlayers = this.state.players.filter(p => p.status === 'active');
       if (activePlayers.length <= 1 && this.state.players.length > 1) {
          this.state.state = 'ended';
          this.log(`${activePlayers[0]?.name || 'Nobody'} has won the game!`);
       }
    }
  }

  removePlayer(playerId: string) {
    const playerIndex = this.state.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    const player = this.state.players[playerIndex];

    this.log(`${player.name} left the game.`);

    // Return properties to bank
    Object.values(this.state.properties).forEach(p => {
      if (p.ownerId === player.id) {
        p.ownerId = null;
        p.houses = 0;
        p.mortgaged = false;
        p.protected = false;
      }
    });

    // Remove player
    this.state.players.splice(playerIndex, 1);

    if (this.state.state === 'playing') {
      if (this.state.turnIndex >= playerIndex && this.state.turnIndex > 0) {
        this.state.turnIndex--;
      }
      if (this.state.players.length > 0) {
        this.state.turnIndex = this.state.turnIndex % this.state.players.length;
      }

      // Check win condition
      const activePlayers = this.state.players.filter(p => p.status === 'active');
      if (activePlayers.length <= 1 && this.state.players.length > 1) {
         this.state.state = 'ended';
         this.log(`${activePlayers[0]?.name || 'Nobody'} has won the game!`);
      } else if (activePlayers.length === 0) {
         this.state.state = 'ended';
      } else {
         // If it was their turn, maybe we need to end turn, but they are already removed,
         // so if they were the active player, the turnIndex now points to the next player.
         // We should just reset doubles and hasRolled.
         this.state.doublesCount = 0;
         this.state.hasRolled = false;
      }
    }
  }

  // --- Trading Logic ---
  proposeTrade(initiatorId: string, trade: Omit<TradeOffer, 'id' | 'status'>) {
    const tradeId = Math.random().toString(36).substring(2, 8);
    const newTrade: TradeOffer = { ...trade, id: tradeId, status: 'pending' };
    this.state.trades[tradeId] = newTrade;
    this.state.activeTradeId = tradeId; // Set active trade for modal
    const target = this.getPlayer(trade.targetId);
    this.log(`${this.getPlayer(initiatorId)?.name} proposed a trade to ${target?.name}.`);
    return newTrade;
  }

  acceptTrade(playerId: string, tradeId: string) {
    const trade = this.state.trades[tradeId];
    if (!trade || trade.status !== 'pending') return;

    // Verify player is the target
    if (playerId !== trade.targetId && playerId !== trade.initiatorId) return;

    const initiator = this.getPlayer(trade.initiatorId);
    const target = this.getPlayer(trade.targetId);
    if (!initiator || !target) return;

    // Execute trade (simplified check)
    initiator.money -= trade.offer.money;
    initiator.money += trade.request.money;
    target.money += trade.offer.money;
    target.money -= trade.request.money;

    trade.offer.properties.forEach(pid => {
      this.state.properties[pid].ownerId = target.id;
    });
    trade.request.properties.forEach(pid => {
      this.state.properties[pid].ownerId = initiator.id;
    });

    trade.status = 'accepted';
    this.state.activeTradeId = null;
    this.log(`Trade between ${initiator.name} and ${target.name} was accepted!`);
  }

  rejectTrade(playerId: string, tradeId: string) {
    const trade = this.state.trades[tradeId];
    if (!trade) return;
    trade.status = 'rejected';
    this.state.activeTradeId = null;
    this.log(`Trade was rejected.`);
  }

  counterTrade(playerId: string, tradeId: string, newOffer: TradeOffer['offer'], newRequest: TradeOffer['request']) {
    const trade = this.state.trades[tradeId];
    if (!trade || trade.status !== 'pending') return;
    
    // Swap initiator and target, and offer/request
    const oldInitiator = trade.initiatorId;
    trade.initiatorId = trade.targetId;
    trade.targetId = oldInitiator;
    
    trade.offer = newOffer;
    trade.request = newRequest;
    
    this.log(`${this.getPlayer(playerId)?.name} countered the trade offer.`);
  }

  handleFlightDecision(playerId: string, destinationIndex: number | null) {
    const player = this.getPlayer(playerId);
    if (!player || this.state.awaitingFlightDecision !== player.position) return;

    this.state.awaitingFlightDecision = null;

    if (destinationIndex === null) {
      this.log(`${player.name} decided not to fly.`);
      this.endTurn(playerId);
      return;
    }

    const sq = BOARD_DATA[player.position];
    if (sq.type !== 'railroad') {
      this.endTurn(playerId);
      return;
    }

    const propState = this.state.properties[sq.id];
    if (!propState || propState.ownerId === null) {
      this.endTurn(playerId);
      return;
    }

    const ticketPrice = sq.id === 45 ? 700 : 400;
    if (player.money < ticketPrice || player.flightChances <= 0) {
       this.endTurn(playerId);
       return;
    }

    // Process payment
    player.money -= ticketPrice;
    player.flightChances = 0;
    
    // Pay owner
    const owner = this.getPlayer(propState.ownerId);
    if (owner) {
       owner.money += ticketPrice;
    }

    const destSq = BOARD_DATA[destinationIndex];
    this.log(`${player.name} bought a flight ticket for $${ticketPrice} and flew to ${destSq.name}.`);
    
    // Teleport
    player.position = destinationIndex;
    
    // Handle landing on new square (could trigger another buy/debt decision)
    const needsBuyDecision = this.handleLanding(player, destSq);
    if (needsBuyDecision) {
      this.state.awaitingBuyDecision = destinationIndex;
    } else {
      // It is possible this triggered another debt resolution, check that
      if (!this.state.awaitingDebtResolution && this.state.awaitingFlightDecision === null) {
        this.endTurn(playerId);
      }
    }
  }
}

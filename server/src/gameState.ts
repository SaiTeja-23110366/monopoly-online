import { randomInt, randomUUID } from 'node:crypto';
import type {
  GameState, Player, PropertyState, TradeOffer, TradeAssets, ActiveCard, CardDeck,
  GameCommand, CommandResult, GamePhase, GameEvent, MovementReason, LandingContinuation, DebtRecord,
} from '../../shared/types';
import { BOARD_DATA, RULES, PLAYER_COLORS, flightDestinations, flightTicket, liquidationValue, propertyValue } from '../../shared/board';

export const SYSTEM_ACTOR = '__system__';
export const PHASE_DURATION = Object.freeze({ roll: 30_000, rolling: 900, moveStep: 140, rent: 1500,
  buy: 25_000, card: 10_000, risk: 35_000, flight: 25_000, debt: 120_000, end: 8_000 });

export const CHEST_CARDS: readonly Omit<ActiveCard, 'deck'>[] = [
  { text: 'Get Out of Jail Free! Keep this card.', action: 'get_out_of_jail' },
  { text: 'Bank error in your favor. Collect $200.', action: 'add_money', amount: 200 },
  { text: "Doctor’s fees. Pay $50.", action: 'deduct_money', amount: 50 },
  { text: 'Life insurance matures. Collect $100.', action: 'add_money', amount: 100 },
];
export const CHANCE_CARDS: readonly Omit<ActiveCard, 'deck'>[] = [
  { text: 'Bank Robbery! You got away with $500.', action: 'add_money', amount: 500 },
  { text: 'Hacked! You lose $300.', action: 'deduct_money', amount: 300 },
  { text: 'Advance to Start. Collect $1000 and your mine bonus.', action: 'go_to_start' },
  { text: 'Go directly to Jail. Do not pass Start.', action: 'go_to_jail' },
  { text: 'Go back 3 spaces. No Start income.', action: 'go_back_3' },
];
export const RISK_CARDS: readonly Omit<ActiveCard, 'deck'>[] = [
  { text: 'Market Crash! Lose 50% of your cash, rounded up.', action: 'market_crash' },
  { text: 'Lose a Property! A random property is reclaimed. A shield absorbs this once.', action: 'lose_property' },
  { text: 'Accidental Transfer! Give a random property to an opponent. A shield absorbs this once.', action: 'transfer_property' },
  { text: 'Sabotage! Choose an opponent’s property to return to the bank. A shield absorbs this once.', action: 'sabotage' },
  { text: 'Protect Your Place! Shield one property from the next property-targeting Risk effect.', action: 'protect' },
];

export interface EngineOptions {
  gameId?: string;
  now?: () => number;
  random?: () => number;
  dice?: () => [number, number];
  drawCard?: (deck: CardDeck) => ActiveCard;
}
class RuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function requireRule(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new RuleError(code, message);
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const FINISH: LandingContinuation = { kind: 'finish' };
const CARD_ACTIONS = new Set(['get_out_of_jail', 'add_money', 'deduct_money', 'go_to_start', 'go_to_jail',
  'go_back_3', 'market_crash', 'lose_property', 'transfer_property', 'sabotage', 'protect']);

/** Serializable deterministic domain state. It never schedules callbacks or performs I/O. */
export class MonopolyGame {
  state: GameState;
  readonly roomCode: string;
  private readonly options: EngineOptions;
  private now = 0;

  constructor(roomCode: string, options: EngineOptions = {}) {
    this.roomCode = roomCode;
    this.options = options;
    this.state = {
      schemaVersion: 2, gameId: options.gameId ?? randomUUID(), version: 0, roomCode, state: 'lobby', hostId: null, winnerId: null,
      players: [], turnIndex: 0, turnId: 0, phaseId: 0, phase: { kind: 'lobby' }, extraRoll: false,
      properties: {}, trades: {}, logs: ['Game created!'], diceValues: [1, 1], doublesCount: 0,
      hasRolled: false, awaitingBuyDecision: null, awaitingDebtResolution: null, awaitingFlightDecision: null,
      startingCash: 1500, activeTradeId: null, vacationJackpot: 0, activeCard: null,
      awaitingSabotage: false, awaitingProtection: false, activeAnimation: null,
      isAnimatingMovement: false, isRollingDice: false, events: [], lastEventSequence: 0,
    };
    for (const square of BOARD_DATA) {
      if (['property', 'railroad', 'utility'].includes(square.type)) {
        this.state.properties[square.id] = { id: square.id, ownerId: null, houses: 0, mortgaged: false, protected: false };
      }
    }
  }

  fork(): MonopolyGame {
    const result = new MonopolyGame(this.roomCode, this.options);
    result.state = structuredClone(this.state);
    result.now = this.now;
    return result;
  }
  validateState(): void { assertGameState(this.state); }

  /** The caller must persist this candidate before publishing it. Rejection never changes this.state. */
  applyCommand(actorId: string, command: GameCommand, now = this.options.now?.() ?? Date.now()): CommandResult {
    const candidate = this.fork();
    const cursor = this.state.lastEventSequence;
    try {
      requireRule(integer(now), 'INVALID_TIME', 'The server clock is invalid.');
      candidate.now = now;
      candidate.dispatch(actorId, command);
      candidate.syncDisplayFields();
      candidate.state.version++;
      candidate.validateState();
      this.state = candidate.state;
      return { ok: true, state: this.state, events: this.state.events.filter(event => event.sequence > cursor) };
    } catch (error) {
      if (error instanceof RuleError) return { ok: false, state: this.state, error: { code: error.code, message: error.message } };
      // Unexpected defects are surfaced to the transport; the live state has still not been mutated.
      throw error;
    }
  }

  /** Only the authenticated room manager may admit a new seat; resume never calls this method. */
  addPlayer(id: string, socketId: string, name: string, color: string): boolean {
    if (this.state.state !== 'lobby' || this.state.players.length >= RULES.maxPlayers || this.getPlayer(id)) return false;
    if (typeof id !== 'string' || id === SYSTEM_ACTOR || id.length < 1 || id.length > 128 || typeof name !== 'string' || !name.trim() || name.trim().length > 24) return false;
    if (!(PLAYER_COLORS as readonly string[]).includes(color.toLowerCase()) || this.state.players.some(p => p.color.toLowerCase() === color.toLowerCase())) return false;
    this.state.players.push({ id, socketId, name: name.trim(), color: color.toLowerCase(), money: this.state.startingCash,
      position: 0, status: 'active', inJail: false, jailTurns: 0, getOutOfJailCards: 0, flightChances: RULES.flightChanceRefresh,
      skipNextTurn: false, connected: true });
    this.state.hostId ??= id;
    this.state.version++;
    this.log(`${name.trim()} joined the game.`);
    return true;
  }

  getCurrentPlayer(): Player | null { return this.state.players[this.state.turnIndex] ?? null; }
  getPlayer(id: string): Player | null { return this.state.players.find(player => player.id === id) ?? null; }
  log(message: string): void { this.state.logs.push(message); this.state.logs = this.state.logs.slice(-80); }

  private dispatch(actorId: string, command: GameCommand): void {
    requireRule(object(command) && typeof command.type === 'string', 'INVALID_COMMAND', 'Invalid command.');
    requireRule(this.state.state !== 'ended', 'GAME_ENDED', 'This game has ended.');
    if (command.type === 'timeout') {
      requireRule(actorId === SYSTEM_ACTOR, 'FORBIDDEN', 'Only the server advances deadlines.');
      requireRule(command.turnId === this.state.turnId && command.phaseId === this.state.phaseId,
        'STALE_TIMEOUT', 'This deadline belongs to an older phase.');
      requireRule(this.state.turnDeadline !== undefined && this.now >= this.state.turnDeadline, 'EARLY_TIMEOUT', 'This deadline has not elapsed.');
      this.timeout(); return;
    }
    const player = this.getPlayer(actorId);
    requireRule(player && player.status === 'active', 'NOT_ACTIVE_PLAYER', 'You do not have an active seat.');
    if (command.type === 'leave_game') { this.leave(player); return; }
    if (command.type === 'change_color') {
      requireRule(this.state.state === 'lobby', 'WRONG_PHASE', 'Colors can only change in the lobby.');
      requireRule(typeof command.color === 'string' && (PLAYER_COLORS as readonly string[]).includes(command.color.toLowerCase()), 'INVALID_COLOR', 'Choose a supported color.');
      requireRule(!this.state.players.some(p => p.id !== actorId && p.color === command.color.toLowerCase()), 'COLOR_TAKEN', 'That color is already in use.');
      player.color = command.color.toLowerCase(); return;
    }
    if (command.type === 'start_game' || command.type === 'update_starting_cash') {
      requireRule(actorId === this.state.hostId, 'HOST_ONLY', 'Only the host can change game settings or start.');
      requireRule(this.state.state === 'lobby', 'WRONG_PHASE', 'The game has already started.');
      if (command.type === 'update_starting_cash') {
        requireRule(integer(command.cash, RULES.minStartingCash, RULES.maxStartingCash), 'INVALID_CASH', `Starting cash must be a whole number from $${RULES.minStartingCash} to $${RULES.maxStartingCash}.`);
        this.state.startingCash = command.cash;
        for (const p of this.state.players) p.money = command.cash;
      } else {
        requireRule(this.state.players.length >= RULES.minPlayers, 'MORE_PLAYERS_REQUIRED', 'At least two players are needed.');
        this.state.state = 'playing';
        this.state.turnIndex = 0;
        this.state.turnId++;
        this.state.players.forEach(p => { p.money = this.state.startingCash; });
        this.log('Game started!');
        this.beginTurn();
      }
      return;
    }
    requireRule(this.state.state === 'playing', 'GAME_NOT_STARTED', 'Start the game first.');
    if (command.type === 'propose_trade') { this.proposeTrade(player, command); return; }
    if (command.type === 'accept_trade') { this.acceptTrade(player, command.tradeId); return; }
    if (command.type === 'reject_trade') { this.rejectTrade(player, command.tradeId); return; }
    if (command.type === 'counter_trade') { this.counterTrade(player, command); return; }
    requireRule(this.getCurrentPlayer()?.id === actorId, 'NOT_YOUR_TURN', 'It is not your turn.');
    switch (command.type) {
      case 'roll_dice': this.requirePhase('awaiting_roll'); this.roll(player); return;
      case 'end_turn': this.requirePhase('awaiting_end'); this.advanceTurn(); return;
      case 'buy_property': this.purchase(player, command.propertyIndex, command.housesToBuy, 'buy'); return;
      case 'upgrade_property': this.purchase(player, command.propertyIndex, command.housesToBuy, 'upgrade'); return;
      case 'pass_property': this.requirePhase('buy'); this.log(`${player.name} passed on ${BOARD_DATA[player.position].fullName}.`); this.finishLanding(); return;
      case 'sell_property_to_bank': this.requirePhase('debt'); this.sell(player, command.propertyIndex); this.resumeDebt(); return;
      case 'declare_bankruptcy': this.requirePhase('debt'); this.eliminate(player, 'bankrupt'); return;
      case 'pay_jail_fine': this.requirePhase('awaiting_roll'); this.releaseJail(player, false); return;
      case 'use_jail_card': this.requirePhase('awaiting_roll'); this.releaseJail(player, true); return;
      case 'acknowledge_card': this.requirePhase('card'); this.applyCard(player); return;
      case 'flight_decision': this.requirePhase('flight'); this.fly(player, command.destinationIndex); return;
      case 'execute_sabotage': this.targetRisk(player, command.propertyIndex, 'sabotage'); return;
      case 'execute_protection': this.targetRisk(player, command.propertyIndex, 'protect'); return;
      default: throw new RuleError('INVALID_COMMAND', 'Unknown command.');
    }
  }

  private requirePhase<K extends GamePhase['kind']>(kind: K): Extract<GamePhase, { kind: K }> {
    requireRule(this.state.phase.kind === kind, 'WRONG_PHASE', `This action is not available during ${this.state.phase.kind.replaceAll('_', ' ')}.`);
    return this.state.phase as Extract<GamePhase, { kind: K }>;
  }
  private setPhase(phase: GamePhase, duration?: number): void {
    this.state.phase = phase;
    this.state.phaseId++;
    this.state.turnDeadline = duration === undefined ? undefined : this.now + duration;
  }
  private syncDisplayFields(): void {
    const phase = this.state.phase;
    this.state.hasRolled = !['lobby', 'awaiting_roll'].includes(phase.kind);
    this.state.isRollingDice = phase.kind === 'rolling';
    this.state.isAnimatingMovement = phase.kind === 'moving';
    this.state.awaitingBuyDecision = phase.kind === 'buy' ? phase.propertyIndex : null;
    this.state.awaitingFlightDecision = phase.kind === 'flight' ? phase.airportId : null;
    this.state.awaitingDebtResolution = phase.kind === 'debt' ? phase.playerId : null;
    this.state.activeCard = phase.kind === 'card' ? phase.card : null;
    this.state.awaitingSabotage = phase.kind === 'risk_target' && phase.action === 'sabotage';
    this.state.awaitingProtection = phase.kind === 'risk_target' && phase.action === 'protect';
    this.state.activeAnimation = phase.kind === 'rent' ? phase.payment : null;
  }
  private event(data: Omit<Extract<GameEvent, { type: 'movement' }>, 'sequence' | 'id' | 'at' | 'turnId'> |
    Omit<Extract<GameEvent, { type: 'dice' }>, 'sequence' | 'id' | 'at' | 'turnId'> |
    Omit<Extract<GameEvent, { type: 'payment' }>, 'sequence' | 'id' | 'at' | 'turnId'> |
    Omit<Extract<GameEvent, { type: 'notice' }>, 'sequence' | 'id' | 'at' | 'turnId'>): void {
    const sequence = ++this.state.lastEventSequence;
    this.state.events.push({ ...data, sequence, id: `${this.state.gameId}:${sequence}`, at: this.now, turnId: this.state.turnId });
    this.state.events = this.state.events.slice(-64);
  }
  private randomIndex(length: number): number {
    const value = this.options.random ? this.options.random() : randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;
    requireRule(Number.isFinite(value) && value >= 0 && value < 1, 'INVALID_RANDOM', 'Invalid random source.');
    return Math.floor(value * length);
  }
  private beginTurn(): void {
    const player = this.getCurrentPlayer()!;
    this.state.extraRoll = false;
    this.state.doublesCount = 0;
    this.log(`It is ${player.name}’s turn${player.inJail ? ' in Jail' : ''}.`);
    this.setPhase({ kind: 'awaiting_roll', playerId: player.id }, PHASE_DURATION.roll);
  }
  private roll(player: Player): void {
    const values = this.options.dice?.() ?? [this.randomIndex(6) + 1, this.randomIndex(6) + 1];
    requireRule(Array.isArray(values) && values.length === 2 && values.every(value => integer(value, 1, 6)), 'INVALID_DICE', 'Invalid dice source.');
    const dice: [number, number] = [values[0], values[1]];
    this.state.diceValues = dice;
    this.state.extraRoll = false;
    this.log(`${player.name} rolled ${dice[0]} and ${dice[1]}.`);
    this.event({ type: 'dice', playerId: player.id, values: dice });
    this.setPhase({ kind: 'rolling', playerId: player.id, dice, jailed: player.inJail }, PHASE_DURATION.rolling);
  }
  private resolveRoll(): void {
    const phase = this.requirePhase('rolling');
    const player = this.getCurrentPlayer()!;
    const [d1, d2] = phase.dice;
    const doubles = d1 === d2;
    if (phase.jailed) {
      this.state.doublesCount = 0;
      this.state.extraRoll = false;
      if (!doubles) {
        player.jailTurns++;
        if (player.jailTurns >= RULES.jailFailedAttempts) {
          player.inJail = false; player.jailTurns = 0;
          this.log(`${player.name} is released for free after three failed attempts, and can move next turn.`);
        } else this.log(`${player.name} did not roll doubles (${player.jailTurns}/3 attempts).`);
        this.finishLanding(); return;
      }
      player.inJail = false; player.jailTurns = 0;
      this.log(`${player.name} rolled doubles and left Jail. No extra roll is earned by escaping.`);
    } else if (doubles) {
      this.state.doublesCount++;
      if (this.state.doublesCount >= 3) { this.sendToJail(player, 'three consecutive doubles'); return; }
      this.state.extraRoll = true;
    } else this.state.doublesCount = 0;
    this.move(player, d1 + d2, 'dice', true);
  }
  private move(player: Player, steps: number, reason: MovementReason, startRewards: boolean, continuation: 'landing' | 'finish' = 'landing'): void {
    const from = player.position;
    const direction = steps < 0 ? 'backward' : 'forward';
    const path: number[] = [];
    for (let step = 1; step <= Math.abs(steps); step++) path.push((from + Math.sign(steps) * step + RULES.boardSize * 2) % RULES.boardSize);
    const to = path.at(-1) ?? from;
    if (startRewards && steps > 0 && path.includes(0)) this.startIncome(player, to === 0);
    player.position = to;
    this.animateMove(player, from, path, direction, reason, continuation);
  }
  private animateMove(player: Player, from: number, path: number[], direction: 'forward' | 'backward' | 'direct', reason: MovementReason, continuation: 'landing' | 'finish'): void {
    const durationMs = direction === 'direct' ? 650 : Math.max(250, path.length * PHASE_DURATION.moveStep + 180);
    const movement = { playerId: player.id, from, to: player.position, path, direction, reason, durationMs };
    this.event({ type: 'movement', ...movement });
    this.setPhase({ kind: 'moving', ...movement, continuation }, durationMs);
  }
  private startIncome(player: Player, landed: boolean): void {
    const mineCount = this.owned(player.id).filter(prop => BOARD_DATA[prop.id].type === 'utility').length;
    const bonus = RULES.mineBonuses[mineCount];
    const amount = (landed ? RULES.landingStart : RULES.passingStart) + bonus;
    player.money += amount;
    player.flightChances = RULES.flightChanceRefresh;
    this.log(`${player.name} ${landed ? 'landed on' : 'passed'} Start: +$${amount}${bonus ? ` including $${bonus} from mines` : ''}, and a refreshed flight chance.`);
  }
  private landing(): void {
    const player = this.getCurrentPlayer()!;
    const square = BOARD_DATA[player.position];
    this.log(`${player.name} landed on ${square.fullName}.`);
    if (square.type === 'tax') {
      const amount = square.name === 'Money Tax' ? Math.floor(Math.max(0, player.money) * RULES.moneyTaxRate) :
        Math.floor(this.owned(player.id).reduce((sum, property) => sum + propertyValue(property.id, property.houses), 0) * RULES.propertyTaxRate);
      const debt = this.charge(player, amount, null, true, square.fullName, FINISH);
      this.debtOrContinue(debt, FINISH); return;
    }
    if (square.type === 'corner') {
      if (square.id === 42) { this.sendToJail(player, 'Go to Jail'); return; }
      if (square.id === RULES.vacationIndex) {
        this.log(`${player.name} won the $${this.state.vacationJackpot} Vacation jackpot and will skip their next turn.`);
        player.money += this.state.vacationJackpot; this.state.vacationJackpot = 0;
        player.skipNextTurn = true; this.state.extraRoll = false;
      }
      this.finishLanding(); return;
    }
    if (square.type === 'chance' || square.type === 'chest') {
      const deck: CardDeck = square.type === 'chest' ? 'chest' : square.name === 'Risk' ? 'risk' : 'chance';
      const cards = deck === 'chest' ? CHEST_CARDS : deck === 'risk' ? RISK_CARDS : CHANCE_CARDS;
      const card = this.options.drawCard?.(deck) ?? { ...cards[this.randomIndex(cards.length)], deck };
      requireRule(card && card.deck === deck && CARD_ACTIONS.has(card.action) && typeof card.text === 'string' &&
        (card.amount === undefined || integer(card.amount, 0, 1_000_000)), 'INVALID_CARD', 'Invalid card source.');
      this.log(`${player.name} drew a ${deck} card.`);
      this.setPhase({ kind: 'card', playerId: player.id, card: structuredClone(card) }, PHASE_DURATION.card); return;
    }
    const property = this.state.properties[square.id];
    if (property.ownerId === null) {
      if (player.money >= (square.price ?? 0)) this.setPhase({ kind: 'buy', playerId: player.id, propertyIndex: square.id,
        mode: 'buy', maxHouses: this.maxBuild(player, property, true) }, PHASE_DURATION.buy);
      else this.finishLanding();
      return;
    }
    const continuation: LandingContinuation = square.type === 'railroad' ? { kind: 'flight', airportId: square.id } : FINISH;
    if (property.ownerId !== player.id && !property.mortgaged) {
      const owner = this.getPlayer(property.ownerId)!;
      const count = this.owned(owner.id).filter(p => BOARD_DATA[p.id].type === square.type && !p.mortgaged).length;
      const rent = square.rent?.[square.type === 'property' ? property.houses : Math.max(0, count - 1)] ?? 0;
      const debt = this.charge(player, rent, owner.id, false, `rent for ${square.fullName}`, continuation);
      this.setPhase({ kind: 'rent', playerId: player.id,
        payment: { type: 'rent', message: `${player.name} owes ${owner.name} rent`, amount: rent, payerId: player.id, payeeId: owner.id }, debt, continuation }, PHASE_DURATION.rent);
      return;
    }
    if (property.ownerId === player.id && square.type === 'property' && this.maxBuild(player, property, false) > 0 && player.money >= (square.houseCost ?? Infinity)) {
      this.setPhase({ kind: 'buy', playerId: player.id, propertyIndex: square.id, mode: 'upgrade',
        maxHouses: this.maxBuild(player, property, false) }, PHASE_DURATION.buy); return;
    }
    this.continueLanding(continuation);
  }
  private owned(playerId: string): PropertyState[] { return Object.values(this.state.properties).filter(property => property.ownerId === playerId); }
  private maxBuild(player: Player, property: PropertyState, buying: boolean): number {
    const square = BOARD_DATA[property.id];
    if (square.type !== 'property' || property.mortgaged) return 0;
    const ownsGroup = BOARD_DATA.filter(other => other.colorGroup === square.colorGroup).every(other =>
      (buying && other.id === property.id) || this.state.properties[other.id].ownerId === player.id);
    return buying ? RULES.initialHouseLimit : Math.max(0, (ownsGroup ? RULES.hotelLevel : RULES.maxHouses) - property.houses);
  }
  private purchase(player: Player, propertyIndex: number, houses: number, mode: 'buy' | 'upgrade'): void {
    const phase = this.requirePhase('buy');
    requireRule(integer(propertyIndex, 0, RULES.boardSize - 1) && propertyIndex === phase.propertyIndex && phase.mode === mode,
      'INVALID_PROPERTY', 'This is not the pending property decision.');
    const property = this.state.properties[propertyIndex];
    const square = BOARD_DATA[propertyIndex];
    requireRule(property && (mode === 'buy' ? property.ownerId === null : property.ownerId === player.id), 'INVALID_OWNER', 'Property ownership has changed.');
    const max = this.maxBuild(player, property, mode === 'buy');
    requireRule(integer(houses, mode === 'buy' ? 0 : 1, max), 'INVALID_BUILDINGS', `Choose ${mode === 'buy' ? 0 : 1}–${max} additional buildings. Hotels require the full color group.`);
    const cost = (mode === 'buy' ? square.price ?? 0 : 0) + houses * (square.houseCost ?? 0);
    requireRule(player.money >= cost, 'INSUFFICIENT_FUNDS', `You need $${cost} for this purchase.`);
    player.money -= cost; property.ownerId = player.id; property.houses += houses;
    this.log(`${player.name} ${mode === 'buy' ? 'bought' : 'upgraded'} ${square.fullName}${property.houses === RULES.hotelLevel ? ' with a hotel' : houses ? ` with ${houses} new house(s)` : ''} for $${cost}.`);
    this.cancelInvalidTrades();
    this.continueLanding(square.type === 'railroad' ? { kind: 'flight', airportId: square.id } : FINISH);
  }
  private finishLanding(): void {
    if (this.state.state !== 'playing') return;
    const player = this.getCurrentPlayer()!;
    if (this.state.extraRoll && !player.inJail && !player.skipNextTurn) {
      this.log(`${player.name} earned another roll.`);
      this.setPhase({ kind: 'awaiting_roll', playerId: player.id }, PHASE_DURATION.roll);
    } else {
      this.state.extraRoll = false;
      this.setPhase({ kind: 'awaiting_end', playerId: player.id }, PHASE_DURATION.end);
    }
  }
  private continueLanding(continuation: LandingContinuation): void {
    const player = this.getCurrentPlayer()!;
    if (continuation.kind === 'flight' && player.position === continuation.airportId && player.flightChances > 0) {
      const property = this.state.properties[continuation.airportId];
      if (property?.ownerId && !property.mortgaged) {
        const ticketPrice = property.ownerId === player.id ? 0 : flightTicket(continuation.airportId);
        if (player.money >= ticketPrice) {
          this.setPhase({ kind: 'flight', playerId: player.id, airportId: continuation.airportId,
            destinations: flightDestinations(continuation.airportId), ticketPrice }, PHASE_DURATION.flight); return;
        }
      }
    }
    this.finishLanding();
  }
  private fly(player: Player, destination: number | null): void {
    const phase = this.requirePhase('flight');
    if (destination === null) { this.log(`${player.name} chose not to fly.`); this.finishLanding(); return; }
    requireRule(integer(destination, 0, RULES.boardSize - 1) && phase.destinations.includes(destination), 'INVALID_DESTINATION', 'Choose a square before or at the next clockwise airport.');
    const property = this.state.properties[phase.airportId];
    requireRule(player.position === phase.airportId && player.flightChances > 0 && property.ownerId && !property.mortgaged, 'FLIGHT_UNAVAILABLE', 'This flight is no longer available.');
    const cost = property.ownerId === player.id ? 0 : flightTicket(phase.airportId);
    requireRule(player.money >= cost, 'INSUFFICIENT_FUNDS', `This ticket costs $${cost}.`);
    player.money -= cost;
    this.getPlayer(property.ownerId)!.money += cost;
    player.flightChances = 0;
    const from = player.position; player.position = destination;
    this.log(`${player.name} flew to ${BOARD_DATA[destination].fullName} for $${cost}. Flights do not collect Start income.`);
    this.event({ type: 'payment', playerId: player.id, payeeId: property.ownerId, amount: cost, reason: 'flight ticket' });
    this.animateMove(player, from, [destination], 'direct', 'flight', 'landing');
  }
  private sendToJail(player: Player, reason: string): void {
    const from = player.position;
    player.position = RULES.jailIndex; player.inJail = true; player.jailTurns = 0;
    this.state.doublesCount = 0; this.state.extraRoll = false;
    this.log(`${player.name} went to Jail (${reason}).`);
    this.animateMove(player, from, [RULES.jailIndex], 'direct', 'jail', 'finish');
  }
  private releaseJail(player: Player, withCard: boolean): void {
    requireRule(player.inJail, 'NOT_IN_JAIL', 'You are not in Jail.');
    if (withCard) {
      requireRule(player.getOutOfJailCards > 0, 'NO_JAIL_CARD', 'You do not have a Get Out of Jail card.');
      player.getOutOfJailCards--;
    } else {
      requireRule(player.money >= RULES.jailFine, 'INSUFFICIENT_FUNDS', `The Jail fine is $${RULES.jailFine}.`);
      player.money -= RULES.jailFine; this.state.vacationJackpot += RULES.jailFine;
    }
    player.inJail = false; player.jailTurns = 0;
    this.log(`${player.name} ${withCard ? 'used a Get Out of Jail card' : `paid the $${RULES.jailFine} fine`}. Roll to move.`);
    this.cancelInvalidTrades();
  }
  private charge(player: Player, amount: number, creditorId: string | null, toJackpot: boolean, reason: string, continuation: LandingContinuation): DebtRecord | null {
    const paid = Math.min(Math.max(0, player.money), amount);
    player.money -= amount;
    this.creditPayee(creditorId, toJackpot, paid);
    this.log(`${player.name} ${paid === amount ? 'paid' : 'owes'} $${amount} for ${reason}${paid < amount ? ` ($${amount - paid} still due)` : ''}.`);
    this.event({ type: 'payment', playerId: player.id, payeeId: creditorId, amount, reason });
    return player.money < 0 ? { playerId: player.id, creditorId, toJackpot, remaining: -player.money, reason, continuation } : null;
  }
  private creditPayee(creditorId: string | null, toJackpot: boolean, amount: number): void {
    const creditor = creditorId ? this.getPlayer(creditorId) : null;
    if (creditor?.status === 'active') creditor.money += amount;
    else if (toJackpot) this.state.vacationJackpot += amount;
  }
  private debtOrContinue(debt: DebtRecord | null, continuation: LandingContinuation): void {
    if (debt) this.setPhase({ kind: 'debt', playerId: debt.playerId, debt }, PHASE_DURATION.debt);
    else this.continueLanding(continuation);
  }
  private settleDebtIncome(beforeMoney: number): void {
    if (this.state.phase.kind !== 'debt') return;
    const debt = this.state.phase.debt;
    const player = this.getPlayer(debt.playerId)!;
    const income = Math.max(0, player.money - beforeMoney);
    const payment = Math.min(debt.remaining, income);
    this.creditPayee(debt.creditorId, debt.toJackpot, payment);
    debt.remaining -= payment;
  }
  private resumeDebt(): void {
    if (this.state.phase.kind !== 'debt') return;
    const phase = this.state.phase;
    const player = this.getPlayer(phase.playerId)!;
    if (player.money >= 0) {
      requireRule(phase.debt.remaining === 0, 'INVALID_DEBT', 'Debt settlement is inconsistent.');
      this.log(`${player.name} resolved their debt.`);
      this.continueLanding(phase.debt.continuation);
    }
  }
  private sell(player: Player, index: number): void {
    requireRule(integer(index, 0, RULES.boardSize - 1) && this.state.properties[index]?.ownerId === player.id, 'INVALID_PROPERTY', 'Choose a property you own.');
    const property = this.state.properties[index];
    const amount = liquidationValue(index, property.houses);
    const beforeMoney = player.money;
    player.money += amount;
    this.returnToBank(property);
    this.settleDebtIncome(beforeMoney);
    this.log(`${player.name} sold ${BOARD_DATA[index].fullName}, including its buildings, for $${amount} (75%).`);
    this.cancelInvalidTrades();
  }
  private applyCard(player: Player): void {
    const card = this.requirePhase('card').card;
    switch (card.action) {
      case 'get_out_of_jail': player.getOutOfJailCards++; break;
      case 'add_money': player.money += card.amount ?? 0; break;
      case 'deduct_money': this.debtOrContinue(this.charge(player, card.amount ?? 0, null, true, 'card payment', FINISH), FINISH); return;
      case 'go_to_start': this.move(player, RULES.boardSize - player.position, 'card_forward', true); return;
      case 'go_to_jail': this.sendToJail(player, 'Chance card'); return;
      case 'go_back_3': this.move(player, -3, 'card_backward', false); return;
      case 'market_crash': player.money = Math.floor(player.money / 2); break;
      case 'lose_property':
      case 'transfer_property': {
        const owned = this.owned(player.id);
        const opponents = this.state.players.filter(p => p.id !== player.id && p.status === 'active');
        if (!owned.length || (card.action === 'transfer_property' && !opponents.length)) { this.log('No eligible property for this Risk card.'); break; }
        const property = owned[this.randomIndex(owned.length)];
        if (this.absorbShield(property)) break;
        if (card.action === 'lose_property') { this.returnToBank(property); this.log(`${BOARD_DATA[property.id].fullName} returned to the bank.`); }
        else {
          const recipient = opponents[this.randomIndex(opponents.length)];
          property.ownerId = recipient.id; property.houses = 0; property.protected = false;
          this.log(`${BOARD_DATA[property.id].fullName} transferred to ${recipient.name}; its buildings were removed.`);
        }
        break;
      }
      case 'sabotage':
      case 'protect': {
        const targets = Object.values(this.state.properties).filter(property => card.action === 'sabotage' ?
          property.ownerId && property.ownerId !== player.id : property.ownerId === player.id && !property.protected).map(property => property.id);
        if (targets.length) { this.setPhase({ kind: 'risk_target', playerId: player.id, action: card.action, targets }, PHASE_DURATION.risk); return; }
        this.log('No eligible properties for this Risk card.'); break;
      }
    }
    this.cancelInvalidTrades(); this.finishLanding();
  }
  private absorbShield(property: PropertyState): boolean {
    if (!property.protected) return false;
    property.protected = false;
    this.log(`${BOARD_DATA[property.id].fullName}’s shield absorbed the Risk effect and was consumed.`);
    return true;
  }
  private targetRisk(player: Player, index: number, action: 'sabotage' | 'protect'): void {
    const phase = this.requirePhase('risk_target');
    requireRule(phase.action === action && integer(index, 0, RULES.boardSize - 1) && phase.targets.includes(index), 'INVALID_TARGET', 'Choose one of the eligible properties.');
    const property = this.state.properties[index];
    requireRule(action === 'sabotage' ? property.ownerId && property.ownerId !== player.id : property.ownerId === player.id && !property.protected, 'INVALID_TARGET', 'This property is no longer an eligible target.');
    if (action === 'protect') { property.protected = true; this.log(`${player.name} shielded ${BOARD_DATA[index].fullName}.`); }
    else if (!this.absorbShield(property)) { this.returnToBank(property); this.log(`${player.name} sabotaged ${BOARD_DATA[index].fullName}.`); }
    this.cancelInvalidTrades(); this.finishLanding();
  }
  private advanceTurn(): void {
    if (this.checkWinner()) return;
    for (const trade of Object.values(this.state.trades)) if (trade.status === 'pending') trade.status = 'cancelled';
    this.state.activeTradeId = null;
    // Two passes suffice even if every active player has one Vacation skip pending.
    for (let offset = 1; offset <= this.state.players.length * 2; offset++) {
      const index = (this.state.turnIndex + offset) % this.state.players.length;
      const next = this.state.players[index];
      if (next.status !== 'active') continue;
      if (next.skipNextTurn) { next.skipNextTurn = false; this.log(`${next.name} skipped a turn for Vacation.`); continue; }
      this.state.turnIndex = index; this.state.turnId++; this.beginTurn(); return;
    }
    throw new RuleError('NO_NEXT_PLAYER', 'No next player could be selected.');
  }
  private returnToBank(property: PropertyState): void {
    property.ownerId = null; property.houses = 0; property.protected = false; property.mortgaged = false;
  }
  private eliminate(player: Player, status: 'bankrupt' | 'forfeited'): void {
    const wasCurrent = this.getCurrentPlayer()?.id === player.id;
    player.status = status; player.inJail = false; player.jailTurns = 0; player.skipNextTurn = false;
    player.money = Math.max(0, player.money);
    player.getOutOfJailCards = 0; player.flightChances = 0;
    for (const property of this.owned(player.id)) this.returnToBank(property);
    for (const trade of Object.values(this.state.trades)) if (trade.status === 'pending' && [trade.initiatorId, trade.targetId].includes(player.id)) trade.status = 'cancelled';
    this.state.activeTradeId = this.state.activeTradeId && this.state.trades[this.state.activeTradeId]?.status === 'pending' ? this.state.activeTradeId : null;
    if (this.state.hostId === player.id) this.state.hostId = this.state.players.find(p => p.status === 'active')?.id ?? null;
    this.log(`${player.name} ${status === 'bankrupt' ? 'went bankrupt' : 'forfeited'}.`);
    if (this.checkWinner()) return;
    if (wasCurrent) this.advanceTurn();
    else {
      // A creditor leaving cannot leave an invalid owner or retain a receivable.
      if (this.state.phase.kind === 'debt' && this.state.phase.debt.creditorId === player.id) this.state.phase.debt.creditorId = null;
      if (this.state.phase.kind === 'rent' && this.state.phase.debt?.creditorId === player.id) this.state.phase.debt.creditorId = null;
      if (this.state.phase.kind === 'risk_target') {
        this.state.phase.targets = this.state.phase.targets.filter(id => {
          const p = this.state.properties[id];
          return this.state.phase.kind === 'risk_target' && (this.state.phase.action === 'sabotage' ? p.ownerId && p.ownerId !== this.getCurrentPlayer()!.id : p.ownerId === this.getCurrentPlayer()!.id && !p.protected);
        });
        if (!this.state.phase.targets.length) this.finishLanding();
      }
      if (this.state.phase.kind === 'flight' && !this.state.properties[this.state.phase.airportId].ownerId) this.finishLanding();
    }
  }
  private checkWinner(): boolean {
    const active = this.state.players.filter(player => player.status === 'active');
    if (this.state.state !== 'playing' || active.length > 1) return false;
    this.state.state = 'ended'; this.state.winnerId = active[0]?.id ?? null;
    this.state.extraRoll = false; this.state.doublesCount = 0; this.state.activeTradeId = null;
    for (const trade of Object.values(this.state.trades)) if (trade.status === 'pending') trade.status = 'cancelled';
    this.setPhase({ kind: 'ended', winnerId: this.state.winnerId, reason: active.length ? 'last_player_standing' : 'no_active_players' });
    this.log(active.length ? `${active[0].name} won the game!` : 'The game ended without a winner.');
    return true;
  }
  private leave(player: Player): void {
    if (this.state.state === 'lobby') {
      this.state.players = this.state.players.filter(p => p.id !== player.id);
      if (this.state.hostId === player.id) this.state.hostId = this.state.players[0]?.id ?? null;
      this.state.turnIndex = 0; this.log(`${player.name} left the lobby.`);
    } else this.eliminate(player, 'forfeited');
  }
  private timeout(): void {
    const player = this.getCurrentPlayer();
    requireRule(player && this.state.state === 'playing', 'WRONG_PHASE', 'No active deadline.');
    switch (this.state.phase.kind) {
      case 'awaiting_roll': this.roll(player); return;
      case 'rolling': this.resolveRoll(); return;
      case 'moving': this.state.phase.continuation === 'landing' ? this.landing() : this.finishLanding(); return;
      case 'rent': this.debtOrContinue(this.state.phase.debt, this.state.phase.continuation); return;
      case 'buy': this.log(`${player.name}’s purchase decision timed out.`); this.finishLanding(); return;
      case 'flight': this.log(`${player.name}’s flight decision timed out.`); this.finishLanding(); return;
      case 'card': this.applyCard(player); return;
      case 'risk_target': this.log(`${player.name} did not choose a Risk target in time.`); this.finishLanding(); return;
      case 'debt':
        for (const property of this.owned(player.id).sort((a, b) => liquidationValue(a.id, a.houses) - liquidationValue(b.id, b.houses))) {
          if (player.money >= 0) break;
          this.sell(player, property.id);
        }
        if (player.money < 0) this.eliminate(player, 'bankrupt'); else this.resumeDebt();
        return;
      case 'awaiting_end': this.advanceTurn(); return;
      default: throw new RuleError('WRONG_PHASE', 'No deadline can advance this phase.');
    }
  }

  private tradePhase(): void {
    requireRule(['awaiting_roll', 'awaiting_end', 'buy', 'flight', 'debt'].includes(this.state.phase.kind), 'WRONG_PHASE', 'Trading is paused while movement or an effect resolves.');
  }
  private validateAssets(assets: unknown, owner: Player): asserts assets is TradeAssets {
    requireRule(object(assets) && integer(assets.money, 0, 1_000_000_000) && integer(assets.getOutOfJailCards, 0, 100_000) && Array.isArray(assets.properties) && assets.properties.length <= 44,
      'INVALID_TRADE', 'Trade quantities must be nonnegative whole numbers.');
    requireRule(assets.money <= Math.max(0, owner.money) && assets.getOutOfJailCards <= owner.getOutOfJailCards, 'INSUFFICIENT_TRADE_ASSETS', `${owner.name} no longer has the offered cash or jail cards.`);
    requireRule(new Set(assets.properties).size === assets.properties.length && assets.properties.every(id => integer(id, 0, RULES.boardSize - 1) && this.state.properties[id]?.ownerId === owner.id),
      'INVALID_TRADE_PROPERTIES', 'Each traded property must be unique and owned by its sender.');
  }
  private validateTrade(trade: Pick<TradeOffer, 'initiatorId' | 'targetId' | 'offer' | 'request'>): void {
    const initiator = this.getPlayer(trade.initiatorId); const target = this.getPlayer(trade.targetId);
    requireRule(initiator && target && initiator.status === 'active' && target.status === 'active' && initiator.id !== target.id, 'INVALID_TRADE_PLAYERS', 'Trade with another active player.');
    this.validateAssets(trade.offer, initiator); this.validateAssets(trade.request, target);
  }
  private proposeTrade(player: Player, command: Extract<GameCommand, { type: 'propose_trade' }>): void {
    this.tradePhase();
    requireRule(typeof command.targetId === 'string', 'INVALID_TRADE', 'Choose a trade recipient.');
    const trade: TradeOffer = { id: `trade-${this.state.version + 1}`, initiatorId: player.id, targetId: command.targetId,
      offer: command.offer, request: command.request, status: 'pending', revision: 0 };
    this.validateTrade(trade);
    requireRule(Object.values(this.state.trades).filter(t => t.status === 'pending').length < 8, 'TOO_MANY_TRADES', 'Resolve an existing trade first.');
    this.state.trades[trade.id] = structuredClone(trade);
    this.state.activeTradeId = trade.id;
    this.log(`${player.name} offered a trade to ${this.getPlayer(trade.targetId)!.name}.`);
    this.trimTrades();
  }
  private pendingTrade(id: string): TradeOffer {
    requireRule(typeof id === 'string' && Object.hasOwn(this.state.trades, id) && this.state.trades[id].status === 'pending', 'TRADE_NOT_PENDING', 'This trade is no longer pending.');
    return this.state.trades[id];
  }
  private acceptTrade(player: Player, id: string): void {
    this.tradePhase();
    const trade = this.pendingTrade(id);
    requireRule(trade.targetId === player.id, 'TRADE_TARGET_ONLY', 'Only the current recipient can accept this trade.');
    this.validateTrade(trade);
    const initiator = this.getPlayer(trade.initiatorId)!; const target = this.getPlayer(trade.targetId)!;
    const debtor = this.state.phase.kind === 'debt' ? this.getPlayer(this.state.phase.playerId)! : null;
    const beforeDebtMoney = debtor?.money ?? 0;
    initiator.money += trade.request.money - trade.offer.money;
    target.money += trade.offer.money - trade.request.money;
    initiator.getOutOfJailCards += trade.request.getOutOfJailCards - trade.offer.getOutOfJailCards;
    target.getOutOfJailCards += trade.offer.getOutOfJailCards - trade.request.getOutOfJailCards;
    for (const index of trade.offer.properties) this.state.properties[index].ownerId = target.id;
    for (const index of trade.request.properties) this.state.properties[index].ownerId = initiator.id;
    trade.status = 'accepted'; this.state.activeTradeId = null;
    this.log(`${initiator.name} and ${target.name} completed their trade.`);
    if (debtor) { this.settleDebtIncome(beforeDebtMoney); this.resumeDebt(); }
    this.cancelInvalidTrades();
    if (this.state.phase.kind === 'buy') this.state.phase.maxHouses = this.maxBuild(this.getCurrentPlayer()!, this.state.properties[this.state.phase.propertyIndex], this.state.phase.mode === 'buy');
    if (this.state.phase.kind === 'buy') {
      const prop = this.state.properties[this.state.phase.propertyIndex];
      if (this.state.phase.mode === 'upgrade' && prop.ownerId !== this.getCurrentPlayer()!.id) this.finishLanding();
    }
    if (this.state.phase.kind === 'flight') this.state.phase.ticketPrice = this.state.properties[this.state.phase.airportId].ownerId === this.getCurrentPlayer()!.id ? 0 : flightTicket(this.state.phase.airportId);
  }
  private rejectTrade(player: Player, id: string): void {
    const trade = this.pendingTrade(id);
    requireRule([trade.initiatorId, trade.targetId].includes(player.id), 'TRADE_PARTICIPANTS_ONLY', 'Only the trade participants can dismiss this trade.');
    trade.status = player.id === trade.initiatorId ? 'cancelled' : 'rejected';
    if (this.state.activeTradeId === id) this.state.activeTradeId = null;
    this.log(`${player.name} ${trade.status} a trade.`);
  }
  private counterTrade(player: Player, command: Extract<GameCommand, { type: 'counter_trade' }>): void {
    this.tradePhase();
    const trade = this.pendingTrade(command.tradeId);
    requireRule(trade.targetId === player.id, 'TRADE_TARGET_ONLY', 'Only the current recipient can counter this trade.');
    const counter = { ...trade, id: `trade-${this.state.version + 1}`, initiatorId: trade.targetId, targetId: trade.initiatorId, offer: command.offer, request: command.request, revision: (trade.revision ?? 0) + 1 };
    this.validateTrade(counter);
    trade.status = 'countered';
    this.state.trades[counter.id] = structuredClone(counter); this.state.activeTradeId = counter.id;
    this.log(`${player.name} countered a trade.`);
    this.trimTrades();
  }
  private trimTrades(): void {
    const old = Object.values(this.state.trades).filter(trade => trade.status !== 'pending').slice(0, -40);
    for (const trade of old) delete this.state.trades[trade.id];
  }
  private cancelInvalidTrades(): void {
    for (const trade of Object.values(this.state.trades)) {
      if (trade.status !== 'pending') continue;
      try { this.validateTrade(trade); } catch (error) {
        if (!(error instanceof RuleError)) throw error;
        trade.status = 'cancelled';
        if (this.state.activeTradeId === trade.id) this.state.activeTradeId = null;
      }
    }
  }
}

/** Fail closed on incompatible or corrupt snapshots; never hydrate unvalidated timer payloads. */
export function assertGameState(value: unknown): asserts value is GameState {
  const valid = (condition: unknown, message: string): void => requireRule(condition, 'INVALID_SNAPSHOT', message);
  const boundedText = (text: unknown, max = 1000): text is string => typeof text === 'string' && text.length <= max;
  valid(object(value) && value.schemaVersion === 2, 'This saved room uses an incompatible game version. Create a new room.');
  const state = value as unknown as GameState;
  valid(integer(state.version) && integer(state.turnId) && integer(state.phaseId) && boundedText(state.roomCode, 32) &&
    typeof state.gameId === 'string' && state.gameId.length >= 1 && state.gameId.length <= 128 &&
    ['lobby', 'playing', 'ended'].includes(state.state) && Array.isArray(state.players) && state.players.length <= RULES.maxPlayers &&
    object(state.properties) && object(state.trades) && object(state.phase), 'Invalid saved game structure.');
  for (const player of state.players) {
    valid(object(player) && boundedText(player.id,128) && player.id.length > 0 && boundedText(player.name,24) && player.name.length > 0 &&
      typeof player.color === 'string' && (PLAYER_COLORS as readonly string[]).includes(player.color) && boundedText(player.socketId,256) &&
      integer(player.money, -1_000_000_000) && integer(player.position, 0, RULES.boardSize - 1) &&
      ['active', 'bankrupt', 'forfeited'].includes(player.status) && typeof player.inJail === 'boolean' && integer(player.jailTurns, 0, 2) &&
      integer(player.getOutOfJailCards) && integer(player.flightChances, 0, RULES.flightChanceLimit) && typeof player.skipNextTurn === 'boolean' &&
      (!player.inJail || player.position === RULES.jailIndex) && (player.inJail || player.jailTurns === 0) && (player.connected === undefined || typeof player.connected === 'boolean') &&
      (player.disconnectedAt === undefined || integer(player.disconnectedAt)), 'Invalid saved player.');
  }
  valid(new Set(state.players.map(player => player.id)).size === state.players.length &&
    new Set(state.players.map(player => player.color)).size === state.players.length, 'Duplicate player identities or colors.');
  const playerExists = (id: unknown): id is string => typeof id === 'string' && state.players.some(player => player.id === id);
  const active = state.players.filter(player => player.status === 'active');
  const expectedProperties = BOARD_DATA.filter(square => ['property', 'railroad', 'utility'].includes(square.type));
  valid(Object.keys(state.properties).length === expectedProperties.length, 'The property catalog is incomplete.');
  for (const square of expectedProperties) {
    const property = state.properties[square.id];
    valid(object(property) && property.id === square.id && integer(property.houses, 0, square.type === 'property' ? RULES.hotelLevel : 0) &&
      typeof property.mortgaged === 'boolean' && (property.protected === undefined || typeof property.protected === 'boolean') &&
      (property.ownerId === null ? property.houses === 0 && !property.protected : active.some(player => player.id === property.ownerId)),
      'Invalid property ownership or building count.');
  }
  const dice = (values: unknown): boolean => Array.isArray(values) && values.length === 2 && values.every(die => integer(die, 1, 6));
  valid(integer(state.startingCash, RULES.minStartingCash, RULES.maxStartingCash) && integer(state.vacationJackpot) && integer(state.doublesCount, 0, 2) &&
    typeof state.extraRoll === 'boolean' && dice(state.diceValues) && integer(state.lastEventSequence) &&
    Array.isArray(state.events) && state.events.length <= 64 && Array.isArray(state.logs) && state.logs.length <= 80 && state.logs.every(log => boundedText(log)),
    'Invalid saved economics or events.');
  valid(state.hostId === null ? active.length === 0 : active.some(player => player.id === state.hostId), 'Invalid host identity.');
  valid(state.winnerId === null || playerExists(state.winnerId), 'Invalid winner identity.');
  const phase = state.phase;
  const phaseKinds = ['lobby', 'awaiting_roll', 'rolling', 'moving', 'buy', 'card', 'risk_target', 'rent', 'debt', 'flight', 'awaiting_end', 'ended'];
  valid(phaseKinds.includes(phase.kind), 'Unknown saved game phase.');
  if (state.state === 'lobby') valid(phase.kind === 'lobby' && state.turnIndex === 0 && active.length === state.players.length && state.turnDeadline === undefined && state.winnerId === null, 'Invalid lobby phase.');
  if (state.state === 'playing') {
    valid(active.length >= RULES.minPlayers && integer(state.turnIndex, 0, state.players.length - 1) && state.players[state.turnIndex].status === 'active' &&
      'playerId' in phase && phase.playerId === state.players[state.turnIndex].id && integer(state.turnDeadline) && state.winnerId === null,
      'Invalid active player or deadline.');
    const debtorId = phase.kind === 'debt' ? phase.debt?.playerId : phase.kind === 'rent' ? phase.debt?.playerId : null;
    valid(state.players.every(player => player.money >= 0 || player.id === debtorId), 'A negative balance requires a debt obligation.');
  }
  const continuationValid = (continuation: unknown): boolean => object(continuation) &&
    (continuation.kind === 'finish' || (continuation.kind === 'flight' && integer(continuation.airportId,0,55) && BOARD_DATA[continuation.airportId].type === 'railroad'));
  const cardValid = (card: unknown): boolean => object(card) && ['chest','chance','risk'].includes(card.deck as string) &&
    CARD_ACTIONS.has(card.action as string) && boundedText(card.text) && (card.amount === undefined || integer(card.amount,0,1_000_000));
  const pathValid = (movement: unknown): boolean => {
    if (!object(movement) || !integer(movement.from,0,55) || !integer(movement.to,0,55) ||
      !Array.isArray(movement.path) || movement.path.length < 1 || movement.path.length > 56 ||
      !movement.path.every(index => integer(index,0,55)) || movement.path.at(-1) !== movement.to ||
      !['forward','backward','direct'].includes(movement.direction as string) ||
      !['dice','card_forward','card_backward','flight','jail'].includes(movement.reason as string) || !integer(movement.durationMs,1,30_000)) return false;
    if (movement.direction === 'direct') return movement.path.length === 1 &&
      ((movement.reason === 'jail' && movement.to === RULES.jailIndex) ||
      (movement.reason === 'flight' && flightDestinations(movement.from).includes(movement.to)));
    if (movement.reason === 'flight' || movement.reason === 'jail') return false;
    if (movement.reason === 'card_backward' && (movement.direction !== 'backward' || movement.path.length !== 3)) return false;
    if (movement.reason === 'dice' && (movement.direction !== 'forward' || movement.path.length < 2 || movement.path.length > 12)) return false;
    if (movement.reason === 'card_forward' && (movement.direction !== 'forward' || movement.to !== 0)) return false;
    const sign = movement.direction === 'forward' ? 1 : -1;
    return movement.path.every((index,offset) => index === ((movement.from as number) + sign*(offset+1) + RULES.boardSize*2) % RULES.boardSize);
  };
  const debtValid = (debt: unknown): boolean => object(debt) && integer(debt.remaining,1) && debt.playerId === state.players[state.turnIndex]?.id &&
    state.players[state.turnIndex].money === -debt.remaining && typeof debt.toJackpot === 'boolean' && boundedText(debt.reason) &&
    (debt.creditorId === null || (playerExists(debt.creditorId) && debt.creditorId !== debt.playerId)) && continuationValid(debt.continuation);
  switch (phase.kind) {
    case 'rolling': valid(dice(phase.dice) && typeof phase.jailed === 'boolean' && phase.jailed === state.players[state.turnIndex]?.inJail, 'Invalid pending dice roll.'); break;
    case 'moving': valid(pathValid(phase) && phase.to === state.players[state.turnIndex]?.position && ['landing','finish'].includes(phase.continuation), 'Invalid pending movement.'); break;
    case 'buy': {
      const property = state.properties[phase.propertyIndex];
      valid(integer(phase.propertyIndex,0,55) && property && ['buy','upgrade'].includes(phase.mode) &&
        phase.propertyIndex === state.players[state.turnIndex]?.position && integer(phase.maxHouses,0,RULES.hotelLevel) &&
        (phase.mode === 'buy' ? property.ownerId === null : property.ownerId === phase.playerId && BOARD_DATA[property.id].type === 'property') &&
        (BOARD_DATA[property.id].type === 'property' || phase.maxHouses === 0), 'Invalid purchase decision.');
      const square = BOARD_DATA[property.id];
      const wholeGroup = BOARD_DATA.filter(other => other.colorGroup === square.colorGroup).every(other =>
        (phase.mode === 'buy' && other.id === property.id) || state.properties[other.id]?.ownerId === phase.playerId);
      const expectedMax = square.type === 'property' && !property.mortgaged ? (phase.mode === 'buy' ? RULES.initialHouseLimit : Math.max(0,(wholeGroup ? RULES.hotelLevel : RULES.maxHouses) - property.houses)) : 0;
      valid(phase.maxHouses === expectedMax, 'Invalid development quote.');
      break;
    }
    case 'card': valid(cardValid(phase.card), 'Invalid pending card.'); break;
    case 'risk_target': valid(['sabotage','protect'].includes(phase.action) && Array.isArray(phase.targets) && phase.targets.length > 0 &&
      new Set(phase.targets).size === phase.targets.length && phase.targets.every(index => integer(index,0,55) && state.properties[index] &&
        (phase.action === 'protect' ? state.properties[index].ownerId === phase.playerId && !state.properties[index].protected :
        state.properties[index].ownerId && state.properties[index].ownerId !== phase.playerId)), 'Invalid Risk target choice.'); break;
    case 'rent': valid(object(phase.payment) && phase.payment.type === 'rent' && integer(phase.payment.amount) && boundedText(phase.payment.message) &&
      phase.payment.payerId === phase.playerId && playerExists(phase.payment.payeeId) && continuationValid(phase.continuation) &&
      (phase.debt === null || debtValid(phase.debt)), 'Invalid rent presentation.'); break;
    case 'debt': valid(debtValid(phase.debt), 'Invalid saved debt obligation.'); break;
    case 'flight': valid(integer(phase.airportId,0,55) && BOARD_DATA[phase.airportId].type === 'railroad' &&
      phase.airportId === state.players[state.turnIndex]?.position && state.properties[phase.airportId].ownerId !== null &&
      Array.isArray(phase.destinations) && phase.destinations.join(',') === flightDestinations(phase.airportId).join(',') &&
      phase.ticketPrice === (state.properties[phase.airportId].ownerId === phase.playerId ? 0 : flightTicket(phase.airportId)), 'Invalid flight decision.'); break;
  }
  if (state.state === 'ended') valid(phase.kind === 'ended' && state.turnDeadline === undefined && state.winnerId === phase.winnerId &&
    active.length <= 1 && (state.winnerId === null ? active.length === 0 : active[0]?.id === state.winnerId) && boundedText(phase.reason), 'Invalid terminal result.');
  if (phase.kind === 'ended') valid(state.state === 'ended', 'An ended phase requires an ended game.');
  if (phase.kind === 'lobby') valid(state.state === 'lobby', 'A lobby phase requires a lobby.');
  const assetsValid = (assets: unknown): boolean => object(assets) && integer(assets.money,0,1_000_000_000) && integer(assets.getOutOfJailCards,0,100_000) &&
    Array.isArray(assets.properties) && assets.properties.length <= expectedProperties.length && new Set(assets.properties).size === assets.properties.length &&
    assets.properties.every(index => integer(index,0,55) && Object.hasOwn(state.properties,index));
  valid(Object.keys(state.trades).length <= 48, 'Too many retained trades.');
  for (const [id,trade] of Object.entries(state.trades)) {
    valid(object(trade) && trade.id === id && boundedText(id,128) && playerExists(trade.initiatorId) && playerExists(trade.targetId) && trade.initiatorId !== trade.targetId &&
      ['pending','accepted','rejected','countered','cancelled'].includes(trade.status) && assetsValid(trade.offer) && assetsValid(trade.request) &&
      (trade.revision === undefined || integer(trade.revision)), 'Invalid stored trade.');
  }
  valid(state.activeTradeId === null || (typeof state.activeTradeId === 'string' && Object.hasOwn(state.trades,state.activeTradeId) && state.trades[state.activeTradeId].status === 'pending'), 'Invalid active trade.');
  let previousSequence = Math.max(0,state.lastEventSequence - state.events.length);
  for (const event of state.events) {
    valid(object(event) && integer(event.sequence,1,state.lastEventSequence) && event.sequence > previousSequence &&
      event.id === `${state.gameId}:${event.sequence}` && integer(event.at) && integer(event.turnId,0,state.turnId), 'Invalid event cursor.');
    previousSequence = event.sequence;
    switch (event.type) {
      case 'movement': valid(playerExists(event.playerId) && pathValid(event), 'Invalid movement event.'); break;
      case 'dice': valid(playerExists(event.playerId) && dice(event.values), 'Invalid dice event.'); break;
      case 'payment': valid(playerExists(event.playerId) && (event.payeeId === null || playerExists(event.payeeId)) && integer(event.amount) && boundedText(event.reason), 'Invalid payment event.'); break;
      case 'notice': valid(boundedText(event.message), 'Invalid notice event.'); break;
      default: valid(false, 'Unknown event type.');
    }
  }
  valid(state.events.length === 0 ? state.lastEventSequence === 0 : previousSequence === state.lastEventSequence, 'Incomplete event cursor.');
}

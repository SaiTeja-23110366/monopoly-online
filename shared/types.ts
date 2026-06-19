export type PlayerStatus = 'active' | 'bankrupt';

export interface Player {
  id: string; // Socket ID
  name: string;
  color: string;
  money: number;
  position: number; // Index of the square (0-55)
  status: PlayerStatus;
  inJail: boolean;
  jailTurns: number;
  getOutOfJailCards: number;
  flightChances: number;
  skipNextTurn: boolean;
}

export type PropertyGroup = 
  | 'brown' | 'lightblue' | 'pink' | 'orange' | 'red' 
  | 'yellow' | 'green' | 'darkblue' | 'teal' | 'maroon' | 'gold'
  | 'railroad' | 'utility';

export interface PropertyState {
  id: number; // Square index
  ownerId: string | null; // Player ID
  houses: number; // 0-4 houses, 5 = hotel
  mortgaged: boolean;
  protected?: boolean; // Immunity from Risk cards
}

export interface TradeOffer {
  id: string; // Unique trade ID
  initiatorId: string;
  targetId: string;
  offer: {
    money: number;
    properties: number[]; // Square indices
    getOutOfJailCards: number;
  };
  request: {
    money: number;
    properties: number[]; // Square indices
    getOutOfJailCards: number;
  };
  status: 'pending' | 'accepted' | 'rejected' | 'countered';
}

export interface ActiveCard {
  deck: 'chest' | 'chance' | 'risk';
  text: string;
  action: string;
  amount?: number;
}

export interface GameState {
  roomCode: string;
  state: 'lobby' | 'playing' | 'ended';
  players: Player[];
  turnIndex: number;
  properties: Record<number, PropertyState>;
  trades: Record<string, TradeOffer>;
  logs: string[]; // Activity log
  diceValues: [number, number];
  doublesCount: number; // For rolling 3 doubles = jail
  hasRolled: boolean; // Tracks if the current player has rolled the dice
  awaitingBuyDecision: number | null; // Square index if waiting for a player to buy an unowned property
  awaitingDebtResolution?: string | null;
  awaitingFlightDecision?: number | null;
  startingCash: number; // Configurable starting cash
  activeTradeId: string | null; // For modal popups
  vacationJackpot: number;
  
  // Card Mechanics
  activeCard: ActiveCard | null;
  awaitingSabotage: boolean; // True when a player needs to click a property to destroy
  awaitingProtection: boolean; // True when a player needs to click a property to protect
}

// Socket Events
export interface ClientToServerEvents {
  create_room: (callback: (response: { roomCode: string }) => void) => void;
  join_room: (roomCode: string, playerName: string, color: string) => void;
  start_game: (roomCode: string) => void;
  change_color: (roomCode: string, newColor: string) => void;
  update_starting_cash: (roomCode: string, cash: number) => void;
  roll_dice: (roomCode: string) => void;
  acknowledge_card: (roomCode: string) => void;
  execute_sabotage: (roomCode: string, propertyIndex: number) => void;
  execute_protection: (roomCode: string, propertyIndex: number) => void;
  end_turn: (roomCode: string) => void;
  buy_property: (roomCode: string, propertyIndex: number, housesToBuy: number) => void;
  upgrade_property: (roomCode: string, propertyIndex: number, housesToBuy: number) => void;
  pass_property: (roomCode: string) => void;
  sell_property_to_bank: (roomCode: string, propertyIndex: number) => void;
  buy_house: (roomCode: string, propertyIndex: number) => void;
  pay_jail_fine: (roomCode: string) => void;
  use_jail_card: (roomCode: string) => void;
  flight_decision: (roomCode: string, destinationIndex: number | null) => void;
  
  // Trading
  propose_trade: (roomCode: string, trade: Omit<TradeOffer, 'id' | 'status'>) => void;
  accept_trade: (roomCode: string, tradeId: string) => void;
  reject_trade: (roomCode: string, tradeId: string) => void;
  counter_trade: (roomCode: string, tradeId: string, newOffer: TradeOffer['offer'], newRequest: TradeOffer['request']) => void;
}

export interface ServerToClientEvents {
  game_state_update: (state: GameState) => void;
  error: (message: string) => void;
  trade_received: (trade: TradeOffer) => void;
}

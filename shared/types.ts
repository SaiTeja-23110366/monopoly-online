export type PlayerStatus = 'active' | 'bankrupt' | 'forfeited';
export interface Player {
  id: string;
  socketId: string;
  name: string;
  color: string;
  money: number;
  position: number;
  status: PlayerStatus;
  inJail: boolean;
  jailTurns: number;
  getOutOfJailCards: number;
  flightChances: number;
  skipNextTurn: boolean;
  connected?: boolean;
  disconnectedAt?: number;
}
export type PropertyGroup = 'brown' | 'lightblue' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' |
  'darkblue' | 'purple' | 'teal' | 'maroon' | 'gold' | 'railroad' | 'utility';
export interface PropertyState {
  id: number;
  ownerId: string | null;
  houses: number;
  mortgaged: boolean;
  protected?: boolean;
}
export interface TradeAssets { money: number; properties: number[]; getOutOfJailCards: number; }
export interface TradeOffer {
  id: string;
  initiatorId: string;
  targetId: string;
  offer: TradeAssets;
  request: TradeAssets;
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'cancelled';
  revision?: number;
}
export type CardDeck = 'chest' | 'chance' | 'risk';
export type CardAction = 'get_out_of_jail' | 'add_money' | 'deduct_money' | 'go_to_start' | 'go_to_jail' |
  'go_back_3' | 'market_crash' | 'lose_property' | 'transfer_property' | 'sabotage' | 'protect';
export interface ActiveCard { deck: CardDeck; text: string; action: CardAction; amount?: number; }
export type MovementReason = 'dice' | 'card_forward' | 'card_backward' | 'flight' | 'jail';
export type LandingContinuation = { kind: 'finish' } | { kind: 'flight'; airportId: number };
export interface DebtRecord {
  playerId: string;
  creditorId: string | null;
  toJackpot: boolean;
  remaining: number;
  reason: string;
  continuation: LandingContinuation;
}
export interface PaymentPresentation {
  type: 'rent'; message: string; amount: number; payerId?: string; payeeId?: string;
}
/** Exactly one phase authorizes actions. Legacy booleans below are derived display fields only. */
export type GamePhase =
  | { kind: 'lobby' }
  | { kind: 'awaiting_roll'; playerId: string }
  | { kind: 'rolling'; playerId: string; dice: [number, number]; jailed: boolean }
  | { kind: 'moving'; playerId: string; from: number; to: number; path: number[]; direction: 'forward' | 'backward' | 'direct'; reason: MovementReason; durationMs: number; continuation: 'landing' | 'finish' }
  | { kind: 'buy'; playerId: string; propertyIndex: number; mode: 'buy' | 'upgrade'; maxHouses: number }
  | { kind: 'card'; playerId: string; card: ActiveCard }
  | { kind: 'risk_target'; playerId: string; action: 'sabotage' | 'protect'; targets: number[] }
  | { kind: 'rent'; playerId: string; payment: PaymentPresentation; debt: DebtRecord | null; continuation: LandingContinuation }
  | { kind: 'debt'; playerId: string; debt: DebtRecord }
  | { kind: 'flight'; playerId: string; airportId: number; destinations: number[]; ticketPrice: number }
  | { kind: 'awaiting_end'; playerId: string }
  | { kind: 'ended'; winnerId: string | null; reason: string };
export type GameEvent = {
  sequence: number; id: string; at: number; turnId: number;
} & (
  | { type: 'movement'; playerId: string; from: number; to: number; path: number[]; direction: 'forward' | 'backward' | 'direct'; reason: MovementReason; durationMs: number }
  | { type: 'dice'; playerId: string; values: [number, number] }
  | { type: 'payment'; playerId: string; payeeId: string | null; amount: number; reason: string }
  | { type: 'notice'; message: string }
);
export interface GameState {
  schemaVersion: 2;
  gameId: string;
  version: number;
  roomCode: string;
  state: 'lobby' | 'playing' | 'ended';
  hostId: string | null;
  winnerId: string | null;
  players: Player[];
  turnIndex: number;
  turnId: number;
  phaseId: number;
  phase: GamePhase;
  extraRoll: boolean;
  properties: Record<number, PropertyState>;
  trades: Record<string, TradeOffer>;
  logs: string[];
  diceValues: [number, number];
  doublesCount: number;
  hasRolled: boolean;
  awaitingBuyDecision: number | null;
  awaitingDebtResolution?: string | null;
  awaitingFlightDecision?: number | null;
  startingCash: number;
  activeTradeId: string | null;
  vacationJackpot: number;
  activeCard: ActiveCard | null;
  awaitingSabotage: boolean;
  awaitingProtection: boolean;
  turnDeadline?: number;
  activeAnimation?: PaymentPresentation | null;
  isAnimatingMovement?: boolean;
  isRollingDice?: boolean;
  events: GameEvent[];
  lastEventSequence: number;
}
export type GameCommand =
  | { type: 'start_game' }
  | { type: 'change_color'; color: string }
  | { type: 'update_starting_cash'; cash: number }
  | { type: 'roll_dice' }
  | { type: 'end_turn' }
  | { type: 'buy_property'; propertyIndex: number; housesToBuy: number }
  | { type: 'upgrade_property'; propertyIndex: number; housesToBuy: number }
  | { type: 'pass_property' }
  | { type: 'sell_property_to_bank'; propertyIndex: number }
  | { type: 'pay_jail_fine' }
  | { type: 'use_jail_card' }
  | { type: 'acknowledge_card' }
  | { type: 'execute_sabotage'; propertyIndex: number }
  | { type: 'execute_protection'; propertyIndex: number }
  | { type: 'flight_decision'; destinationIndex: number | null }
  | { type: 'propose_trade'; targetId: string; offer: TradeAssets; request: TradeAssets }
  | { type: 'accept_trade'; tradeId: string }
  | { type: 'reject_trade'; tradeId: string }
  | { type: 'counter_trade'; tradeId: string; offer: TradeAssets; request: TradeAssets }
  | { type: 'declare_bankruptcy' }
  | { type: 'leave_game' }
  | { type: 'timeout'; turnId: number; phaseId: number };
export interface CommandError { code: string; message: string; retryable?: boolean; }
export type CommandResult = { ok: true; state: GameState; events: GameEvent[] } |
  { ok: false; state: GameState; error: CommandError };
export interface CommandEnvelope {
  gameId: string;
  commandId: string;
  expectedVersion?: number;
  expectedTurnId?: number;
  command: GameCommand;
}
export interface CommandAck { commandId: string; ok: boolean; version: number; error?: CommandError; state?: GameState; }

export type { ClientEvents as ClientToServerEvents, ServerEvents as ServerToClientEvents } from './protocol';

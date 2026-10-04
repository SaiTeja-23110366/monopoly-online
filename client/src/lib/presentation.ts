import type { GameEvent, GameState, PropertyState } from '../../../shared/types';

export interface PresentationState {
  positions: Record<string, number>;
  balances: Record<string, number>;
  properties: Record<number, PropertyState>;
  vacationJackpot: number;
  highlightedProperties: number[];
  dice: [number, number];
  rolling: boolean;
  busy: boolean;
  movingPlayer: string | null;
  movementKind: string | null;
  stepDuration: number;
  announcement: string;
  sequence: number;
}
export const initialPresentation = (): PresentationState => ({ positions: {}, balances: {}, properties: {}, vacationJackpot: 0, highlightedProperties: [], dice: [1, 1], rolling: false,
  busy: false, movingPlayer: null, movementKind: null, stepDuration: 0, announcement: '', sequence: 0 });

/** Presentation consumes durable events; it never sends gameplay acknowledgements or changes truth. */
export class PresentationDirector {
  private state = initialPresentation();
  private listeners = new Set<() => void>();
  private queue: GameEvent[] = [];
  private received = 0;
  private latest: GameState | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reduced = false;
  private feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  private room = '';
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getSnapshot = () => this.state;
  private update(change: Partial<PresentationState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach(listener => listener());
  }
  setReduced(reduced: boolean) { this.reduced = reduced; if (reduced && this.latest) this.snap(this.latest); }
  dispose() { clearTimeout(this.timer); clearTimeout(this.feedbackTimer); this.queue = []; }
  private snap(state: GameState) {
    this.dispose();
    this.received = state.lastEventSequence;
    this.update({ ...initialPresentation(), positions: Object.fromEntries(state.players.map(player => [player.id, player.position])),
      ...this.finances(state), dice: state.diceValues, sequence: state.lastEventSequence });
  }
  private finances(state: GameState) {
    return { balances: Object.fromEntries(state.players.map(player => [player.id, player.money])), properties: state.properties || {}, vacationJackpot: state.vacationJackpot || 0 };
  }
  private settleFinances() {
    if (!this.latest) return;
    const highlightedProperties = Object.values(this.latest.properties || {}).filter(property => {
      const before = this.state.properties[property.id];
      return before && (before.ownerId !== property.ownerId || before.houses !== property.houses || before.protected !== property.protected);
    }).map(property => property.id);
    this.update({ ...this.finances(this.latest), ...(highlightedProperties.length ? { highlightedProperties } : {}) });
    if (highlightedProperties.length) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = setTimeout(() => this.update({ highlightedProperties: [] }), 1500);
    }
  }
  receive(state: GameState, reset = false, hidden = false) {
    this.latest = state;
    const fresh = state.events.filter(event => event.sequence > this.received).sort((a,b) => a.sequence - b.sequence);
    const gap = fresh.length > 0 && fresh[0].sequence > this.received + 1;
    if (reset || hidden || this.reduced || this.room !== state.gameId || gap || fresh.length > 16) {
      this.room = state.gameId;
      this.snap(state);
      return;
    }
    const positions = { ...this.state.positions };
    state.players.forEach(player => { if (!(player.id in positions)) positions[player.id] = player.position; });
    this.update({ positions });
    if (fresh.length) {
      this.received = fresh[fresh.length - 1].sequence;
      this.queue.push(...fresh);
      if (!this.state.busy) this.next();
    } else if (!this.state.busy) {
      this.update({ positions: Object.fromEntries(state.players.map(player => [player.id, player.position])), dice: state.diceValues });
      this.settleFinances();
    }
  }
  catchUp() { if (this.latest) this.snap(this.latest); }
  private later(callback: () => void, duration: number) { this.timer = setTimeout(callback, duration); }
  private next = () => {
    const event = this.queue.shift();
    if (!event) {
      this.settleFinances();
      this.update({ busy: false, rolling: false, movingPlayer: null, movementKind: null, stepDuration: 0,
        positions: this.latest ? Object.fromEntries(this.latest.players.map(player => [player.id, player.position])) : this.state.positions });
      return;
    }
    this.update({ busy: true, sequence: event.sequence, rolling: false, movingPlayer: null, movementKind: null });
    if (event.type === 'dice') {
      this.update({ rolling: true, dice: event.values, announcement: `Rolled ${event.values[0]} and ${event.values[1]}` });
      this.later(() => { this.update({ rolling: false }); this.next(); }, 720);
    } else if (event.type === 'movement') {
      const path = event.direction === 'direct' ? [event.to] : event.path;
      const duration = event.direction === 'direct' ? (event.reason === 'flight' ? 700 : 450) : Math.max(120, Math.min(180, event.durationMs / Math.max(path.length, 1)));
      this.update({ positions: { ...this.state.positions, [event.playerId]: event.from }, movingPlayer: event.playerId,
        movementKind: event.reason, stepDuration: duration, announcement: event.reason === 'flight' ? 'Taking a flight' : event.reason === 'jail' ? 'Going to jail' : event.reason === 'card_backward' ? 'Moving back three spaces' : 'Moving around the board' });
      let step = 0;
      const move = () => {
        if (step >= path.length) { this.next(); return; }
        this.update({ positions: { ...this.state.positions, [event.playerId]: path[step++] } });
        this.later(move, duration);
      };
      this.later(move, 35);
    } else if (event.type === 'payment') {
      const payer = this.latest?.players.find(player => player.id === event.playerId)?.name || 'Player';
      const recipient = event.payeeId ? this.latest?.players.find(player => player.id === event.payeeId)?.name || 'player' : 'the bank';
      this.update({ announcement: `${payer} → ${recipient}: $${event.amount.toLocaleString('en-US')} · ${event.reason}` });
      this.later(this.next, 650);
    } else {
      this.update({ announcement: event.message });
      this.later(this.next, 300);
    }
  };
}

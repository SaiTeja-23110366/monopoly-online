import type { CommandEnvelope, GameCommand, GameState, CommandAck } from '../../../shared/types';
import type { PlayerProfile, SessionAck, SessionCredentials, ProtocolError, ClientEvents, ServerEvents } from '../../../shared/protocol';
import type { Socket } from 'socket.io-client';
import { PresentationDirector } from './presentation.ts';
import { terminalResumeError, retryStrategy, validSnapshot, afterDisconnect } from './sessionRules.ts';

const STORAGE_KEY = 'monopoly_session_v2';
const ADMISSION_KEY = 'monopoly_admission_v2';
interface PendingAdmission { profile: PlayerProfile; roomCode?: string; admissionSecret: string; }
function readStored(key: string): unknown {
  let tab: string | null = null;
  try { tab = sessionStorage.getItem(key); } catch { /* Try the browser-wide fallback. */ }
  if (tab !== null) { try { return JSON.parse(tab); } catch { return null; } }
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function readSession(): SessionCredentials | null {
  const value = readStored(STORAGE_KEY) as SessionCredentials | null;
  return value && typeof value.roomCode === 'string' && typeof value.playerId === 'string' && typeof value.resumeSecret === 'string' ? value : null;
}
function readAdmission(): PendingAdmission | null {
  const value = readStored(ADMISSION_KEY) as PendingAdmission | null;
  return value && typeof value.admissionSecret === 'string' && typeof value.profile?.name === 'string' && typeof value.profile?.color === 'string' ? value : null;
}
function randomProof() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
/** Write independently: a denied tab store must not prevent the browser-wide fallback. */
function saveBoth(key: string, value: unknown): boolean {
  let saved = false;
  const encoded = JSON.stringify(value);
  try { sessionStorage.setItem(key, encoded); saved = true; } catch { /* Try the second supported store. */ }
  try { localStorage.setItem(key, encoded); saved = true; } catch { /* The per-tab copy may still be valid. */ }
  return saved;
}
export interface SessionState {
  game: GameState | null;
  credentials: SessionCredentials | null;
  connection: 'connecting' | 'ready' | 'reconnecting' | 'resuming' | 'replaced';
  pending: string | null;
  error: string | null;
  retryable: boolean;
  serverOffset: number;
}
export class GameSession {
  private readonly socket: Socket<ServerEvents, ClientEvents>;
  constructor(socket: Socket<ServerEvents, ClientEvents>) { this.socket = socket; }
  presentation = new PresentationDirector();
  private listeners = new Set<() => void>();
  private pendingEnvelope: CommandEnvelope | null = null;
  private authenticationAttempt = 0;
  private pendingEntry: PendingAdmission | null = readAdmission();
  private state: SessionState = { game: null, credentials: readSession(), connection: 'connecting', pending: null,
    error: null, retryable: false, serverOffset: 0 };
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getSnapshot = () => this.state;
  private update(change: Partial<SessionState>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  private clearAdmission() {
    const secret = this.pendingEntry?.admissionSecret;
    this.pendingEntry = null;
    try { sessionStorage.setItem(ADMISSION_KEY, 'null'); } catch { /* The in-memory request is cleared. */ }
    try {
      const saved = JSON.parse(localStorage.getItem(ADMISSION_KEY) || 'null') as PendingAdmission | null;
      if (!saved || saved.admissionSecret === secret) localStorage.removeItem(ADMISSION_KEY);
    } catch { /* A later authenticated resume still wins over pending admission. */ }
  }
  private clearSession(preserveOtherTab = false) {
    try { sessionStorage.setItem(STORAGE_KEY, 'null'); } catch { /* Leave still revokes the server credential. */ }
    if (preserveOtherTab) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as SessionCredentials | null;
      if (!saved || saved.playerId === this.state.credentials?.playerId) localStorage.removeItem(STORAGE_KEY);
    } catch { /* A revoked credential cannot authenticate on reload. */ }
  }
  private receive = (game: GameState, reset = false) => {
    if (!this.state.credentials || game.roomCode !== this.state.credentials.roomCode) return;
    if (!validSnapshot(this.state.game, game, reset)) return;
    this.presentation.receive(game, reset, document.hidden);
    this.update({ game });
  };
  private acceptSession = (result: SessionAck, resuming = false) => {
    if (!result.ok) {
      const expired = terminalResumeError(result.error.code);
      if (expired) { this.clearSession(); this.pendingEnvelope = null; this.presentation.dispose(); this.update({ credentials: null, game: null }); }
      if (!result.error.retryable) this.clearAdmission();
      this.update({ connection: resuming && !expired ? 'reconnecting' : 'ready', pending: result.error.retryable ? 'Awaiting confirmation' : null,
        error: result.error.message, retryable: !!result.error.retryable || (resuming && !expired) });
      return;
    }
    const saved = saveBoth(STORAGE_KEY, result.session);
    if (saved) this.clearAdmission();
    this.update({ credentials: result.session, connection: 'ready', pending: null, retryable: false,
      error: saved ? null : 'Your browser could not save this seat. Keep this tab open; your earlier admission can still recover it if saved.', serverOffset: result.serverTime - Date.now() });
    this.receive(result.state, true);
    if (this.pendingEnvelope) this.transmit(this.pendingEnvelope);
  };
  private connected = () => {
    if (this.state.connection === 'replaced') return;
    const credentials = this.state.credentials;
    if (!credentials) {
      this.update({ connection: 'ready' });
      if (this.pendingEntry) this.transmitEntry();
      return;
    }
    this.update({ connection: 'resuming' });
    const attempt = ++this.authenticationAttempt;
    this.socket.timeout(9000).emit('resume_session', credentials, (error: Error | null, result: SessionAck) => {
      if (attempt !== this.authenticationAttempt) return;
      if (error) this.update({ connection: 'reconnecting', error: 'Could not restore your seat yet. Retry when your connection is back.', retryable: true });
      else this.acceptSession(result, true);
    });
  };
  private disconnected = () => { this.authenticationAttempt++; this.update({ connection: afterDisconnect(this.state.connection) }); };
  private replaced = ({ message }: { message: string }) => {
    this.authenticationAttempt++;
    this.pendingEnvelope = null;
    this.clearSession(true);
    this.clearAdmission();
    this.update({ connection: 'replaced', pending: null, error: message, retryable: false });
  };
  private connectError = (error: Error) => {
    if (this.state.connection === 'replaced') return;
    const detail = error.message && error.message !== 'xhr poll error' && error.message !== 'websocket error' ? ` ${error.message.slice(0, 160)}` : '';
    this.update({ connection: 'reconnecting', error: `Unable to connect to the game server.${detail} Please retry.`, retryable: true });
  };
  private protocolError = (error: ProtocolError) => this.update({ error: error.message, retryable: !!error.retryable });
  private closed = ({ roomCode, reason }: { roomCode: string; reason: string }) => {
    if (roomCode !== this.state.credentials?.roomCode) return;
    this.authenticationAttempt++; this.pendingEnvelope = null; this.clearAdmission(); this.clearSession(); this.presentation.dispose();
    this.update({ game: null, credentials: null, pending: null, error: reason, connection: 'ready', retryable: false });
  };
  private visibility = () => { this.presentation.catchUp(); };
  mount() {
    this.socket.on('connect', this.connected); this.socket.on('connect_error', this.connectError); this.socket.on('disconnect', this.disconnected);
    this.socket.on('game_state_update', this.receive); this.socket.on('session_replaced', this.replaced);
    this.socket.on('protocol_error', this.protocolError); this.socket.on('room_closed', this.closed);
    document.addEventListener('visibilitychange', this.visibility);
    this.socket.connect();
    return () => {
      this.socket.off('connect', this.connected); this.socket.off('connect_error', this.connectError); this.socket.off('disconnect', this.disconnected);
      this.socket.off('game_state_update', this.receive); this.socket.off('session_replaced', this.replaced);
      this.socket.off('protocol_error', this.protocolError); this.socket.off('room_closed', this.closed);
      document.removeEventListener('visibilitychange', this.visibility);
      this.socket.disconnect(); this.presentation.dispose();
    };
  }
  enter = (profile: PlayerProfile, roomCode?: string) => {
    if (this.state.pending || this.state.connection !== 'ready') return;
    this.pendingEntry = { profile, roomCode, admissionSecret: randomProof() };
    if (!saveBoth(ADMISSION_KEY, this.pendingEntry)) {
      this.pendingEntry = null;
      this.update({ error: 'Allow site storage in this browser before joining, so your seat can be recovered if the connection drops.', retryable: false });
      return;
    }
    this.transmitEntry();
  };
  private transmitEntry = () => {
    if (!this.pendingEntry) return;
    const { profile, roomCode, admissionSecret } = this.pendingEntry;
    this.update({ pending: roomCode ? 'Joining table' : 'Creating table', error: null });
    const attempt = ++this.authenticationAttempt;
    const callback = (error: Error | null, result: SessionAck) => {
      if (attempt !== this.authenticationAttempt) return;
      if (error) this.update({ pending: 'Awaiting confirmation', error: 'The table did not confirm your request. Retry safely to recover the same seat.', retryable: true });
      else this.acceptSession(result);
    };
    if (roomCode) this.socket.timeout(9000).emit('join_room', { ...profile, roomCode, admissionSecret }, callback);
    else this.socket.timeout(9000).emit('create_room', { ...profile, admissionSecret }, callback);
  };
  command = (command: GameCommand) => {
    if (!this.state.game || this.state.connection !== 'ready' || this.state.pending) return;
    const envelope: CommandEnvelope = { commandId: crypto.randomUUID(), gameId: this.state.game.gameId, expectedVersion: this.state.game.version,
      expectedTurnId: this.state.game.turnId, command };
    this.pendingEnvelope = envelope;
    this.transmit(envelope);
  };
  private transmit = (envelope: CommandEnvelope) => {
    this.update({ pending: envelope.command.type, error: null, retryable: false });
    this.socket.timeout(9000).emit('game_command', envelope, (error: Error | null, result: CommandAck) => {
      if (this.pendingEnvelope?.commandId !== envelope.commandId) return;
      if (error) { this.update({ pending: 'Awaiting confirmation', error: 'Waiting for confirmation. Retry safely to check whether your action went through.', retryable: true }); return; }
      if (result.state) this.receive(result.state);
      if (!result.ok && result.error && 'retryable' in result.error && result.error.retryable === true) { this.update({ pending: 'Awaiting confirmation', error: result.error.message, retryable: true }); return; }
      this.pendingEnvelope = null;
      this.update({ pending: null, error: result.ok ? null : result.error?.message || 'That action is not available now.', retryable: false });
      if (result.ok && envelope.command.type === 'leave_game') {
        this.clearSession(); this.presentation.catchUp(); this.update({ game: null, credentials: null });
      }
    });
  };
  retry = () => {
    const strategy = retryStrategy(this.state.connection, this.socket.connected, !!this.pendingEnvelope, !!this.state.credentials);
    if (strategy === 'none') return;
    if (this.socket.connected && this.pendingEntry && !this.state.credentials) { this.transmitEntry(); return; }
    if (strategy === 'connect') { this.socket.connect(); return; }
    if (strategy === 'command' && this.pendingEnvelope) { this.transmit(this.pendingEnvelope); return; }
    if (strategy === 'resume') { this.connected(); return; }
    this.update({ error: null, retryable: false });
  };
  dismissError = () => { if (!this.state.retryable) this.update({ error: null }); };
  forgetSeat = () => {
    this.pendingEnvelope = null; this.clearAdmission(); this.clearSession(this.state.connection === 'replaced');
    this.update({ game: null, credentials: null, pending: null, error: null, retryable: false, connection: 'connecting' });
    this.socket.disconnect().connect();
  };
}

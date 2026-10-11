import { EventEmitter } from 'node:events';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { MonopolyGame, assertGameState, migrateSavedFlightDecision } from './gameState';
import { PLAYER_COLORS, RULES } from '../../shared/board';
import type { CommandAck, CommandEnvelope, GameCommand, GameState } from '../../shared/types';
import type { AdmissionProfile, SessionAck, SessionCredentials } from '../../shared/protocol';
import { type RoomRecord, type RoomStore, StorageError } from './roomStore';

export class ProtocolFailure extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) { super(message); }
}
export interface RoomManagerOptions {
  store: RoomStore;
  now?: () => number;
  gameFactory?: (code: string) => MonopolyGame;
  roomTtlMs?: number;
  hostGraceMs?: number;
  maxRooms?: number;
  scheduleTimers?: boolean;
}
interface CachedRoom { game: MonopolyGame; record: RoomRecord }
const MAX_RECEIPTS = 512;
const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function normalizeRoomCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z2-9]{6}$/.test(value.trim().toUpperCase())) throw new ProtocolFailure('INVALID_ROOM', 'Enter a valid six-character room code.');
  return value.trim().toUpperCase();
}
function profile(value: unknown): AdmissionProfile {
  if (!isObject(value) || typeof value.name !== 'string' || typeof value.color !== 'string') throw new ProtocolFailure('INVALID_PROFILE', 'Enter a name and choose a token color.');
  const name = value.name.trim();
  if (name.length < 1 || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) throw new ProtocolFailure('INVALID_NAME', 'Names must contain 1–24 readable characters.');
  if (!(PLAYER_COLORS as readonly string[]).includes(value.color)) throw new ProtocolFailure('INVALID_COLOR', 'Choose an available token color.');
  if (typeof value.admissionSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.admissionSecret)) throw new ProtocolFailure('INVALID_ADMISSION', 'A private admission token is required. Refresh and try again.');
  return { name, color: value.color, admissionSecret: value.admissionSecret };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function envelope(value: unknown): CommandEnvelope {
  if (!isObject(value) || typeof value.gameId !== 'string' || value.gameId.length > 100 || typeof value.commandId !== 'string' || !/^[A-Za-z0-9:_-]{8,100}$/.test(value.commandId) || !isObject(value.command) || typeof value.command.type !== 'string') throw new ProtocolFailure('INVALID_COMMAND', 'The command format is invalid.');
  if (JSON.stringify(value).length > 8192) throw new ProtocolFailure('INVALID_COMMAND', 'The command is too large.');
  if (value.expectedVersion === undefined) throw new ProtocolFailure('INVALID_COMMAND', 'A current game version is required.');
  for (const field of ['expectedVersion', 'expectedTurnId'] as const) {
    if (value[field] !== undefined && (!Number.isSafeInteger(value[field]) || (value[field] as number) < 0)) throw new ProtocolFailure('INVALID_COMMAND', 'The command version is invalid.');
  }
  if (value.command.type === 'timeout') throw new ProtocolFailure('FORBIDDEN', 'Only the server can advance expired phases.');
  return value as unknown as CommandEnvelope;
}
function validateRecord(value: unknown, code: string): asserts value is RoomRecord {
  if (!isObject(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.storageVersion) || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt) || !isObject(value.sessions) || !Array.isArray(value.receipts) || value.receipts.length > MAX_RECEIPTS) throw new ProtocolFailure('INVALID_SNAPSHOT', 'This room uses an unsupported or invalid saved format.');
  migrateSavedFlightDecision(value.state);
  assertGameState(value.state);
  if (value.state.roomCode !== code) throw new ProtocolFailure('INVALID_SNAPSHOT', 'The saved room identifier is invalid.');
  for (const [id, session] of Object.entries(value.sessions)) {
    if (!isObject(session) || typeof session.secretHash !== 'string' || !/^[a-f0-9]{64}$/.test(session.secretHash) || !value.state.players.some(p => p.id === id) || (session.disconnectedAt !== null && !Number.isSafeInteger(session.disconnectedAt))) throw new ProtocolFailure('INVALID_SNAPSHOT', 'The saved room membership is invalid.');
    if ((session.admissionHash !== undefined || session.admissionFingerprint !== undefined) && (typeof session.admissionHash !== 'string' || !/^[a-f0-9]{64}$/.test(session.admissionHash) || typeof session.admissionFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(session.admissionFingerprint))) throw new ProtocolFailure('INVALID_SNAPSHOT', 'The saved admission proof is invalid.');
  }
  for (const receipt of value.receipts) {
    if (!isObject(receipt) || typeof receipt.actorId !== 'string' || typeof receipt.commandId !== 'string' || typeof receipt.fingerprint !== 'string' || !isObject(receipt.ack) || typeof receipt.ack.ok !== 'boolean' || !Number.isSafeInteger(receipt.ack.version)) throw new ProtocolFailure('INVALID_SNAPSHOT', 'The saved room commands are invalid.');
  }
}

export class RoomManager extends EventEmitter {
  private readonly store: RoomStore;
  private readonly now: () => number;
  private readonly gameFactory: (code: string) => MonopolyGame;
  private readonly roomTtlMs: number;
  private readonly hostGraceMs: number;
  private readonly maxRooms: number;
  private readonly scheduleTimers: boolean;
  private rooms = new Map<string, CachedRoom>();
  private dirtyRooms = new Set<string>();
  private admissionIndex = new Map<string, { code: string; playerId: string; fingerprint: string }>();
  private pendingAdmissions = new Map<string, { kind: string; request: string; session: SessionCredentials }>();
  private queues = new Map<string, Promise<unknown>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private activeSockets = new Map<string, string>();
  private pendingDisconnects = new Map<string, { code: string; playerId: string; at: number }>();
  private closing = false;
  private started = false;
  constructor(options: RoomManagerOptions) {
    super(); this.store = options.store; this.now = options.now ?? Date.now;
    this.gameFactory = options.gameFactory ?? (code => new MonopolyGame(code, { now: this.now }));
    this.roomTtlMs = options.roomTtlMs ?? 24 * 60 * 60 * 1000;
    this.hostGraceMs = options.hostGraceMs ?? 30_000;
    this.maxRooms = options.maxRooms ?? 500;
    this.scheduleTimers = options.scheduleTimers !== false;
    if (!Number.isInteger(this.maxRooms) || this.maxRooms < 1 || this.maxRooms > 10_000 || !Number.isFinite(this.hostGraceMs) || this.hostGraceMs < 0 || !Number.isFinite(this.roomTtlMs) || this.roomTtlMs < 1000 || this.roomTtlMs > 7 * 86400_000) throw new Error('Invalid room capacity, TTL, or host grace settings');
  }
  async start() {
    await this.store.start();
    try {
      const codes = await this.store.list();
      if (codes.length > this.maxRooms) throw new StorageError('Saved rooms exceed MAX_ROOMS. Increase the configured capacity before starting.');
      for (const code of codes) {
        await this.serial(code, async () => {
          try { await this.load(code); }
          catch (error) { if (error instanceof StorageError) throw error; this.emit('room_error', code, 'INVALID_SNAPSHOT'); }
        });
      }
      this.started = true;
    } catch (error) { await this.store.close(); throw error; }
  }
  healthy() { return this.started && !this.closing && this.store.healthy(); }
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.queues.set(key, current);
    void current.finally(() => { if (this.queues.get(key) === current) this.queues.delete(key); }).catch(() => undefined);
    return current;
  }
  private checkReady() { if (this.closing || !this.store.healthy()) throw new StorageError(); }
  private seat(code: string, playerId: string) { return `${code}:${playerId}`; }
  private snapshot(game: MonopolyGame): GameState {
    const state = structuredClone(game.state);
    for (const player of state.players) player.socketId = '';
    return state;
  }
  private async load(code: string): Promise<CachedRoom> {
    this.checkReady();
    const cached = this.rooms.get(code);
    if (cached && !this.dirtyRooms.has(code) && cached.record.expiresAt > this.now()) return cached;
    if (cached && cached.record.expiresAt <= this.now()) { await this.expire(code, cached); throw new ProtocolFailure('ROOM_EXPIRED', 'This room has expired. Create a new game.'); }
    const raw = await this.store.load(code);
    if (!raw) { if (cached) { this.evict(code); this.emit('room_closed', code, 'This room has closed or expired.'); } throw new ProtocolFailure('ROOM_NOT_FOUND', 'This room was not found or has expired.'); }
    try { validateRecord(raw, code); } catch (error) { throw error instanceof ProtocolFailure ? error : new ProtocolFailure('INVALID_SNAPSHOT', 'The saved room is invalid. Create a new game.'); }
    if (raw.expiresAt <= this.now()) { await this.store.delete(code, raw.storageVersion); throw new ProtocolFailure('ROOM_EXPIRED', 'This room has expired.'); }
    if (cached) {
      const game = cached.game.fork(); game.state = structuredClone(raw.state);
      const room = { game, record: raw }; this.rooms.set(code, room); this.indexAdmissions(code, raw); this.dirtyRooms.delete(code); this.schedule(code, room);
      if (raw.storageVersion !== cached.record.storageVersion) this.emit('game_update', code, this.snapshot(game));
      return room;
    }
    if (this.rooms.size >= this.maxRooms) throw new ProtocolFailure('CAPACITY', 'The server is at capacity. Please try later.', true);
    const game = this.gameFactory(code); game.state = structuredClone(raw.state);
    let presenceChanged = false;
    for (const player of game.state.players) {
      if (player.connected || player.socketId) presenceChanged = true;
      player.connected = false; player.socketId = '';
      const session = raw.sessions[player.id];
      if (session && session.disconnectedAt === null) { session.disconnectedAt = this.now(); presenceChanged = true; }
      if (session) player.disconnectedAt = session.disconnectedAt ?? undefined;
    }
    if (presenceChanged) {
      game.state.version++;
      const record = { ...raw, state: this.snapshot(game), storageVersion: raw.storageVersion + 1 };
      await this.store.save(code, record, raw.storageVersion); raw.storageVersion = record.storageVersion; raw.state = record.state;
    }
    const room = { game, record: raw }; this.rooms.set(code, room); this.indexAdmissions(code, raw); this.schedule(code, room);
    return room;
  }
  private async commit(code: string, current: CachedRoom, game: MonopolyGame, record = structuredClone(current.record), publish = true) {
    record.state = this.snapshot(game); record.storageVersion = current.record.storageVersion + 1;
    try { await this.store.save(code, record, current.record.storageVersion); }
    catch (error) {
      // A lost response does not prove a failed write. Confirm the exact durable candidate.
      this.dirtyRooms.add(code);
      let confirmed = false;
      try { const saved = await this.store.load(code); confirmed = saved !== null && JSON.stringify(saved) === JSON.stringify(record); } catch { /* retry reads before the next mutation */ }
      if (!confirmed) throw error;
    }
    this.dirtyRooms.delete(code);
    const next = { game, record }; this.rooms.set(code, next); this.indexAdmissions(code, record); this.schedule(code, next);
    if (publish) this.emit('game_update', code, this.snapshot(game));
    return next;
  }
  private chooseColor(game: MonopolyGame, requested: string) {
    return game.state.players.some(p => p.color === requested) ? PLAYER_COLORS.find(color => !game.state.players.some(p => p.color === color)) : requested;
  }
  private sessionReply(game: MonopolyGame, playerId: string, resumeSecret: string): SessionAck {
    return { ok: true, session: { roomCode: game.roomCode, playerId, resumeSecret }, state: this.snapshot(game), serverTime: this.now() };
  }
  private indexAdmissions(code: string, record: RoomRecord | null) {
    for (const [hash, value] of this.admissionIndex) if (value.code === code) this.admissionIndex.delete(hash);
    if (record) for (const [playerId, session] of Object.entries(record.sessions)) {
      if (session.admissionHash && session.admissionFingerprint) this.admissionIndex.set(session.admissionHash, { code, playerId, fingerprint: session.admissionFingerprint });
    }
  }
  private admissionFingerprint(kind: string, details: AdmissionProfile, code?: string) {
    return hashSecret(canonical({ kind, name: details.name, color: details.color, ...(code ? { roomCode: code } : {}) }));
  }
  private async recoverProof(socketId: string, kind: string, details: AdmissionProfile, code?: string, alreadySerialized = false): Promise<SessionAck | null> {
    const admissionHash = hashSecret(details.admissionSecret);
    const indexed = this.admissionIndex.get(admissionHash); if (!indexed) return null;
    const fingerprint = this.admissionFingerprint(kind, details, code);
    if (indexed.fingerprint !== fingerprint) throw new ProtocolFailure('ADMISSION_CONFLICT', 'This private admission token belongs to a different room request. Retry the original request.');
    const recover = async (): Promise<SessionAck | null> => {
      let current: CachedRoom;
      try { current = await this.load(indexed.code); }
      catch (error) {
        if (error instanceof ProtocolFailure && ['ROOM_NOT_FOUND', 'ROOM_EXPIRED'].includes(error.code)) { this.admissionIndex.delete(admissionHash); return null; }
        throw error;
      }
      const session = current.record.sessions[indexed.playerId];
      if (session?.admissionHash !== admissionHash || session.admissionFingerprint !== fingerprint) { this.admissionIndex.delete(admissionHash); return null; }
      const secret = randomBytes(32).toString('base64url'); const game = current.game.fork();
      const player = game.state.players.find(p => p.id === indexed.playerId)!;
      player.connected = true; player.disconnectedAt = undefined; game.state.version++;
      const record = structuredClone(current.record); record.sessions[indexed.playerId].secretHash = hashSecret(secret); record.sessions[indexed.playerId].disconnectedAt = null;
      await this.commit(indexed.code, current, game, record, false);
      const seat = this.seat(indexed.code, indexed.playerId); const oldSocket = this.activeSockets.get(seat);
      this.activeSockets.set(seat, socketId); this.pendingDisconnects.delete(seat); this.pendingAdmissions.delete(socketId); this.schedule(indexed.code, this.rooms.get(indexed.code)!);
      if (oldSocket && oldSocket !== socketId) this.emit('session_replaced', oldSocket);
      this.emit('game_update', indexed.code, this.snapshot(game));
      return this.sessionReply(game, indexed.playerId, secret);
    };
    return alreadySerialized ? recover() : this.serial(indexed.code, recover);
  }
  async createRoom(socketId: string, value: unknown): Promise<SessionAck> {
    const details = profile(value);
    return this.serial(`admission:${hashSecret(details.admissionSecret)}`, () => this.createRoomLocked(socketId, details));
  }
  private async createRoomLocked(socketId: string, details: AdmissionProfile): Promise<SessionAck> {
    return this.serial('__create__', async () => {
      this.checkReady();
      const recovered = await this.recoverProof(socketId, 'create', details); if (recovered) return recovered;
      if (this.rooms.size >= this.maxRooms) throw new ProtocolFailure('CAPACITY', 'The server is at capacity. Please try later.', true);
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = Array.from(randomBytes(6), n => alphabet[n % alphabet.length]).join('');
        if (this.rooms.has(code)) continue;
        const game = this.gameFactory(code); const playerId = randomUUID(); const secret = randomBytes(32).toString('base64url');
        if (!game.addPlayer(playerId, '', details.name, details.color)) throw new ProtocolFailure('INVALID_PROFILE', 'Unable to add this player.');
        const player = game.state.players.find(p => p.id === playerId)!; player.connected = true;
        const record: RoomRecord = { schemaVersion: 1, storageVersion: 1, createdAt: this.now(), expiresAt: this.now() + this.roomTtlMs, state: this.snapshot(game), sessions: { [playerId]: { secretHash: hashSecret(secret), disconnectedAt: null, admissionHash: hashSecret(details.admissionSecret), admissionFingerprint: this.admissionFingerprint('create', details) } }, receipts: [] };
        this.admissionIndex.set(hashSecret(details.admissionSecret), { code, playerId, fingerprint: this.admissionFingerprint('create', details) });
        this.pendingAdmissions.set(socketId, { kind: 'create', request: canonical(details), session: { roomCode: code, playerId, resumeSecret: secret } });
        let created: boolean;
        try { created = await this.store.create(code, record); }
        catch (error) {
          let confirmed = false;
          try { const saved = await this.store.load(code); confirmed = saved !== null && JSON.stringify(saved) === JSON.stringify(record); } catch { /* creation remains unacknowledged */ }
          if (!confirmed) throw error;
          created = true;
        }
        if (!created) { this.pendingAdmissions.delete(socketId); this.admissionIndex.delete(hashSecret(details.admissionSecret)); continue; }
        this.pendingAdmissions.delete(socketId);
        const room = { game, record }; this.rooms.set(code, room); this.indexAdmissions(code, record); this.activeSockets.set(this.seat(code, playerId), socketId); this.schedule(code, room);
        return this.sessionReply(game, playerId, secret);
      }
      throw new ProtocolFailure('CAPACITY', 'Could not reserve a room code. Please retry.', true);
    });
  }
  async joinRoom(socketId: string, value: unknown): Promise<SessionAck> {
    const details = profile(value); const code = normalizeRoomCode((value as Record<string, unknown>).roomCode);
    return this.serial(`admission:${hashSecret(details.admissionSecret)}`, () => this.joinRoomLocked(socketId, details, code));
  }
  private async joinRoomLocked(socketId: string, details: AdmissionProfile, code: string): Promise<SessionAck> {
    const admissionRequest = canonical({ ...details, roomCode: code });
    return this.serial(code, async () => {
      const recovered = await this.recoverProof(socketId, 'join', details, code, true); if (recovered) return recovered;
      const current = await this.load(code); const game = current.game.fork();
      if (game.state.state !== 'lobby') throw new ProtocolFailure('GAME_STARTED', 'This game has already started. Resume your existing seat instead.');
      if (Object.keys(current.record.sessions).length >= RULES.maxPlayers) throw new ProtocolFailure('ROOM_FULL', `This room already has ${RULES.maxPlayers} players.`);
      const color = this.chooseColor(game, details.color);
      if (!color) throw new ProtocolFailure('ROOM_FULL', 'This room has no available tokens.');
      const playerId = randomUUID(); const secret = randomBytes(32).toString('base64url');
      if (!game.addPlayer(playerId, '', details.name, color)) throw new ProtocolFailure('INVALID_PROFILE', 'Unable to join this room.');
      game.state.players.find(p => p.id === playerId)!.connected = true;
      const record = structuredClone(current.record); record.sessions[playerId] = { secretHash: hashSecret(secret), disconnectedAt: null, admissionHash: hashSecret(details.admissionSecret), admissionFingerprint: this.admissionFingerprint('join', details, code) };
      this.admissionIndex.set(hashSecret(details.admissionSecret), { code, playerId, fingerprint: this.admissionFingerprint('join', details, code) });
      this.pendingAdmissions.set(socketId, { kind: 'join', request: admissionRequest, session: { roomCode: code, playerId, resumeSecret: secret } });
      await this.commit(code, current, game, record, false);
      this.pendingAdmissions.delete(socketId);
      this.activeSockets.set(this.seat(code, playerId), socketId); this.schedule(code, this.rooms.get(code)!);
      this.emit('game_update', code, this.snapshot(game));
      return this.sessionReply(game, playerId, secret);
    });
  }
  async resumeSession(socketId: string, value: unknown): Promise<SessionAck> {
    if (!isObject(value) || typeof value.playerId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.playerId) || typeof value.resumeSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.resumeSecret)) throw new ProtocolFailure('INVALID_SESSION', 'Your saved session is invalid.');
    const code = normalizeRoomCode(value.roomCode); const playerId = value.playerId; const secret = value.resumeSecret;
    return this.serial(code, async () => {
      const current = await this.load(code); const session = current.record.sessions[playerId];
      if (!session || !timingSafeEqual(Buffer.from(session.secretHash, 'hex'), Buffer.from(hashSecret(secret), 'hex'))) throw new ProtocolFailure('INVALID_SESSION', 'This seat could not be verified. Check your saved session or join a new game.');
      const game = current.game.fork(); const player = game.state.players.find(p => p.id === playerId);
      if (!player) throw new ProtocolFailure('INVALID_SESSION', 'This seat is no longer a member of the game.');
      const oldSocket = this.activeSockets.get(this.seat(code, playerId));
      player.connected = true; player.disconnectedAt = undefined; player.socketId = ''; game.state.version++;
      const record = structuredClone(current.record); record.sessions[playerId].disconnectedAt = null;
      await this.commit(code, current, game, record, false);
      this.activeSockets.set(this.seat(code, playerId), socketId); this.pendingDisconnects.delete(this.seat(code, playerId)); this.schedule(code, this.rooms.get(code)!);
      if (oldSocket && oldSocket !== socketId) this.emit('session_replaced', oldSocket);
      this.emit('game_update', code, this.snapshot(game));
      return this.sessionReply(game, playerId, secret);
    });
  }
  async execute(socketId: string, credentials: Pick<SessionCredentials, 'roomCode' | 'playerId'>, value: unknown): Promise<CommandAck> {
    const request = envelope(value); const code = normalizeRoomCode(credentials.roomCode); const actorId = credentials.playerId;
    return this.serial(code, async () => {
      const current = await this.load(code);
      if (this.activeSockets.get(this.seat(code, actorId)) !== socketId) throw new ProtocolFailure('NOT_AUTHENTICATED', 'Resume your seat before sending a command.');
      const fingerprint = createHash('sha256').update(canonical(request.command)).digest('hex');
      const receipt = current.record.receipts.find(item => item.actorId === actorId && item.commandId === request.commandId);
      if (!current.record.sessions[actorId]) {
        if (request.command.type === 'leave_game' && receipt?.ack.ok && receipt.fingerprint === fingerprint) {
          this.activeSockets.delete(this.seat(code, actorId)); this.pendingDisconnects.delete(this.seat(code, actorId));
          return { ...structuredClone(receipt.ack), state: this.snapshot(current.game) };
        }
        throw new ProtocolFailure('NOT_AUTHENTICATED', 'Resume your seat before sending a command.');
      }
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new ProtocolFailure('COMMAND_ID_REUSED', 'This command identifier was already used for another action.');
        return structuredClone(receipt.ack);
      }
      const game = current.game.fork(); let ack: CommandAck;
      if (request.gameId !== game.state.gameId) {
        ack = { commandId: request.commandId, ok: false, version: game.state.version, error: { code: 'WRONG_GAME', message: 'This command belongs to another game. Reconnect to the current room.' } };
      } else if ((request.expectedVersion !== undefined && request.expectedVersion !== game.state.version) || (request.expectedTurnId !== undefined && request.expectedTurnId !== game.state.turnId)) {
        ack = { commandId: request.commandId, ok: false, version: game.state.version, error: { code: 'STALE_STATE', message: 'The game changed. Review the current board and try again.' } };
      } else if (request.command.type === 'leave_game' && (game.state.state === 'ended' || game.state.players.find(p => p.id === actorId)?.status !== 'active')) {
        const player = game.state.players.find(p => p.id === actorId)!; player.connected = false; player.disconnectedAt = this.now(); game.state.version++;
        ack = { commandId: request.commandId, ok: true, version: game.state.version };
      } else {
        const result = game.applyCommand(actorId, request.command, this.now());
        ack = { commandId: request.commandId, ok: result.ok, version: game.state.version, ...(result.ok ? {} : { error: result.error }) };
      }
      const record = structuredClone(current.record);
      record.receipts.push({ actorId, commandId: request.commandId, fingerprint, ack: structuredClone(ack) });
      record.receipts = record.receipts.slice(-MAX_RECEIPTS);
      const leaving = ack.ok && request.command.type === 'leave_game';
      if (leaving) delete record.sessions[actorId];
      if (leaving && Object.keys(record.sessions).length === 0) {
        await this.deleteDurably(code, current.record.storageVersion); this.evict(code); this.emit('room_closed', code, 'Everyone has left the room.');
      } else {
        await this.commit(code, current, game, record, ack.ok);
      }
      if (leaving) { this.activeSockets.delete(this.seat(code, actorId)); this.pendingDisconnects.delete(this.seat(code, actorId)); }
      return { ...ack, state: this.snapshot(game) };
    });
  }
  async abandonAdmission(socketId: string) {
    const pending = this.pendingAdmissions.get(socketId); if (!pending) return;
    this.pendingAdmissions.delete(socketId);
    const session = pending.session;
    if (!this.activeSockets.has(this.seat(session.roomCode, session.playerId))) {
      this.activeSockets.set(this.seat(session.roomCode, session.playerId), socketId);
      await this.disconnect(socketId, session);
    }
  }
  async disconnect(socketId: string, credentials: Pick<SessionCredentials, 'roomCode' | 'playerId'>) {
    const { roomCode: code, playerId } = credentials; const key = this.seat(code, playerId);
    if (this.activeSockets.get(key) !== socketId) return;
    this.activeSockets.delete(key);
    this.pendingDisconnects.set(key, { code, playerId, at: this.now() });
    await this.serial(code, async () => {
      try { const current = await this.load(code); await this.flushDisconnects(code, current); }
      catch (error) { if (error instanceof ProtocolFailure && ['ROOM_NOT_FOUND', 'ROOM_EXPIRED'].includes(error.code)) { this.evict(code); return; } this.retry(code); }
    });
  }
  private async flushDisconnects(code: string, current: CachedRoom) {
    const pending = [...this.pendingDisconnects.entries()].filter(([, item]) => item.code === code && !this.activeSockets.has(this.seat(code, item.playerId)));
    if (!pending.length) return current;
    const game = current.game.fork(); const record = structuredClone(current.record); let changed = false;
    for (const [, item] of pending) {
      const player = game.state.players.find(p => p.id === item.playerId); const session = record.sessions[item.playerId];
      if (player && session) { player.connected = false; player.disconnectedAt = item.at; session.disconnectedAt = item.at; changed = true; }
    }
    if (changed) { game.state.version++; current = await this.commit(code, current, game, record); }
    for (const [key] of pending) this.pendingDisconnects.delete(key);
    return current;
  }
  /** Testable recovery entry point; timers enter exactly this same serialized pipeline. */
  async reconcile(code: string) {
    return this.serial(code, async () => {
      let current = await this.load(code); current = await this.flushDisconnects(code, current);
      if (current.record.expiresAt <= this.now()) { await this.expire(code, current); return; }
      const host = current.game.state.hostId;
      const hostSession = host ? current.record.sessions[host] : undefined;
      if (host && hostSession?.disconnectedAt !== null && hostSession?.disconnectedAt !== undefined && hostSession.disconnectedAt + this.hostGraceMs <= this.now() && !this.activeSockets.has(this.seat(code, host))) {
        const replacement = current.game.state.players.find(player => current.record.sessions[player.id] && this.activeSockets.has(this.seat(code, player.id)) && player.status === 'active');
        if (replacement) { const game = current.game.fork(); game.state.hostId = replacement.id; game.state.version++; current = await this.commit(code, current, game); }
      }
      const state = current.game.state;
      if (state.state === 'playing' && state.turnDeadline !== undefined && state.turnDeadline <= this.now()) {
        const game = current.game.fork();
        const command: GameCommand = { type: 'timeout', turnId: state.turnId, phaseId: state.phaseId };
        const result = game.applyCommand('__system__', command, this.now());
        if (result.ok) current = await this.commit(code, current, game);
        else { this.emit('room_error', code, result.error.code); this.retry(code); return; }
      }
      this.schedule(code, current);
    });
  }
  private schedule(code: string, room: CachedRoom) {
    this.clearTimer(code);
    if (!this.scheduleTimers || this.closing) return;
    const deadlines = [room.record.expiresAt];
    if (room.game.state.state === 'playing' && room.game.state.turnDeadline !== undefined) deadlines.push(room.game.state.turnDeadline);
    const hostId = room.game.state.hostId;
    const offlineAt = hostId ? room.record.sessions[hostId]?.disconnectedAt : null;
    // Do not create a zero-delay loop when no connected successor exists.
    if (offlineAt !== null && offlineAt !== undefined && room.game.state.players.some(p => p.id !== hostId && this.activeSockets.has(this.seat(code, p.id)) && p.status === 'active')) deadlines.push(offlineAt + this.hostGraceMs);
    const delay = Math.max(1, Math.min(2_147_483_647, Math.min(...deadlines) - this.now()));
    const timer = setTimeout(() => { this.timers.delete(code); void this.reconcile(code).catch(error => { if (error instanceof ProtocolFailure && ['ROOM_NOT_FOUND', 'ROOM_EXPIRED'].includes(error.code)) return; this.emit('room_error', code, 'STORAGE_UNAVAILABLE'); this.retry(code); }); }, delay);
    timer.unref(); this.timers.set(code, timer);
  }
  private retry(code: string) {
    this.clearTimer(code); if (!this.scheduleTimers || this.closing) return;
    const timer = setTimeout(() => { this.timers.delete(code); void this.reconcile(code).catch(error => { if (error instanceof ProtocolFailure && ['ROOM_NOT_FOUND', 'ROOM_EXPIRED'].includes(error.code)) { this.evict(code); return; } this.retry(code); }); }, 2000);
    timer.unref(); this.timers.set(code, timer);
  }
  private clearTimer(code: string) { const timer = this.timers.get(code); if (timer) clearTimeout(timer); this.timers.delete(code); }
  private evict(code: string) {
    this.clearTimer(code); this.rooms.delete(code); this.dirtyRooms.delete(code); this.indexAdmissions(code, null);
    for (const key of this.activeSockets.keys()) if (key.startsWith(`${code}:`)) this.activeSockets.delete(key);
    for (const key of this.pendingDisconnects.keys()) if (key.startsWith(`${code}:`)) this.pendingDisconnects.delete(key);
  }
  private async deleteDurably(code: string, storageVersion: number) {
    try { await this.store.delete(code, storageVersion); }
    catch (error) {
      this.dirtyRooms.add(code); let confirmed = false;
      try { confirmed = await this.store.load(code) === null; } catch { /* retry reads before the next mutation */ }
      if (!confirmed) throw error;
    }
  }
  private async expire(code: string, room: CachedRoom) { await this.deleteDurably(code, room.record.storageVersion); this.evict(code); this.emit('room_closed', code, 'This room reached its retention limit.'); }
  async inspect(code: string): Promise<GameState> { return this.serial(code, async () => this.snapshot((await this.load(code)).game)); }
  async close() {
    this.closing = true;
    for (const code of this.timers.keys()) this.clearTimer(code);
    await Promise.allSettled([...this.queues.values()]);
    await this.store.close(); this.rooms.clear(); this.dirtyRooms.clear(); this.pendingAdmissions.clear(); this.admissionIndex.clear(); this.activeSockets.clear(); this.pendingDisconnects.clear(); this.started = false;
  }
}

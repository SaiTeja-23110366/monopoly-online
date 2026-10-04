import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server, type Socket } from 'socket.io';
import { RoomManager, ProtocolFailure, type RoomManagerOptions } from './roomManager';
import { MemoryRoomStore, RedisRoomStore, StorageError, type RoomStore } from './roomStore';
import type { ClientEvents, ProtocolError, ServerEvents, SessionAck, SessionCredentials } from '../../shared/protocol';
import type { CommandAck } from '../../shared/types';

interface SocketData {
  binding?: Pick<SessionCredentials, 'roomCode' | 'playerId'>;
  lastLeave?: CommandAck;
  lastSession?: { kind: string; request: string; reply: Extract<SessionAck, { ok: true }> };
}
type GameSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
export interface GameServerOptions extends Omit<RoomManagerOptions, 'store'> {
  store?: RoomStore;
  clientDist?: string;
  allowedOrigins?: string[];
  logger?: (message: string) => void;
}
class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  take(key: string, capacity: number, interval: number): boolean {
    const now = Date.now(); const old = this.buckets.get(key) ?? { tokens: capacity, at: now };
    const tokens = Math.min(capacity, old.tokens + (now - old.at) * capacity / interval);
    this.buckets.delete(key); this.buckets.set(key, { tokens: Math.max(0, tokens - 1), at: now });
    if (this.buckets.size > 10_000) this.buckets.delete(this.buckets.keys().next().value!);
    return tokens >= 1;
  }
}
function protocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolFailure) return { code: error.code, message: error.message, retryable: error.retryable };
  if (error instanceof StorageError) return { code: 'STORAGE_UNAVAILABLE', message: error.message, retryable: true };
  return { code: 'INTERNAL_ERROR', message: 'The server could not complete this action. Please retry.', retryable: true };
}
function envNumber(name: string, fallback: number) {
  const raw = process.env[name]; if (raw === undefined) return fallback;
  const value = Number(raw); if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`); return value;
}
export function configuredStore(): RoomStore {
  const adapter = process.env.ROOM_STORE ?? 'redis';
  if (adapter === 'memory') {
    if (process.env.NODE_ENV === 'production') throw new Error('Production requires Redis; ROOM_STORE=memory is development-only');
    return new MemoryRoomStore();
  }
  if (adapter !== 'redis') throw new Error('ROOM_STORE must be redis or memory');
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required. For local development only, explicitly set ROOM_STORE=memory.');
  return new RedisRoomStore(process.env.REDIS_URL, process.env.REDIS_NAMESPACE ?? 'monopoly:v1:');
}

/** Importing this module opens no network ports and creates no Redis connections. */
export async function createGameServer(options: GameServerOptions = {}) {
  if (Number(process.env.WEB_CONCURRENCY ?? '1') > 1 || (process.env.NODE_APP_INSTANCE !== undefined && process.env.NODE_APP_INSTANCE !== '0')) throw new Error('Run exactly one game authority process per Redis namespace.');
  const log = options.logger ?? (message => console.error(message));
  const app = express(); app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  const server = http.createServer(app);
  const allowedOrigins = options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? []);
  const originAllowed = (origin: string | undefined, host: string | undefined) => {
    if (!origin) return true;
    try { return new URL(origin).host === host || allowedOrigins.includes(origin); } catch { return false; }
  };
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(server, {
    maxHttpBufferSize: 16 * 1024, connectTimeout: 10_000,
    cors: { origin: allowedOrigins.length ? allowedOrigins : false, methods: ['GET', 'POST'] },
    allowRequest: (request, callback) => callback(null, originAllowed(request.headers.origin, request.headers.host)),
  });
  const rooms = new RoomManager({ ...options, store: options.store ?? configuredStore(),
    roomTtlMs: options.roomTtlMs ?? envNumber('ROOM_TTL_MS', 86_400_000),
    hostGraceMs: options.hostGraceMs ?? envNumber('HOST_GRACE_MS', 30_000),
    maxRooms: options.maxRooms ?? envNumber('MAX_ROOMS', 500),
  });
  rooms.on('room_error', (_code, reason) => log(`Room recovery error: ${reason}`));
  rooms.on('game_update', (code, state) => io.to(code).emit('game_state_update', state));
  rooms.on('session_replaced', (socketId: string) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;
    socket.data.binding = undefined;
    socket.emit('session_replaced', { message: 'Your seat was resumed in another browser tab.' });
    socket.disconnect(true);
  });
  rooms.on('room_closed', (code: string, reason: string) => {
    io.to(code).emit('room_closed', { roomCode: code, reason });
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.binding?.roomCode === code) { socket.data.binding = undefined; void socket.leave(code); }
    }
  });
  await rooms.start();
  app.get('/healthz', (_request, response) => response.json({ ok: true }));
  app.get('/readyz', (_request, response) => response.status(rooms.healthy() ? 200 : 503).json({ ready: rooms.healthy() }));
  const sourceDist = path.resolve(__dirname, '../../client/dist');
  const clientDist = options.clientDist ?? (fs.existsSync(path.join(sourceDist, 'index.html')) ? sourceDist : path.resolve(__dirname, '../../../../client/dist'));
  app.use(express.static(clientDist, { dotfiles: 'deny', index: false }));
  app.use((request, response) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/') || !fs.existsSync(path.join(clientDist, 'index.html'))) { response.status(404).json({ error: 'Not found' }); return; }
    response.sendFile(path.join(clientDist, 'index.html'));
  });
  const limiter = new RateLimiter();
  const connections = new Map<string, number>();
  io.use((socket, next) => {
    const ip = socket.handshake.address;
    if ((connections.get(ip) ?? 0) >= 64 || !limiter.take(`connect:${ip}`, 60, 60_000)) { next(new Error('Too many connections. Please wait and retry.')); return; }
    next();
  });
  io.on('connection', (socket: GameSocket) => {
    const ip = socket.handshake.address; connections.set(ip, (connections.get(ip) ?? 0) + 1);
    let queued = 0; let tail = Promise.resolve();
    const enqueue = (work: () => Promise<void>, reject: (error: ProtocolError) => void) => {
      if (queued >= 32) { reject({ code: 'RATE_LIMITED', message: 'Too many pending actions. Please wait.', retryable: true }); return; }
      queued++;
      tail = tail.then(work).catch(error => reject(protocolError(error))).finally(() => { queued--; });
    };
    const requireLimit = (kind: string, max: number, ms: number, perSocket = false) => {
      if (!limiter.take(`${kind}:${perSocket ? socket.id : ip}`, max, ms)) throw new ProtocolFailure('RATE_LIMITED', 'Too many requests. Please wait and retry.', true);
    };
    const sessionAction = (kind: string, value: unknown, callback: unknown, run: () => Promise<SessionAck>) => {
      if (typeof callback !== 'function') { socket.emit('protocol_error', { code: 'ACK_REQUIRED', message: 'This action requires an acknowledgement callback.' }); return; }
      const ack = callback as (reply: SessionAck) => void;
      enqueue(async () => {
        requireLimit(kind, kind === 'create' ? 4 : 30, 60_000);
        if (!socket.connected) return;
        const request = JSON.stringify(value ?? null);
        if (socket.data.binding) {
          const previous = socket.data.lastSession;
          if (previous && previous.kind === kind && previous.request === request) {
            const state = await rooms.inspect(socket.data.binding.roomCode);
            ack({ ...previous.reply, state, serverTime: Date.now() }); return;
          }
          throw new ProtocolFailure('ALREADY_IN_ROOM', 'Leave the current room before joining another.');
        }
        if (request.length > 1024) throw new ProtocolFailure('INVALID_REQUEST', 'This request is too large.');
        const result = await run();
        if (result.ok) {
          socket.data.binding = { roomCode: result.session.roomCode, playerId: result.session.playerId };
          socket.data.lastLeave = undefined;
          socket.data.lastSession = { kind, request, reply: result };
          if (!socket.connected) { await rooms.disconnect(socket.id, socket.data.binding); return; }
          await socket.join(result.session.roomCode);
          socket.emit('game_state_update', result.state);
        }
        ack(result);
      }, error => ack({ ok: false, error }));
    };
    socket.on('create_room', (value, ack) => sessionAction('create', value, ack, () => rooms.createRoom(socket.id, value)));
    socket.on('join_room', (value, ack) => sessionAction('join', value, ack, () => rooms.joinRoom(socket.id, value)));
    socket.on('resume_session', (value, ack) => sessionAction('resume', value, ack, () => rooms.resumeSession(socket.id, value)));
    socket.on('game_command', (value, callback) => {
      if (typeof callback !== 'function') { socket.emit('protocol_error', { code: 'ACK_REQUIRED', message: 'Game commands require an acknowledgement callback.' }); return; }
      const commandId = typeof value?.commandId === 'string' ? value.commandId.slice(0, 100) : '';
      enqueue(async () => {
        requireLimit('command', 60, 10_000, true);
        if (!socket.connected) return;
        if (!socket.data.binding) {
          if (socket.data.lastLeave?.commandId === commandId && value.command?.type === 'leave_game') { callback(socket.data.lastLeave); return; }
          throw new ProtocolFailure('NOT_AUTHENTICATED', 'Resume your seat before sending a command.');
        }
        const binding = socket.data.binding;
        const result = await rooms.execute(socket.id, binding, value);
        if (result.ok && value.command.type === 'leave_game') {
          socket.data.lastLeave = result; socket.data.lastSession = undefined; socket.data.binding = undefined; await socket.leave(binding.roomCode);
        }
        callback(result);
      }, error => callback({ commandId, ok: false, version: 0, error }));
    });
    socket.on('disconnect', () => {
      const count = (connections.get(ip) ?? 1) - 1;
      if (count <= 0) connections.delete(ip); else connections.set(ip, count);
      const binding = socket.data.binding;
      socket.data.binding = undefined;
      void rooms.abandonAdmission(socket.id).catch(() => log('Admission cleanup is waiting for storage recovery.'));
      if (binding) void rooms.disconnect(socket.id, binding).catch(() => log('Presence update is waiting for storage recovery.'));
    });
  });
  return {
    app, server, io, rooms,
    listen(port = 3001, host = '0.0.0.0'): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); const address = server.address(); resolve(typeof address === 'object' && address ? address.port : port); });
      });
    },
    async close() {
      await new Promise<void>(resolve => io.close(() => resolve()));
      await rooms.close();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

if (require.main === module) {
  void (async () => {
    const gameServer = await createGameServer();
    const port = envNumber('PORT', 3001);
    if (port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535');
    await gameServer.listen(port);
    console.log(`Game server listening on port ${port}`);
    let closing = false;
    const shutdown = () => {
      if (closing) return; closing = true;
      const deadline = setTimeout(() => process.exit(1), 10_000); deadline.unref();
      void gameServer.close().then(() => { clearTimeout(deadline); process.exitCode = 0; }, () => { process.exitCode = 1; });
    };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  })().catch(error => { console.error(error instanceof StorageError ? error.message : 'Server startup failed. Check configuration and Redis connectivity.'); process.exitCode = 1; });
}

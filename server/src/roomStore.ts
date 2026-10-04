import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import type { CommandAck, GameState } from '../../shared/types';

export interface StoredSession { secretHash: string; disconnectedAt: number | null; admissionHash?: string; admissionFingerprint?: string }
export interface CommandReceipt { actorId: string; commandId: string; fingerprint: string; ack: CommandAck }
export interface RoomRecord {
  schemaVersion: 1;
  storageVersion: number;
  createdAt: number;
  expiresAt: number;
  state: GameState;
  sessions: Record<string, StoredSession>;
  receipts: CommandReceipt[];
}
export class StorageError extends Error {
  constructor(message = 'Room storage is unavailable. Please try again shortly.') { super(message); this.name = 'StorageError'; }
}
export class StorageConflictError extends StorageError {
  constructor() { super('Room authority changed. Please reconnect.'); }
}
export interface RoomStore {
  start(): Promise<void>;
  list(): Promise<string[]>;
  load(roomCode: string): Promise<RoomRecord | null>;
  create(roomCode: string, record: RoomRecord): Promise<boolean>;
  save(roomCode: string, record: RoomRecord, expectedStorageVersion: number): Promise<void>;
  delete(roomCode: string, expectedStorageVersion: number): Promise<void>;
  healthy(): boolean;
  close(): Promise<void>;
}

/** Explicit opt-in development/test adapter. Never use for production persistence. */
export class MemoryRoomStore implements RoomStore {
  private records = new Map<string, RoomRecord>();
  constructor(private readonly now: () => number = Date.now) {}
  async start() {}
  async list() { return [...this.records.keys()]; }
  async load(code: string) {
    const record = this.records.get(code);
    if (!record) return null;
    if (record.expiresAt <= this.now()) { this.records.delete(code); return null; }
    return structuredClone(record);
  }
  async create(code: string, record: RoomRecord) {
    if (await this.load(code)) return false;
    this.records.set(code, structuredClone(record));
    return true;
  }
  async save(code: string, record: RoomRecord, expected: number) {
    if ((await this.load(code))?.storageVersion !== expected) throw new StorageConflictError();
    this.records.set(code, structuredClone(record));
  }
  async delete(code: string, expected: number) {
    const current = await this.load(code);
    if (current && current.storageVersion !== expected) throw new StorageConflictError();
    this.records.delete(code);
  }
  healthy() { return true; }
  async close() {}
}

const WRITE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return -2 end
local existing = redis.call('GET', KEYS[2])
if ARGV[2] == 'create' then
  if existing then return 0 end
else
  if not existing then
    if ARGV[2] == 'delete' then return 1 end
    return -1
  end
  local ok, current = pcall(cjson.decode, existing)
  if not ok or current.storageVersion ~= tonumber(ARGV[3]) then return -1 end
end
if ARGV[2] == 'delete' then redis.call('DEL', KEYS[2])
else redis.call('SET', KEYS[2], ARGV[4], 'PX', ARGV[5]) end
return 1`;
const RENEW = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/** One fenced process owns a namespace. This is intentionally NOT a horizontal-scale adapter. */
export class RedisRoomStore implements RoomStore {
  private readonly redis: Redis;
  private readonly authority = randomBytes(32).toString('hex');
  private readonly leaseMs = 30_000;
  private renewal?: NodeJS.Timeout;
  private leaseUntil = 0;
  private closed = false;
  constructor(url: string, private readonly prefix = 'monopoly:v1:') {
    if (!/^rediss?:\/\//.test(url)) throw new Error('REDIS_URL must use redis:// or rediss://');
    if (!/^[A-Za-z0-9:_-]{1,100}$/.test(prefix)) throw new Error('Invalid Redis namespace');
    this.redis = new Redis(url, {
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
      connectTimeout: 5000, commandTimeout: 5000,
      // TLS certificate verification remains enabled for rediss URLs.
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    });
    this.redis.on('error', () => { /* Readiness and client errors report outages without leaking connection credentials. */ });
  }
  private get leaseKey() { return `${this.prefix}authority`; }
  private roomKey(code: string) { return `${this.prefix}room:${code}`; }
  async start() {
    try {
      await this.redis.connect();
      const acquired = await this.redis.set(this.leaseKey, this.authority, 'PX', this.leaseMs, 'NX');
      if (!acquired) throw new StorageError('Another server owns this Redis namespace. Run exactly one game server.');
      this.leaseUntil = Date.now() + this.leaseMs;
      this.renewal = setInterval(() => void this.renew(), this.leaseMs / 3);
      this.renewal.unref();
    } catch (error) { this.redis.disconnect(); throw error instanceof StorageError ? error : new StorageError(); }
  }
  private async renew() {
    if (this.closed) return;
    try {
      const success = await this.redis.eval(RENEW, 1, this.leaseKey, this.authority, this.leaseMs);
      this.leaseUntil = success === 1 ? Date.now() + this.leaseMs : 0;
    } catch { this.leaseUntil = 0; }
  }
  healthy() { return !this.closed && this.redis.status === 'ready' && this.leaseUntil > Date.now(); }
  private ensureReady() { if (!this.healthy()) throw new StorageError(); }
  async list() {
    this.ensureReady();
    try {
      let cursor = '0'; const codes: string[] = [];
      do {
        const result = await this.redis.scan(cursor, 'MATCH', `${this.prefix}room:*`, 'COUNT', 200);
        cursor = result[0];
        codes.push(...result[1].map(key => key.slice(`${this.prefix}room:`.length)));
        if (codes.length > 10_000) throw new StorageError('Room namespace exceeds the supported single-server capacity.');
      } while (cursor !== '0');
      return codes;
    } catch (error) { throw error instanceof StorageError ? error : new StorageError(); }
  }
  async load(code: string) {
    this.ensureReady();
    try { const raw = await this.redis.get(this.roomKey(code)); return raw ? JSON.parse(raw) as RoomRecord : null; }
    catch { throw new StorageError(); }
  }
  private async write(code: string, record: RoomRecord | null, expected: number, mode: 'create' | 'save' | 'delete') {
    this.ensureReady();
    try {
      const ttl = record ? Math.max(1, record.expiresAt - Date.now()) : 1;
      const result = Number(await this.redis.eval(WRITE, 2, this.leaseKey, this.roomKey(code), this.authority, mode, expected, record ? JSON.stringify(record) : '', ttl));
      if (result < 0) { if (result === -2) this.leaseUntil = 0; throw new StorageConflictError(); }
      return result === 1;
    } catch (error) { throw error instanceof StorageError ? error : new StorageError(); }
  }
  create(code: string, record: RoomRecord) { return this.write(code, record, 0, 'create'); }
  async save(code: string, record: RoomRecord, expected: number) { await this.write(code, record, expected, 'save'); }
  async delete(code: string, expected: number) { await this.write(code, null, expected, 'delete'); }
  async close() {
    this.closed = true;
    if (this.renewal) clearInterval(this.renewal);
    try { if (this.redis.status === 'ready') await this.redis.eval(RELEASE, 1, this.leaseKey, this.authority); } catch { /* lease expires */ }
    this.redis.disconnect(); this.leaseUntil = 0;
  }
}

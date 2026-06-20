import { MonopolyGame } from './gameState';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  family: 0,
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

export class RoomManager {
  private memoryCache: Map<string, MonopolyGame> = new Map();

  async createRoom(): Promise<string> {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const game = new MonopolyGame(roomCode);
    await this.saveGame(game, true);
    return roomCode;
  }

  async getGame(roomCode: string): Promise<MonopolyGame | null> {
    // Check memory first
    if (this.memoryCache.has(roomCode)) {
      return this.memoryCache.get(roomCode) || null;
    }

    // Fallback to Redis
    const raw = await redis.get(`room:${roomCode}`);
    if (!raw) return null;
    const state = JSON.parse(raw);
    const game = new MonopolyGame(roomCode);
    game.state = state;
    this.memoryCache.set(roomCode, game); // Cache it
    return game;
  }

  async saveGame(game: MonopolyGame, forceRedis: boolean = false): Promise<void> {
    // Always update memory
    this.memoryCache.set(game.roomCode, game);

    // Conditionally sync to Redis to save commands
    if (forceRedis) {
      await redis.set(`room:${game.roomCode}`, JSON.stringify(game.state), 'EX', 86400);
    }
  }

  clearMemory(roomCode: string) {
    this.memoryCache.delete(roomCode);
  }

  async joinRoom(roomCode: string, playerId: string, socketId: string, playerName: string, color: string): Promise<boolean> {
    const game = await this.getGame(roomCode);
    if (!game) return false;
    const added = game.addPlayer(playerId, socketId, playerName, color);
    if (added) {
      await this.saveGame(game, true); // Force save on join
    }
    return added;
  }
}

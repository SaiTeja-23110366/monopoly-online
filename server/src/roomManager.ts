import { MonopolyGame } from './gameState';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  family: 0,
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableOfflineQueue: false,
});
redis.on('error', (err) => console.error('[Redis Error]', err));

import { EventEmitter } from 'events';

export class RoomManager extends EventEmitter {
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

  private handleTimeout = async (roomCode: string) => {
    try {
      const game = await this.getGame(roomCode);
      if (!game || !game.state.turnDeadline || Date.now() < game.state.turnDeadline) return;
      
      game.executeTimeout(
        () => this.emit('game_update', roomCode, game.state),
        async () => {
          await this.saveGame(game, true);
          this.emit('game_update', roomCode, game.state);
        }
      );
      await this.saveGame(game, true);
      this.emit('game_update', roomCode, game.state);
    } catch (e) {
      console.error('[Timeout Error]', e);
    }
  };

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
    let raw;
    try {
      raw = await redis.get(`room:${roomCode}`);
    } catch (e) {
      console.error('[Redis Get Error]', e);
      return null;
    }
    if (!raw) return null;
    const state = JSON.parse(raw);
    const game = new MonopolyGame(roomCode);
    game.state = state;
    this.memoryCache.set(roomCode, game); // Cache it
    return game;
  }

  async saveGame(game: MonopolyGame, forceRedis: boolean = false): Promise<void> {
    this.memoryCache.set(game.roomCode, game);
    if (forceRedis) {
      try {
        await redis.set(`room:${game.roomCode}`, JSON.stringify(game.state), 'EX', 86400);
      } catch (e) {
        console.error('[Redis Set Error]', e);
      }
    }
    
    if (game.state.turnDeadline) {
      if (this.timeouts.has(game.roomCode)) {
        clearTimeout(this.timeouts.get(game.roomCode));
      }
      const delay = game.state.turnDeadline - Date.now();
      if (delay > 0) {
        this.timeouts.set(game.roomCode, setTimeout(() => this.handleTimeout(game.roomCode), delay));
      } else {
        this.timeouts.delete(game.roomCode);
      }
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

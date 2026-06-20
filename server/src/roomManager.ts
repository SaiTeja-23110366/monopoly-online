import { MonopolyGame } from './gameState';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { family: 0 });

export class RoomManager {
  async createRoom(): Promise<string> {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const game = new MonopolyGame(roomCode);
    await this.saveGame(game);
    return roomCode;
  }

  async getGame(roomCode: string): Promise<MonopolyGame | null> {
    const raw = await redis.get(`room:${roomCode}`);
    if (!raw) return null;
    const state = JSON.parse(raw);
    const game = new MonopolyGame(roomCode);
    game.state = state;
    return game;
  }

  async saveGame(game: MonopolyGame): Promise<void> {
    await redis.set(`room:${game.roomCode}`, JSON.stringify(game.state), 'EX', 86400);
  }

  async joinRoom(roomCode: string, playerId: string, socketId: string, playerName: string, color: string): Promise<boolean> {
    const game = await this.getGame(roomCode);
    if (!game) return false;
    const added = game.addPlayer(playerId, socketId, playerName, color);
    if (added) {
      await this.saveGame(game);
    }
    return added;
  }
}

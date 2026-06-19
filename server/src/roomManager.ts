import { MonopolyGame } from './gameState';

export class RoomManager {
  private games: Map<string, MonopolyGame> = new Map();

  createRoom(): string {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.games.set(roomCode, new MonopolyGame(roomCode));
    return roomCode;
  }

  getGame(roomCode: string): MonopolyGame | undefined {
    return this.games.get(roomCode);
  }

  joinRoom(roomCode: string, playerId: string, playerName: string, color: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;
    return game.addPlayer(playerId, playerName, color);
  }
}

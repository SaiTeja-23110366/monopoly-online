"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomManager = void 0;
const gameState_1 = require("./gameState");
const ioredis_1 = __importDefault(require("ioredis"));
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new ioredis_1.default(redisUrl, {
    family: 0,
    tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    enableOfflineQueue: false,
});
redis.on('error', (err) => console.error('[Redis Error]', err));
const events_1 = require("events");
class RoomManager extends events_1.EventEmitter {
    timeouts = new Map();
    handleTimeout = async (roomCode) => {
        try {
            const game = await this.getGame(roomCode);
            if (!game || !game.state.turnDeadline || Date.now() < game.state.turnDeadline)
                return;
            game.executeTimeout(() => this.emit('game_update', roomCode, game.state), async () => {
                await this.saveGame(game, true);
                this.emit('game_update', roomCode, game.state);
            });
            await this.saveGame(game, true);
            this.emit('game_update', roomCode, game.state);
        }
        catch (e) {
            console.error('[Timeout Error]', e);
        }
    };
    memoryCache = new Map();
    async createRoom() {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const game = new gameState_1.MonopolyGame(roomCode);
        await this.saveGame(game, true);
        return roomCode;
    }
    async getGame(roomCode) {
        // Check memory first
        if (this.memoryCache.has(roomCode)) {
            return this.memoryCache.get(roomCode) || null;
        }
        // Fallback to Redis
        let raw;
        try {
            raw = await redis.get(`room:${roomCode}`);
        }
        catch (e) {
            console.error('[Redis Get Error]', e);
            return null;
        }
        if (!raw)
            return null;
        const state = JSON.parse(raw);
        const game = new gameState_1.MonopolyGame(roomCode);
        game.state = state;
        this.memoryCache.set(roomCode, game); // Cache it
        return game;
    }
    async saveGame(game, forceRedis = false) {
        this.memoryCache.set(game.roomCode, game);
        if (forceRedis) {
            try {
                await redis.set(`room:${game.roomCode}`, JSON.stringify(game.state), 'EX', 86400);
            }
            catch (e) {
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
            }
            else {
                this.timeouts.delete(game.roomCode);
            }
        }
    }
    clearMemory(roomCode) {
        this.memoryCache.delete(roomCode);
    }
    async joinRoom(roomCode, playerId, socketId, playerName, color) {
        const game = await this.getGame(roomCode);
        if (!game)
            return false;
        const added = game.addPlayer(playerId, socketId, playerName, color);
        if (added) {
            await this.saveGame(game, true); // Force save on join
        }
        return added;
    }
}
exports.RoomManager = RoomManager;

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { RoomManager } from './roomManager';

const app = express();
app.use(cors());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../../client/dist')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});


const roomManager = new RoomManager();
import Redis from 'ioredis';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  family: 0,
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('reconnect_player', async ({ roomCode, playerId }) => {
    try {
      const game = await roomManager.getGame(roomCode);
      if (!game) {
        socket.emit('error', 'Game not found');
        return;
      }
      const player = game.state.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('error', 'Player not found in this game');
        return;
      }
      player.socketId = socket.id;
      socket.join(roomCode);
      await roomManager.saveGame(game);
      socket.emit('game_state_update', game.state);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('create_room', async (callback) => {
    const roomCode = await roomManager.createRoom();
    callback({ roomCode });
  });

  socket.on('join_room', async (roomCode: string, playerId: string, playerName: string, color: string) => {
    const joined = await roomManager.joinRoom(roomCode, playerId, socket.id, playerName, color);
    if (joined) {
      socket.join(roomCode);
      const game = await roomManager.getGame(roomCode);
      if (game) {
        io.to(roomCode).emit('game_state_update', game.state);
      }
    } else {
      socket.emit('error', 'Room not found or game already started');
    }
  });

  const getPlayerId = (game: any, socketId: string) => {
    return game.state.players.find((p: any) => p.socketId === socketId)?.id;
  };

  socket.on('change_color', async (roomCode: string, newColor: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    if (game.changeColor(playerId, newColor)) {
      await roomManager.saveGame(game);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('update_starting_cash', async (roomCode: string, cash: number) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    if (game.setStartingCash(cash)) {
      await roomManager.saveGame(game);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('start_game', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    if (game.startGame()) {
      await roomManager.saveGame(game);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('roll_dice', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.rollDice(playerId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('acknowledge_card', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.acknowledgeCard(playerId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('execute_sabotage', async (roomCode: string, propertyIndex: number) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.executeSabotage(playerId, propertyIndex);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('execute_protection', async (roomCode: string, propertyIndex: number) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.executeProtection(playerId, propertyIndex);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('end_turn', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.endTurn(playerId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('leave_game', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.removePlayer(playerId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('pay_jail_fine', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.payJailFine(playerId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('use_jail_card', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.useJailCard(playerId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('buy_property', async (roomCode: string, propertyIndex: number, housesToBuy: number) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.buyProperty(playerId, propertyIndex, housesToBuy);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('upgrade_property', async (roomCode: string, propertyIndex: number, housesToBuy: number) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.upgradeProperty(playerId, propertyIndex, housesToBuy);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('pass_property', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.passProperty(playerId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('sell_property_to_bank', async (roomCode: string, propertyIndex: number) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.sellPropertyToBank(playerId, propertyIndex);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('flight_decision', async (roomCode: string, destinationIndex: number | null) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.handleFlightDecision(playerId, destinationIndex);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('propose_trade', async (roomCode: string, trade: any) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.proposeTrade(playerId, trade);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('accept_trade', async (roomCode: string, tradeId: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.acceptTrade(playerId, tradeId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('reject_trade', async (roomCode: string, tradeId: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.rejectTrade(playerId, tradeId);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('counter_trade', async (roomCode: string, tradeId: string, newOffer: any, newRequest: any) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.counterTrade(playerId, tradeId, newOffer, newRequest);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

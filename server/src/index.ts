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
const socketToPlayer = new Map<string, string>();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('create_room', (callback) => {
    const roomCode = roomManager.createRoom();
    callback({ roomCode });
  });

  socket.on('join_room', (roomCode: string, playerId: string, playerName: string, color: string) => {
    socketToPlayer.set(socket.id, playerId);
    const joined = roomManager.joinRoom(roomCode, playerId, playerName, color);
    if (joined) {
      socket.join(roomCode);
      const game = roomManager.getGame(roomCode);
      if (game) {
        io.to(roomCode).emit('game_state_update', game.state);
      }
    } else {
      socket.emit('error', 'Room not found or game already started');
    }
  });

  socket.on('change_color', (roomCode: string, newColor: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      if (game.changeColor(playerId, newColor)) {
        io.to(roomCode).emit('game_state_update', game.state);
      }
    }
  });

  socket.on('update_starting_cash', (roomCode: string, cash: number) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      if (game.setStartingCash(cash)) {
        io.to(roomCode).emit('game_state_update', game.state);
      }
    }
  });

  socket.on('start_game', (roomCode: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game && game.startGame()) {
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('roll_dice', (roomCode: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.rollDice(playerId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('acknowledge_card', (roomCode: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.acknowledgeCard(playerId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('execute_sabotage', (roomCode: string, propertyIndex: number) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.executeSabotage(playerId, propertyIndex);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('execute_protection', (roomCode: string, propertyIndex: number) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.executeProtection(playerId, propertyIndex);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('end_turn', (roomCode: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.endTurn(playerId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('pay_jail_fine', (roomCode: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.payJailFine(playerId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('use_jail_card', (roomCode: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.useJailCard(playerId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('buy_property', (roomCode: string, propertyIndex: number, housesToBuy: number) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.buyProperty(playerId, propertyIndex, housesToBuy);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('upgrade_property', (roomCode: string, propertyIndex: number, housesToBuy: number) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.upgradeProperty(playerId, propertyIndex, housesToBuy);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('pass_property', (roomCode: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.passProperty(playerId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('sell_property_to_bank', (roomCode: string, propertyIndex: number) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.sellPropertyToBank(playerId, propertyIndex);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  // Flight Decision
  socket.on('flight_decision', (roomCode: string, destinationIndex: number | null) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.handleFlightDecision(playerId, destinationIndex);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  // Trading Events
  socket.on('propose_trade', (roomCode: string, trade) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.proposeTrade(playerId, trade);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('accept_trade', (roomCode: string, tradeId: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.acceptTrade(playerId, tradeId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('reject_trade', (roomCode: string, tradeId: string) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.rejectTrade(playerId, tradeId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('counter_trade', (roomCode: string, tradeId: string, newOffer, newRequest) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.counterTrade(playerId, tradeId, newOffer, newRequest);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    socketToPlayer.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

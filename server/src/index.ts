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

app.get('*', (req, res) => {
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

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('create_room', (callback) => {
    const roomCode = roomManager.createRoom();
    callback({ roomCode });
  });

  socket.on('join_room', (roomCode: string, playerName: string, color: string) => {
    const joined = roomManager.joinRoom(roomCode, socket.id, playerName, color);
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
    const game = roomManager.getGame(roomCode);
    if (game) {
      if (game.changeColor(socket.id, newColor)) {
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
    const game = roomManager.getGame(roomCode);
    if (game && game.startGame()) {
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('roll_dice', (roomCode: string) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.rollDice(socket.id);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('acknowledge_card', (roomCode: string) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.acknowledgeCard(socket.id);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('execute_sabotage', (roomCode: string, propertyIndex: number) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.executeSabotage(socket.id, propertyIndex);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('execute_protection', (roomCode: string, propertyIndex: number) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.executeProtection(socket.id, propertyIndex);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('end_turn', (roomCode: string) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.endTurn(socket.id);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('pay_jail_fine', (roomCode: string) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.payJailFine(socket.id);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('use_jail_card', (roomCode: string) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.useJailCard(socket.id);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('buy_property', (roomCode: string, propertyIndex: number, housesToBuy: number) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.buyProperty(socket.id, propertyIndex, housesToBuy);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('upgrade_property', (roomCode: string, propertyIndex: number, housesToBuy: number) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.upgradeProperty(socket.id, propertyIndex, housesToBuy);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('pass_property', (roomCode: string) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.passProperty(socket.id);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('sell_property_to_bank', (roomCode: string, propertyIndex: number) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.sellPropertyToBank(socket.id, propertyIndex);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  // Flight Decision
  socket.on('flight_decision', (roomCode: string, destinationIndex: number | null) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.handleFlightDecision(socket.id, destinationIndex);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  // Trading Events
  socket.on('propose_trade', (roomCode: string, trade) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.proposeTrade(socket.id, trade);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('accept_trade', (roomCode: string, tradeId: string) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.acceptTrade(socket.id, tradeId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('reject_trade', (roomCode: string, tradeId: string) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.rejectTrade(socket.id, tradeId);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('counter_trade', (roomCode: string, tradeId: string, newOffer, newRequest) => {
    const game = roomManager.getGame(roomCode);
    if (game) {
      game.counterTrade(socket.id, tradeId, newOffer, newRequest);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Optional: handle player disconnecting mid-game
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

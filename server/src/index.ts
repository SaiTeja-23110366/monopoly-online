import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { RoomManager } from './roomManager';
import { MonopolyGame } from './gameState';

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
roomManager.on('game_update', (roomCode, state) => {
  io.to(roomCode).emit('game_state_update', state);
});
import Redis from 'ioredis';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  family: 0,
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});
redis.on('error', (err) => console.error('[Redis Error]', err));

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
      socket.data.roomCode = roomCode;
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
      socket.data.roomCode = roomCode;
      socket.join(roomCode);
      const game = await roomManager.getGame(roomCode);
      if (game) {
        io.to(roomCode).emit('game_state_update', game.state);
      }
    } else {
      socket.emit('error', 'Room not found or game already started');
    }
  });

  const getPlayerId = (game: MonopolyGame, socketId: string) => {
    return game.state.players.find(p => p.socketId === socketId)?.id;
  };

  const withGame = (handler: (game: MonopolyGame, playerId: string, ...args: any[]) => void | Promise<void>) => {
    return async (roomCode: string, ...args: any[]) => {
      try {
        const game = await roomManager.getGame(roomCode);
        if (!game) return;
        const playerId = getPlayerId(game, socket.id);
        if (!playerId) return;
        await handler(game, playerId, ...args);
        await roomManager.saveGame(game);
        io.to(roomCode).emit('game_state_update', game.state);
      } catch (e) {
        console.error('[Socket Error]', e);
      }
    };
  };


  socket.on('change_color', withGame((game, playerId, newColor: string) => {
    game.changeColor(playerId, newColor);
  }));

  socket.on('update_starting_cash', async (roomCode: string, cash: number) => {
    try {
      const game = await roomManager.getGame(roomCode);
      if (!game) return;
      if (game.setStartingCash(cash)) {
        await roomManager.saveGame(game);
        io.to(roomCode).emit('game_state_update', game.state);
      }
    } catch(e) { console.error(e); }
  });

  socket.on('start_game', async (roomCode: string) => {
    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    if (game.startGame()) {
      await roomManager.saveGame(game, true);
      io.to(roomCode).emit('game_state_update', game.state);
    }
  });

  socket.on('roll_dice', withGame((game, playerId) => {
    game.rollDice(
      playerId,
      () => { io.to(game.roomCode).emit('game_state_update', game.state); },
      async () => {
        await roomManager.saveGame(game, true);
        io.to(game.roomCode).emit('game_state_update', game.state);
      }
    );
  }));

  socket.on('acknowledge_card', withGame((game, playerId) => {
    game.acknowledgeCard(playerId);
  }));

  socket.on('execute_sabotage', withGame((game, playerId, propertyIndex: number) => {
    game.executeSabotage(playerId, propertyIndex);
  }));

  socket.on('execute_protection', withGame((game, playerId, propertyIndex: number) => {
    game.executeProtection(playerId, propertyIndex);
  }));

  socket.on('end_turn', withGame((game, playerId) => {
    game.endTurn(playerId);
  }));

  socket.on('leave_game', withGame((game, playerId) => {
    game.removePlayer(playerId);
  }));



  socket.on('pay_jail_fine', withGame((game, playerId) => {
    game.payJailFine(playerId);
  }));

  socket.on('use_jail_card', withGame((game, playerId) => {
    game.useJailCard(playerId);
  }));

  socket.on('buy_property', withGame((game, playerId, propertyIndex: number, housesToBuy: number) => {
    game.buyProperty(playerId, propertyIndex, housesToBuy);
  }));

  socket.on('upgrade_property', withGame((game, playerId, propertyIndex: number, housesToBuy: number) => {
    game.upgradeProperty(playerId, propertyIndex, housesToBuy);
  }));

  socket.on('pass_property', withGame((game, playerId) => {
    game.passProperty(playerId);
  }));

  socket.on('sell_property_to_bank', withGame((game, playerId, propertyIndex: number) => {
    game.sellPropertyToBank(playerId, propertyIndex);
  }));

  socket.on('flight_decision', withGame((game, playerId, destinationIndex: number | null) => {
    game.handleFlightDecision(playerId, destinationIndex);
  }));

  const validateTradeItems = (items: any) => {
    if (!items) return false;
    if (typeof items.money !== 'number' || isNaN(items.money) || items.money < 0) return false;
    if (!Array.isArray(items.properties) || !items.properties.every((p: any) => typeof p === 'number')) return false;
    return true;
  };

  const validateTradePayload = (trade: any) => {
    if (!trade || typeof trade.targetId !== 'string') return false;
    if (!validateTradeItems(trade.offer) || !validateTradeItems(trade.request)) return false;
    return true;
  };

  socket.on('propose_trade', withGame((game, playerId, trade: any) => {
    if (validateTradePayload(trade)) game.proposeTrade(playerId, trade);
  }));

  socket.on('accept_trade', withGame((game, playerId, tradeId: string) => {
    game.acceptTrade(playerId, tradeId);
  }));

  socket.on('reject_trade', withGame((game, playerId, tradeId: string) => {
    game.rejectTrade(playerId, tradeId);
  }));

  socket.on('counter_trade', withGame((game, playerId, tradeId: string, newOffer: any, newRequest: any) => {
    if (validateTradeItems(newOffer) && validateTradeItems(newRequest)) game.counterTrade(playerId, tradeId, newOffer, newRequest);
  }));

  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomCode = socket.data.roomCode;
    if (roomCode) {
      // Check if room is empty
      const room = io.sockets.adapter.rooms.get(roomCode);
      if (!room || room.size === 0) {
        const game = await roomManager.getGame(roomCode);
        if (game) {
          await roomManager.saveGame(game, true);
          roomManager.clearMemory(roomCode);
          console.log(`Room ${roomCode} is empty. Saved to Redis and cleared from memory.`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

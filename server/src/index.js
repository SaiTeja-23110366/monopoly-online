"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const roomManager_1 = require("./roomManager");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
// Serve static frontend files
app.use(express_1.default.static(path_1.default.join(__dirname, '../../client/dist')));
app.use((req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../../client/dist/index.html'));
});
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
const roomManager = new roomManager_1.RoomManager();
roomManager.on('game_update', (roomCode, state) => {
    io.to(roomCode).emit('game_state_update', state);
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
            socket.data.roomCode = roomCode;
            socket.join(roomCode);
            await roomManager.saveGame(game);
            socket.emit('game_state_update', game.state);
        }
        catch (e) {
            console.error(e);
        }
    });
    socket.on('create_room', async (callback) => {
        try {
            const roomCode = await roomManager.createRoom();
            callback({ roomCode });
        }
        catch (e) {
            console.error('[create_room Error]', e);
            socket.emit('error', 'Failed to create room');
        }
    });
    socket.on('join_room', async (roomCode, playerId, playerName, color) => {
        try {
            const joined = await roomManager.joinRoom(roomCode, playerId, socket.id, playerName, color);
            if (joined) {
                socket.data.roomCode = roomCode;
                socket.join(roomCode);
                const game = await roomManager.getGame(roomCode);
                if (game) {
                    io.to(roomCode).emit('game_state_update', game.state);
                }
            }
            else {
                socket.emit('error', 'Room not found or game already started');
            }
        }
        catch (e) {
            console.error('[join_room Error]', e);
            socket.emit('error', 'Failed to join room');
        }
    });
    const getPlayerId = (game, socketId) => {
        return game.state.players.find(p => p.socketId === socketId)?.id;
    };
    const withGame = (handler) => {
        return async (roomCode, ...args) => {
            try {
                const game = await roomManager.getGame(roomCode);
                if (!game)
                    return;
                const playerId = getPlayerId(game, socket.id);
                if (!playerId)
                    return;
                await handler(game, playerId, ...args);
                await roomManager.saveGame(game);
                io.to(roomCode).emit('game_state_update', game.state);
            }
            catch (e) {
                console.error('[Socket Error]', e);
            }
        };
    };
    socket.on('change_color', withGame((game, playerId, newColor) => {
        game.changeColor(playerId, newColor);
    }));
    socket.on('update_starting_cash', async (roomCode, cash) => {
        try {
            const game = await roomManager.getGame(roomCode);
            if (!game)
                return;
            if (game.setStartingCash(cash)) {
                await roomManager.saveGame(game);
                io.to(roomCode).emit('game_state_update', game.state);
            }
        }
        catch (e) {
            console.error(e);
        }
    });
    socket.on('start_game', async (roomCode) => {
        try {
            const game = await roomManager.getGame(roomCode);
            if (!game)
                return;
            if (game.startGame()) {
                await roomManager.saveGame(game, true);
                io.to(roomCode).emit('game_state_update', game.state);
            }
        }
        catch (e) {
            console.error('[start_game Error]', e);
            socket.emit('error', 'Failed to start game');
        }
    });
    socket.on('roll_dice', withGame((game, playerId) => {
        game.rollDice(playerId, () => { io.to(game.roomCode).emit('game_state_update', game.state); }, async () => {
            await roomManager.saveGame(game, true);
            io.to(game.roomCode).emit('game_state_update', game.state);
        });
    }));
    socket.on('acknowledge_card', withGame((game, playerId) => {
        game.acknowledgeCard(playerId);
    }));
    socket.on('execute_sabotage', withGame((game, playerId, propertyIndex) => {
        game.executeSabotage(playerId, propertyIndex);
    }));
    socket.on('execute_protection', withGame((game, playerId, propertyIndex) => {
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
    socket.on('buy_property', withGame((game, playerId, propertyIndex, housesToBuy) => {
        game.buyProperty(playerId, propertyIndex, housesToBuy);
    }));
    socket.on('upgrade_property', withGame((game, playerId, propertyIndex, housesToBuy) => {
        game.upgradeProperty(playerId, propertyIndex, housesToBuy);
    }));
    socket.on('pass_property', withGame((game, playerId) => {
        game.passProperty(playerId);
    }));
    socket.on('sell_property_to_bank', withGame((game, playerId, propertyIndex) => {
        game.sellPropertyToBank(playerId, propertyIndex);
    }));
    socket.on('flight_decision', withGame((game, playerId, destinationIndex) => {
        game.handleFlightDecision(playerId, destinationIndex);
    }));
    const validateTradeItems = (items) => {
        if (!items)
            return false;
        if (typeof items.money !== 'number' || isNaN(items.money) || items.money < 0)
            return false;
        if (!Array.isArray(items.properties) || !items.properties.every((p) => typeof p === 'number'))
            return false;
        return true;
    };
    const validateTradePayload = (trade) => {
        if (!trade || typeof trade.targetId !== 'string')
            return false;
        if (!validateTradeItems(trade.offer) || !validateTradeItems(trade.request))
            return false;
        return true;
    };
    socket.on('propose_trade', withGame((game, playerId, trade) => {
        if (validateTradePayload(trade))
            game.proposeTrade(playerId, trade);
    }));
    socket.on('accept_trade', withGame((game, playerId, tradeId) => {
        game.acceptTrade(playerId, tradeId);
    }));
    socket.on('reject_trade', withGame((game, playerId, tradeId) => {
        game.rejectTrade(playerId, tradeId);
    }));
    socket.on('counter_trade', withGame((game, playerId, tradeId, newOffer, newRequest) => {
        if (validateTradeItems(newOffer) && validateTradeItems(newRequest))
            game.counterTrade(playerId, tradeId, newOffer, newRequest);
    }));
    socket.on('disconnect', async () => {
        console.log(`User disconnected: ${socket.id}`);
        try {
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
        }
        catch (e) {
            console.error('[disconnect Error]', e);
        }
    });
});
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

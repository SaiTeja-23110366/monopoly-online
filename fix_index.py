import re

with open('c:/Users/saite/OneDrive/Desktop/monopoly/server/src/index.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Fix P0 #3: add try catch around game actions in index.ts
code = code.replace("""    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;
    game.buyProperty(playerId, propertyIndex, housesToBuy);
    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);""",
"""    try {
      const game = await roomManager.getGame(roomCode);
      if (!game) return;
      const playerId = getPlayerId(game, socket.id);
      if (!playerId) return;
      game.buyProperty(playerId, propertyIndex, housesToBuy);
      await roomManager.saveGame(game);
      io.to(roomCode).emit('game_state_update', game.state);
    } catch (e) {
      console.error(e);
    }""")

with open('c:/Users/saite/OneDrive/Desktop/monopoly/server/src/index.ts', 'w', encoding='utf-8') as f:
    f.write(code)

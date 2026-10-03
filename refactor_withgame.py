import re

with open('server/src/index.ts', 'r') as f:
    content = f.read()

# Make sure MonopolyGame is imported
if 'import { MonopolyGame }' not in content:
    content = content.replace("import { RoomManager } from './roomManager';", "import { RoomManager } from './roomManager';\nimport { MonopolyGame } from './gameState';")

# Replace boilerplate blocks

boilerplate = """    const game = await roomManager.getGame(roomCode);
    if (!game) return;
    const playerId = getPlayerId(game, socket.id);
    if (!playerId) return;"""

# For each handler
def replace_handler(match):
    name = match.group(1)
    args = match.group(2)
    body = match.group(3)
    
    if boilerplate in body:
        # Extract the rest of the body
        rest = body.replace(boilerplate, "")
        
        # Remove trailing save and emit
        save_emit = """    await roomManager.saveGame(game);
    io.to(roomCode).emit('game_state_update', game.state);"""
        save_emit_true = """    await roomManager.saveGame(game, true);
    io.to(roomCode).emit('game_state_update', game.state);"""
        
        # Note: some have 'if (game.someAction()) {' wrapping the save. Let's just do manual string replacements.
        pass
    
    return match.group(0)

# Since there are variations, let's just do it with a script that rewrites the socket block.

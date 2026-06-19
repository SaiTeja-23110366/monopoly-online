const fs = require('fs');

let code = fs.readFileSync('server/src/index.ts', 'utf8');

// Add socketToPlayer map
code = code.replace(
  'const roomManager = new RoomManager();',
  'const roomManager = new RoomManager();\nconst socketToPlayer = new Map<string, string>();'
);

// Update join_room signature and logic
code = code.replace(
  "socket.on('join_room', (roomCode: string, playerName: string, color: string) => {\n    const joined = roomManager.joinRoom(roomCode, socket.id, playerName, color);",
  "socket.on('join_room', (roomCode: string, playerId: string, playerName: string, color: string) => {\n    socketToPlayer.set(socket.id, playerId);\n    const joined = roomManager.joinRoom(roomCode, playerId, playerName, color);"
);

// We need to replace socket.id with playerId inside all event listeners EXCEPT join_room and disconnect.
// The easiest way is to insert a lookup at the top of every other listener.
const listeners = [
  'change_color',
  'start_game',
  'roll_dice',
  'acknowledge_card',
  'execute_sabotage',
  'execute_protection',
  'end_turn',
  'pay_jail_fine',
  'use_jail_card',
  'buy_property',
  'upgrade_property',
  'pass_property',
  'sell_property_to_bank',
  'flight_decision',
  'propose_trade',
  'accept_trade',
  'reject_trade',
  'counter_trade'
];

for (const listener of listeners) {
  // Regex to find: socket.on('listener', (...) => {
  const regex = new RegExp(`(socket\\.on\\('${listener}',\\s*\\([^{]*\\)\\s*=>\\s*\\{)`);
  code = code.replace(regex, `$1\n    const playerId = socketToPlayer.get(socket.id);\n    if (!playerId) return;`);
}

// Now replace socket.id with playerId within those blocks.
// I'll just globally replace `game.method(socket.id` with `game.method(playerId`
code = code.replace(/game\.([a-zA-Z]+)\(socket\.id/g, 'game.$1(playerId');
code = code.replace(/game\.([a-zA-Z]+)\(tradeId,\s*socket\.id/g, 'game.$1(tradeId, playerId'); // for some trading ones if any

// Fix disconnect logic
code = code.replace(
  "socket.on('disconnect', () => {\n    console.log(`User disconnected: ${socket.id}`);\n    // Optional: handle player disconnecting mid-game\n  });",
  "socket.on('disconnect', () => {\n    console.log(`User disconnected: ${socket.id}`);\n    socketToPlayer.delete(socket.id);\n  });"
);

fs.writeFileSync('server/src/index.ts', code);

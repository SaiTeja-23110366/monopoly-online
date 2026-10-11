import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { io } = require('socket.io-client');
const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.SMOKE_PORT ?? 43107);
const url = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/dist/server/src/index.js'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'test', ROOM_STORE: 'memory', PORT: String(port), WEB_CONCURRENCY: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', data => { output += data.toString(); });
child.stderr.on('data', data => { output += data.toString(); });
const sockets = [];
let commands = 0;
async function until(check, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    if (child.exitCode !== null) throw new Error(`Packaged server exited: ${output}`);
    await delay(25);
  }
  throw new Error(`Timed out: ${description}\n${output}`);
}
function request(socket, event, data) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, data, (error, response) => error ? reject(error) : resolve(response));
  });
}
async function client() {
  const socket = io(url, { transports: ['websocket'], autoConnect: false, reconnection: false });
  sockets.push(socket);
  socket.on('game_state_update', state => { socket.latest = state; });
  const connected = once(socket, 'connect');
  socket.connect(); await connected;
  return socket;
}
async function command(socket, value, id = `smoke-command-${++commands}`) {
  const state = socket.latest;
  const envelope = { commandId: id, gameId: state.gameId, expectedVersion: state.version, expectedTurnId: state.turnId, command: value };
  return { envelope, result: await request(socket, 'game_command', envelope) };
}
try {
  await until(async () => { try { return (await fetch(`${url}/readyz`)).ok; } catch { return false; } }, 'packaged server readiness');
  const document = await fetch(url);
  assert.equal(document.status, 200);
  assert.match(await document.text(), /<div id="root">/);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);

  const host = await client();
  const guest = await client();
  const hostJoin = await request(host, 'create_room', { name: 'Smoke Host', color: '#ef4444', admissionSecret: randomBytes(32).toString('base64url') });
  assert.equal(hostJoin.ok, true);
  const guestJoin = await request(guest, 'join_room', { roomCode: hostJoin.session.roomCode, name: 'Smoke Guest', color: '#3b82f6', admissionSecret: randomBytes(32).toString('base64url') });
  assert.equal(guestJoin.ok, true);
  await until(() => host.latest?.players.length === 2 && guest.latest?.players.length === 2, 'both lobby snapshots');

  const unauthorized = await command(guest, { type: 'start_game' });
  assert.equal(unauthorized.result.ok, false);
  assert.equal(unauthorized.result.error.code, 'HOST_ONLY');
  const start = await command(host, { type: 'start_game' });
  assert.equal(start.result.ok, true);
  await until(() => host.latest?.state === 'playing' && guest.latest?.state === 'playing', 'started game synchronization');
  const rolled = await command(host, { type: 'roll_dice' }, 'smoke-roll-once');
  assert.equal(rolled.result.ok, true);
  const duplicate = await request(host, 'game_command', rolled.envelope);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.version, rolled.result.version);
  await until(() => host.latest.phase.kind === 'moving', 'movement phase');
  assert.equal(host.latest.events.filter(event => event.type === 'dice').length, 1);
  const move = host.latest.events.findLast(event => event.type === 'movement');
  assert.ok(move && move.path.length >= 2 && move.path.length <= 12);
  await until(() => !['rolling', 'moving'].includes(host.latest.phase.kind), 'landing decision');
  await until(() => guest.latest.version === host.latest.version, 'two-client final revision');
  assert.deepEqual(guest.latest.players, host.latest.players);

  const savedSeat = guestJoin.session;
  guest.disconnect();
  const rejoined = await client();
  const resume = await request(rejoined, 'resume_session', savedSeat);
  assert.equal(resume.ok, true);
  assert.equal(resume.session.playerId, savedSeat.playerId);
  assert.equal(resume.state.gameId, host.latest.gameId);
  console.log('Packaged production output smoke passed: HTTP assets/readiness, two clients, host authority, one roll, explicit movement, synchronized landing, authenticated resume.');
} finally {
  sockets.forEach(socket => socket.disconnect());
  if (child.exitCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited; clearTimeout(force);
  }
}

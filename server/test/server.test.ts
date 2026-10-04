import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameServer, configuredStore } from '../src/index';
import { MemoryRoomStore, StorageError, type RoomRecord } from '../src/roomStore';
import { RoomManager } from '../src/roomManager';
import { MonopolyGame } from '../src/gameState';
import { PLAYER_COLORS, flightDestinations } from '../../shared/board';
import type { CommandAck, CommandEnvelope, GameCommand, GameState } from '../../shared/types';
import type { ClientEvents, ServerEvents, SessionAck, SessionCredentials } from '../../shared/protocol';

type Client = Socket<ServerEvents, ClientEvents>;
type Success = Extract<SessionAck, { ok: true }>;
const player = (name = 'Ada', color: string = PLAYER_COLORS[0]) => ({ name, color, admissionSecret: randomBytes(32).toString('base64url') });
function success(reply: SessionAck): Success { assert.equal(reply.ok, true, reply.ok ? '' : JSON.stringify(reply.error)); return reply as Success; }
const command = (state: GameState, action: GameCommand, commandId = randomUUID()): CommandEnvelope => ({ commandId, gameId: state.gameId, expectedVersion: state.version, expectedTurnId: state.turnId, command: action });
async function until(check: () => boolean, ms = 2000) { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('Timed out waiting for expected state'); await new Promise(r => setTimeout(r, 5)); } }
class FaultStore extends MemoryRoomStore {
  failNextSave = false;
  failNextDelete = false;
  override async save(code: string, record: RoomRecord, expected: number) { if (this.failNextSave) { this.failNextSave = false; throw new StorageError(); } await super.save(code, record, expected); }
  override async delete(code: string, expected: number) { if (this.failNextDelete) { this.failNextDelete = false; throw new StorageError(); } await super.delete(code, expected); }
}
async function harness(t: { after: (fn: () => Promise<void>) => void }, extra: Parameters<typeof createGameServer>[0] = {}) {
  const store = extra.store ?? new MemoryRoomStore();
  const server = await createGameServer({ store, scheduleTimers: false, logger: () => {}, gameFactory: code => new MonopolyGame(code, { dice: () => [1, 2] }), ...extra });
  const port = await server.listen(0, '127.0.0.1'); const clients: Client[] = [];
  t.after(async () => { for (const client of clients) client.disconnect(); await server.close(); });
  async function client(): Promise<Client> {
    const socket: Client = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    clients.push(socket); socket.connect();
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  async function pair() {
    const host = await client(); const first = success(await host.timeout(2000).emitWithAck('create_room', player()));
    const guest = await client(); const second = success(await guest.timeout(2000).emitWithAck('join_room', { ...player('Grace', PLAYER_COLORS[1]), roomCode: first.session.roomCode }));
    return { host, guest, first, second, state: second.state };
  }
  return { ...server, store, client, pair, url: `http://127.0.0.1:${port}` };
}

test('module import has no side effects and explicit production memory is refused', () => {
  const previous = { node: process.env.NODE_ENV, adapter: process.env.ROOM_STORE, redis: process.env.REDIS_URL };
  try {
    process.env.NODE_ENV = 'production'; process.env.ROOM_STORE = 'memory'; assert.throws(configuredStore, /Production requires Redis/);
    process.env.NODE_ENV = 'test'; process.env.ROOM_STORE = 'redis'; delete process.env.REDIS_URL; assert.throws(configuredStore, /REDIS_URL is required/);
  } finally {
    for (const [name, value] of Object.entries({ NODE_ENV: previous.node, ROOM_STORE: previous.adapter, REDIS_URL: previous.redis })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('two isolated Socket.IO clients receive canonical state with private credentials never broadcast', async t => {
  const h = await harness(t); const { host, first, second, state } = await h.pair();
  assert.notEqual(first.session.playerId, second.session.playerId);
  assert.equal(state.hostId, first.session.playerId); assert.equal(state.players.length, 2);
  assert.equal(state.players.every(p => p.socketId === ''), true);
  assert.equal(JSON.stringify(state).includes(first.session.resumeSecret), false);
  assert.equal(JSON.stringify(state).includes(second.session.resumeSecret), false);
  const observed: GameState[] = []; host.on('game_state_update', value => observed.push(value));
  const ack = await host.emitWithAck('game_command', command(state, { type: 'update_starting_cash', cash: 2500 }));
  assert.equal(ack.ok, true); await until(() => observed.some(s => s.startingCash === 2500));
  assert.equal((await fetch(`${h.url}/readyz`)).status, 200);
});

test('membership, host, cash, start and client timeout are server-authorized', async t => {
  const h = await harness(t); const { host, guest, state } = await h.pair(); const outsider = await h.client();
  const unauthorized = await outsider.emitWithAck('game_command', command(state, { type: 'start_game' }));
  assert.equal(unauthorized.error?.code, 'NOT_AUTHENTICATED');
  const nonHost = await guest.emitWithAck('game_command', command(state, { type: 'start_game' })); assert.equal(nonHost.ok, false);
  const badCash = await host.emitWithAck('game_command', command(state, { type: 'update_starting_cash', cash: -100 })); assert.equal(badCash.ok, false);
  const badFraction = await host.emitWithAck('game_command', command(state, { type: 'update_starting_cash', cash: 1500.5 })); assert.equal(badFraction.ok, false);
  const fakeTimeout = await host.emitWithAck('game_command', command(state, { type: 'timeout', turnId: 0, phaseId: 0 })); assert.equal(fakeTimeout.error?.code, 'FORBIDDEN');
  const start = await host.emitWithAck('game_command', command(state, { type: 'start_game' })); assert.equal(start.ok, true);
  const repeated = await host.emitWithAck('game_command', command(start.state!, { type: 'start_game' })); assert.equal(repeated.ok, false);
  assert.deepEqual((await h.rooms.inspect(state.roomCode)).players.map(p => p.money), [1500, 1500]);
});

test('public player IDs cannot resume or take over a seat, even after match starts', async t => {
  const h = await harness(t); const { host, first, state } = await h.pair(); const attacker = await h.client();
  const bad = await attacker.emitWithAck('resume_session', { ...first.session, resumeSecret: 'a'.repeat(43) }); assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.error.code, 'INVALID_SESSION');
  const missing = await attacker.emitWithAck('resume_session', { roomCode: first.session.roomCode, playerId: first.session.playerId } as SessionCredentials); assert.equal(missing.ok, false);
  const start = await host.emitWithAck('game_command', command(state, { type: 'start_game' })); assert.equal(start.ok, true);
  const joined = await attacker.emitWithAck('join_room', { ...player('Intruder'), roomCode: state.roomCode }); assert.equal(joined.ok, false);
  assert.equal((await h.rooms.inspect(state.roomCode)).players.length, 2);
});

test('authenticated resume replaces previous socket; old disconnect cannot mark new seat offline', async t => {
  const h = await harness(t); const { host, first, state } = await h.pair(); const replacement = await h.client();
  let replaced = false; host.on('session_replaced', () => { replaced = true; });
  const resumed = success(await replacement.emitWithAck('resume_session', first.session)); await until(() => replaced && !host.connected);
  assert.equal(resumed.session.playerId, first.session.playerId);
  const view = await h.rooms.inspect(state.roomCode); assert.equal(view.players.find(p => p.id === first.session.playerId)?.connected, true);
  const ack = await replacement.emitWithAck('game_command', command(view, { type: 'update_starting_cash', cash: 2000 })); assert.equal(ack.ok, true);
});

test('one socket cannot bind multiple rooms and an acknowledged leave removes subscription', async t => {
  const h = await harness(t); const { host, guest, state } = await h.pair();
  const denied = await host.emitWithAck('create_room', player('Other')); assert.equal(denied.ok, false);
  const leaveRequest = command(state, { type: 'leave_game' });
  const left = await host.emitWithAck('game_command', leaveRequest); assert.equal(left.ok, true);
  const repeated = await host.emitWithAck('game_command', leaveRequest); assert.equal(repeated.ok, true); assert.equal(repeated.version, left.version);
  const fresh = success(await host.emitWithAck('create_room', player('New'))); assert.notEqual(fresh.session.roomCode, state.roomCode);
  let leaked = false; host.on('game_state_update', update => { if (update.roomCode === state.roomCode) leaked = true; });
  const oldState = await h.rooms.inspect(state.roomCode); const ack = await guest.emitWithAck('game_command', command(oldState, { type: 'update_starting_cash', cash: 3000 })); assert.equal(ack.ok, true);
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(leaked, false);
});

test('duplicate, simultaneous and stale commands commit only one legal transition', async t => {
  const h = await harness(t); const { host, state } = await h.pair();
  const start = await host.emitWithAck('game_command', command(state, { type: 'start_game' }));
  const roll = command(start.state!, { type: 'roll_dice' });
  const [one, duplicate, competing] = await Promise.all([
    host.emitWithAck('game_command', roll), host.emitWithAck('game_command', roll),
    host.emitWithAck('game_command', command(start.state!, { type: 'end_turn' })),
  ]);
  assert.equal(one.ok, true); assert.equal(duplicate.ok, true); assert.equal(duplicate.version, one.version); assert.equal(competing.error?.code, 'STALE_STATE');
  const changed = await host.emitWithAck('game_command', { ...roll, command: { type: 'end_turn' } }); assert.equal(changed.error?.code, 'COMMAND_ID_REUSED');
  const current = await h.rooms.inspect(state.roomCode); assert.equal(current.phase.kind, 'rolling'); assert.equal(current.version, start.state!.version + 1);
  const wrongGame = await host.emitWithAck('game_command', { ...command(current, { type: 'end_turn' }), gameId: randomUUID() }); assert.equal(wrongGame.error?.code, 'WRONG_GAME');
});

test('pending trade survives full rounds and reconnect while fresh acceptance keeps command guards and dedupe', async t => {
  let now = 100_000;
  const h = await harness(t, { now: () => now, store: new MemoryRoomStore(() => now),
    gameFactory: code => new MonopolyGame(code, { now: () => now, dice: () => [1, 2] }) });
  const { host, guest, first, second, state: lobby } = await h.pair();
  const started = await host.emitWithAck('game_command', command(lobby, { type: 'start_game' })); assert.equal(started.ok, true);
  const proposal = command(started.state!, { type: 'propose_trade', targetId: second.session.playerId,
    offer: { money: 100, properties: [], getOutOfJailCards: 0 }, request: { money: 25, properties: [], getOutOfJailCards: 0 } });
  const proposed = await host.emitWithAck('game_command', proposal); assert.equal(proposed.ok, true);
  let state = proposed.state!;
  const tradeId = state.activeTradeId!; const pending = structuredClone(state.trades[tradeId]);
  const staleAccept = command(state, { type: 'accept_trade', tradeId }); const originalTurn = state.turnId;
  async function deadline() {
    assert.notEqual(state.turnDeadline, undefined);
    now = state.turnDeadline! + 1; await h.rooms.reconcile(state.roomCode); state = await h.rooms.inspect(state.roomCode);
    assert.deepEqual(state.trades[tradeId], pending); assert.equal(state.activeTradeId, tradeId);
  }
  const rolled = await host.emitWithAck('game_command', command(state, { type: 'roll_dice' })); assert.equal(rolled.ok, true); state = rolled.state!;
  for (let phases = 0; state.phase.kind !== 'awaiting_end'; phases++) { assert.ok(phases < 10); await deadline(); }
  const ended = await host.emitWithAck('game_command', command(state, { type: 'end_turn' })); assert.equal(ended.ok, true); state = ended.state!;
  assert.deepEqual(state.trades[tradeId], pending);
  let offline = false; host.on('game_state_update', update => { if (update.players.find(p => p.id === second.session.playerId)?.connected === false) offline = true; });
  guest.disconnect(); await until(() => offline); state = await h.rooms.inspect(state.roomCode);
  // Two complete rounds include manual and automatic turn endings and normal cash changes from tax.
  for (let phases = 0; state.turnId < originalTurn + 4; phases++) { assert.ok(phases < 30); await deadline(); }
  assert.equal(state.turnId, originalTurn + 4); assert.equal(state.players[state.turnIndex].id, first.session.playerId);
  assert.ok(state.players.every(p => p.money < lobby.startingCash));
  const replacement = await h.client(); const resumed = success(await replacement.emitWithAck('resume_session', second.session)); state = resumed.state;
  assert.deepEqual(state.trades[tradeId], pending); assert.equal(state.activeTradeId, tradeId);
  const beforeGuards = await h.rooms.inspect(state.roomCode);
  const stale = await replacement.emitWithAck('game_command', staleAccept); assert.equal(stale.error?.code, 'STALE_STATE');
  const staleTurn = await replacement.emitWithAck('game_command', { ...command(state, { type: 'accept_trade', tradeId }), expectedTurnId: originalTurn });
  assert.equal(staleTurn.error?.code, 'STALE_STATE');
  const wrongGame = await replacement.emitWithAck('game_command', { ...command(state, { type: 'accept_trade', tradeId }), gameId: randomUUID() });
  assert.equal(wrongGame.error?.code, 'WRONG_GAME');
  const wrongRecipient = await host.emitWithAck('game_command', command(state, { type: 'accept_trade', tradeId })); assert.equal(wrongRecipient.error?.code, 'TRADE_TARGET_ONLY');
  assert.deepEqual(await h.rooms.inspect(state.roomCode), beforeGuards);
  const balances = state.players.map(p => p.money); const accept = command(state, { type: 'accept_trade', tradeId });
  const accepted = await replacement.emitWithAck('game_command', accept); assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.state!.players.map(p => p.money), [balances[0] - 75, balances[1] + 75]);
  assert.equal(accepted.state!.trades[tradeId].status, 'accepted');
  const afterAcceptance = await h.rooms.inspect(state.roomCode);
  const replay = await replacement.emitWithAck('game_command', accept); assert.equal(replay.ok, true); assert.equal(replay.version, accepted.version);
  const proposalReplay = await host.emitWithAck('game_command', proposal); assert.equal(proposalReplay.ok, true); assert.equal(proposalReplay.version, proposed.version);
  const duplicate = await replacement.emitWithAck('game_command', command(accepted.state!, { type: 'accept_trade', tradeId })); assert.equal(duplicate.error?.code, 'TRADE_NOT_PENDING');
  assert.deepEqual(await h.rooms.inspect(state.roomCode), afterAcceptance);
});

test('manager restart retains an unfulfillable pending property offer until current assets allow fresh acceptance', async () => {
  let now = 100_000; const store = new MemoryRoomStore(() => now);
  const options = { store, now: () => now, scheduleTimers: false,
    gameFactory: (code: string) => new MonopolyGame(code, { now: () => now, dice: (): [number, number] => [1, 3] }) };
  let manager = new RoomManager(options); await manager.start();
  try {
    const first = success(await manager.createRoom('a', player()));
    const second = success(await manager.joinRoom('b', { ...player('Grace', PLAYER_COLORS[1]), roomCode: first.state.roomCode }));
    let state = second.state;
    async function act(socket: string, session: SessionCredentials, action: GameCommand) {
      const ack = await manager.execute(socket, session, command(state, action)); assert.equal(ack.ok, true, JSON.stringify(ack.error)); state = ack.state!; return ack;
    }
    async function deadline() { assert.notEqual(state.turnDeadline, undefined); now = state.turnDeadline! + 1; await manager.reconcile(state.roomCode); state = await manager.inspect(state.roomCode); }
    await act('a', first.session, { type: 'start_game' }); await act('a', first.session, { type: 'roll_dice' });
    await deadline(); await deadline(); assert.equal(state.phase.kind, 'buy');
    await act('a', first.session, { type: 'buy_property', propertyIndex: 4, housesToBuy: 1 });
    await act('a', first.session, { type: 'propose_trade', targetId: second.session.playerId,
      offer: { money: 0, properties: [4], getOutOfJailCards: 0 }, request: { money: 200, properties: [], getOutOfJailCards: 0 } });
    const tradeId = state.activeTradeId!; const pending = structuredClone(state.trades[tradeId]); const originalTurn = state.turnId;
    await act('a', first.session, { type: 'propose_trade', targetId: second.session.playerId,
      offer: { money: 0, properties: [4], getOutOfJailCards: 0 }, request: { money: 0, properties: [], getOutOfJailCards: 0 } });
    await act('b', second.session, { type: 'accept_trade', tradeId: state.activeTradeId! });
    assert.equal(state.properties[4].ownerId, second.session.playerId); assert.deepEqual(state.trades[tradeId], pending);
    for (let phases = 0; state.turnId < originalTurn + 2; phases++) { assert.ok(phases < 20); await deadline(); assert.deepEqual(state.trades[tradeId], pending); }
    await manager.close(); manager = new RoomManager(options); await manager.start();
    success(await manager.resumeSession('new-a', first.session)); state = success(await manager.resumeSession('new-b', second.session)).state;
    assert.equal(state.turnId, originalTurn + 2); assert.deepEqual(state.trades[tradeId], pending);
    assert.equal(state.properties[4].ownerId, second.session.playerId); assert.equal(state.properties[4].houses, 1);
    const cannotAccept = command(state, { type: 'accept_trade', tradeId });
    const failed = await manager.execute('new-b', second.session, cannotAccept); assert.equal(failed.error?.code, 'INVALID_TRADE_PROPERTIES');
    assert.deepEqual(await manager.inspect(state.roomCode), state);
    // Return the asset through a separate legal trade; an old failed command must stay failed.
    await act('new-b', second.session, { type: 'propose_trade', targetId: first.session.playerId,
      offer: { money: 0, properties: [4], getOutOfJailCards: 0 }, request: { money: 0, properties: [], getOutOfJailCards: 0 } });
    await act('new-a', first.session, { type: 'accept_trade', tradeId: state.activeTradeId! });
    const retriedFailure = await manager.execute('new-b', second.session, cannotAccept);
    assert.equal(retriedFailure.error?.code, 'INVALID_TRADE_PROPERTIES'); assert.equal(retriedFailure.version, failed.version);
    assert.deepEqual(await manager.inspect(state.roomCode), state); assert.deepEqual(state.trades[tradeId], pending);
    const balances = state.players.map(p => p.money);
    await act('new-b', second.session, { type: 'accept_trade', tradeId });
    assert.equal(state.trades[tradeId].status, 'accepted'); assert.equal(state.properties[4].ownerId, second.session.playerId); assert.equal(state.properties[4].houses, 1);
    assert.deepEqual(state.players.map(p => p.money), [balances[0] + 200, balances[1] - 200]);
  } finally { await manager.close(); }
});

test('failed durable commit does not mutate, broadcast or acknowledge success; same command retries safely', async t => {
  const store = new FaultStore(); const h = await harness(t, { store }); const { host, guest, state } = await h.pair();
  let broadcasts = 0; guest.on('game_state_update', () => { broadcasts++; });
  const request = command(state, { type: 'update_starting_cash', cash: 4000 }); store.failNextSave = true;
  const failed = await host.emitWithAck('game_command', request); assert.equal(failed.ok, false); assert.equal(failed.error?.code, 'STORAGE_UNAVAILABLE');
  assert.deepEqual(await h.rooms.inspect(state.roomCode), state); assert.equal(broadcasts, 0);
  const retried = await host.emitWithAck('game_command', request); assert.equal(retried.ok, true); assert.equal(retried.state?.startingCash, 4000);
  await until(() => broadcasts === 1);
});

test('failed join and last-member leave preserve membership and room until storage succeeds', async t => {
  const store = new FaultStore(); const h = await harness(t, { store }); const host = await h.client();
  const first = success(await host.emitWithAck('create_room', player())); const guest = await h.client();
  store.failNextSave = true; const joined = await guest.emitWithAck('join_room', { ...player('Guest'), roomCode: first.state.roomCode }); assert.equal(joined.ok, false);
  assert.equal((await h.rooms.inspect(first.state.roomCode)).players.length, 1);
  store.failNextDelete = true; const leave = command(first.state, { type: 'leave_game' });
  assert.equal((await host.emitWithAck('game_command', leave)).ok, false);
  assert.equal((await h.rooms.inspect(first.state.roomCode)).players.length, 1);
  assert.equal((await host.emitWithAck('game_command', leave)).ok, true);
  await assert.rejects(h.rooms.inspect(first.state.roomCode), /not found/);
  assert.deepEqual(await store.list(), []);
});

test('concurrent cold joins serialize and retain every admitted member with distinct colors', async () => {
  const store = new MemoryRoomStore(); let manager = new RoomManager({ store, scheduleTimers: false }); await manager.start();
  const first = success(await manager.createRoom('first', player())); await manager.close();
  manager = new RoomManager({ store, scheduleTimers: false }); await manager.start();
  try {
    const results = await Promise.all(Array.from({ length: 7 }, (_, n) => manager.joinRoom(`socket${n}`, { ...player(`Player ${n}`), roomCode: first.state.roomCode })));
    assert.equal(results.every(result => result.ok), true);
    const state = await manager.inspect(first.state.roomCode); assert.equal(state.players.length, 8); assert.equal(new Set(state.players.map(p => p.color)).size, 8);
    await assert.rejects(manager.joinRoom('overflow', { ...player('Ninth'), roomCode: first.state.roomCode }), /8 players/);
  } finally { await manager.close(); }
});

test('restart recovers durable phase, dedupe and overdue timeout without rerolling or double execution', async () => {
  let now = 100_000; const store = new MemoryRoomStore(() => now); let rolls = 0;
  const options = { store, now: () => now, scheduleTimers: false, gameFactory: (code: string) => new MonopolyGame(code, { now: () => now, dice: (): [number, number] => { rolls++; return [1, 2]; } }) };
  let manager = new RoomManager(options); await manager.start();
  const first = success(await manager.createRoom('a', player())); success(await manager.joinRoom('b', { ...player('Guest', PLAYER_COLORS[1]), roomCode: first.state.roomCode }));
  let state = await manager.inspect(first.state.roomCode); let ack = await manager.execute('a', first.session, command(state, { type: 'start_game' }));
  const request = command(ack.state!, { type: 'roll_dice' }); ack = await manager.execute('a', first.session, request); assert.equal(ack.ok, true); assert.equal(rolls, 1);
  now = ack.state!.turnDeadline! + 1; await manager.close();
  manager = new RoomManager(options); await manager.start();
  try {
    success(await manager.resumeSession('new-a', first.session));
    const duplicate = await manager.execute('new-a', first.session, request); assert.equal(duplicate.ok, true); assert.equal(duplicate.version, ack.version); assert.equal(rolls, 1);
    await manager.reconcile(first.state.roomCode); state = await manager.inspect(first.state.roomCode); assert.notEqual(state.phase.kind, 'rolling'); assert.equal(rolls, 1);
    const version = state.version; await manager.reconcile(first.state.roomCode); assert.equal((await manager.inspect(first.state.roomCode)).version, version);
  } finally { await manager.close(); }
});

test('restart narrows legacy flight choices without losing the room or accepting the airport', async () => {
  for (const [airport, next] of [[6,21], [21,34], [34,45], [45,6]]) {
    const now = 100_000; const store = new MemoryRoomStore(() => now);
    const options = { store, now: () => now, scheduleTimers: false };
    let manager = new RoomManager(options); await manager.start();
    const first = success(await manager.createRoom('a', player()));
    success(await manager.joinRoom('b', { ...player('Guest', PLAYER_COLORS[1]), roomCode: first.state.roomCode }));
    const started = await manager.execute('a', first.session, command(await manager.inspect(first.state.roomCode), { type: 'start_game' }));
    assert.equal(started.ok, true); await manager.close();
    const saved = (await store.load(first.state.roomCode))!; const previous = saved.storageVersion;
    const actor = saved.state.players[0]; actor.position = airport;
    saved.state.properties[airport].ownerId = actor.id;
    saved.state.phase = { kind: 'flight', playerId: actor.id, airportId: airport, destinations: [...flightDestinations(airport), next], ticketPrice: 0 };
    saved.state.turnDeadline = now + 25_000; saved.state.phaseId++; saved.state.version++; saved.storageVersion++;
    await store.save(first.state.roomCode, saved, previous);
    manager = new RoomManager(options); await manager.start();
    try {
      const resumed = success(await manager.resumeSession('new-a', first.session));
      assert.equal(resumed.state.phase.kind, 'flight');
      if (resumed.state.phase.kind === 'flight') assert.deepEqual(resumed.state.phase.destinations, flightDestinations(airport));
      assert.equal(resumed.state.turnDeadline, saved.state.turnDeadline);
      assert.deepEqual(resumed.state.properties, saved.state.properties);
      assert.equal(resumed.state.players[0].money, actor.money);
      const denied = await manager.execute('new-a', first.session, command(resumed.state, { type: 'flight_decision', destinationIndex: next }));
      assert.equal(denied.ok, false); assert.equal(denied.error?.code, 'INVALID_DESTINATION');
      const current = await manager.inspect(first.state.roomCode);
      const accepted = await manager.execute('new-a', first.session, command(current, { type: 'flight_decision', destinationIndex: (next + 55) % 56 }));
      assert.equal(accepted.ok, true); assert.equal(accepted.state!.players[0].flightChances, 0);
      assert.equal(accepted.state!.properties[next].ownerId, null);
    } finally { await manager.close(); }
  }
});

test('restart preserves legacy and balanced economies without rewriting balances or pending offers', async () => {
  for (const rulesVersion of [undefined, 2, 3] as const) {
    let now = 100_000; const store = new MemoryRoomStore(() => now);
    const options = { store, now: () => now, scheduleTimers: false,
      gameFactory: (code: string) => new MonopolyGame(code, { now: () => now, dice: (): [number, number] => [1, 2] }) };
    let manager = new RoomManager(options); await manager.start();
    const first = success(await manager.createRoom('a', player()));
    const second = success(await manager.joinRoom('b', { ...player('Guest', PLAYER_COLORS[1]), roomCode: first.state.roomCode }));
    assert.equal(first.state.rulesVersion, 3, 'new rooms always use the balanced economy');
    const started = await manager.execute('a', first.session, command(second.state, { type: 'start_game' }));
    const offered = await manager.execute('a', first.session, command(started.state!, { type: 'propose_trade', targetId: second.session.playerId,
      offer: { money: 100, properties: [], getOutOfJailCards: 0 }, request: { money: 0, properties: [], getOutOfJailCards: 0 } }));
    assert.equal(offered.ok, true); await manager.close();
    const saved = (await store.load(first.state.roomCode))!; const previous = saved.storageVersion;
    if (rulesVersion === undefined) delete saved.state.rulesVersion; else saved.state.rulesVersion = rulesVersion;
    saved.state.players[0].position = 54; saved.state.properties[10].ownerId = first.session.playerId;
    saved.state.version++; saved.storageVersion++; await store.save(first.state.roomCode, saved, previous);
    manager = new RoomManager(options); await manager.start();
    try {
      const resumed = success(await manager.resumeSession('new-a', first.session));
      assert.equal(resumed.state.rulesVersion, rulesVersion);
      assert.deepEqual(resumed.state.properties, saved.state.properties);
      assert.deepEqual(resumed.state.trades, saved.state.trades);
      assert.deepEqual(resumed.state.players.map(p => p.money), saved.state.players.map(p => p.money));
      const roll = await manager.execute('new-a', first.session, command(resumed.state, { type: 'roll_dice' }));
      assert.equal(roll.ok, true); now = roll.state!.turnDeadline!; await manager.reconcile(first.state.roomCode);
      const moved = await manager.inspect(first.state.roomCode);
      assert.equal(moved.players[0].money, 1500 + (rulesVersion === 3 ? 225 : 950));
      assert.equal(moved.players[0].position, 1);
      assert.deepEqual(moved.trades, saved.state.trades);
      assert.equal(moved.rulesVersion, rulesVersion);
    } finally { await manager.close(); }
  }
});

test('presence has reconnect grace; only a connected member receives host authority', async () => {
  let now = 1000; const store = new MemoryRoomStore(() => now); const manager = new RoomManager({ store, now: () => now, scheduleTimers: false, hostGraceMs: 100 }); await manager.start();
  try {
    const first = success(await manager.createRoom('a', player())); const second = success(await manager.joinRoom('b', { ...player('Guest', PLAYER_COLORS[1]), roomCode: first.state.roomCode }));
    await manager.disconnect('a', first.session); now += 99; await manager.reconcile(first.state.roomCode); assert.equal((await manager.inspect(first.state.roomCode)).hostId, first.session.playerId);
    now += 2; await manager.reconcile(first.state.roomCode); assert.equal((await manager.inspect(first.state.roomCode)).hostId, second.session.playerId);
    success(await manager.resumeSession('a2', first.session)); await manager.disconnect('a', first.session); assert.equal((await manager.inspect(first.state.roomCode)).players.find(p => p.id === first.session.playerId)?.connected, true);
  } finally { await manager.close(); }
});

test('expired rooms are deleted, capacity is bounded, and malformed payloads fail without mutation', async () => {
  let now = 1000; const store = new MemoryRoomStore(() => now); const manager = new RoomManager({ store, now: () => now, scheduleTimers: false, roomTtlMs: 1000, maxRooms: 1 }); await manager.start();
  try {
    const first = success(await manager.createRoom('a', player()));
    await assert.rejects(manager.createRoom('b', player()), /capacity/);
    await assert.rejects(manager.execute('a', first.session, { commandId: randomUUID(), command: { type: 'roll_dice' } }), /format/);
    await assert.rejects(manager.execute('a', first.session, { ...command(first.state, { type: 'start_game' }), expectedVersion: undefined }), /version/);
    assert.deepEqual(await manager.inspect(first.state.roomCode), first.state);
    now += 1001; await assert.rejects(manager.inspect(first.state.roomCode), /expired/); assert.deepEqual(await store.list(), []);
    assert.equal((await manager.createRoom('b', player())).ok, true);
  } finally { await manager.close(); }
});

test('ambiguous committed response is confirmed by readback rather than duplicated or wedged', async t => {
  class AppliedThenFailedStore extends MemoryRoomStore {
    failAfterWrite = false;
    override async save(code: string, record: RoomRecord, expected: number) { await super.save(code, record, expected); if (this.failAfterWrite) { this.failAfterWrite = false; throw new StorageError(); } }
  }
  const store = new AppliedThenFailedStore(); const h = await harness(t, { store }); const { host, state } = await h.pair();
  store.failAfterWrite = true; const request = command(state, { type: 'update_starting_cash', cash: 5000 });
  const first = await host.emitWithAck('game_command', request); assert.equal(first.ok, true); assert.equal(first.state?.startingCash, 5000);
  const retry = await host.emitWithAck('game_command', request); assert.equal(retry.ok, true); assert.equal(retry.version, first.version);
  assert.equal((await h.rooms.inspect(state.roomCode)).version, state.version + 1);
});

test('unconfirmed ambiguous commit reloads durable receipt before retry and preserves live authority', async t => {
  class InterruptedStore extends MemoryRoomStore {
    failAfterWrite = false; failRead = false;
    override async save(code: string, record: RoomRecord, expected: number) { await super.save(code, record, expected); if (this.failAfterWrite) { this.failAfterWrite = false; this.failRead = true; throw new StorageError(); } }
    override async load(code: string) { if (this.failRead) { this.failRead = false; throw new StorageError(); } return super.load(code); }
  }
  const store = new InterruptedStore(); const h = await harness(t, { store }); const { host, state } = await h.pair();
  store.failAfterWrite = true; const request = command(state, { type: 'update_starting_cash', cash: 4500 });
  const uncertain = await host.emitWithAck('game_command', request); assert.equal(uncertain.error?.code, 'STORAGE_UNAVAILABLE');
  const retry = await host.emitWithAck('game_command', request); assert.equal(retry.ok, true); assert.equal(retry.version, state.version + 1);
  const current = await h.rooms.inspect(state.roomCode); assert.equal(current.startingCash, 4500);
  const followOn = await host.emitWithAck('game_command', command(current, { type: 'update_starting_cash', cash: 3000 })); assert.equal(followOn.ok, true);
});

test('lost session acknowledgement can be retried on the same socket without a duplicate seat', async t => {
  const h = await harness(t); const host = await h.client();
  const requestProfile = player();
  const first = success(await host.emitWithAck('create_room', requestProfile));
  const recovered = success(await host.emitWithAck('create_room', requestProfile));
  assert.deepEqual(recovered.session, first.session); assert.equal(recovered.state.players.length, 1);
  const guest = await h.client(); const request = { ...player('Guest', PLAYER_COLORS[1]), roomCode: first.state.roomCode };
  const joined = success(await guest.emitWithAck('join_room', request)); const again = success(await guest.emitWithAck('join_room', request));
  assert.deepEqual(again.session, joined.session); assert.equal(again.state.players.length, 2);
});

test('an ambiguous join retry recovers original seat and private credential instead of a ghost member', async t => {
  class InterruptedStore extends MemoryRoomStore {
    failAfterWrite = false; failRead = false;
    override async save(code: string, record: RoomRecord, expected: number) { await super.save(code, record, expected); if (this.failAfterWrite) { this.failAfterWrite = false; this.failRead = true; throw new StorageError(); } }
    override async load(code: string) { if (this.failRead) { this.failRead = false; throw new StorageError(); } return super.load(code); }
  }
  const store = new InterruptedStore(); const h = await harness(t, { store }); const host = await h.client();
  const first = success(await host.emitWithAck('create_room', player())); const guest = await h.client();
  const request = { ...player('Guest', PLAYER_COLORS[1]), roomCode: first.state.roomCode };
  store.failAfterWrite = true; const uncertain = await guest.emitWithAck('join_room', request); assert.equal(uncertain.ok, false);
  const recovered = success(await guest.emitWithAck('join_room', request));
  assert.equal(recovered.state.players.length, 2); assert.equal(recovered.state.players.filter(p => p.name === 'Guest').length, 1);
  assert.equal(Object.keys((await store.load(first.state.roomCode))!.sessions).length, 2);
});

test('ambiguous leave recovers durable receipt even though membership was already revoked', async t => {
  class InterruptedStore extends MemoryRoomStore {
    failAfterWrite = false; failRead = false;
    override async save(code: string, record: RoomRecord, expected: number) { await super.save(code, record, expected); if (this.failAfterWrite) { this.failAfterWrite = false; this.failRead = true; throw new StorageError(); } }
    override async load(code: string) { if (this.failRead) { this.failRead = false; throw new StorageError(); } return super.load(code); }
  }
  const store = new InterruptedStore(); const h = await harness(t, { store }); const { host, state } = await h.pair();
  const request = command(state, { type: 'leave_game' }); store.failAfterWrite = true;
  assert.equal((await host.emitWithAck('game_command', request)).ok, false);
  assert.equal((await host.emitWithAck('game_command', request)).ok, true);
  const fresh = success(await host.emitWithAck('create_room', player('Fresh'))); assert.notEqual(fresh.state.roomCode, state.roomCode);
  assert.equal((await h.rooms.inspect(state.roomCode)).players.length, 1);
});

test('ended and bankrupt spectators can revoke their seat without changing match outcome', async t => {
  let now = 1000; const store = new MemoryRoomStore(() => now);
  const h = await harness(t, { store, now: () => now, gameFactory: code => new MonopolyGame(code, { now: () => now }) });
  const { host, guest, first, state } = await h.pair(); const third = await h.client();
  const joined = success(await third.emitWithAck('join_room', { ...player('Third', PLAYER_COLORS[2]), roomCode: state.roomCode }));
  const started = await host.emitWithAck('game_command', command(joined.state, { type: 'start_game' })); assert.equal(started.ok, true);
  // A normal forfeit produces a stable historical player; the remaining match continues.
  const left = await host.emitWithAck('game_command', command(started.state!, { type: 'leave_game' })); assert.equal(left.ok, true);
  const current = await h.rooms.inspect(state.roomCode); assert.equal(current.state, 'playing');
  const ended = await guest.emitWithAck('game_command', command(current, { type: 'leave_game' })); assert.equal(ended.ok, true); assert.equal(ended.state?.state, 'ended');
  const winner = ended.state!.winnerId; const lastLeave = await third.emitWithAck('game_command', command(ended.state!, { type: 'leave_game' })); assert.equal(lastLeave.ok, true); assert.equal(lastLeave.state?.winnerId, winner);
  assert.equal((await third.emitWithAck('resume_session', first.session)).ok, false);
  now++;
});

test('bankrupt spectator can leave a live match and revoke resume without altering active turn', async () => {
  const store = new MemoryRoomStore(); let manager = new RoomManager({ store, scheduleTimers: false }); await manager.start();
  const first = success(await manager.createRoom('a', player()));
  const second = success(await manager.joinRoom('b', { ...player('Second', PLAYER_COLORS[1]), roomCode: first.state.roomCode }));
  success(await manager.joinRoom('c', { ...player('Third', PLAYER_COLORS[2]), roomCode: first.state.roomCode }));
  const started = await manager.execute('a', first.session, command(await manager.inspect(first.state.roomCode), { type: 'start_game' })); assert.equal(started.ok, true); await manager.close();
  const saved = (await store.load(first.state.roomCode))!; const previousVersion = saved.storageVersion;
  const bankrupt = saved.state.players.find(p => p.id === first.session.playerId)!; bankrupt.status = 'bankrupt'; bankrupt.money = 0;
  saved.state.hostId = second.session.playerId; saved.state.turnIndex = 1; saved.state.phase = { kind: 'awaiting_roll', playerId: second.session.playerId }; saved.state.turnId++; saved.state.phaseId++; saved.state.version++; saved.storageVersion++;
  await store.save(first.state.roomCode, saved, previousVersion);
  manager = new RoomManager({ store, scheduleTimers: false }); await manager.start();
  try {
    const resumed = success(await manager.resumeSession('again', first.session)); const before = resumed.state;
    const leave = await manager.execute('again', first.session, command(before, { type: 'leave_game' })); assert.equal(leave.ok, true);
    assert.deepEqual(leave.state!.phase, before.phase); assert.equal(leave.state!.turnId, before.turnId); assert.equal(leave.state!.players.find(p => p.id === first.session.playerId)?.status, 'bankrupt');
    await assert.rejects(manager.resumeSession('forged', first.session), /could not be verified/);
  } finally { await manager.close(); }
});

test('disconnect cleans an unresolved committed admission and marks the seat offline', async t => {
  class InterruptedStore extends MemoryRoomStore {
    failAfterWrite = false; failRead = false;
    override async save(code: string, record: RoomRecord, expected: number) { await super.save(code, record, expected); if (this.failAfterWrite) { this.failAfterWrite = false; this.failRead = true; throw new StorageError(); } }
    override async load(code: string) { if (this.failRead) { this.failRead = false; throw new StorageError(); } return super.load(code); }
  }
  const store = new InterruptedStore(); const h = await harness(t, { store }); const host = await h.client();
  const first = success(await host.emitWithAck('create_room', player())); const guest = await h.client();
  store.failAfterWrite = true;
  const uncertain = await guest.emitWithAck('join_room', { ...player('Guest', PLAYER_COLORS[1]), roomCode: first.state.roomCode }); assert.equal(uncertain.ok, false);
  let offline = false; host.on('game_state_update', state => { if (state.players.some(p => p.name === 'Guest' && p.connected === false)) offline = true; });
  guest.disconnect(); await until(() => offline);
  assert.equal((await h.rooms.inspect(first.state.roomCode)).players.find(p => p.name === 'Guest')?.connected, false);
});

test('private admission proof recovers initial ACK loss across a new socket without a duplicate seat', async t => {
  const h = await harness(t); const original = await h.client(); const request = player('Proof owner');
  // Intentionally ignore the private response: simulate loss of the first acknowledgement.
  let response: SessionAck | undefined; original.emit('create_room', request, reply => { response = reply; });
  await until(() => response !== undefined); const durable = success(response!); original.disconnect();
  const recovery = await h.client(); const resumed = success(await recovery.emitWithAck('create_room', request));
  assert.equal(resumed.session.playerId, durable.session.playerId); assert.equal(resumed.state.roomCode, durable.state.roomCode); assert.equal(resumed.state.players.length, 1);
  assert.notEqual(resumed.session.resumeSecret, durable.session.resumeSecret);
  assert.equal(JSON.stringify(resumed.state).includes(request.admissionSecret), false);
  const wrong = await h.client(); const conflict = await wrong.emitWithAck('create_room', { ...request, name: 'Altered' }); assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.error.code, 'ADMISSION_CONFLICT');
  const stranger = success(await wrong.emitWithAck('create_room', player('Proof owner'))); assert.notEqual(stranger.session.playerId, durable.session.playerId);
});

test('persisted admission proof recovers create and join after restart, including assigned color and started match', async () => {
  const store = new MemoryRoomStore(); let manager = new RoomManager({ store, scheduleTimers: false }); await manager.start();
  const createRequest = player('Host'); const first = success(await manager.createRoom('a', createRequest));
  const joinRequest = { ...player('Guest'), roomCode: first.state.roomCode }; const second = success(await manager.joinRoom('b', joinRequest));
  assert.notEqual(second.state.players.find(p => p.id === second.session.playerId)?.color, joinRequest.color);
  const start = await manager.execute('a', first.session, command(second.state, { type: 'start_game' })); assert.equal(start.ok, true); await manager.close();
  manager = new RoomManager({ store, scheduleTimers: false }); await manager.start();
  try {
    const resumedHost = success(await manager.createRoom('new-a', createRequest)); assert.equal(resumedHost.session.roomCode, first.session.roomCode); assert.equal(resumedHost.session.playerId, first.session.playerId);
    const resumedGuest = success(await manager.joinRoom('new-b', joinRequest)); assert.equal(resumedGuest.session.playerId, second.session.playerId); assert.equal(resumedGuest.state.players.length, 2); assert.equal(resumedGuest.state.state, 'playing');
    assert.equal(resumedGuest.state.players.find(p => p.id === second.session.playerId)?.color, second.state.players.find(p => p.id === second.session.playerId)?.color);
    await assert.rejects(manager.resumeSession('stale', second.session), /could not be verified/);
  } finally { await manager.close(); }
});

test('one admission proof cannot race into two different rooms or request kinds', async () => {
  const manager = new RoomManager({ store: new MemoryRoomStore(), scheduleTimers: false }); await manager.start();
  try {
    const first = success(await manager.createRoom('a', player('A'))); const second = success(await manager.createRoom('b', player('B')));
    const details = player('Concurrent');
    const results = await Promise.allSettled([
      manager.joinRoom('one', { ...details, roomCode: first.state.roomCode }),
      manager.joinRoom('two', { ...details, roomCode: second.state.roomCode }),
      manager.createRoom('three', details),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await manager.inspect(first.state.roomCode)).players.length + (await manager.inspect(second.state.roomCode)).players.length, 3);
  } finally { await manager.close(); }
});

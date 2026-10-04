import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { RedisRoomStore, StorageConflictError, type RoomRecord } from '../src/roomStore';
import { RoomManager } from '../src/roomManager';
import { MonopolyGame } from '../src/gameState';
import { createGameServer } from '../src/index';
import { PLAYER_COLORS } from '../../shared/board';
import type { ClientEvents, ServerEvents, SessionAck } from '../../shared/protocol';
import type { CommandEnvelope, GameCommand, GameState } from '../../shared/types';

const url = process.env.REDIS_TEST_URL;
const redisTest = (name: string, fn: () => Promise<void>) => test(name, { skip: url ? false : 'Set REDIS_TEST_URL to run against an isolated real Redis service' }, fn);
const prefix = () => `monopoly:test:${randomUUID()}:`;
const profile = () => ({ name: 'Ada', color: PLAYER_COLORS[0], admissionSecret: randomBytes(32).toString('base64url') });
function success(ack: SessionAck) { if (!ack.ok) throw new Error(ack.error.message); assert.equal(ack.ok, true); return ack; }
const command = (state: GameState, action: GameCommand): CommandEnvelope => ({ commandId: randomUUID(), gameId: state.gameId, expectedVersion: state.version, expectedTurnId: state.turnId, command: action });

redisTest('real Redis enforces exclusive authority, CAS and conditional lease release', async () => {
  const namespace = prefix(); const first = new RedisRoomStore(url!, namespace); const second = new RedisRoomStore(url!, namespace);
  await first.start();
  try {
    await assert.rejects(second.start(), /Another server owns/);
    const game = new MonopolyGame('ABC234'); const now = Date.now();
    const record: RoomRecord = { schemaVersion: 1, storageVersion: 1, createdAt: now, expiresAt: now + 60_000, state: game.state, sessions: {}, receipts: [] };
    assert.equal(await first.create('ABC234', record), true); assert.equal(await first.create('ABC234', record), false);
    const next = { ...record, storageVersion: 2 };
    await first.save('ABC234', next, 1); await assert.rejects(first.save('ABC234', next, 1), StorageConflictError);
    assert.equal((await first.load('ABC234'))?.storageVersion, 2);
    await first.delete('ABC234', 2); await first.delete('ABC234', 2); assert.equal(await first.load('ABC234'), null);
  } finally { await first.close(); await second.close(); }
  const replacement = new RedisRoomStore(url!, namespace); await replacement.start(); assert.equal(replacement.healthy(), true); await replacement.close();
});

redisTest('real Redis TTL expiration evicts cached rooms and releases bounded capacity', async () => {
  const manager = new RoomManager({ store: new RedisRoomStore(url!, prefix()), scheduleTimers: false, roomTtlMs: 1000, maxRooms: 1 }); await manager.start();
  try {
    const first = success(await manager.createRoom('first', profile())); await new Promise(resolve => setTimeout(resolve, 1150));
    await assert.rejects(manager.inspect(first.state.roomCode), /expired/);
    assert.equal((await manager.createRoom('second', profile())).ok, true);
  } finally { await manager.close(); }
});

redisTest('real Redis survives process recreation after acknowledged command with secure resume and dedupe', async () => {
  const namespace = prefix();
  let server = await createGameServer({ store: new RedisRoomStore(url!, namespace), scheduleTimers: false, logger: () => {} });
  let port = await server.listen(0, '127.0.0.1');
  const a: Socket<ServerEvents, ClientEvents> = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  const b: Socket<ServerEvents, ClientEvents> = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  await Promise.all([new Promise<void>(r => a.once('connect', r)), new Promise<void>(r => b.once('connect', r))]);
  const first = success(await a.emitWithAck('create_room', profile()));
  const second = success(await b.emitWithAck('join_room', { roomCode: first.state.roomCode, name: 'Grace', color: PLAYER_COLORS[1], admissionSecret: randomBytes(32).toString('base64url') }));
  const request = command(second.state, { type: 'update_starting_cash', cash: 6000 });
  const saved = await a.emitWithAck('game_command', request); assert.equal(saved.ok, true);
  a.disconnect(); b.disconnect(); await server.close();
  server = await createGameServer({ store: new RedisRoomStore(url!, namespace), scheduleTimers: false, logger: () => {} }); port = await server.listen(0, '127.0.0.1');
  const resumed: Socket<ServerEvents, ClientEvents> = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  try {
    await new Promise<void>(r => resumed.once('connect', r));
    const session = success(await resumed.emitWithAck('resume_session', first.session)); assert.equal(session.state.startingCash, 6000); assert.equal(session.state.gameId, first.state.gameId);
    const replay = await resumed.emitWithAck('game_command', request); assert.equal(replay.ok, true); assert.equal(replay.version, saved.version);
    const stored = await server.rooms.inspect(first.state.roomCode); assert.equal(stored.startingCash, 6000); assert.equal(stored.players.length, 2);
  } finally { resumed.disconnect(); await server.close(); }
});

redisTest('real Redis retains pending trades across full rounds and server recreation with exactly-once acceptance', async () => {
  const namespace = prefix(); let now = Date.now();
  const options = () => ({ store: new RedisRoomStore(url!, namespace), scheduleTimers: false, logger: () => {}, now: () => now,
    gameFactory: (code: string) => new MonopolyGame(code, { now: () => now, dice: (): [number, number] => [1, 2] }) });
  let server = await createGameServer(options()); let port = await server.listen(0, '127.0.0.1');
  const clients: Socket<ServerEvents, ClientEvents>[] = [];
  async function client() {
    const socket: Socket<ServerEvents, ClientEvents> = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    clients.push(socket); socket.connect();
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  async function restart() {
    for (const socket of clients) socket.disconnect(); await server.close();
    server = await createGameServer(options()); port = await server.listen(0, '127.0.0.1');
  }
  try {
    const host = await client(); const first = success(await host.emitWithAck('create_room', profile()));
    const guest = await client(); const second = success(await guest.emitWithAck('join_room', { ...profile(), name: 'Grace', color: PLAYER_COLORS[1], roomCode: first.state.roomCode }));
    const started = await host.emitWithAck('game_command', command(second.state, { type: 'start_game' })); assert.equal(started.ok, true);
    const proposal = command(started.state!, { type: 'propose_trade', targetId: second.session.playerId,
      offer: { money: 100, properties: [], getOutOfJailCards: 0 }, request: { money: 25, properties: [], getOutOfJailCards: 0 } });
    const proposed = await host.emitWithAck('game_command', proposal); assert.equal(proposed.ok, true);
    let state = proposed.state!; const tradeId = state.activeTradeId!; const pending = structuredClone(state.trades[tradeId]); const originalTurn = state.turnId;
    const oldAccept = command(state, { type: 'accept_trade', tradeId });
    for (let phases = 0; state.turnId < originalTurn + 4; phases++) {
      assert.ok(phases < 40); assert.notEqual(state.turnDeadline, undefined);
      now = state.turnDeadline! + 1; await server.rooms.reconcile(state.roomCode); state = await server.rooms.inspect(state.roomCode);
      assert.deepEqual(state.trades[tradeId], pending); assert.equal(state.activeTradeId, tradeId);
    }
    assert.ok(state.players.every(p => p.money < state.startingCash));
    await restart();
    const resumedHost = await client(); success(await resumedHost.emitWithAck('resume_session', first.session));
    const resumedGuest = await client(); state = success(await resumedGuest.emitWithAck('resume_session', second.session)).state;
    assert.equal(state.turnId, originalTurn + 4); assert.deepEqual(state.trades[tradeId], pending); assert.equal(state.activeTradeId, tradeId);
    assert.equal((await resumedGuest.emitWithAck('game_command', oldAccept)).error?.code, 'STALE_STATE');
    const balances = state.players.map(p => p.money); const accept = command(state, { type: 'accept_trade', tradeId });
    const accepted = await resumedGuest.emitWithAck('game_command', accept); assert.equal(accepted.ok, true);
    assert.deepEqual(accepted.state!.players.map(p => p.money), [balances[0] - 75, balances[1] + 75]);
    assert.equal(accepted.state!.trades[tradeId].status, 'accepted');
    await restart();
    const finalHost = await client(); success(await finalHost.emitWithAck('resume_session', first.session));
    const finalGuest = await client(); state = success(await finalGuest.emitWithAck('resume_session', second.session)).state;
    assert.deepEqual(state.players.map(p => p.money), accepted.state!.players.map(p => p.money)); assert.equal(state.trades[tradeId].status, 'accepted');
    const beforeReplays = await server.rooms.inspect(state.roomCode);
    const replay = await finalGuest.emitWithAck('game_command', accept); assert.equal(replay.ok, true); assert.equal(replay.version, accepted.version);
    const proposalReplay = await finalHost.emitWithAck('game_command', proposal); assert.equal(proposalReplay.ok, true); assert.equal(proposalReplay.version, proposed.version);
    const duplicate = await finalGuest.emitWithAck('game_command', command(state, { type: 'accept_trade', tradeId })); assert.equal(duplicate.error?.code, 'TRADE_NOT_PENDING');
    assert.deepEqual(await server.rooms.inspect(state.roomCode), beforeReplays);
  } finally { for (const socket of clients) socket.disconnect(); await server.close(); }
});

redisTest('real Redis recovers unacknowledged admissions after restart and preserves accepted purchases and trades', async () => {
  const namespace = prefix(); let now = Date.now();
  const options = () => ({ store: new RedisRoomStore(url!, namespace), scheduleTimers: false, now: () => now,
    gameFactory: (code: string) => new MonopolyGame(code, { now: () => now, dice: (): [number, number] => [1, 3] }) });
  let manager = new RoomManager(options()); await manager.start();
  const createRequest = profile(); const first = success(await manager.createRoom('a', createRequest));
  const joinRequest = { ...profile(), name: 'Grace', roomCode: first.state.roomCode }; const second = success(await manager.joinRoom('b', joinRequest));
  let state = second.state;
  async function act(socket: string, session: typeof first.session, action: GameCommand) { const ack = await manager.execute(socket, session, command(state, action)); assert.equal(ack.ok, true, JSON.stringify(ack.error)); state = ack.state!; return ack; }
  await act('a', first.session, { type: 'start_game' }); await act('a', first.session, { type: 'roll_dice' });
  now = state.turnDeadline! + 1; await manager.reconcile(state.roomCode); state = await manager.inspect(state.roomCode);
  now = state.turnDeadline! + 1; await manager.reconcile(state.roomCode); state = await manager.inspect(state.roomCode); assert.equal(state.phase.kind, 'buy');
  await act('a', first.session, { type: 'buy_property', propertyIndex: 4, housesToBuy: 1 });
  await act('a', first.session, { type: 'propose_trade', targetId: second.session.playerId, offer: { money: 0, properties: [4], getOutOfJailCards: 0 }, request: { money: 200, properties: [], getOutOfJailCards: 0 } });
  const tradeId = Object.values(state.trades).find(trade => trade.status === 'pending')!.id;
  await act('b', second.session, { type: 'accept_trade', tradeId });
  const balances = state.players.map(p => p.money); assert.equal(state.properties[4].ownerId, second.session.playerId);
  await manager.close(); manager = new RoomManager(options()); await manager.start();
  try {
    const recoveredHost = success(await manager.createRoom('new-a', createRequest));
    const recoveredGuest = success(await manager.joinRoom('new-b', joinRequest));
    assert.equal(recoveredHost.session.playerId, first.session.playerId); assert.equal(recoveredGuest.session.playerId, second.session.playerId);
    assert.equal(recoveredGuest.state.players.length, 2); assert.deepEqual(recoveredGuest.state.players.map(p => p.money), balances);
    assert.equal(recoveredGuest.state.properties[4].ownerId, second.session.playerId); assert.equal(recoveredGuest.state.properties[4].houses, 1); assert.equal(recoveredGuest.state.trades[tradeId].status, 'accepted');
  } finally { await manager.close(); }
});

redisTest('real Redis preserves legacy and balanced economy versions across restart and the next Start reward', async () => {
  for (const rulesVersion of [undefined, 2, 3] as const) {
    const namespace = prefix(); let now = Date.now();
    const options = () => ({ store: new RedisRoomStore(url!, namespace), scheduleTimers: false, now: () => now,
      gameFactory: (code: string) => new MonopolyGame(code, { now: () => now, dice: (): [number, number] => [1, 2] }) });
    let manager = new RoomManager(options()); await manager.start();
    const first = success(await manager.createRoom('a', profile()));
    const second = success(await manager.joinRoom('b', { ...profile(), name: 'Grace', color: PLAYER_COLORS[1], roomCode: first.state.roomCode }));
    assert.equal(first.state.rulesVersion, 3);
    const started = await manager.execute('a', first.session, command(second.state, { type: 'start_game' }));
    assert.equal(started.ok, true); await manager.close();
    // Represent an authentic pre-balance snapshot or an explicitly versioned one.
    const seedStore = new RedisRoomStore(url!, namespace); await seedStore.start();
    let saved: RoomRecord;
    try {
      saved = (await seedStore.load(first.state.roomCode))!; const previous = saved.storageVersion;
      if (rulesVersion === undefined) delete saved.state.rulesVersion; else saved.state.rulesVersion = rulesVersion;
      saved.state.players[0].position = 54; saved.state.properties[10].ownerId = first.session.playerId;
      saved.state.version++; saved.storageVersion++; await seedStore.save(first.state.roomCode, saved, previous);
    } finally { await seedStore.close(); }
    manager = new RoomManager(options()); await manager.start();
    try {
      const resumed = success(await manager.resumeSession('new-a', first.session));
      assert.equal(resumed.state.rulesVersion, rulesVersion);
      assert.deepEqual(resumed.state.properties, saved!.state.properties);
      assert.deepEqual(resumed.state.players.map(p => p.money), saved!.state.players.map(p => p.money));
      const rolled = await manager.execute('new-a', first.session, command(resumed.state, { type: 'roll_dice' }));
      assert.equal(rolled.ok, true); now = rolled.state!.turnDeadline!; await manager.reconcile(first.state.roomCode);
      const moved = await manager.inspect(first.state.roomCode);
      assert.equal(moved.rulesVersion, rulesVersion);
      assert.equal(moved.players[0].position, 1);
      assert.equal(moved.players[0].money, 1500 + (rulesVersion === 3 ? 225 : 950));
    } finally { await manager.close(); }
  }
});

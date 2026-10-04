import test from 'node:test';
import assert from 'node:assert/strict';
import { MonopolyGame, SYSTEM_ACTOR, assertGameState, migrateSavedFlightDecision, type EngineOptions } from '../src/gameState';
import { BOARD_DATA, RULES, PLAYER_COLORS, flightDestinations, liquidationValue } from '../../shared/board';
import type { ActiveCard, GameCommand, GamePhase, TradeAssets } from '../../shared/types';

function setup(options: EngineOptions = {}, count = 2): MonopolyGame {
  const game = new MonopolyGame('TEST01', { now: () => 1_000, dice: () => [1, 2], random: () => 0, ...options });
  for (let i = 0; i < count; i++) assert.equal(game.addPlayer(String.fromCharCode(65 + i), `socket-${i}`, `Player ${i + 1}`, PLAYER_COLORS[i]), true);
  ok(game, 'A', { type: 'start_game' });
  return game;
}
function ok(game: MonopolyGame, actor: string, command: GameCommand, now = 1_000) {
  const result = game.applyCommand(actor, command, now);
  assert.equal(result.ok, true, result.ok ? '' : `${command.type}: ${result.error.code} ${result.error.message}`);
  assertGameState(game.state);
  return result;
}
function reject(game: MonopolyGame, actor: string, command: unknown, code?: string) {
  const before = structuredClone(game.state);
  const result = game.applyCommand(actor, command as GameCommand, 1_000);
  assert.equal(result.ok, false, `${(command as GameCommand)?.type} should reject`);
  if (!result.ok && code) assert.equal(result.error.code, code);
  assert.deepEqual(game.state, before, 'Rejected commands must not mutate any state');
}
function tick(game: MonopolyGame) {
  return ok(game, SYSTEM_ACTOR, { type: 'timeout', turnId: game.state.turnId, phaseId: game.state.phaseId }, game.state.turnDeadline);
}
function land(game: MonopolyGame, index: number) {
  const player = game.getCurrentPlayer()!;
  player.position = (index - 3 + RULES.boardSize) % RULES.boardSize;
  ok(game, player.id, { type: 'roll_dice' }); tick(game); tick(game);
}
function phase<K extends GamePhase['kind']>(game: MonopolyGame, kind: K): Extract<GamePhase, { kind: K }> {
  assert.equal(game.state.phase.kind, kind);
  return game.state.phase as Extract<GamePhase, { kind: K }>;
}
const assets = (money = 0, properties: number[] = [], getOutOfJailCards = 0): TradeAssets => ({ money, properties, getOutOfJailCards });
function card(action: ActiveCard['action'], amount?: number): EngineOptions['drawCard'] {
  return deck => ({ deck, action, text: action, amount });
}
function clearLanding(game: MonopolyGame): void {
  for (let i = 0; i < 20 && !['awaiting_roll', 'awaiting_end', 'ended'].includes(game.state.phase.kind); i++) tick(game);
}

test('canonical board has 56 squares, server economics and valid forward flight segments', () => {
  assert.equal(BOARD_DATA.length, 56);
  assert.equal(BOARD_DATA[10].price, 150);
  assert.equal(BOARD_DATA[9].houseCost, 50);
  assert.equal(BOARD_DATA[23].houseCost, 100);
  assert.equal(BOARD_DATA[51].houseCost, 250);
  for (const square of BOARD_DATA) {
    assert.equal(square.id, BOARD_DATA.indexOf(square));
    assert.equal(square.housePrice, square.houseCost);
    if (square.type === 'property') assert.equal(square.rent?.length, 6);
  }
  assert.deepEqual(flightDestinations(6), [7,8,9,10,11,12,13,14,15,16,17,18,19,20]);
  assert.deepEqual(flightDestinations(21), [22,23,24,25,26,27,28,29,30,31,32,33]);
  assert.deepEqual(flightDestinations(34), [35,36,37,38,39,40,41,42,43,44]);
  assert.deepEqual(flightDestinations(45), [46,47,48,49,50,51,52,53,54,55,0,1,2,3,4,5]);
  assert.equal([6,21,34,45].flatMap(flightDestinations).length, 52);
  assert.deepEqual(flightDestinations(-1), []);
});

test('lobby requires authenticated host, bounded settings, two distinct seats and one start', () => {
  const game = new MonopolyGame('LOBBY1');
  assert.equal(game.addPlayer('A', 'a', 'Ada', PLAYER_COLORS[0]), true);
  assert.equal(game.addPlayer('A', 'attacker', 'Fake', PLAYER_COLORS[1]), false);
  assert.equal(game.addPlayer('B', 'b', 'Ben', PLAYER_COLORS[0]), false);
  reject(game, 'A', { type: 'start_game' }, 'MORE_PLAYERS_REQUIRED');
  assert.equal(game.addPlayer('B', 'b', 'Ben', PLAYER_COLORS[1]), true);
  reject(game, 'B', { type: 'start_game' }, 'HOST_ONLY');
  for (const cash of [-1, 0, 499, 10001, 500.5, NaN, Infinity, '1500']) reject(game, 'A', { type: 'update_starting_cash', cash });
  ok(game, 'A', { type: 'update_starting_cash', cash: 5000 });
  ok(game, 'A', { type: 'start_game' });
  assert.equal(game.state.players[1].money, 5000);
  reject(game, 'A', { type: 'start_game' }, 'WRONG_PHASE');
  reject(game, 'A', { type: 'update_starting_cash', cash: 1500 }, 'WRONG_PHASE');
  assert.equal(game.addPlayer('C', 'c', 'Cleo', PLAYER_COLORS[2]), false);
});

test('atomic rejects for wrong actor, malformed commands, dice spam and stale/early timeout', () => {
  const game = setup();
  reject(game, 'B', { type: 'roll_dice' }, 'NOT_YOUR_TURN');
  reject(game, 'A', null, 'INVALID_COMMAND');
  reject(game, 'A', { type: 'not_real' }, 'INVALID_COMMAND');
  const stale = { type: 'timeout' as const, turnId: game.state.turnId, phaseId: game.state.phaseId };
  reject(game, SYSTEM_ACTOR, stale, 'EARLY_TIMEOUT');
  ok(game, 'A', { type: 'roll_dice' });
  phase(game, 'rolling');
  reject(game, 'A', { type: 'roll_dice' }, 'WRONG_PHASE');
  reject(game, 'A', { type: 'end_turn' }, 'WRONG_PHASE');
  reject(game, SYSTEM_ACTOR, stale, 'STALE_TIMEOUT');
  reject(game, 'A', { type: 'timeout', turnId: game.state.turnId, phaseId: game.state.phaseId }, 'FORBIDDEN');
  tick(game); phase(game, 'moving');
  reject(game, 'A', { type: 'roll_dice' }, 'WRONG_PHASE');
  reject(game, 'A', { type: 'end_turn' }, 'WRONG_PHASE');
});

test('buy and upgrade validate actor, integer bounds, affordability and hotel group', () => {
  const game = setup(); land(game, 1);
  phase(game, 'buy');
  reject(game, 'B', { type: 'buy_property', propertyIndex: 1, housesToBuy: 0 }, 'NOT_YOUR_TURN');
  reject(game, 'B', { type: 'pass_property' }, 'NOT_YOUR_TURN');
  for (const housesToBuy of [-1, 0.5, 3, 4, 5, 100, NaN, Infinity, '0']) reject(game, 'A', { type: 'buy_property', propertyIndex: 1, housesToBuy });
  reject(game, 'A', { type: 'buy_property', propertyIndex: 999, housesToBuy: 0 });
  const before = game.getPlayer('A')!.money;
  ok(game, 'A', { type: 'buy_property', propertyIndex: 1, housesToBuy: 2 });
  assert.equal(game.state.properties[1].houses, 2);
  assert.equal(game.getPlayer('A')!.money, before - 160);
  phase(game, 'awaiting_end');
  reject(game, 'A', { type: 'buy_property', propertyIndex: 1, housesToBuy: 0 });
  const hotel = setup(); hotel.state.properties[1].ownerId = 'A'; hotel.state.properties[1].houses = 4;
  hotel.state.properties[2].ownerId = 'A'; hotel.state.properties[4].ownerId = 'A'; land(hotel, 1);
  assert.equal(phase(hotel, 'buy').maxHouses, 1);
  reject(hotel, 'A', { type: 'upgrade_property', propertyIndex: 1, housesToBuy: 2 });
  ok(hotel, 'A', { type: 'upgrade_property', propertyIndex: 1, housesToBuy: 1 });
  assert.equal(hotel.state.properties[1].houses, 5);
});

test('airports/mines cannot carry buildings and an unaffordable purchase keeps the decision', () => {
  const game = setup(); land(game, 10);
  reject(game, 'A', { type: 'buy_property', propertyIndex: 10, housesToBuy: 1 });
  ok(game, 'A', { type: 'buy_property', propertyIndex: 10, housesToBuy: 0 });
  assert.equal(game.state.properties[10].houses, 0);
  const poor = setup(); land(poor, 1); poor.getPlayer('A')!.money = 70;
  reject(poor, 'A', { type: 'buy_property', propertyIndex: 1, housesToBuy: 1 }, 'INSUFFICIENT_FUNDS');
  phase(poor, 'buy');
});

test('doubles wait for landing decisions and third consecutive doubles always sends to jail', () => {
  const game = setup({ dice: () => [2, 2] });
  for (let i = 0; i < 2; i++) {
    ok(game, 'A', { type: 'roll_dice' });
    reject(game, 'A', { type: 'roll_dice' });
    tick(game); tick(game); phase(game, 'buy');
    reject(game, 'A', { type: 'roll_dice' });
    ok(game, 'A', { type: 'pass_property' });
    phase(game, 'awaiting_roll'); assert.equal(game.state.doublesCount, i + 1);
    assert.equal(game.getCurrentPlayer()!.id, 'A');
  }
  ok(game, 'A', { type: 'roll_dice' }); tick(game);
  assert.equal(phase(game, 'moving').reason, 'jail');
  assert.equal(game.getPlayer('A')!.inJail, true);
  assert.equal(game.state.doublesCount, 0); assert.equal(game.state.extraRoll, false);
  tick(game); phase(game, 'awaiting_end'); tick(game);
  assert.equal(game.getCurrentPlayer()!.id, 'B');
});

test('Start landing/passing rewards and mine bonuses occur exactly once on eligible routes', () => {
  for (const [from, expected, target] of [[53, RULES.landingStart, 0], [54, RULES.passingStart, 1]] as const) {
    const game = setup(); game.getPlayer('A')!.position = from; game.getPlayer('A')!.flightChances = 0;
    game.state.properties[10].ownerId = 'A'; game.state.properties[27].ownerId = 'A';
    ok(game, 'A', { type: 'roll_dice' }); tick(game);
    assert.equal(game.getPlayer('A')!.money, 1500 + expected + RULES.mineBonuses[2]);
    assert.equal(game.getPlayer('A')!.position, target);
    assert.equal(game.getPlayer('A')!.flightChances, 1);
    const movement = phase(game, 'moving'); assert.equal(movement.path.length, 3);
    assert.equal(movement.path.at(-1), target);
    tick(game); assert.equal(game.getPlayer('A')!.money, 1500 + expected + RULES.mineBonuses[2]);
  }
});

test('Go back three is a reverse path, never a lap or Start reward', () => {
  const game = setup({ drawCard: card('go_back_3') }); land(game, 47);
  game.getPlayer('A')!.flightChances = 0;
  const before = game.getPlayer('A')!.money;
  ok(game, 'A', { type: 'acknowledge_card' });
  const moving = phase(game, 'moving');
  assert.deepEqual(moving.path, [46,45,44]); assert.equal(moving.direction, 'backward'); assert.equal(moving.reason, 'card_backward');
  assert.equal(game.getPlayer('A')!.money, before); assert.equal(game.getPlayer('A')!.flightChances, 0);
  tick(game); assert.equal(phase(game, 'buy').propertyIndex, 44);
});

test('Advance to Start grants the current reward plus mine bonus once and preserves actor through chained movement', () => {
  const game = setup({ drawCard: card('go_to_start') }); land(game, 13);
  game.state.properties[10].ownerId = 'A';
  const before = game.getPlayer('A')!.money;
  ok(game, 'A', { type: 'acknowledge_card' });
  assert.equal(phase(game, 'moving').path.length, 43);
  assert.equal(game.getPlayer('A')!.money, before + RULES.landingStart + RULES.mineBonuses[1]);
  tick(game); phase(game, 'awaiting_end'); assert.equal(game.getCurrentPlayer()!.id, 'A');
  assert.equal(game.getPlayer('A')!.money, before + RULES.landingStart + RULES.mineBonuses[1]);
});

test('all card effects remain actor-bound and cards auto-resolve rather than reroll after doubles', () => {
  const game = setup({ dice: () => [1,1], drawCard: card('add_money', 500) });
  game.getPlayer('A')!.position = 11;
  ok(game, 'A', { type: 'roll_dice' }); tick(game); tick(game);
  phase(game, 'card'); reject(game, 'B', { type: 'acknowledge_card' });
  reject(game, 'A', { type: 'end_turn' });
  tick(game); phase(game, 'awaiting_roll'); assert.equal(game.getPlayer('A')!.money, 2000);
});

test('jail doubles release and move with no extra roll; fine and card release need current actor and resources', () => {
  const game = setup({ dice: () => [2,2] }); const player = game.getPlayer('A')!;
  player.inJail = true; player.position = 14;
  reject(game, 'B', { type: 'pay_jail_fine' });
  reject(game, 'A', { type: 'use_jail_card' }, 'NO_JAIL_CARD');
  ok(game, 'A', { type: 'roll_dice' }); tick(game); tick(game);
  assert.equal(game.getPlayer('A')!.inJail, false); assert.equal(game.state.extraRoll, false);
  ok(game, 'A', { type: 'pass_property' }); phase(game, 'awaiting_end');
  const fine = setup(); fine.getPlayer('A')!.inJail = true; fine.getPlayer('A')!.position = 14;
  ok(fine, 'A', { type: 'pay_jail_fine' }); assert.equal(fine.getPlayer('A')!.money, 1300); assert.equal(fine.state.vacationJackpot, 200);
  phase(fine, 'awaiting_roll'); reject(fine, 'A', { type: 'pay_jail_fine' }, 'NOT_IN_JAIL');
  const free = setup(); free.getPlayer('A')!.inJail = true; free.getPlayer('A')!.position = 14; free.getPlayer('A')!.getOutOfJailCards = 1;
  ok(free, 'A', { type: 'use_jail_card' }); assert.equal(free.getPlayer('A')!.getOutOfJailCards, 0); assert.equal(free.getPlayer('A')!.money, 1500);
});

test('third failed jail attempt releases for the following turn without movement or a fine', () => {
  const game = setup(); game.getPlayer('A')!.inJail = true; game.getPlayer('A')!.position = 14;
  for (let attempt = 1; attempt <= 3; attempt++) {
    ok(game, 'A', { type: 'roll_dice' }); tick(game); phase(game, 'awaiting_end');
    assert.equal(game.getPlayer('A')!.inJail, attempt < 3); assert.equal(game.getPlayer('A')!.position, 14);
    assert.equal(game.getPlayer('A')!.money, 1500);
    if (attempt < 3) {
      tick(game); land(game, 14); tick(game);
      assert.equal(game.getCurrentPlayer()!.id, 'A');
    }
  }
});

test('corner and card jail entry cancel doubles and finish without stale pending decisions', () => {
  for (const viaCard of [false, true]) {
    const game = setup({ dice: () => [1,1], drawCard: card('go_to_jail') });
    game.getPlayer('A')!.position = viaCard ? 11 : 40;
    ok(game, 'A', { type: 'roll_dice' }); tick(game); tick(game);
    if (viaCard) ok(game, 'A', { type: 'acknowledge_card' });
    assert.equal(phase(game, 'moving').reason, 'jail'); tick(game);
    phase(game, 'awaiting_end'); assert.equal(game.state.activeCard, null); assert.equal(game.state.extraRoll, false); assert.equal(game.state.doublesCount, 0);
    tick(game); assert.equal(game.getCurrentPlayer()!.id, 'B');
  }
});

test('Vacation awards/reset jackpot, cancels extra roll and skips exactly one turn', () => {
  const game = setup({ dice: () => [1,1] }, 3); game.state.vacationJackpot = 333; game.getPlayer('A')!.position = 26;
  ok(game, 'A', { type: 'roll_dice' }); tick(game); tick(game); phase(game, 'awaiting_end');
  assert.equal(game.getPlayer('A')!.money, 1833); assert.equal(game.state.vacationJackpot, 0); assert.equal(game.getPlayer('A')!.skipNextTurn, true);
  tick(game); assert.equal(game.getCurrentPlayer()!.id, 'B');
  ok(game, 'B', { type: 'leave_game' }); assert.equal(game.getCurrentPlayer()!.id, 'C');
  game.getPlayer('C')!.position = 12; ok(game, 'C', { type: 'roll_dice' }); tick(game); tick(game);
  // Force no additional roll by landing in Jail instead on the following roll.
  game.getPlayer('C')!.position = 40; ok(game, 'C', { type: 'roll_dice' }); tick(game); tick(game); tick(game); tick(game);
  assert.equal(game.getCurrentPlayer()!.id, 'C'); assert.equal(game.getPlayer('A')!.skipNextTurn, false);
});

test('tax amounts use canonical asset development values, fund jackpot, and debt pauses', () => {
  const game = setup(); land(game, 3); assert.equal(game.getPlayer('A')!.money, 1350); assert.equal(game.state.vacationJackpot, 150);
  const propertyTax = setup(); propertyTax.state.properties[55].ownerId = 'A'; propertyTax.state.properties[55].houses = 4;
  land(propertyTax, 40); assert.equal(propertyTax.getPlayer('A')!.money, 1500 - Math.floor((650 + 4*250)*.05));
});

test('flight rejects all invalid payloads before paying, follows segment and own airport is free', () => {
  const game = setup(); game.state.properties[6].ownerId = 'A'; game.getPlayer('A')!.money = 0; land(game, 6);
  assert.equal(phase(game, 'flight').ticketPrice, 0);
  for (const destinationIndex of [-1, 56, 6, 21, 22, 55, NaN, 7.5, '7']) reject(game, 'A', { type: 'flight_decision', destinationIndex });
  reject(game, 'B', { type: 'flight_decision', destinationIndex: 7 }, 'NOT_YOUR_TURN');
  ok(game, 'A', { type: 'flight_decision', destinationIndex: 20 });
  assert.equal(game.getPlayer('A')!.flightChances, 0); assert.equal(game.getPlayer('A')!.money, 0);
  assert.deepEqual(phase(game, 'moving').path, [20]); tick(game); phase(game, 'awaiting_end');
});

test('every next airport is excluded and rejected atomically regardless of ownership', () => {
  const airports = [6,21,34,45];
  for (let i = 0; i < airports.length; i++) for (const owner of [null, 'A', 'B']) {
    const airport = airports[i], next = airports[(i + 1) % airports.length];
    const game = setup(); game.state.properties[airport].ownerId = 'B';
    game.state.properties[next].ownerId = owner;
    land(game, airport); tick(game);
    const flight = phase(game, 'flight');
    assert.equal(flight.destinations.includes(next), false);
    assert.equal(flight.destinations.some(id => airports.includes(id)), false);
    reject(game, 'A', { type: 'flight_decision', destinationIndex: next }, 'INVALID_DESTINATION');
    // A stale or manipulated option list cannot authorize the airport endpoint.
    flight.destinations.push(next);
    reject(game, 'A', { type: 'flight_decision', destinationIndex: next }, 'INVALID_DESTINATION');
    flight.destinations.pop();
    const last = (next + RULES.boardSize - 1) % RULES.boardSize;
    ok(game, 'A', { type: 'flight_decision', destinationIndex: last });
    assert.equal(game.getPlayer('A')!.position, last);
    assert.equal(game.getPlayer('A')!.flightChances, 0);
    assert.equal(game.state.properties[next].ownerId, owner);
  }
});

test('each of 52 possible flight destinations resolves through the same landing engine', () => {
  for (const airport of [6,21,34,45]) for (const destination of flightDestinations(airport)) {
    const game = setup({ drawCard: card('get_out_of_jail') });
    game.state.properties[airport].ownerId = 'A'; land(game, airport); phase(game, 'flight');
    const before = game.getPlayer('A')!.money;
    ok(game, 'A', { type: 'flight_decision', destinationIndex: destination }); tick(game);
    assert.equal(game.getCurrentPlayer()!.id, 'A'); assert.equal(game.getPlayer('A')!.flightChances, 0);
    assert.equal(game.getPlayer('A')!.position, destination === 42 ? 14 : destination);
    assert.equal(game.getPlayer('A')!.money <= before, true, `Flight ${airport}->${destination} must not earn Start income`);
    const square = BOARD_DATA[destination];
    if (square.type === 'chance' || square.type === 'chest') phase(game, 'card');
    else if (square.type === 'property' || square.type === 'railroad' || square.type === 'utility') phase(game, 'buy');
    else if (destination === 42) assert.equal(phase(game, 'moving').reason, 'jail');
    else phase(game, 'awaiting_end');
  }
});

test('saved legacy airport quotes migrate narrowly and committed airport flights remain recoverable', () => {
  const airports = [6,21,34,45];
  for (let i = 0; i < airports.length; i++) {
    const airport = airports[i], next = airports[(i + 1) % airports.length];
    const game = setup(); game.state.properties[airport].ownerId = 'A'; land(game, airport);
    const original = structuredClone(game.state);
    phase(game, 'flight').destinations.push(next);
    assert.throws(() => assertGameState(game.state));
    migrateSavedFlightDecision(game.state);
    assert.deepEqual(game.state, original);
    migrateSavedFlightDecision(game.state); assert.deepEqual(game.state, original);
    for (const destinations of [[next], [...flightDestinations(airport), airport], [...flightDestinations(airport), String(next)]]) {
      const malformed = structuredClone(original);
      (malformed.phase as unknown as { destinations: unknown[] }).destinations = destinations;
      const before = structuredClone(malformed);
      migrateSavedFlightDecision(malformed); assert.deepEqual(malformed, before);
      assert.throws(() => assertGameState(malformed));
    }
    // A pre-upgrade accepted command already paid/consumed its chance. Its
    // pending movement and historical event must recover without replaying it.
    ok(game, 'A', { type: 'flight_decision', destinationIndex: (next + 55) % 56 });
    const moving = phase(game, 'moving'); moving.to = next; moving.path = [next];
    game.getPlayer('A')!.position = next;
    const event = game.state.events.at(-1)!;
    assert.equal(event.type, 'movement');
    if (event.type === 'movement') { event.to = next; event.path = [next]; }
    assertGameState(game.state); tick(game); phase(game, 'buy');
    assert.equal(game.getPlayer('A')!.flightChances, 0);
    ok(game, 'A', { type: 'pass_property' });
    assertGameState(game.state);
  }
});

test('paid flight rent and debt never create a bogus buy phase or advance wrong actor', () => {
  const game = setup(); game.state.properties[6].ownerId = 'B'; game.state.properties[12].ownerId = 'B'; game.state.properties[12].houses = 5;
  game.getPlayer('A')!.money = 500; land(game, 6); phase(game, 'rent'); tick(game); phase(game, 'flight');
  ok(game, 'A', { type: 'flight_decision', destinationIndex: 12 }); tick(game); phase(game, 'rent'); tick(game); phase(game, 'debt');
  assert.equal(game.getCurrentPlayer()!.id, 'A'); assert.equal(game.state.awaitingBuyDecision, null);
  assert.equal(game.getPlayer('A')!.flightChances, 0);
});

test('rent debt pays only recovered money and sale resumes saved airport flight continuation', () => {
  const game = setup(); game.getPlayer('A')!.money = 10; game.state.properties[21].ownerId = 'B'; game.state.properties[55].ownerId = 'A';
  land(game, 21); phase(game, 'rent'); assert.equal(game.getPlayer('B')!.money, 1510); tick(game);
  assert.equal(phase(game, 'debt').debt.remaining, 10);
  ok(game, 'A', { type: 'sell_property_to_bank', propertyIndex: 55 });
  assert.equal(game.getPlayer('A')!.money, 477); assert.equal(game.getPlayer('B')!.money, 1520);
  phase(game, 'flight'); assert.equal(game.state.properties[55].ownerId, null);
});

test('debt cured after doubles returns to extra roll only after rent and sale resolve', () => {
  const game = setup({ dice: () => [2,2] }); game.getPlayer('A')!.money = 0; game.state.properties[4].ownerId = 'B'; game.state.properties[1].ownerId = 'A';
  ok(game, 'A', { type: 'roll_dice' }); tick(game); tick(game); phase(game, 'rent'); tick(game); phase(game, 'debt');
  reject(game, 'A', { type: 'roll_dice' });
  ok(game, 'A', { type: 'sell_property_to_bank', propertyIndex: 1 }); phase(game, 'awaiting_roll');
  assert.equal(game.getCurrentPlayer()!.id, 'A'); assert.equal(game.getPlayer('A')!.money, 37);
});

test('trade can cure debt, transfers real jail cards, settles creditor and resumes once', () => {
  const game = setup({}, 3); game.getPlayer('A')!.money = 0; game.getPlayer('A')!.getOutOfJailCards = 2;
  game.state.properties[21].ownerId = 'B'; game.state.properties[1].ownerId = 'A'; land(game, 21); tick(game); phase(game, 'debt');
  ok(game, 'A', { type: 'propose_trade', targetId: 'C', offer: assets(0,[1],2), request: assets(500) });
  const tradeId = game.state.activeTradeId!; ok(game, 'C', { type: 'accept_trade', tradeId });
  assert.equal(game.getPlayer('A')!.money, 480); assert.equal(game.getPlayer('B')!.money, 1520); assert.equal(game.getPlayer('C')!.money, 1000);
  assert.equal(game.getPlayer('A')!.getOutOfJailCards, 0); assert.equal(game.getPlayer('C')!.getOutOfJailCards, 2);
  assert.equal(game.state.properties[1].ownerId, 'C'); phase(game, 'flight');
  reject(game, 'C', { type: 'accept_trade', tradeId });
});

test('trade rejects forged parties, invalid quantities, missing/duplicate assets and self-accept atomically', () => {
  const game = setup({},3); game.state.properties[1].ownerId = 'A';
  for (const offer of [assets(-1), assets(1.5), assets(NaN), assets(Infinity), assets(1501), assets(0,[999]), assets(0,[1,1]), assets(0,[],1), {money:0,properties:null,getOutOfJailCards:0}])
    reject(game, 'A', { type: 'propose_trade', targetId: 'B', offer, request: assets() });
  reject(game, 'A', { type: 'propose_trade', targetId: 'A', offer: assets(), request: assets() });
  // The caller cannot forge an initiator: the authenticated actor is the owner of the outgoing assets.
  reject(game, 'C', { type: 'propose_trade', initiatorId: 'A', targetId: 'B', offer: assets(0,[1]), request: assets() });
  ok(game, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(20,[1]), request: assets(50) });
  const tradeId = game.state.activeTradeId!;
  reject(game, 'A', { type: 'accept_trade', tradeId }, 'TRADE_TARGET_ONLY');
  reject(game, 'C', { type: 'accept_trade', tradeId }, 'TRADE_TARGET_ONLY');
  reject(game, 'C', { type: 'reject_trade', tradeId });
  reject(game, 'C', { type: 'counter_trade', tradeId, offer: assets(), request: assets() });
  game.state.properties[1].ownerId = 'C';
  reject(game, 'B', { type: 'accept_trade', tradeId }, 'INVALID_TRADE_PROPERTIES');
});

test('fresh acceptance rechecks funds and counteroffers have immutable identity and swapped consent', () => {
  const game = setup(); ok(game, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(10), request: assets(20) });
  const originalId = game.state.activeTradeId!;
  game.getPlayer('B')!.money = 5; reject(game, 'B', { type: 'accept_trade', tradeId: originalId }, 'INSUFFICIENT_TRADE_ASSETS');
  game.getPlayer('B')!.money = 1500;
  ok(game, 'B', { type: 'counter_trade', tradeId: originalId, offer: assets(15), request: assets(10) });
  const newId = game.state.activeTradeId!; assert.notEqual(newId, originalId);
  assert.equal(game.state.trades[originalId].status, 'countered');
  reject(game, 'B', { type: 'accept_trade', tradeId: newId }, 'TRADE_TARGET_ONLY');
  reject(game, 'A', { type: 'accept_trade', tradeId: originalId }, 'TRADE_NOT_PENDING');
  const sum = game.state.players.reduce((s,p) => s+p.money,0); ok(game, 'A', { type: 'accept_trade', tradeId: newId });
  assert.equal(game.state.players.reduce((s,p) => s+p.money,0), sum); assert.equal(game.getPlayer('A')!.money,1505);
});

test('offers survive manual and timed turn changes across several complete rounds', () => {
  const game = setup({}, 3);
  ok(game, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(25), request: assets(10) });
  const tradeId = game.state.activeTradeId!; const original = structuredClone(game.state.trades[tradeId]);
  for (let turn = 0; turn < 9; turn++) {
    const actor = game.getCurrentPlayer()!.id;
    ok(game, actor, { type: 'roll_dice' }); clearLanding(game); phase(game, 'awaiting_end');
    if (turn % 2) tick(game); else ok(game, actor, { type: 'end_turn' });
    assert.deepEqual(game.state.trades[tradeId], original);
    assert.equal(game.state.activeTradeId, tradeId);
  }
  assert.equal(game.state.turnId, 10); assert.equal(game.getCurrentPlayer()!.id, 'A');
  const before = game.state.players.map(player => player.money);
  ok(game, 'B', { type: 'accept_trade', tradeId });
  assert.equal(game.state.trades[tradeId].status, 'accepted');
  assert.deepEqual(game.state.players.map(player => player.money), [before[0] - 15, before[1] + 15, before[2]]);
  reject(game, 'B', { type: 'accept_trade', tradeId }, 'TRADE_NOT_PENDING');
  reject(game, 'A', { type: 'reject_trade', tradeId }, 'TRADE_NOT_PENDING');
});

test('persistent offer cap permits counters and reopened slots while history trimming preserves pending offers', () => {
  const game = setup({}, 3); const ids: string[] = [];
  for (let index = 0; index < 8; index++) {
    ok(game, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(index + 1), request: assets() });
    ids.push(game.state.activeTradeId!);
  }
  const original = structuredClone(game.state.trades);
  for (let turn = 0; turn < 3; turn++) {
    const actor = game.getCurrentPlayer()!.id;
    ok(game, actor, { type: 'roll_dice' }); clearLanding(game); phase(game, 'awaiting_end');
    ok(game, actor, { type: 'end_turn' });
  }
  assert.deepEqual(game.state.trades, original);
  reject(game, 'C', { type: 'propose_trade', targetId: 'A', offer: assets(), request: assets() }, 'TOO_MANY_TRADES');

  // A counter replaces a pending offer, so it must remain possible at the cap.
  ok(game, 'B', { type: 'counter_trade', tradeId: ids[7], offer: assets(20), request: assets(10) });
  const counterId = game.state.activeTradeId!;
  assert.equal(game.state.trades[ids[7]].status, 'countered');
  assert.equal(Object.values(game.state.trades).filter(trade => trade.status === 'pending').length, 8);
  reject(game, 'C', { type: 'propose_trade', targetId: 'A', offer: assets(), request: assets() }, 'TOO_MANY_TRADES');
  ok(game, 'B', { type: 'reject_trade', tradeId: ids[0] });
  ok(game, 'A', { type: 'propose_trade', targetId: 'C', offer: assets(), request: assets() });
  let recycledId = game.state.activeTradeId!;
  const retainedIds = [...ids.slice(1, 7), counterId];
  const retained = retainedIds.map(id => structuredClone(game.state.trades[id]));

  // Reuse one slot to build more than forty closed offers without expiring any
  // of the seven older pending offers, including the counteroffer.
  for (let index = 0; index < 45; index++) {
    ok(game, 'A', { type: 'reject_trade', tradeId: recycledId });
    ok(game, 'A', { type: 'propose_trade', targetId: 'C', offer: assets(), request: assets() });
    recycledId = game.state.activeTradeId!;
    assert.deepEqual(retainedIds.map(id => game.state.trades[id]), retained);
    assert.equal(Object.values(game.state.trades).filter(trade => trade.status === 'pending').length, 8);
    assert.ok(Object.values(game.state.trades).filter(trade => trade.status !== 'pending').length <= 40);
  }
  assert.equal(Object.keys(game.state.trades).length, 48);
  assert.equal(game.state.trades[ids[0]], undefined);
  assert.equal(game.state.trades[ids[7]], undefined);
  assert.equal(game.state.trades[recycledId].status, 'pending');
  reject(game, 'C', { type: 'propose_trade', targetId: 'A', offer: assets(), request: assets() }, 'TOO_MANY_TRADES');
});

test('ordinary purchases and cash/card changes keep an unavailable offer pending and acceptance atomic', () => {
  const game = setup(); game.getPlayer('A')!.getOutOfJailCards = 1;
  ok(game, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(1500, [], 1), request: assets() });
  const tradeId = game.state.activeTradeId!;
  land(game, 4); ok(game, 'A', { type: 'buy_property', propertyIndex: 4, housesToBuy: 0 });
  assert.equal(game.state.trades[tradeId].status, 'pending');
  reject(game, 'B', { type: 'accept_trade', tradeId }, 'INSUFFICIENT_TRADE_ASSETS');
  ok(game, 'A', { type: 'end_turn' });
  ok(game, 'B', { type: 'propose_trade', targetId: 'A', offer: assets(100), request: assets() });
  ok(game, 'A', { type: 'accept_trade', tradeId: game.state.activeTradeId! });
  // The original exact terms become affordable again without recreating the offer.
  ok(game, 'B', { type: 'accept_trade', tradeId });
  assert.equal(game.getPlayer('A')!.money, 100 - BOARD_DATA[4].price!); assert.equal(game.getPlayer('B')!.getOutOfJailCards, 1);

  const jail = setup(); jail.getPlayer('A')!.getOutOfJailCards = 1; jail.getPlayer('A')!.inJail = true; jail.getPlayer('A')!.position = RULES.jailIndex;
  ok(jail, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(0, [], 1), request: assets(30) });
  const cardTradeId = jail.state.activeTradeId!; ok(jail, 'A', { type: 'use_jail_card' });
  assert.equal(jail.state.trades[cardTradeId].status, 'pending');
  reject(jail, 'B', { type: 'accept_trade', tradeId: cardTradeId }, 'INSUFFICIENT_TRADE_ASSETS');
  ok(jail, 'B', { type: 'reject_trade', tradeId: cardTradeId });
});

test('competing trades, bank sales and Risk changes do not silently discard property offers', () => {
  const game = setup({}, 3); game.state.properties[1].ownerId = 'A';
  ok(game, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(0, [1]), request: assets(200) });
  const original = game.state.activeTradeId!;
  ok(game, 'A', { type: 'propose_trade', targetId: 'C', offer: assets(0, [1]), request: assets(100) });
  const competing = game.state.activeTradeId!;
  ok(game, 'B', { type: 'accept_trade', tradeId: original });
  assert.equal(game.state.trades[competing].status, 'pending'); assert.equal(game.state.activeTradeId, competing);
  reject(game, 'C', { type: 'accept_trade', tradeId: competing }, 'INVALID_TRADE_PROPERTIES');
  ok(game, 'C', { type: 'counter_trade', tradeId: competing, offer: assets(10), request: assets() });
  const counter = game.state.activeTradeId!;
  assert.equal(game.state.trades[competing].status, 'countered');
  ok(game, 'A', { type: 'accept_trade', tradeId: counter });

  const sale = setup(); sale.state.properties[1].ownerId = 'A'; sale.getPlayer('A')!.money = 0;
  sale.state.properties[21].ownerId = 'B';
  ok(sale, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(0, [1]), request: assets(100) });
  const sold = sale.state.activeTradeId!; land(sale, 21); tick(sale); phase(sale, 'debt');
  ok(sale, 'A', { type: 'sell_property_to_bank', propertyIndex: 1 });
  assert.equal(sale.state.trades[sold].status, 'pending');
  reject(sale, 'B', { type: 'accept_trade', tradeId: sold }, 'INVALID_TRADE_PROPERTIES');
  ok(sale, 'A', { type: 'reject_trade', tradeId: sold });

  for (const action of ['lose_property', 'transfer_property', 'sabotage'] as const) {
    const risk = setup({ drawCard: card(action) }, 3); risk.state.properties[1].ownerId = action === 'sabotage' ? 'B' : 'A';
    const owner = risk.state.properties[1].ownerId;
    ok(risk, owner, { type: 'propose_trade', targetId: 'C', offer: assets(0, [1]), request: assets(100) });
    const id = risk.state.activeTradeId!; land(risk, 31); ok(risk, 'A', { type: 'acknowledge_card' });
    if (action === 'sabotage') ok(risk, 'A', { type: 'execute_sabotage', propertyIndex: 1 });
    assert.equal(risk.state.trades[id].status, 'pending');
    reject(risk, 'C', { type: 'accept_trade', tradeId: id }, 'INVALID_TRADE_PROPERTIES');
  }
});

test('persistent offers can be declined or withdrawn once, including while movement resolves', () => {
  for (const responder of ['A', 'B']) {
    const game = setup({}, 3); ok(game, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(10), request: assets() });
    const tradeId = game.state.activeTradeId!;
    land(game, 1); ok(game, 'A', { type: 'pass_property' }); ok(game, 'A', { type: 'end_turn' });
    ok(game, 'B', { type: 'roll_dice' });
    reject(game, 'B', { type: 'accept_trade', tradeId }, 'WRONG_PHASE');
    reject(game, 'B', { type: 'counter_trade', tradeId, offer: assets(), request: assets() }, 'WRONG_PHASE');
    reject(game, 'C', { type: 'reject_trade', tradeId }, 'TRADE_PARTICIPANTS_ONLY');
    ok(game, responder, { type: 'reject_trade', tradeId });
    assert.equal(game.state.trades[tradeId].status, responder === 'A' ? 'cancelled' : 'rejected');
    reject(game, responder, { type: 'reject_trade', tradeId }, 'TRADE_NOT_PENDING');
  }
});

test('Vacation skips and unrelated departure preserve offers; elimination closes only affected offers', () => {
  const game = setup({}, 4);
  ok(game, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(10), request: assets() });
  const keep = game.state.activeTradeId!;
  ok(game, 'C', { type: 'propose_trade', targetId: 'D', offer: assets(10), request: assets() });
  const close = game.state.activeTradeId!;
  game.getPlayer('B')!.skipNextTurn = true;
  land(game, 1); ok(game, 'A', { type: 'pass_property' }); ok(game, 'A', { type: 'end_turn' });
  assert.equal(game.getCurrentPlayer()!.id, 'C'); assert.equal(game.state.trades[keep].status, 'pending');
  ok(game, 'C', { type: 'leave_game' });
  assert.equal(game.getCurrentPlayer()!.id, 'D'); assert.equal(game.state.trades[keep].status, 'pending');
  assert.equal(game.state.trades[close].status, 'cancelled');
  assert.ok(game.state.logs.some(log => log.includes('closed because Player 3 left the game')));
  reject(game, 'D', { type: 'accept_trade', tradeId: close }, 'TRADE_NOT_PENDING');
  ok(game, 'B', { type: 'accept_trade', tradeId: keep });

  const bankruptcy = setup({}, 3); bankruptcy.getPlayer('A')!.money = 0; bankruptcy.state.properties[55].ownerId = 'B'; bankruptcy.state.properties[55].houses = 5;
  ok(bankruptcy, 'A', { type: 'propose_trade', targetId: 'C', offer: assets(), request: assets(10) });
  const affected = bankruptcy.state.activeTradeId!;
  land(bankruptcy, 55); tick(bankruptcy); ok(bankruptcy, 'A', { type: 'declare_bankruptcy' });
  assert.equal(bankruptcy.state.trades[affected].status, 'cancelled');
  assert.ok(bankruptcy.state.logs.some(log => log.includes('closed because Player 1 went bankrupt')));

  const ended = setup(); ok(ended, 'A', { type: 'propose_trade', targetId: 'B', offer: assets(10), request: assets() });
  const last = ended.state.activeTradeId!; ok(ended, 'A', { type: 'leave_game' });
  assert.equal(ended.state.state, 'ended'); assert.equal(ended.state.trades[last].status, 'cancelled');
  reject(ended, 'B', { type: 'accept_trade', tradeId: last }, 'GAME_ENDED');
});

test('debt timeout liquidates assets in stable order, settles only recovered rent then ends bankrupt player', () => {
  const game = setup(); game.getPlayer('A')!.money = 10; game.state.properties[55].ownerId = 'B'; game.state.properties[55].houses = 5;
  game.state.properties[1].ownerId = 'A'; land(game, 55); tick(game); phase(game,'debt'); tick(game);
  assert.equal(game.state.state,'ended'); assert.equal(game.state.winnerId,'B'); assert.equal(game.getPlayer('A')!.status,'bankrupt');
  assert.equal(game.getPlayer('B')!.money,1555); assert.equal(game.state.properties[1].ownerId,null);
  assert.equal(game.state.turnDeadline,undefined);
  for (const command of [{type:'roll_dice'},{type:'start_game'},{type:'leave_game'},{type:'propose_trade',targetId:'A',offer:assets(),request:assets()}]) reject(game,'B',command,'GAME_ENDED');
});

test('Risk protection is consumed once for random loss, random transfer and sabotage', () => {
  for (const action of ['lose_property','transfer_property'] as const) {
    const game=setup({drawCard:card(action)}); game.state.properties[1].ownerId='A'; game.state.properties[1].houses=3; game.state.properties[1].protected=true;
    land(game,31); ok(game,'A',{type:'acknowledge_card'});
    assert.equal(game.state.properties[1].ownerId,'A'); assert.equal(game.state.properties[1].houses,3); assert.equal(game.state.properties[1].protected,false);
  }
  const game=setup({drawCard:card('sabotage')}); game.state.properties[1].ownerId='B'; game.state.properties[1].houses=2; game.state.properties[1].protected=true;
  land(game,31); ok(game,'A',{type:'acknowledge_card'}); assert.deepEqual(phase(game,'risk_target').targets,[1]);
  reject(game,'B',{type:'execute_sabotage',propertyIndex:1}); ok(game,'A',{type:'execute_sabotage',propertyIndex:1});
  assert.equal(game.state.properties[1].ownerId,'B'); assert.equal(game.state.properties[1].houses,2); assert.equal(game.state.properties[1].protected,false);
});

test('Risk no-target choices resolve and protection cannot target an opponent', () => {
  for (const action of ['sabotage','protect','lose_property','transfer_property'] as const) {
    const game=setup({drawCard:card(action)}); land(game,31); ok(game,'A',{type:'acknowledge_card'}); phase(game,'awaiting_end');
  }
  const game=setup({drawCard:card('protect')}); game.state.properties[1].ownerId='A'; game.state.properties[2].ownerId='B';
  land(game,31); ok(game,'A',{type:'acknowledge_card'}); reject(game,'A',{type:'execute_protection',propertyIndex:2});
  ok(game,'A',{type:'execute_protection',propertyIndex:1}); assert.equal(game.state.properties[1].protected,true);
});

test('non-current departure preserves actor, phase, deadline and doubles; current departure selects successor', () => {
  const game=setup({dice:()=>[1,1]},4); ok(game,'A',{type:'roll_dice'}); tick(game); tick(game); phase(game,'buy');
  const before={phase:structuredClone(game.state.phase),deadline:game.state.turnDeadline,turnId:game.state.turnId,phaseId:game.state.phaseId};
  ok(game,'C',{type:'leave_game'});
  assert.deepEqual(game.state.phase,before.phase); assert.equal(game.state.turnDeadline,before.deadline); assert.equal(game.state.turnId,before.turnId); assert.equal(game.state.phaseId,before.phaseId);
  assert.equal(game.state.doublesCount,1); assert.equal(game.getCurrentPlayer()!.id,'A');
  ok(game,'A',{type:'leave_game'}); assert.equal(game.getCurrentPlayer()!.id,'B'); phase(game,'awaiting_roll'); assert.equal(game.state.hostId,'B');
});

test('two-to-one forfeit ends with immutable winner, while lobby leave transfers host safely', () => {
  const game=setup(); ok(game,'B',{type:'leave_game'}); assert.equal(game.state.winnerId,'A'); phase(game,'ended');
  reject(game,'A',{type:'roll_dice'},'GAME_ENDED');
  const lobby=new MonopolyGame('EMPTY1'); lobby.addPlayer('A','a','Ada',PLAYER_COLORS[0]); lobby.addPlayer('B','b','Ben',PLAYER_COLORS[1]);
  ok(lobby,'A',{type:'leave_game'}); assert.equal(lobby.state.hostId,'B'); ok(lobby,'B',{type:'leave_game'}); assert.equal(lobby.state.hostId,null);
});

test('rehydrated moving and debt phases resume without rerolling and fork is independent', () => {
  let diceCalls=0;
  const game=setup({dice:()=>{diceCalls++;return [1,2];}}); ok(game,'A',{type:'roll_dice'}); tick(game);
  const rehydrated=new MonopolyGame('TEST01'); rehydrated.state=JSON.parse(JSON.stringify(game.state)); assertGameState(rehydrated.state);
  tick(rehydrated); assert.equal(diceCalls,1); assert.equal(rehydrated.getPlayer('A')!.position,3); phase(rehydrated,'awaiting_end');
  const fork=game.fork(); fork.state.players[0].money=999; assert.notEqual(game.state.players[0].money,999);
  assert.throws(()=>assertGameState({...game.state,schemaVersion:1}));
  assert.throws(()=>assertGameState({...game.state,properties:{}}));
});

test('randomized legal/illegal sequences preserve structural and atomicity invariants', () => {
  for (let seed=1;seed<=24;seed++) {
    let value=seed;
    const random=()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/2**32;};
    const game=setup({random,dice:()=>[1+Math.floor(random()*6),1+Math.floor(random()*6)]},4);
    let lastVersion=game.state.version;
    for (let step=0;step<500 && game.state.state==='playing';step++) {
      const current=game.getCurrentPlayer()!;
      if (step%7===0) reject(game,current.id,{type:'buy_property',propertyIndex:999,housesToBuy:-1});
      const p=game.state.phase;
      if (p.kind==='buy' && random()<.65) {
        const price=(p.mode==='buy' ? BOARD_DATA[p.propertyIndex].price??0 : 0);
        const cost=BOARD_DATA[p.propertyIndex].houseCost??0;
        const affordable=cost ? Math.max(0,Math.floor((current.money-price)/cost)) : 0;
        const houses=Math.min(p.maxHouses,affordable,Math.floor(random()*3));
        if (p.mode==='buy' || houses>0) ok(game,current.id,{type:p.mode==='buy'?'buy_property':'upgrade_property',propertyIndex:p.propertyIndex,housesToBuy:houses});
        else ok(game,current.id,{type:'pass_property'});
      } else if (p.kind==='risk_target') ok(game,current.id,{type:p.action==='protect'?'execute_protection':'execute_sabotage',propertyIndex:p.targets[Math.floor(random()*p.targets.length)]});
      else if (p.kind==='flight') ok(game,current.id,{type:'flight_decision',destinationIndex:random()<.5?null:p.destinations[Math.floor(random()*p.destinations.length)]});
      else tick(game);
      assert.equal(game.state.version,lastVersion+1); lastVersion=game.state.version;
      assertGameState(game.state);
      assert.equal(game.state.events.every((event,index,events)=>index===0 || event.sequence>events[index-1].sequence),true);
      if ((game.state.state as string)==='ended') reject(game,current.id,{type:'roll_dice'},'GAME_ENDED');
    }
  }
});

test('corrupt nested snapshot fields fail closed before rehydration', () => {
  const fixtures: MonopolyGame[] = [];
  const rolling=setup(); ok(rolling,'A',{type:'roll_dice'}); fixtures.push(rolling);
  const moving=rolling.fork(); tick(moving); fixtures.push(moving);
  const buying=setup(); land(buying,1); fixtures.push(buying);
  const drawing=setup({drawCard:card('add_money',200)}); land(drawing,13); fixtures.push(drawing);
  const risk=setup({drawCard:card('protect')}); risk.state.properties[1].ownerId='A'; land(risk,31); ok(risk,'A',{type:'acknowledge_card'}); fixtures.push(risk);
  const flight=setup(); flight.state.properties[6].ownerId='A'; land(flight,6); fixtures.push(flight);
  const rent=setup(); rent.state.properties[4].ownerId='B'; rent.getPlayer('A')!.money=0; land(rent,4); fixtures.push(rent);
  const debt=rent.fork(); tick(debt); fixtures.push(debt);
  for (const game of fixtures) {
    const tamper=(change:(value: any)=>void) => { const state=structuredClone(game.state); change(state); assert.throws(()=>assertGameState(state)); };
    tamper(state=>state.phase.playerId='B');
    tamper(state=>state.gameId='');
    tamper(state=>state.players[0].money=Infinity);
    tamper(state=>state.players[0].position=-1);
    tamper(state=>state.properties[1].houses=99);
    tamper(state=>state.properties[1].ownerId='missing');
    tamper(state=>state.lastEventSequence++);
    if (game.state.events.length) tamper(state=>state.events[0].sequence=-1);
    switch(game.state.phase.kind) {
      case 'rolling': tamper(state=>state.phase.dice=[7,1]); break;
      case 'moving': tamper(state=>state.phase.path=[999]); tamper(state=>state.phase.reason='teleport'); tamper(state=>state.phase.durationMs=-1); tamper(state=>state.phase.continuation='unknown'); break;
      case 'buy': tamper(state=>state.phase.propertyIndex=3); tamper(state=>state.phase.maxHouses=99); break;
      case 'card': tamper(state=>state.phase.card.action='mint_money'); tamper(state=>state.phase.card.amount=-1); break;
      case 'risk_target': tamper(state=>state.phase.targets=[2]); tamper(state=>state.phase.action='unknown'); break;
      case 'flight': tamper(state=>state.phase.destinations=[55]); tamper(state=>state.phase.ticketPrice=-1); break;
      case 'rent': tamper(state=>state.phase.payment.amount=NaN); tamper(state=>state.phase.debt.remaining++); break;
      case 'debt': tamper(state=>state.phase.debt.continuation={kind:'flight',airportId:999}); tamper(state=>state.phase.debt.remaining--); break;
    }
  }
});

test('restart at every timed phase preserves exact continuation and never duplicates completed effects', () => {
  let diceCalls=0;
  const game=setup({dice:()=>{diceCalls++;return [1,2];},drawCard:card('go_back_3')});
  game.getPlayer('A')!.position=44;
  ok(game,'A',{type:'roll_dice'});
  for (let i=0;i<6;i++) {
    const raw=JSON.stringify(game.state);
    const restored=new MonopolyGame('TEST01',{drawCard:card('go_back_3')}); restored.state=JSON.parse(raw); restored.validateState();
    const deadline=restored.state.turnDeadline!;
    const command={type:'timeout' as const,turnId:restored.state.turnId,phaseId:restored.state.phaseId};
    ok(restored,SYSTEM_ACTOR,command,deadline);
    const resulting=structuredClone(restored.state);
    const duplicate=restored.applyCommand(SYSTEM_ACTOR,command,deadline+999_999);
    assert.equal(duplicate.ok,false); assert.deepEqual(restored.state,resulting);
    game.state=restored.state;
    if (game.state.phase.kind==='awaiting_end') break;
  }
  assert.equal(diceCalls,1); assert.equal(game.getCurrentPlayer()!.id,'A'); assert.equal(game.getPlayer('A')!.position,44);
  phase(game,'awaiting_end');
});

test('departure in every active phase cancels only the departed turn and stale deadline cannot affect successor', () => {
  const variants: ((game:MonopolyGame)=>void)[] = [
    ()=>{},
    game=>{ok(game,'A',{type:'roll_dice'});},
    game=>{ok(game,'A',{type:'roll_dice'});tick(game);},
    game=>{land(game,1);},
    game=>{land(game,13);},
    game=>{game.state.properties[1].ownerId='A';land(game,31);ok(game,'A',{type:'acknowledge_card'});},
    game=>{game.state.properties[6].ownerId='B';land(game,6);},
    game=>{game.state.properties[6].ownerId='A';land(game,6);},
    game=>{game.state.properties[4].ownerId='B';game.getPlayer('A')!.money=0;land(game,4);tick(game);},
    game=>{land(game,14);},
  ];
  for (const prepare of variants) {
    const game=setup({drawCard:card('protect')},4); prepare(game);
    const stale={type:'timeout' as const,turnId:game.state.turnId,phaseId:game.state.phaseId};
    ok(game,'A',{type:'leave_game'});
    assert.equal(game.getCurrentPlayer()!.id,'B'); phase(game,'awaiting_roll'); assert.equal(game.state.doublesCount,0);
    assert.equal(game.state.activeCard,null); assert.equal(game.state.awaitingBuyDecision,null); assert.equal(game.state.awaitingDebtResolution,null);
    reject(game,SYSTEM_ACTOR,stale,'STALE_TIMEOUT');
  }
});

test('creditor or risk target departure cannot leave stale asset choices or payable identities', () => {
  const debt=setup({},3); debt.getPlayer('A')!.money=0; debt.state.properties[4].ownerId='B'; debt.state.properties[55].ownerId='A';
  land(debt,4); tick(debt); ok(debt,'B',{type:'leave_game'}); assert.equal(phase(debt,'debt').debt.creditorId,null);
  ok(debt,'A',{type:'sell_property_to_bank',propertyIndex:55}); phase(debt,'awaiting_end'); assert.equal(debt.getPlayer('B')!.money,1500);
  const sabotage=setup({drawCard:card('sabotage')},3); sabotage.state.properties[1].ownerId='B';land(sabotage,31);ok(sabotage,'A',{type:'acknowledge_card'});
  ok(sabotage,'B',{type:'leave_game'});phase(sabotage,'awaiting_end');assert.equal(sabotage.getCurrentPlayer()!.id,'A');
  const flying=setup({},3); flying.state.properties[6].ownerId='B';land(flying,6);tick(flying);phase(flying,'flight');
  ok(flying,'B',{type:'leave_game'});phase(flying,'awaiting_end');
});

test('trade away pending upgrade and change airport owner safely recompute the current choice', () => {
  const game=setup();game.state.properties[1].ownerId='A';land(game,1);phase(game,'buy');
  ok(game,'A',{type:'propose_trade',targetId:'B',offer:assets(0,[1]),request:assets(100)});
  ok(game,'B',{type:'accept_trade',tradeId:game.state.activeTradeId!});phase(game,'awaiting_end');
  const flight=setup();flight.state.properties[6].ownerId='B';land(flight,6);tick(flight);assert.equal(phase(flight,'flight').ticketPrice,400);
  ok(flight,'B',{type:'propose_trade',targetId:'A',offer:assets(0,[6]),request:assets(200)});
  ok(flight,'A',{type:'accept_trade',tradeId:flight.state.activeTradeId!});assert.equal(phase(flight,'flight').ticketPrice,0);
});

test('all mines and airport owner counts charge the canonical rent tier', () => {
  for (const type of ['utility','railroad'] as const) for (let count=1;count<=4;count++) {
    const game=setup();const squares=BOARD_DATA.filter(square=>square.type===type);
    for (const square of squares.slice(0,count)) game.state.properties[square.id].ownerId='B';
    land(game,squares[0].id); assert.equal(phase(game,'rent').payment.amount,[20,75,200,300][count-1]);
  }
});

test('initial purchase caps development at two houses even when completing a group', () => {
  const game=setup();game.state.properties[2].ownerId='A';game.state.properties[4].ownerId='A';land(game,1);
  assert.equal(phase(game,'buy').maxHouses,2);
  reject(game,'A',{type:'buy_property',propertyIndex:1,housesToBuy:3});
  reject(game,'A',{type:'buy_property',propertyIndex:1,housesToBuy:5});
  ok(game,'A',{type:'buy_property',propertyIndex:1,housesToBuy:2});assert.equal(game.state.properties[1].houses,2);
});

test('buying an airport offers its new owner a free flight before ending or granting an extra roll', () => {
  const game=setup();land(game,6);ok(game,'A',{type:'buy_property',propertyIndex:6,housesToBuy:0});
  assert.equal(phase(game,'flight').ticketPrice,0);assert.equal(game.getCurrentPlayer()!.id,'A');
  const before=game.getPlayer('A')!.money;
  ok(game,'A',{type:'flight_decision',destinationIndex:7});tick(game);
  assert.equal(game.getPlayer('A')!.money,before);assert.equal(game.getPlayer('A')!.flightChances,0);phase(game,'buy');
  ok(game,'A',{type:'pass_property'});phase(game,'awaiting_end');
  const exhausted=setup();exhausted.getPlayer('A')!.flightChances=0;land(exhausted,6);
  ok(exhausted,'A',{type:'buy_property',propertyIndex:6,housesToBuy:0});phase(exhausted,'awaiting_end');
});

test('seeded interleaved trades, counters, departures and turn changes remain atomic', () => {
  const counts = { attempted: 0, acceptedTrades: 0, counteroffers: 0, rejectedCommands: 0,
    nonCurrentTrades: 0, nonCurrentDepartures: 0, turnChanges: 0 };
  // Fixed bounds keep CI fast. Each seed uses all eight seats and an independently reproducible sequence.
  for (let seed = 1; seed <= 12; seed++) {
    let randomState = seed;
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 2 ** 32;
    };
    const game = setup({ random, dice: () => [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)] }, 8);
    let now = 1_001;
    const tradeAssets = (owner: ReturnType<MonopolyGame['getCurrentPlayer']>): TradeAssets => ({
      money: Math.floor(Math.max(0, owner!.money) * random() * .7),
      getOutOfJailCards: Math.floor((owner!.getOutOfJailCards + 1) * random()),
      properties: Object.values(game.state.properties).filter(property => property.ownerId === owner!.id && random() < .5).map(property => property.id),
    });
    for (let step = 0; step < 400 && game.state.state === 'playing'; step++) {
      const current = game.getCurrentPlayer()!;
      const currentPhase = game.state.phase;
      const active = game.state.players.filter(player => player.status === 'active');
      const choice = random();
      let actor = current.id;
      let command: GameCommand;
      if (choice < .02 && active.length > 2) {
        actor = active[Math.floor(random() * active.length)].id;
        command = { type: 'leave_game' };
      } else if (choice < .25 && ['awaiting_roll', 'awaiting_end', 'buy', 'flight', 'debt'].includes(currentPhase.kind)) {
        const pending = Object.values(game.state.trades).filter(trade => trade.status === 'pending');
        if (pending.length && random() < .6) {
          const trade = pending[Math.floor(random() * pending.length)];
          actor = trade.targetId;
          if (random() < .2) command = { type: 'counter_trade', tradeId: trade.id,
            offer: tradeAssets(game.getPlayer(trade.targetId)), request: tradeAssets(game.getPlayer(trade.initiatorId)) };
          else command = { type: 'accept_trade', tradeId: trade.id };
        } else {
          const source = active[Math.floor(random() * active.length)];
          const candidates = active.filter(player => player.id !== source.id);
          const target = candidates[Math.floor(random() * candidates.length)];
          actor = source.id;
          command = { type: 'propose_trade', targetId: target.id, offer: tradeAssets(source), request: tradeAssets(target) };
        }
      } else if (currentPhase.kind === 'buy' && random() < .8) {
        const square = BOARD_DATA[currentPhase.propertyIndex];
        const baseCost = currentPhase.mode === 'buy' ? square.price ?? 0 : 0;
        const affordable = Math.min(currentPhase.maxHouses, Math.max(0, Math.floor((current.money - baseCost) / (square.houseCost || 1))));
        command = affordable === 0 && currentPhase.mode === 'upgrade' ? { type: 'pass_property' } : {
          type: currentPhase.mode === 'buy' ? 'buy_property' : 'upgrade_property', propertyIndex: currentPhase.propertyIndex,
          // Zero on an upgrade is deliberately adversarial: a clear rejection must have no partial effects.
          housesToBuy: Math.floor(random() * (affordable + 1)),
        };
      } else if (currentPhase.kind === 'flight') {
        command = { type: 'flight_decision', destinationIndex: random() < .7 ? currentPhase.destinations[Math.floor(random() * currentPhase.destinations.length)] : null };
      } else if (currentPhase.kind === 'risk_target') {
        command = { type: currentPhase.action === 'protect' ? 'execute_protection' : 'execute_sabotage',
          propertyIndex: currentPhase.targets[Math.floor(random() * currentPhase.targets.length)] };
      } else {
        actor = SYSTEM_ACTOR;
        now = Math.max(now, game.state.turnDeadline!);
        command = { type: 'timeout', turnId: game.state.turnId, phaseId: game.state.phaseId };
      }
      const before = structuredClone(game.state);
      const result = game.applyCommand(actor, command, now++);
      counts.attempted++;
      if (!result.ok) {
        assert.notEqual(result.error.code, 'INVALID_SNAPSHOT', `Invariant failure at seed ${seed}, step ${step}, ${command.type}: ${result.error.message}`);
        assert.deepEqual(game.state, before, `Partial rejected transition at seed ${seed}, step ${step}`);
        counts.rejectedCommands++;
      } else {
        assert.equal(game.state.version, before.version + 1);
        assertGameState(game.state);
        if (game.state.turnId !== before.turnId) counts.turnChanges++;
        if (command.type === 'leave_game' && actor !== current.id) counts.nonCurrentDepartures++;
        if (command.type === 'propose_trade' && actor !== current.id) counts.nonCurrentTrades++;
        if (command.type === 'counter_trade') counts.counteroffers++;
        if (command.type === 'accept_trade') {
          counts.acceptedTrades++;
          if (before.phase.kind !== 'debt') assert.equal(game.state.players.reduce((sum, player) => sum + player.money, 0),
            before.players.reduce((sum, player) => sum + player.money, 0), 'An ordinary accepted trade must conserve total cash');
        }
      }
    }
  }
  assert.equal(counts.attempted, 4_800);
  for (const metric of ['acceptedTrades', 'counteroffers', 'rejectedCommands', 'nonCurrentTrades', 'nonCurrentDepartures', 'turnChanges'] as const) {
    assert.ok(counts[metric] > 0, `The deterministic scenario must actually cover ${metric}`);
  }
});

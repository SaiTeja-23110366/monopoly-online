import test from 'node:test';
import assert from 'node:assert/strict';
import { MonopolyGame, SYSTEM_ACTOR, assertGameState, type EngineOptions } from '../src/gameState';
import {
  AIRPORTS, BOARD_DATA, PLAYER_COLORS, flightDestinations, hotelActive, liquidationValue,
  ownsColorGroup, propertyRent, propertyValue, rulesForGame,
} from '../../shared/board';
import type { ActiveCard, GameCommand, GamePhase, GameState, TradeAssets } from '../../shared/types';

type Version = 2 | 3 | undefined;
const MINES = [10, 27, 37, 50];
const CITIES = BOARD_DATA.filter(square => square.type === 'property');
const VERSIONS: Version[] = [undefined, 2, 3];
const GROUP = [1, 2, 4];
const DEFAULT_OPTIONS: EngineOptions = { now: () => 1_000, dice: () => [1, 2], random: () => 0 };

function command(game: MonopolyGame, actor: string, action: GameCommand, now = 1_000) {
  const result = game.applyCommand(actor, action, now);
  assert.equal(result.ok, true, result.ok ? undefined : `${action.type}: ${result.error.code}: ${result.error.message}`);
  assertGameState(game.state);
  return result;
}
function rejects(game: MonopolyGame, actor: string, action: unknown, code?: string) {
  const before = structuredClone(game.state);
  const result = game.applyCommand(actor, action as GameCommand, 1_000);
  assert.equal(result.ok, false, `${JSON.stringify(action)} must reject`);
  if (!result.ok && code) assert.equal(result.error.code, code);
  assert.deepEqual(game.state, before, 'Rejected commands must be completely atomic');
}
function setup(version?: Version, count = 3, options: EngineOptions = {}) {
  const selectedVersion = arguments.length === 0 ? 3 : version;
  const game = new MonopolyGame('ECON01', { ...DEFAULT_OPTIONS, ...options });
  // Missing/2 represent actual persisted pre-upgrade snapshots, not new-game settings.
  if (selectedVersion === undefined) delete game.state.rulesVersion;
  else game.state.rulesVersion = selectedVersion;
  for (let i = 0; i < count; i++) assert.equal(game.addPlayer(String.fromCharCode(65 + i), `socket-${i}`, `Player ${i}`, PLAYER_COLORS[i]), true);
  command(game, 'A', { type: 'start_game' });
  return game;
}
function phase<K extends GamePhase['kind']>(game: MonopolyGame, kind: K): Extract<GamePhase, { kind: K }> {
  assert.equal(game.state.phase.kind, kind);
  return game.state.phase as Extract<GamePhase, { kind: K }>;
}
function tick(game: MonopolyGame) {
  return command(game, SYSTEM_ACTOR, { type: 'timeout', turnId: game.state.turnId, phaseId: game.state.phaseId }, game.state.turnDeadline);
}
/** Return cash immediately before landing, so crossing Start cannot hide rent errors. */
function land(game: MonopolyGame, index: number) {
  const actor = game.getCurrentPlayer()!.id;
  game.getPlayer(actor)!.position = (index + 56 - 3) % 56;
  command(game, actor, { type: 'roll_dice' });
  tick(game);
  const before = game.getPlayer(actor)!.money;
  tick(game);
  return before;
}
function turnTo(game: MonopolyGame, actor: string) {
  if (game.state.phase.kind === 'awaiting_end') command(game, game.getCurrentPlayer()!.id, { type: 'end_turn' });
  while (game.getCurrentPlayer()!.id !== actor) {
    phase(game, 'awaiting_roll');
    land(game, 14);
    command(game, game.getCurrentPlayer()!.id, { type: 'end_turn' });
  }
  phase(game, 'awaiting_roll');
}
const assets = (properties: number[] = [], money = 0): TradeAssets => ({ properties, money, getOutOfJailCards: 0 });
function trade(game: MonopolyGame, from: string, to: string, offer: TradeAssets, request = assets()) {
  command(game, from, { type: 'propose_trade', targetId: to, offer, request });
  const id = game.state.activeTradeId!;
  command(game, to, { type: 'accept_trade', tradeId: id });
  return id;
}
function own(game: MonopolyGame, ids: readonly number[], owner: string) {
  for (const id of ids) game.state.properties[id].ownerId = owner;
}
function expectGroup(game: MonopolyGame, active: boolean, owner = 'A') {
  assert.equal(ownsColorGroup(game.state.properties, 1, owner), active);
  assert.equal(hotelActive(game.state.properties, 1, game.state.rulesVersion), active);
  assert.equal(game.state.properties[1].houses, 5, 'An inactive hotel is retained, not demolished');
  assert.equal(propertyRent(game.state.properties, 1, game.state.rulesVersion), active ? 350 : 160);
}
const draw = (action: ActiveCard['action'], amount?: number): EngineOptions['drawCard'] => deck => ({ deck, action, text: action, amount });
function roundTrip(game: MonopolyGame, options: EngineOptions = {}) {
  const saved: unknown = JSON.parse(JSON.stringify(game.state));
  assertGameState(saved);
  const restored = new MonopolyGame(game.roomCode, { ...DEFAULT_OPTIONS, ...options });
  restored.state = saved;
  assertGameState(restored.state);
  return restored;
}

test('economy: all 36 city prices, house costs, nominal rents and liquidation values remain unchanged', () => {
  const baseline = [
    [1,60,50,6,22,43,80,160,350], [2,60,50,6,22,43,80,160,350], [4,80,50,8,26,49,90,180,400],
    [5,100,50,10,30,55,100,200,450], [7,100,50,10,30,55,100,200,450], [8,120,50,12,34,61,110,220,500],
    [9,140,50,14,38,67,120,240,550], [11,140,50,14,38,67,120,240,550], [12,160,100,16,52,98,180,360,800],
    [15,180,100,18,56,104,190,380,850], [16,180,100,18,56,104,190,380,850], [18,200,100,20,60,110,200,400,900],
    [19,220,100,22,64,116,210,420,950], [20,220,100,22,64,116,210,420,950], [22,240,100,24,68,122,220,440,1000],
    [23,260,100,26,72,128,230,460,1050], [25,260,100,26,72,128,230,460,1050], [26,280,100,28,76,134,240,480,1100],
    [29,300,150,30,90,165,300,600,1350], [30,300,150,30,90,165,300,600,1350], [32,320,150,32,94,171,310,620,1400],
    [33,350,150,36,102,183,330,660,1500], [35,350,150,36,102,183,330,660,1500], [36,400,150,40,110,195,350,700,1600],
    [38,420,150,42,114,201,360,720,1650], [39,420,150,42,114,201,360,720,1650], [41,450,200,46,132,238,430,860,1950],
    [43,480,200,48,136,244,440,880,2000], [44,480,200,48,136,244,440,880,2000], [46,500,200,50,140,250,450,900,2050],
    [48,520,200,52,144,256,460,920,2100], [49,520,200,52,144,256,460,920,2100], [51,550,250,56,162,293,530,1060,2400],
    [52,600,250,60,170,305,550,1100,2500], [54,600,250,60,170,305,550,1100,2500], [55,650,250,66,182,323,580,1160,2650],
  ];
  assert.equal(CITIES.length, 36);
  assert.deepEqual(CITIES.map(square => [square.id, square.price, square.houseCost, ...square.rent!]), baseline);
  for (const [id, price, houseCost] of baseline) for (let houses = 0; houses <= 5; houses++) {
    assert.equal(propertyValue(id, houses), price + houseCost * houses);
    assert.equal(liquidationValue(id, houses), Math.floor((price + houseCost * houses) * 0.75));
  }
});

test('economy: new games use version 3 and explicit/missing version 2 preserve the old rule catalog', () => {
  const fresh = new MonopolyGame('NEW001');
  assert.equal(fresh.state.rulesVersion, 3);
  assert.equal(rulesForGame(fresh.state).version, 3);
  for (const version of VERSIONS) {
    const game = setup(version);
    const rules = rulesForGame(game.state);
    assert.equal(rules.version, version === 3 ? 3 : 2);
    assert.equal(rules.passingStart, version === 3 ? 200 : 750);
    assert.equal(rules.landingStart, version === 3 ? 300 : 1000);
    assert.deepEqual(rules.mineBonuses, version === 3 ? [0,25,60,100,150] : [0,200,500,1000,2000]);
    const restored = roundTrip(game);
    assert.equal(restored.state.rulesVersion, version);
    assert.equal(restored.fork().state.rulesVersion, version);
    assert.equal(rulesForGame(restored.state).version, rules.version);
  }
});

test('economy: every city and building level charges versioned rent for complete, unowned and split groups', () => {
  for (const version of VERSIONS) for (const square of CITIES) for (let houses = 0; houses <= 5; houses++) {
    for (const ownership of ['complete', 'unowned', 'split'] as const) {
      const label = `version ${version ?? 'missing'}, ${square.fullName}, level ${houses}, ${ownership}`;
      const game = setup(version);
      game.getPlayer('A')!.money = 10_000;
      const group = CITIES.filter(other => other.colorGroup === square.colorGroup);
      const peers = group.filter(other => other.id !== square.id);
      own(game, [square.id], 'B');
      game.state.properties[square.id].houses = houses;
      if (ownership === 'complete') own(game, peers.map(other => other.id), 'B');
      if (ownership === 'split') { own(game, [peers[0].id], 'B'); own(game, [peers[1].id], 'C'); }
      const complete = ownership === 'complete';
      const effectiveLevel = version === 3 && houses === 5 && !complete ? 4 : houses;
      const expected = square.rent![effectiveLevel] * (version === 3 && complete && houses === 0 ? 2 : 1);
      assert.equal(ownsColorGroup(game.state.properties, square.id, 'B'), complete, label);
      assert.equal(ownsColorGroup(game.state.properties, square.id, 'A'), false, label);
      assert.equal(hotelActive(game.state.properties, square.id, version), houses === 5 && (version !== 3 || complete), label);
      assert.equal(propertyRent(game.state.properties, square.id, version), expected, label);
      const ownerBefore = game.getPlayer('B')!.money;
      const payerBefore = land(game, square.id);
      assert.equal(phase(game, 'rent').payment.amount, expected, label);
      assert.equal(game.getPlayer('A')!.money, payerBefore - expected, label);
      assert.equal(game.getPlayer('B')!.money, ownerBefore + expected, label);
      assert.equal(game.state.properties[square.id].houses, houses, label);
      tick(game);
      assert.equal(game.getPlayer('B')!.money, ownerBefore + expected, 'Rent is not charged twice when presentation finishes');
    }
  }
});

test('economy: Start rewards use one total mine bonus at all tiers, exactly once per eligible crossing', () => {
  for (const version of VERSIONS) for (let count = 0; count <= 4; count++) for (const landing of [false, true]) {
    const game = setup(version);
    own(game, MINES.slice(0, count), 'A');
    game.getPlayer('A')!.position = landing ? 53 : 54;
    game.getPlayer('A')!.flightChances = 0;
    const bonus = (version === 3 ? [0,25,60,100,150] : [0,200,500,1000,2000])[count];
    const salary = version === 3 ? (landing ? 300 : 200) : (landing ? 1000 : 750);
    command(game, 'A', { type: 'roll_dice' }); tick(game);
    assert.equal(game.getPlayer('A')!.money, 1500 + salary + bonus);
    assert.equal(game.getPlayer('A')!.flightChances, 1);
    assert.equal(game.getPlayer('A')!.position, landing ? 0 : 1);
    tick(game);
    assert.equal(game.getPlayer('A')!.money, 1500 + salary + bonus);
  }
});

test('economy: advance-to-Start cards follow the saved version, including after JSON recovery', () => {
  for (const version of VERSIONS) for (let count = 0; count <= 4; count++) {
    let game = setup(version, 3, { drawCard: draw('go_to_start') });
    own(game, MINES.slice(0, count), 'A');
    land(game, 13);
    const before = game.getPlayer('A')!.money;
    game = roundTrip(game, { drawCard: draw('go_to_start') });
    command(game, 'A', { type: 'acknowledge_card' });
    const bonus = (version === 3 ? [0,25,60,100,150] : [0,200,500,1000,2000])[count];
    assert.equal(game.getPlayer('A')!.money, before + (version === 3 ? 300 : 1000) + bonus);
    game = roundTrip(game);
    tick(game);
    assert.equal(game.getPlayer('A')!.money, before + (version === 3 ? 300 : 1000) + bonus);
  }
});

test('economy: mine and airport ownership-tier rent remain 20/75/200/300 in every version', () => {
  for (const version of VERSIONS) for (const ids of [MINES, [...AIRPORTS]]) for (let count = 1; count <= 4; count++) {
    const game = setup(version);
    own(game, ids.slice(0, count), 'B');
    const expected = [20,75,200,300][count - 1];
    assert.equal(propertyRent(game.state.properties, ids[0], version), expected);
    assert.equal(ownsColorGroup(game.state.properties, ids[0], 'B'), false);
    assert.equal(hotelActive(game.state.properties, ids[0], version), false);
    const before = land(game, ids[0]);
    assert.equal(phase(game, 'rent').payment.amount, expected);
    assert.equal(game.getPlayer('A')!.money, before - expected);
  }
});

test('economy: mortgaged target never charges rent and mortgaged mines/airports do not inflate ownership-tier rent', () => {
  for (const version of VERSIONS) {
    for (const index of [1, 6, 10]) {
      const game = setup(version);
      own(game, [index], 'B');
      game.state.properties[index].mortgaged = true;
      const before = land(game, index);
      assert.equal(game.getPlayer('A')!.money, before);
      assert.equal(game.getPlayer('B')!.money, 1500);
      phase(game, 'awaiting_end');
    }
    for (const ids of [MINES, [...AIRPORTS]]) {
      const game = setup(version); own(game, ids, 'B');
      game.state.properties[ids[3]].mortgaged = true;
      assert.equal(propertyRent(game.state.properties, ids[0], version), 200);
      land(game, ids[0]); assert.equal(phase(game, 'rent').payment.amount, 200);
    }
  }
});

test('economy: purchase completes a set and activates retained hotels and undeveloped base rent immediately', () => {
  const game = setup(); own(game, [1,2], 'A'); game.state.properties[1].houses = 5;
  expectGroup(game, false);
  land(game, 4);
  rejects(game, 'B', { type: 'buy_property', propertyIndex: 4, housesToBuy: 0 }, 'NOT_YOUR_TURN');
  command(game, 'A', { type: 'buy_property', propertyIndex: 4, housesToBuy: 0 });
  expectGroup(game, true);
  assert.equal(propertyRent(game.state.properties, 2, 3), 12);
  assert.equal(propertyRent(game.state.properties, 4, 3), 16);
  command(game, 'A', { type: 'end_turn' });
  const before = land(game, 1);
  assert.equal(phase(game, 'rent').payment.amount, 350);
  assert.equal(game.getPlayer('B')!.money, before - 350);
});

test('economy: trading a sibling breaks and restores the group without losing hotel development', () => {
  const game = setup(); own(game, GROUP, 'A'); game.state.properties[1].houses = 5;
  expectGroup(game, true);
  const initialValue = propertyValue(1, 5), initialLiquidation = liquidationValue(1, 5);
  const id = trade(game, 'A', 'B', assets([2]));
  expectGroup(game, false);
  assert.equal(propertyRent(game.state.properties, 4, 3), 8);
  rejects(game, 'B', { type: 'accept_trade', tradeId: id }, 'TRADE_NOT_PENDING');
  assert.equal(propertyValue(1, game.state.properties[1].houses), initialValue);
  assert.equal(liquidationValue(1, game.state.properties[1].houses), initialLiquidation);
  trade(game, 'B', 'A', assets([2]));
  expectGroup(game, true);
  assert.equal(propertyRent(game.state.properties, 4, 3), 16);
});

test('economy: ordinary hotel trades retain hotel and shield, active only with the recipient full set', () => {
  for (const recipientHasSet of [false, true]) {
    const game = setup(); own(game, GROUP, 'A'); game.state.properties[1].houses = 5; game.state.properties[1].protected = true;
    if (recipientHasSet) trade(game, 'A', 'B', assets([2,4]));
    trade(game, 'A', 'B', assets([1]));
    assert.equal(game.state.properties[1].ownerId, 'B');
    assert.equal(game.state.properties[1].protected, true);
    expectGroup(game, recipientHasSet, 'B');
    if (!recipientHasSet) { trade(game, 'A', 'B', assets([2,4])); expectGroup(game, true, 'B'); }
    else { trade(game, 'B', 'C', assets([2])); expectGroup(game, false, 'B'); trade(game, 'C', 'B', assets([2])); expectGroup(game, true, 'B'); }
  }
});

test('economy: buildings remain landing-only, initial purchases cap at two and hotel upgrades require a live set', () => {
  for (const version of VERSIONS) {
    const game = setup(version); own(game, GROUP, 'A'); game.state.properties[1].houses = 4;
    rejects(game, 'A', { type: 'upgrade_property', propertyIndex: 1, housesToBuy: 1 }, 'WRONG_PHASE');
    land(game, 1);
    assert.equal(phase(game, 'buy').maxHouses, 1);
    trade(game, 'A', 'B', assets([2]));
    assert.equal(phase(game, 'buy').maxHouses, 0);
    rejects(game, 'A', { type: 'upgrade_property', propertyIndex: 1, housesToBuy: 1 }, 'INVALID_BUILDINGS');
    trade(game, 'B', 'A', assets([2]));
    assert.equal(phase(game, 'buy').maxHouses, 1);
    const before = game.getPlayer('A')!.money;
    command(game, 'A', { type: 'upgrade_property', propertyIndex: 1, housesToBuy: 1 });
    assert.equal(game.getPlayer('A')!.money, before - 50);
    assert.equal(game.state.properties[1].houses, 5);
    rejects(game, 'A', { type: 'upgrade_property', propertyIndex: 1, housesToBuy: 1 }, 'WRONG_PHASE');
    const purchase = setup(version); own(purchase, [1,2], 'A'); land(purchase, 4);
    rejects(purchase, 'A', { type: 'buy_property', propertyIndex: 4, housesToBuy: 3 }, 'INVALID_BUILDINGS');
    command(purchase, 'A', { type: 'buy_property', propertyIndex: 4, housesToBuy: 2 });
    assert.equal(purchase.state.properties[4].houses, 2);
    assert.equal(propertyRent(purchase.state.properties, 4, version), 49);
  }
});

test('economy: random Risk loss and transfer break a sibling set; shield blocks the ownership change', () => {
  for (const action of ['lose_property', 'transfer_property'] as const) for (const shield of [false, true]) {
    // The second of three owned properties is the undeveloped sibling, not the hotel.
    const game = setup(3, 3, { drawCard: draw(action), random: () => 0.4 });
    own(game, GROUP, 'A'); game.state.properties[1].houses = 5; game.state.properties[2].protected = shield;
    land(game, 31); command(game, 'A', { type: 'acknowledge_card' });
    expectGroup(game, shield);
    assert.equal(game.state.properties[2].protected, false);
    if (shield) assert.equal(game.state.properties[2].ownerId, 'A');
    else if (action === 'transfer_property') {
      assert.equal(game.state.properties[2].ownerId, 'B');
      trade(game, 'B', 'A', assets([2])); expectGroup(game, true);
    } else {
      assert.equal(game.state.properties[2].ownerId, null);
      turnTo(game, 'A'); land(game, 2);
      command(game, 'A', { type: 'buy_property', propertyIndex: 2, housesToBuy: 0 }); expectGroup(game, true);
    }
  }
});

test('economy: Risk transfer can complete a recipient set and automatically reactivate its other hotel', () => {
  const game = setup(3, 3, { drawCard: draw('transfer_property') });
  own(game, [2], 'A'); own(game, [1,4], 'B'); game.state.properties[1].houses = 5;
  expectGroup(game, false, 'B');
  land(game, 31); command(game, 'A', { type: 'acknowledge_card' });
  assert.equal(game.state.properties[2].ownerId, 'B');
  expectGroup(game, true, 'B');
});

test('economy: sabotage breaks and purchase restores an opponent set, while a shield preserves it', () => {
  for (const shield of [false, true]) {
    const game = setup(3, 3, { drawCard: draw('sabotage') });
    own(game, GROUP, 'B'); game.state.properties[1].houses = 5; game.state.properties[2].protected = shield;
    land(game, 31); command(game, 'A', { type: 'acknowledge_card' });
    rejects(game, 'B', { type: 'execute_sabotage', propertyIndex: 2 }, 'NOT_YOUR_TURN');
    rejects(game, 'A', { type: 'execute_sabotage', propertyIndex: 55 }, 'INVALID_TARGET');
    command(game, 'A', { type: 'execute_sabotage', propertyIndex: 2 });
    expectGroup(game, shield, 'B');
    assert.equal(game.state.properties[2].protected, false);
    if (!shield) {
      turnTo(game, 'B'); land(game, 2);
      command(game, 'B', { type: 'buy_property', propertyIndex: 2, housesToBuy: 0 }); expectGroup(game, true, 'B');
    }
  }
});

test('economy: Risk still removes buildings on a directly lost/transferred/sabotaged hotel, unless shielded', () => {
  for (const action of ['lose_property', 'transfer_property', 'sabotage'] as const) for (const shield of [false, true]) {
    const game = setup(3, 3, { drawCard: draw(action) });
    const owner = action === 'sabotage' ? 'B' : 'A';
    own(game, GROUP, owner); game.state.properties[1].houses = 5; game.state.properties[1].protected = shield;
    land(game, 31); command(game, 'A', { type: 'acknowledge_card' });
    if (action === 'sabotage') command(game, 'A', { type: 'execute_sabotage', propertyIndex: 1 });
    assert.equal(game.state.properties[1].protected, false);
    assert.equal(game.state.properties[1].houses, shield ? 5 : 0);
    assert.equal(ownsColorGroup(game.state.properties, 2, owner), shield);
    assert.equal(propertyRent(game.state.properties, 2, 3), shield ? 12 : 6);
    if (shield) assert.equal(hotelActive(game.state.properties, 1, 3), true);
  }
});

test('economy: debt-only bank sale breaks the set without discounting retained hotel assets, and repurchase restores it', () => {
  const game = setup(); own(game, GROUP, 'A'); game.state.properties[1].houses = 5; own(game, [10], 'B');
  rejects(game, 'A', { type: 'sell_property_to_bank', propertyIndex: 4 }, 'WRONG_PHASE');
  game.getPlayer('A')!.money = 0;
  land(game, 10); tick(game); phase(game, 'debt');
  rejects(game, 'A', { type: 'sell_property_to_bank', propertyIndex: 10 }, 'INVALID_PROPERTY');
  command(game, 'A', { type: 'sell_property_to_bank', propertyIndex: 4 });
  expectGroup(game, false);
  assert.equal(game.getPlayer('A')!.money, 40);
  assert.equal(liquidationValue(1, game.state.properties[1].houses), 232);
  trade(game, 'B', 'A', assets([], 100));
  turnTo(game, 'A'); land(game, 4);
  command(game, 'A', { type: 'buy_property', propertyIndex: 4, housesToBuy: 0 });
  expectGroup(game, true);
});

test('economy: bankruptcy and departure clear eliminated holdings; surviving inactive hotel can be restored', () => {
  for (const exit of ['leave_game', 'declare_bankruptcy'] as const) {
    const game = setup(); own(game, [2], 'A'); own(game, [1,4], 'B'); game.state.properties[1].houses = 5;
    expectGroup(game, false, 'B');
    if (exit === 'declare_bankruptcy') {
      own(game, [10], 'C'); game.getPlayer('A')!.money = 0;
      land(game, 10); tick(game); phase(game, 'debt');
    }
    command(game, 'A', { type: exit });
    assert.equal(game.state.properties[2].ownerId, null);
    assert.equal(game.getPlayer('A')!.status, exit === 'leave_game' ? 'forfeited' : 'bankrupt');
    expectGroup(game, false, 'B');
    assert.equal(game.getCurrentPlayer()!.id, 'B');
    land(game, 2); command(game, 'B', { type: 'buy_property', propertyIndex: 2, housesToBuy: 0 }); expectGroup(game, true, 'B');
  }
  const ownerExit = setup(); own(ownerExit, GROUP, 'B'); ownerExit.state.properties[1].houses = 5;
  command(ownerExit, 'B', { type: 'leave_game' });
  for (const index of GROUP) {
    assert.equal(ownerExit.state.properties[index].ownerId, null);
    assert.equal(ownerExit.state.properties[index].houses, 0);
    assert.equal(hotelActive(ownerExit.state.properties, index, 3), false);
    assert.equal(propertyRent(ownerExit.state.properties, index, 3), 0);
  }
});

test('economy: charged hotel rent/debt keeps its original amount and creditor when hotel/set is traded', () => {
  for (const version of VERSIONS) for (const outgoing of [[2], [1], [1,2,4]]) {
    let game = setup(version);
    own(game, GROUP, 'B'); game.state.properties[1].houses = 5;
    command(game, 'B', { type: 'propose_trade', targetId: 'C', offer: assets(outgoing), request: assets() });
    const tradeId = game.state.activeTradeId!;
    game.getPlayer('A')!.position = 54;
    command(game, 'A', { type: 'roll_dice' }); tick(game);
    // Set a controlled cash fixture after the movement's Start income, before rent.
    game.getPlayer('A')!.money = 100; tick(game);
    const presentation = structuredClone(phase(game, 'rent'));
    assert.equal(presentation.payment.amount, 350);
    assert.equal(presentation.debt!.remaining, 250);
    assert.equal(presentation.debt!.creditorId, 'B');
    rejects(game, 'C', { type: 'accept_trade', tradeId }, 'WRONG_PHASE');
    game = roundTrip(game); tick(game);
    const debt = structuredClone(phase(game, 'debt').debt);
    const moneyBeforeTrade = game.state.players.map(player => player.money);
    command(game, 'C', { type: 'accept_trade', tradeId });
    assert.deepEqual(phase(game, 'debt').debt, debt, 'Existing obligations are not recalculated after ownership changes');
    assert.deepEqual(game.state.players.map(player => player.money), moneyBeforeTrade);
    const expectedFutureRent = version === 3 && outgoing.length !== 3 ? 160 : 350;
    assert.equal(propertyRent(game.state.properties, 1, version), expectedFutureRent);
    game = roundTrip(game);
    const originalCreditorCash = game.getPlayer('B')!.money;
    trade(game, 'C', 'A', assets([], 300));
    phase(game, 'awaiting_end');
    assert.equal(game.getPlayer('A')!.money, 50);
    assert.equal(game.getPlayer('B')!.money, originalCreditorCash + 250);
    assert.equal(game.state.rulesVersion, version);
    assert.equal(game.state.events.filter(event => event.type === 'payment' && event.reason === 'rent for Salvador').length, 1);
  }
});

test('economy: restored inactive hotels preserve level five and reactivate without a rebuild or charge', () => {
  for (const version of VERSIONS) {
    let game = setup(version); own(game, [1,4], 'A'); own(game, [2], 'B'); game.state.properties[1].houses = 5;
    game = roundTrip(game);
    assert.equal(game.state.properties[1].houses, 5);
    assert.equal(hotelActive(game.state.properties, 1, version), version !== 3);
    assert.equal(propertyRent(game.state.properties, 1, version), version === 3 ? 160 : 350);
    const cash = game.state.players.map(player => player.money);
    trade(game, 'B', 'A', assets([2]));
    assert.equal(hotelActive(game.state.properties, 1, version), true);
    assert.equal(propertyRent(game.state.properties, 1, version), 350);
    assert.deepEqual(game.state.players.map(player => player.money), cash);
  }
});

test('economy: strict flights and no-Start-flight-reward remain unchanged in every rules version', () => {
  for (const version of VERSIONS) for (let index = 0; index < AIRPORTS.length; index++) {
    const airport = AIRPORTS[index], next = AIRPORTS[(index + 1) % AIRPORTS.length];
    const game = setup(version); own(game, [airport, ...MINES], 'A');
    land(game, airport);
    assert.deepEqual(phase(game, 'flight').destinations, flightDestinations(airport));
    assert.equal(phase(game, 'flight').destinations.includes(next), false);
    rejects(game, 'A', { type: 'flight_decision', destinationIndex: next }, 'INVALID_DESTINATION');
    const before = game.getPlayer('A')!.money;
    const destination = airport === 45 ? 0 : flightDestinations(airport)[0];
    command(game, 'A', { type: 'flight_decision', destinationIndex: destination }); tick(game);
    assert.equal(game.getPlayer('A')!.money, before);
    assert.equal(game.getPlayer('A')!.flightChances, 0);
  }
});

test('economy: malformed saved rules versions fail closed without rewriting the snapshot', () => {
  const original = setup().state;
  for (const invalid of [null, 0, 1, 4, -1, 2.5, '2', '3', false, {}, [], NaN, Infinity]) {
    const snapshot = structuredClone(original) as unknown as Record<string, unknown>;
    snapshot.rulesVersion = invalid;
    const before = structuredClone(snapshot);
    assert.throws(() => assertGameState(snapshot), { code: 'INVALID_SNAPSHOT' });
    assert.deepEqual(snapshot, before);
  }
  const missing = structuredClone(original) as GameState;
  delete missing.rulesVersion;
  assert.doesNotThrow(() => assertGameState(missing));
  assert.equal(rulesForGame(missing).version, 2);
});

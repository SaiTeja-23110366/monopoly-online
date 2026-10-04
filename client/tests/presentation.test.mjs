import test from 'node:test';
import assert from 'node:assert/strict';
import { PresentationDirector } from '../src/lib/presentation.ts';
function state(sequence=0,events=[],position=0,gameId='game1'){return {gameId,roomCode:'ABC123',players:[{id:'p1',position}],diceValues:[3,2],lastEventSequence:sequence,events};}
const dice={sequence:1,id:'game1:1',at:1,turnId:1,type:'dice',playerId:'p1',values:[3,2]};
const move={sequence:2,id:'game1:2',at:2,turnId:1,type:'movement',playerId:'p1',from:0,to:5,path:[1,2,3,4,5],direction:'forward',reason:'dice',durationMs:880};
test('dice complete before every individual path step and decisions unlock only at the end',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const director=new PresentationDirector();director.receive(state(),true);director.receive(state(2,[dice,move],5));
  assert.equal(director.getSnapshot().rolling,true);assert.equal(director.getSnapshot().positions.p1,0);
  t.mock.timers.tick(720);assert.equal(director.getSnapshot().rolling,false);assert.equal(director.getSnapshot().positions.p1,0);
  t.mock.timers.tick(35);assert.equal(director.getSnapshot().positions.p1,1);
  for(let position=2;position<=5;position++){t.mock.timers.tick(176);assert.equal(director.getSnapshot().positions.p1,position);}
  assert.equal(director.getSnapshot().busy,true);t.mock.timers.tick(176);assert.equal(director.getSnapshot().busy,false);
});
test('duplicate snapshots do not replay dice or restart motion',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const director=new PresentationDirector();director.receive(state(),true);director.receive(state(1,[dice]));t.mock.timers.tick(500);director.receive(state(1,[dice]));t.mock.timers.tick(220);assert.equal(director.getSnapshot().busy,false);
});
test('backward and direct flight use the explicit event route',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const director=new PresentationDirector();director.receive(state(0,[],10),true);
  director.receive(state(1,[{...move,sequence:1,from:10,to:7,path:[9,8,7],direction:'backward',reason:'card_backward',durationMs:420}],7));
  t.mock.timers.tick(35);assert.equal(director.getSnapshot().positions.p1,9);t.mock.timers.tick(140);assert.equal(director.getSnapshot().positions.p1,8);t.mock.timers.tick(140);assert.equal(director.getSnapshot().positions.p1,7);t.mock.timers.tick(140);
  director.receive(state(2,[{...move,from:7,to:21,path:[21],direction:'direct',reason:'flight',durationMs:650}],21));t.mock.timers.tick(35);assert.equal(director.getSnapshot().positions.p1,21);assert.equal(director.getSnapshot().movementKind,'flight');
});
test('resume, missing event history, hidden-tab updates and game epochs snap safely without replay',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const director=new PresentationDirector();director.receive(state(),true);director.receive(state(2,[dice,move],5));director.receive(state(10,[],20,'new-epoch'),true);t.mock.timers.tick(10000);assert.equal(director.getSnapshot().positions.p1,20);assert.equal(director.getSnapshot().busy,false);
  director.receive(state(15,[{...dice,sequence:15}],30,'new-epoch'));assert.equal(director.getSnapshot().positions.p1,30);assert.equal(director.getSnapshot().busy,false);
  director.receive(state(16,[{...dice,sequence:16}],40,'new-epoch'),false,true);assert.equal(director.getSnapshot().positions.p1,40);assert.equal(director.getSnapshot().busy,false);
});
test('reduced motion catches up and cancels pending callback effects',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const director=new PresentationDirector();director.receive(state(),true);director.receive(state(2,[dice,move],5));director.setReduced(true);assert.equal(director.getSnapshot().positions.p1,5);t.mock.timers.tick(10000);assert.equal(director.getSnapshot().busy,false);assert.equal(director.getSnapshot().positions.p1,5);
});
test('Start rewards and property ownership wait for movement presentation to settle',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const director=new PresentationDirector();
  director.receive({...state(),players:[{id:'p1',position:0,money:1000}],properties:{1:{id:1,ownerId:null,houses:0}},vacationJackpot:50},true);
  director.receive({...state(2,[dice,move],5),players:[{id:'p1',position:5,money:1750}],properties:{1:{id:1,ownerId:'p1',houses:1}},vacationJackpot:100});
  assert.equal(director.getSnapshot().balances.p1,1000);assert.equal(director.getSnapshot().properties[1].ownerId,null);assert.equal(director.getSnapshot().vacationJackpot,50);
  t.mock.timers.tick(720);t.mock.timers.tick(35);for(let i=0;i<5;i++)t.mock.timers.tick(176);
  assert.equal(director.getSnapshot().balances.p1,1750);assert.equal(director.getSnapshot().properties[1].ownerId,'p1');assert.deepEqual(director.getSnapshot().highlightedProperties,[1]);
});

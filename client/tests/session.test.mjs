import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/lib/session.ts';
const KEY='monopoly_session_v2';
const credentials={roomCode:'ABC123',playerId:'p1',resumeSecret:'private-proof'};
function storage(){ const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),clear:()=>data.clear()}; }
function state(version=1){return {schemaVersion:2,gameId:'epoch1',version,roomCode:'ABC123',turnId:1,players:[{id:'p1',position:0}],events:[],lastEventSequence:0,diceValues:[1,1]};}
function ok(snapshot=state()){return {ok:true,session:credentials,state:snapshot,serverTime:Date.now()};}
class FakeSocket {
  handlers=new Map(); calls=[]; connected=false;
  on(event,fn){if(!this.handlers.has(event))this.handlers.set(event,new Set());this.handlers.get(event).add(fn);return this;}
  off(event,fn){this.handlers.get(event)?.delete(fn);return this;}
  signal(event,value){this.handlers.get(event)?.forEach(fn=>fn(value));}
  connect(){this.connected=true;this.signal('connect');return this;}
  disconnect(){this.connected=false;this.signal('disconnect','transport close');return this;}
  timeout(){return this;}
  emit(event,payload,callback){this.calls.push({event,payload,callback});return this;}
  last(event){return this.calls.findLast(call=>call.event===event);}
}
function setup(saved=false){
  globalThis.localStorage=storage();globalThis.sessionStorage=storage();
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  if(saved)localStorage.setItem(KEY,JSON.stringify(credentials));
  const socket=new FakeSocket();const session=new GameSession(socket);const cleanup=session.mount();return {socket,session,cleanup};
}
function join(){const env=setup();env.session.enter({name:'A',color:'#ef4444'});env.socket.last('create_room').callback(null,ok());return env;}
test('every reconnect authenticates before another gameplay command',()=>{
  const {socket,session}=setup(true);
  assert.equal(session.getSnapshot().connection,'resuming');
  session.command({type:'roll_dice'});assert.equal(socket.last('game_command'),undefined);
  socket.last('resume_session').callback(null,ok());
  socket.disconnect();socket.connect();
  assert.equal(socket.calls.filter(c=>c.event==='resume_session').length,2);
  assert.equal(session.getSnapshot().connection,'resuming');
});
test('lost command ack replays the original ID on the existing binding, not resume',()=>{
  const {socket,session}=join();session.command({type:'roll_dice'});
  const first=socket.last('game_command');first.callback(new Error('timeout'));
  session.command({type:'end_turn'});assert.equal(socket.calls.filter(c=>c.event==='game_command').length,1);
  session.retry();const second=socket.last('game_command');
  assert.deepEqual(second.payload,first.payload);assert.equal(socket.last('resume_session'),undefined);
  second.callback(null,{ok:true,commandId:first.payload.commandId,version:2});
  assert.equal(session.getSnapshot().pending,null);
});
test('retryable storage acknowledgements retain the original command',()=>{
  const {socket,session}=join();session.command({type:'buy_property',propertyIndex:1,housesToBuy:0});
  const first=socket.last('game_command');first.callback(null,{ok:false,commandId:first.payload.commandId,version:1,error:{code:'STORAGE_UNAVAILABLE',message:'Retry safely',retryable:true}});
  assert.equal(session.getSnapshot().retryable,true);session.retry();assert.equal(socket.last('game_command').payload.commandId,first.payload.commandId);
});
test('session_replaced followed by disconnect stays terminal and does not delete the active tab credential',()=>{
  const {socket,session}=join();socket.signal('session_replaced',{message:'Opened elsewhere'});socket.disconnect();
  assert.equal(session.getSnapshot().connection,'replaced');
  const count=socket.calls.length;session.retry();assert.equal(socket.calls.length,count);
  session.forgetSeat();assert.equal(localStorage.getItem(KEY),JSON.stringify(credentials));assert.equal(sessionStorage.getItem(KEY),'null');
  assert.equal(session.getSnapshot().credentials,null);
});
test('each tab preserves its own credential if another table becomes the browser default',()=>{
  const {session}=join();localStorage.setItem(KEY,JSON.stringify({...credentials,playerId:'other'}));
  const fresh=new GameSession(new FakeSocket());assert.equal(fresh.getSnapshot().credentials.playerId,'p1');
  assert.equal(session.getSnapshot().credentials.playerId,'p1');
});
test('uncertain admission replays the identical request and blocks accidental second admission',()=>{
  const {socket,session}=setup();session.enter({name:'A',color:'#ef4444'},'ABC123');
  const first=socket.last('join_room');first.callback(new Error('timeout'));
  session.enter({name:'Different',color:'#3b82f6'},'ZZZZZZ');assert.equal(socket.calls.length,1);
  session.retry();assert.deepEqual(socket.last('join_room').payload,first.payload);
  socket.last('join_room').callback(null,ok());assert.equal(session.getSnapshot().credentials.playerId,'p1');
});
test('room expiration clears stale authenticated state; storage outages keep it blocked for safe resume',()=>{
  let env=setup(true);env.socket.last('resume_session').callback(null,{ok:false,error:{code:'STORAGE_UNAVAILABLE',message:'Offline',retryable:true}});
  assert.equal(env.session.getSnapshot().connection,'reconnecting');assert.ok(env.session.getSnapshot().credentials);
  env=setup(true);env.socket.last('resume_session').callback(null,{ok:false,error:{code:'ROOM_EXPIRED',message:'Expired'}});
  assert.equal(env.session.getSnapshot().credentials,null);assert.equal(env.session.getSnapshot().game,null);
});
test('old revision and wrong-epoch broadcasts are ignored',()=>{
  const {socket,session}=join();socket.signal('game_state_update',state(3));socket.signal('game_state_update',state(2));
  assert.equal(session.getSnapshot().game.version,3);socket.signal('game_state_update',{...state(9),gameId:'another-game'});assert.equal(session.getSnapshot().game.version,3);
});
test('pending admission survives a transport reconnect and page reload without creating a new proof',()=>{
  const {socket,session}=setup();session.enter({name:'A',color:'#ef4444'});
  const first=socket.last('create_room');assert.match(first.payload.admissionSecret,/^[A-Za-z0-9_-]{43}$/);
  socket.disconnect();socket.connect();assert.equal(socket.last('create_room').payload.admissionSecret,first.payload.admissionSecret);
  const secondSocket=new FakeSocket();const reloaded=new GameSession(secondSocket);reloaded.mount();
  assert.equal(secondSocket.last('create_room').payload.admissionSecret,first.payload.admissionSecret);
  secondSocket.last('create_room').callback(null,ok());assert.equal(reloaded.getSnapshot().credentials.playerId,'p1');
  assert.equal(sessionStorage.getItem('monopoly_admission_v2'),'null');
});
test('late acknowledgements from a closed room cannot send its command into a new game',()=>{
  const {socket,session}=join();session.command({type:'roll_dice'});const old=socket.last('game_command');
  socket.signal('room_closed',{roomCode:'ABC123',reason:'Expired'});session.enter({name:'B',color:'#3b82f6'});
  socket.last('create_room').callback(null,{...ok(),session:{...credentials,roomCode:'NEW123'},state:{...state(),roomCode:'NEW123',gameId:'new'}});
  const calls=socket.calls.filter(c=>c.event==='game_command').length;
  old.callback(null,{ok:true,commandId:old.payload.commandId,version:8,state:state(8)});
  assert.equal(socket.calls.filter(c=>c.event==='game_command').length,calls);assert.equal(session.getSnapshot().game.gameId,'new');
});
test('a denied tab store still saves the seat in the browser-wide fallback',()=>{
  const {socket,session}=setup();globalThis.sessionStorage={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  session.enter({name:'A',color:'#ef4444'});socket.last('create_room').callback(null,ok());
  assert.equal(JSON.parse(localStorage.getItem(KEY)).playerId,'p1');
});
test('if credential storage fails after admission, the user sees a persistent warning',()=>{
  const {socket,session}=setup();session.enter({name:'A',color:'#ef4444'});
  localStorage.setItem=()=>{throw new Error('quota');};sessionStorage.setItem=()=>{throw new Error('quota');};
  socket.last('create_room').callback(null,ok());assert.match(session.getSnapshot().error,/could not save this seat/);assert.equal(session.getSnapshot().credentials.playerId,'p1');
});
test('admission is not sent unless its private recovery proof can first be saved',()=>{
  const {socket,session}=setup();localStorage.setItem=()=>{throw new Error('quota');};sessionStorage.setItem=()=>{throw new Error('quota');};
  session.enter({name:'A',color:'#ef4444'});assert.equal(socket.last('create_room'),undefined);assert.match(session.getSnapshot().error,/Allow site storage/);
});
test('connect errors are visible and retryable, and disconnect cleanup removes their listener',()=>{
  const {socket,session,cleanup}=setup();socket.connected=false;socket.signal('connect_error',new Error('Origin is not allowed'));
  assert.equal(session.getSnapshot().connection,'reconnecting');assert.equal(session.getSnapshot().retryable,true);assert.match(session.getSnapshot().error,/Origin is not allowed/);
  session.retry();assert.equal(socket.connected,true);cleanup();assert.equal(socket.handlers.get('connect_error').size,0);
});

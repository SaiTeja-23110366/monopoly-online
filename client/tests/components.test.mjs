import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
let vite, ActionPanel, PropertyInfoCard, TradeModal, ViewTradeModal, Lobby, board;
before(async()=>{
  // Middleware mode transforms actual TSX for SSR without opening a listening server or browser.
  vite=await createServer({server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
  ({ActionPanel}=await vite.ssrLoadModule('/src/components/ActionPanel.tsx'));
  ({PropertyInfoCard}=await vite.ssrLoadModule('/src/components/PropertyInfoCard.tsx'));
  ({TradeModal,ViewTradeModal}=await vite.ssrLoadModule('/src/components/TradeModal.tsx'));
  ({Lobby}=await vite.ssrLoadModule('/src/components/Lobby.tsx'));
  board=(await vite.ssrLoadModule('../shared/board.ts')).SQUARES;
  globalThis.location=new URL('https://game.example/?room=ABC123');globalThis.localStorage={getItem(){return null;}};
});
after(async()=>{await vite?.close();});
const player=(id,name)=>({id,name,color:id==='p1'?'#ef4444':'#3b82f6',money:2500,position:0,status:'active',inJail:false,jailTurns:0,getOutOfJailCards:0,flightChances:1,skipNextTurn:false});
function game(phase){return {schemaVersion:2,gameId:'epoch',roomCode:'ABC123',version:1,state:'playing',players:[player('p1','Alice'),player('p2','Bob')],hostId:'p1',turnIndex:0,phaseId:1,turnId:1,phase,winnerId:null,startingCash:2500,properties:{1:{id:1,ownerId:null,houses:0,mortgaged:false}},trades:{},events:[],lastEventSequence:0,diceValues:[1,1],logs:[],vacationJackpot:0};}
const noop=()=>{};
function actions(snapshot,extra={}){return renderToStaticMarkup(createElement(ActionPanel,{game:snapshot,playerId:'p1',blocked:false,animating:false,pending:null,command:noop,onInspect:noop,onTrade:noop,onBankrupt:noop,offset:0,...extra}));}
test('only the actor gets a legal roll and pending transport disables it',()=>{
  const snapshot=game({kind:'awaiting_roll',playerId:'p1'});
  assert.match(actions(snapshot),/Roll dice/);assert.doesNotMatch(actions(snapshot,{playerId:'p2'}),/>Roll dice</);
  assert.match(actions(snapshot,{pending:'roll_dice'}),/disabled=""[^>]*>.*?Rolling…/s);
});
test('landing cards and purchase controls remain hidden until presentation finishes',()=>{
  const card=game({kind:'card',playerId:'p1',card:{deck:'chance',action:'add_money',text:'A surprise payout',amount:200}});
  assert.match(actions(card),/A surprise payout/);assert.doesNotMatch(actions(card,{animating:true}),/A surprise payout|Resolve card/);
  const buy=game({kind:'buy',playerId:'p1',propertyIndex:1,mode:'buy',maxHouses:2});
  assert.match(actions(buy),/Buy.*?\$60/s);assert.doesNotMatch(actions(buy,{animating:true}),/Buy for|Pass on this deed/);
});
test('canonical purchase limits, jail release, and flight refresh are explained accurately',()=>{
  const buy=game({kind:'buy',playerId:'p1',propertyIndex:1,mode:'buy',maxHouses:2});
  const html=actions(buy);assert.match(html,/<option value="2">/);assert.doesNotMatch(html,/<option value="3">/);
  const jail=game({kind:'awaiting_roll',playerId:'p1'});jail.players[0].inJail=true;assert.match(actions(jail),/leave for free and can move next turn/);
  const flight=game({kind:'flight',playerId:'p1',airportId:6,destinations:[7,8],ticketPrice:0});assert.match(actions(flight),/Free · you own this airport/);assert.match(actions(flight),/refreshed when you pass or land on Start/);
});
test('tax deeds show percentage rules, never a fixed purchase price or owner',()=>{
  for(const index of [3,40]){
    const html=renderToStaticMarkup(createElement(PropertyInfoCard,{index,game:game({kind:'awaiting_roll',playerId:'p1'}),playerId:'p1',blocked:false,onClose:noop,command:noop}));
    assert.doesNotMatch(html,/Purchase price|Owner|\$200/);assert.match(html,index===3?/10% of your positive cash/:/5% of the purchase value/);
  }
});
test('bankrupt players see spectator guidance without turn actions',()=>{
  const snapshot=game({kind:'awaiting_roll',playerId:'p2'});snapshot.turnIndex=1;snapshot.players[0].status='bankrupt';
  assert.match(actions(snapshot),/spectating/);assert.doesNotMatch(actions(snapshot),/>Roll dice</);
});
test('stale trade offers cannot be accepted or countered',()=>{
  const snapshot=game({kind:'awaiting_roll',playerId:'p1'});
  const trade={id:'offer1',initiatorId:'p2',targetId:'p1',offer:{money:100,properties:[],getOutOfJailCards:0},request:{money:0,properties:[],getOutOfJailCards:0},status:'countered',revision:1};snapshot.trades[trade.id]=trade;
  const html=renderToStaticMarkup(createElement(ViewTradeModal,{trade,game:snapshot,playerId:'p1',blocked:false,onClose:noop,onCounter:noop,command:noop}));
  assert.match(html,/This offer is.*?countered/s);assert.doesNotMatch(html,/Accept trade|Counteroffer/);
  const editor=renderToStaticMarkup(createElement(TradeModal,{game:snapshot,playerId:'p1',original:trade,blocked:false,onClose:noop,command:noop}));
  assert.match(editor,/This offer has changed or closed/);assert.match(editor,/disabled=""[^>]*>Send counteroffer/);
});
test('lobby exposes cash settings only to the host and requires two seats',()=>{
  const snapshot=game({kind:'lobby'});snapshot.state='lobby';snapshot.players=snapshot.players.slice(0,1);
  const props={game:snapshot,playerId:'p1',ready:true,pending:null,enter:noop,command:noop};
  const host=renderToStaticMarkup(createElement(Lobby,props));assert.match(host,/Starting cash per player/);assert.match(host,/Invite at least one friend/);
  snapshot.players.push(player('p2','Bob'));const guest=renderToStaticMarkup(createElement(Lobby,{...props,playerId:'p2'}));
  assert.doesNotMatch(guest,/id="starting-cash"/);assert.match(guest,/Waiting for the host to start/);
});
test('all 56 canonical board spaces have public names and economics, taxes have no price',()=>{
  assert.equal(board.length,56);assert.equal(new Set(board.map(square=>square.id)).size,56);
  assert.ok(board.every(square=>square.fullName));assert.equal(board[3].price,undefined);assert.equal(board[40].price,undefined);
  assert.equal(board[10].price,150);assert.equal(board[55].price,650);
});

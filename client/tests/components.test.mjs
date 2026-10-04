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
function pendingTrade(snapshot){
  const trade={id:'offer1',initiatorId:'p2',targetId:'p1',offer:{money:100,properties:[],getOutOfJailCards:0},request:{money:50,properties:[],getOutOfJailCards:0},status:'pending',revision:0};
  snapshot.trades[trade.id]=trade;return trade;
}
function tradeProps(snapshot,trade,extra={}){return {trade,game:snapshot,playerId:'p1',blocked:false,onClose:noop,onCounter:noop,command:noop,...extra};}
function tradeHtml(snapshot,trade,extra={}){return renderToStaticMarkup(createElement(ViewTradeModal,tradeProps(snapshot,trade,extra)));}
function tradeEditor(snapshot,original,extra={}){return renderToStaticMarkup(createElement(TradeModal,{game:snapshot,playerId:'p1',original,blocked:false,onClose:noop,command:noop,...extra}));}
function findButton(node,label){
  if(Array.isArray(node))return node.map(child=>findButton(child,label)).find(Boolean);
  if(!node || !node.props)return undefined;
  if(node.type==='button' && node.props.children===label)return node;
  return findButton(node.props.children,label);
}
function tradeButton(snapshot,trade,label,extra={}){return findButton(ViewTradeModal(tradeProps(snapshot,trade,extra)),label);}
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
test('pending offers remain actionable several turns later, including on another player’s turn',()=>{
  const snapshot=game({kind:'awaiting_roll',playerId:'p1'}), trade=pendingTrade(snapshot);
  snapshot.players.push(player('p3','Carol'));
  const commands=[];let closed=0;
  for(const turnId of [2,5,12]){
    snapshot.turnId=turnId;snapshot.phaseId=turnId*3;snapshot.version=turnId*8;snapshot.turnIndex=2;snapshot.phase={kind:'awaiting_end',playerId:'p3'};
    const html=tradeHtml(snapshot,trade);
    assert.match(html,/Offers stay open across turns/);
    for(const label of ['Accept trade','Counteroffer','Decline'])assert.equal(tradeButton(snapshot,trade,label).props.disabled,false);
  }
  tradeButton(snapshot,trade,'Accept trade',{command:value=>commands.push(value),onClose:()=>closed++}).props.onClick();
  assert.deepEqual(commands,[{type:'accept_trade',tradeId:'offer1'}]);assert.equal(closed,1);
  assert.equal(trade.status,'pending');
});
test('unavailable money, cards, and deeds block acceptance but leave counter and decline available',()=>{
  for(const side of ['offer','request'])for(const asset of ['money','cards','property']){
    const snapshot=game({kind:'awaiting_roll',playerId:'p2'}), trade=pendingTrade(snapshot);
    const owner=snapshot.players.find(person=>person.id===(side==='offer'?trade.initiatorId:trade.targetId));
    if(asset==='money')owner.money=0;
    if(asset==='cards')trade[side].getOutOfJailCards=1;
    if(asset==='property')trade[side].properties=[1];
    const commands=[];let countered=0,closed=0;
    const callbacks={command:value=>commands.push(value),onCounter:()=>countered++,onClose:()=>closed++};
    assert.match(tradeHtml(snapshot,trade),/currently unavailable.*This offer stays open/s);
    const accept=tradeButton(snapshot,trade,'Accept trade',callbacks);
    assert.equal(accept.props.disabled,true,`${side} ${asset}`);accept.props.onClick();
    assert.deepEqual(commands,[]);assert.equal(closed,0);
    const counter=tradeButton(snapshot,trade,'Counteroffer',callbacks), decline=tradeButton(snapshot,trade,'Decline',callbacks);
    assert.equal(counter.props.disabled,false);counter.props.onClick();assert.equal(countered,1);
    assert.equal(decline.props.disabled,false);decline.props.onClick();
    assert.deepEqual(commands,[{type:'reject_trade',tradeId:trade.id}]);assert.equal(closed,1);
    // A later snapshot can make the same pending offer acceptable again.
    snapshot.turnId+=6;owner.money=2500;owner.getOutOfJailCards=1;snapshot.properties[1].ownerId=owner.id;
    assert.equal(tradeButton(snapshot,trade,'Accept trade').props.disabled,false);
  }
});
test('counteroffer editors keep unavailable selected deeds visible so they can be removed',()=>{
  for(const side of ['offer','request']){
    const snapshot=game({kind:'awaiting_roll',playerId:'p1'}), trade=pendingTrade(snapshot);
    trade[side].properties=[1];
    const html=tradeEditor(snapshot,trade);
    assert.match(html,/type="checkbox" checked=""/);assert.ok(html.includes(board[1].fullName));
    assert.match(html,/No longer owned · uncheck to remove/);assert.match(html,/disabled=""[^>]*>Send counteroffer/);
    snapshot.properties[1].ownerId=side==='offer'?trade.initiatorId:trade.targetId;
    const restored=tradeEditor(snapshot,trade);
    assert.doesNotMatch(restored,/No longer owned/);assert.doesNotMatch(restored,/disabled=""[^>]*>Send counteroffer/);
  }
});
test('only the proposer can withdraw and only the recipient can accept, counter, or decline',()=>{
  const snapshot=game({kind:'awaiting_roll',playerId:'p1'}), trade=pendingTrade(snapshot);
  const commands=[];let closed=0;
  const proposer={playerId:'p2',command:value=>commands.push(value),onClose:()=>closed++};
  const html=tradeHtml(snapshot,trade,proposer);
  assert.match(html,/Withdraw offer/);assert.doesNotMatch(html,/Accept trade|Counteroffer|>Decline</);
  tradeButton(snapshot,trade,'Withdraw offer',proposer).props.onClick();
  assert.deepEqual(commands,[{type:'reject_trade',tradeId:trade.id}]);assert.equal(closed,1);
  assert.doesNotMatch(tradeHtml(snapshot,trade),/Withdraw offer/);
  snapshot.players.push(player('p3','Carol'));
  for(const playerId of ['p3','unknown']){
    assert.doesNotMatch(tradeHtml(snapshot,trade,{playerId}),/Accept trade|Counteroffer|>Decline<|Withdraw offer/);
    assert.match(tradeEditor(snapshot,trade,{playerId}),/disabled=""[^>]*>Send counteroffer/);
  }
  assert.match(tradeEditor(snapshot,trade,{playerId:'p2'}),/disabled=""[^>]*>Send counteroffer/);
});
test('inactive participants and finished matches expose no trade response actions',()=>{
  for(const status of ['bankrupt','forfeited'])for(const index of [0,1]){
    const snapshot=game({kind:'awaiting_roll',playerId:'p1'}), trade=pendingTrade(snapshot);snapshot.players[index].status=status;
    for(const playerId of ['p1','p2'])assert.doesNotMatch(tradeHtml(snapshot,trade,{playerId}),/Accept trade|Counteroffer|>Decline<|Withdraw offer/);
    assert.match(tradeEditor(snapshot,trade),/disabled=""[^>]*>Send counteroffer/);
    if(index===0)assert.match(tradeEditor(snapshot,undefined),/disabled=""[^>]*>Send offer/);
  }
  for(const state of ['lobby','ended']){
    const snapshot=game({kind:state}),trade=pendingTrade(snapshot);snapshot.state=state;
    assert.doesNotMatch(tradeHtml(snapshot,trade),/Accept trade|Counteroffer|>Decline<|Withdraw offer/);
    assert.match(tradeEditor(snapshot,trade),/disabled=""[^>]*>Send counteroffer/);
  }
});
test('paused trade phases defer acceptance and counters while allowing decline or withdrawal',()=>{
  for(const kind of ['rolling','moving','card','rent','risk_target']){
    const snapshot=game({kind,playerId:'p2'}), trade=pendingTrade(snapshot);
    const commands=[];let countered=0,closed=0;
    const callbacks={command:value=>commands.push(value),onCounter:()=>countered++,onClose:()=>closed++};
    assert.match(tradeHtml(snapshot,trade),/This offer stays open.*before accepting or countering/s);
    for(const label of ['Accept trade','Counteroffer']){
      const button=tradeButton(snapshot,trade,label,callbacks);assert.equal(button.props.disabled,true);button.props.onClick();
    }
    assert.deepEqual(commands,[]);assert.equal(countered,0);assert.equal(closed,0);
    for(const [playerId,label] of [['p1','Decline'],['p2','Withdraw offer']]){
      const button=tradeButton(snapshot,trade,label,{...callbacks,playerId});assert.equal(button.props.disabled,false);button.props.onClick();
    }
    assert.equal(commands.length,2);assert.equal(closed,2);
    assert.match(tradeEditor(snapshot,trade),/disabled=""[^>]*>Send counteroffer/);
  }
});
test('blocked transport prevents all trade responses and counters',()=>{
  const snapshot=game({kind:'awaiting_roll',playerId:'p1'}),trade=pendingTrade(snapshot);
  const commands=[];let countered=0,closed=0;
  const callbacks={blocked:true,command:value=>commands.push(value),onCounter:()=>countered++,onClose:()=>closed++};
  for(const [playerId,label] of [['p1','Accept trade'],['p1','Counteroffer'],['p1','Decline'],['p2','Withdraw offer']]){
    const button=tradeButton(snapshot,trade,label,{...callbacks,playerId});assert.equal(button.props.disabled,true);button.props.onClick();
  }
  assert.deepEqual(commands,[]);assert.equal(countered,0);assert.equal(closed,0);
  assert.match(tradeEditor(snapshot,trade,{blocked:true}),/disabled=""[^>]*>Send counteroffer/);
});
test('every terminal offer status removes response controls and disables the old counteroffer editor',()=>{
  for(const status of ['accepted','rejected','countered','cancelled']){
    const snapshot=game({kind:'awaiting_roll',playerId:'p1'}),trade=pendingTrade(snapshot);trade.status=status;
    for(const playerId of ['p1','p2']){
      const html=tradeHtml(snapshot,trade,{playerId});assert.ok(html.includes(`This offer is ${status}`));
      assert.doesNotMatch(html,/Accept trade|Counteroffer|>Decline<|Withdraw offer/);
    }
    assert.match(tradeEditor(snapshot,trade),/This offer has changed or closed/);
    assert.match(tradeEditor(snapshot,trade),/disabled=""[^>]*>Send counteroffer/);
  }
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

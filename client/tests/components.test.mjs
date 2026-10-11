import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
let vite, GameRules, ActionPanel, PropertyInfoCard, TradeModal, ViewTradeModal, Lobby, board, flightDestinations;
before(async()=>{
  // Middleware mode transforms actual TSX for SSR without opening a listening server or browser.
  vite=await createServer({server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
  ({ActionPanel}=await vite.ssrLoadModule('/src/components/ActionPanel.tsx'));
  ({PropertyInfoCard}=await vite.ssrLoadModule('/src/components/PropertyInfoCard.tsx'));
  ({TradeModal,ViewTradeModal}=await vite.ssrLoadModule('/src/components/TradeModal.tsx'));
  ({Lobby}=await vite.ssrLoadModule('/src/components/Lobby.tsx'));
  ({GameRules}=await vite.ssrLoadModule('/src/App.tsx'));
  ({SQUARES:board,flightDestinations}=await vite.ssrLoadModule('../shared/board.ts'));
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
test('flight panels and airport deeds explain and exclude every next-airport boundary',()=>{
  const airports=[6,21,34,45];
  for(const airportId of airports){
    const snapshot=game({kind:'flight',playerId:'p1',airportId,destinations:flightDestinations(airportId),ticketPrice:0});
    snapshot.properties[airportId]={id:airportId,ownerId:'p1',houses:0,mortgaged:false,protected:false};
    const html=actions(snapshot);
    assert.match(html,/before the next airport/);assert.match(html,/Airports themselves are not destinations/);
    for(const airport of airports)assert.doesNotMatch(html,new RegExp(`<option[^>]*value="${airport}"`));
    const next=airports[(airports.indexOf(airportId)+1)%airports.length],last=(next+55)%56;
    assert.match(html,new RegExp(`<option[^>]*value="${last}"`));
    const deed=renderToStaticMarkup(createElement(PropertyInfoCard,{index:airportId,game:snapshot,playerId:'p1',blocked:false,onClose:noop,command:noop}));
    assert.match(deed,/before the next airport/);assert.match(deed,/Airports themselves are not destinations/);
  }
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

function deedHtml(snapshot,index=1){return renderToStaticMarkup(createElement(PropertyInfoCard,{index,game:snapshot,playerId:'p1',blocked:false,onClose:noop,command:noop}));}
function balancedGame(){return {...game({kind:'awaiting_roll',playerId:'p1'}),rulesVersion:3,properties:Object.fromEntries(board.filter(square=>square.price).map(square=>[square.id,{id:square.id,ownerId:null,houses:0,mortgaged:false}]))};}
function currentRent(html){return html.match(/<span>Current rent<\/span><strong>([^<]+)<\/strong>/)?.[1];}
const money=value=>`$${value.toLocaleString('en-US')}`;
test('every city deed updates the live undeveloped rent quote as its color set completes, breaks, and restores',()=>{
  for(const city of board.filter(square=>square.type==='property')){
    const snapshot=balancedGame(),group=board.filter(square=>square.colorGroup===city.colorGroup);
    snapshot.properties[city.id].ownerId='p1';
    let html=deedHtml(snapshot,city.id);assert.equal(currentRent(html),money(city.rent[0]),city.fullName);
    assert.doesNotMatch(html,/base rent is active/);
    for(const square of group)snapshot.properties[square.id].ownerId='p1';
    html=deedHtml(snapshot,city.id);assert.equal(currentRent(html),money(city.rent[0]*2));
    assert.match(html,/role="status" aria-live="polite" aria-atomic="true"/);assert.match(html,/Complete color set · 2× base rent is active/);
    const other=group.find(square=>square.id!==city.id);
    snapshot.properties[other.id].ownerId='p2';
    html=deedHtml(snapshot,city.id);assert.equal(currentRent(html),money(city.rent[0]));assert.doesNotMatch(html,/base rent is active/);
    snapshot.properties[other.id].ownerId='p1';
    assert.equal(currentRent(deedHtml(snapshot,city.id)),money(city.rent[0]*2));
  }
});
test('city rent schedules and house levels stay unchanged and explain complete-set conditions',()=>{
  const snapshot=balancedGame();
  for(const index of [1,2,4])snapshot.properties[index].ownerId='p1';
  for(let level=1;level<=4;level++){
    snapshot.properties[1].houses=level;
    let html=deedHtml(snapshot);assert.equal(currentRent(html),money(board[1].rent[level]));assert.doesNotMatch(html,/base rent is active/);
    snapshot.properties[2].ownerId='p2';
    html=deedHtml(snapshot);assert.equal(currentRent(html),money(board[1].rent[level]));
    snapshot.properties[2].ownerId='p1';
  }
  const html=deedHtml(snapshot);
  for(const rent of board[1].rent)assert.ok(html.includes(`<strong>${money(rent)}</strong>`));
  assert.match(html,/Base rent · without complete set/);assert.match(html,/Hotel · complete set required/);
  assert.match(html,/<span>Undeveloped · complete color set<\/span><strong>\$12<\/strong>/);
  assert.match(html,/Build only when you land here, up to two houses at purchase/);assert.match(html,/Houses do not require a complete color set/);
});
test('a broken-set hotel stays built and visibly quotes four-house rent until the complete set returns',()=>{
  const snapshot=balancedGame();
  for(const index of [1,2,4])snapshot.properties[index].ownerId='p1';
  snapshot.properties[1].houses=5;
  let html=deedHtml(snapshot);assert.equal(currentRent(html),money(board[1].rent[5]));assert.match(html,/Hotel active · complete color set owned/);
  for(const lostOwner of ['p2',null]){
    snapshot.properties[2].ownerId=lostOwner;
    html=deedHtml(snapshot);assert.equal(currentRent(html),money(board[1].rent[4]));
    assert.match(html,/Hotel inactive · the hotel stays built, but charges the four-house rent/);assert.match(html,/Hotel built/);assert.equal(snapshot.properties[1].houses,5);
    snapshot.properties[2].ownerId='p1';
    html=deedHtml(snapshot);assert.equal(currentRent(html),money(board[1].rent[5]));assert.match(html,/Hotel active/);assert.doesNotMatch(html,/Hotel inactive/);
  }
  snapshot.properties[1].ownerId='p2';
  html=deedHtml(snapshot);assert.equal(currentRent(html),money(board[1].rent[4]));assert.match(html,/Hotel inactive/);assert.match(html,/>Bob<\/strong>/);
});
test('unowned and mortgaged deeds cannot imply collectible rent or an active hotel',()=>{
  const snapshot=balancedGame();assert.equal(currentRent(deedHtml(snapshot)),'None · bank-owned');
  for(const index of [1,2,4])snapshot.properties[index].ownerId='p1';
  snapshot.properties[1].mortgaged=true;
  let html=deedHtml(snapshot);assert.equal(currentRent(html),'$0');assert.match(html,/No rent while mortgaged/);assert.doesNotMatch(html,/base rent is active/);
  snapshot.properties[1].houses=5;
  html=deedHtml(snapshot);assert.equal(currentRent(html),'$0');assert.match(html,/Hotel inactive · no rent while mortgaged/);assert.doesNotMatch(html,/Hotel active ·|Hotel inactive · the hotel stays built/);
});
test('mine and airport current rents follow current ownership without complete-set city bonuses',()=>{
  for(const group of [[6,21,34,45],[10,27,37,50]]){
    const snapshot=balancedGame();
    for(let count=1;count<=4;count++){
      snapshot.properties[group[count-1]].ownerId='p1';
      const html=deedHtml(snapshot,group[0]);assert.equal(currentRent(html),money(board[group[0]].rent[count-1]));
      assert.doesNotMatch(html,/base rent is active|Undeveloped · complete color set/);
    }
    snapshot.properties[group[1]].ownerId='p2';assert.equal(currentRent(deedHtml(snapshot,group[0])),money(board[group[0]].rent[2]));
  }
});
test('legacy snapshots with missing or explicit v2 rules preserve base and broken-set hotel rent',()=>{
  for(const version of [undefined,2]){
    const snapshot=balancedGame();
    if(version===undefined)delete snapshot.rulesVersion;else snapshot.rulesVersion=version;
    for(const index of [1,2,4])snapshot.properties[index].ownerId='p1';
    let html=deedHtml(snapshot);assert.equal(currentRent(html),money(board[1].rent[0]));assert.doesNotMatch(html,/Undeveloped · complete color set|base rent is active/);
    assert.match(html,/legacy table has no complete-set base-rent bonus/);
    snapshot.properties[1].houses=5;snapshot.properties[2].ownerId='p2';
    html=deedHtml(snapshot);assert.equal(currentRent(html),money(board[1].rent[5]));assert.match(html,/Hotel active · legacy economy keeps hotel rent/);assert.doesNotMatch(html,/Hotel inactive/);
  }
});
test('Start and mine deeds display versioned income and total mine bonuses',()=>{
  for(const [version,passing,landing,bonus] of [[3,'$200','$300','$25 / $60 / $100 / $150'],[2,'$750','$1,000','$200 / $500 / $1,000 / $2,000'],[undefined,'$750','$1,000','$200 / $500 / $1,000 / $2,000']]){
    const snapshot=balancedGame();snapshot.rulesVersion=version;
    const start=deedHtml(snapshot,0),mine=deedHtml(snapshot,10);
    assert.ok(start.includes(`Collect ${passing} when passing Start, or ${landing} when landing exactly`));
    assert.ok(mine.includes(`Mine ownership adds a total Start bonus: ${bonus} for 1–4 mines`));
  }
});
test('lobby identifies balanced new tables and preserves the legacy saved-table economy',()=>{
  const props={game:null,playerId:'p1',ready:true,pending:null,enter:noop,command:noop};
  let html=renderToStaticMarkup(createElement(Lobby,props));
  assert.match(html,/New tables use the balanced economy: \$200 passing Start, \$300 landing exactly/);
  assert.match(html,/Mine bonuses: \$25 \/ \$60 \/ \$100 \/ \$150 total/);
  for(const version of [3,2,undefined]){
    const snapshot=balancedGame();snapshot.state='lobby';snapshot.phase={kind:'lobby'};snapshot.rulesVersion=version;
    html=renderToStaticMarkup(createElement(Lobby,{...props,game:snapshot}));
    if(version===3){assert.match(html,/Balanced economy/);assert.match(html,/Start: \$200 passing \/ \$300 landing/);}
    else {assert.match(html,/Legacy economy · This saved table keeps its original rules/);assert.match(html,/Start: \$750 passing \/ \$1,000 landing/);}
  }
});
test('rules dialog shows the current economy, with new-room defaults and explicit legacy differences',()=>{
  for(const version of [3,2,undefined,null]){
    const snapshot=version===null?null:{...balancedGame(),rulesVersion:version};
    const html=renderToStaticMarkup(createElement(GameRules,{game:snapshot}));
    assert.match(html,/built only when you land there/);assert.match(html,/Houses don’t require a full color set/);assert.match(html,/before the next airport/);
    if(version===3 || version===null){
      assert.match(html,/Balanced economy/);assert.match(html,/Collect \$200 passing Start or \$300 landing exactly/);
      assert.match(html,/Total bonuses for owning 1–4 mines: \$25 \/ \$60 \/ \$100 \/ \$150/);
      assert.match(html,/undeveloped city earns double base rent/);assert.match(html,/hotel stays built and charges the four-house rent until the set is restored/);
    }else{
      assert.match(html,/Legacy economy/);assert.match(html,/Collect \$750 passing Start or \$1,000 landing exactly/);
      assert.match(html,/Total bonuses for owning 1–4 mines: \$200 \/ \$500 \/ \$1,000 \/ \$2,000/);
      assert.match(html,/no complete-set base-rent bonus/);assert.match(html,/hotel keeps charging hotel rent even if the set is later broken/);
      assert.doesNotMatch(html,/undeveloped city earns double base rent/);
    }
  }
});

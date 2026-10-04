'use strict';
const fs=require('node:fs');
const {MonopolyGame,SYSTEM_ACTOR}=require((process.env.MONOPOLY_ENGINE_DIR||'../server/dist')+'/server/src/gameState');
const {BOARD_DATA:B,RULES:R,PLAYER_COLORS,propertyValue,liquidationValue}=require((process.env.MONOPOLY_ENGINE_DIR||'../server/dist')+'/shared/board');
const GROUPS=Object.values(B.filter(x=>x.type==='property').reduce((o,x)=>((o[x.colorGroup]??=[]).push(x.id),o),{}));
const SCENARIOS={
 conservative:{reserve:750,initial:1,step:2,trade:false},
 development:{reserve:300,initial:2,step:5,trade:false},
 reciprocal_trade:{reserve:300,initial:2,step:5,trade:true},
 mixed:{reserve:300,initial:2,step:5,trade:false,mixed:true},
};
// Mulberry32: one stream drives actual engine dice, cards and risk selection.
function rng(seed){let a=seed>>>0;return ()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
const owned=(s,id)=>Object.values(s.properties).filter(x=>x.ownerId===id);
const mines=(s,id)=>owned(s,id).filter(x=>B[x.id].type==='utility').length;
const setCount=(s,id)=>GROUPS.filter(g=>g.every(i=>s.properties[i].ownerId===id)).length;
const cashPot=s=>s.players.reduce((t,p)=>t+Math.max(0,p.money),s.vacationJackpot);
const sum=(a)=>a.reduce((t,x)=>t+x,0);
const mean=a=>a.length?sum(a)/a.length:null;
const quantile=(a,q)=>a.length?[...a].sort((a,b)=>a-b)[Math.max(0,Math.ceil(q*a.length)-1)]:null;
function wilson(k,n){const z=1.959963984540054,d=1+z*z/n,c=(k/n+z*z/(2*n))/d,h=z*Math.sqrt(k/n*(1-k/n)/n+z*z/(4*n*n))/d;return [c-h,c+h];}
function assetScore(s,prop){const sq=B[prop.id],owner=prop.ownerId;if(sq.type==='utility'){const n=mines(s,owner);return 150+4*(R.mineBonuses[n]-R.mineBonuses[n-1]);}if(sq.type==='railroad')return 200+6*sq.rent[owned(s,owner).filter(x=>B[x.id].type==='railroad').length-1];const g=GROUPS.find(g=>g.includes(prop.id)),complete=g.every(i=>s.properties[i].ownerId===owner);return propertyValue(prop.id,prop.houses)+5*sq.rent[prop.houses]+(complete?500:0);}
function simulate({scenario='development',n=4,seed=1,horizon=200,trace=false}){
 const base=SCENARIOS[scenario];if(!base)throw Error('Unknown scenario');
 const game=new MonopolyGame('SIM',{gameId:`${scenario}-${n}-${seed}`,random:rng(seed),now:()=>0});
 const policy=id=>base.mixed?(Number(id.slice(1))%2?SCENARIOS.conservative:SCENARIOS.development):base;
 for(let i=0;i<n;i++)if(!game.addPlayer('p'+i,'socket'+i,'Player '+i,PLAYER_COLORS[i]))throw Error('addPlayer');
 const stats={scenario,n,seed,horizon,commands:0,rejectedCommands:0,trades:0,flights:0,paidFlights:0,purchases:0,buildingsBought:0,sales:0,firstBankruptcyTurn:null,firstBankruptcyNormalized:null,firstSetTurn:null,firstHotelTurn:null,startPayout:0,minePayout:0,cardGrants:0,marketCrashSink:0,purchaseSink:0,liquidationSource:0,otherCashDelta:0,peakObservedCashPot:1500*n,peakMines:0,snapshots:[],players:Object.fromEntries(Array.from({length:n},(_,i)=>['p'+i,{strategy:policy('p'+i)===SCENARIOS.conservative?'conservative':'development',turns:0,maxMines:0,maxSets:0,maxHotels:0,mineStartPayout:0,startVisits:0,firstMineTurn:null,firstSetTurn:null,buySpend:0,sellProceeds:0,rentCharged:0,rentReceived:0,bankruptcyTurn:null}]))};

 // Pure observations: no policy, state, RNG, command ordering, or logical clock changes.
 stats.economyObservations={rulesVersion:game.state.rulesVersion??R.version,
  cityRentCharges:0,cityRentCharged:0,bareFullSetRentCharges:0,bareFullSetRentCharged:0,
  bareSetPremiumCharged:0,hotelRentCharges:0,hotelRentCharged:0,brokenGroupHotelRentCharges:0,
  brokenGroupHotelRentCharged:0,dormantHotelRentReduction:0,firstBrokenGroupHotelTurn:null,
  maxBrokenGroupHotels:0,brokenGroupHotelEpisodes:0,hotelFullSetRestorations:0};
 const groupComplete=(s,prop)=>prop.ownerId!==null&&GROUPS.find(g=>g.includes(prop.id)).every(i=>s.properties[i].ownerId===prop.ownerId);
 const brokenHotel=(s,prop)=>B[prop.id].type==='property'&&prop.ownerId!==null&&prop.houses===5&&!groupComplete(s,prop);
 function observeEconomy(before,after,result){
  const o=stats.economyObservations,broken=Object.values(after.properties).filter(prop=>brokenHotel(after,prop));
  if(broken.length)o.firstBrokenGroupHotelTurn??=after.turnId;
  o.maxBrokenGroupHotels=Math.max(o.maxBrokenGroupHotels,broken.length);
  for(const prop of Object.values(after.properties)){
   const old=before.properties[prop.id];
   if(brokenHotel(after,prop)&&(!old||!brokenHotel(before,old)||old.ownerId!==prop.ownerId))o.brokenGroupHotelEpisodes++;
   if(old&&brokenHotel(before,old)&&prop.houses===5&&prop.ownerId!==null&&groupComplete(after,prop))o.hotelFullSetRestorations++;
  }
  for(const event of result.events){
   if(event.type!=='payment'||!event.reason.startsWith('rent for '))continue;
   const player=after.players.find(p=>p.id===event.playerId),prop=after.properties[player.position],sq=B[player.position];
   if(sq.type!=='property')continue;
   if(!prop||prop.ownerId!==event.payeeId)throw Error('Rent observation ownership mismatch');
   o.cityRentCharges++;o.cityRentCharged+=event.amount;
   if(prop.houses===0&&groupComplete(after,prop)){
    o.bareFullSetRentCharges++;o.bareFullSetRentCharged+=event.amount;
    o.bareSetPremiumCharged+=event.amount-sq.rent[0];
   }
   if(prop.houses===5){
    o.hotelRentCharges++;o.hotelRentCharged+=event.amount;
    if(brokenHotel(after,prop)){
     o.brokenGroupHotelRentCharges++;o.brokenGroupHotelRentCharged+=event.amount;
     o.dormantHotelRentReduction+=sq.rent[5]-event.amount;
    }
   }
  }
 }
 let clock=1,lastTurn=0,lastTradeTurn=-1,steps=0;
 const maxTurns=n*horizon;
 function cmd(actor,command){
  const before=game.state,beforeMoney=cashPot(before),beforePhase=before.phase,ap=before.players.find(p=>p.id===actor);
  const result=game.applyCommand(actor,command,clock++);stats.commands++;
  if(!result.ok){stats.rejectedCommands++;throw Error(JSON.stringify({scenario,n,seed,turn:before.turnId,phase:beforePhase,actor,command,error:result.error}));}
  const after=game.state,delta=cashPot(after)-beforeMoney;
  observeEconomy(before,after,result);
  let classified=false;
  if(after.phase.kind==='moving'&&after.phaseId!==before.phaseId&&['dice','card_forward'].includes(after.phase.reason)&&after.phase.path.includes(0)){
   const id=after.phase.playerId,m=R.mineBonuses[mines(before,id)],amount=delta;stats.startPayout+=amount;stats.minePayout+=m;stats.players[id].mineStartPayout+=m;stats.players[id].startVisits++;classified=true;
  }
  if(command.type==='buy_property'||command.type==='upgrade_property'){
   stats.purchases+=command.type==='buy_property'?1:0;stats.buildingsBought+=command.housesToBuy;stats.purchaseSink-=delta;stats.players[actor].buySpend-=delta;classified=true;
  }
  if(command.type==='sell_property_to_bank'){stats.sales++;stats.liquidationSource+=delta;stats.players[actor].sellProceeds+=delta;classified=true;}
  if(command.type==='acknowledge_card'&&beforePhase.kind==='card'){
   if(beforePhase.card.action==='market_crash'){stats.marketCrashSink-=delta;classified=true;}
   if(beforePhase.card.action==='add_money'){stats.cardGrants+=delta;classified=true;}
  }
  if(!classified)stats.otherCashDelta+=delta;
  for(const event of result.events){if(event.type==='payment'&&event.reason.startsWith('rent for ')){stats.players[event.playerId].rentCharged+=event.amount;const payer=before.players.find(p=>p.id===event.playerId);stats.players[event.payeeId].rentReceived+=Math.min(Math.max(0,payer.money),event.amount);}}
  for(const p of after.players){if(p.status!=='active'&&stats.players[p.id].bankruptcyTurn===null){stats.players[p.id].bankruptcyTurn=before.turnId;if(stats.firstBankruptcyTurn===null){stats.firstBankruptcyTurn=before.turnId;stats.firstBankruptcyNormalized=before.turnId/n;}}}
  if(['buy_property','upgrade_property','sell_property_to_bank','accept_trade','acknowledge_card','execute_sabotage','execute_protection','declare_bankruptcy'].includes(command.type))observe();
  if(beforePhase.kind==='debt'&&beforePhase.debt.creditorId&&beforePhase.debt.reason.startsWith('rent for ')){const id=beforePhase.debt.creditorId;stats.players[id].rentReceived+=Math.max(0,after.players.find(p=>p.id===id).money-before.players.find(p=>p.id===id).money);}
  if(trace&&steps<150)process.stderr.write(JSON.stringify({t:after.turnId,actor,command,phase:after.phase.kind,cash:after.players.map(p=>p.money)})+'\n');
 }
 function timeout(){const s=game.state;clock=Math.max(clock,s.turnDeadline);cmd(SYSTEM_ACTOR,{type:'timeout',turnId:s.turnId,phaseId:s.phaseId});}
 function observe(){const s=game.state;stats.peakObservedCashPot=Math.max(stats.peakObservedCashPot,cashPot(s));for(const p of s.players){const rec=stats.players[p.id],m=mines(s,p.id),sets=setCount(s,p.id),hotels=owned(s,p.id).filter(x=>x.houses===5).length;rec.maxMines=Math.max(rec.maxMines,m);rec.maxSets=Math.max(rec.maxSets,sets);rec.maxHotels=Math.max(rec.maxHotels,hotels);stats.peakMines=Math.max(stats.peakMines,m);if(m&&rec.firstMineTurn===null)rec.firstMineTurn=s.turnId;if(sets&&rec.firstSetTurn===null){rec.firstSetTurn=s.turnId;stats.firstSetTurn??=s.turnId;}if(hotels)stats.firstHotelTurn??=s.turnId;}}
 function snapshot(){const s=game.state;return {turn:Math.min(s.turnId-1,maxTurns),normalizedTurns:Math.min(s.turnId-1,maxTurns)/n,active:s.players.filter(p=>p.status==='active').length,cashPot:cashPot(s),pot:s.vacationJackpot,bankValue:sum(Object.values(s.properties).filter(p=>p.ownerId!==null).map(p=>propertyValue(p.id,p.houses))),maxMines:Math.max(...s.players.map(p=>mines(s,p.id))),sets:sum(s.players.map(p=>setCount(s,p.id))),hotels:Object.values(s.properties).filter(p=>p.houses===5).length};}
 function trade(){
  const s=game.state,active=s.players.filter(p=>p.status==='active'),deals=[];
  for(let a=0;a<active.length;a++)for(let b=a+1;b<active.length;b++){
   const A=active[a],D=active[b];
   for(const gA of GROUPS){const fromD=gA.filter(i=>s.properties[i].ownerId===D.id);if(!fromD.length||fromD.length===gA.length||!gA.every(i=>[A.id,D.id].includes(s.properties[i].ownerId)))continue;
    for(const gD of GROUPS){if(gA===gD)continue;const fromA=gD.filter(i=>s.properties[i].ownerId===A.id);if(!fromA.length||fromA.length===gD.length||!gD.every(i=>[A.id,D.id].includes(s.properties[i].ownerId)))continue;
     const vA=sum(fromA.map(i=>propertyValue(i,s.properties[i].houses))),vD=sum(fromD.map(i=>propertyValue(i,s.properties[i].houses))),payA=Math.max(0,vD-vA),payD=Math.max(0,vA-vD);
     if(A.money-payA<policy(A.id).reserve||D.money-payD<policy(D.id).reserve)continue;
     const gain=sum([...gA,...gD].map(i=>B[i].rent[5]-B[i].rent[4]));deals.push({A,D,fromA,fromD,payA,payD,gain});
    }
   }
  }
  if(!deals.length)return false;
  deals.sort((a,b)=>b.gain-a.gain);const d=deals[0];
  const assets=(properties,money)=>({properties,money,getOutOfJailCards:0});
  cmd(d.A.id,{type:'propose_trade',targetId:d.D.id,offer:assets(d.fromA,d.payA),request:assets(d.fromD,d.payD)});
  cmd(d.D.id,{type:'accept_trade',tradeId:game.state.activeTradeId});stats.trades++;return true;
 }
 cmd('p0',{type:'start_game'});
 while(game.state.state==='playing'&&game.state.turnId<=maxTurns){
  const s=game.state,p=game.getCurrentPlayer(),pol=policy(p.id),phase=s.phase;
  if(++steps>maxTurns*100)throw Error('Loop watchdog');
  if(s.turnId!==lastTurn){observe();if(lastTurn>0&&[25,50,100,150,200,300].includes(lastTurn/n))stats.snapshots.push(snapshot());lastTurn=s.turnId;stats.players[p.id].turns++;}
  if(base.trade&&['awaiting_roll','awaiting_end'].includes(phase.kind)&&lastTradeTurn!==s.turnId){lastTradeTurn=s.turnId;while(trade()){}continue;}
  switch(phase.kind){
   case 'awaiting_roll':{
    if(p.inJail&&p.getOutOfJailCards>0){cmd(p.id,{type:'use_jail_card'});break;}
    if(p.inJail&&p.money>=pol.reserve+R.jailFine){cmd(p.id,{type:'pay_jail_fine'});break;}
    cmd(p.id,{type:'roll_dice'});break;
   }
   case 'rolling':case 'moving':case 'rent':timeout();break;
   case 'card':cmd(p.id,{type:'acknowledge_card'});break;
   case 'awaiting_end':cmd(p.id,{type:'end_turn'});break;
   case 'buy':{
    const sq=B[phase.propertyIndex],purchase=phase.mode==='buy',price=purchase?sq.price:0;
    // Mines preserve a lower $150 emergency cushion: their own-start income is unusually valuable.
    const reserve=sq.type==='utility'?150:pol.reserve;
    if(p.money-price<reserve){cmd(p.id,{type:'pass_property'});break;}
    const budget=Math.max(0,p.money-price-reserve),houses=sq.type==='property'?Math.min(phase.maxHouses,purchase?pol.initial:pol.step,Math.floor(budget/sq.houseCost)):0;
    if(!purchase&&!houses){cmd(p.id,{type:'pass_property'});break;}
    cmd(p.id,{type:purchase?'buy_property':'upgrade_property',propertyIndex:sq.id,housesToBuy:houses});break;
   }
   case 'flight':{
    const budget=p.money-phase.ticketPrice,candidates=[];
    for(const i of phase.destinations){const sq=B[i],prop=s.properties[i];if(!prop)continue;let score=-Infinity;
     const crossesStart=i<phase.airportId?R.passingStart+R.mineBonuses[mines(s,p.id)]:0;
     if(prop.ownerId===null&&budget-sq.price>=(sq.type==='utility'?150:pol.reserve)){
      if(sq.type==='utility')score=4*(R.mineBonuses[mines(s,p.id)+1]-R.mineBonuses[mines(s,p.id)])+100;
      else if(sq.type==='property'){const group=GROUPS.find(g=>g.includes(i)),held=group.filter(j=>s.properties[j].ownerId===p.id).length;score=0.25*sq.price+4*(n-1)*sq.rent[Math.min(pol.initial,Math.floor((budget-sq.price-pol.reserve)/sq.houseCost))]+(held===2?500:held*60);}
     }else if(prop.ownerId===p.id&&sq.type==='property'){
      const complete=GROUPS.find(g=>g.includes(i)).every(j=>s.properties[j].ownerId===p.id),goal=complete?5:4,add=Math.min(goal-prop.houses,pol.step,Math.floor((budget-pol.reserve)/sq.houseCost));
      if(add>0)score=3*(n-1)*(sq.rent[prop.houses+add]-sq.rent[prop.houses])-add*sq.houseCost*0.15;
     }
     score-=phase.ticketPrice+crossesStart;if(score>0)candidates.push({i,score});
    }
    candidates.sort((a,b)=>b.score-a.score);const destination=candidates[0]?.i??null;
    if(destination!==null){stats.flights++;stats.paidFlights+=phase.ticketPrice>0?1:0;}
    cmd(p.id,{type:'flight_decision',destinationIndex:destination});break;
   }
   case 'risk_target':{
    const candidates=phase.targets.map(i=>s.properties[i]).sort((a,b)=>{
     const weight=x=>assetScore(s,x)*(phase.action==='sabotage'&&x.protected?0.2:1);
     return weight(b)-weight(a)||a.id-b.id;
    });
    cmd(p.id,{type:phase.action==='sabotage'?'execute_sabotage':'execute_protection',propertyIndex:candidates[0].id});break;
   }
   case 'debt':{
    const props=owned(s,p.id).sort((a,b)=>assetScore(s,a)/liquidationValue(a.id,a.houses)-assetScore(s,b)/liquidationValue(b.id,b.houses)||a.id-b.id);
    if(props.length)cmd(p.id,{type:'sell_property_to_bank',propertyIndex:props[0].id});else cmd(p.id,{type:'declare_bankruptcy'});break;
   }
   default:throw Error('Unhandled '+phase.kind);
  }
 }
 observe();const s=game.state;stats.finished=s.state==='ended';stats.censored=!stats.finished;stats.finishTurn=stats.finished?s.turnId:null;stats.finishNormalized=stats.finished?s.turnId/n:null;stats.winner=s.winnerId;stats.observedTurns=stats.finished?s.turnId:maxTurns;stats.active=s.players.filter(p=>p.status==='active').length;stats.finalCashPot=cashPot(s);stats.finalCashPotRatio=stats.finalCashPot/(1500*n);stats.finalSnapshot=snapshot();stats.finalSnapshot.turn=stats.observedTurns;stats.finalSnapshot.normalizedTurns=stats.observedTurns/n;stats.snapshots.push(stats.finalSnapshot);
 for(const p of s.players){Object.assign(stats.players[p.id],{money:p.money,status:p.status,finalMines:mines(s,p.id),finalSets:setCount(s,p.id),finalHotels:owned(s,p.id).filter(x=>x.houses===5).length,won:p.id===s.winnerId});}
 const expected=1500*n+stats.startPayout+stats.cardGrants-stats.marketCrashSink-stats.purchaseSink+stats.liquidationSource+stats.otherCashDelta;
 if(expected!==stats.finalCashPot)throw Error(`Cash conservation ${expected} != ${stats.finalCashPot}`);
 if(stats.otherCashDelta!==0)throw Error(`Unclassified cash delta ${stats.otherCashDelta}`);
 game.validateState();return stats;
}
function summarize(rows){const finished=rows.filter(x=>x.finished),n=rows.length,active={},mineWins={},checkpoints={};for(const r of rows){active[r.active]=(active[r.active]??0)+1;for(const s of r.snapshots){if(s.turn!==r.observedTurns||!r.finished){(checkpoints[s.normalizedTurns]??=[]).push(s);}}for(const p of Object.values(r.players)){const m=p.maxMines;(mineWins[m]??={players:0,wins:0,bankrupt:0,minePayout:0});mineWins[m].players++;mineWins[m].wins+=p.won?1:0;mineWins[m].bankrupt+=p.status==='bankrupt'?1:0;mineWins[m].minePayout+=p.mineStartPayout;}}
 const result={scenario:rows[0].scenario,players:rows[0].n,games:n,horizonPerOriginalPlayer:rows[0].horizon,finished:finished.length,censored:n-finished.length,finishRate:finished.length/n,finishRate95CI:wilson(finished.length,n),unconditionalMedianNormalizedTurns:finished.length>=n*.5?finished.map(x=>x.finishNormalized).sort((a,b)=>a-b)[Math.ceil(n*.5)-1]:null,unconditionalP90NormalizedTurns:finished.length>=n*.9?finished.map(x=>x.finishNormalized).sort((a,b)=>a-b)[Math.ceil(n*.9)-1]:null,finishedOnlyMedianNormalizedTurns:quantile(finished.map(x=>x.finishNormalized),.5),finishedOnlyP90NormalizedTurns:quantile(finished.map(x=>x.finishNormalized),.9),firstBankruptcyRate:rows.filter(x=>x.firstBankruptcyTurn!==null).length/n,firstBankruptcyMedianConditionalNormalized:quantile(rows.flatMap(x=>x.firstBankruptcyNormalized===null?[]:[x.firstBankruptcyNormalized]),.5),activeAtStop:active,meanFinalCashPot:mean(rows.map(x=>x.finalCashPot)),medianFinalCashPot:quantile(rows.map(x=>x.finalCashPot),.5),medianFinalCashPotRatio:quantile(rows.map(x=>x.finalCashPotRatio),.5),meanStartPayout:mean(rows.map(x=>x.startPayout)),meanMinePayout:mean(rows.map(x=>x.minePayout)),meanMarketCrashSink:mean(rows.map(x=>x.marketCrashSink)),meanPurchaseSink:mean(rows.map(x=>x.purchaseSink)),meanTrades:mean(rows.map(x=>x.trades)),meanHotelsAtStop:mean(rows.map(x=>x.finalSnapshot.hotels)),medianFirstSetNormalized:quantile(rows.flatMap(x=>x.firstSetTurn===null?[]:[x.firstSetTurn/x.n]),.5),anyHotelRate:rows.filter(x=>x.firstHotelTurn!==null).length/n,meanSales:mean(rows.map(x=>x.sales)),commands:sum(rows.map(x=>x.commands)),rejectedCommands:sum(rows.map(x=>x.rejectedCommands)),mineOutcomesAssociational:mineWins,checkpoints:Object.fromEntries(Object.entries(checkpoints).map(([k,v])=>[k,{games:v.length,meanCashPot:mean(v.map(x=>x.cashPot)),medianCashPot:quantile(v.map(x=>x.cashPot),.5),meanActive:mean(v.map(x=>x.active)),meanSets:mean(v.map(x=>x.sets)),meanHotels:mean(v.map(x=>x.hotels))}]))};
 return result;
}
if(require.main===module){const [scenario='development',n0='4',games0='10',horizon0='200',file='pilot',seed0='20261004']=process.argv.slice(2),n=+n0,games=+games0,horizon=+horizon0,seed=+seed0,rows=[];const start=Date.now();for(let i=0;i<games;i++){const row=simulate({scenario,n,horizon,seed:(seed+Math.imul(i,0x9e3779b9))>>>0});rows.push(row);if((i+1)%10===0)process.stderr.write(`${scenario} ${n}p ${i+1}/${games} ${((Date.now()-start)/1000).toFixed(1)}s\n`);}fs.mkdirSync(require('node:path').dirname(file),{recursive:true});fs.writeFileSync(file+'.json',JSON.stringify(rows,null,2));const summary=summarize(rows);fs.writeFileSync(file+'-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));}
module.exports={simulate,summarize,rng};

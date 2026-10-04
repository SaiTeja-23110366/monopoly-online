import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowLeftRight, ArrowRight, Check, Crown, Dices, Flag, Globe2, HelpCircle, House, LogOut, Settings2, Trophy, Users, Wallet, WifiOff, X } from 'lucide-react';
import { useGame } from './hooks/useGame';
import { Lobby } from './components/Lobby';
import { Board } from './components/Board';
import { ActionPanel } from './components/ActionPanel';
import { phaseDescription } from './lib/phase';
import { Dialog } from './components/Dialog';
import { PropertyInfoCard } from './components/PropertyInfoCard';
import { TradeModal, ViewTradeModal } from './components/TradeModal';
import { SQUARES, RULES } from '../../shared/board';
import type { TradeOffer } from '../../shared/types';
import { formatMoney } from './lib/geometry';
import { tokenSymbol } from './lib/tokens';
import { SoundCues } from './lib/audio';
import './App.css';

const media = () => matchMedia('(prefers-reduced-motion: reduce)');
const subscribeMotion = (callback:()=>void) => { const query=media();query.addEventListener('change',callback);return()=>query.removeEventListener('change',callback); };
const motionSnapshot = () => media().matches;
function App() {
  const { session, game, credentials, connection, pending, error, retryable, presentation, serverOffset } = useGame();
  const [selected,setSelected] = useState<number|null>(null);
  const [browse,setBrowse] = useState(false);
  const [tab,setTab] = useState<'turn'|'players'|'trades'|'activity'>('turn');
  const [tradeEditor,setTradeEditor] = useState<'new'|TradeOffer|null>(null);
  const [tradeId,setTradeId] = useState<string|null>(null);
  const [showRules,setShowRules] = useState(false);
  const [showSettings,setShowSettings] = useState(false);
  const [confirmLeave,setConfirmLeave] = useState(false);
  const [confirmBankrupt,setConfirmBankrupt] = useState(false);
  const [dismissedBankruptcy,setDismissedBankruptcy] = useState('');
  const [uiGameId, setUiGameId] = useState(game?.gameId);
  if (uiGameId !== game?.gameId) {
    setUiGameId(game?.gameId); setSelected(null); setBrowse(false); setTab('turn');
    setTradeEditor(null); setTradeId(null); setConfirmLeave(false); setConfirmBankrupt(false);
  }
  const [reduced,setReduced] = useState(()=>{try{return localStorage.getItem('monopoly_reduce_motion')==='true';}catch{return false;}});
  const [soundCues] = useState(() => new SoundCues());
  const [sound, setSound] = useState(false);
  useEffect(() => { soundCues.observe(game, presentation); }, [soundCues, game, presentation]);
  useEffect(() => () => soundCues.dispose(), [soundCues]);
  const systemReduced = useSyncExternalStore(subscribeMotion,motionSnapshot);
  const reducedMotion = reduced || systemReduced;
  useEffect(()=>{ session.presentation.setReduced(reducedMotion); },[session,reducedMotion]);
  const changeMotion = (value:boolean) => {setReduced(value);try{localStorage.setItem('monopoly_reduce_motion',String(value));}catch{/* Preference remains valid for this tab. */}};
  const playerId = credentials?.playerId || '';
  const displayGame = game ? { ...game, players: game.players.map(player => ({ ...player, money: presentation.balances[player.id] ?? player.money })), properties: presentation.properties, vacationJackpot: presentation.vacationJackpot } : null;
  const me = game?.players.find(player=>player.id===playerId);
  const ready = connection==='ready';
  const blocked = !ready || !!pending;
  const myTurn = game?.players[game.turnIndex]?.id===playerId;
  const active = me?.status==='active';
  const canTrade = game?.state==='playing' && active && !presentation.busy && ['awaiting_roll','awaiting_end','buy','flight','debt'].includes(game.phase.kind);
  const offers = game ? Object.values(game.trades).filter(trade=>[trade.initiatorId,trade.targetId].includes(playerId) && trade.status==='pending') : [];
  const incoming = offers.filter(trade=>trade.targetId===playerId);
  const bankruptcyKey = `${game?.gameId}:${playerId}`;
  const inspect = (index:number) => {setBrowse(false);setSelected(index);};
  const openTrade = () => setTradeEditor('new');
  return <div className={`app-shell ${reducedMotion?'reduce-motion':''}`}>
    <header className="app-header"><a className="brand" href="/" onClick={event=>{if(game){event.preventDefault();setShowRules(true);}}}><span className="brand-mark"><Globe2 size={23}/></span><span>MONOPOLY<small>ONLINE · WORLD EDITION</small></span></a>
      <div className="header-actions">{game && <span className="room-tag"><span>ROOM</span>{game.roomCode}</span>}<button className="icon-button" aria-label="Game rules" onClick={()=>setShowRules(true)}><HelpCircle size={20}/></button><button className="icon-button" aria-label="Accessibility settings" onClick={()=>setShowSettings(true)}><Settings2 size={20}/></button>{game && <button className="icon-button" aria-label="Leave table" onClick={()=>setConfirmLeave(true)}><LogOut size={19}/></button>}</div>
    </header>
    {connection!=='ready' && <div className={`connection-banner ${connection==='replaced'?'warning':''}`} role="status"><WifiOff size={17}/><span>{connection==='connecting'?'Connecting to your table…':connection==='resuming'?'Restoring your saved seat…':connection==='replaced'?'This seat is open in another tab. Continue there, or return to the lobby.':'Connection interrupted. Your seat is saved; reconnecting…'}</span>{connection==='replaced'?<button onClick={session.forgetSeat}>Return to lobby</button>:<button onClick={session.retry}>Retry connection</button>}</div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span>{retryable && <button onClick={session.retry}>Retry safely</button>}{!retryable && <button className="icon-button" aria-label="Dismiss message" onClick={session.dismissError}><X size={17}/></button>}</div>}
    {!game || game.state==='lobby' ? <Lobby key={game?.gameId || 'entrance'} game={game} playerId={playerId} ready={ready} pending={pending} enter={session.enter} command={session.command}/> : <main className="game-layout">
      <div className="game-topline"><div><span className="eyebrow">{game.state==='ended'?'THE FINAL DEAL':myTurn?'MAKE YOUR MOVE':'AT THE TABLE'}</span><h1>{game.state==='ended'?`${game.players.find(player=>player.id===game.winnerId)?.name || 'The table'} wins!`:myTurn?`Your turn, ${me?.name}`:`${game.players[game.turnIndex]?.name}’s turn`}</h1></div><div className="wallet-stat"><Wallet size={18}/><span>YOUR CASH<strong>{formatMoney(presentation.balances[playerId] ?? me?.money ?? 0)}</strong></span></div></div>
      <Board game={displayGame || game} presentation={presentation} selected={selected} onSquare={inspect} onBrowse={()=>setBrowse(true)} reducedMotion={reducedMotion}>
        <span className="center-phase">{presentation.busy ? presentation.rolling?'A little luck…':'Here we go…':phaseDescription(game.phase)}</span>
        {myTurn && game.phase.kind==='awaiting_roll' && !presentation.busy && <button className="button primary center-roll" disabled={blocked || !active} onClick={()=>session.command({type:'roll_dice'})}><Dices size={19}/>Roll dice</button>}
      </Board>
      <aside className="game-sidebar">
        <nav className="sidebar-tabs" aria-label="Table panels">{([{id:'turn',icon:Dices,label:'Turn'},{id:'players',icon:Users,label:'Players'},{id:'trades',icon:ArrowLeftRight,label:'Trades'},{id:'activity',icon:Flag,label:'Activity'}] as const).map(item=><button key={item.id} className={tab===item.id?'active':''} aria-pressed={tab===item.id} onClick={()=>setTab(item.id)}><item.icon size={17}/>{item.label}{item.id==='trades' && incoming.length>0 && <span className="count-badge">{incoming.length}</span>}</button>)}</nav>
        {tab==='turn' && <>
          <ActionPanel game={game} playerId={playerId} blocked={blocked} animating={presentation.busy} pending={pending} command={session.command} onInspect={inspect} onTrade={openTrade} onBankrupt={()=>setConfirmBankrupt(true)} offset={serverOffset}/>
          <section className="portfolio-panel"><div className="panel-heading"><h3>Your portfolio</h3><House size={16}/></div><div className="portfolio-stats"><div><strong>{Object.values((displayGame || game).properties).filter(property=>property.ownerId===playerId).length}</strong><span>DEEDS</span></div><div><strong>{me?.getOutOfJailCards || 0}</strong><span>JAIL CARDS</span></div><div><strong>{me?.flightChances || 0}</strong><span>FLIGHTS</span></div></div><div className="portfolio-deeds">{Object.values((displayGame || game).properties).filter(property=>property.ownerId===playerId).map(property=><button key={property.id} onClick={()=>inspect(property.id)} style={{borderColor:SQUARES[property.id].color||'#c3a574'}}>{SQUARES[property.id].name}</button>)}</div><button className="button secondary full" disabled={blocked || !canTrade} onClick={openTrade}><ArrowLeftRight size={16}/>Propose a trade</button>{!canTrade && active && <p className="footnote">Trading opens between moves and effects.</p>}</section>
          {incoming.length>0 && <button className="incoming-offer" onClick={()=>setTradeId(incoming[0].id)}><ArrowLeftRight size={19}/><span>You have {incoming.length===1?'a trade offer':`${incoming.length} trade offers`}<small>Review the terms</small></span><ArrowRight size={16}/></button>}
        </>}
        {tab==='players' && <section className="table-panel"><div className="panel-heading"><h2>At the table</h2><span className="badge">{game.players.filter(player=>player.status==='active').length} PLAYING</span></div><div className="player-list">{(displayGame || game).players.map((player,index)=><article key={player.id} className={`player-card ${game.turnIndex===index?'is-current':''} ${player.status!=='active'?'is-out':''}`}><div className="player-card-heading"><span className="player-token" style={{color:player.color}}>{tokenSymbol(player.color)}</span><div><strong>{player.name}{player.id===playerId?' (you)':''}</strong><small>{player.status!=='active'?'Spectating':player.connected===false?'Reconnecting':player.inJail?'In jail':SQUARES[player.position].fullName}</small></div>{player.id===game.winnerId?<Trophy size={19}/>:player.id===game.hostId?<Crown size={16}/>:null}<strong className="player-cash">{formatMoney(player.money)}</strong></div><div className="player-properties">{Object.values((displayGame || game).properties).filter(property=>property.ownerId===player.id).map(property=><button key={property.id} onClick={()=>inspect(property.id)} style={{borderColor:SQUARES[property.id].color||'#c3a574'}} aria-label={`Inspect ${SQUARES[property.id].fullName}`}>{SQUARES[property.id].name}</button>)}</div></article>)}</div></section>}
        {tab==='trades' && <section className="table-panel"><div className="panel-heading"><h2>The deal room</h2><ArrowLeftRight size={20}/></div><p className="muted">Your offers, all in one place.</p><button className="button primary full" disabled={blocked || !canTrade} onClick={openTrade}>Propose a trade</button>{offers.length?offers.map(trade=><button key={trade.id} className="trade-list-item" onClick={()=>setTradeId(trade.id)}><span>{trade.targetId===playerId?'From':'To'} {game.players.find(player=>player.id===(trade.targetId===playerId?trade.initiatorId:trade.targetId))?.name}<small>{trade.targetId===playerId?'Waiting for you':'Waiting for their reply'}</small></span><ArrowRight size={18}/></button>):<div className="empty-panel"><ArrowLeftRight/><p>No open offers</p><small>A good deal can change the game.</small></div>}</section>}
        {tab==='activity' && <section className="table-panel"><div className="panel-heading"><h2>Table journal</h2><Flag size={18}/></div><ol className="activity-log">{[...game.logs].reverse().map((entry,index)=><li key={`${game.logs.length-index}:${entry}`}><span className="log-dot"/>{entry}</li>)}</ol></section>}
        <div className="sync-footnote"><Check size={12}/> {ready?'Live & synced':'Reconnecting'} · Turn {game.turnId} · v{game.version}</div>
      </aside>
    </main>}
    {selected!==null && game && <PropertyInfoCard index={selected} game={displayGame || game} playerId={playerId} blocked={blocked} onClose={()=>setSelected(null)} command={session.command}/>}
    {browse && game && <Dialog title="Explore the board" onClose={()=>setBrowse(false)} wide><p className="muted">Every city, airport, mine, and little surprise.</p><div className="browse-grid">{SQUARES.map(square=><button key={square.id} onClick={()=>inspect(square.id)}><span className="property-dot" style={{background:square.color||'#c3a574'}}/><span>{square.fullName}<small>{square.type==='tax'?square.name==='Money Tax'?'10% of cash':'5% of property value':square.price?formatMoney(square.price):square.type}</small></span><ArrowRight size={14}/></button>)}</div></Dialog>}
    {tradeEditor && game && active && <TradeModal key={typeof tradeEditor==='string'?'new':tradeEditor.id} game={game} playerId={playerId} original={typeof tradeEditor==='string'?undefined:tradeEditor} blocked={blocked} onClose={()=>setTradeEditor(null)} command={session.command}/>}
    {tradeId && game?.trades[tradeId] && <ViewTradeModal trade={game.trades[tradeId]} game={game} playerId={playerId} blocked={blocked} command={session.command} onClose={()=>setTradeId(null)} onCounter={()=>{setTradeEditor(game.trades[tradeId]);setTradeId(null);}}/>}
    {showSettings && <Dialog title="Make it comfortable" onClose={()=>setShowSettings(false)}><label className="setting-row"><span><strong>Reduce motion</strong><small>Skip dice tumble and token travel. All outcomes stay the same.</small></span><input type="checkbox" checked={reducedMotion} disabled={systemReduced} onChange={event=>changeMotion(event.target.checked)}/></label>{systemReduced && <p className="form-note">Your device’s reduced-motion preference is on.</p>}<label className="setting-row"><span><strong>Tabletop sounds</strong><small>Soft dice, movement, and payment cues. Muted by default.</small></span><input type="checkbox" checked={sound} onChange={event=>setSound(soundCues.setEnabled(event.target.checked))}/></label><p className="muted">Use Tab to reach controls, Enter to choose a space, and Escape to close a dialog. Zoom controls and “Browse spaces” make every deed easy to reach.</p></Dialog>}
    {showRules && <Dialog title="A world of possibilities" onClose={()=>setShowRules(false)}><p>This is a custom 56-space city-trading game for 2–8 players.</p><ul className="rules-list"><li><strong>Build your empire.</strong> Buy unowned cities, airports, and mines. Cities can have up to four houses, then a hotel, built when you land there. Buy up to two houses with a new deed. Houses don’t require a full color set; hotels do.</li><li><strong>Keep moving.</strong> Collect {formatMoney(RULES.passingStart)} passing Start or {formatMoney(RULES.landingStart)} landing exactly, plus your mine bonus. Doubles earn another roll after all effects. Three doubles send you to jail.</li><li><strong>Take a flight.</strong> At an airport, fly up to the next airport. Your flight chance refreshes on passing or landing on Start. Flights from your own airport are free; other tickets cost $400, or $700 from Airport 4.</li><li><strong>Expect surprises.</strong> Chance, Chest, and Risk can change your plans. Vacation pays out the pot, but you skip your next turn.</li><li><strong>Stay in the game.</strong> Settle debts by selling deeds and buildings for 75% of cost or trading. The last active player wins.</li><li><strong>Keep the table moving.</strong> Decisions have server timers. Missed purchases and flights are passed; cards resolve automatically. Debt timeout sells assets before bankruptcy.</li></ul><p className="footnote">The shared rules catalog supplies every displayed price and rent. See each deed for the exact amounts.</p></Dialog>}
    {confirmLeave && <Dialog title={active && game?.state==='playing'?'Leave and forfeit?':'Leave this table?'} onClose={()=>setConfirmLeave(false)}><p>{active && game?.state==='playing'?'Your properties return to the bank and you cannot rejoin this match. Closing the browser instead keeps your saved seat for reconnection.':'You’ll return to the lobby. You can create a new table there.'}</p><div className="dialog-actions"><button className="button secondary" onClick={()=>setConfirmLeave(false)}>Stay here</button><button className="button danger" disabled={blocked} onClick={()=>{session.command({type:'leave_game'});setConfirmLeave(false);setSelected(null);setTradeEditor(null);setTradeId(null);}}>Leave table</button></div></Dialog>}
    {confirmBankrupt && <Dialog title="Declare bankruptcy?" onClose={()=>setConfirmBankrupt(false)}><p>Your properties return to the bank and you’ll watch the rest of the game as a spectator. Try selling or trading first if you want to stay in.</p><div className="dialog-actions"><button className="button secondary" onClick={()=>setConfirmBankrupt(false)}>Keep playing</button><button className="button danger" disabled={blocked} onClick={()=>{session.command({type:'declare_bankruptcy'});setConfirmBankrupt(false);}}>Declare bankruptcy</button></div></Dialog>}
    {game && me?.status==='bankrupt' && dismissedBankruptcy!==bankruptcyKey && !confirmBankrupt && <Dialog title="You’re still part of the table" onClose={()=>setDismissedBankruptcy(bankruptcyKey)}><p>You went bankrupt, but the game continues. Stay to watch the deals, dice, and final winner.</p><button className="button primary full" onClick={()=>setDismissedBankruptcy(bankruptcyKey)}>Continue as spectator</button></Dialog>}
    <footer className="app-footer">A classic game night. A whole new world.</footer>
  </div>;
}
export default App;

import { useState } from 'react';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import type { GameState, GameCommand, TradeAssets, TradeOffer, Player } from '../../../shared/types';
import { SQUARES } from '../../../shared/board';
import { formatMoney } from '../lib/geometry';
import { Dialog } from './Dialog';
const emptyAssets = (): TradeAssets => ({ money: 0, properties: [], getOutOfJailCards: 0 });
function AssetsEditor({ label, player, value, onChange, game }: { label: string; player: Player; value: TradeAssets; onChange: (value:TradeAssets)=>void; game:GameState }) {
  const propertyIds = [...new Set([...Object.values(game.properties).filter(property => property.ownerId === player.id).map(property => property.id), ...value.properties])];
  return <section className="trade-side"><h3>{label}</h3><p className="muted">{player.name} · {formatMoney(player.money)} available</p><label htmlFor={`cash-${player.id}`}>Cash</label><input id={`cash-${player.id}`} type="number" min="0" step="1" max={Math.max(0, player.money)} value={value.money} onChange={event => onChange({ ...value, money: Number(event.target.value) })} /><label htmlFor={`cards-${player.id}`}>Jail-free cards</label><input id={`cards-${player.id}`} type="number" min="0" step="1" max={player.getOutOfJailCards} value={value.getOutOfJailCards} onChange={event => onChange({ ...value, getOutOfJailCards: Number(event.target.value) })} /><label>Deeds & their buildings</label><div className="trade-property-list">{propertyIds.length ? propertyIds.map(id => {
    const property = game.properties[id];
    const owned = property?.ownerId === player.id;
    return <label className="property-checkbox" key={id}><input type="checkbox" checked={value.properties.includes(id)} onChange={event => onChange({ ...value, properties: event.target.checked ? [...value.properties, id] : value.properties.filter(index => index !== id) })} /><span className="property-dot" style={{ background: SQUARES[id]?.color || '#bbab85' }} /><span>{SQUARES[id]?.fullName || 'Unknown deed'}<small>{!owned ? 'No longer owned · uncheck to remove' : property.houses === 5 ? 'Hotel' : property.houses ? `${property.houses} houses` : 'Unbuilt deed'}</small></span></label>;
  }) : <p className="muted">No deeds yet</p>}</div></section>;
}
function assetsValid(assets: TradeAssets, player: Player, game: GameState) {
  return Number.isInteger(assets.money) && assets.money >= 0 && assets.money <= Math.max(0,player.money) && Number.isInteger(assets.getOutOfJailCards) && assets.getOutOfJailCards >= 0 && assets.getOutOfJailCards <= player.getOutOfJailCards && assets.properties.every(index=>game.properties[index]?.ownerId===player.id);
}
export function TradeModal({ game, playerId, original, blocked, command, onClose }: { game:GameState; playerId:string; original?:TradeOffer; blocked:boolean; command:(command:GameCommand)=>void; onClose:()=>void }) {
  const me = game.players.find(player=>player.id===playerId);
  const others = game.players.filter(player=>player.id!==playerId && player.status==='active');
  const [targetId,setTargetId] = useState(original?.initiatorId || others[0]?.id || '');
  const [offer,setOffer] = useState<TradeAssets>(original ? structuredClone(original.request) : emptyAssets());
  const [request,setRequest] = useState<TradeAssets>(original ? structuredClone(original.offer) : emptyAssets());
  const target = others.find(player=>player.id===targetId);
  const stale = !!original && game.trades[original.id]?.status !== 'pending';
  const eligible = game.state==='playing' && me?.status==='active' && (!original || original.targetId===playerId);
  const available = ['awaiting_roll','awaiting_end','buy','flight','debt'].includes(game.phase.kind);
  const valid = !!me && !!target && assetsValid(offer,me,game) && assetsValid(request,target,game);
  const submit = () => {
    if (blocked || !eligible || !valid || stale || !available) return;
    command(original ? {type:'counter_trade',tradeId:original.id,offer,request} : {type:'propose_trade',targetId,offer,request});
    onClose();
  };
  return <Dialog title={original ? 'Make a counteroffer' : 'Make a deal'} wide onClose={onClose}>
    <p className="muted">Offers stay open across turns. Cash, cards, and deeds move together only when the other player accepts.</p>
    <label htmlFor="trade-partner">Trade with</label><select id="trade-partner" disabled={!!original} value={targetId} onChange={event=>{setTargetId(event.target.value);setOffer(emptyAssets());setRequest(emptyAssets());}}>{others.map(player=><option key={player.id} value={player.id}>{player.name}</option>)}</select>
    {me && target && <div className="trade-editor"><AssetsEditor label="You give" player={me} value={offer} onChange={setOffer} game={game}/><ArrowLeftRight className="trade-divider"/><AssetsEditor label="You receive" player={target} value={request} onChange={setRequest} game={game}/></div>}
    {(stale || !eligible || !available || !valid) && <p className="form-note">{stale ? 'This offer has changed or closed. Close this window and open its latest version.' : !eligible ? 'Only active players can trade during a match. Only the recipient can counter an offer.' : !available ? 'Trading resumes when this move or card finishes.' : 'Check the cash, cards, and current ownership in your offer. Uncheck any deeds no longer owned.'}</p>}
    <div className="dialog-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={blocked || stale || !eligible || !valid || !available} onClick={submit}>{original ? 'Send counteroffer' : 'Send offer'}<ArrowRight size={17}/></button></div>
  </Dialog>;
}
export function TradeAssetsSummary({ assets }: { assets:TradeAssets }) {
  return <ul className="trade-asset-summary"><li>{formatMoney(assets.money)} cash</li>{assets.properties.map(index=><li key={index}>{SQUARES[index]?.fullName || 'Unknown deed'}</li>)}{assets.getOutOfJailCards > 0 && <li>{assets.getOutOfJailCards} jail-free card{assets.getOutOfJailCards===1?'':'s'}</li>}</ul>;
}
export function ViewTradeModal({ trade, game, playerId, blocked, onClose, onCounter, command }: { trade:TradeOffer; game:GameState; playerId:string; blocked:boolean; onClose:()=>void; onCounter:()=>void; command:(command:GameCommand)=>void }) {
  const initiator = game.players.find(player=>player.id===trade.initiatorId);
  const target = game.players.find(player=>player.id===trade.targetId);
  const incoming = trade.targetId===playerId;
  const participant = incoming || trade.initiatorId===playerId;
  const eligible = game.state==='playing' && participant && initiator?.status==='active' && target?.status==='active';
  const available = ['awaiting_roll','awaiting_end','buy','flight','debt'].includes(game.phase.kind);
  const valid = !!initiator && !!target && assetsValid(trade.offer,initiator,game) && assetsValid(trade.request,target,game);
  const respond = (type:'accept_trade'|'reject_trade') => {
    if (blocked || !eligible || trade.status!=='pending' || (type==='accept_trade' && (!incoming || !available || !valid))) return;
    command({type,tradeId:trade.id});
    onClose();
  };
  const counter = () => {
    if (!blocked && eligible && incoming && available && trade.status==='pending') onCounter();
  };
  return <Dialog title={`Trade with ${incoming ? initiator?.name : target?.name}`} onClose={onClose}>
    <p className="eyebrow">{trade.status.toUpperCase()} · OFFER {trade.revision ?? 0}</p>
    <div className="trade-preview"><section><h3>{initiator?.name} gives</h3><TradeAssetsSummary assets={trade.offer}/></section><ArrowLeftRight size={23}/><section><h3>{target?.name} gives</h3><TradeAssetsSummary assets={trade.request}/></section></div>
    {trade.status==='pending' ? <><p className="footnote">Offers stay open across turns. Acceptance checks both players’ current cash, cards, and deeds before exchanging them together.</p>{(!eligible || !available || !valid) && <p className="form-note">{game.state!=='playing' ? 'Trading is only available while the match is in progress.' : !eligible ? 'Only the two active trade participants can respond.' : !available ? 'This offer stays open. Wait for this move or effect to finish before accepting or countering.' : incoming ? 'Some cash, cards, or deeds are currently unavailable. This offer stays open: wait for them to become available, counter, or decline.' : 'Some cash, cards, or deeds are currently unavailable. This offer stays open: you can wait or withdraw it.'}</p>}{eligible && <>{incoming && <button className="button primary full" disabled={blocked || !available || !valid} onClick={()=>respond('accept_trade')}>Accept trade</button>}<div className="action-grid">{incoming && <button className="button secondary" disabled={blocked || !available} onClick={counter}>Counteroffer</button>}<button className="button secondary" disabled={blocked} onClick={()=>respond('reject_trade')}>{incoming?'Decline':'Withdraw offer'}</button></div></>}</> : <p className="form-note">This offer is {trade.status}. Nothing can be accepted from an older offer.</p>}
  </Dialog>;
}

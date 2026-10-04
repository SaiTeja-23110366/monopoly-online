import { useEffect, useState } from 'react';
import { ArrowRight, Dices, House, Plane, Shield, Clock3, HandCoins, LockKeyhole, Trophy, ArrowLeftRight } from 'lucide-react';
import type { GameState, GameCommand, GamePhase } from '../../../shared/types';
import { SQUARES, rulesForGame, liquidationValue } from '../../../shared/board';
import { formatMoney } from '../lib/geometry';
import { phaseDescription } from '../lib/phase';

export function TurnTimer({ deadline, offset }: { deadline?: number; offset: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  if (!deadline) return null;
  const seconds = Math.max(0, Math.ceil((deadline - now - offset) / 1000));
  return <span className={`turn-timer ${seconds <= 5 ? 'timer-low' : ''}`} title="The server advances this decision when time runs out"><Clock3 size={14} />{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}
export function ActionPanel({ game, playerId, blocked, animating, pending, command, onInspect, onTrade, onBankrupt, offset }: {
  game: GameState; playerId: string; blocked: boolean; animating: boolean; pending: string | null;
  command: (command: GameCommand) => void; onInspect: (index: number) => void; onTrade: () => void; onBankrupt: () => void; offset: number;
}) {
  const rules = rulesForGame(game);
  const player = game.players[game.turnIndex];
  const me = game.players.find(item => item.id === playerId);
  const mine = player?.id === playerId && me?.status === 'active';
  const phase = game.phase;
  const disabled = blocked || !!pending || animating;
  return <section className="action-panel" aria-label="Turn actions">
    <div className="panel-heading"><span className="eyebrow">{game.state === 'ended' ? 'FINAL RESULT' : mine ? 'YOUR TURN' : `${player?.name.toUpperCase() || 'PLAYER'}’S TURN`}</span><TurnTimer deadline={game.turnDeadline} offset={offset} /></div>
    <h2>{animating ? 'Watch it play out' : phaseDescription(phase)}</h2>
    {animating ? <p className="muted">The next decision appears after the dice, movement, and payments finish.</p> : game.state === 'ended' ? <><div className="result-icon"><Trophy /></div><p>{game.players.find(item => item.id === game.winnerId)?.name || 'Nobody'} takes the win. Thanks for playing.</p></> : !mine ? <><p className="muted">{me?.status !== 'active' ? 'You’re spectating. Follow the table and the final result here.' : `${player?.name} is ${phaseDescription(phase).toLowerCase()}. You can inspect deeds and plan your next deal.`}</p><div className="waiting-pulse"><span /><span /><span /></div></> : <>
      {phase.kind === 'awaiting_roll' && <>
        {player.inJail ? <><p className="muted"><LockKeyhole size={16} /> In jail · {player.jailTurns} failed attempt{player.jailTurns === 1 ? '' : 's'}</p><p>Roll doubles to escape. After the third failed roll, you leave for free and can move next turn.</p><div className="action-grid"><button className="button secondary" disabled={disabled || player.money < rules.jailFine} onClick={() => command({ type: 'pay_jail_fine' })}>Pay {formatMoney(rules.jailFine)}</button><button className="button secondary" disabled={disabled || player.getOutOfJailCards < 1} onClick={() => command({ type: 'use_jail_card' })}>Use free card ({player.getOutOfJailCards})</button></div></> : <p className="muted">{game.extraRoll ? 'Doubles! You’ve earned another roll. Three doubles in one turn send you to jail.' : 'Your next city is just a roll away.'}</p>}
        <button className="button primary full" disabled={disabled} onClick={() => command({ type: 'roll_dice' })}><Dices size={21} />{pending === 'roll_dice' ? 'Rolling…' : player.inJail ? 'Roll for doubles' : 'Roll dice'}</button>
      </>}
      {phase.kind === 'buy' && <PurchaseDecision key={game.phaseId} phase={phase} game={game} disabled={disabled} command={command} inspect={onInspect} />}
      {phase.kind === 'card' && <><div className={`drawn-card card-${phase.card.deck}`}><span>{phase.card.deck.toUpperCase()}</span><strong>{phase.card.deck === 'risk' ? '!' : '?'}</strong><p>{phase.card.text}</p></div><button className="button primary full" disabled={disabled} onClick={() => command({ type: 'acknowledge_card' })}>Resolve card<ArrowRight size={18} /></button><p className="footnote">This card resolves automatically when the timer ends.</p></>}
      {phase.kind === 'flight' && <FlightDecision key={game.phaseId} phase={phase} money={player.money} disabled={disabled} command={command} />}
      {phase.kind === 'risk_target' && <RiskDecision key={game.phaseId} phase={phase} disabled={disabled} command={command} />}
      {phase.kind === 'debt' && <><div className="debt-amount"><HandCoins size={22} /><span>{formatMoney(phase.debt.remaining)}<small>still owed · {phase.debt.reason}</small></span></div><p className="muted">Sell deeds with their buildings for 75% of cost, or trade with a friend to raise cash.</p><div className="asset-list">{Object.values(game.properties).filter(property => property.ownerId === playerId).map(property => <button key={property.id} className="asset-row" onClick={() => onInspect(property.id)}><span>{SQUARES[property.id].fullName}</span><strong>{formatMoney(liquidationValue(property.id, property.houses))}<ArrowRight size={14} /></strong></button>)}</div><button className="button secondary full" disabled={disabled} onClick={onTrade}><ArrowLeftRight size={17} />Arrange a trade</button><button className="text-button danger-text" disabled={disabled} onClick={onBankrupt}>Declare bankruptcy</button><p className="footnote">At timeout, the bank sells the cheapest assets first. If the debt remains, you become a spectator.</p></>}
      {phase.kind === 'awaiting_end' && <><p className="muted">All settled. Pass the dice when you’re ready.</p><button className="button primary full" disabled={disabled} onClick={() => command({ type: 'end_turn' })}>End turn<ArrowRight size={19} /></button></>}
      {['rolling', 'moving', 'rent'].includes(phase.kind) && <p className="muted">{phase.kind === 'rent' ? `${phase.payment.message}: ${formatMoney(phase.payment.amount)}` : 'The server is resolving this move…'}</p>}
    </>}
    {pending && <div className="pending-note" role="status">Confirming your action…</div>}
  </section>;
}
function PurchaseDecision({ phase, game, disabled, command, inspect }: { phase: Extract<GamePhase, {kind:'buy'}>; game: GameState; disabled: boolean; command: (command: GameCommand) => void; inspect: (index:number) => void }) {
  const [houses, setHouses] = useState(0);
  const square = SQUARES[phase.propertyIndex];
  const player = game.players[game.turnIndex];
  const buying = phase.mode === 'buy';
  const total = (buying ? square.price || 0 : 0) + houses * (square.houseCost || 0);
  const selectedHouses = Math.min(houses, phase.maxHouses);
  const effectiveTotal = (buying ? square.price || 0 : 0) + selectedHouses * (square.houseCost || 0);
  return <><button className="purchase-deed" style={{ borderColor: square.color || '#b89b68' }} onClick={() => inspect(square.id)}><span>{buying ? 'AVAILABLE TO BUY' : 'YOUR PROPERTY'}</span><strong>{square.fullName}</strong><small>View rent & deed <ArrowRight size={13} /></small></button>
    {square.houseCost && phase.maxHouses > 0 && <><label htmlFor="buildings">{buying ? 'Add buildings now' : 'Buildings to add'}</label><select id="buildings" value={selectedHouses} onChange={event => setHouses(Number(event.target.value))}>{Array.from({ length: phase.maxHouses + 1 }, (_, number) => <option key={number} value={number}>{number === 0 ? 'No buildings' : `${number} building${number > 1 ? 's' : ''} · ${formatMoney(number * (square.houseCost || 0))}`}</option>)}</select></>}
    <div className="purchase-summary"><span>Your balance after</span><strong>{formatMoney(player.money - effectiveTotal)}</strong></div>
    <button className="button primary full" disabled={disabled || effectiveTotal > player.money || (!buying && selectedHouses === 0) || total < 0} onClick={() => command({ type: buying ? 'buy_property' : 'upgrade_property', propertyIndex: square.id, housesToBuy: selectedHouses })}><House size={17} />{buying ? 'Buy' : 'Build'} for {formatMoney(effectiveTotal)}</button>
    <button className="button secondary full" disabled={disabled} onClick={() => command({ type: 'pass_property' })}>{buying ? 'Pass on this deed' : 'Keep it as it is'}</button></>;
}
function FlightDecision({ phase, money, disabled, command }: { phase: Extract<GamePhase,{kind:'flight'}>; money: number; disabled: boolean; command: (command: GameCommand) => void }) {
  const [destination, setDestination] = useState(phase.destinations[0]);
  return <><p className="muted"><Plane size={18} /> Fly to any space before the next airport. Airports themselves are not destinations. This uses your flight chance, refreshed when you pass or land on Start.</p><label htmlFor="flight-destination">Destination</label><select id="flight-destination" value={destination} onChange={event => setDestination(Number(event.target.value))}>{phase.destinations.map(index => <option key={index} value={index}>{SQUARES[index].fullName}</option>)}</select><p className="purchase-summary"><span>Your ticket</span><strong>{phase.ticketPrice ? formatMoney(phase.ticketPrice) : 'Free · you own this airport'}</strong></p><button className="button primary full" disabled={disabled || phase.ticketPrice > money} onClick={() => command({ type: 'flight_decision', destinationIndex: destination })}><Plane size={17} />Take flight</button>{phase.ticketPrice > money && <p className="form-note">You need {formatMoney(phase.ticketPrice - money)} more for this ticket.</p>}<button className="button secondary full" disabled={disabled} onClick={() => command({ type: 'flight_decision', destinationIndex: null })}>Stay here</button></>;
}
function RiskDecision({ phase, disabled, command }: { phase: Extract<GamePhase,{kind:'risk_target'}>; disabled: boolean; command: (command:GameCommand)=>void }) {
  const [target, setTarget] = useState(phase.targets[0]);
  return <><p className="muted">{phase.action === 'protect' ? 'Protect one of your properties against a harmful Risk card.' : 'Choose an eligible opponent’s property to sabotage.'}</p><label htmlFor="risk-target">Eligible property</label><select id="risk-target" value={target} onChange={event => setTarget(Number(event.target.value))}>{phase.targets.map(index => <option key={index} value={index}>{SQUARES[index].fullName}</option>)}</select><button className="button primary full" disabled={disabled || !phase.targets.includes(target)} onClick={() => command({ type: phase.action === 'protect' ? 'execute_protection' : 'execute_sabotage', propertyIndex: target })}><Shield size={17} />{phase.action === 'protect' ? 'Protect property' : 'Sabotage property'}</button></>;
}

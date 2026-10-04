import { Shield, Plane, Pickaxe } from 'lucide-react';
import { SQUARES, RULES, liquidationValue } from '../../../shared/board';
import type { GameState, GameCommand } from '../../../shared/types';
import { formatMoney } from '../lib/geometry';
import { Dialog } from './Dialog';

export function PropertyInfoCard({ index, game, playerId, blocked, onClose, command }: {
  index: number; game: GameState; playerId: string; blocked: boolean; onClose: () => void; command: (command: GameCommand) => void;
}) {
  const square = SQUARES[index];
  const property = game.properties[index];
  const owner = game.players.find(player => player.id === property?.ownerId);
  const canSell = game.phase.kind === 'debt' && game.phase.playerId === playerId && property?.ownerId === playerId;
  return <Dialog title={square.fullName} onClose={onClose}>
    <div className="deed" style={{ '--deed-color': square.color || '#c3a574' } as React.CSSProperties}>
      <div className="deed-band"><span>{square.type === 'property' ? 'TITLE DEED' : square.type.toUpperCase()}</span><strong>{square.fullName}</strong></div>
      {property ? <>
        <div className="deed-price"><span>Purchase price</span><strong>{formatMoney(square.price ?? 0)}</strong></div>
        <div className="rent-table" aria-label="Rent schedule">{square.rent?.map((rent, level) => <div key={level}><span>{square.type === 'property' ? level === 0 ? 'Base rent' : level === 5 ? 'With hotel' : `With ${level} house${level === 1 ? '' : 's'}` : `${level + 1} ${square.type === 'railroad' ? 'airport' : 'mine'}${level === 0 ? '' : 's'} owned`}</span><strong>{formatMoney(rent)}</strong></div>)}</div>
        {square.houseCost && <p className="deed-note">Each building costs {formatMoney(square.houseCost)}. Build houses when you land here, up to two at purchase. A hotel replaces four houses plus one building payment and requires the complete color set.</p>}
        {square.type === 'railroad' && <p className="deed-note"><Plane size={16} /> After landing, choose a destination before the next airport. Airports themselves are not destinations. Your flight chance refreshes when you pass or land on Start. Owner flights are free; other flights cost {formatMoney(index === 45 ? 700 : 400)}.</p>}
        {square.type === 'utility' && <p className="deed-note"><Pickaxe size={16} /> Mine ownership adds a Start bonus: {RULES.mineBonuses.slice(1).map(formatMoney).join(' / ')} for 1–4 mines.</p>}
        <div className="deed-owner"><span>Owner</span><strong style={{ color: owner?.color }}>{owner?.name || 'The bank'}</strong></div>
        {!!property?.houses && <p>{property.houses === 5 ? 'Hotel built' : `${property.houses} houses built`}</p>}
        {property?.protected && <p className="form-note"><Shield size={16} /> Protected against a harmful Risk card</p>}
        {canSell && <div className="debt-sale"><p>Return this deed and all its buildings to the bank for 75% of their value.</p><button className="button danger full" disabled={blocked} onClick={() => { command({ type: 'sell_property_to_bank', propertyIndex: index }); onClose(); }}>Sell for {formatMoney(liquidationValue(index, property.houses))}</button></div>}
      </> : <p className="special-description">{square.type === 'tax' ? square.name === 'Money Tax' ? 'Pay 10% of your positive cash balance, rounded down, into the Vacation pot.' : 'Pay 5% of the purchase value of your properties and buildings, rounded down, into the Vacation pot.' : index === 0 ? `Collect ${formatMoney(RULES.passingStart)} when passing Start, or ${formatMoney(RULES.landingStart)} when landing exactly. Mine bonuses are added.` : index === 14 ? `Just visiting unless you were sent to jail. Pay ${formatMoney(RULES.jailFine)}, use a free card, or roll doubles to leave.` : index === 28 ? `Collect the vacation pot: ${formatMoney(game.vacationJackpot)}. You skip your next turn.` : index === 42 ? 'Go directly to Jail without Start income. Your turn ends.' : square.name === 'Risk' ? 'High stakes, unexpected twists. Draw a Risk card and resolve the effect.' : 'Draw a card and follow its effect. Card effects are resolved in turn order.'}</p>}
    </div>
  </Dialog>;
}

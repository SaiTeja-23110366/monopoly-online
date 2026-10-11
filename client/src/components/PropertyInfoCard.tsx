import { Shield, Plane, Pickaxe } from 'lucide-react';
import { SQUARES, rulesForGame, ownsColorGroup, propertyRent, hotelActive, liquidationValue } from '../../../shared/board';
import type { GameState, GameCommand } from '../../../shared/types';
import { formatMoney } from '../lib/geometry';
import { Dialog } from './Dialog';

export function PropertyInfoCard({ index, game, playerId, blocked, onClose, command }: {
  index: number; game: GameState; playerId: string; blocked: boolean; onClose: () => void; command: (command: GameCommand) => void;
}) {
  const square = SQUARES[index];
  const property = game.properties[index];
  const rules = rulesForGame(game);
  const balanced = rules.version === 3;
  const fullSet = !!property?.ownerId && ownsColorGroup(game.properties, index, property.ownerId);
  const setBonus = rules.fullSetBaseRentMultiplier > 1 && square.type === 'property' && property?.houses === 0 && fullSet && !property.mortgaged;
  const hasHotel = square.type === 'property' && property?.houses === rules.hotelLevel;
  const activeHotel = hotelActive(game.properties, index, game.rulesVersion);
  const hotelStatus = activeHotel
    ? rules.hotelRentRequiresFullGroup ? 'Hotel active · complete color set owned.' : 'Hotel active · legacy economy keeps hotel rent after a set is broken.'
    : property?.mortgaged ? 'Hotel inactive · no rent while mortgaged.' : 'Hotel inactive · the hotel stays built, but charges the four-house rent until its owner restores the complete color set.';
  const owner = game.players.find(player => player.id === property?.ownerId);
  const canSell = game.phase.kind === 'debt' && game.phase.playerId === playerId && property?.ownerId === playerId;
  return <Dialog title={square.fullName} onClose={onClose}>
    <div className="deed" style={{ '--deed-color': square.color || '#c3a574' } as React.CSSProperties}>
      <div className="deed-band"><span>{square.type === 'property' ? 'TITLE DEED' : square.type.toUpperCase()}</span><strong>{square.fullName}</strong></div>
      {property ? <>
        <div className="deed-price"><span>Purchase price</span><strong>{formatMoney(square.price ?? 0)}</strong></div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <div className="deed-price"><span>Current rent</span><strong>{property.ownerId ? formatMoney(propertyRent(game.properties, index, game.rulesVersion)) : 'None · bank-owned'}</strong></div>
          {setBonus && <p className="deed-note">Complete color set · {rules.fullSetBaseRentMultiplier}× base rent is active.</p>}
          {hasHotel && property.ownerId && <p className="deed-note">{hotelStatus}</p>}
          {property.mortgaged && !hasHotel && <p className="deed-note">No rent while mortgaged.</p>}
        </div>
        <div className="rent-table" aria-label="Rent schedule">{square.rent?.map((rent, level) => <div key={level}><span>{square.type === 'property' ? level === 0 ? balanced ? 'Base rent · without complete set' : 'Base rent' : level === 5 ? rules.hotelRentRequiresFullGroup ? 'Hotel · complete set required' : 'With hotel' : `With ${level} house${level === 1 ? '' : 's'}` : `${level + 1} ${square.type === 'railroad' ? 'airport' : 'mine'}${level === 0 ? '' : 's'} owned`}</span><strong>{formatMoney(rent)}</strong></div>)}</div>
        {balanced && square.type === 'property' && <div className="deed-price"><span>Undeveloped · complete color set</span><strong>{formatMoney((square.rent?.[0] ?? 0) * rules.fullSetBaseRentMultiplier)}</strong></div>}
        {square.houseCost && <p className="deed-note">Each building costs {formatMoney(square.houseCost)}. Build only when you land here, up to two houses at purchase. Houses do not require a complete color set. A hotel replaces four houses plus one building payment and requires the complete color set.{balanced ? ' An undeveloped city earns double base rent while its owner has the complete color set. Hotel rent also requires keeping the set; a broken-set hotel charges the four-house rent until the set is restored.' : ' This legacy table has no complete-set base-rent bonus, and a built hotel keeps its rent if the set is broken.'}</p>}
        {square.type === 'railroad' && <p className="deed-note"><Plane size={16} /> After landing, choose a destination before the next airport. Airports themselves are not destinations. Your flight chance refreshes when you pass or land on Start. Owner flights are free; other flights cost {formatMoney(index === 45 ? rules.flightTicketFinalAirport : rules.flightTicketBase)}.</p>}
        {square.type === 'utility' && <p className="deed-note"><Pickaxe size={16} /> Mine ownership adds a total Start bonus: {rules.mineBonuses.slice(1).map(formatMoney).join(' / ')} for 1–4 mines.</p>}
        <div className="deed-owner"><span>Owner</span><strong style={{ color: owner?.color }}>{owner?.name || 'The bank'}</strong></div>
        {!!property?.houses && <p>{property.houses === 5 ? 'Hotel built' : `${property.houses} houses built`}</p>}
        {property?.protected && <p className="form-note"><Shield size={16} /> Protected against a harmful Risk card</p>}
        {canSell && <div className="debt-sale"><p>Return this deed and all its buildings to the bank for 75% of their value.</p><button className="button danger full" disabled={blocked} onClick={() => { command({ type: 'sell_property_to_bank', propertyIndex: index }); onClose(); }}>Sell for {formatMoney(liquidationValue(index, property.houses))}</button></div>}
      </> : <p className="special-description">{square.type === 'tax' ? square.name === 'Money Tax' ? 'Pay 10% of your positive cash balance, rounded down, into the Vacation pot.' : 'Pay 5% of the purchase value of your properties and buildings, rounded down, into the Vacation pot.' : index === 0 ? `Collect ${formatMoney(rules.passingStart)} when passing Start, or ${formatMoney(rules.landingStart)} when landing exactly. Mine bonuses are added.` : index === 14 ? `Just visiting unless you were sent to jail. Pay ${formatMoney(rules.jailFine)}, use a free card, or roll doubles to leave.` : index === 28 ? `Collect the vacation pot: ${formatMoney(game.vacationJackpot)}. You skip your next turn.` : index === 42 ? 'Go directly to Jail without Start income. Your turn ends.' : square.name === 'Risk' ? 'High stakes, unexpected twists. Draw a Risk card and resolve the effect.' : 'Draw a card and follow its effect. Card effects are resolved in turn order.'}</p>}
    </div>
  </Dialog>;
}

# World Edition rules

This game is an intentional 56-square Monopoly-inspired variant. It is not the
classic 40-square ruleset. The shared board catalog and server rule engine are
the source of truth; the browser displays the same prices and legal choices.

## Money and the board

- The host chooses starting cash in the lobby. Starting the match locks its setup.
- Passing Start pays $750; landing on Start pays $1,000 instead. Each qualifying
  visit refreshes one flight chance and adds the owned-mine bonus: $200, $500,
  $1,000, or $2,000 for one through four mines.
- Moving backward and direct transfers to jail do not earn Start income.
- Money Tax takes 10% of nonnegative cash. Property Tax takes 5% of the purchase
  and development value of owned properties. Taxes fund the Vacation jackpot.
- Vacation awards the current jackpot, clears it, and skips that player's next
  turn, including when the jackpot is empty. It cancels an earned extra roll.
- Cities, airports, and mines use the shared catalog's costs and rent schedules.
  This preserves the original server economy, correcting the old browser's
  conflicting prices rather than changing the economy to match its display.

## Turns, doubles, and jail

- A landing is completely resolved before an extra roll or the next turn.
- Doubles earn one additional roll after the landing is resolved. Three
  consecutive doubles send the player directly to jail and end the turn.
- Jail can be exited by paying $200, using a jail card, or rolling doubles.
- Doubles used to leave jail move the player but do not earn another roll.
- Three unsuccessful jail rolls release the player for free for their next turn.
- Every jail-entry route cancels extra rolls and resets the doubles streak.
- Card effects and their destination effects resolve for the player who drew the
  card, even when several movements or decisions are chained.

## Property and development

- An unowned property may be purchased when landed on, with zero, one, or two
  initial houses where applicable. Passing leaves it with the bank.
- Houses do not require a complete color set. A hotel does require that set.
- Development is capped at four houses or one hotel, represented as level five.
- Whole properties, including their development, can be sold back to the bank
  for 75% of their combined purchase/development cost, rounded down.
- Auctions, mortgages, even-building restrictions, and finite building stock are
  not part of this variant. They must not be assumed from classic Monopoly.

## Airports and cards

- A flight requires a flight chance and a ticket. The destination must be in the
  clockwise segment after the current airport, up to and including the next one.
- The ticket costs $400, or $700 from airport square 45, and is paid to its owner.
  At one's own airport this is a self-payment, so the net cost is zero; a flight
  chance is still used. Flying does not collect Start rewards.
- Buying an airport also offers its new owner a flight immediately if a flight
  chance remains. This is an explicit clarification of the landing sequence.
- The destination resolves normally: it may require buying, rent, tax, a card,
  jail, Vacation, or another applicable choice.
- Cards are sampled with replacement, preserving the existing lightweight decks.
- "Go back three" moves exactly three squares backward. "Advance to Start"
  follows its forward route and grants the specified Start reward once.
- Risk protection is a single-use shield. An affected protected asset consumes
  its shield and remains owned/developed. A shield is not permanent immunity.
- A Risk effect with no eligible target resolves without trapping the turn.

## Trading, debt, and game end

- Only the addressed recipient can accept or counter the current version of an
  offer. Its proposer can withdraw it. Changed offers require fresh consent.
- Both players' money, properties, and jail cards are checked again at acceptance.
  A stale, unaffordable, or invalid trade changes nothing.
- A debt suspends the turn until sale/trade remedies resolve it or the player is
  eliminated. Becoming solvent resumes the saved continuation immediately.
- A creditor receives only available or subsequently recovered money. Unpaid
  rent is not created out of thin air when a debtor goes bankrupt. Recovered tax
  and fine payments enter the Vacation jackpot in the same way.
- If the debt timer expires, whole properties are liquidated from cheapest to
  most expensive until the debt is covered. If recovery is insufficient, the
  player becomes bankrupt. A player may also choose bankruptcy during debt.
- Bankruptcy and forfeiture return remaining properties to the bank, clear
  development/protection, and invalidate the departed player's pending offers.
- The last remaining active player wins. A finished match cannot accept further
  gameplay mutations; eliminated players may continue watching.

## Multiplayer behavior

The server determines dice, cards, prices, legal actions, and timeouts. Animations
explain committed results and never decide ownership or movement. Reconnecting
requires the private seat credential stored by that browser; a public player ID
or room code alone cannot claim someone else's seat. Disconnecting is distinct
from explicitly leaving a match. The interface shows connection and recovery
state, and does not silently treat a failed command as a success.

## Scope

These defaults resolve previously ambiguous behavior conservatively. They are
documented product decisions, not claims of compliance with classic Monopoly.
Balance changes, new decks, classic-mode rules, and multi-server scaling should
be separately specified and tested.

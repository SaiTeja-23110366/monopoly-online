# Verification and release checklist

This change has been checked with executable rule, session, transport, persistence,
and packaged-server tests. It has **not been visually signed off in a browser**.
The cloud desktop started the compiled app successfully, but its managed Chromium
extension rejected `http://localhost:3101` with `ERR_BLOCKED_BY_CLIENT` and the
visible message “localhost is blocked.” No extension/security setting was changed,
and no alternate loopback address, tunnel, or external hosting was used to bypass
that restriction. There are no claimed gameplay screenshots or measured browser
frame-rate results.

## Automated checks

Baseline verification for `9bd6470` on 2026-10-04 used Node 24.19.0 and an isolated
Redis 7.4.9 built from the official Redis release tag. A clean lockfile install followed
by the complete aggregate passed: **67 server tests and 35 client tests, with
zero failures and zero skips**. Type checks, lint, both builds, the packaged smoke,
and whitespace checks passed. Independent review repeated the aggregate and
approved the code with the visual limitation above left explicit.

The reproducible entry point is:

```sh
npm run deps
REDIS_TEST_URL=redis://127.0.0.1:6379 npm run check
```

Use an isolated Redis instance/namespace for tests. The CI workflow provisions a
disposable Redis service. Without `REDIS_TEST_URL`, real-Redis cases are explicitly
skipped; the memory/fault-injection and actual Socket.IO cases still run.

Covered areas:

- Client/server type checks, client lint, both compiled production builds, and
  repository whitespace checks
- Canonical 56-square economics, each rent tier, initial building limits, hotels,
  purchases, liquidation, taxes, and mine/Start rewards
- Dice/doubles, every jail-entry route, jail release, backward cards, flights to
  every candidate destination, chained cards/effects, Risk shields and no-target
  resolution, Vacation skips, debt continuation, bankruptcy, and victory
- Current and noncurrent departures across active phases; terminal-state guards
- Atomic rejected commands, ownership/funds/quantity validation, immutable
  counteroffers, jail-card transfers, and invalidated offers
- A 12,000-transition seeded engine model and a separate 4,800-attempt interleaved
  trade/counter/departure regression with rejection and conservation assertions
- Real isolated Socket.IO clients: host authority, authenticated resume, public-ID
  takeover rejection, duplicate/concurrent/stale commands, and room isolation
- Admission proof recovery after lost responses, reconnects, and restarts;
  interrupted writes, command acknowledgements, session replacement, and retries
- Redis authority lease, compare-and-set, idempotent deletion, TTL/capacity,
  durability after purchases/trades, deadline recovery, and ambiguous-write
  readback/reconciliation
- Client board geometry, presentation ordering/catch-up, reduced motion, session
  listener ordering, saved admissions, event identity, stale responses, and
  financial/ownership presentation buffering
- React server-rendered component checks for phase actions, exact rule/tax text,
  lobby authority, trades, and spectator controls; these check rendered markup,
  not browser layout, pixels, touch interaction, or animation frame rate
- The packaged CLI smoke starts the compiled server, verifies static HTTP assets
  and readiness, creates two real clients, rejects nonhost start, accepts a roll
  once despite duplicate delivery, observes movement and synchronized landing,
  and resumes an authenticated seat

The independent review additionally exercised 42,000 interleaved adversarial
commands twice. Those exploratory runs supplemented the committed regression
suite; they are not extra CI test cases. Review found and drove fixes for Redis
TTL eviction, ambiguous write recovery, interrupted admission, spectator exit,
client retry, and admission-proof concurrency issues.

## Persistent trade offers (2026-10-04)

The trade follow-up removes turn-based cancellation and automatic cancellation
when cash, cards, or property ownership change. Pending offers stay open until
an explicit participant response, replacement counteroffer, participant
elimination/departure, or game end. Assets are not reserved: acceptance still
checks current holdings atomically and unavailable offers can be countered or
dismissed. The dialog explains this and keeps unavailable selected deeds visible
so a counteroffer can remove them. No board CSS or layout was changed.

The final local `npm run check` passed with Node 24.19.0: **71 server tests and
50 client tests passed**, zero failures, with **five real-Redis tests skipped**
because this workspace has no Redis service. Type checks, lint, both production
builds, packaged Socket.IO/HTTP smoke and `git diff --check` passed. Independent
review found no blocker and repeated all 45 engine and 16 component tests.

New regression coverage includes:

- Three complete rounds and both manual/automatic turn endings
- Purchases, cash shortages/recovery, spent jail cards, competing trades,
  sold/lost/transferred/sabotaged deeds, Vacation skips and unrelated departures
- Atomic rejected acceptance, participant-only responses, counters with fresh
  consent, decline/withdraw replay, bankruptcy and terminal-game guards
- Eight pending offers across turns, countering at the limit, reopening a slot,
  and trimming closed history without deleting pending offers
- Actual Socket.IO disconnect/resume after two rounds, stale command guards,
  exactly-once acceptance and proposal replay; manager restart with temporarily
  unavailable property and later ownership recovery
- An additional real-Redis restart/replay test, included in CI's Redis-enabled
  aggregate; local skip is not reported as a Redis pass
- Rendered client actions after later turns, unavailable-assets recovery,
  participant permissions, paused phases, blocked transport and terminal states

This change requires rebuilding **both client and server** and restarting the
server. Finish disposable `ROOM_STORE=memory` games first: restarting that adapter
loses its rooms, and this fix does not add memory-store persistence. Redis-backed
rooms keep their existing snapshot format and configured absolute room lifetime.
Previously cancelled offers are not resurrected. Browser gameplay/visual checks
remain unverified for the localhost restriction documented above; no bypass,
merge or deployment was performed.

## Airport destination boundary (2026-10-04)

Flights now end strictly before the next clockwise airport. No airport is a
flight destination, whether unowned, owned by the flyer, or owned by an opponent.
The four legal segments contain 14, 12, 10, and 16 destinations respectively;
Airport 4 wraps past Start and stops at square 5. The server independently
checks the canonical segment before charging a ticket or consuming a chance.
The flight panel, deed information, and rules dialog use the same explanation.
Prices, rent, mine income, color-set benefits, trades, and layout are unchanged.

The final local `npm run check` passed on Node 24.19.0: **74 server tests and
51 client tests passed**, zero failures, with **five real-Redis tests skipped**
because this workspace has no Redis service. Both type checks, lint, both
production builds, packaged HTTP/Socket.IO smoke, and `git diff --check` passed.
Coverage includes all 52 legal destinations, every excluded airport endpoint
under all ownership states, atomic rejection even with a stale/tampered quote,
the last allowed square in every segment, and rendered menu/deed explanations.
Independent review additionally exercised 312 flight/ownership combinations
with exact free/$400/$700 charges and preserved pending trades.

Saved version-2 rooms are handled narrowly: an exact old inclusive flight quote
is trimmed to the current legal destinations on recovery. Corrupt or reordered
quotes are not repaired. A flight that was already committed under the old rule
finishes its accepted landing, and its historical movement event stays valid;
it is not refunded or replayed. Engine tests cover all four old endpoints,
idempotent migration and malformed inputs. Room-manager restart tests cover
all four legacy prompts and verify that new airport-endpoint commands reject.
No snapshot-format reset or change to existing ownership/economics is needed.

Rebuild both client and server and restart the server for rollout. Finish
disposable memory-store games before restarting. Browser gameplay remains
unverified because of the previously documented localhost restriction; it was
not bypassed. This verification does not establish economic balance or match
duration, which need separate simulation and human playtesting.

## Approved balanced economy (2026-10-04)

New rooms use economy version 3: Start pays $200 passing / $300 on an exact
landing; total mine bonuses are $25/$60/$100/$150. A complete color group
doubles undeveloped city rent. A hotel retains its building/value but charges
four-house rent while its group is incomplete, restoring hotel rent as soon
as its owner completes the group again. City purchase prices, nominal rent
ladders, building costs, construction permissions, taxes, liquidation, trades,
airport boundaries, and the approved board layout remain unchanged.

The shared ownership-sensitive calculation supplies both server charges and
current deed quotes. The UI explains the full-set bonus, inactive hotel state,
and each room's economy version. Presentation buffering is preserved. Version-2
snapshots with a missing/2 economy marker keep their original rules, balances,
buildings and offers; already-charged rent/debt never gets retroactively repriced.
Create a new room to use the balanced economy.

The final local aggregate and independent repeat passed **96 server tests and
60 client tests**, with zero failures and **six real-Redis tests explicitly
skipped** because no local Redis endpoint was configured. Both type checks,
lint, production builds, packaged HTTP/Socket.IO smoke and whitespace checks
passed. The remote CI workflow supplies Redis for all six persistence tests.
Twenty-one new economy tests cover 1,944 city/version/level/ownership combinations,
every Start/mine tier, card rewards, purchases, trades, Risk/shields, bank sales,
elimination, retained hotel value/reactivation, frozen debts, invalid versions,
and JSON recovery. Manager and real-Redis restart regressions cover missing,
explicit legacy, and balanced economy versions. Nine new component tests cover
versioned explanations, live rents and set/hotel transitions.

Independent review confirmed exact unchanged board-catalog values and 264,000
randomized rent quotes against a separately written formula. The combined
economy study ran 100 seeds for each of ten approved-policy/player-count cases,
alongside baseline and income-only comparisons. The full approved source rerun
produced identical outputs. See [the balance report](BALANCE.md) and the committed
`scripts/simulate-economy.cjs` for methods, results, and reproduction. Simulated
turn counts do not establish human duration, universal fairness, or guaranteed
completion; conservative and two-player policies still have unfinished tails.

Rebuild both client and server and restart for rollout. Finish memory-store
games before restarting, because that adapter does not persist rooms. Existing
Redis rooms retain their economy; new rooms are required for the new package.
Do not run an older server against new-economy rooms. Browser visual/gameplay QA
remains unverified under the earlier localhost restriction, which was not
bypassed. No merge or deployment is part of this change.

## Browser checks still required before release

### Viewport-fit desktop board (2026-10-04)

The enlarged-board follow-up uses a dedicated desktop game desk at CSS viewport
widths of at least 1100px and heights of at least 600px. The brand/room controls,
turn/cash summary, zoom controls, browse link and footer occupy the side column
instead of taking height above or below the board. Lobby layout is unchanged.

The board is sized to the smallest of 1080px, viewport height minus 32px, and
viewport width minus 404px (side column, column gap and outer gutters). This
keeps the entire square board in the desktop frame instead of forcing the
page to scroll or hiding an edge. Long action panels scroll within the side
column. Exceptionally long notices and turn names also have bounded scroll
areas, preserving a minimum 120px action-panel area even at the 600px cutoff.
No root overflow clipping is used to simulate a fit.

CSS-contract calculations (not browser measurements) give these board widths:

| CSS viewport | Previous enlarged layout | Viewport-fit desk |
| --- | ---: | ---: |
| 1366 × 768 | 760px | 736px |
| 1280 × 800 | 760px | 768px |
| 1536 × 864 | 760px | 832px |
| 1920 × 1080 | 920px | 1048px |
| 2560 × 1440 | 1080px | 1080px |

Phone/tablet widths and very short windows retain the normal scrolling document
layout so controls and text remain usable. Browser zoom can also select that
fallback by reducing the CSS viewport. A no-page-scroll promise does not apply
to every possible screen/zoom/font configuration. The existing Fit button
resets the board's pan/zoom; the desktop frame independently fits the canvas.

The complete local `npm run check` passed after this client-only layout change:
42 client tests and 63 server tests passed, alongside both type checks, client
lint, both production builds, and packaged smoke. Seven layout/geometry tests
check responsive CSS contracts, viewport bounds, side-control placement, the
worst-case chrome height budget, mobile fallback and token anchors at sizes
from 296px to 1080px. These are source-level calculations, not browser pixels.
The local environment has no Redis endpoint, so four real-Redis tests were
skipped; the unchanged CI workflow runs them using its Redis service.

This is not a new browser visual sign-off: the earlier managed-cloud localhost
block has not been bypassed. Verify the full desktop board without page scroll,
side-panel keyboard reachability, long names plus both notices, zoom/fit,
resizing, and mobile fallback in the local preview. In particular, check that
the main/board landmarks retain their semantics with the desktop
`display: contents` layout in supported browser/screen-reader combinations.

Run the built app locally in an unrestricted development browser. Use two
isolated profiles/incognito contexts; tabs sharing browser storage intentionally
represent the same seat. These are **pending manual checks**, not passed results.

### Desktop and mobile layout

- [ ] Check 1366×768, 1280×800, 1536×864 and 1920×1080 desktop, 768×1024 tablet, and 320/375/390px
  phone widths in portrait and landscape
- [ ] The fitted board is visible without a permanently overflowing sidebar;
  zoom, pan, fit, deed browsing, and the mobile panels remain reachable
- [ ] Token centers track the correct tiles at every corner, after resizing and
  zooming, and with several tokens sharing one square
- [ ] Visiting and imprisoned players are visually distinguishable at Jail
- [ ] Inspect property dialogs, long names, complete rent tables, trade terms,
  debt choices, empty states, and winner/spectator views without clipped controls

### Animation and feedback

- [ ] Roll once and rapidly click again: one dice outcome and one route appear
- [ ] Dice settle before square-by-square movement; corners do not cut diagonally
- [ ] Back-three reverses three tiles; flight and jail transfers are distinct
- [ ] Landing choices appear after the move; balances and ownership do not jump
  ahead of the associated presentation
- [ ] Test doubles followed by purchase, card, rent, debt, flight, and Jail
- [ ] Switch tabs/background the page during movement; return without a stale
  animation queue or duplicate effects
- [ ] System and in-game reduced-motion settings preserve information without
  hops/pans; optional sound/follow controls do not fight manual navigation

### Multiplayer, interactions, and accessibility

- [ ] Create/join in two profiles, change starting cash as host, and start; a
  nonhost never receives enabled host-only controls
- [ ] Refresh and briefly disconnect during a roll, choice, trade, and debt;
  recovery is visible and returns the same seat and legal phase
- [ ] Interrupt the very first admission response, then retry without duplicate
  players; opening the same seat in a second tab makes replacement explicit
- [ ] Change trade recipient after choosing assets; old selections disappear
- [ ] Counter/withdraw while the other player is reading an offer; stale terms
  cannot be accepted and errors explain the next step
- [ ] Close/Cancel/Escape and reopen dialogs, switch panels, and leave/rejoin a
  room without stale modal content or unwanted back/forward navigation
- [ ] Complete primary flows with the keyboard; verify labels, focus trapping,
  visible focus, focus restoration, touch targets, and non-color token identity
- [ ] Dismiss bankruptcy to watch; leave as a spectator; finish a two-player
  match through forfeiture and inspect the winner view

## Rollout boundaries

- This is one coupled client/server protocol upgrade. Deploy both from the same
  revision; do not mix the prototype client with the rebuilt server
- Prototype unauthenticated rooms are not silently migrated. Let old games finish
  or tell players to create new rooms before an operator upgrades
- One server authority per Redis namespace; horizontal replica operation is not
  supported by this design
- CI verifies; it does not merge, deploy, or publish packages automatically
- Passing covered tests is not a guarantee of zero defects, all-device visual
  correctness, load capacity, or production-network behavior

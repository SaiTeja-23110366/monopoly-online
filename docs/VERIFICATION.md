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

Final local verification on 2026-10-04 used Node 24.19.0 and an isolated Redis
7.4.9 built from the official Redis release tag. A clean lockfile install followed
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

## Browser checks still required before release

Run the built app locally in an unrestricted development browser. Use two
isolated profiles/incognito contexts; tabs sharing browser storage intentionally
represent the same seat. These are **pending manual checks**, not passed results.

### Desktop and mobile layout

- [ ] Check 1280×800 and 1536×864 desktop, 768×1024 tablet, and 320/375/390px
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

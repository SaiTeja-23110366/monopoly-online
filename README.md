# Monopoly Online · World Edition

A real-time, 2–8 player, 56-square property game with cities, airports, mines,
Risk cards, and a tax-funded Vacation jackpot. The server owns the rules and
random outcomes. The client presents those outcomes with an animated tabletop,
responsive controls, and reconnectable private seats.

Read [the custom rules](docs/RULES.md) before playing. This is not the classic
40-square Monopoly ruleset.

## Requirements

- Node.js 24 recommended (`.nvmrc`); Node.js 22.18 or newer in the 22.x line also supported
- npm and a clean install from the committed client/server lockfiles
- Redis for persistent/production games; the explicit memory adapter is for
  development and tests only

## Install and check

```sh
npm run deps
npm run check
```

The aggregate check runs client/server type checks, client lint, deterministic
rule and integration tests, client presentation tests, and both production
builds. Tests do not contact third-party production services.

## Run locally

For a quick disposable game:

```sh
npm run build
ROOM_STORE=memory npm start
```

Open `http://localhost:3001` in your browser. A room needs two players before it
can start. Use separate browser profiles/incognito contexts for independent
players. A second tab sharing the same saved seat will replace that seat's old
connection rather than create a second player.

For client hot reload, run these in separate terminals:

```sh
ROOM_STORE=memory npm run dev --prefix server
npm run dev --prefix client
```

Vite proxies the socket endpoint to the development server. The memory adapter
loses rooms on restart; it is intentionally refused when `NODE_ENV=production`.

## Persistent server

```sh
npm run deps
npm run build
NODE_ENV=production REDIS_URL=redis://127.0.0.1:6379 npm start
```

The compiled server serves `client/dist`; do not run the historical generated
JavaScript files beside TypeScript sources. Server output lives in `server/dist`.
Secrets belong in environment configuration, never in source control.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP/Socket.IO listener |
| `ROOM_STORE` | `redis` | Persistent Redis or explicit development `memory` |
| `REDIS_URL` | Required for Redis | `redis://` or TLS-verified `rediss://` connection |
| `REDIS_NAMESPACE` | `monopoly:v1:` | Isolated authority and room-key namespace |
| `ALLOWED_ORIGINS` | Same host only | Comma-separated additional browser origins |
| `ROOM_TTL_MS` | `86400000` | Absolute room lifetime, including lobby/ended state |
| `HOST_GRACE_MS` | `30000` | Disconnected host's lobby grace period |
| `MAX_ROOMS` | `500` | Single-server capacity limit |
| `REDIS_TEST_URL` | Unset | Isolated Redis endpoint for optional real-store tests |

`/healthz` reports that the process is alive; `/readyz` returns 503 when the room
store/authority is unavailable. Accepted game changes are persisted before
success is acknowledged. Redis outages cause visible retryable errors rather
than a false success or silent state loss.

Run exactly **one server authority per Redis namespace**. A fenced Redis lease
prevents two processes from independently advancing the same games. Do not use
multiple PM2 workers, `WEB_CONCURRENCY > 1`, or replicas with the same namespace.
Horizontal room ownership/routing is deliberately outside this deployment model.

Use a reverse proxy with HTTPS for public deployment. Configure the supported
origin explicitly when client and server use different hosts. Redis TLS
certificate verification is not disabled. Graceful SIGINT/SIGTERM handling drains
pending work and releases authority; missed phase deadlines recover from durable
state after a restart.

## Protocol and source layout

- `shared/board.ts`: sole square catalog, economics, and rule constants
- `shared/types.ts`: game phases, commands, events, snapshots
- `shared/protocol.ts`: authenticated session and acknowledgement contract
- `server/src/gameState.ts`: deterministic rule transitions without timers or I/O
- `server/src/roomManager.ts`: serialization, credentials, dedupe, persistence,
  reconnect, and phase deadlines
- `server/src/roomStore.ts`: memory/Redis adapters and fenced compare-and-set
- `client/src/lib/`: board geometry, presentation, and session helpers
- `client/src/components/`: tabletop, action panels, dialogs, and trades
- `server/test/`, `client/tests/`: practical rule, protocol, and presentation cases

The root-level `refactor*.py`, `refactor*.js`, `fix_index.py`, `rewrite_index.js`,
and `update_board.py` files are historical one-off prototype migrations. They are
not build steps and must not be run against this version.

Public player IDs are not credentials. The private resume secret is returned only
to its browser; its hash is stored on the server. Every gameplay command includes
a match identity and unique command ID. Duplicate requests cannot charge or move
twice; stale match/turn requests fail instead of applying to a newer situation.
Animation consumes sequenced server events and never authorizes gameplay.

Before creating or joining a room, the browser also saves a private random
admission proof. If the first response is lost, it retries that same admission
instead of creating a duplicate seat. The server stores only its hash and the
operation fingerprint. Keep the browser's saved data if you want to resume;
clearing it removes your private seat credentials.

## Upgrade note

The rebuilt protocol and version-2 game snapshots are intentionally incompatible
with the prototype's unauthenticated seat IDs and overlapping phase booleans.
Existing prototype rooms must finish before an operator deploys this version, or
players must create new rooms. There is no silent migration of an old room into a
different rule state. Deployment and merging are separate operator actions.

The balanced economy follow-up uses economy version 3 for **new rooms** while
keeping the version-2 snapshot format. Existing saved rooms with a missing or
version-2 economy marker continue their original economics; the UI identifies
them as legacy. Create a new room to get the lower Start/mine income, doubled
undeveloped-set rent, and ownership-dependent hotel premium. Nothing silently
rewrites old balances, buildings, offers, or charged debts. Deploy both client
and server together; do not roll back to an older server against new-economy
rooms. Finish disposable memory-store games before restarting the server.

## Testing and limitations

See [verification notes](docs/VERIFICATION.md) for the exact automated and browser
checks run for this change, their evidence, and any remaining limitations.
The [balance report](docs/BALANCE.md) documents the approved economy's seeded
simulations, strategy/player-count sensitivity, and reproduction commands.
Passing tests establish the covered scenarios; they do not establish that every
possible browser, network, device, or game sequence is bug-free.

CI runs the same aggregate check with a real Redis service. It is a verification
workflow, not an automatic deployment or package publication workflow.

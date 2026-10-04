# Monopoly Online client

React 19 + TypeScript + Vite. Requires Node 22.18+ (22.x) or Node 24+.

## Run

```sh
npm ci
npm run dev
```

Development proxies `/socket.io` to the game server at `http://localhost:3001`. Set `VITE_SERVER_URL` only when deliberately hosting the socket service on a separate allowed origin. Production uses its own origin.

## Verify

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Tests include actual React component SSR, complete 56-space geometry, deterministic dice/path/financial presentation ordering, and actual session-controller event sequences. The SSR transformer runs in middleware mode without opening a listening server. These tests do not replace real-browser visual, touch, accessibility, and multiplayer end-to-end checks.

## Architecture

- All names, prices, rent tables, and rules come from `shared/board.ts`; the client never settles a game action.
- `GameSession` authenticates every Socket.IO connection, rejects old epochs/revisions, retains command IDs across uncertain results, and recovers interrupted room admission using a private 256-bit proof saved before transmission.
- Per-tab credentials preserve a seat across refresh. A browser-wide last-seat fallback supports reopening the game. Opening that same seat elsewhere replaces the old connection; the old tab cannot erase the replacement tab's saved seat.
- `PresentationDirector` consumes ordered, deduplicated events independently of authoritative state. Dice finish before individual token path steps, then payment/decision presentation. Displayed cash, pot, and ownership wait for that queue to settle. Background, missing-history, reduced-motion, and resume paths catch up safely. Browser animation acknowledgements are never required for game progress.
- The board uses 1.6 / thirteen 1 / 1.6 weighted grid tracks, with zero padding, border, or gap. Tokens are stable elements in a separate transform-only layer, with seat-stable offsets. Jail visitors and inmates have separate zones.
- Mobile starts with the complete board visible, offers pinch/pan/zoom and a large-target deed browser, and keeps actions in reachable panels. Follow-token camera is optional while zoomed and stops after manual panning, pinching, or scrolling. Reduced motion disables it.
- Native dialogs preserve focus and Escape dismissal. Tokens differ by shape as well as color. System reduced motion and an in-app setting are honored. Optional synthesized audio is muted by default and starts only after a user gesture.

## Recovery and privacy

`monopoly_session_v2` and `monopoly_admission_v2` contain private credentials in browser storage. Never log, share, or put these values in URLs or public snapshots. Room invitation links contain only the public room code. If both supported browser stores are unavailable, admission is blocked with a visible message so a failed initial connection cannot create an unrecoverable seat.

# Monopoly Online - Optimization Fixes

> Historical prototype checklist. Several entries were already fixed before the
> current rebuild. Use README.md, docs/RULES.md, and docs/VERIFICATION.md for the
> implemented architecture, rules, and verified current behavior.

**🔴 Critical P0 (fix first):**
1. **500ms timer re-renders entire app** — `App.tsx` has a `setInterval` updating `timeLeft` state every 500ms. Will fix by moving timer to a separate component or using a ref/memo.
2. **O(N²) per-square filtering in Board.tsx** — `gameState.players.filter(...)` and `Object.values(gameState.properties).filter(...)` run per square per render. Will memoize at the Board level.
3. **Missing error handling on 16+ socket events** — `server/src/index.ts` only has try/catch on `reconnect_player`. All other handlers are unguarded. Will add try/catch.
4. **Server-side animation intervals with memory leaks** — `server/src/gameState.ts` uses `setInterval(250ms)` on the server to animate movement. Will fix by clearing intervals properly or removing server-side interval.
5. **Client-controlled timeouts (security)** — `index.ts` lets clients tell server a turn timed out (`check_timeout`). Will enforce timeout on the server side using `setTimeout`.
6. **Unvalidated trade payloads (security)** — `index.ts` trade proposals accept `any`-typed payloads with zero server-side validation. Will add validation.

**🟠 Major P1:**
7. **God object `MonopolyGame` (~900 lines)** — `gameState.ts` handles everything. Will split into sub-managers.
8. **Monolithic `App.tsx` (~700 lines, 40KB)** — Handles everything on the client. Will extract components.
9. **Full state broadcast on every action** — Every socket event broadcasts entire state. Will use partial updates or optimize state.
10. **17× duplicated socket handler boilerplate** — Same try/catch/fetch/save boilerplate in `index.ts`. Will refactor into a middleware/helper.
11. **No Redis error handling** — `roomManager.ts` has no `redis.on('error', ...)` listener. Will add one.

**🟡 Moderate P2:**
12. **No useMemo/useCallback anywhere** — Heavy computations run every render. Will add them.
13. **Pervasive `any` types** — Will fix `any` types.
14. **Duplicated win condition checks** — Logic duplicated across functions. Will consolidate.
15. **100ms dice animation timer** — `Board.tsx` uses 100ms setInterval for dice animation. Will optimize.

**🔵 Minor P3:**
16. **Accessibility gaps** — Divs as buttons lack ARIA. Will add them.
17. **~180 lines of unused CSS** — `App.css` has Vite/React boilerplate. Will remove.
18. **React Strict Mode double-emit risk** — socket reconnection useEffect in App.tsx. Will add cleanup or ignore strict mode duplicate.
19. **Socket events mixed into JSX** — `socket.emit(...)` directly in onClick handlers. Will extract to functions.
20. **Inline styles mixed with Tailwind** — Square.tsx builds long inline style strings. Will move to Tailwind classes.

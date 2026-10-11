# Approved Monopoly economy: actual-engine simulation study

The full package substantially reduces the old economy’s excess cash in these simulations. Most of that change comes from the lower Start and mine income. The ownership-sensitive rent rules add strategic consequences but do not uniformly shorten games relative to the income-only version. These are bounded policy sensitivity results, not a forecast of human play or a guarantee of match duration.

All ten cases use 100 fixed seeds each, the same original policies, $1,500 initial cash, and a cap of 200 × original seats in actual begun engine turns. The dataset contains 3,000 games across three economies. The original 1,000 baseline games and 700 prior income-only games were preserved byte-for-byte; the three missing income-only cases and all 1,000 full-package games were run for this study. Every gameplay transition uses the actual engine command API.

## Economies

- Baseline: Start $750/$1,000; mine bonuses $0/$200/$500/$1,000/$2,000; original city rent behavior
- Income-only: Start $200/$300; mine bonuses $0/$25/$60/$100/$150; original city rent behavior
- Approved full package: income-only values, double bare-city rent while the owner holds the whole color group, and hotel-level rent only while the full group is held. A retained hotel on a broken group charges the four-house rate and automatically regains its hotel rate when its group is restored

All property prices, ordinary rent ladders, house costs, build permissions, default starting cash, tax rates, fixed cash awards/fees on cards, airport economy and $200 jail fine remain unchanged. Advance to Start uses that room's exact-landing Start reward and mine bonus. New approved-engine games use rules version 3; existing saved games missing a version or explicitly version 2 retain the legacy economy. The simulations start new games.

## Main comparison

Finished counts are out of 100 by the same per-case cap. Median and P90 are all-game completion quantiles, not conditional-on-finishing quantiles. “Not reached” means that percentile was not observed by the cap. Cash is median cash plus Vacation pot at each game’s endpoint and mixes finished and censored endpoints; it is not a fixed-time cash estimate.

| Policy | Seats | Cap | Finished: baseline / income / full | Median total turns: baseline / income / full | Full P90 turns | Median stop cash: baseline / income / full |
|---|---:|---:|---|---|---:|---:|
| conservative | 2 | 400 | 50 / 70 / 70 | 391 / 341 / 335 | not reached | $31,138 / $2,034 / $2,060 |
| conservative | 3 | 600 | 27 / 79 / 77 | not reached / 463 / 471 | not reached | $45,928 / $2,668 / $2,662 |
| conservative | 4 | 800 | 9 / 92 / 87 | not reached / 572 / 579 | not reached | $61,103 / $4,051 / $3,765 |
| development | 2 | 400 | 79 / 91 / 90 | 229 / 260 / 267 | 394 | $16,386 / $1,449 / $1,447 |
| development | 3 | 600 | 48 / 95 / 96 | not reached / 317 / 308 | 496 | $37,976 / $1,783 / $1,727 |
| development | 4 | 800 | 35 / 99 / 99 | not reached / 403 / 397 | 568 | $52,002 / $1,923 / $1,923 |
| reciprocal_trade | 2 | 400 | 94 / 94 / 89 | 210 / 248 / 239 | not reached | $13,233 / $1,380 / $1,519 |
| reciprocal_trade | 3 | 600 | 77 / 96 / 97 | 361 / 309 / 309 | 486 | $28,548 / $1,820 / $1,713 |
| reciprocal_trade | 4 | 800 | 62 / 100 / 100 | 622 / 366 / 359 | 506 | $41,988 / $1,974 / $1,938 |
| mixed | 4 | 800 | 26 / 97 / 96 | not reached / 449 / 440 | 648 | $54,773 / $2,317 / $2,303 |

## Full-package uncertainty and surviving players

Wilson 95% intervals describe finite-seed Monte Carlo uncertainty under each specified policy. They do not cover differences between these bots and people. Unfinished games remain censored, not draws or invented finishes.

| Policy | Seats | Finished (95% interval) | Censored: 2 / 3 / 4 active | Mean capped total turns | Cash-at-stop P10 / P50 / P90 |
|---|---:|---|---|---:|---|
| conservative | 2 | 70% (60.4–78.1%) | 30 / 0 / 0 | 308.0 | $1,431 / $2,060 / $3,071 |
| conservative | 3 | 77% (67.8–84.2%) | 19 / 4 / 0 | 470.6 | $1,584 / $2,662 / $4,288 |
| conservative | 4 | 87% (79.0–92.2%) | 12 / 1 / 0 | 594.0 | $1,947 / $3,765 / $6,272 |
| development | 2 | 90% (82.6–94.5%) | 10 / 0 / 0 | 258.5 | $819 / $1,447 / $2,488 |
| development | 3 | 96% (90.2–98.4%) | 3 / 1 / 0 | 342.5 | $870 / $1,727 / $3,186 |
| development | 4 | 99% (94.6–99.8%) | 1 / 0 / 0 | 409.2 | $891 / $1,923 / $3,386 |
| reciprocal_trade | 2 | 89% (81.4–93.7%) | 11 / 0 / 0 | 246.5 | $873 / $1,519 / $2,587 |
| reciprocal_trade | 3 | 97% (91.5–99.0%) | 3 / 0 / 0 | 335.1 | $793 / $1,713 / $3,324 |
| reciprocal_trade | 4 | 100% (96.3–100.0%) | 0 / 0 / 0 | 376.3 | $960 / $1,938 / $3,304 |
| mixed | 4 | 96% (90.2–98.4%) | 4 / 0 / 0 | 465.0 | $997 / $2,303 / $4,622 |

Mean capped turns is the mean of min(completion turn, observation cap), a finite-window restricted-mean measure. It is not an estimate of eventual duration after the cap.

## Set and hotel exposure in the full package

Timing medians below are conditional on the event occurring. “Dormant” means a retained hotel whose owner no longer has the whole group; in version 3 it charges four-house rent. A reactivation is an observed transition from a broken-group hotel to one held with its whole group, including after an ownership transfer. These observational counts are not causal effects.

| Policy | Seats | Games with full set / hotel | Conditional first-set / first-hotel median turns | Games with dormant hotel / dormant rent / reactivation | Bare-set rent charges / dormant-hotel rent charges |
|---|---:|---|---|---|---|
| conservative | 2 | 96 / 77 | 111 / 195 | 21 / 7 / 6 | 90 / 16 |
| conservative | 3 | 96 / 87 | 240 / 359 | 15 / 7 / 2 | 152 / 13 |
| conservative | 4 | 99 / 91 | 351 / 466 | 26 / 13 / 9 | 142 / 19 |
| development | 2 | 95 / 87 | 118 / 183 | 25 / 8 / 8 | 62 / 10 |
| development | 3 | 95 / 85 | 169 / 243 | 27 / 9 / 4 | 68 / 15 |
| development | 4 | 96 / 80 | 232 / 296 | 29 / 11 / 4 | 54 / 16 |
| reciprocal_trade | 2 | 97 / 94 | 87 / 113 | 56 / 21 / 17 | 81 / 35 |
| reciprocal_trade | 3 | 98 / 95 | 125 / 170 | 66 / 32 / 25 | 127 / 66 |
| reciprocal_trade | 4 | 99 / 92 | 185 / 240 | 63 / 24 / 15 | 156 / 37 |
| mixed | 4 | 99 / 85 | 264 / 349 | 25 / 9 / 6 | 82 / 18 |

## Interpretation and limits

- The policy algorithm is unchanged. Its asset and flight scoring still uses the nominal rent ladder, so it can overvalue a dormant hotel or underweight a doubled bare set. Keeping that heuristic isolates the rules change under the original policies, but it is not a claim that these bots adapt optimally to the new incentives
- Purchases often include houses immediately. Bare-set rent was observed in 25–51 games per 100 depending on policy; dormant hotels occurred in 15–66 games per 100, with a smaller subset actually collecting dormant rent. The package’s design value cannot be judged from finish rate alone
- Reciprocal trades complete a group for each participant, equalize full purchase-plus-building book value with cash, retain reserves, and do not deliberately break existing complete groups. Real negotiation, speculative set breaking and premium-sensitive trading could differ
- Fixed reserves of $750 for conservative play and $300 for development/trading, plus the unchanged $200 jail fine, matter more in the low-income economy. Conservative two-player games still have a substantial unfinished tail at this cap
- All policies prioritize mines and allow mine purchases down to $150 cash. Mines remain useful income assets, but the new first-mine bonus alone takes six qualifying Start visits to repay its $150 price; rent and risk can change actual returns
- Seed schedules match across scenarios and economies, but action-dependent random consumption means individual rolls and cards are not paired between divergent game paths. Fixed seats and deterministic tie-breaking may introduce seat effects
- A turn may include extra rolls, and Vacation skips do not increment the turn counter. After elimination, survivors receive more personal turns within the fixed total cap. Total turns cannot be converted into guaranteed human minutes without observed playtest decision times
- Results do not prove optimal play, fairness, exhaustive correctness, or a universal balance target. A practical next check is human playtesting with attention to the long two-player tail, perceived mine value, and whether dormant hotels are clearly understood

## Reproduce the approved economy

Build the current server, then run the committed headless harness from the repository root:

```sh
npm run build
node scripts/simulate-economy.cjs development 4 100 200 /tmp/monopoly-development-4
node scripts/simulate-economy.cjs reciprocal_trade 4 100 200 /tmp/monopoly-trade-4
```

Arguments are policy, initial player count, game count, normalized cap, output basename, and optional base seed. Policies are `conservative`, `development`, `reciprocal_trade`, and four-player `mixed`. The normal seed schedule starts at 20261004 and increments each seed by the unsigned 32-bit value 0x9e3779b9. JSON output includes every seed, outcome, censoring, cash ledger, and hotel/set observations; the companion summary JSON has Wilson 95% intervals and conditional/all-game quantiles. The engine itself validates every accepted state.

The committed harness is a diagnostic tool, not a gameplay bot or a promise about people. Logical engine deadlines advance without real-time waits. Reproduce all ten approved cases with the first three policies at 2, 3, and 4 players, plus `mixed 4`; use 100 games and normalized cap 200 in each.

The separate evidence archive retains exact copied baseline, income-only and approved TypeScript/compiled engines, source hashes, all 30 raw scenario datasets, the original and passively instrumented harnesses, independent Python summaries, and five passing validation tests. Across the retained comparison datasets, 3,000 runs executed 7,087,740 accepted commands with zero rejected commands. These are 100 distinct seeds per configuration, not 3,000 independent trials of one ruleset. Extended reruns from the earlier investigation are not pooled into this comparison. The approved 1,000-game run was repeated against the final engine source; all raw and summary outputs matched byte-for-byte.

Independent review checked observer neutrality, exact source/compiled hashes, all scenario seeds, per-command cash accounting, censoring, summary calculations, and unchanged purchase prices/rent ladders. These checks do not replace human playtesting or the browser/device verification checklist.

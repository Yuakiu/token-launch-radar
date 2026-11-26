# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Yuakiu/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Yuakiu/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's token-radar-01, "Build the best token launch radar": a radar that ranks pre-token DeFi protocols by implied token-launch value — TVL priced at their category's market multiple, adjusted for growth, maturity and chain breadth — each with a value range and a concrete farm plan, presented as a filterable dashboard with per-protocol detail views.

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot at
`/input/snapshot.json` and writes:

- `/output/board.json` — the ranked board: every watchlist protocol plus the strongest native
  pre-token protocols below the watchlist floor, each with an implied value, a value range and a
  farm plan;
- `/output/data.js` — the dashboard's dataset, written beside the page;
- `/output/dashboard/` and `/output/screenshots/` — copies of this repository's;
- `/output/dossier.json` — built with `buildDossier` from `vendor/makefun-board.ts`.

## The model (radar-2)

Implied value = TVL × category multiple × growth × maturity × breadth.

- **Category multiple**: what the market already pays per dollar of TVL in the protocol's
  category — the median mcap/TVL of its live-token protocols, each print winsorised to
  [0.01, 4], the median shrunk toward the all-market median with a prior weight of 5. The row's
  low/high range uses the category's 25th/75th percentile multiples, shrunk the same way.
- **Growth**: the 7-day TVL change clamped to [-50%, +100%], applied at weight 0.35, the
  multiplier clamped to [0.60, 1.35].
- **Maturity**: 0.78 rising to 1.08 over four years of DefiLlama tracking (unknown date: 0.90).
- **Breadth**: +3% per chain past the first, up to +24%.

Wrapped, staked and bridged products of tokens that already trade are set aside, never ranked —
the same tests the house watchlist uses, applied to the whole list. Protocols whose token already
trades are shown at the market's own market cap. Farm plans are generated per protocol from its
category's playbook, its first chain's fee level, a capital band from its TVL and a holding window
from its age; every step states a cost and a time.

The run is deterministic: same snapshot in, byte-identical outputs out.

## Run it locally

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Then open `out/dashboard/index.html` in a browser (it reads `out/data.js`).

## License

MIT — see LICENSE.

---
<sub>Entered on [make.fun](https://make.fun/?ref=j3xs60vv&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

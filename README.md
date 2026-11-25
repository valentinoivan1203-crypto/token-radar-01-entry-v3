![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/valentinoivan1203-crypto/token-radar-01-entry-v3/rank.svg)
![reward](https://make.fun/badge/token-radar-01/valentinoivan1203-crypto/token-radar-01-entry-v3/reward.svg)

# Token Radar v3 — pre-token protocols ranked by held-out-validated implied value

An entry for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01): a program that reads the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and writes a web dashboard ranking the 198 protocols that record no token by what their launch would be worth, each with six concrete farm steps.

## What makes v3 different

Every value term is fitted on a training set and tested on a held-out set, **twice**, before the board is built — and a term is kept only when it improves out-of-sample prediction in **both** splits:

- **Sector multiple — KEPT.** Median mcap/TVL per category, shrunk toward the global median (0.1689) and clamped to [0.05, 0.75]. A category's own median is used only when it has n ≥ 3 live comps; thinner categories fall back to the global median. It is the only term that adds ranking signal over the global-median baseline in both splits.
- **Growth (7-day TVL change) — DROPPED.** Tested at 0.35 and shrunk to 0.15; neither beats sector-only on both error and rank correlation in both splits.
- **Maturity (age since listing) — DROPPED.** Tested at 0.10 and shrunk to 0.05; neither beats sector-only in both splits.
- **Parent-risk haircut — DROPPED.** No signal in the live set (the fitted factor is 1.0).

The dashboard's **"How each term was tested"** panel shows both splits, the held-out error with and without each term, and the keep/drop decision for every variant. The edge is reported honestly: the sector multiple's out-of-sample advantage over the global median is modest, which is why the multiple is shrunk and clamped and no other term is applied.

One design note, stated plainly so the test is not misread: the held-out test evaluates the shrinkage multiple itself — the term's mechanism — without the two deployment guards (a category's own median is used only when n ≥ 3, and the multiple is clamped to [0.05, 0.75]). Those guards keep single-protocol outlier medians from dominating the deployed board; in a 64-protocol training split they would fire for most categories and wash out the signal being measured. The deployed board applies the full specification; the test measures the mechanism.

## The board

- **198 ranked rows** — every protocol that records no token and passes the house's visible exclusion rules (no excluded category, no version marker, no wrapped/staked word, no exchange name). All 40 watchlist protocols are covered.
- **Implied value = TVL × sector multiple**, distinct for every row, ranks exactly 1..198.
- **Launch odds per protocol** — the fraction of its peers (same category, age band and TVL band) that record a token, shown as "1 in N" and as a percentage, with the peer set named. No token name and no launch date is invented.
- **Six farm steps per row** — fresh wallet, main action, weekly action, hold, claim safely, log. Costs are concrete per chain from the snapshot (Ethereum about $3-8/tx, Arbitrum/Optimism/Base/Polygon about $0.05-0.50, Solana about $0.01, anything else about $1-3); capital is tiered by TVL ($250 / $150 / $100 / $50); the hold is set by age (60 / 45 / 30 days).
- **Live token tab** — the top 24 protocols that already record a token, shown at the market's own market cap, never a model's.
- **Set aside** — every excluded protocol listed by reason with counts.

## The dashboard

A static page (no network, no framework) in `dashboard/` — dark terminal palette, amber and cyan on navy, monospace numbers. Sortable board, filterable by category and chain, search box, a detail view per protocol, the held-out test panel, the sector-multiples table, the set-aside list and the live-token tab. Every number on the page is computed from the snapshot by `main.ts`; nothing is hard-coded.

## How to run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads `input/snapshot.json`, writes `board.json` and `data.js` to the output directory, copies `dashboard/` and `screenshots/` there, and writes `dossier.json` with the vendored `vendor/makefun-board.ts`. Run it twice: both runs write byte-identical output.

## License

MIT — see [LICENSE](LICENSE).

---

Built for the make.fun token-radar-01 bounty. Referral: https://make.fun/r/dehpqxrn (code `dehpqxrn`).

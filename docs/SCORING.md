# Prioritisation scoring

Every keyword **cluster** gets a 0–100 priority score built from up to five factors. The score is a weighted
average of the factors that **have data**. A factor without data is **excluded** from the calculation (not
estimated, not treated as zero) and listed as a *missing input*. Implementation: [`src/lib/score.js`](../src/lib/score.js);
tests: [`tests/score.test.js`](../tests/score.test.js).

## Formula

```
score    = 100 × Σ (wᵢ × fᵢ)  ÷  Σ wᵢ          over factors i that have data and weight wᵢ > 0
coverage =       Σ wᵢ (factors with data)  ÷  Σ wᵢ (all factors)
contributionᵢ = 100 × wᵢ × fᵢ ÷ Σ wᵢ(with data)   (the contributions add up to the score)
```

If no factor has data the score is **n/a** (never 0). Scores are rounded to one decimal place.
"Input coverage" tells you how much of the total weight was usable — a 90 with 40% coverage deserves less trust
than a 70 with 100% coverage.

## Factors (each 0–1)

| Factor | Input (from the cluster) | fᵢ | Missing when |
|---|---|---|---|
| Search demand | Sum of **known** volumes in the cluster, V | `log10(1 + V) ÷ log10(1 + Vmax)` where Vmax is the largest cluster volume in the dataset (0 if Vmax = 0) | no keyword in the cluster has a volume |
| Ease | Mean of **known** difficulty values, D (0–100) | `1 − D ÷ 100` | no keyword has a difficulty |
| Intent value | Cluster's majority intent (ties: transactional > commercial > informational > navigational) | editable table, default transactional 1.0, commercial 0.8, informational 0.5, navigational 0.2 | every keyword is unclassified |
| Competitor gap | Gap status from the content-gap analysis | gap 1.0, untapped 0.6, contested 0.4, ours only 0.1 | no competitor CSV imported |
| Rank opportunity | Best (lowest) known current rank, R | R 1–3 → 0.1 · 4–10 → 1.0 · 11–20 → 0.8 · 21–50 → 0.5 · 51+ → 0.3 | no keyword has a rank |

Notes:

- **Volume is log-scaled** so one huge head term doesn't flatten everything else, and it is **relative to the
  current dataset** — adding or removing keywords can change other clusters' volume factor.
- When only some keywords in a cluster have volume, the factor uses the known ones and the UI shows how many
  are missing (e.g. "43,380 (2 of 18 missing)"). It does not extrapolate.
- A **blank rank means unknown**, not "not ranking". If you know you don't rank, enter a value such as `101`.
- The gap and rank tables are fixed, documented judgement calls; the **weights and intent values are editable**
  on the Priorities tab (weights are relative and need not sum to 100; zero removes a factor).

Default weights: volume 30, ease 25, intent 20, gap 15, rank 10 (total 100).

## Worked example

Two clusters in a dataset where the largest cluster volume is 10,000 (cluster B), default weights.

**Cluster A** — known volume 1,000; average difficulty 40; intent commercial; gap status *gap*; no rank data.

| Factor | fᵢ | wᵢ | wᵢ × fᵢ |
|---|---|---|---|
| Demand | log10(1001) ÷ log10(10001) = 3.00043 ÷ 4.00004 = **0.75010** | 30 | 22.503 |
| Ease | 1 − 40/100 = **0.6** | 25 | 15.000 |
| Intent | commercial = **0.8** | 20 | 16.000 |
| Gap | gap = **1.0** | 15 | 15.000 |
| Rank | *missing input* — excluded | (10) | — |
| **Total** | | **90** | **68.503** |

Score = 100 × 68.503 ÷ 90 = **76.1**. Coverage = 90 ÷ 100 = **90%**.

**Cluster B** — known volume 10,000; no difficulty data; intent informational; gap status *contested*; best rank 8.

| Factor | fᵢ | wᵢ | wᵢ × fᵢ |
|---|---|---|---|
| Demand | log10(10001) ÷ log10(10001) = **1.0** | 30 | 30 |
| Ease | *missing input* — excluded | (25) | — |
| Intent | informational = **0.5** | 20 | 10 |
| Gap | contested = **0.4** | 15 | 6 |
| Rank | rank 8 → **1.0** | 10 | 10 |
| **Total** | | **75** | **56** |

Score = 100 × 56 ÷ 75 = **74.7**. Coverage = **75%**.

**Cluster C** — no volume, no difficulty, all keywords unclassified, no competitor data, no rank → score **n/a**,
coverage 0%.

These exact numbers are asserted in `tests/score.test.js` ("worked example" test). Setting the gap weight to 0
re-scores A as 100 × (22.503 + 15 + 16) ÷ 75 = **71.3**, also asserted.

## Why exclude instead of neutralise?

Substituting a "neutral" 0.5 for a missing difficulty would quietly claim the keyword is of average difficulty.
Excluding the factor keeps the score honest about what it is based on, and the coverage figure plus the
"missing inputs" list make the gap visible. The trade-off: clusters with fewer inputs can score higher or lower
than they would with full data — always read the score together with its coverage.

## Recommended action

Each recommendation also carries a plain-language action derived only from gap status and rank:
gap → *create new content (competitors cover this)*, untapped → *create new content*, ours only → *maintain or refresh*,
contested → *improve the existing page* (or *defend* if best rank ≤ 3), no competitor data → *improve* if we have a
page/ranking URL, otherwise *create*.

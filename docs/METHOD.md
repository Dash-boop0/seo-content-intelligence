# Method: normalisation, duplicates, clustering, gaps and briefs

All steps are deterministic: the same data and settings always produce the same output. Code lives in
`src/lib/` and is covered by tests in `tests/`. Scoring is documented separately in [SCORING.md](SCORING.md) and
intent rules in [INTENT_RULES.md](INTENT_RULES.md).

## 1. Import and validation (`importer.js`)

- Columns are matched by header name (e.g. *Search Term*, *Avg. Monthly Searches*, *KD*, *Position*); the user can
  correct the mapping before importing. Only the keyword column is required.
- Numbers accept `12,100`, `1.2k`, `$4.20`, `45%`. Blank, `-`, `n/a`, `null`, `unknown` → **missing** (null).
- Invalid values (difficulty outside 0–100, negative volume, non-integer or < 1 rank, text in a number column) are
  set to missing and reported row-by-row in the import report. Rows without a keyword are skipped and reported.
- Nothing is estimated or back-filled.

## 2. Normalisation (`normalize.js`)

`normalizeKeyword`: Unicode NFKD + strip diacritics → lowercase → drop apostrophes → every other non-letter/digit
becomes a space → collapse whitespace → trim.

Optional **simple plural folding** (on by default, toggle on the Keywords tab) per token, only for tokens longer than
3 characters and not on an exception list (news, series, sales, analytics, gps, …):
`-ies → -y` (agencies → agency), `-sses → -ss`, `-xes/-ches/-shes → drop "es"` (matches → match),
words ending in `ss/us/is/os` unchanged (business, status, analysis), otherwise drop a final `s` (templates → template).
It is intentionally simple: it is not a stemmer ("tracking" is not reduced to "track").

## 3. Duplicates

- **Exact**: identical normalised form ("Time Tracking Software ", "time-tracking software").
- **Near**: different normalised forms with the same **set** of tokens after optional plural folding — word order
  and simple plurals differ ("timesheet template" / "timesheet templates").
- Each keyword is in at most one group. Groups are shown for review; nothing is merged automatically.
- **Merge** keeps the row with the highest known volume (first row if none known), fills only its *missing* fields
  from the other rows in order, and records the merged variants. **Volumes are never summed** — duplicates usually
  report the same query twice, and summing would inflate demand.
- "Not duplicates" dismisses a group (remembered in saved data).

## 4. Clustering (`cluster.js`)

1. **Core terms** = normalised (and plural-folded) tokens minus stopwords (*a, the, for, to, of, …*) and intent
   modifiers (*best, top, free, how, what, guide, review, …*). If that removes everything, the raw tokens are used.
2. **Order**: keywords sorted by known volume (descending; missing volume last), then normalised text A→Z, then id.
3. **Assignment**: each keyword is compared to the **seed** (first keyword) of every existing cluster using
   **Jaccard similarity** = |shared core terms| ÷ |all distinct core terms|. It joins the most similar cluster if the
   similarity ≥ threshold (ties → earlier cluster); otherwise it seeds a new cluster.
4. **Explanation** for each member: its core terms, its similarity to the seed and the shared terms
   (e.g. *Jaccard 0.67 with seed "what is time blocking" — shared terms: blocking, time*).
5. **Head terms** = core terms present in at least half of a cluster's members.

Default threshold **0.6** (adjustable 0.2–1.0). Lower → fewer, broader clusters; higher → more, tighter clusters.
Comparing against the seed only (not every member) prevents "chaining" where A~B and B~C pull unrelated A and C
together. Trade-off: results depend on which keyword becomes the seed (by design, the highest-volume one).

## 5. Content gaps (`gap.js`)

Inputs: a **competitor CSV** (`competitor_domain, url, topic`) and an **our pages CSV** (`url, title, primary_topic`).

- A competitor topic is matched to the cluster containing the member keyword with the highest Jaccard similarity to
  the topic's core terms, if ≥ threshold. Topics matching no cluster are listed as **"not in your keyword research"**
  with volume shown as *missing input*.
- We **cover** a cluster if any of our pages' topic (or title, if no topic) reaches the threshold against any member,
  **or** any member keyword has a ranking URL in the keyword data.
- Status per cluster: **Gap** (competitors cover, we don't), **Contested** (both), **Ours only**, **Untapped** (nobody
  in the data), or **Missing input** when no competitor data is imported.

The analysis only knows what you import. "Untapped" means *nobody in your competitor file*, not *nobody on the web*.

## 6. Briefs (`brief.js`)

Generated from a cluster, then every field is editable and saved locally:

- **Primary keyword** = the cluster seed; **secondary keywords** = other members by volume.
- **Intent** = cluster majority intent. **Audience** and **working title** come from a per-intent template
  (question-form seeds become the title as a question).
- **Outline**: `## <seed>: Overview`, one `##` per non-question secondary keyword (max 6), an intent-specific section
  (commercial: *How to choose*; transactional: *Pricing and next steps*), `## Frequently Asked Questions` with a
  `###` per question-form keyword, and `## Summary and Next Steps`.
- **Questions to answer** = cluster keywords starting with a question word (how, what, why, can, is, …) or ending in `?`.
- **Internal-link opportunities** = our pages sharing ≥ 1 core term with the cluster, ranked by shared-term count
  (max 8). Pages similar enough to be the cluster's existing target are flagged "may already target this topic".
- **Data notes** state which inputs were missing (e.g. *Search volume missing for 1 of 4 keywords (not estimated)*).
- Export one brief or all briefs as Markdown (outline rendered as a nested H2/H3 list).

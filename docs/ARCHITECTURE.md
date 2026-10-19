# Architecture

A static, dependency-free single-page app. There is no server, build step, database or network call beyond
loading the app's own files (and the bundled sample CSVs when you click "Load sample data").

```mermaid
flowchart LR
  subgraph Browser
    UI["src/app.js<br/>render + events"] -->|state| LS[("localStorage<br/>seo-content-intelligence.v1")]
    LS --> UI
    UI --> P["lib/pipeline.js<br/>analyse(state)"]
    P --> N["lib/normalize.js<br/>normalise · plural folding · duplicates · merge"]
    P --> I["lib/intent.js<br/>ordered rules → intent"]
    P --> C["lib/cluster.js<br/>core terms · Jaccard · seed clustering"]
    P --> G["lib/gap.js<br/>competitor / our-pages coverage"]
    P --> S["lib/score.js<br/>weighted score, missing inputs excluded"]
    UI --> B["lib/brief.js<br/>brief generation · Markdown"]
    UI --> CH["lib/charts.js<br/>inline SVG"]
    UI --> IM["lib/importer.js<br/>column mapping · validation"]
    IM --> CSV["lib/csv.js<br/>RFC 4180 parse / serialise"]
    UI --> ST["lib/state.js<br/>defaults · backup validation"]
  end
  F1[/"keyword CSV"/] --> IM
  F2[/"competitor CSV"/] --> IM
  F3[/"our pages CSV"/] --> IM
  P --> E1[/"recommendations .csv / .md"/]
  B --> E2[/"briefs .md"/]
  ST --> E3[/"backup .json"/]
```

## Layers

| Layer | Files | Notes |
|---|---|---|
| Shell | `index.html`, `src/styles.css` | Design tokens on `:root`, dark mode via `prefers-color-scheme`. |
| UI | `src/app.js` | Hash routing (`#keywords`, …), event delegation via `data-action` / `data-change` / `data-input`, all user text escaped. Recomputes the analysis after every change (cached until the next change). |
| Logic | `src/lib/*.js` | Pure ES modules, no DOM access, imported unchanged by Node tests. |
| Data | `sample-data/*.csv` | Synthetic sample + empty templates. |
| Tests | `tests/*.test.js` | `node --test`, no dependencies. |

## Data model (localStorage, key `seo-content-intelligence.v1`)

```js
{
  version: 1,
  isSample: boolean,                 // drives the "synthetic data" banner
  nextId: number,
  keywords: [{ id, keyword, volume|null, difficulty|null, cpc|null, rank|null, url, intentOverride|null,
               mergedFrom: [{ keyword, volume, difficulty }] }],
  rules: [{ id, enabled, intent, match: 'contains'|'starts'|'ends'|'regex', terms, note }],
  settings: { foldPlurals, clusterThreshold, weights: { volume, difficulty, intent, gap, rank },
              intentValues: { transactional, commercial, informational, navigational } },
  competitors: [{ domain, url, topic }],
  ourPages: [{ url, title, topic }],
  briefs: { [clusterId]: { clusterId, primaryKeyword, intent, workingTitle, audience, secondaryKeywords,
                           outline, questions, internalLinks, dataNotes, notes, updatedAt } },
  dismissedDuplicates: [groupKey]
}
```

Derived data (intents, duplicate groups, clusters, gaps, summaries, scores) is never stored; it is recomputed
from the state by `analyse()` so it can't drift out of sync. Cluster ids are `c:<normalised seed keyword>`, which
keeps saved briefs attached while the seed stays the same; briefs whose cluster disappears (e.g. after changing
the threshold) are kept and flagged.

## Error handling

- CSV parse errors (e.g. an unclosed quote) report the line number; missing required columns list the expected headers.
- Invalid cell values become missing and appear in the import report.
- Backups are validated (`validateState`) before replacing data; malformed saved data is ignored with a message.
- localStorage failures (private mode, quota) show a warning and the app keeps working in memory.
- A rendering error shows an explanatory panel instead of a blank page.

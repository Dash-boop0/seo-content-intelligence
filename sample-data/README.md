# Sample data — synthetic and illustrative

**Everything in this folder is made up.** It exists to demonstrate the toolkit, not to describe any real market.

- **Fernleaf** (`fernleaf.example.com`) is a fictional time-tracking SaaS. **hourglass.example.com**,
  **punchclock.example.net** and **chronoleaf.example.org** are fictional competitors. All domains use the reserved
  `example.*` TLDs.
- **Search volumes, keyword difficulty, CPC and current ranks are illustrative numbers, not real search data**
  and were not taken from any SEO tool. Do not use them for decisions.
- Some rows deliberately have **missing** volume, difficulty, CPC or rank, and some keywords are deliberate
  duplicates (`Time Tracking Software ` / `time-tracking software`, `timesheet template` / `timesheet templates`),
  to demonstrate missing-input handling and de-duplication. One keyword contains a comma to exercise CSV quoting.

| File | Rows | Columns |
|---|---|---|
| `keywords-sample.csv` | 77 | Search Term, Avg. Monthly Searches, KD, CPC (USD), Position, Ranking URL — non-standard headers on purpose, to show column auto-mapping |
| `competitors-sample.csv` | 19 | competitor_domain, url, topic |
| `our-pages-sample.csv` | 10 | url, title, primary_topic |
| `*-template.csv` | 0 | Header rows to copy for your own data |

## Using your own data

- **Keywords**: any CSV with a keyword column. Optional: volume, difficulty (0–100), CPC, current rank, ranking URL.
  Header names are matched automatically and can be re-mapped in the app.
- **Competitors**: one row per competitor page: `competitor_domain, url, topic` (the topic or keyword the page covers).
- **Our pages**: one row per page on your site: `url, title, primary_topic`.

# 2-minute demo script

Setup: run `python3 -m http.server 8000` in the repo folder and open http://localhost:8000 (or use the live demo).

| Time | Do | Say |
|---|---|---|
| 0:00 | Click **Load sample data**. Point at the yellow banner. | "This is a synthetic dataset for a fictional time-tracking SaaS. Every volume and difficulty value is illustrative — and some are deliberately missing." |
| 0:15 | **Overview**: KPIs, intent donut, top priorities. | "77 keywords, 94% have volume, 13 match no intent rule. Nothing here is estimated." |
| 0:30 | **Keywords**: show the 3 duplicate groups → click **Merge** on the exact group. Filter *Inputs → Missing volume*. | "Exact duplicates differ only by case or punctuation; near duplicates by word order or plurals. Merging keeps the highest-volume row and never sums volumes." |
| 0:50 | **Intent rules**: type "pomodoro timer" in the tester (Unclassified). Add `timer` to rule 7 terms, tab out, retest. | "Rules are ordered and transparent — the first match wins and every keyword shows which rule decided it." |
| 1:10 | **Clusters**: drag the threshold to 0.4 and back to 0.6. Expand "what is time blocking". | "Clustering is deterministic Jaccard similarity to a seed keyword. Each row explains why it's in the cluster." |
| 1:25 | **Content gaps**: show the competitor chart and the *Gaps only* filter, then the unmatched topics table. | "Gaps are clusters competitors cover and we don't. Topics outside our research show volume as a missing input." |
| 1:40 | Click **Brief** on a gap cluster → **Generate brief**. Edit the title, then **Export Markdown**. | "Audience, intent, H2/H3 outline, questions from question-form keywords, and internal links from our own pages." |
| 1:55 | **Priorities**: set *Search demand* weight to 0; show the score change and the *missing input* cells. **Export CSV**. | "Scores use only the inputs that exist and show their coverage. The formula and a worked example are in docs/SCORING.md." |

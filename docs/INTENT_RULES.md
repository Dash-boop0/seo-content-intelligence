# Search-intent rules

Intent classification is **rule-based, ordered and editable** — no machine-learning model, no API. You can always
see which rule decided a keyword's intent. Implementation: [`src/lib/intent.js`](../src/lib/intent.js);
tests: [`tests/intent.test.js`](../tests/intent.test.js).

## Intents

| Intent | Meaning |
|---|---|
| Informational | The searcher wants to learn or find a free resource (how-to, definitions, templates, calculators). |
| Commercial investigation | The searcher is comparing solutions (best, vs, reviews, product-category terms). |
| Transactional | The searcher is ready to act (pricing, buy, trial, demo). |
| Navigational | The searcher wants a specific site or page (login, a brand name, support). |
| Unclassified | No enabled rule matched. Shown explicitly — never silently assigned. |

## How matching works

1. The keyword is **normalised**: lowercased, diacritics removed, apostrophes dropped, other punctuation turned
   into spaces, whitespace collapsed (`"Time-Tracking Software!"` → `time tracking software`).
2. Rules are evaluated **top to bottom**. The **first enabled rule that matches** sets the intent; later rules are
   not consulted. Reorder rules with ↑/↓ to change precedence.
3. Each rule has a **match type** and comma-separated **terms** (terms are normalised the same way):

| Match type | Matches when | Example |
|---|---|---|
| Contains word/phrase | the term appears as whole word(s) anywhere | `top` matches "top 10 apps" but **not** "desktop" |
| Starts with | the keyword begins with the term (whole words) | `how to` matches "how to invoice" |
| Ends with | the keyword ends with the term | `reviews` matches "fernleaf reviews" |
| Regular expression | a JavaScript regex (case-insensitive) matches the normalised keyword | `\bvs\b` |

4. A **manual override** on the Keywords tab wins over all rules for that keyword.
5. Invalid rules (no terms, unknown intent, invalid regex) are flagged in red and **skipped** until fixed.

Plural forms are not folded for rule matching, so list both (`template, templates`) where it matters.

## Default rules (sample site "Fernleaf", fictional)

| # | Intent | Type | Terms | Why |
|---|---|---|---|---|
| 1 | Navigational | contains | login, log in, sign in, sign up, my account, customer support, contact | account/page access |
| 2 | Transactional | contains | buy, pricing, price, prices, cost, discount, coupon, deal, free trial, trial, demo, subscribe, purchase, order, quote, hire | ready to act |
| 3 | Commercial | contains | best, top, vs, versus, alternative(s), compare, comparison, review(s), rated, recommended | comparing options |
| 4 | Informational | starts with | how, what, why, when, where, who, which, whose, can, could, does, do, is, are, should, will, would, did | question form |
| 5 | Informational | contains | guide, tutorial, tips, example(s), template(s), ideas, definition, meaning, formula, calculator, checklist, printable, technique, explained | learning / free resources |
| 6 | Navigational | contains | fernleaf | the (fictional) brand; placed after 2–3 so "fernleaf pricing" is transactional and "fernleaf vs …" is commercial |
| 7 | Commercial | contains | software, app, apps, tool, tools, platform, tracker, system | product-category head terms (heuristic) |

Worked examples (all asserted in tests):

| Keyword | Result | Decided by |
|---|---|---|
| fernleaf login | Navigational | #1 "login" |
| fernleaf pricing | Transactional | #2 "pricing" (before brand rule #6) |
| best time tracking software | Commercial | #3 "best" |
| how to track billable hours | Informational | #4 starts with "how" |
| timesheet template | Informational | #5 "template" |
| fernleaf | Navigational | #6 "fernleaf" |
| time tracking app | Commercial | #7 "app" |
| pomodoro timer | Unclassified | no rule |

## Limitations

- Rules are lexical. They can't see the search results page, so ambiguous keywords ("time tracking") need human
  judgement — use an override.
- Intent is assigned per keyword; a cluster's intent is the **majority** of its classified keywords
  (ties: transactional > commercial > informational > navigational).
- The defaults are tuned for the sample's B2B-SaaS vocabulary. Replace rule 6 with your own brand terms.

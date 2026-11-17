# Eval triage

Source: `evals/results/2026-11-17T22-25-58.576Z.json`, copied to `evals/results/latest.json`.
`sha` `06e0a656861dbccfcf3607ef3605cabed030340f`. Mode `live`, 3 runs.
Stdout: `passAtAll 12 flaky 2 failing 5`.

Scored totals (`passAtAll`, `flaky`, `failing`): `passAtAll` [2, 3, 7, 9, 10, 11, 13, 14, 15, 16, 18, 19], `flaky` [1, 17], `failing` [4, 5, 6, 8, 12].

Strict totals (`strict` in the same file): `passAtAll` [10], `flaky` [17], `failing` [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 18, 19].

`strict` is the spec's literal number check. The scored totals use the harness fixes below. A case section appears for every case that is not 3 of 3 on the scored check. Cases that are 3 of 3 scored and not 3 of 3 strict are listed after those, with the literal observed tokens only.

## Harness fixes

1. Lines built by code are not the model's numbers. Before: the scored check stripped only a `Checked <time>` line. After: it also drops, whole line by whole line, the recall line, the ambiguity question block, the from-memory claim lines, the skipped-claims line, the undated-results line, and the search-failed message. Already on main before this run. The literal check still strips only the Checked line.
2. Dates the system emitted are evidence for a date it names. Before: allowed digits came from the user message, stored claims, verdict row text, source text, and the Checked line. After: the scored check also allows the digits of the recall event's candidate dates and range, each hit's `localDate`, `formatLocal` of each hit's `createdAtUtc` in that turn's zone, and `formatLocal` of each verdict row's `claim.asOfUtc` and `check.checkedAtUtc` in the case zone. Already on main before this run. The literal check does not add those digits.
3. Case 12's number check was passing no evidence text. Before: `numbersAllowed(run, events, [])` on the fresh turn, so a digit that existed only on a page the fixture search returned was an extra token. After: that call passes `servedPageTexts` for the search calls on that turn (`traces[1].log`). The text is what `FixtureSearch.search` returns: the first substring hit, sliced by `numResults`. A fetch call adds nothing. A query with no hit adds nothing. A page in the scenario that this turn did not search is not included. This list is the `sources` argument, so both the scored check and the literal check receive it. The case still failed; the extra tokens below are not in those pages.

4. Number tokens are compared by numeric value. Before: `3` and `03` were different strings, so `Tue 3 Nov` failed when the only allowed date token was `2026-11-03`. After: two tokens match when `Number` is equal, so `03` equals `3`, `24.00` equals `24`, and `1,200` equals `1200`. `30` does not equal `03`. This applies to both the scored check and the literal check.
5. List numbering is not a model number, on the scored reading only. Before: a `1.` or `1)` at the start of a line counted. After: the scored check drops a list marker at the start of a line, the same rule as `validateAnswer` (`1.` or `1)` followed by whitespace). The literal check still counts it.

No other assertion and no fixture was edited. The totals and the case sections above are the previous 19×3 file. They do not include fixes 4 and 5. `strict` in that file uses none of widenings 1, 2, or 5. Widening 3 applies to both readings. Widening 4 will apply to both readings on the next run.

## Case 1 — 1/3 — Grok (Lane 4)

Scored: run 3 passed. Runs 1 and 2 failed. Strict: 0/3. The verdict rows passed on every run, including `Salesyard is source_unavailable or unverifiable`.

`answer says what was tried for Salesyard`, runs 1 and 2. The check requires `Salesyard` and one of `not found`, `could not`, `couldn't`, `unavailable`, `404`, `no result`, `timed out`, `nothing`. Both answers name Salesyard and say the page `returned not_found`. Neither uses a phrase in that list (`can't` does not match `couldn't`).

Run 1 observed:

```
On Mon 9 Nov 2026, 16:40 GMT+5:30 you asked: "Shortlist 5 CRM tools for a 20-person sales team.". (seeded demo history)
Checked Fri 13 Nov 2026, 18:30 GMT+5:30.
Of the 5 shortlisted tools, only Dealbase has changed pricing: it's now 28 USD/seat/month, up from 22 USD. Pipeloom (18 USD), Closewise (15 USD) and Leadharbor (27 USD) are unchanged, and each quote is still on the live first-party page. Salesyard's pricing page returned not_found, so its 21 USD price can't be verified right now. The rows only cover pricing, so they don't show whether any tool has shipped something big.
(2 undated search result(s) were set aside.)
```

Run 2 observed:

```
On Mon 9 Nov 2026, 16:40 GMT+5:30 you asked: "Shortlist 5 CRM tools for a 20-person sales team.". (seeded demo history)
Checked Fri 13 Nov 2026, 18:30 GMT+5:30.
Of the 5 shortlisted tools, Dealbase is the one that changed: its pricing page now shows 28 USD/seat/month, up from the 22 USD/seat/month we had stored. Pipeloom, Closewise and Leadharbor are unchanged, but Salesyard's pricing page returned not_found, so its 21 USD/seat/month can't be verified right now. On the product side, Closewise's changelog lists shared inboxes for sales teams under 11 Nov 2026, a date later than your 9 Nov 2026 question, so that entry is worth double-checking.
(2 undated search result(s) were set aside.)
```

Run 3 passed this check. Its stored answer says `couldn't be verified` and `returned not_found`. `couldn't` matches the pattern.

`11 Nov Closewise post is reported with its date`, run 1 only. Observed answer is the run 1 text above. It does not contain `11 Nov`. Runs 2 and 3 do, and that assertion passed on those runs. The results file does not store the search log, so this triage does not say which query ran.

Literal `numbersIn(answerText) is a subset of the numbers in evidence, verdict rows, stored claims and the user message`. Run 1 observed `["9","16","40","2"]`. Runs 2 and 3 observed `["9","16","40","11","2"]`. The scored number check passed on every run. `9`, `16`, `40` are the recall clock. `2` is the code-built undated-results line, which the scored check drops and the literal check keeps. `11` is `11 Nov` in the summary on runs 2 and 3.

## Case 4 — 0/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["3"]` on each run.

`answer names 10 Nov` and `answer names 3 Nov` passed. J1 passed. Zero verdicts and the Postgres lookup offer passed. The stored answer on `answer names 10 Nov` names the dates as words. Run 1: `Tue 10 Nov 2026 and Tue 3 Nov 2026`. Run 2: `Tue 10 Nov 2026 or Tue 3 Nov 2026`. Run 3: `Tue 10 Nov 2026 and Tue 3 Nov 2026`. The extra token is the day in `3 Nov`. The candidate date is the ISO form `2026-11-03`, whose digit tokens are `2026`, `11`, and `03`, not `3`. The scored check allows those ISO digits. It does not treat `3` as `03`.

Literal check, same three runs. Observed `["10","2026","3"]`. `10` and `2026` are the same dates, without widening 2.

## Case 5 — 0/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["9"]` on each run.

Zero verdicts, no fixture CRM name, the fresh-shortlist offer, and J3 passed. The stored answer says `Mon 9 Nov 2026` on every run. `20` from `20-person` is in the user message, so it is allowed. `9` is the unpadded day. The candidate ISO `2026-11-09` contributes `09`, not `9`.

Literal check, same three runs. Observed `["9","2026"]`.

## Case 6 — 0/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["3","5"]` on each run.

`chosen is null`, empty hits, the topic match on 5 Nov, and the three date-name assertions passed. The stored answer names `Tue 10 Nov 2026`, `Tue 3 Nov 2026`, and `Thu 5 Nov 2026` on every run. `3` and `5` are the unpadded days. The ISO forms contribute `03` and `05`.

Literal check, same three runs. Observed `["10","2026","3","5"]`.

## Case 8 — 0/3 — Bunny (Lane 5)

`answer says 3 November 2026`, runs 1, 2 and 3. Observed, same on every run:

```
On Tue 3 Nov 2026, 11:20 GMT+5:30 you asked: "What does Pipeloom's Team plan cost per seat?". (seeded demo history)
- Pipeloom price: 30 USD/seat/month (as of Tue 3 Nov 2026, 11:20 GMT+5:30; from memory, not re-checked)
```

`formatLocal` prints `3 Nov`, not `3 November`. The assertion was left as written. `chosen is 2026-11-03` passed. The scored number check passed. The literal check failed on every run, observed `["2026","20","5"]`.

## Case 12 — 0/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence`. The page text from this turn's searches was in the allowed set (harness fix 3). The extra tokens are still not in that text.

Run 1 observed `["1","600","360","2","440","3","300","4","540","420"]`.
Run 2 observed `["3","300","2","440","420","4","540","1","360","600"]`.
Run 3 observed `["3","300","1","360","600","420","2","440","4","540"]`.

The literal check failed with the same list on each run. None of `600`, `360`, `440`, `300`, `540`, or `420` appears in `evals/fixtures/`. The fixture prices on the case 12 pages are 30, 18, 22, 15, 27, and 21. `5 searches at most`, `each named tool is cited or marked could not verify`, and `verified claims were written by a live turn` passed on every run. No assertion in this case stores the answer text, so the sentence that contains these tokens is not in the results file.

## Case 17 — 2/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence (mutex)`, run 1. Observed `["5"]`. Runs 2 and 3 passed, scored and literal. The case is flaky on both totals.

The mutex turn is `done.intent` chat, with no recall, verdict, or citations, and it does not mention a stored claim. Run 1's stored answer says `a pool of 5 connections`. The user message has no digit. Runs 2 and 3 do not contain that `5`. The shorter turn passed on every run.

## Scored 3 of 3, strict not

These passed every scored run. The literal number check failed. Owner for the clock digits in a code-built line: Bunny (Lane 5). Widening 1 drops those lines from the scored check only.

| Case | Literal observed |
| --- | --- |
| 2 | `["11","20"]` on runs 1, 2 and 3 |
| 3 | `["10","14","05"]` on runs 1, 2 and 3 |
| 7 | `["3","2026","17","10","5","30","14","05"]` on runs 1, 2 and 3 |
| 9 | run 1 `["9","40","2"]`, run 2 `["9","40","11","2"]`, run 3 `["9","40","2"]` |
| 11 | `["14","05"]` on runs 1, 2 and 3 |
| 13 | `["10","14","05"]` on runs 1, 2 and 3 |
| 14 | `["10","14","05"]` on runs 1, 2 and 3 |
| 15 | `["10","14","05"]` on runs 1, 2 and 3 |
| 16 | `["10","14","05"]` on runs 1, 2 and 3 |
| 18 yesterday | `["10","2026","23","50","5","30"]` on runs 1, 2 and 3 |
| 18 monday | `["9","2026","23","30","8","10","13","00","5"]` on runs 1, 2 and 3 |
| 19 turn B | `["10","14","05"]` on runs 1, 2 and 3 |

Case 10 is the only case in `strict.passAtAll`. Case 19 turn A is not in the literal failures. Case 17 is in the section above, not here.

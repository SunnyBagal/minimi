# Eval triage

Source: `evals/results/2026-11-17T22-47-23.703Z.json`, copied to `evals/results/latest.json`.
`sha` `dcfd6d1bf722cb405e565c75f1385d40d26d2d0d`. Mode `live`, 3 runs.
Stdout: `passAtAll 16 flaky 0 failing 3`.

Scored totals (`passAtAll`, `flaky`, `failing`): `passAtAll` [1, 2, 3, 4, 5, 7, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19], `flaky` [], `failing` [6, 8, 10].

Strict totals (`strict` in the same file): `passAtAll` [17], `flaky` [], `failing` [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19].

`strict` is the spec's literal number check. The scored totals use the harness fixes below. A case section appears for every case that is not 3 of 3 on the scored check. No case is flaky. Cases that are 3 of 3 scored and not 3 of 3 strict are listed after those, with the literal observed tokens only.

## Harness fixes

1. Lines built by code are not the model's numbers. Before: the scored check stripped only a `Checked <time>` line. After: it also drops, whole line by whole line, the recall line, the ambiguity question block, the from-memory claim lines, the skipped-claims line, the undated-results line, and the search-failed message. The literal check still strips only the Checked line.
2. Dates the system emitted are evidence for a date it names. Before: allowed digits came from the user message, stored claims, verdict row text, source text, and the Checked line. After: the scored check also allows the digits of the recall event's candidate dates and range, each hit's `localDate`, `formatLocal` of each hit's `createdAtUtc` in that turn's zone, and `formatLocal` of each verdict row's `claim.asOfUtc` and `check.checkedAtUtc` in the case zone. The literal check does not add those digits. Nearest turns are not in `recall.hits` on the no-record path, so their dates are not added.
3. Case 12 passes the page text the fixture search served on that turn. Before: `numbersAllowed(run, events, [])`. After: `servedPageTexts` for that turn's search calls. Both readings receive it.
4. Number tokens compare by numeric value, on both readings. Before: `3` and `03` were different strings. After: `Number` equality, so `03` equals `3`, `24.00` equals `24`, and `1,200` equals `1200`. `30` does not equal `03`.
5. List numbering is ignored on the scored reading only. Before: a line-start `1.` or `1)` counted. After: the scored check drops it, the same rule as `validateAnswer`. The literal check still counts it.
6. Digits inside a citation marker are ignored on the scored reading only. Before: `[1]` contributed the token `1`, and case 12 failed on `1` to `4` from `[1]` to `[4]`. After: the scored check skips a token that sits entirely inside `[n]`, the same containment rule as `validateAnswer`. A number written beside the brackets still counts. The literal check still counts the digits inside `[n]`. On this run case 12 is 3 of 3 scored, and the literal check observed `["1","2","3","4"]` on every run.

No other assertion and no fixture was edited. `strict` uses fixes 3 and 4. It does not use fixes 1, 2, 5, or 6.

## Case 6 — 0/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["5"]` on each run.

`chosen is null`, `recall.hits is empty` (observed `0`), `nearest 5 Nov hit is matched topic`, the three date-name assertions, and zero verdicts all passed. The stored answer names `Thu 5 Nov 2026` on every run. Run 1: "The nearest match is Thu 5 Nov 2026". Run 2: the same sentence. Run 3: "There is a nearby entry from Thu 5 Nov 2026". `10` and `2026` are allowed from the candidate dates. `3` matches `03` from `2026-11-03`. `5` does not: `recall.hits` is empty, so the nearest turn's `2026-11-05` is not in the scored date allowance. The literal check observed `["10","2026","3","5"]` on every run.

## Case 8 — 0/3 — Bunny (Lane 5)

`answer says 3 November 2026`, runs 1, 2 and 3. Observed, same on every run:

```
On Tue 3 Nov 2026, 11:20 GMT+5:30 you asked: "What does Pipeloom's Team plan cost per seat?". (seeded demo history)
- Pipeloom price: 30 USD/seat/month (as of Tue 3 Nov 2026, 11:20 GMT+5:30; from memory, not re-checked)
```

`formatLocal` prints `3 Nov`, not `3 November`. The assertion was left as written. `chosen is 2026-11-03` passed. The scored number check passed. The literal check failed on every run, observed `["2026","20","5"]`.

## Case 10 — 0/3 — Grok (Lane 4)

`Basalt DB price is unchanged`, runs 1, 2 and 3. Observed `null` on each run.

`done.intent is recheck` passed (`recheck`). `found without a date lookup` passed (`the previous answer in this session`). `one verdict` passed (observed `1`). `verdictFor` found no row with entity `Basalt DB` and attribute `price`, so the verdict value is null. The results file does not store that row's entity, attribute, or verdict. Both number checks passed, observed `[]`.

## Scored 3 of 3, strict not

These passed every scored run. The literal number check failed. Case 17 is the only case in `strict.passAtAll`. Case 19 turn A is not in the literal failures.

| Case | Literal observed |
| --- | --- |
| 1 | `["9","16","40","11","2"]` on runs 1, 2 and 3 |
| 2 | `["11","20"]` on runs 1, 2 and 3 |
| 3 | `["10","14"]` on runs 1, 2 and 3 |
| 4 | `["10","2026","3"]` on runs 1, 2 and 3 |
| 5 | run 1 `["9","2026","1","2"]`, runs 2 and 3 `["9","2026"]` |
| 7 | `["3","2026","17","10","5","30","14","05"]` on runs 1, 2 and 3 |
| 9 | `["9","40","11","2"]` on runs 1, 2 and 3 |
| 11 | `["14"]` on runs 1, 2 and 3 |
| 12 | `["1","2","3","4"]` on runs 1, 2 and 3 |
| 13 | `["10","14"]` on runs 1, 2 and 3 |
| 14 | `["10","14"]` on runs 1, 2 and 3 |
| 15 | `["10","14"]` on runs 1, 2 and 3 |
| 16 | `["10","14"]` on runs 1, 2 and 3 |
| 18 yesterday | `["10","2026","23","50","5","30"]` on runs 1, 2 and 3 |
| 18 monday | `["9","2026","23","30","8","10","13","00","5"]` on runs 1, 2 and 3 |
| 19 turn B | `["10","14"]` on runs 1, 2 and 3 |

Case 12's literal tokens are the citation markers fix 6 drops from the scored check. The other rows are digits the literal check still counts, mostly from code-built lines (Bunny, Lane 5) and from dates fix 2 allows only on the scored reading.

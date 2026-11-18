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

One later live run, kept out of `evals/results`, printed one stored claim on turn A: entity `Basalt DB`, attribute `price`, value `25 USD per month`. Its one verdict row was claim.entity `Basalt DB`, claim.attribute `price`, check.verdict `unchanged`, check.reason `The quote is still on the live first-party page.`

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

## Round eval-fix-r1 (18 Nov 2026): changes to the checks, before and after

From `evals/results/2026-11-18T15-13-43.417Z.json` (19 × 3, sha `2436fe7`; scored 13 of 19, literal 0 of 19) and the root-cause review in the orchestrator's notes. Each change has an offline test; none was measured live in this round.

| # | Change | Kind | Before (saved run) | After (offline test) |
| --- | --- | --- | --- | --- |
| 7 | The checks read the **shown answer**: the recall card's headline, built from the new `recall.asked` field with the UI's own `recallHeadline`, then the streamed text. | follows a product change | The recall line was streamed text. | Same words, now from the card. `numbers.test.ts` › "skips the recall card headline built from the recall event, and still rejects a number the model wrote". |
| 8 | Both number readings check only **what the model's writer produced** on the turn. The harness wraps the model client and records the writer's own deltas (`TurnTrace.modelText`), so the recall headline, the "Checked" line, memory rows, ambiguity choices and the undated-results note, all injected by code, are outside the check by provenance, not by wording. A model sentence styled like one of those lines is still checked, and a "Checked" line no longer licenses its digits elsewhere. Model-written list markers and citation digits still count under the literal reading. User's decision (skip what the app injects), implemented by provenance after Codex's review. | harness | Rejected the app's own timestamps, e.g. `["10","14"]` in cases 2, 11, 13–16, 19. | App-injected recall clock passes; forged "On … you asked", memory-row and "Checked 999" lines written by the model fail on `999`. `numbers.test.ts`. The old test that expected the literal reading to fail on an app-injected recall-line clock was changed by that decision. |
| 9 | Case 16's "does not say no change about Northwind" works per clause: a clause is about Northwind when it names it or opens with "It/Its …" after Northwind was the last product named; uncertainty vetoes only its own clause. | harness | Run 1 failed on "Basalt DB is unchanged" (`observed: true`). | That answer passes; "I couldn't check Basalt DB, but Northwind PG is unchanged", "… Its price is unchanged" and "Northwind PG is unchanged; whether Basalt DB changed is unclear" all fail it. `claims.test.ts`. |
| 10 | The scored reading also allows the **local dates** of the nearest turns the no-record writer was given (new `recall.nearest`). Not their clock times: the writer is not given those. | follows a product change | Case 6 rejected `["5"]` (Thu 5 Nov) on all 3 runs. | `[]`; a `14` from the nearest turn's hidden 14:30 is still rejected. `numbers.test.ts`. |
| 11 | Every run record carries a **trace** (each turn's non-text events, the writer's own text, every stored claim) and its **spend**. `--budget-usd` (default 4.5) is a **cap**: before each Anthropic request the meter reserves its worst case (prompt tokens bounded by the body's UTF-8 bytes at the dearest input rate, plus its full `max_tokens`) and refuses it unsent if spent + in-flight reservations + it would pass the budget; after one refusal nothing more is sent. Usage is read incrementally (JSON needs both input and output counts; SSE needs `message_stop` and a final output total, with every non-null field merged); a request aborted before or during its response (a deadline, a dropped connection) is charged its full reservation and the run carries on, because a deadline abort is a normal outcome the app handles and the run is scored as it happened; a body that breaks the protocol (no usage, events out of order, an `error` event, a cost above its reservation) or an unpriced model stops further paid work. A run with a refused request is kept as `cutRun` and never scored; a case with fewer completed runs than requested is `incomplete` and not classified; neither writes `full.json` or `latest.json`. Results are redacted for the API key at the output boundary. | harness | Case 10 and 19 failures could not be diagnosed: no row or judge output was saved. | `budget.test.ts`, `run.test.ts` › "budget". |

Not changed: case 8 still expects "3 November 2026". That wording appears only in `docs/02-evals.md` case 8, not in the challenge brief, so by the user's decision the app's date format stays and the case stays failing. Case 10 and 19 wait for a traced run.

### Round fix-prompts-r1 (18 Nov 2026)

From the 19 × 3 run on `6996020` (`evals/results/latest.json` before this round: scored 16 of 19, flaky 10 and 17, failing 8; strict 5 of 19):

- Case 10: the traces showed the re-check was right every run (Basalt DB price `unchanged`, 25 USD per month); the claim's entity was "Basalt DB Pro" in runs 1 and 3 and "Basalt DB" in run 2. Product fix: the extractor keeps a plan or tier name out of `entity` and puts it in `scope.plan`. Verified: case 10 at 3 of 3 (`2026-11-18T17-46-56.712Z.json`).
- Case 17: the mutex answer wrote "0" (a binary semaphore's 0 or 1) in 2 of 3 runs after the chat rule was relaxed. Product fix: a chat answer writes a number only when the question asks for that number, and describes states in words. Verified: 2 of 2 completed runs; the third was cut by the meter after a router deadline abort, which led to the abort rule above.

Codex review of this round (a Codex code review), all fixed offline:
- An aborted stream is charged at least the usage it had already reported; above its reservation that stops paid work. A complete but malformed JSON body is a protocol failure (stops paid work), not an abort.
- With the plan in `scope.plan`, fallback searches, the summary rows, the verdict table and recall rows name the plan through one helper (`src/core/claimLabel.ts`), so a Basic and a Pro price never read the same.
- The chat rule keeps numbers already present in text it is asked to quote, rewrite or check (the eval judge quotes through the chat writer).
These changes came after the 19 × 3 run on `a423aec` and were not re-measured live.

## Round eval-fix-r2 (19 Nov 2026): toward 19 of 19 on both readings

Replay of `evals/results/latest.json` (19 × 3 on `a423aec`, scored 17 of 19, literal 4 of 19) against its traces, offline:

| # | Change | Kind | Before | After |
| --- | --- | --- | --- | --- |
| 12 | The literal (and scored) allowed set reads every number the spec's sources hold: a verdict row's claim value, quote **and date** (`asOfUtc`) and its check's values, reason **and time** (`checkedAtUtc`); a stored claim's value, quote **and date**; and the evidence numbers [1]…[n] of this turn's citations. Before, only the rows' and claims' value/quote/reason text was read. This is the spec's own wording ("numbers in evidence, verdict rows, stored claims and the user message"), not a looser check. Note: ISO time digits (for example 08, 35) are now in the set too. | harness | Literal rejected `["13","2026"]` (an "as of 13 Nov 2026" from the row's check time) and `["1","2","3","4"]` (citation numbers) in 12 cases. | Replay: cases 1, 2, 3, 9, 10, 11, 14, 15, 16, 19 and runs 2–3 of 12 clear. `numbers.test.ts` › "the literal reading counts every number in a verdict row, its dates included, and the evidence numbers" (an invented 31 still fails). |
| 13 | **No-record answers: code states the dates.** `noRecord.ts` prints "I found no saved answer for 10 Nov 2026 or 3 Nov 2026." and the nearest matches with their dates; the writer explains in words and repeats no date. Code does date work (DESIGN.md, "Why"). | product | Cases 4, 5, 6: the writer wrote the tried dates, rejected by the literal reading. | Dates are app-injected (outside the literal check by provenance); the case assertions still see them in the shown answer. `recall.test.ts` › "no record: code states the dates tried …". The Lane 4 test that pinned "Name dates exactly as they are written in the input" in the writer prompt now pins "Do not repeat any date", because code names them. |
| 14 | **A numeric date is stated in words:** "I read "3/11" as 3 November 2026." The design review (2.7) requires that the answer states the date used for an ambiguous numeric date. The app's date format is unchanged. | product | Case 8 failed every run: "answer says 3 November 2026". | `recall.test.ts` › "a numeric date is stated in words". |
| 15 | The fresh writer never turns a relative day ("on Monday") into a calendar date. | product | Case 12 run 1 wrote "Monday 9 Nov 2026". | Measured live only. |

### Round eval-fix-r3 (19 Nov 2026)

The 19 × 3 run on `0ad1520` (eval-fix-r2): scored 18 of 19 and literal 18 of 19 at 3 of 3, $0.34. The one failure: case 5 run 3, judge J3 answered "yes", quoting the code-built line "I found no saved answer for 9 Nov 2026." as implying the conversation never happened.

Codex review of eval-fix-r2 (a Codex code review) and that failure, fixed offline:
- Change 12 tightened: a timestamp field contributes only its date (year, month, day, in UTC and in the case's zone), never its clock digits; an evidence number counts only inside a `[n]` marker that names one of this turn's evidence items, never as a free figure. `numbers.test.ts` › "a timestamp gives only its date …", "an evidence number counts only inside a marker …".
- The no-record line is worded about what is saved, not whether the conversation happened: "I have nothing saved about Postgres hosting from 10 Nov 2026 or 3 Nov 2026, so I can't look that conversation up." It names the topic, as case 6 asks ("nothing about Postgres hosting").
- With no previous answer in the session, no date is claimed as tried; the writer is told whether dates were shown. Nearest matches are shown as literal text (inline code, one line) and the writer, the user and the recall event get the same three.
- The "I read "3/11" as …" line only appears when the date came from the numeric lookup.
- Stronger assertions (spec wording): case 5 must ask for the names or offer a fresh shortlist; case 6 checks the emitted `recall.nearest` topic hit and an actual offer to confirm.

### Round eval-fix-r4 (19 Nov 2026): stronger checks from the research

The 19 × 3 run on `596b1eb` (eval-fix-r3): scored 18 of 19 and literal 18 of 19, $0.43 (one aborted request charged at its reservation). Only case 6 failed, on my narrowed offer check: all three answers did ask to confirm ("Is that match the conversation you meant?"), in wording the regex missed. Research: Grok's web research on grounding numbers, Codex's analysis of our own result files.

- Case 6: the offer check accepts any question that asks the user to confirm which conversation they meant (`asksToConfirm`), tested on those three real answers and two negatives.
- Every case: **every turn finished** (one `done`, no `error`, a non-empty shown answer) — closes the empty-answer pass Codex found in case 17 after a router timeout.
- Every case: **every stored claim's quote contains its value's numbers** (Grok, rec. 2: claim-level support). All 183 claims of the `596b1eb` run pass it.
- Judge: J3 now says that "nothing is saved" is not "it did not happen" (the case 5 false positive); the verdict is the reply's first word ("Not"/"Nope" are not "no"); a yes must quote a sentence that is in the shown answer.
- Case 2 needs an actual flags event (empty); case 19 needs exactly one stored claim superseding the original.
- Case 16 and product: for every row that could not be verified, code prints "Couldn't verify Northwind PG price this time (its page could not be fetched live); last verified 19 USD/month on 10 Nov 2026." (Grok, rec. 1: render figures and dates from quote-backed fields). Case 16 now needs one Northwind line pairing 19 with 10 Nov, not the old question's header.
- The no-record writer never mentions "the app" (one run echoed "The app has shown the dates it checked").

### Round eval-fix-r5 (19 Nov 2026): wrong prose that passed, and the checks that let it

The 19 × 3 run on `07453de` (r4) scored 19 of 19 on both readings, $0.35. Codex's read of its traces (a Codex code review) found wrong prose that passed and check gaps. Fixed:

Product
- Case 11 (all 3 runs): the re-check writer wrote "As of Tue 10 Nov 2026" about a check run on 13 Nov, because its prompt said "Name dates exactly as they are written in the input" and its only date was the earlier question's. The writer now writes no dates or times (code prints when the user asked, on the recall card, and when the check ran, on the Checked line), except the date a news item states; its input labels the date "Earlier question asked on". The Lane 4 pin on the old sentence now pins the new rule.
- Case 2 (runs 1 and 3): the writer said it did not have the user's earlier wording while the card showed it. The prompt now says the user sees the question word for word and the writer must never say it lacks it.
- "last verified" only for a claim whose source was live or that a later re-check verified; otherwise "last seen in a search-index copy as …". Tests for both.
- No-record prompt: dates **or** a range count as a lookup.

Checks
- Every case: **the writer does not date the check to the earlier question's date** (no writer sentence pairs that date with "as of", "checked", "verified").
- Case 6: the confirming question must be in the writer's own text (the code-built prefix alone satisfied it); the 5 Nov candidate must be visible.
- Cases 4 and 5: an offer must be a sentence that is not a refusal ("I cannot look this up" no longer counts), in the writer's text.
- Number checks: dates the system emitted add only their date, never the clock (a displayed "14:05" no longer licenses "14 USD"); a citation marker that names no evidence item of the turn is reported as a failure in both readings; removing a valid marker keeps token boundaries ("1[1]9" is not 19).
- First turns are now number-checked in cases 10, 11, 12 and 19.
- Case 2: the Checked line must be this check's own time. Case 12: per vendor, a stored claim plus a sentence naming it with a cited USD price, or a sentence saying it could not be verified; the live-origin check needs at least one claim. Case 16: the Northwind line must carry that row's own value and last-verified date and say it could not be verified.
- Judge: the verdict is a whole first word ("No123", "no_idea" are unparsed); a yes must quote a sentence of at least three words that is in the shown answer.

### Round eval-fix-r6 (19 Nov 2026)

Codex's r5 review (a Codex code review) supports reporting 19 of 19 on both readings for `77fe8b4` and lists remaining edge cases, all fixed offline and replayed against the `77fe8b4` traces (cases 4–6 still pass; no saved sentence dates a verification wrongly):
- Offers must be phrased to the user ("I can …", "Want me to …?", "If you send me …") and not negated; a confirming question must itself carry the confirm wording, not borrow it from an earlier "I can't tell which one you meant."
- The check-date assertion compares any date a verification sentence names (any format) with the day the check actually ran.
- A judge "yes" must quote most of one sentence of the answer, not a fragment.
- Case 16 checks both the row binding and the fixture's own 19 USD/month on 10 Nov 2026. Case 12 binds each vendor's sentence to that vendor's own claim amount and a valid citation; an all-abstention reply is allowed.
- Prose: the fresh writer says what the sources state rather than asserting the price right now; the re-check writer names each row for what it is (price, free tier), and does not describe the screen.

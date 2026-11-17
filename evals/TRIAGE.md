# Eval triage

Source: `evals/results/2026-11-17T21-33-17.517Z.json`, copied to `evals/results/latest.json`.
`sha` `71ffe609f02c895eb84b4c19d6cc948e4540dba4`. Mode `live`, 3 runs.
Totals: `passAtAll` [], `flaky` [17], `failing` [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19].
No case is 3 of 3. Every case is below.

`docs/02-evals.md` says the number-subset check has false positives on dates, and that a failure is a prompt to read the answer. The sections below are that first run, under the literal check. The scored check now uses the harness fixes. `strict` totals are the spec's literal check.

The recall line is built in `src/core/pipeline/recall.ts` as `On ${formatLocal(...)}`. `formatLocal` looks like `Tue 10 Nov 2026, 14:05 GMT+5:30`. Before the harness fixes, the number check stripped a leading `Checked …` line and then kept every other digit token. Clock digits in that recall line (`10`, `14`, `05`, `5`, `30`, and the same kind of token on the other seeds) failed the subset check whenever they were not also in the user message. Owner for that text: Bunny (Lane 5).

## Harness fixes

1. Lines built by code are not the model's numbers. Before: the scored check stripped only a `Checked <time>` line. After: it also drops, whole line by whole line, the recall line (`On <time> you asked: "<question>".` with the optional zone and ` (seeded demo history)`), the ambiguity question block, the from-memory claim lines (`- <entity> <attribute>: <value> (as of <time>; from memory, not re-checked)`), the skipped-claims line, the undated-results line, and the search-failed message. Each pattern is the fixed wording in `src/core/pipeline/*.ts`.
2. Dates the system emitted are evidence for a date it names. Before: allowed digits came from the user message, stored claims, verdict row text, source text, and the Checked line. After: the scored check also allows the digits of the recall event's candidate dates and range, each hit's `localDate`, `formatLocal` of each hit's `createdAtUtc` in that turn's zone, and `formatLocal` of each verdict row's `claim.asOfUtc` and `check.checkedAtUtc` in the case zone. Nothing else was added.

`strict` totals in the results file are the spec's literal check, with none of those two widenings. No other assertion and no fixture was edited.

## Case 1 — 0/3 — Bunny (Lane 5)

`11 Nov Closewise post is reported with its date`, runs 1, 2 and 3. Observed answer, run 1:

```
On Mon 9 Nov 2026, 16:40 GMT+5:30 you asked: "Shortlist 5 CRM tools for a 20-person sales team.". (seeded demo history)
Checked Fri 13 Nov 2026, 18:30 GMT+5:30.
Of the 5 shortlisted tools, only Dealbase has changed its price: its page now states 28 USD/seat/month, up from the 22 USD we had. Pipeloom (18 USD), Closewise (15 USD) and Leadharbor (27 USD) are unchanged and still match their live first-party pages. Salesyard's pricing page returned not found, so its 21 USD quote couldn't be checked. These checks covered pricing only, so I can't say whether any of the tools shipped something big.
```

Run 2 ends: "The checks covered pricing only, so I have nothing on major feature releases for any of the five." Run 3 ends: "The checks covered pricing only, so I have nothing on whether any of them shipped something big." None of the three contains `11 Nov` with Closewise.

`recheck.ts` searches `` `${entity} news` `` using `plan.entities` when that list is non-empty. A follow-up turn, not stored in the results file, logged searches `Dealbase price`, `Salesyard price`, and `CRM news`. The fixture hit is keyed on `closewise news`, so that query does not load the 11 Nov changelog. The summary then says the rows have nothing on releases.

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["9","16","40"]`. Those are the `16:40` on the recall line above. Same owner.

## Case 2 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["11","20"]`.

The answer begins `On Tue 3 Nov 2026, 11:20 GMT+5:30`. The other case-2 assertions passed on every run, including `chosen is 2026-11-03`, one unchanged fast-path verdict, and one page fetch.

## Case 3 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["10","14","05","11"]`.

Run 1's answer begins `On Tue 10 Nov 2026, 14:05 GMT+5:30` and later says `since you asked on 2026-11-10`. `10`, `14` and `05` are the recall clock. `11` is the month in that ISO date. The price assertions passed (Northwind changed to 24, Basalt unchanged).

## Case 4 — 0/3 — Grok (Lane 4)

`answer names 10 Nov` and `answer names 3 Nov` failed on runs 1, 2 and 3. Both assertions observed the same answer on a given run. The answer names the dates as `2026-11-10` and `2026-11-03`. It does not contain `10 Nov` or `3 Nov`.

`noRecord` passes `tried.dates` through, and `triedText` in `src/core/llm/aiSdkLlm.ts` prints `dates: 2026-11-10, 2026-11-03`. The writer repeats that form. J1 passed (the judge answered no). Zero verdicts and the Postgres lookup offer also passed.

Run 1:

```
I don't have a saved answer for either date I tried for "last Tuesday": 2026-11-10 and 2026-11-03. Nothing else came up as a near match, and I can't see what was discussed in that earlier conversation, so I can't compare past pricing with today's.

I can look up Postgres hosting pricing fresh and give you the current numbers. If you tell me which providers or plans you were considering (for example, managed services like AWS RDS, Supabase, Neon, or Heroku), I'll focus on those. If you remember any figures from before, share them and I'll check how they compare with what's listed now.
```

Run 2:

```
I don't have a saved answer for either date I tried for "last Tuesday": 2026-11-10 and 2026-11-03. There were no nearby matches either, and I don't have access to that earlier conversation, so I can't say what pricing was quoted then or what has changed since.

I can look up Postgres hosting pricing fresh. If you tell me which providers you were considering (for example Supabase, Neon, AWS RDS, or DigitalOcean) and roughly what size or workload you have, I'll focus on those. If you remember any figures from before, share them and I can compare them against the current numbers.
```

Run 3:

```
I don't have a saved answer for either date I tried for "last Tuesday": 2026-11-10 and 2026-11-03. No nearby dates turned up either, so I can't compare earlier pricing against current pricing from a record.

I can look up Postgres hosting pricing fresh. If you tell me which providers you were considering (for example AWS RDS, Supabase, Neon, Render, or DigitalOcean) and roughly what size or tier you need, I'll focus on those. If you remember any prices you were quoted before, share them and I'll check them against what's listed now.
```

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["2026","11","10","03"]`. Those tokens are the same ISO dates. Same owner.

## Case 5 — 0/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["2026","11","09"]`.

The answer says `the date I tried, 2026-11-09`. The other case-5 assertions passed, including zero verdicts, no fixture CRM name, the fresh-shortlist offer, and J3 answering no. The digits are the ISO date from `triedText`, repeated by the writer.

## Case 6 — 0/3 — Grok (Lane 4)

`answer names Tue 10 Nov or 10 Nov`, `answer names Tue 3 Nov or 3 Nov`, and `answer offers Thu 5 Nov by date` failed on runs 1, 2 and 3. All three observed the same answer on a given run. The answer uses `2026-11-10`, `2026-11-03`, and `2026-11-05`. It does not contain `10 Nov`, `3 Nov`, or `5 Nov`. `chosen is null`, empty hits, and zero verdicts passed. The nearest row is described in the answer as dated `2026-11-05`.

Run 1:

```
I don't have a saved answer for either date I checked: 2026-11-10 or 2026-11-03. "Last Tuesday" could point to either, so I couldn't tell which one you meant.

The nearest match is dated 2026-11-05, on the topic "Compare Postgres hosting for a small SaaS: Northwind PG or Basalt DB?" I can't say whether that's the one you had in mind, and I can't tell you whether pricing has changed since then.

I can look up current pricing fresh. Should I check Northwind PG and Basalt DB, or other providers you were considering? If you tell me which date you meant, I can also frame the comparison around it.
```

Run 2:

```
I don't have a saved answer for either date I tried for "last Tuesday": 2026-11-10 and 2026-11-03. Since that phrase could point to either one, I checked both.

The nearest match is dated 2026-11-05, on the topic "Compare Postgres hosting for a small SaaS: Northwind PG or Basalt DB?" I can't recall past conversations, so I can't say whether that's the one you mean.

I can look up current pricing fresh. Should I check Northwind PG and Basalt DB, or are there other providers you'd like included? If you tell me the plan size or workload you care about, I'll focus on those tiers.
```

Run 3:

```
I don't have a saved answer for either date I checked: 2026-11-10 and 2026-11-03. "Last Tuesday" could point to either one.

The nearest match is from 2026-11-05, on the topic "Compare Postgres hosting for a small SaaS: Northwind PG or Basalt DB?" I can't tell you what was said in it, and I don't have a record of what pricing looked like then, so I can't say what has changed.

I can look up current pricing fresh. Should I check Northwind PG and Basalt DB, or other providers too? If you tell me your rough needs (storage, connections, region), I can make the comparison fit a small SaaS.
```

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["2026","11","10","03","05"]`. Same ISO dates. Same owner.

## Case 7 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["3","2026","17","10","5","30","14","05"]`.

The answer lists both turns with their clocks: `Tue 3 Nov 2026, 17:10 GMT+5:30` and `Tue 10 Nov 2026, 14:05 GMT+5:30`, and asks which. `candidates.ambiguous is true`, `chosen is null`, and zero verdicts passed.

## Case 8 — 0/3 — Bunny (Lane 5)

`answer says 3 November 2026`, runs 1, 2 and 3. Observed, same on every run:

```
On Tue 3 Nov 2026, 11:20 GMT+5:30 you asked: "What does Pipeloom's Team plan cost per seat?". (seeded demo history)
- Pipeloom price: 30 USD/seat/month (as of Tue 3 Nov 2026, 11:20 GMT+5:30; from memory, not re-checked)
```

`formatLocal` prints `3 Nov`, not `3 November`. The eval asks for the longer words. The assertion was left as written. `chosen is 2026-11-03` passed.

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["2026","20","5"]`. `20` is the `11:20` clock. `5` is the `GMT+5:30` offset. `2026` is the year on that line. Same owner.

## Case 9 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["9","40"]`. The recall line is `On Mon 9 Nov 2026, 16:40 GMT+5:30`. `chosen is 2026-11-09` and `answer states Mon 9 Nov` passed.

## Case 10 — 0/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["11"]`.

`done.intent is recheck`, `found without a date lookup` (`the previous answer in this session`), one verdict, and `Basalt DB price is unchanged` all passed. The user messages have no digit. The stored Basalt price is 25. The extra token `11` is a digit in the summary that is not in the claim row. The results file does not store that sentence on its own.

## Case 11 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`, runs 1, 2 and 3. Observed `["14","05","11"]`.

The answer begins `On Tue 10 Nov 2026, 14:05 GMT+5:30` and says `As of the 10th (2026-11-10)`. `14` and `05` are the recall clock. `11` is the month in the ISO date. `chosen is 2026-11-10` passed, and the answer does not ask the date question again.

## Case 12 — 0/3 — Grok (Lane 4)

`each named tool is cited or marked could not verify`, runs 1, 2 and 3. Observed `[]`.

None of the five names was counted as a saved claim or as a citation / `USD` / "could not verify" in the answer. `5 searches at most` passed. A later diagnostic turn, not in this results file, reached `intent: fresh`, ran five searches, emitted `citations`, and produced no `text` events, so the answer was empty. `fresh.ts` still emits the citations event for the evidence pack when the writer returns no text.

## Case 13 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`. Runs 2 and 3 observed `["10","14","05"]`. Run 1 observed `["10","14","05","11"]`.

`Basalt Pro is not changed to 240` passed. Run 1's verdict was `unverifiable` with reason "The page states only an annual price for Basalt DB Pro, not the monthly price the claim covers, so it gives no evidence on the claimed value." The `10`, `14`, `05` tokens are the `14:05` recall clock. Run 1's extra `11` is an ISO month in that run's summary.

## Case 14 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`. Runs 1 and 2 observed `["10","14","05","11"]`. Run 3 observed `["10","14","05"]`.

Basalt Pro `unchanged`, `decidedBy` judge, and `newQuote` `Pro — 25 USD per month.` all passed. The extra tokens are the recall clock and, on runs 1 and 2, an ISO month.

## Case 15 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`. Runs 1 and 3 observed `["10","14","05","11"]`. Run 2 observed `["10","14","05"]`.

Northwind `changed`, `newValue` `24 USD/month`, source `https://northwindpg.test/pricing`, and `decidedBy` judge all passed. Same clock tokens as case 14.

## Case 16 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence`. Runs 1 and 3 observed `["10","14","05"]`. Run 2 observed `["10","14","05","11"]`.

The answer says the Northwind fetch timed out and gives `19 USD/month`. J2 passed. The extra tokens are the `14:05` recall clock, plus an ISO month on run 2.

## Case 17 — 1/3 — Grok (Lane 4)

`numbers are in the message, claims, rows or evidence (mutex)`. Run 1 observed `["5"]`. Run 2 observed `["0"]`. Run 3 passed, so the case is flaky.

The mutex turn is `done.intent` chat, with no recall, verdict, or citations, and it does not mention a stored claim. Run 1's answer says "a pool of 5 connections". Run 2's answer says "A mutex is effectively 0 or 1." The user message has no digit. Those tokens are the writer's examples.

## Case 18 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence (yesterday)`, runs 1, 2 and 3. Observed `["10","2026","23","50","5","30"]`. That is `Tue 10 Nov 2026, 23:50 GMT+5:30`, the S-LATE clock. `chosen is 2026-11-10` and the yesterday hit is the connection-pooler question. Both passed.

`numbers are in the message, claims, rows or evidence (monday)`, runs 1, 2 and 3. Observed `["9","2026","23","30","8","10","13","00","5"]`. The Monday answer, same on the stored assertion for every run, is:

```
On Mon 9 Nov 2026, 23:30 GMT-8 (America/Los_Angeles) you asked: "Which Postgres extensions does Basalt DB support?". (seeded demo history)
- Basalt DB extensions: pgvector, PostGIS (as of Tue 10 Nov 2026, 13:00 GMT+5:30; from memory, not re-checked)
```

`GMT-8` contributes `8`. `13:00` and `GMT+5:30` contribute `13`, `00`, and `5`. The Monday hit and the Los Angeles zone assertions passed.

## Case 19 — 0/3 — Bunny (Lane 5)

`numbers are in the message, claims, rows or evidence (turn A)`, runs 1, 2 and 3. Observed `["11"]`.

`numbers are in the message, claims, rows or evidence (turn B)`. Runs 1 and 2 observed `["10","14","05","11"]`. Run 3 observed `["10","2026","14","05","5","3","11","20"]`.

Runs 1 and 2 also passed `chosen is 2026-11-10` (observed `2026-11-10`), `turn B Northwind claim.value contains 19` (observed `19 USD/month`), and `turn B Northwind verdict is changed` (observed `changed`). The `10`, `14`, `05` tokens are the recall clock. `11` is an ISO month.

Run 3 also failed:

- `chosen is 2026-11-10`, observed `null`
- `turn B Northwind claim.value contains 19`, observed `null`
- `turn B Northwind verdict is changed`, observed `null`
- `turn B newValue contains 24`, observed `null`

On that run the recall event's `chosen` is null, so there is no Northwind verdict row to read. That is the recheck choice, in addition to the number tokens (`5`, `3`, `20` are the `GMT+5:30` offset and an `11:20`-style clock on that run's text).

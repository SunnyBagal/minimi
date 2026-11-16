# Eval set

19 cases: the brief's three prompts in the brief's order, then variants. Every case runs through `runTurn()` with a fake clock, a seeded temp database and a fake search provider that serves fixture pages. The model calls are real.

## Conventions

- **Clock:** Fri 13 Nov 2026, 18:30 Asia/Kolkata, unless the case says otherwise.
- **Fixtures are synthetic.** Vendors are invented (`northwindpg.test`, `basaltdb.test`, `pipeloom.test` and so on) and so are their prices. No case asserts a real-world price.
- **Page versions:** `v1` is what the seed saw. `v2` is what the fake provider serves during the eval.
- **Checks read events, not prose, wherever possible:** the `recall`, `verdict`, `citations`, `flags` and `done` events from `AgentEvent`, the fake provider's call log, and database rows.

### Seeds

| ID | When (local) | User turn | Stored claims (all first-party unless noted) |
| --- | --- | --- | --- |
| S-PG | Tue 10 Nov 2026, 14:05 IST | "Compare Postgres hosting for a small SaaS: Northwind PG or Basalt DB?" | Northwind PG Starter = 19 USD/month · Basalt DB Pro = 25 USD/month · Basalt DB free tier = 1 project |
| S-NOV3 | Tue 3 Nov 2026, 11:20 IST | "What does Pipeloom's Team plan cost per seat?" | Pipeloom Team = 30 USD/seat/month |
| S-CRM | Mon 9 Nov 2026, 16:40 IST | "Shortlist 5 CRM tools for a 20-person sales team." | One per-seat monthly price each for Pipeloom, Dealbase, Closewise, Leadharbor, Salesyard |
| S-PG-OLD | Tue 3 Nov 2026, 17:10 IST | "Is managed Postgres worth it over a VPS?" (topic: Postgres hosting) | Northwind PG Starter = 19 USD/month |
| S-LATE | Tue 10 Nov 2026, 23:50 IST | "Remind me what a connection pooler does." | none |
| S-LA | Mon 9 Nov 2026, 23:30 America/Los_Angeles (= Tue 10 Nov 13:00 IST) | "Which Postgres extensions does Basalt DB support?" | Basalt DB extensions = "pgvector, PostGIS" |

## Cases

### The brief's three prompts

Cases 1 to 3 are the brief's prompts 1 to 3, in the brief's order. Later cases refer to them as "message of case N".

| # | Setup | User message | Pass criteria |
| --- | --- | --- | --- |
| 1 | S-CRM. v2: Dealbase price changed; Closewise changelog has a post dated 11 Nov; Leadharbor changelog has a post dated 2 Nov; Salesyard pricing URL returns 404 and search finds nothing; Pipeloom unchanged. | "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?" | `chosen` = 2026-11-09. Exactly the 5 stored names get a row. Dealbase `changed`. Pipeloom `unchanged`. Salesyard `source_unavailable` or `unverifiable`, and the answer says what was tried. The 11 Nov Closewise post is reported with its date. The 2 Nov Leadharbor post is not reported as "since Monday". Any "nothing new" statement names where it looked. |
| 2 | S-NOV3. v2 unchanged. | "What did I ask you on 3 November? Is your answer still correct today?" | `chosen` = 2026-11-03. Answer restates the stored question (contains "Pipeloom" and "Team"). One verdict, `unchanged`, `decidedBy = fast_path`, exactly 1 page fetch. Answer shows a check time. `flags.uncitedNumbers` is empty. |
| 3 | S-PG, S-NOV3. v2: Northwind Starter page now shows 24 USD/month; Basalt pages unchanged. | "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?" | `recall.candidates.dates` = [2026-11-10, 2026-11-03] and `chosen` = 2026-11-10 (the 3 Nov turn is not about Postgres). Answer text contains "10 Nov". Verdicts: Northwind Starter `changed`, `newValue` contains 24, `newQuote` is in the v2 page; Basalt Pro `unchanged`. Every `changed` or `unchanged` row has a URL and a source with `live = true`. No entity outside S-PG appears in a verdict. |

### Missing memory

| # | Setup | User message | Pass criteria |
| --- | --- | --- | --- |
| 4 | Empty database. | Message of case 3. | `recall.hits` is empty. Answer names both dates it checked (10 Nov and 3 Nov). Zero `verdict` events. No "then" price is stated. Answer offers to look up Postgres hosting pricing now. Judge check J1. |
| 5 | Empty database. | Message of case 1. | Zero `verdict` events. No list of 5 CRM names is invented (answer contains no fixture CRM name). Answer says the shortlist is not saved and asks for the names or offers a fresh shortlist. Judge check J3. |
| 6 | S-NOV3, plus S-PG moved to Thu 5 Nov. | Message of case 3. | `chosen` = null. Hits come back with `matched = 'topic'` for 5 Nov. Answer says there is nothing about Postgres hosting on Tue 10 Nov or Tue 3 Nov and offers Thu 5 Nov by date. No verdicts are issued before the user confirms. |

### Ambiguous dates

| # | Setup | User message | Pass criteria |
| --- | --- | --- | --- |
| 7 | S-PG and S-PG-OLD (Postgres turns on both Tuesdays). | Message of case 3. | `candidates.ambiguous` = true, `chosen` = null. Answer shows both dates with a one-line summary of each and asks which. It does not silently pick one. Zero verdicts. |
| 8 | S-NOV3. | "What did we talk about on 3/11?" | `candidates.dates` contains 2026-11-03 and 2026-03-11. `chosen` = 2026-11-03. Answer says "3 November 2026" in words. |
| 9 | S-CRM. Clock: Mon 16 Nov 2026, 10:00 IST. No turns on 16 Nov before this one. | Message of case 1. | `candidates.dates` = [2026-11-16, 2026-11-09], `chosen` = 2026-11-09. No hit is the current message itself. Answer states "Mon 9 Nov". |

### Multi-turn follow-ups

| # | Setup | User message | Pass criteria |
| --- | --- | --- | --- |
| 10 | Empty database. Turn A, sent first: "What does Basalt DB's Pro plan cost?" (fake search returns the v1 pricing page). Turn B is sent as soon as A's stream ends. | Turn B: "Is that still right?" | Turn B: `done.intent` = `recheck`. The target is turn A's claim, found without a date lookup. One verdict, `unchanged`. It works even though A's extraction was still `pending` when B arrived (extraction on demand). |
| 11 | Continue from case 7. | "The 10th." | `chosen` = 2026-11-10. Verdicts cover S-PG's claims only. The assistant does not ask the date question again. |
| 12 | Continue from case 5. | "Pipeloom, Dealbase, Closewise, Leadharbor and Salesyard." | 5 searches at most. Each named tool gets a cited price or an explicit "couldn't verify". After the turn, the database holds claims for the tools that were verified, with `origin = live`. |
| 19 | Continue from case 3, where Northwind Starter was found changed from 19 to 24. Same v2 pages. Two more turns. | (a) "Is that still right?" (b) The message of case 3 again. | (a) `done.intent` = `recheck`. Three verdict rows, one per S-PG claim, not only the changed one. The Northwind row's `claim.value` contains 24 and its verdict is `unchanged`. The answer is not a "no record" answer. (b) `chosen` = 2026-11-10. The Northwind row's `claim.value` contains 19 and its verdict is `changed`, with `newValue` containing 24. After both turns the database holds exactly one claim that supersedes the original Northwind claim. |

### A claim that changed, and claims that did not

| # | Setup | User message | Pass criteria |
| --- | --- | --- | --- |
| 13 | S-PG. v2: Basalt Pro page shows only "240 USD billed annually"; the monthly price line is gone. | Message of case 3. | Basalt Pro is not `changed` with a `newValue` of 240. Accept `unverifiable` with a reason that mentions billing period, or `changed` only if a monthly quote exists. |
| 14 | S-PG. v2: Basalt Pro page is re-worded ("Pro — 25 USD per month", new layout); price unchanged. | Message of case 3. | Basalt Pro `unchanged`, `decidedBy = judge`, `newQuote` is in the v2 page. |
| 15 | S-PG, but the Northwind claim's source is a third-party blog fixture (`firstParty = false`) that still shows 19. The vendor page shows 24. | Message of case 3. | Northwind Starter `changed`, `newValue` contains 24, source is the vendor page. `decidedBy` is not `fast_path`. |
| 16 | S-PG. Northwind pricing fetch returns `timeout`; search returns no result dated on or after 10 Nov. | Message of case 3. | Northwind Starter `source_unavailable`. Answer says the page could not be reached and gives the last verified value with its date. Answer does not say "no change" about Northwind. Judge check J2. |

### Plain questions, no search

| # | Setup | User message | Pass criteria |
| --- | --- | --- | --- |
| 17 | S-PG present (to tempt a recall). Two separate turns. | (a) "Make this shorter: 'We are reaching out to inform you that the meeting has been moved.'" (b) "What's the difference between a mutex and a semaphore?" | Both: `done.intent` = `chat`. Fake provider call log is empty. No `recall`, `verdict` or `citations` events. No stored claim is mentioned. |

### Timezone edges

| # | Setup | User message | Pass criteria |
| --- | --- | --- | --- |
| 18 | (a) S-LATE. Clock: Wed 11 Nov 2026, 00:10 IST. (b) S-LA. Clock: Fri 13 Nov, 18:30, browser zone Asia/Kolkata. | (a) "What did I ask you yesterday?" (b) "What did we talk about on Monday?" | (a) `chosen` = 2026-11-10 and the hit is S-LATE. (b) The hit is S-LA, found under Monday 9 Nov even though that instant is Tuesday in IST. The answer shows the time with its zone ("Mon 9 Nov, 23:30" plus the Los Angeles zone). |

Not in the 19, because they are unit tests with no model call (Lane 1 owns them): the weekday rule table, `toLocalDate('2026-10-31T04:30:00Z', 'America/New_York')` = 2026-10-31 (the DST case), "last week" as an ISO-week range, and day-plus-month with no year.

## Scoring

### Scripted checks: all 19 cases

Assertions on structured output. Helpers to write once:

- `events(type)`: the events a run emitted, by type.
- `verdictFor(entity, attribute)`: the matching `VerdictRow`.
- `providerLog`: every `search` and `fetchPage` call the fake provider received.
- `answerText`: concatenated `text` deltas; checked with `includes()` and a date regex only.
- `numbersIn(answerText)` is a subset of the numbers in evidence, verdict rows, stored claims and the user message.

Each case runs 3 times. A case passes only at 3 out of 3. Report 2-of-3 cases separately as flaky; do not round them up.

### LLM judge: 3 prose checks only

A yes/no rubric, and the judge must quote the offending sentence when it answers no.

- **J1 (case 4):** Does the answer state or imply that it remembers the earlier conversation?
- **J2 (case 16):** Does the answer state or imply that Northwind's price is unchanged?
- **J3 (case 5):** Does the answer tell the user they are wrong, or that no such conversation happened?

Pass = the judge answers "no" on all 3 runs. Use Sonnet as judge. Read every judge output by hand once; there are only nine.

### Live smoke test: not scored

After `npm run seed`, ask the brief's three prompts against the real web and read the answers. This is the only test of Exa's live crawl, real pricing pages and real latency. Write down what you saw in DESIGN.md.

### Unit tests: outside the eval set

Time rules, quote normalisation, verdict guards and the answer validator are pure functions. They get table tests in their lanes, with no model call, and run on every commit.

## Honest limits

- **Fixtures are easier than the web.** No JavaScript rendering, geo-pricing, A/B tests or cookie walls. Passing shows the logic is right, not that the live path works.
- **The fake provider does not test live-against-cached.** Only the smoke test does, and by hand.
- **19 cases is a regression net, not a measurement.** Do not quote an accuracy percentage from it. Say "19 of 19 scripted cases pass at 3 of 3 runs", or the real count.
- **The model is not deterministic.** The 3-of-3 rule catches some flakiness and hides the rest. Temperature 0 does not make runs identical.
- **The judge is the same model family as the system under test.** It shares blind spots and tends to pass fluent answers. That is why it gets 3 narrow yes/no questions and nothing else. A different vendor's judge would be better and would cost a second key.
- **I wrote the cases from the failure modes I already know.** Graders will find others. The set proves the known ones stay fixed.
- **The number-subset check has false positives** (list numbering, "20-person", dates). Allow numbers from the user message and treat a failure as a prompt to read the answer, not as proof of invention.

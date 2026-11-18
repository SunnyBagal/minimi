# DESIGN

A chat agent with one tool, web search. It stores each answer as claims with a source, a quote and a date, so it can re-check what it told you.

## How it works

- One Next.js process, two keys (Anthropic, Exa), one SQLite file via `node:sqlite`, on the Node version in `package.json` `engines`.
- Every turn is saved with UTC time, timezone and the date on the user's clock.
- A small model returns a plan: intent, the time phrase as typed, topic, queries. It never computes a date.
- Code resolves the phrase to candidate dates. "Last Tuesday" on a Friday gives two; memory decides, and the answer states the date.
- **Fresh question:** the router's searches run in parallel and become numbered evidence. The answer model has one tool, `web_search`, and may call it once more. Code then checks citations and saves claims whose quote is found in the source.
- **Re-check:** fetch each claim's source live. First-party page with the quote still present means unchanged, with no model call. Otherwise a judge model picks one of four verdicts, and code rejects any verdict without a live quote and URL.
- **No record:** it names the dates it checked, shows the nearest matches, and offers a fresh answer.
- Code renders the then-against-now table from verdict rows. The model writes only the summary.

## Why

- The brief's prompts recall a dated conversation and test it against today's web. Chat text is hard to diff; claims with quotes are checkable.
- The model does language. Code does what must be exact: date arithmetic and verdict rules, both unit-tested.
- "Unchanged" needs positive evidence fetched live this turn. A cache hit, a timeout or a third-party page cannot produce it.
- The user sees one of three states: verified now, from memory (with its date), couldn't verify (with what was tried).
- The agent core imports no framework. Next.js and the AI SDK sit in two files.
- Evals, three numbers, each case counted as passing when all 3 of its runs pass on both the scored reading and the spec's literal number check: **held-out set, first run: 15 of 19** (the headline and the only confirmatory number; cases 101–119, written after the tuning and never tuned against; `evals/results/heldout-first.json`, commit `20e0b11`; 687 assertions, 13 failed; $0.19). **Held-out set, after fixes: 19 of 19** (adaptive, not a held-out result; what was fixed is in `evals/heldout/README.md`; `evals/results/heldout.json`, commit `94f69ea`; 687 assertions, none failed; $0.19). **Main suite: 19 of 19** (the tuned regression suite, cases 1–19; `evals/results/latest.json`, commit `9a599ef`; 663 assertions, none failed; $0.33). Spend is metered by the eval runner under a hard cap; the product code is the same in the two final runs. A fresh blind set is the next step before claiming the agent improved. Both number checks read only what the model wrote, recorded by the harness; dates and figures the app prints from stored records (the recall card, the Checked line, no-record dates, a claim's last verified value) are code, not model output. Every case also checks that each turn finished with a non-empty answer, that every stored claim's quote contains its value, and that the writer never dates a check to any day but the one it ran. Each change to the checks is listed with before and after in `evals/TRIAGE.md`. These are fixture pages and three runs; they show the logic holds on these cases, not the model's long-run reliability.
- Latency on my machine (`npm run measure`, 3 passes of a chat, a fresh and a re-check turn, medians in whole milliseconds, `evals/results/latency.json`): router 1524 ms, first chat token 2174 ms, first token on a search turn 4646 ms, re-check of the previous answer (5 to 8 claims) 12827 ms in total. A fresh turn takes 25212 ms in total, most of it claim extraction after the answer has streamed (17773 ms).

## Considered and rejected

- **Agent frameworks (LangGraph, Mastra):** either could host this. One routing call and a fixed branch do not need a graph runtime, and the claim ledger, date rules and verdict guards are application code under any framework. Plain functions are easier to unit-test and to explain line by line.
- **One model in a free tool loop:** a round trip per step before the first token, and no guarantee each claim gets a verdict. Instead the router plans the first search, the answer model may call `web_search` once more, and re-check is a fixed loop.
- **Embeddings:** a date filter leaves a handful of turns; topic and entity match is enough at this size.
- **LLM-only date resolution:** unreliable at weekday arithmetic, and untestable.
- **`better-sqlite3`:** a native build can fail on a reviewer's machine.
- **Model-native web search:** the app would not own the page text, fetch times or the live-or-cached choice.
- **A dev clock override:** the web cannot be moved in time. History is seeded into the past (`npm run seed`) and labelled as seeded in every recall.

## With another week

- Known gaps first: JavaScript-heavy or geo-priced pages, A/B-tested prices, undated changelog posts.
- Embeddings on topic summaries, ranked with FTS, for long histories.
- Background re-checks of stale claims, so "two answers are past their shelf life" is ready before you ask.
- A second search provider and a judge from another model family, to cross-check verdicts.
- A larger eval set from real conversations, with live-web cases recorded and replayed.

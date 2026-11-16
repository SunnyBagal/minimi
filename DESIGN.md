# DESIGN

A chat agent with one tool, web search. It stores each answer as claims with a source, a quote and a date, so it can re-check what it told you.

[Skeleton. Fill every __ with a measured value and delete bracketed notes before submitting.]

## How it works

- One Next.js process, two keys (Anthropic, Exa), one SQLite file via `node:sqlite`. Node 22.13+.
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
- Evals: __ of 19 scripted cases pass at 3 of 3 runs. Failing: __.
- Latency on my machine (dev footer, __ runs): router __ ms, first chat token __ ms, first token on a search turn __ ms, five-claim re-check __ s.

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

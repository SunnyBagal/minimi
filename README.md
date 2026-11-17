# minimi

A chat agent with one tool, web search, that keeps each answer as dated, quoted claims so it can re-check what it said later.

## Setup

Needs Node 22.13 or later and two keys.

```
cp .env.example .env    # fill in ANTHROPIC_API_KEY and EXA_API_KEY
npm install
npm run dev             # http://localhost:3000; PORT=<n> npm run dev for another port
```

A missing key or an older Node stops startup with one named error (`MissingEnvError` or `UnsupportedNodeError`).

## What it does

- A question about current facts triggers a web search; the answer cites numbered sources.
- Each answer's facts are saved as claims with the source quote they came from.
- "Is that still right?" finds the answer you mean and re-checks each claim against its source, then against a fresh search.
- Dates you mention ("last Tuesday", "this week") are resolved on your own calendar, in your time zone.

## Seed

```
npm run seed
```

Writes three demo conversations labelled as seeded history so the recall and re-check prompts have something to find on a fresh clone. Re-running replaces the seeded rows; live turns are never touched.

## Check

```
npm test                # the unit tests, no network
npm run gate            # typecheck, tests, import rules, contracts hash
npm run evals           # the eval cases in docs/02-evals.md
npm run golden          # the golden model outputs
npm run smoke:fresh     # one real fresh question end to end; exits non-zero on failure
npm run measure         # fixed turns through the pipeline; writes evals/results/latency.json
```

Stack and the result of each design decision: `docs/DECISIONS.md`.

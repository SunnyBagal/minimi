# minimi

A chat agent with one tool, web search, that keeps each answer as dated, quoted claims so it can re-check what it said.

Stub: Lane 5 writes the final README.

## Run

Needs Node 22.13 or later and two keys.

```
cp .env.example .env    # fill in ANTHROPIC_API_KEY and EXA_API_KEY
npm install
npm run dev             # http://localhost:3000; PORT=<n> npm run dev for another port
```

A missing key or an older Node stops startup with one named error (`MissingEnvError` or `UnsupportedNodeError`).

## Check

```
npm run gate            # typecheck, tests, import rules, contracts hash
```

Stack and the result of each startup check: `docs/DECISIONS.md`.

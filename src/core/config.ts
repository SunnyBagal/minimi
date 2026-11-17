import type { AgentConfig } from './contracts';

/**
 * Every value here is a starting default to tune by measurement. None of them
 * was measured. Model ids were read from the provider's model list (see V6 in
 * docs/DECISIONS.md).
 */
export const defaultConfig: AgentConfig = {
  models: {
    // Default to tune: the small tier plans the turn.
    router: 'claude-haiku-5-5',
    // Default to tune: Lane 4 switches this to the writer model if the judge set says so.
    judge: 'claude-haiku-5-5',
    // Default to tune.
    extractor: 'claude-haiku-5-5',
    // Default to tune: the larger tier writes the answer.
    writer: 'claude-sonnet-5-5',
  },
  limits: {
    // Default to tune: turns of history shown to the router and the writer.
    recentTurns: 4,
    // Default to tune: web queries the router may plan for one turn.
    queriesPerTurn: 4,
    // Default to tune: results asked of the provider per query.
    resultsPerQuery: 5,
    // Default to tune: claims one re-check turn will verify.
    claimsPerRecheck: 12,
    // Default to tune: judge calls in flight at once.
    judgeConcurrency: 4,
    // Default to tune: characters of page text kept per source.
    sourceTextChars: 20000,
    // Default to tune: searches the answer model may start itself per turn.
    toolSearches: 1,
  },
  deadlinesMs: {
    // Default to tune.
    router: 5000,
    // Default to tune.
    search: 5000,
    // Default to tune.
    recheckFetch: 8000,
    // Default to tune.
    judge: 10000,
    // Default to tune: the whole turn, extraction included. Two measured CRM
    // shortlist turns with the deadlines lifted took 56024 ms and 67119 ms in
    // total (docs/handoff/fix-lane-5-r1.md); 45000 ms cut extraction off.
    // About 1.34x the slower turn, and room for this extract value after the
    // 24300 ms that turn spent before extraction.
    turn: 90000,
    // Default to tune: the claim extractor. Two measured CRM shortlist runs of
    // claude-haiku-5-5 on cited evidence only (9 sources / 150987 characters and
    // 11 sources / 205843 characters) took 35160 ms and 42819 ms
    // (docs/handoff/fix-lane-5-r1.md). About 1.4x the slower run.
    extract: 60000,
  },
  shelfLifeDays: {
    // Default to tune: a product choice, not a fact about any source.
    high: 7,
    // Default to tune.
    medium: 30,
    // Default to tune.
    low: 180,
  },
};

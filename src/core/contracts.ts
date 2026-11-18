/**
 * Shared contracts for the minimi chat agent.
 *
 * FROZEN after Lane 0. A change is a pull request that touches this file only
 * and merges before any lane that depends on it.
 *
 * Rules every lane follows:
 *  - Nothing in src/core imports from "next", "react", "ai" or "@ai-sdk/*",
 *    except src/core/llm/aiSdkLlm.ts.
 *  - Nothing calls Date.now() or new Date() with no argument. Use Clock.
 *  - Ports (MemoryStore, SearchProvider, Llm) never throw for expected
 *    failures such as timeouts or 404s. They return a status.
 *  - src/core/pipeline reaches time functions and guardVerdict only through
 *    AgentDeps. src/compose.ts is the one place that wires real modules.
 */

// ---------------------------------------------------------------- primitives

/** UTC instant, ISO 8601 with Z. Example: "2026-11-13T13:00:00.000Z". */
export type IsoUtc = string;
/** Calendar date on the user's own clock. Example: "2026-11-13". */
export type LocalDate = string;
/** IANA zone name. Example: "Asia/Kolkata". */
export type IanaTz = string;
export type Id = string;

/** The only source of "now". Tests pass a fake. */
export interface Clock {
  now(): Date;
}

// -------------------------------------------------------------------- router

export type Intent = 'chat' | 'fresh' | 'recall' | 'recheck';

/**
 * What the user wrote about time. The model copies; it never computes.
 * There is deliberately no field that holds a resolved date.
 * weekday: ISO numbering, 1 = Monday ... 7 = Sunday.
 */
export type TimeRef =
  | { kind: 'none' }
  | { kind: 'future' }
  | { kind: 'named'; name: 'today' | 'yesterday' }
  | { kind: 'weekday'; weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7; modifier: 'bare' | 'last' | 'this' }
  | { kind: 'calendar'; day: number; month: number; year?: number }
  /** "3/11": which number is the day is unknown. */
  | { kind: 'numeric'; first: number; second: number; year?: number }
  /** "3 days ago", "two weeks ago". */
  | { kind: 'ago'; unit: 'day' | 'week' | 'month'; n: number }
  /** "last week", "this month". */
  | { kind: 'period'; unit: 'week' | 'month'; which: 'last' | 'this' };

export interface RouterPlan {
  intent: Intent;
  timeRef: TimeRef;
  /** The span the user typed, e.g. "last Tuesday". Null when timeRef is none. */
  timeText: string | null;
  topic: string | null;
  /** Product, company and plan names, plus obvious synonyms. */
  entities: string[];
  /** 0 to 4 web queries. Empty for chat and recall. */
  queries: string[];
  /** True for "is that still right?": the target is the previous answer. */
  refersToPrevious: boolean;
  /** True for "shipped anything since ...": run the dated news search. */
  wantsNews: boolean;
}

// ---------------------------------------------------------------------- time

export interface DateCandidates {
  /** Most likely first. Empty when no past date applies. */
  dates: LocalDate[];
  /** Inclusive. Set for periods ("last week"); null otherwise. */
  range: { from: LocalDate; to: LocalDate } | null;
  /** True when dates.length > 1. */
  ambiguous: boolean;
  /** The rule applied, in words. Shown in the dev footer and used in tests. */
  rule: string;
}

/** Lane 1 implements these three, as pure functions. */
export type ResolveTimeRef = (ref: TimeRef, now: Date, tz: IanaTz) => DateCandidates;
export type ToLocalDate = (instant: Date, tz: IanaTz) => LocalDate;
/** "Tue 10 Nov 2026, 14:05 IST" */
export type FormatLocal = (instant: IsoUtc, tz: IanaTz) => string;

/**
 * The three time functions as one injectable value. The pipeline takes them
 * from AgentDeps and never imports src/core/time directly, so it can be built
 * and tested before Lane 1 merges.
 */
export interface TimeFns {
  resolveTimeRef: ResolveTimeRef;
  toLocalDate: ToLocalDate;
  formatLocal: FormatLocal;
}

// ------------------------------------------------------------------- storage

export type Origin = 'live' | 'seed';
export type ExtractionState = 'pending' | 'done' | 'failed' | 'skipped';

export interface Turn {
  id: Id;
  sessionId: Id;
  role: 'user' | 'assistant';
  content: string;
  createdAtUtc: IsoUtc;
  tz: IanaTz;
  /** The date on the user's clock when the turn was written. */
  localDate: LocalDate;
  origin: Origin;
  topic: string | null;
  entities: string[];
  summary: string | null;
  /** Assistant turns only. Re-check extracts on demand unless this is "done". */
  extraction: ExtractionState;
  /** Assistant turns: the intent the router chose. Null on user turns, which are saved before routing. */
  intent: Intent | null;
  /**
   * Set on assistant turns that recalled or re-checked earlier answers: the ids
   * of the assistant turns that first made the claims they covered. Never the
   * id of another recall or re-check turn, so resolution is always one hop.
   * Empty on user turns and on chat and fresh answers.
   */
  targetTurnIds: Id[];
}
export type NewTurn = Omit<Turn, 'id'>;

export interface Source {
  id: Id;
  /** URL requested. */
  url: string;
  /** URL after redirects. */
  finalUrl: string;
  title: string | null;
  publishedAt: IsoUtc | null;
  fetchedAtUtc: IsoUtc;
  /** True only when the provider crawled the page for this request. */
  live: boolean;
  /** True when the host belongs to the entity the claim is about. */
  firstParty: boolean;
  httpStatus: number | null;
  /** Extracted page text, capped by config. */
  text: string;
}
export type NewSource = Omit<Source, 'id'>;

export interface ClaimScope {
  plan?: string;
  period?: 'month' | 'year' | 'one_time';
  /** ISO 4217, e.g. "USD". */
  currency?: string;
  unit?: 'seat' | 'flat' | 'usage';
}

export type Volatility = 'high' | 'medium' | 'low';

export interface Claim {
  id: Id;
  turnId: Id;
  entity: string;
  attribute: string;
  value: string;
  scope: ClaimScope;
  sourceId: Id;
  /** Must pass containsQuote(source.text, quote). */
  quote: string;
  asOfUtc: IsoUtc;
  volatility: Volatility;
  lastVerifiedAtUtc: IsoUtc;
  /** Set when a re-check found a change and wrote this claim to replace an older one. */
  supersedesId: Id | null;
}
export type NewClaim = Omit<Claim, 'id'>;
/** What the extractor returns, before code validation. */
export type ClaimDraft = Pick<Claim, 'entity' | 'attribute' | 'value' | 'scope' | 'quote' | 'volatility'> & {
  /** Citation number [n] in the answer that this claim came from. */
  sourceN: number;
};

export type Verdict = 'unchanged' | 'changed' | 'source_unavailable' | 'unverifiable';

export interface Check {
  id: Id;
  claimId: Id;
  checkedAtUtc: IsoUtc;
  verdict: Verdict;
  newValue: string | null;
  newSourceId: Id | null;
  newQuote: string | null;
  /** One sentence for the user, e.g. "Pricing page timed out after 8 s." */
  reason: string;
  /** "fast_path" when the old quote was still on a live first-party page. */
  decidedBy: 'fast_path' | 'judge' | 'guard';
}
export type NewCheck = Omit<Check, 'id'>;

export interface MemoryHit {
  userTurn: Turn;
  assistantTurn: Turn | null;
  matched: 'date+topic' | 'date' | 'topic';
  score: number;
}

/** The earlier question a recall or re-check is about. The UI shows it above the answer. */
export interface RecalledQuestion {
  turnId: Id;
  question: string;
  createdAtUtc: IsoUtc;
  tz: IanaTz;
  origin: Origin;
}

/**
 * as_stated: the claims those turns wrote, exactly as written then, including
 *            any that were superseded later.
 * current:   for each of those claims, the newest claim in its supersedes
 *            chain, whichever turn wrote it.
 */
export type ClaimVersion = 'as_stated' | 'current';

export interface MemoryStore {
  saveTurn(turn: NewTurn): Turn;
  updateTurnMeta(id: Id, meta: Pick<Turn, 'topic' | 'entities' | 'summary'>): void;
  setExtraction(turnId: Id, state: ExtractionState): void;
  recentTurns(sessionId: Id, limit: number): Turn[];
  getTurns(ids: Id[]): Turn[];

  /**
   * Dates or range act as a hard filter. Topic and entities rank within it.
   * A turn whose id is in excludeTurnIds is never returned. runTurn passes the
   * id of the user turn it has just saved, so a question cannot match itself.
   * Required, so no caller can forget it.
   */
  findTurns(query: {
    dates?: LocalDate[];
    range?: { from: LocalDate; to: LocalDate };
    topic?: string;
    entities?: string[];
    excludeTurnIds: Id[];
    limit: number;
  }): MemoryHit[];
  /** Used when findTurns is empty: same topic on other dates, and adjacent days. Same exclusion rule. */
  nearestTurns(query: {
    around: LocalDate[];
    topic?: string;
    entities?: string[];
    excludeTurnIds: Id[];
    limit: number;
  }): MemoryHit[];

  saveSource(source: NewSource): Source;
  getSources(ids: Id[]): Source[];
  saveClaims(claims: NewClaim[]): Claim[];
  /** See ClaimVersion. Lane 5 picks the version by the rules in the build plan. */
  claimsForTurns(turnIds: Id[], version: ClaimVersion): Claim[];
  saveCheck(check: NewCheck): Check;
  touchVerified(claimId: Id, at: IsoUtc): void;
  /** Current-version claims past their shelf life at `now`. Backs the session-start nudge. */
  staleClaims(now: Date, limit: number): Claim[];
}

// -------------------------------------------------------------------- search

export interface SearchResult {
  url: string;
  title: string | null;
  publishedAt: IsoUtc | null;
  /** Excerpt or page text returned with the search. May come from a cache. */
  text: string;
}

export type FetchStatus = 'ok' | 'not_found' | 'blocked' | 'timeout' | 'error';

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: FetchStatus;
  httpStatus: number | null;
  title: string | null;
  text: string;
  fetchedAtUtc: IsoUtc;
  /** False when the provider answered from its cache. */
  live: boolean;
}

export interface SearchProvider {
  /** One call returns results with text. Never throws on timeout: returns []. */
  search(query: {
    query: string;
    numResults: number;
    /** Inclusive lower bound on published date, when the provider supports it. */
    publishedOnOrAfter?: LocalDate;
    signal?: AbortSignal;
  }): Promise<SearchResult[]>;
  /** Always asks for a live crawl. Never throws: failures come back as a status. */
  fetchPage(request: { url: string; deadlineMs: number; signal?: AbortSignal }): Promise<FetchedPage>;
}

// ----------------------------------------------------------------------- llm

export interface JudgeOutput {
  verdict: Verdict;
  newValue: string | null;
  /** Must be a substring of text fetched this turn, or the guard downgrades the verdict. */
  quote: string | null;
  quoteUrl: string | null;
  scope: ClaimScope;
  reason: string;
}

/** Numbered evidence handed to the writer. [n] in the answer refers to n. */
export interface SourceRef {
  n: number;
  sourceId: Id;
  url: string;
  title: string | null;
  fetchedAtUtc: IsoUtc;
  live: boolean;
  firstParty: boolean;
  text: string;
}

export type Provenance = 'verified_now' | 'from_memory' | 'could_not_verify';

export interface VerdictRow {
  claim: Claim;
  check: Check;
  provenance: Provenance;
  /** Null unless the verdict is unchanged or changed. */
  nowSource: SourceRef | null;
}

/**
 * The one tool the answer model gets: web_search. Lane 5 supplies the function;
 * Lane 4 registers it on the model for fresh answers only. One call runs one
 * search, saves the sources, and returns them numbered after the existing
 * evidence. Lane 5 enforces config.limits.toolSearches: a call past the cap
 * returns [].
 */
export type SearchMore = (query: string) => Promise<SourceRef[]>;

export type WriteInput =
  | { mode: 'chat'; message: string; recent: Turn[] }
  | { mode: 'fresh'; message: string; recent: Turn[]; evidence: SourceRef[]; searchMore: SearchMore }
  | { mode: 'recheck_summary'; message: string; askedOn: LocalDate; rows: VerdictRow[]; news: SourceRef[] }
  | { mode: 'no_record'; message: string; tried: DateCandidates; nearest: MemoryHit[] };

export interface Llm {
  route(input: {
    message: string;
    /** Last few turns, oldest first, so "that" and "the 10th" can be resolved. Never includes the current message. */
    recent: Turn[];
    /** Formatted local time, for the model's information only. */
    nowLocal: string;
    tz: IanaTz;
  }): Promise<RouterPlan>;
  extractClaims(input: { answer: string; evidence: SourceRef[] }): Promise<ClaimDraft[]>;
  judge(input: { claim: Claim; oldQuote: string; page: FetchedPage | null; fresh: SearchResult[] }): Promise<JudgeOutput>;
  /** Streams text deltas. */
  write(input: WriteInput, signal?: AbortSignal): AsyncIterable<string>;
}

// ----------------------------------------------------------- evidence checks

/** Lane 3 implements these four, as pure functions. */
/** NFKC, collapsed whitespace, straight quotes, lowercase, markdown marks stripped. */
export type NormalizeForQuote = (text: string) => string;
/** True when normalize(quote) is a substring of normalize(haystack) and quote is not trivially short. */
export type ContainsQuote = (haystack: string, quote: string) => boolean;
export type IsFirstParty = (url: string, entity: string) => boolean;
export type ValidateAnswer = (
  text: string,
  evidence: SourceRef[],
  /** Numbers the answer may repeat without a citation: from the user message and stored claims. */
  allowedNumbers: string[],
) => { strippedCitations: number[]; uncitedNumbers: string[] };

/**
 * Lane 1 implements this. Applies the code guards to a judge
 * output. Pure: the quote check is passed in, so it can be written and tested
 * before Lane 3 lands.
 */
export type GuardVerdict = (
  output: JudgeOutput,
  context: {
    claim: Claim;
    page: FetchedPage | null;
    fresh: SearchResult[];
    now: Date;
    containsQuote: ContainsQuote;
  },
) => Pick<Check, 'verdict' | 'newValue' | 'newQuote' | 'reason' | 'decidedBy'>;

// ------------------------------------------------------------------ pipeline

/** Everything the UI can show. The route handler maps these 1:1 onto the UI stream. */
export type AgentEvent =
  /** Transient: not stored in message history. */
  | { type: 'status'; text: string }
  | {
      type: 'recall';
      candidates: DateCandidates;
      hits: MemoryHit[];
      chosen: LocalDate | null;
      /** The question the answer is about, when one was chosen. Not repeated in the answer text. */
      asked?: RecalledQuestion | null;
      /** No-record only: the nearest stored turns handed to the writer. */
      nearest?: MemoryHit[];
    }
  | { type: 'verdict'; row: VerdictRow }
  | { type: 'text'; delta: string }
  | { type: 'citations'; items: Omit<SourceRef, 'text'>[] }
  | { type: 'flags'; strippedCitations: number[]; uncitedNumbers: string[] }
  | { type: 'timing'; stage: string; ms: number }
  | { type: 'error'; stage: string; message: string }
  | { type: 'done'; turnId: Id; intent: Intent };

export interface AgentDeps {
  clock: Clock;
  store: MemoryStore;
  search: SearchProvider;
  llm: Llm;
  /** Lane 1: the time functions. Injected, never imported by the pipeline. */
  time: TimeFns;
  /** Lane 1. Same rule: injected, never imported by the pipeline. */
  guardVerdict: GuardVerdict;
  config: AgentConfig;
}

export interface AgentConfig {
  models: { router: string; judge: string; extractor: string; writer: string };
  /** All of these are starting defaults to tune by measurement, not measured values. */
  limits: {
    recentTurns: number;
    queriesPerTurn: number;
    resultsPerQuery: number;
    claimsPerRecheck: number;
    judgeConcurrency: number;
    sourceTextChars: number;
    /** Searches the answer model may start itself per turn through web_search. Default 1. */
    toolSearches: number;
  };
  deadlinesMs: {
    router: number;
    search: number;
    recheckFetch: number;
    judge: number;
    turn: number;
    /** The claim extractor's deadline. When absent, extractClaims uses `judge`. */
    extract?: number;
  };
  /** Days before a claim counts as stale, per volatility. Product defaults, not facts. */
  shelfLifeDays: Record<Volatility, number>;
}

export interface TurnInput {
  sessionId: Id;
  message: string;
  tz: IanaTz;
  /** Defaults to 'live'. Only scripts/seed.ts passes 'seed'. Both turns of the exchange get it. */
  origin?: Origin;
  signal?: AbortSignal;
}

/** Lane 5 implements this. The only entry point the route handler and the evals call. */
export type RunTurn = (input: TurnInput, deps: AgentDeps) => AsyncIterable<AgentEvent>;

/**
 * Test doubles for every port and injected function in contracts.ts.
 * Nothing here touches the network, a model or the system clock.
 */
import type {
  Claim,
  ClaimDraft,
  Clock,
  DateCandidates,
  FetchedPage,
  FormatLocal,
  GuardVerdict,
  IanaTz,
  JudgeOutput,
  Llm,
  LocalDate,
  RouterPlan,
  SearchProvider,
  SearchResult,
  SourceRef,
  TimeFns,
  TimeRef,
  ToLocalDate,
  Turn,
  WriteInput,
} from '../contracts';

// --------------------------------------------------------------------- clock

/** A clock that only moves when a test moves it. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(initial: Date | string) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

// ---------------------------------------------------------------------- time

function zonedParts(instant: Date, tz: IanaTz, withTime: boolean): Record<string, string> {
  // Intl throws a RangeError for an unknown zone, which is what callers rely on.
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: withTime ? 'short' : '2-digit',
    day: '2-digit',
    ...(withTime
      ? { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }
      : {}),
  });
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

/** Calendar date of an instant in a zone, through Intl. Throws RangeError for an unknown zone. */
export const intlToLocalDate: ToLocalDate = (instant, tz) => {
  const parts = zonedParts(instant, tz, false);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** "Tue 10 Nov 2026, 14:05 GMT+5:30". The zone label is whatever Intl gives for the zone. */
export const intlFormatLocal: FormatLocal = (instant, tz) => {
  const parts = zonedParts(new Date(instant), tz, true);
  return `${parts.weekday} ${Number(parts.day)} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
};

export interface FakeTimeRow {
  ref: TimeRef;
  result: DateCandidates;
}

function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The result fakeTime returns for a TimeRef that is not in its table. */
export const FAKE_TIME_NO_ENTRY: DateCandidates = {
  dates: [],
  range: null,
  ambiguous: false,
  rule: 'fakeTime: no table entry for this TimeRef',
};

/**
 * TimeFns for pipeline tests. resolveTimeRef looks the TimeRef up in the table
 * (field order does not matter) and returns the canned candidates; `now` and
 * `tz` are ignored. toLocalDate and formatLocal go through Intl.
 */
export function fakeTime(table: FakeTimeRow[] = []): TimeFns {
  const byKey = new Map<string, DateCandidates>();
  for (const row of table) byKey.set(stableKey(row.ref), row.result);
  return {
    resolveTimeRef: (ref) => structuredClone(byKey.get(stableKey(ref)) ?? FAKE_TIME_NO_ENTRY),
    toLocalDate: intlToLocalDate,
    formatLocal: intlFormatLocal,
  };
}

/** Shorthand for a table row's result. */
export function candidates(dates: LocalDate[], rule = 'fakeTime: canned'): DateCandidates {
  return { dates, range: null, ambiguous: dates.length > 1, rule };
}

// --------------------------------------------------------------------- guard

/** Returns the judge's output unchanged. For pipeline tests only: it guards nothing. */
export const passThroughGuard: GuardVerdict = (output) => ({
  verdict: output.verdict,
  newValue: output.newValue,
  newQuote: output.quote,
  reason: output.reason,
  decidedBy: 'judge',
});

// -------------------------------------------------------------------- search

export type FakeSearchCall =
  | { kind: 'search'; query: string; numResults: number; publishedOnOrAfter: LocalDate | null }
  | { kind: 'fetchPage'; url: string; deadlineMs: number };

export interface FakeSearchScript {
  /**
   * Results per query. A key matches when the query contains it, ignoring case;
   * the first matching key wins. The key "*" matches any query and is tried last.
   */
  results?: Record<string, SearchResult[]>;
  /** Pages by exact URL. Missing fields default to a live 200 page with empty text. */
  pages?: Record<string, Partial<FetchedPage>>;
}

/**
 * Scripted SearchProvider. It returns what the script says and applies no
 * filter of its own: publishedOnOrAfter is recorded in `log`, not enforced, so
 * a test can check that the pipeline does its own date filtering.
 * A URL with no scripted page comes back as `not_found`.
 */
export class FakeSearch implements SearchProvider {
  readonly log: FakeSearchCall[] = [];
  private readonly results = new Map<string, SearchResult[]>();
  private readonly pages = new Map<string, Partial<FetchedPage>>();

  constructor(
    private readonly clock: Clock,
    script: FakeSearchScript = {},
  ) {
    for (const [match, results] of Object.entries(script.results ?? {})) this.setResults(match, results);
    for (const [url, page] of Object.entries(script.pages ?? {})) this.setPage(url, page);
  }

  setResults(match: string, results: SearchResult[]): void {
    this.results.set(match, structuredClone(results));
  }

  setPage(url: string, page: Partial<FetchedPage>): void {
    this.pages.set(url, structuredClone(page));
  }

  get searchCalls(): Extract<FakeSearchCall, { kind: 'search' }>[] {
    return this.log.filter((call) => call.kind === 'search');
  }

  get fetchCalls(): Extract<FakeSearchCall, { kind: 'fetchPage' }>[] {
    return this.log.filter((call) => call.kind === 'fetchPage');
  }

  async search(query: {
    query: string;
    numResults: number;
    publishedOnOrAfter?: LocalDate;
    signal?: AbortSignal;
  }): Promise<SearchResult[]> {
    this.log.push({
      kind: 'search',
      query: query.query,
      numResults: query.numResults,
      publishedOnOrAfter: query.publishedOnOrAfter ?? null,
    });
    if (query.signal?.aborted) return [];
    const wanted = query.query.toLowerCase();
    let found: SearchResult[] | undefined;
    for (const [match, results] of this.results) {
      if (match !== '*' && wanted.includes(match.toLowerCase())) {
        found = results;
        break;
      }
    }
    found ??= this.results.get('*') ?? [];
    return structuredClone(found.slice(0, query.numResults));
  }

  async fetchPage(request: { url: string; deadlineMs: number; signal?: AbortSignal }): Promise<FetchedPage> {
    this.log.push({ kind: 'fetchPage', url: request.url, deadlineMs: request.deadlineMs });
    const base = { url: request.url, finalUrl: request.url, title: null, text: '', fetchedAtUtc: this.clock.now().toISOString() };
    if (request.signal?.aborted) {
      return { ...base, status: 'timeout', httpStatus: null, live: false };
    }
    const scripted = this.pages.get(request.url);
    if (scripted === undefined) {
      return { ...base, status: 'not_found', httpStatus: 404, live: true };
    }
    return { ...base, status: 'ok', httpStatus: 200, live: true, ...structuredClone(scripted) };
  }
}

// ----------------------------------------------------------------------- llm

export type RouteInput = Parameters<Llm['route']>[0];
export type ExtractInput = Parameters<Llm['extractClaims']>[0];
export type JudgeInput = Parameters<Llm['judge']>[0];

/** A fixed value, or a function of the input and the zero-based call number. */
export type Scripted<I, O> = O | ((input: I, call: number) => O | Promise<O>);

export type FakeLlmCall =
  | { method: 'route'; input: RouteInput }
  | { method: 'extractClaims'; input: ExtractInput }
  | { method: 'judge'; input: JudgeInput }
  | { method: 'write'; input: WriteInput };

export interface FakeLlmScript {
  /** Default: a chat plan (see chatPlan). */
  route?: Scripted<RouteInput, RouterPlan>;
  /** Default: no claims. */
  extractClaims?: Scripted<ExtractInput, ClaimDraft[]>;
  /** Default: `unverifiable` with no quote. */
  judge?: Scripted<JudgeInput, JudgeOutput>;
  /**
   * The deltas to stream, or a function that returns them (it may be an async
   * generator, and may call `input.searchMore` itself). Default: one delta, "ok".
   */
  write?: string[] | ((input: WriteInput, call: number) => Iterable<string> | AsyncIterable<string>);
  /**
   * In `fresh` mode, queries the fake writer sends through `input.searchMore`,
   * in order, before it streams any text. What came back is in `searchMoreResults`.
   */
  searchMore?: string[];
}

/** A plain-chat RouterPlan, with any fields overridden. */
export function chatPlan(overrides: Partial<RouterPlan> = {}): RouterPlan {
  return {
    intent: 'chat',
    timeRef: { kind: 'none' },
    timeText: null,
    topic: null,
    entities: [],
    queries: [],
    refersToPrevious: false,
    wantsNews: false,
    ...overrides,
  };
}

function isScriptFn<I, O>(script: Scripted<I, O>): script is (input: I, call: number) => O | Promise<O> {
  return typeof script === 'function';
}

async function runScript<I, O>(script: Scripted<I, O> | undefined, input: I, call: number, fallback: O): Promise<O> {
  if (script === undefined) return fallback;
  const output = isScriptFn(script) ? await script(input, call) : script;
  return structuredClone(output);
}

/** Scripted Llm. Every call is recorded in `log`, with the input it received. */
export class FakeLlm implements Llm {
  readonly log: FakeLlmCall[] = [];
  /** One entry per `searchMore` call the fake writer made: what the pipeline returned. */
  readonly searchMoreResults: SourceRef[][] = [];

  constructor(private readonly script: FakeLlmScript = {}) {}

  calls<M extends FakeLlmCall['method']>(method: M): Extract<FakeLlmCall, { method: M }>[] {
    return this.log.filter((call): call is Extract<FakeLlmCall, { method: M }> => call.method === method);
  }

  async route(input: RouteInput): Promise<RouterPlan> {
    const call = this.calls('route').length;
    this.log.push({ method: 'route', input });
    return runScript(this.script.route, input, call, chatPlan());
  }

  async extractClaims(input: ExtractInput): Promise<ClaimDraft[]> {
    const call = this.calls('extractClaims').length;
    this.log.push({ method: 'extractClaims', input });
    return runScript(this.script.extractClaims, input, call, []);
  }

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    const call = this.calls('judge').length;
    this.log.push({ method: 'judge', input });
    return runScript(this.script.judge, input, call, {
      verdict: 'unverifiable',
      newValue: null,
      quote: null,
      quoteUrl: null,
      scope: {},
      reason: 'FakeLlm: no judge script.',
    });
  }

  async *write(input: WriteInput, signal?: AbortSignal): AsyncIterable<string> {
    const call = this.calls('write').length;
    this.log.push({ method: 'write', input });
    if (input.mode === 'fresh') {
      for (const query of this.script.searchMore ?? []) {
        this.searchMoreResults.push(await input.searchMore(query));
      }
    }
    const script = this.script.write ?? ['ok'];
    const deltas = typeof script === 'function' ? script(input, call) : script;
    for await (const delta of deltas) {
      if (signal?.aborted) return;
      yield delta;
    }
  }
}

// ------------------------------------------------------------------ builders

/** A Turn-shaped object for tests that need one without going through a store. */
export function turnFixture(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 'turn-fixture',
    sessionId: 'session-fixture',
    role: 'user',
    content: '',
    createdAtUtc: '2026-11-10T08:35:00.000Z',
    tz: 'Asia/Kolkata',
    localDate: '2026-11-10',
    origin: 'live',
    topic: null,
    entities: [],
    summary: null,
    extraction: 'skipped',
    intent: null,
    targetTurnIds: [],
    ...overrides,
  };
}

/** A Claim-shaped object for tests. */
export function claimFixture(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-fixture',
    turnId: 'turn-fixture',
    entity: 'Example Co',
    attribute: 'price',
    value: '10 USD',
    scope: {},
    sourceId: 'source-fixture',
    quote: 'Example Co costs 10 USD',
    asOfUtc: '2026-11-10T08:35:00.000Z',
    volatility: 'high',
    lastVerifiedAtUtc: '2026-11-10T08:35:00.000Z',
    supersedesId: null,
    ...overrides,
  };
}

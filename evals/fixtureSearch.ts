/**
 * SearchProvider for the evals. It serves fixture pages and scripted search
 * hits. It never calls the network. Every call is appended to `log`.
 */
import type { Clock, FetchedPage, LocalDate, SearchProvider, SearchResult } from '../src/core/contracts';
import { readFixture } from './pages';

export type FixtureFailure = 'timeout' | 'not_found';

export type FixturePageSpec = { file: string } | { failure: FixtureFailure };

export interface FixtureSearchHit {
  match: string;
  results: SearchResult[];
}

/** Which fixture file or scripted failure each URL uses, plus search hits. */
export interface FixtureScenario {
  pages: Record<string, FixturePageSpec>;
  searches: FixtureSearchHit[];
}

export type FixtureCall =
  | { kind: 'search'; query: string; numResults: number; publishedOnOrAfter: LocalDate | null }
  | { kind: 'fetchPage'; url: string; deadlineMs: number };

function isFailure(spec: FixturePageSpec): spec is { failure: FixtureFailure } {
  return 'failure' in spec;
}

/** The same match `FixtureSearch.search` uses: first substring hit, then `numResults`. */
function hitsFor(scenario: FixtureScenario, query: string, numResults: number): SearchResult[] {
  const wanted = query.toLowerCase();
  const hit = scenario.searches.find((entry) => wanted.includes(entry.match.toLowerCase()));
  return (hit?.results ?? []).slice(0, numResults);
}

/**
 * Page text the fixture search returned for these calls. Fetch calls are not
 * included. A query with no hit contributes nothing.
 */
export function servedPageTexts(scenario: FixtureScenario, calls: readonly FixtureCall[]): string[] {
  return calls.flatMap((call) =>
    call.kind === 'search' ? hitsFor(scenario, call.query, call.numResults).map((result) => result.text) : [],
  );
}

export class FixtureSearch implements SearchProvider {
  readonly log: FixtureCall[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly scenario: FixtureScenario,
  ) {}

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
    return structuredClone(hitsFor(this.scenario, query.query, query.numResults));
  }

  async fetchPage(request: { url: string; deadlineMs: number; signal?: AbortSignal }): Promise<FetchedPage> {
    this.log.push({ kind: 'fetchPage', url: request.url, deadlineMs: request.deadlineMs });
    const fetchedAtUtc = this.clock.now().toISOString();
    const base = {
      url: request.url,
      finalUrl: request.url,
      title: null as string | null,
      text: '',
      fetchedAtUtc,
      httpStatus: null as number | null,
    };
    if (request.signal?.aborted) {
      return { ...base, status: 'timeout', live: false };
    }
    const spec = this.scenario.pages[request.url];
    if (spec === undefined || (isFailure(spec) && spec.failure === 'not_found')) {
      return { ...base, status: 'not_found', httpStatus: 404, live: false };
    }
    if (isFailure(spec)) {
      return { ...base, status: 'timeout', live: false };
    }
    return {
      ...base,
      status: 'ok',
      httpStatus: 200,
      live: true,
      title: new URL(request.url).hostname,
      text: readFixture(spec.file),
    };
  }
}

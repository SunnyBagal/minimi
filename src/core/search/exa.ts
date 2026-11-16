/**
 * SearchProvider on Exa, via fetch. Never throws for expected failures:
 * timeouts, aborts and provider-reported errors come back as statuses or [].
 *
 * Request shapes follow references/search.md and references/contents.md in
 * .agents/skills/build-with-exa plus the recorded probes in fixtures/.
 */
import type {
  AgentConfig,
  Clock,
  FetchedPage,
  FetchStatus,
  SearchProvider,
  SearchResult,
} from '../contracts';

const BASE_URL = 'https://api.exa.ai';

// Provider-documented bounds for livecrawlTimeout (integer ms, >0, max 90000).
const LIVECRAWL_TIMEOUT_MIN_MS = 1;
const LIVECRAWL_TIMEOUT_MAX_MS = 90000;

// ---------------------------------------------------------------- wire types

interface ExaContentsStatus {
  id?: string;
  status?: string;
  source?: string;
  error?: { tag?: string; httpStatusCode?: number | null };
}

interface ExaContentsResult {
  id?: string;
  url?: string;
  title?: string | null;
  text?: string | null;
}

interface ExaContentsBody {
  results?: ExaContentsResult[];
  statuses?: ExaContentsStatus[];
}

interface ExaSearchResult {
  url?: string;
  title?: string | null;
  publishedDate?: string | null;
  text?: string | null;
}

interface ExaSearchBody {
  results?: ExaSearchResult[];
}

// ------------------------------------------------------------------- helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asIsoUtc(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function clampLivecrawlTimeout(deadlineMs: number): number {
  const ms = Math.round(deadlineMs);
  return Math.min(Math.max(ms, LIVECRAWL_TIMEOUT_MIN_MS), LIVECRAWL_TIMEOUT_MAX_MS);
}

/** The explicit httpStatusCode, or the code embedded in a CRAWL_HTTP_{status} tag. */
function crawlHttpCode(status: ExaContentsStatus | undefined): number | null {
  const explicit = status?.error?.httpStatusCode;
  if (typeof explicit === 'number') return explicit;
  const tag = status?.error?.tag;
  const match = tag ? /^CRAWL_HTTP_(\d{3})$/.exec(tag) : null;
  return match ? Number(match[1]) : null;
}

function statusForCrawlError(status: ExaContentsStatus): { status: FetchStatus; httpStatus: number | null } {
  const tag = status.error?.tag;
  const code = crawlHttpCode(status);
  if (tag === 'CRAWL_NOT_FOUND' || code === 404 || code === 410) {
    return { status: 'not_found', httpStatus: code };
  }
  if (tag === 'SOURCE_NOT_AVAILABLE' || code === 401 || code === 403 || code === 451) {
    return { status: 'blocked', httpStatus: code };
  }
  if (tag === 'CRAWL_TIMEOUT' || tag === 'CRAWL_LIVECRAWL_TIMEOUT') {
    return { status: 'timeout', httpStatus: code };
  }
  return { status: 'error', httpStatus: code };
}

function pickEntry<T extends { id?: string; url?: string }>(entries: T[] | undefined, url: string): T | undefined {
  if (entries === undefined || entries.length === 0) return undefined;
  const match = entries.find((entry) => entry.id === url || entry.url === url);
  if (match !== undefined) return match;
  // Single-entry fallback only when the entry does not identify a different
  // URL — a result explicitly naming another page must not be adopted.
  const only = entries[0];
  if (entries.length === 1 && only !== undefined && only.id === undefined && only.url === undefined) {
    return only;
  }
  return undefined;
}

// -------------------------------------------------------------------- search

async function searchWith(
  apiKey: string,
  config: AgentConfig,
  fetchFn: typeof fetch,
  query: Parameters<SearchProvider['search']>[0],
): Promise<SearchResult[]> {
  const signal = query.signal
    ? AbortSignal.any([AbortSignal.timeout(config.deadlinesMs.search), query.signal])
    : AbortSignal.timeout(config.deadlinesMs.search);

  try {
    const body: Record<string, unknown> = {
      query: query.query,
      type: 'auto',
      numResults: query.numResults,
      contents: { text: { maxCharacters: config.limits.sourceTextChars } },
    };
    if (query.publishedOnOrAfter !== undefined) {
      body.startPublishedDate = `${query.publishedOnOrAfter}T00:00:00.000Z`;
    }
    const response = await fetchFn(`${BASE_URL}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return [];
    const parsed: unknown = await response.json();
    if (!isRecord(parsed) || !Array.isArray(parsed.results)) return [];
    return (parsed.results as ExaSearchResult[])
      .filter((result) => typeof result.url === 'string' && result.url !== '')
      .map((result) => ({
        url: result.url ?? '',
        title: typeof result.title === 'string' ? result.title : null,
        publishedAt: asIsoUtc(result.publishedDate),
        text: (result.text ?? '').slice(0, config.limits.sourceTextChars),
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- fetch page

function parseContentsBody(parsed: unknown): ExaContentsBody | null {
  if (!isRecord(parsed)) return null;
  const body = parsed as ExaContentsBody;
  return {
    results: Array.isArray(body.results) ? body.results : [],
    statuses: Array.isArray(body.statuses) ? body.statuses : [],
  };
}

async function fetchPageWith(
  apiKey: string,
  clock: Clock,
  config: AgentConfig,
  fetchFn: typeof fetch,
  request: { url: string; deadlineMs: number; signal?: AbortSignal },
): Promise<FetchedPage> {
  const signal = request.signal
    ? AbortSignal.any([AbortSignal.timeout(Math.max(1, request.deadlineMs)), request.signal])
    : AbortSignal.timeout(Math.max(1, request.deadlineMs));

  const base = {
    url: request.url,
    finalUrl: request.url,
    title: null as string | null,
    text: '',
    httpStatus: null as number | null,
    live: false,
  };
  const fail = (status: FetchStatus, httpStatus: number | null = null): FetchedPage => ({
    ...base,
    status,
    httpStatus,
    fetchedAtUtc: clock.now().toISOString(),
  });

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/contents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        urls: [request.url],
        text: { maxCharacters: config.limits.sourceTextChars },
        maxAgeHours: 0,
        livecrawlTimeout: clampLivecrawlTimeout(request.deadlineMs),
      }),
      signal,
    });
  } catch {
    return fail(signal.aborted ? 'timeout' : 'error');
  }

  if (!response.ok) {
    // Request-level failure: about our key/plan/rate, not the target page.
    return fail(response.status === 504 ? 'timeout' : 'error');
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return fail(signal.aborted ? 'timeout' : 'error');
  }
  const body = parseContentsBody(parsed);
  if (body === null) return fail('error');

  const st = pickEntry(body.statuses, request.url);
  const res = pickEntry(body.results, request.url);

  if (res !== undefined && typeof res.text === 'string') {
    // Text came back; the question is only whether it was crawled now or
    // served from cache. With no statuses at all, live is inferred (V7).
    const statuses = body.statuses ?? [];
    const live = statuses.length === 0 || (st?.status === 'success' && st.source === 'crawled');
    return {
      ...base,
      status: 'ok',
      finalUrl: typeof res.url === 'string' && res.url !== '' ? res.url : request.url,
      title: typeof res.title === 'string' ? res.title : null,
      text: res.text.slice(0, config.limits.sourceTextChars),
      httpStatus: st?.error?.httpStatusCode ?? null,
      live,
      fetchedAtUtc: clock.now().toISOString(),
    };
  }

  if (st !== undefined && st.status === 'error') {
    const outcome = statusForCrawlError(st);
    return fail(outcome.status, outcome.httpStatus);
  }

  return fail('error');
}

// -------------------------------------------------------------------- public

export function createExaSearch(
  apiKey: string,
  clock: Clock,
  config: AgentConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): SearchProvider {
  return {
    search: (query) => searchWith(apiKey, config, fetchFn, query),
    fetchPage: (request) => fetchPageWith(apiKey, clock, config, fetchFn, request),
  };
}

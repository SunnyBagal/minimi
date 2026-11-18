/**
 * Recheck: cap the baseline claims by volatility, fetch each cited source's
 * URL once, judge each claim (fast path on a live first-party page, model
 * otherwise, the guard always last), write checks and superseding claims,
 * emit a verdict event per claim in completion order, then the dated news
 * search and the summary write.
 */
import { claimLabel } from '../claimLabel';
import type {
  AgentEvent,
  Check,
  Claim,
  ClaimScope,
  FetchedPage,
  Id,
  JudgeOutput,
  Provenance,
  SearchResult,
  Source,
  SourceRef,
  VerdictRow,
} from '../contracts';
import { containsQuote, isFirstParty, validateAnswer } from '../search/index';
import type { TurnContext } from './context';
import { allowedNumbersOf, asRef, numbersIn, saveSource } from './evidence';
import { pool } from './pool';
import type { Resolved } from './recall';

// Volatility order: re-check the perishable claims first.
const VOLATILITY_ORDER: Record<Claim['volatility'], number> = { high: 0, medium: 1, low: 2 };

/** True for a provider rate-limit error, which earns one judge retry. */
function isRateLimitError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (statusCode === 429) return true;
  }
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /rate.?limit|too many requests|429/i.test(text);
}

/** Guard rule 7's equality, kept local: the pipeline never imports guards. */
function sameValue(a: string, b: string): boolean {
  const aNumbers = numbersIn(a);
  const bNumbers = numbersIn(b);
  const firstA = aNumbers[0];
  const firstB = bNumbers[0];
  if (firstA !== undefined && firstB !== undefined) return firstA === firstB;
  if (firstA === undefined && firstB === undefined) {
    return a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim();
  }
  return false;
}

/** A scope key that survives key order: superseding claims copy it verbatim. */
function scopeKey(scope: ClaimScope): string {
  return JSON.stringify(Object.keys(scope).sort().map((key) => [key, scope[key as keyof ClaimScope]]));
}

/** claim|attribute|scope identifies one slot in a supersede chain. */
function claimKey(claim: Claim): string {
  return `${claim.entity}|${claim.attribute}|${scopeKey(claim.scope)}`;
}

/**
 * The chain's current claim for a baseline claim: itself when it already is
 * current, else the non-baseline current claim with the same key.
 */
function chainCurrent(baseline: Claim, currents: Claim[]): Claim {
  const byId = currents.find((claim) => claim.id === baseline.id);
  if (byId !== undefined) return byId;
  const key = claimKey(baseline);
  return currents.find((claim) => claimKey(claim) === key) ?? baseline;
}

/** Saves a fetched page as a source row and returns it. */
function savePage(ctx: TurnContext, url: string, page: FetchedPage, firstParty: boolean): Source {
  return saveSource(ctx, {
    url,
    finalUrl: page.finalUrl,
    title: page.title,
    publishedAt: null,
    fetchedAtUtc: page.fetchedAtUtc,
    live: page.live,
    firstParty,
    httpStatus: page.httpStatus,
    text: page.text,
  });
}

/** The judge call with exactly one retry on a rate-limit error. */
async function judgeOnce(ctx: TurnContext, claim: Claim, page: FetchedPage | null, fresh: SearchResult[]): Promise<JudgeOutput> {
  try {
    return await ctx.deps.llm.judge({ claim, oldQuote: claim.quote, page, fresh });
  } catch (error) {
    if (!isRateLimitError(error)) throw error;
    return ctx.deps.llm.judge({ claim, oldQuote: claim.quote, page, fresh });
  }
}

interface ClaimWork {
  claim: Claim;
  current: Claim;
  oldSource: Source | undefined;
  page: FetchedPage | null;
  pageSource: Source | null;
}

/** Judges one claim and returns its VerdictRow (side effects: check/claim writes). */
async function judgeClaim(ctx: TurnContext, work: ClaimWork): Promise<VerdictRow> {
  const { claim, current, oldSource } = work;
  let { page, pageSource } = work;
  const checkedAtUtc = ctx.clock.now().toISOString();
  let decision: Pick<Check, 'verdict' | 'newValue' | 'newQuote' | 'reason' | 'decidedBy'>;
  let judgedSource = pageSource;

  const fastPath =
    oldSource?.firstParty === true && page !== null && page.status === 'ok' && page.live &&
    containsQuote(page.text, claim.quote);

  if (fastPath) {
    decision = {
      verdict: 'unchanged',
      newValue: null,
      newQuote: claim.quote,
      reason: 'The quote is still on the live first-party page.',
      decidedBy: 'fast_path',
    };
  } else {
    const fresh = await ctx.deps.search.search({
      query: claimLabel(claim),
      numResults: ctx.config.limits.resultsPerQuery,
      signal: ctx.signal,
    });
    for (const hit of fresh) {
      saveSource(ctx, {
        url: hit.url,
        finalUrl: hit.url,
        title: hit.title,
        publishedAt: hit.publishedAt,
        fetchedAtUtc: ctx.clock.now().toISOString(),
        live: false,
        firstParty: isFirstParty(hit.url, claim.entity),
        httpStatus: null,
        text: hit.text.slice(0, ctx.config.limits.sourceTextChars),
      });
    }
    if (page === null || page.status !== 'ok' || oldSource?.firstParty !== true) {
      const best = fresh.find((hit) => isFirstParty(hit.url, claim.entity));
      if (best !== undefined) {
        const fetched = await ctx.deps.search.fetchPage({
          url: best.url,
          deadlineMs: ctx.config.deadlinesMs.recheckFetch,
          signal: ctx.signal,
        });
        judgedSource = savePage(ctx, best.url, fetched, isFirstParty(best.url, claim.entity));
        page = fetched;
      }
    }
    try {
      const output = await judgeOnce(ctx, claim, page, fresh);
      decision = ctx.guardVerdict(output, { claim, page, fresh, now: ctx.now, containsQuote });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      decision = {
        verdict: 'unverifiable',
        newValue: null,
        newQuote: null,
        reason: `The judge could not run: ${message}.`,
        decidedBy: 'guard',
      };
    }
  }

  const check = ctx.store.saveCheck({
    claimId: claim.id,
    checkedAtUtc,
    ...decision,
    newSourceId: judgedSource?.id ?? null,
  });

  if (check.verdict === 'unchanged') {
    ctx.store.touchVerified(claim.id, checkedAtUtc);
  } else if (check.verdict === 'changed' && check.newValue !== null) {
    if (!sameValue(check.newValue, current.value)) {
      // The superseding claim needs this turn's id, which exists only after
      // the assistant turn is saved: queue it for afterSave.
      const newValue = check.newValue;
      const newQuote = check.newQuote;
      const source = judgedSource;
      ctx.afterSave(() => {
        ctx.store.saveClaims([
          {
            turnId: ctx.savedTurnId ?? '',
            entity: claim.entity,
            attribute: claim.attribute,
            value: newValue,
            scope: claim.scope,
            sourceId: source?.id ?? '',
            quote: newQuote ?? '',
            asOfUtc: source?.fetchedAtUtc ?? checkedAtUtc,
            volatility: claim.volatility,
            lastVerifiedAtUtc: source?.fetchedAtUtc ?? checkedAtUtc,
            supersedesId: current.id,
          },
        ]);
      });
    } else {
      ctx.store.touchVerified(current.id, checkedAtUtc);
    }
  }

  const provenance: Provenance =
    check.verdict === 'unchanged' || check.verdict === 'changed' ? 'verified_now' : 'could_not_verify';
  return {
    claim,
    check,
    provenance,
    // n 0 is a marker; numberSource assigns the real number per turn.
    nowSource:
      provenance === 'verified_now' && judgedSource !== null ? asRef(judgedSource, 0) : null,
  };
}

export async function* recheck(ctx: TurnContext, resolved: Resolved): AsyncIterable<AgentEvent> {
  const { targets, version, baseline, askedOn } = resolved;

  // Re-check the perishable claims first, up to the configured cap.
  const ordered = [...baseline].sort((a, b) => VOLATILITY_ORDER[a.volatility] - VOLATILITY_ORDER[b.volatility]);
  const cap = ctx.config.limits.claimsPerRecheck;
  const claims = ordered.slice(0, cap);
  const skipped = ordered.slice(cap);
  if (skipped.length > 0) {
    const names = skipped.map((claim) => `${claim.entity} ${claim.attribute}`).join(', ');
    yield ctx.textEvent(`Skipped ${skipped.length} lower-priority claim(s) over the limit of ${cap}: ${names}.`);
  }

  // The chain's current version of each baseline claim: the baseline claims
  // themselves when they already are the current versions.
  const currents = version === 'current' ? claims : ctx.store.claimsForTurns(targets, 'current');
  const currentOf = new Map<Id, Claim>(claims.map((claim) => [claim.id, chainCurrent(claim, currents)]));

  // One live fetch per cited URL, in parallel; each page saved as a source.
  const oldSources = new Map(ctx.store.getSources([...new Set(claims.map((claim) => claim.sourceId))]).map((s) => [s.id, s]));
  const urls = [...new Set(claims.map((claim) => oldSources.get(claim.sourceId)?.url ?? ''))].filter((u) => u !== '');
  yield { type: 'status', text: `Checking ${claims.length} claims…` };
  const doneFetch = ctx.timer('fetch');
  const pages = new Map<string, { page: FetchedPage; source: Source }>();
  await Promise.all(
    urls.map(async (url) => {
      const firstClaim = claims.find((claim) => oldSources.get(claim.sourceId)?.url === url);
      const page = await ctx.deps.search.fetchPage({
        url,
        deadlineMs: ctx.config.deadlinesMs.recheckFetch,
        signal: ctx.signal,
      });
      const firstParty = firstClaim !== undefined && isFirstParty(url, firstClaim.entity);
      pages.set(url, { page, source: savePage(ctx, url, page, firstParty) });
    }),
  );
  yield doneFetch();

  // nowSource numbers are assigned per turn, first come first numbered.
  const nowSourceNs = new Map<Id, number>();
  let nextN = 1;
  const numberSource = (row: VerdictRow): VerdictRow => {
    if (row.nowSource === null) return row;
    let n = nowSourceNs.get(row.nowSource.sourceId);
    if (n === undefined) {
      n = nextN;
      nextN += 1;
      nowSourceNs.set(row.nowSource.sourceId, n);
    }
    return { ...row, nowSource: { ...row.nowSource, n } };
  };

  ctx.stage = 'judge';
  const doneJudge = ctx.timer('judge');
  const rows: VerdictRow[] = [];
  const tasks: ClaimWork[] = claims.map((claim) => {
    const oldSource = oldSources.get(claim.sourceId);
    const entry = oldSource !== undefined ? pages.get(oldSource.url) : undefined;
    return {
      claim,
      current: currentOf.get(claim.id) ?? claim,
      oldSource,
      page: entry?.page ?? null,
      pageSource: entry?.source ?? null,
    };
  });
  for await (const row of pool(tasks, ctx.config.limits.judgeConcurrency, (work) => judgeClaim(ctx, work))) {
    const numbered = numberSource(row);
    rows.push(numbered);
    yield { type: 'verdict', row: numbered };
  }
  yield doneJudge();

  // Dated news, one search per entity; undated results are set aside.
  // The router's entities can be generic ("CRM"); the baseline claims name
  // the actual products, so the search runs over the distinct claim
  // entities in claim order. plan.entities is the fallback when there is
  // no baseline.
  const newsEntities =
    claims.length > 0 ? [...new Set(claims.map((claim) => claim.entity))] : ctx.plan.entities;
  let news: SourceRef[] = [];
  let undatedCount = 0;
  if (ctx.plan.wantsNews) {
    const doneNews = ctx.timer('news');
    const searches = await Promise.all(
      newsEntities.map((entity) =>
        ctx.deps.search.search({
          query: `${entity} news`,
          numResults: ctx.config.limits.resultsPerQuery,
          publishedOnOrAfter: askedOn,
          signal: ctx.signal,
        }),
      ),
    );
    for (const hit of searches.flat()) {
      if (hit.publishedAt === null) {
        undatedCount += 1;
        continue;
      }
      if (ctx.time.toLocalDate(new Date(hit.publishedAt), ctx.tz) < askedOn) continue;
      const source = saveSource(ctx, {
        url: hit.url,
        finalUrl: hit.url,
        title: hit.title,
        publishedAt: hit.publishedAt,
        fetchedAtUtc: ctx.clock.now().toISOString(),
        live: false,
        firstParty: newsEntities.some((entity) => isFirstParty(hit.url, entity)),
        httpStatus: null,
        text: hit.text.slice(0, ctx.config.limits.sourceTextChars),
      });
      news.push(asRef(source, nextN));
      nextN += 1;
    }
    yield doneNews();
  }

  // The check time is made visible in the answer before the summary.
  yield ctx.textEvent(`Checked ${ctx.time.formatLocal(ctx.clock.now().toISOString(), ctx.tz)}.\n`);

  ctx.stage = 'summary';
  const doneSummary = ctx.timer('summary');
  let summaryText = '';
  for await (const delta of ctx.deps.llm.write(
    { mode: 'recheck_summary', message: ctx.input.message, askedOn, rows, news },
    ctx.signal,
  )) {
    summaryText += delta;
    yield ctx.textEvent(delta);
  }
  yield doneSummary();
  if (undatedCount > 0) {
    yield ctx.textEvent(`\n(${undatedCount} undated search result(s) were set aside.)`);
  }

  // The same page can back several claims; cite each numbered source once.
  const cited = new Map<number, SourceRef>();
  for (const row of rows) {
    if (row.nowSource !== null && !cited.has(row.nowSource.n)) cited.set(row.nowSource.n, row.nowSource);
  }
  for (const ref of news) if (!cited.has(ref.n)) cited.set(ref.n, ref);
  const citable = [...cited.values()];
  const allowed = allowedNumbersOf(
    ctx.input.message,
    askedOn,
    ...rows.flatMap((row) => [
      row.claim.value,
      row.claim.quote,
      row.check.newValue ?? '',
      row.check.newQuote ?? '',
      ctx.time.formatLocal(row.claim.asOfUtc, ctx.tz),
      ctx.time.formatLocal(row.check.checkedAtUtc, ctx.tz),
    ]),
  );
  const flags = validateAnswer(summaryText, citable, allowed);
  yield { type: 'citations', items: citable.map(({ text: _text, ...item }) => item) };
  yield { type: 'flags', ...flags };

  ctx.saveAssistant({ intent: 'recheck', extraction: 'skipped', targetTurnIds: targets });
}

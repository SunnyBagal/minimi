/**
 * Fresh: search the routed queries, save every result as a source before the
 * writer starts, hand the numbered evidence to the writer along with a capped
 * searchMore, then validate the answer, save the turn with extraction
 * 'pending' and extract claims into the store.
 */
import type { AgentEvent, SearchResult, SourceRef } from '../contracts';
import { isFirstParty, validateAnswer } from '../search/index';
import type { TurnContext } from './context';
import { allowedNumbersOf, asRef, extractInto, rememberEvidence, saveSource } from './evidence';

const SEARCH_FAILED =
  "Search failed: I could not get any web results for this, so I can't give you current facts on it. Try again, or rephrase the question.";

/** Saves a search hit as a source row and appends its numbered ref to evidence. */
function addHit(ctx: TurnContext, hit: SearchResult, entities: string[], evidence: SourceRef[]): void {
  const source = saveSource(ctx, {
    url: hit.url,
    finalUrl: hit.url,
    title: hit.title,
    publishedAt: hit.publishedAt,
    fetchedAtUtc: ctx.clock.now().toISOString(),
    live: false,
    firstParty: entities.some((entity) => isFirstParty(hit.url, entity)),
    httpStatus: null,
    text: hit.text.slice(0, ctx.config.limits.sourceTextChars),
  });
  evidence.push(asRef(source, evidence.length + 1));
}

export async function* fresh(ctx: TurnContext): AsyncIterable<AgentEvent> {
  const { plan } = ctx;
  // Every findTurns-style exclusion is irrelevant here; fresh only searches.
  const queries = plan.queries.slice(0, ctx.config.limits.queriesPerTurn);
  const toRun = queries.length > 0 ? queries : [ctx.input.message];

  yield { type: 'status', text: 'Searching the web…' };
  const doneSearch = ctx.timer('search');
  const results = await Promise.all(
    toRun.map((query) =>
      ctx.deps.search.search({ query, numResults: ctx.config.limits.resultsPerQuery, signal: ctx.signal }),
    ),
  );
  yield doneSearch();

  const evidence: SourceRef[] = [];
  const seen = new Set<string>();
  for (const hit of results.flat()) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    addHit(ctx, hit, plan.entities, evidence);
  }

  if (evidence.length === 0) {
    yield ctx.textEvent(SEARCH_FAILED);
    ctx.saveAssistant({ intent: 'fresh', extraction: 'skipped', targetTurnIds: [] });
    return;
  }

  // searchMore: a status event cannot be yielded from inside the callback, so
  // it is queued and drained between writer deltas below.
  const pendingStatuses: string[] = [];
  let toolCalls = 0;
  const searchMore = async (query: string): Promise<SourceRef[]> => {
    if (toolCalls >= ctx.config.limits.toolSearches) return [];
    toolCalls += 1;
    pendingStatuses.push(`Searching again: ${query}`);
    const hits = await ctx.deps.search.search({
      query,
      numResults: ctx.config.limits.resultsPerQuery,
      signal: ctx.signal,
    });
    const added: SourceRef[] = [];
    for (const hit of hits) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      addHit(ctx, hit, plan.entities, evidence);
      const ref = evidence[evidence.length - 1];
      if (ref !== undefined) added.push(ref);
    }
    return added;
  };

  ctx.stage = 'write';
  const doneWrite = ctx.timer('write');
  for await (const delta of ctx.deps.llm.write(
    {
      mode: 'fresh',
      message: ctx.input.message,
      recent: ctx.recent,
      evidence,
      searchMore,
    },
    ctx.signal,
  )) {
    for (const text of pendingStatuses.splice(0)) yield { type: 'status', text };
    yield ctx.textEvent(delta);
  }
  for (const text of pendingStatuses.splice(0)) yield { type: 'status', text };
  yield doneWrite();

  ctx.stage = 'validate';
  const doneValidate = ctx.timer('validate');
  const flags = validateAnswer(ctx.answer, evidence, allowedNumbersOf(ctx.input.message));
  yield doneValidate();
  yield {
    type: 'citations',
    items: evidence.map(({ text: _text, ...item }) => item),
  };
  yield { type: 'flags', ...flags };

  const turn = ctx.saveAssistant({ intent: 'fresh', extraction: 'pending', targetTurnIds: [] });
  rememberEvidence(ctx.store, turn.id, evidence);

  ctx.stage = 'extract';
  yield await extractInto(ctx, turn.id, ctx.answer, evidence);
}

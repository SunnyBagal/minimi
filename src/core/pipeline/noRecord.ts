/**
 * No record: the time ref resolved but nothing matched. Find the nearest
 * conversations anyway and let the writer say what it tried and what exists.
 */
import type { AgentEvent, DateCandidates } from '../contracts';
import type { TurnContext } from './context';

export async function* noRecord(ctx: TurnContext, candidates: DateCandidates): AsyncIterable<AgentEvent> {
  // Around the candidate dates; when only a range exists, its endpoints.
  const around =
    candidates.dates.length > 0
      ? candidates.dates
      : candidates.range !== null
        ? [candidates.range.from, candidates.range.to]
        : [];
  const nearest = ctx.store.nearestTurns({
    around,
    ...(ctx.plan.topic !== null ? { topic: ctx.plan.topic } : {}),
    ...(ctx.plan.entities.length > 0 ? { entities: ctx.plan.entities } : {}),
    excludeTurnIds: [ctx.currentId],
    limit: ctx.config.limits.recentTurns,
  });
  yield { type: 'recall', candidates, hits: [], chosen: null, asked: null, nearest };
  for await (const delta of ctx.deps.llm.write(
    { mode: 'no_record', message: ctx.input.message, tried: candidates, nearest },
    ctx.signal,
  )) {
    yield ctx.textEvent(delta);
  }
  ctx.saveAssistant({ intent: ctx.plan.intent, extraction: 'skipped', targetTurnIds: [] });
}

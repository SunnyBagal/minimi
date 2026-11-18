/**
 * No record: the time ref resolved but nothing matched. Find the nearest
 * conversations anyway. Code states the dates it tried and the nearest
 * matches (dates are exact, so code prints them); the writer then explains in
 * words and offers a fresh lookup without repeating any date.
 */
import type { AgentEvent, DateCandidates, MemoryHit } from '../contracts';
import { dateWords, orList } from '../dateWords';
import type { TurnContext } from './context';

/** How many nearest matches the code-built line names. */
const NEAREST_SHOWN = 3;

/** The code-built lines: what was tried, and the nearest saved conversations. Empty when nothing was tried. */
export function noRecordLines(candidates: DateCandidates, nearest: readonly MemoryHit[]): string {
  const lines: string[] = [];
  if (candidates.dates.length > 0) {
    lines.push(`I found no saved answer for ${orList(candidates.dates.map((date) => dateWords(date)))}.`);
  } else if (candidates.range !== null) {
    lines.push(
      `I found no saved answer between ${dateWords(candidates.range.from)} and ${dateWords(candidates.range.to)}.`,
    );
  }
  const shown = nearest.slice(0, NEAREST_SHOWN);
  if (shown.length === 1 && shown[0] !== undefined) {
    lines.push(`The nearest saved conversation is from ${dateWords(shown[0].userTurn.localDate)}: "${shown[0].userTurn.content}".`);
  } else if (shown.length > 1) {
    lines.push('The nearest saved conversations:');
    for (const hit of shown) lines.push(`- ${dateWords(hit.userTurn.localDate)}: "${hit.userTurn.content}"`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n\n`;
}

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
  const lines = noRecordLines(candidates, nearest);
  if (lines !== '') yield ctx.textEvent(lines);
  for await (const delta of ctx.deps.llm.write(
    { mode: 'no_record', message: ctx.input.message, tried: candidates, nearest },
    ctx.signal,
  )) {
    yield ctx.textEvent(delta);
  }
  ctx.saveAssistant({ intent: ctx.plan.intent, extraction: 'skipped', targetTurnIds: [] });
}

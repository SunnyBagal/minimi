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

/**
 * A stored question shown as literal text: one line, inside inline code, so
 * Markdown in it (headings, lists, links, emphasis) is never interpreted.
 */
export function literalExcerpt(text: string): string {
  return `\`${text.replace(/\s+/g, ' ').trim().replaceAll('`', "'")}\``;
}

/**
 * The code-built lines: what was tried (and about what), and the nearest saved
 * conversations. Empty when no date was tried and nothing is near.
 */
export function noRecordLines(candidates: DateCandidates, nearest: readonly MemoryHit[], topic: string | null): string {
  const lines: string[] = [];
  const about = topic === null || topic.trim() === '' ? '' : ` about ${topic.trim()}`;
  // Worded about what is saved, never about whether the conversation happened (judge check J3).
  if (candidates.dates.length > 0) {
    lines.push(
      `I have nothing saved${about} from ${orList(candidates.dates.map((date) => dateWords(date)))}, so I can't look that conversation up.`,
    );
  } else if (candidates.range !== null) {
    lines.push(
      `I have nothing saved${about} from ${dateWords(candidates.range.from)} to ${dateWords(candidates.range.to)}, so I can't look that conversation up.`,
    );
  }
  if (nearest.length === 1 && nearest[0] !== undefined) {
    lines.push(
      `The nearest saved conversation is from ${dateWords(nearest[0].userTurn.localDate)}: ${literalExcerpt(nearest[0].userTurn.content)}.`,
    );
  } else if (nearest.length > 1) {
    lines.push('The nearest saved conversations:');
    for (const hit of nearest) lines.push(`- ${dateWords(hit.userTurn.localDate)}: ${literalExcerpt(hit.userTurn.content)}`);
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
  // The user, the writer and the recall event all get the same few nearest matches.
  const nearest = ctx.store
    .nearestTurns({
    around,
    ...(ctx.plan.topic !== null ? { topic: ctx.plan.topic } : {}),
    ...(ctx.plan.entities.length > 0 ? { entities: ctx.plan.entities } : {}),
    excludeTurnIds: [ctx.currentId],
    limit: ctx.config.limits.recentTurns,
  })
    .slice(0, NEAREST_SHOWN);
  yield { type: 'recall', candidates, hits: [], chosen: null, asked: null, nearest };
  const lines = noRecordLines(candidates, nearest, ctx.plan.topic);
  if (lines !== '') yield ctx.textEvent(lines);
  for await (const delta of ctx.deps.llm.write(
    { mode: 'no_record', message: ctx.input.message, tried: candidates, nearest },
    ctx.signal,
  )) {
    yield ctx.textEvent(delta);
  }
  ctx.saveAssistant({ intent: ctx.plan.intent, extraction: 'skipped', targetTurnIds: [] });
}

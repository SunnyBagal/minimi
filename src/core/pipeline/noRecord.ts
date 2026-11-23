/**
 * No record: the time ref resolved but nothing matched. Find the nearest
 * conversations anyway. Code states the dates it tried and the nearest
 * matches (dates are exact, so code prints them); the writer then explains in
 * words and offers a fresh lookup without repeating any date.
 */
import type { AgentEvent, DateCandidates, LocalDate, MemoryHit } from '../contracts';
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
  // Questions saved on a date that was tried, but about something else (ui recall-fixes): name them
  // as from that day, so a renamed topic ("Grand Theft Auto VI" for "GTA 6") is not a dead end.
  const tried = (date: LocalDate) =>
    candidates.dates.includes(date) ||
    (candidates.range !== null && date >= candidates.range.from && date <= candidates.range.to);
  const sameDay = nearest.filter((hit) => tried(hit.userTurn.localDate));
  const other = nearest.filter((hit) => !tried(hit.userTurn.localDate));
  if (sameDay.length === 1 && sameDay[0] !== undefined) {
    lines.push(
      `On ${dateWords(sameDay[0].userTurn.localDate)} I do have: ${literalExcerpt(sameDay[0].userTurn.content)}.`,
    );
  } else if (sameDay.length > 1) {
    lines.push('On those dates I do have:');
    for (const hit of sameDay) lines.push(`- ${dateWords(hit.userTurn.localDate)}: ${literalExcerpt(hit.userTurn.content)}`);
  }
  if (other.length === 1 && other[0] !== undefined) {
    lines.push(
      `The nearest saved conversation is from ${dateWords(other[0].userTurn.localDate)}: ${literalExcerpt(other[0].userTurn.content)}.`,
    );
  } else if (other.length > 1) {
    lines.push('The nearest saved conversations:');
    for (const hit of other) lines.push(`- ${dateWords(hit.userTurn.localDate)}: ${literalExcerpt(hit.userTurn.content)}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n\n`;
}

/**
 * The few matches shown: topic matches on other days first, then questions from the tried
 * dates that matched only by date, then the rest; each turn once.
 */
export function mergeNearest(nearest: readonly MemoryHit[], sameDay: readonly MemoryHit[], limit: number): MemoryHit[] {
  const seen = new Set<string>();
  const out: MemoryHit[] = [];
  const add = (hit: MemoryHit) => {
    if (seen.has(hit.userTurn.id)) return;
    seen.add(hit.userTurn.id);
    out.push(hit);
  };
  for (const hit of nearest) if (hit.score > 0) add(hit);
  for (const hit of sameDay) add(hit);
  for (const hit of nearest) add(hit);
  return out.slice(0, limit);
}

export async function* noRecord(
  ctx: TurnContext,
  candidates: DateCandidates,
  sameDay: readonly MemoryHit[] = [],
): AsyncIterable<AgentEvent> {
  // Around the candidate dates; when only a range exists, its endpoints.
  const around =
    candidates.dates.length > 0
      ? candidates.dates
      : candidates.range !== null
        ? [candidates.range.from, candidates.range.to]
        : [];
  // The user, the writer and the recall event all get the same few nearest matches.
  const nearest = mergeNearest(
    ctx.store.nearestTurns({
      around,
      ...(ctx.plan.topic !== null ? { topic: ctx.plan.topic } : {}),
      ...(ctx.plan.entities.length > 0 ? { entities: ctx.plan.entities } : {}),
      excludeTurnIds: [ctx.currentId],
      limit: ctx.config.limits.recentTurns,
    }),
    sameDay,
    NEAREST_SHOWN,
  );
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

/**
 * Assertion helpers. Prose checks use includes() and a date or time pattern only.
 */
import type { AgentEvent, Claim, MemoryStore, Verdict, VerdictRow } from '../src/core/contracts';
import { containsQuote } from '../src/core/search/index';
import type { JudgeAnswer, JudgeId } from './judge';
import type { Assertion, CaseRun, TurnTrace } from './types';

export function ok(name: string, pass: boolean, observed: unknown): Assertion {
  return { name, pass, observed };
}

export function tracesOf(run: CaseRun, part = 0): TurnTrace[] {
  return run.parts[part]?.traces ?? [];
}

export function turnOf(run: CaseRun, part: number, index: number): TurnTrace {
  return tracesOf(run, part)[index] ?? { message: '', events: [], answerText: '' };
}

export function ofType<T extends AgentEvent['type']>(
  events: AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}

export function answerOf(events: AgentEvent[]): string {
  return ofType(events, 'text')
    .map((event) => event.delta)
    .join('');
}

export function recallOf(events: AgentEvent[]): Extract<AgentEvent, { type: 'recall' }> | undefined {
  return ofType(events, 'recall')[0];
}

export function verdictsOf(events: AgentEvent[]): VerdictRow[] {
  return ofType(events, 'verdict').map((event) => event.row);
}

export function verdictFor(events: AgentEvent[], entity: string, attribute: string): VerdictRow | undefined {
  return verdictsOf(events).find((row) => row.claim.entity === entity && row.claim.attribute === attribute);
}

export function hasDate(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

/** Digit tokens, so "19" and "2026" both count. Commas inside a token are kept out. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => match[0].replace(/,/g, ''));
}

function claimNumbers(claims: readonly Claim[]): string[] {
  return claims.flatMap((claim) => numbersIn(`${claim.value} ${claim.quote}`));
}

/**
 * Numbers in the answer must also appear in the user messages, the stored
 * claims, the verdict rows, the fetched source text, or the pipeline's own
 * "Checked <local time>" line. The last of those is code, not the model.
 */
export function numbersAllowed(run: CaseRun, events: AgentEvent[], sources: string[], label = ''): Assertion {
  const answer = answerOf(events);
  const body = answer.replace(/^Checked [^\n]*\n?/gm, '');
  const wanted = new Set(numbersIn(body));
  const allowed = new Set<string>([
    ...run.parts.flatMap((part) => part.traces.flatMap((trace) => numbersIn(trace.message))),
    ...claimNumbers(allClaims(run.store)),
    ...verdictsOf(events).flatMap((row) =>
      numbersIn(
        [row.claim.value, row.claim.quote, row.check.newValue ?? '', row.check.newQuote ?? '', row.check.reason].join(
          ' ',
        ),
      ),
    ),
    ...sources.flatMap((text) => numbersIn(text)),
    ...numbersIn(answer.match(/^Checked [^\n]*/gm)?.join(' ') ?? ''),
  ]);
  const extra = [...wanted].filter((token) => !allowed.has(token));
  const name =
    label === ''
      ? 'numbers are in the message, claims, rows or evidence'
      : `numbers are in the message, claims, rows or evidence (${label})`;
  return ok(name, extra.length === 0, extra);
}

function allClaims(store: MemoryStore): Claim[] {
  // InMemoryStore returns nothing when a query has no date and no topic overlap.
  // Every seed and eval clock in docs/02-evals.md is in November 2026.
  const hits = store.findTurns({
    range: { from: '2026-11-01', to: '2026-11-30' },
    excludeTurnIds: [],
    limit: 50,
  });
  const ids = hits.flatMap((hit) => (hit.assistantTurn === null ? [] : [hit.assistantTurn.id]));
  return store.claimsForTurns(ids, 'as_stated');
}

export function chosenIs(events: AgentEvent[], date: string | null): Assertion {
  const recall = recallOf(events);
  return ok(`chosen is ${date ?? 'null'}`, recall?.chosen === date, recall?.chosen ?? null);
}

export function candidateDates(events: AgentEvent[], dates: readonly string[]): Assertion {
  const got = recallOf(events)?.candidates.dates ?? [];
  const same = got.length === dates.length && dates.every((date) => got.includes(date));
  return ok(`candidates.dates is ${dates.join(', ')}`, same, got);
}

export function noVerdicts(events: AgentEvent[]): Assertion {
  const rows = verdictsOf(events);
  return ok('zero verdict events', rows.length === 0, rows.length);
}

export function intentIs(events: AgentEvent[], intent: string): Assertion {
  const done = ofType(events, 'done')[0];
  return ok(`done.intent is ${intent}`, done?.intent === intent, done?.intent ?? null);
}

export function verdictIs(events: AgentEvent[], entity: string, attribute: string, verdict: Verdict): Assertion {
  const row = verdictFor(events, entity, attribute);
  return ok(`${entity} ${attribute} is ${verdict}`, row?.check.verdict === verdict, row?.check.verdict ?? null);
}

export function judgeSaysNo(run: CaseRun, id: JudgeId): Assertion[] {
  const found = run.judge?.find((answer) => answer.id === id);
  if (found === undefined) {
    return [ok(`${id} answers no`, false, 'judge not run')];
  }
  const quoted = found.answer !== 'yes' || (found.quote !== null && found.quote.length > 0);
  return [
    ok(`${id} answers no`, found.answer === 'no', found.answer),
    ok(`${id} quotes the offending sentence when it answers yes`, quoted, found.quote),
  ];
}

export function quoteInPage(quote: string | null, pageText: string): boolean {
  return quote !== null && containsQuote(pageText, quote);
}

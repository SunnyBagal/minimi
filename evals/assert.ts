/**
 * Assertion helpers. Prose checks use includes() and a date or time pattern only.
 */
import type { AgentEvent, Claim, MemoryStore, Verdict, VerdictRow } from '../src/core/contracts';
import { containsQuote } from '../src/core/search/index';
import { formatLocal } from '../src/core/time/format';
import type { JudgeAnswer, JudgeId } from './judge';
import { TZ, type Assertion, type CaseRun, type TurnTrace } from './types';

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

/**
 * Digit tokens, so "19" and "2026" both count. Commas inside a token are kept out.
 * A list marker (`1.` or `1)` at the start of a line, then whitespace) is dropped
 * only when `ignoreListMarkers` is set. That is the scored reading. The rule is
 * the one in `validateAnswer`.
 */
export function numbersIn(text: string, ignoreListMarkers = false): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const start = match.index ?? 0;
    const raw = match[0];
    if (ignoreListMarkers && isListMarker(text, start, start + raw.length)) continue;
    tokens.push(raw.replace(/,/g, ''));
  }
  return tokens;
}

/** Same shape as `isListMarker` in `src/core/search/validate.ts`. */
function isListMarker(text: string, start: number, end: number): boolean {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  if (text.slice(lineStart, start).trim() !== '') return false;
  const next = text[end];
  return (next === '.' || next === ')') && /\s/.test(text[end + 1] ?? '');
}

/** `03` equals `3`, `24.00` equals `24`, `1200` equals `1200`. `30` does not equal `03`. */
function tokenValue(token: string): number {
  return Number(token);
}

function extras(wanted: readonly string[], allowed: Iterable<string>): string[] {
  const allowedValues = new Set<number>();
  for (const token of allowed) allowedValues.add(tokenValue(token));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of wanted) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (!allowedValues.has(tokenValue(token))) out.push(token);
  }
  return out;
}

function claimNumbers(claims: readonly Claim[]): string[] {
  return claims.flatMap((claim) => numbersIn(`${claim.value} ${claim.quote}`));
}

/** The spec's literal number check. It is recorded, and it does not score the run. */
export const LITERAL_NUMBERS_PREFIX =
  'numbersIn(answerText) is a subset of the numbers in evidence, verdict rows, stored claims and the user message';

export const SCORED_NUMBERS_PREFIX = 'numbers are in the message, claims, rows or evidence';

const SEARCH_FAILED_LINE =
  "Search failed: I could not get any web results for this, so I can't give you current facts on it. Try again, or rephrase the question.";

/** Whole lines the pipeline builds in code. Anchored to the fixed wording. */
const CODE_LINE: readonly RegExp[] = [
  /^On .+ you asked: ".*"\.(?: \(seeded demo history\))?$/,
  /^I found more than one conversation that could match:$/,
  /^Which one do you mean\?$/,
  /^- .+?, \d{2}:\d{2} .+: ".*"$/,
  /^- .+ \(as of .+; from memory, not re-checked\)$/,
  /^Skipped \d+ lower-priority claim\(s\) over the limit of \d+: .+\.$/,
  /^\(\d+ undated search result\(s\) were set aside\.\)$/,
];

const literalByRun = new WeakMap<CaseRun, Assertion[]>();

function withoutChecked(answer: string): string {
  return answer.replace(/^Checked [^\n]*\n?/gm, '');
}

/** Drops the code-built lines. The Checked line is removed by the caller. */
export function withoutCodeBuiltLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => line !== SEARCH_FAILED_LINE && !CODE_LINE.some((pattern) => pattern.test(line)))
    .join('\n');
}

function baseAllowed(run: CaseRun, events: AgentEvent[], sources: string[], answer: string): Set<string> {
  return new Set<string>([
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
}

function caseZone(run: CaseRun, events: AgentEvent[]): string {
  for (const part of run.parts) {
    if (part.traces.some((trace) => trace.events === events)) return part.tz;
  }
  return TZ;
}

/** Digits of the dates the system itself emitted on this turn. Nothing else. */
function emittedDateNumbers(events: AgentEvent[], zone: string): string[] {
  const recall = recallOf(events);
  const texts: string[] = [];
  if (recall !== undefined) {
    texts.push(...recall.candidates.dates);
    if (recall.candidates.range !== null) {
      texts.push(recall.candidates.range.from, recall.candidates.range.to);
    }
    for (const hit of recall.hits) {
      texts.push(hit.userTurn.localDate);
      texts.push(formatLocal(hit.userTurn.createdAtUtc, hit.userTurn.tz));
    }
  }
  for (const row of verdictsOf(events)) {
    texts.push(formatLocal(row.claim.asOfUtc, zone));
    texts.push(formatLocal(row.check.checkedAtUtc, zone));
  }
  return texts.flatMap((text) => numbersIn(text));
}

function recordLiteral(run: CaseRun, assertion: Assertion): void {
  const list = literalByRun.get(run) ?? [];
  list.push(assertion);
  literalByRun.set(run, list);
}

/** Literal number checks recorded while `numbersAllowed` ran. The harness appends them. */
export function literalAssertions(run: CaseRun): Assertion[] {
  return literalByRun.get(run) ?? [];
}

/**
 * Scored reading: code-built lines are not the model's numbers, and digits of
 * dates the system emitted are allowed. The spec's literal reading is recorded
 * beside it and does not decide `passed`.
 */
export function numbersAllowed(run: CaseRun, events: AgentEvent[], sources: string[], label = ''): Assertion {
  const answer = answerOf(events);
  const literalBody = withoutChecked(answer);
  const scoredBody = withoutCodeBuiltLines(literalBody);
  const allowed = baseAllowed(run, events, sources, answer);
  const literalExtra = extras(numbersIn(literalBody), allowed);
  const scoredAllowed = new Set<string>([...allowed, ...emittedDateNumbers(events, caseZone(run, events))]);
  const scoredExtra = extras(numbersIn(scoredBody, true), scoredAllowed);
  const suffix = label === '' ? '' : ` (${label})`;
  recordLiteral(run, ok(`${LITERAL_NUMBERS_PREFIX}${suffix}`, literalExtra.length === 0, literalExtra));
  return ok(`${SCORED_NUMBERS_PREFIX}${suffix}`, scoredExtra.length === 0, scoredExtra);
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

/**
 * Assertion helpers. Prose checks use includes() and a date or time pattern only.
 */
import type { AgentEvent, Claim, MemoryStore, Verdict, VerdictRow } from '../src/core/contracts';
import { containsQuote } from '../src/core/search/index';
import { recallHeadline } from '../src/core/recallHeadline';
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

/**
 * The recall card's headline ("On <date> you asked: ..."), built from the
 * recall event's `asked` field with the same function the UI uses.
 */
export function headlineOf(events: AgentEvent[], viewerTz: string): string | null {
  const asked = recallOf(events)?.asked ?? null;
  return asked === null ? null : recallHeadline(asked, formatLocal, viewerTz);
}

/** What the user sees for a turn: the recall card's headline, then the streamed text. */
export function shownAnswerOf(events: AgentEvent[], viewerTz: string): string {
  const headline = headlineOf(events, viewerTz);
  const text = answerOf(events);
  return headline === null ? text : `${headline}\n${text}`;
}

/** Sentences of an answer, split at . ! ? before whitespace, and at line breaks. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

const NO_CHANGE =
  /\b(?:no change|unchanged|not changed|hasn't changed|has not changed|nothing has changed|still holds|still the same|same price)\b/i;
const UNSURE = /\b(?:can't|cannot|can not|couldn't|could not|unable|not able|whether|unclear|not sure|unknown)\b/i;

/** Clauses of a sentence, split at , ; : and at "but", "while", "whereas", "although". */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(/[,;:]|\s(?:but|while|whereas|although)\s/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '');
}

/** A clause that opens by referring back to the current subject. */
const BACK_REFERENCE = /^(?:it|its|it's|this|that|the price|the page|the plan|their|they)\b/i;

type Subject = 'entity' | 'other';

interface Mention {
  subject: Subject;
  start: number;
  end: number;
}

function mentionsIn(clause: string, entity: RegExp, others: RegExp | undefined): Mention[] {
  const found: Mention[] = [];
  const scan = (pattern: RegExp, subject: Subject): void => {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of clause.matchAll(global)) {
      found.push({ subject, start: match.index, end: match.index + match[0].length });
    }
  };
  scan(entity, 'entity');
  if (others !== undefined) scan(others, 'other');
  return found.sort((a, b) => a.start - b.start);
}

/** Between two coordinated names: the rest of the first name (capitalised tails such as "PG"), then a joiner. */
const COORDINATION_GAP = /^(?:\s+[A-Z][\w.-]*)*\s*(?:,|and|&|, and)\s*(?:the\s+)?$/;

/**
 * The subjects a phrase at `at` is about: the product named last before it,
 * plus any named just before that and joined to it by "and", "&" or a comma
 * ("Northwind PG and Basalt DB are unchanged"). Empty when nothing is named
 * before the phrase.
 */
function subjectsBefore(clause: string, mentions: Mention[], at: number): Subject[] {
  const before = mentions.filter((mention) => mention.end <= at);
  const last = before.at(-1);
  if (last === undefined) return [];
  const subjects: Subject[] = [last.subject];
  for (let index = before.length - 2; index >= 0; index -= 1) {
    const current = before[index];
    const next = before[index + 1];
    if (current === undefined || next === undefined) break;
    if (!COORDINATION_GAP.test(clause.slice(current.end, next.start))) break;
    subjects.push(current.subject);
  }
  return subjects;
}

/**
 * The subjects a phrase ending at `from` is about when nothing is named
 * before it ("No change for Basalt DB and Northwind PG"): the first product
 * named after it, plus any coordinated to it.
 */
function subjectsAfter(clause: string, mentions: Mention[], from: number): Subject[] {
  const after = mentions.filter((mention) => mention.start >= from);
  const first = after[0];
  if (first === undefined) return [];
  const subjects: Subject[] = [first.subject];
  for (let index = 1; index < after.length; index += 1) {
    const previous = after[index - 1];
    const current = after[index];
    if (previous === undefined || current === undefined) break;
    if (!COORDINATION_GAP.test(clause.slice(previous.end, current.start))) break;
    subjects.push(current.subject);
  }
  return subjects;
}

/**
 * True when some clause asserts that nothing changed for the entity. Every
 * no-change phrase in a clause is attributed separately: to the product named
 * closest before it (with any products coordinated to that one by "and"),
 * else to the first one named after it with its coordinated names ("no change
 * for Basalt DB and Northwind PG"); with none named, a clause that opens with
 * a back reference ("Its price is unchanged") belongs to the current subject,
 * which carries across clauses that name no product. Naming one of `others`
 * makes that the subject. Uncertainty ("can't say whether ... still holds")
 * vetoes only its own clause. Prose this does not resolve is left to the
 * case's semantic judge (J2).
 */
export function claimsNoChangeAbout(answer: string, entity: RegExp, others?: RegExp): boolean {
  const phrases = new RegExp(NO_CHANGE.source, 'gi');
  let current: Subject | null = null;
  for (const sentence of sentencesOf(answer)) {
    for (const clause of clausesOf(sentence)) {
      const mentions = mentionsIn(clause, entity, others);
      if (!UNSURE.test(clause)) {
        for (const phrase of clause.matchAll(phrases)) {
          const named = subjectsBefore(clause, mentions, phrase.index);
          const after = named.length > 0 ? [] : subjectsAfter(clause, mentions, phrase.index + phrase[0].length);
          const subjects =
            named.length > 0
              ? named
              : after.length > 0
                ? after
                : BACK_REFERENCE.test(clause) && current !== null
                  ? [current]
                  : [];
          if (subjects.includes('entity')) return true;
        }
      }
      const lastMention = mentions.at(-1);
      if (lastMention !== undefined) current = lastMention.subject;
    }
  }
  return false;
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

/** `[n]` spans. Same pattern `validateAnswer` uses to skip digits inside a citation. */
function citationSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length });
  }
  return spans;
}

/**
 * Digit tokens, so "19" and "2026" both count. Commas inside a token are kept out.
 * When `scored` is set, drop a list marker (`1.` or `1)` at the start of a line,
 * then whitespace) and drop a token that sits entirely inside `[n]`. Both rules
 * are the ones in `validateAnswer`. The literal reading leaves them in.
 */
export function numbersIn(text: string, scored = false): string[] {
  const citations = scored ? citationSpans(text) : [];
  const tokens: string[] = [];
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const end = start + raw.length;
    if (scored && isListMarker(text, start, end)) continue;
    if (scored && citations.some((span) => start >= span.start && end <= span.end)) continue;
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

const literalByRun = new WeakMap<CaseRun, Assertion[]>();

function baseAllowed(run: CaseRun, events: AgentEvent[], sources: string[]): Set<string> {
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
    // The no-record writer is given each nearest turn's local date and question, not its time.
    for (const hit of recall.nearest ?? []) texts.push(hit.userTurn.localDate);
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

/** The writer's own text for the turn that produced `events`; all streamed text when no record exists. */
function modelTextOf(run: CaseRun, events: AgentEvent[]): string {
  for (const part of run.parts) {
    for (const trace of part.traces) {
      if (trace.events === events && trace.modelText !== undefined) return trace.modelText;
    }
  }
  return answerOf(events);
}

/**
 * Both readings check only what the model's writer produced on the turn
 * (`TurnTrace.modelText`, recorded by the harness). Text the app's code
 * injected (the recall card's headline, the "Checked" line, memory rows,
 * ambiguity choices, the undated-results note) is outside it by provenance,
 * not by its wording, so a model sentence styled like one of those lines is
 * still checked.
 *
 * Literal reading (the spec's subset check on the model's text): every digit,
 * list markers and citation digits included, must appear in the message,
 * claims, verdict rows or evidence. Recorded; it does not decide `passed`.
 *
 * Scored reading: as literal, plus line-start list markers and digits inside
 * `[n]` are skipped (the `validateAnswer` rules), and digits of dates the
 * system emitted on this turn (recall candidates and hits, the nearest turns'
 * local dates, verdict dates) are allowed.
 */
export function numbersAllowed(run: CaseRun, events: AgentEvent[], sources: string[], label = ''): Assertion {
  const zone = caseZone(run, events);
  const modelBody = modelTextOf(run, events);
  const allowed = baseAllowed(run, events, sources);
  const literalExtra = extras(numbersIn(modelBody), allowed);
  const scoredAllowed = new Set<string>([...allowed, ...emittedDateNumbers(events, zone)]);
  const scoredExtra = extras(numbersIn(modelBody, true), scoredAllowed);
  const suffix = label === '' ? '' : ` (${label})`;
  recordLiteral(run, ok(`${LITERAL_NUMBERS_PREFIX}${suffix}`, literalExtra.length === 0, literalExtra));
  return ok(`${SCORED_NUMBERS_PREFIX}${suffix}`, scoredExtra.length === 0, scoredExtra);
}

export function allClaims(store: MemoryStore): Claim[] {
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

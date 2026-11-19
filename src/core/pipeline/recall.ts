/**
 * Recall and recheck share the first half: resolve which stored answer the
 * user means (by date, by topic, or "the previous answer"), emit the recall event
 * (which carries the chosen question as `asked`; the UI shows it above the
 * answer, so the answer text does not repeat it), then either list the claims
 * from memory or hand off to the re-check.
 *
 * Choosing: group the store's hits by their user turn's local date. Undated
 * lookups require topic overlap, as do dated lookups that name a topic.
 * For those lookups, dates whose best hit scores below MIN_SCORE_SHARE of
 * the top score are dropped first. One remaining date → its highest-scoring
 * hit. More than one → ambiguous. None → no record.
 */
import type {
  AgentEvent,
  Claim,
  ClaimVersion,
  DateCandidates,
  Id,
  LocalDate,
  MemoryHit,
  RecalledQuestion,
  Turn,
} from '../contracts';
import { claimLabel } from '../claimLabel';
import { dateWords } from '../dateWords';
import { REPEAT_QUESTION_RULE } from '../recallHeadline';
import { noRecord } from './noRecord';
import { recheck } from './recheck';
import { evidenceFor, extractInto } from './evidence';
import type { TurnContext } from './context';

/** The candidates for "the previous answer": just that turn's local date. */
function previousAnswerCandidates(localDate: LocalDate): DateCandidates {
  return {
    dates: [localDate],
    range: null,
    ambiguous: false,
    rule: 'the previous answer in this session',
  };
}

/** Builds the single hit for a refersToPrevious lookup, when a user turn exists. */
function previousAnswerHits(recent: Turn[], referenced: Turn): MemoryHit[] {
  const index = recent.findIndex((turn) => turn.id === referenced.id);
  const userTurn = index > 0 ? recent[index - 1] : undefined;
  if (userTurn === undefined || userTurn.role !== 'user') return [];
  return [{ userTurn, assistantTurn: referenced, matched: 'date', score: 0 }];
}

/**
 * A date that shares one generic word ("pricing") with the question while
 * another date shares most of its terms is not a competing match; two dates
 * with comparable scores stay ambiguous. The choosing step drops every date
 * whose best hit scores less than this fraction of the top best score.
 */
const MIN_SCORE_SHARE = 0.5;

/** The user turns of `hits`, grouped by local date, in the order they appear. */
function datesWithHits(hits: MemoryHit[], withTopic: boolean): Map<LocalDate, MemoryHit[]> {
  const byDate = new Map<LocalDate, MemoryHit[]>();
  for (const hit of hits) {
    if (withTopic && hit.matched !== 'date+topic') continue;
    const date = hit.userTurn.localDate;
    const group = byDate.get(date) ?? [];
    group.push(hit);
    byDate.set(date, group);
  }
  return byDate;
}

/** The chosen question as a structured field; the UI renders it with `recallHeadline`. */
function askedOf(userTurn: Turn): RecalledQuestion {
  return {
    turnId: userTurn.id,
    question: userTurn.content,
    createdAtUtc: userTurn.createdAtUtc,
    tz: userTurn.tz,
    origin: userTurn.origin,
  };
}

/** The code-built "which one do you mean?" question for an ambiguous match. */
function ambiguousLine(hits: MemoryHit[], ctx: TurnContext): string {
  const lines = hits.map((hit) => {
    const when = ctx.time.formatLocal(hit.userTurn.createdAtUtc, hit.userTurn.tz);
    return `- ${when}: "${hit.userTurn.content}"`;
  });
  return `I found more than one conversation that could match:\n${lines.join('\n')}\nWhich one do you mean?`;
}

/** What the re-check needs from the resolution: targets, baseline, versions. */
export interface Resolved {
  targets: Id[];
  version: ClaimVersion;
  baseline: Claim[];
  askedOn: LocalDate;
}

/** Picks targets and loads the baseline, extracting a pending turn on demand. */
async function resolveTargets(ctx: TurnContext, referenced: Turn, askedOn: LocalDate): Promise<Resolved> {
  const targets = referenced.targetTurnIds.length === 0 ? [referenced.id] : referenced.targetTurnIds;
  const version: ClaimVersion = referenced.targetTurnIds.length === 0 ? 'as_stated' : 'current';
  // A pending target turn gets extracted now, in this process, using the
  // evidence it cited (the registry knows it only while the process lives).
  for (const target of ctx.store.getTurns(targets)) {
    if (target.extraction === 'done') continue;
    const refs = evidenceFor(ctx.store, target.id);
    if (refs === null) continue;
    await extractInto(ctx, target.id, target.content, refs);
  }
  return { targets, version, baseline: ctx.store.claimsForTurns(targets, version), askedOn };
}

const NO_STORED_FACTS = 'That answer has no stored facts to check. I can look this up fresh if you like.';

export async function* repeatAnswer(ctx: TurnContext, hit: MemoryHit & { assistantTurn: Turn }): AsyncIterable<AgentEvent> {
  ctx.stage = 'resolve';
  const doneResolve = ctx.timer('resolve');
  const { userTurn, assistantTurn } = hit;
  const chosen = userTurn.localDate;
  yield {
    type: 'recall',
    candidates: { dates: [chosen], range: null, ambiguous: false, rule: REPEAT_QUESTION_RULE },
    hits: [hit],
    chosen,
    asked: askedOf(userTurn),
  };
  yield doneResolve();

  const resolved = await resolveTargets(ctx, assistantTurn, chosen);
  if (resolved.baseline.length > 0) {
    ctx.plan = { ...ctx.plan, intent: 'recheck' };
    yield* recheck(ctx, resolved);
    return;
  }

  // A derived answer can lose its underlying claims when its targets are hidden.
  const memory = assistantTurn.targetTurnIds.length === 0 ? assistantTurn.content : null;
  ctx.plan = { ...ctx.plan, intent: 'recall' };
  yield ctx.textEvent(memory === null ? NO_STORED_FACTS : `From memory:\n\n${memory}\n\nI can look this up fresh if you like.`);
  ctx.saveAssistant({ intent: 'recall', extraction: 'skipped', targetTurnIds: [] });
}

export async function* recall(ctx: TurnContext): AsyncIterable<AgentEvent> {
  ctx.stage = 'resolve';
  const doneResolve = ctx.timer('resolve');
  const { plan, recent } = ctx;

  let candidates: DateCandidates;
  let hits: MemoryHit[];
  let chosen: LocalDate | null = null;
  let chosenHit: MemoryHit | null = null;
  let ambiguousHits: MemoryHit[] = [];
  let referenced: Turn | null = null;
  let topicOnly = false;

  // A message that names a date ("On 9 November … is that still correct?") is about that date, even
  // when the router also set refersToPrevious: code enforces the router's own rule (router.md).
  const previousAnswer = plan.refersToPrevious && plan.timeRef.kind === 'none';
  if (previousAnswer) {
    // "Is that still right?" names the last assistant turn in the session.
    referenced = [...recent].reverse().find((turn) => turn.role === 'assistant') ?? null;
    if (referenced === null) {
      // No previous answer at all: no date was looked up, so no date is tried.
      yield* noRecord(ctx, { dates: [], range: null, ambiguous: false, rule: 'no previous answer in this session' });
      yield doneResolve();
      return;
    }
    candidates = previousAnswerCandidates(referenced.localDate);
    hits = previousAnswerHits(recent, referenced);
    chosen = referenced.localDate;
    chosenHit = hits[0] ?? null;
  } else {
    candidates = ctx.time.resolveTimeRef(plan.timeRef, ctx.now, ctx.tz);
    topicOnly = candidates.dates.length === 0 && candidates.range === null;
    if (topicOnly && plan.topic === null && plan.entities.length === 0) {
      yield* noRecord(ctx, candidates);
      yield doneResolve();
      return;
    }
    hits = ctx.store.findTurns({
      ...(candidates.dates.length > 0 ? { dates: candidates.dates } : {}),
      ...(candidates.range !== null ? { range: candidates.range } : {}),
      ...(plan.topic !== null ? { topic: plan.topic } : {}),
      ...(plan.entities.length > 0 ? { entities: plan.entities } : {}),
      excludeTurnIds: [ctx.currentId],
      // The "how many turns to show" default is reused for memory lookup.
      limit: ctx.config.limits.recentTurns,
    });
    if (topicOnly) hits = hits.filter((hit) => hit.matched.includes('topic'));
    const dateStatus = plan.timeRef.kind === 'none' ? 'no date given' : 'no date resolved';
    const qualifying = [...datesWithHits(hits, !topicOnly && plan.topic !== null).entries()];
    if (qualifying.length === 0) {
      if (topicOnly) candidates = { ...candidates, rule: `${dateStatus}: no topic match` };
      yield* noRecord(ctx, candidates);
      yield doneResolve();
      return;
    }
    let choices = qualifying;
    if ((topicOnly || plan.topic !== null) && choices.length > 1) {
      const bestOf = (dateHits: MemoryHit[]): number =>
        dateHits.reduce((best, hit) => Math.max(best, hit.score), 0);
      const top = Math.max(...choices.map(([, dateHits]) => bestOf(dateHits)));
      choices = choices.filter(([, dateHits]) => bestOf(dateHits) >= top * MIN_SCORE_SHARE);
    }
    if (topicOnly) {
      candidates = {
        dates: choices.map(([date]) => date),
        range: null,
        ambiguous: choices.length > 1,
        rule: `${dateStatus}: matched by topic`,
      };
    }
    ambiguousHits = choices.flatMap(([, dateHits]) => dateHits);
    if (choices.length === 1) {
      const [date, dateHits] = choices[0] ?? [null, []];
      chosen = date;
      chosenHit = dateHits.reduce((a, b) => (b.score > a.score ? b : a));
      referenced = chosenHit.assistantTurn;
    }
  }

  const asked = chosen !== null && chosenHit !== null ? askedOf(chosenHit.userTurn) : null;
  yield { type: 'recall', candidates, hits, chosen, asked };
  yield doneResolve();

  // A numeric date ("3/11") reads two ways; say in words which one was used (design review 2.7).
  // Only when the date came from the numeric lookup, never on the previous-answer path.
  if (
    !previousAnswer &&
    !topicOnly &&
    chosen !== null &&
    plan.timeRef.kind === 'numeric' &&
    plan.timeText !== null &&
    candidates.dates.includes(chosen)
  ) {
    yield ctx.textEvent(`I read "${plan.timeText}" as ${dateWords(chosen, 'long')}.\n`);
  }

  if (chosen === null) {
    // Ambiguous: name each candidate with the user's own question as its summary.
    // Only the dates still competing after the score-share rule are listed.
    yield ctx.textEvent(ambiguousLine(ambiguousHits, ctx));
    ctx.saveAssistant({ intent: plan.intent, extraction: 'skipped', targetTurnIds: [] });
    return;
  }

  if (referenced === null) {
    // The chosen question has no stored answer: nothing to check.
    yield ctx.textEvent(NO_STORED_FACTS);
    ctx.saveAssistant({ intent: plan.intent, extraction: 'skipped', targetTurnIds: [] });
    return;
  }

  const resolved = await resolveTargets(ctx, referenced, chosen ?? referenced.localDate);

  if (resolved.baseline.length === 0) {
    yield ctx.textEvent(NO_STORED_FACTS);
    ctx.saveAssistant({ intent: plan.intent, extraction: 'skipped', targetTurnIds: [] });
    return;
  }

  if (plan.intent === 'recall') {
    const lines = resolved.baseline.map(
      (claim) =>
        `- ${claimLabel(claim)}: ${claim.value} (as of ${ctx.time.formatLocal(
          claim.asOfUtc,
          ctx.tz,
        )}; from memory, not re-checked)`,
    );
    yield ctx.textEvent(lines.join('\n'));
    ctx.saveAssistant({ intent: 'recall', extraction: 'skipped', targetTurnIds: resolved.targets });
    return;
  }

  yield* recheck(ctx, resolved);
}

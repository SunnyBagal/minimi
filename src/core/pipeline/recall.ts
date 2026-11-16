/**
 * Recall and recheck share the first half: resolve which stored answer the
 * user means (a date ref or "the previous answer"), emit the recall event and
 * the code-built recall line, then either list the claims from memory or hand
 * off to the re-check.
 *
 * Choosing: group the store's hits by their user turn's local date. When the
 * plan names a topic, only dates with a 'date+topic' hit qualify; otherwise
 * any hit qualifies. One qualifying date → the highest-scoring hit on it.
 * More than one → ambiguous. None → no record.
 */
import type {
  AgentEvent,
  Claim,
  ClaimVersion,
  DateCandidates,
  Id,
  LocalDate,
  MemoryHit,
  Turn,
} from '../contracts';
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

/** The code-built "On <date> you asked: ..." line shown before the answer. */
function recallLine(ctx: TurnContext, userTurn: Turn): string {
  const when = ctx.time.formatLocal(userTurn.createdAtUtc, userTurn.tz);
  const zoneNote = userTurn.tz !== ctx.tz ? ` (${userTurn.tz})` : '';
  const seeded = userTurn.origin === 'seed' ? ' (seeded demo history)' : '';
  return `On ${when}${zoneNote} you asked: "${userTurn.content}".${seeded}\n`;
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

export async function* recall(ctx: TurnContext): AsyncIterable<AgentEvent> {
  ctx.stage = 'resolve';
  const doneResolve = ctx.timer('resolve');
  const { plan, recent } = ctx;

  let candidates: DateCandidates;
  let hits: MemoryHit[];
  let chosen: LocalDate | null = null;
  let chosenHit: MemoryHit | null = null;
  let referenced: Turn | null = null;

  if (plan.refersToPrevious) {
    // "Is that still right?" names the last assistant turn in the session.
    referenced = [...recent].reverse().find((turn) => turn.role === 'assistant') ?? null;
    if (referenced === null) {
      // No previous answer at all: nothing was tried, so this is a no record.
      yield* noRecord(ctx, previousAnswerCandidates(ctx.time.toLocalDate(ctx.now, ctx.tz)));
      yield doneResolve();
      return;
    }
    candidates = previousAnswerCandidates(referenced.localDate);
    hits = previousAnswerHits(recent, referenced);
    chosen = referenced.localDate;
    chosenHit = hits[0] ?? null;
  } else {
    candidates = ctx.time.resolveTimeRef(plan.timeRef, ctx.now, ctx.tz);
    const hasDates = candidates.dates.length > 0;
    const hasRange = candidates.range !== null;
    if (!hasDates && !hasRange) {
      yield* noRecord(ctx, candidates);
      yield doneResolve();
      return;
    }
    hits = ctx.store.findTurns({
      ...(hasDates ? { dates: candidates.dates } : {}),
      ...(hasRange && candidates.range !== null ? { range: candidates.range } : {}),
      ...(plan.topic !== null ? { topic: plan.topic } : {}),
      ...(plan.entities.length > 0 ? { entities: plan.entities } : {}),
      excludeTurnIds: [ctx.currentId],
      // The "how many turns to show" default is reused for memory lookup.
      limit: ctx.config.limits.recentTurns,
    });
    const qualifying = [...datesWithHits(hits, plan.topic !== null).entries()];
    if (qualifying.length === 0) {
      yield* noRecord(ctx, candidates);
      yield doneResolve();
      return;
    }
    if (qualifying.length === 1) {
      const [date, dateHits] = qualifying[0] ?? [null, []];
      chosen = date;
      chosenHit = dateHits.reduce((a, b) => (b.score > a.score ? b : a));
      referenced = chosenHit.assistantTurn;
    }
  }

  yield { type: 'recall', candidates, hits, chosen };
  yield doneResolve();

  if (chosen === null) {
    // Ambiguous: name each candidate with the user's own question as its summary.
    const qualifyingHits = [...datesWithHits(hits, plan.topic !== null).values()].flat();
    yield ctx.textEvent(ambiguousLine(qualifyingHits, ctx));
    ctx.saveAssistant({ intent: plan.intent, extraction: 'skipped', targetTurnIds: [] });
    return;
  }

  if (chosenHit !== null) yield ctx.textEvent(recallLine(ctx, chosenHit.userTurn));

  if (referenced === null) {
    // The chosen question has no stored answer: nothing to check.
    yield ctx.textEvent('That answer has no stored facts to check. I can look this up fresh if you like.');
    ctx.saveAssistant({ intent: plan.intent, extraction: 'skipped', targetTurnIds: [] });
    return;
  }

  const resolved = await resolveTargets(ctx, referenced, chosen ?? referenced.localDate);

  if (resolved.baseline.length === 0) {
    yield ctx.textEvent('That answer has no stored facts to check. I can look this up fresh if you like.');
    ctx.saveAssistant({ intent: plan.intent, extraction: 'skipped', targetTurnIds: [] });
    return;
  }

  if (plan.intent === 'recall') {
    const lines = resolved.baseline.map(
      (claim) =>
        `- ${claim.entity} ${claim.attribute}: ${claim.value} (as of ${ctx.time.formatLocal(
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

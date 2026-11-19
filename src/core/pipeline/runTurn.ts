/**
 * The full turn pipeline: persist the user turn, route, branch on the routed
 * intent (chat, fresh, recall/recheck), then finish. Time functions and the
 * verdict guard come from `deps`, never from an import.
 *
 * Finish: on any thrown error the turn emits `error` with the stage, saves
 * whatever text the user already saw, runs the queued afterSave callbacks and
 * still emits `done`.
 */
import type { AgentEvent, RouterPlan, RunTurn } from '../contracts';
import { withAssistantOrigin } from '../store/assistantVisibility';
import { TurnContext } from './context';
import { chat } from './chat';
import { fresh } from './fresh';
import { recall } from './recall';

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export const runTurn: RunTurn = async function* (input, deps): AsyncIterable<AgentEvent> {
  const { clock, store, llm, time, config } = deps;
  const turnDeadline = AbortSignal.timeout(config.deadlinesMs.turn);
  const signal = input.signal ? AbortSignal.any([input.signal, turnDeadline]) : turnDeadline;

  // Read history before saving, so `recent` never contains the current message.
  const recent = store.recentTurns(input.sessionId, config.limits.recentTurns);
  const askedAt = clock.now();
  const persistStart = askedAt.getTime();
  const userTurn = store.saveTurn({
    sessionId: input.sessionId,
    role: 'user',
    content: input.message,
    createdAtUtc: askedAt.toISOString(),
    tz: input.tz,
    localDate: time.toLocalDate(askedAt, input.tz),
    origin: input.origin ?? 'live',
    topic: null,
    entities: [],
    summary: null,
    targetTurnIds: [],
    extraction: 'skipped',
    intent: null,
  });

  yield { type: 'status', text: 'Thinking…' };
  yield { type: 'timing', stage: 'persist', ms: clock.now().getTime() - persistStart };

  // The ctx needs a plan to exist; it is filled in right after routing.
  let ctx: TurnContext | null = null;
  let plan: RouterPlan | null = null;
  let answer = '';
  let stage = 'route';
  try {
    const routeStart = clock.now().getTime();
    plan = await llm.route({
      message: input.message,
      recent,
      nowLocal: time.formatLocal(askedAt.toISOString(), input.tz),
      tz: input.tz,
    });
    store.updateTurnMeta(userTurn.id, { topic: plan.topic, entities: plan.entities, summary: null });
    yield { type: 'timing', stage: 'route', ms: clock.now().getTime() - routeStart };

    ctx = new TurnContext({
      deps,
      input,
      tz: input.tz,
      plan,
      recent,
      currentId: userTurn.id,
      now: askedAt,
      signal,
    });

    if (plan.intent === 'chat') {
      yield* chat(ctx);
    } else if (plan.intent === 'fresh') {
      yield* fresh(ctx);
    } else {
      // recall and recheck share the answer-finding first half.
      yield* recall(ctx);
    }
  } catch (error) {
    stage = ctx?.stage ?? 'route';
    answer = ctx?.answer ?? answer;
    yield { type: 'error', stage, message: describeError(error) };
  }

  // Save what exists, even after an error, so the turn is never half-recorded.
  if (ctx !== null) {
    ctx.saveAssistant({ intent: plan?.intent ?? 'chat', extraction: 'skipped', targetTurnIds: [] });
  }
  const savedId = ctx?.savedTurnId ?? null;
  const loaded = savedId !== null ? store.getTurns([savedId])[0] : undefined;
  const assistant =
    savedId !== null
      ? loaded
      : withAssistantOrigin(userTurn.id, () =>
          store.saveTurn({
            sessionId: input.sessionId,
            role: 'assistant',
            content: answer,
            createdAtUtc: clock.now().toISOString(),
            tz: input.tz,
            localDate: time.toLocalDate(clock.now(), input.tz),
            origin: input.origin ?? 'live',
            topic: plan?.topic ?? null,
            entities: plan?.entities ?? [],
            summary: null,
            targetTurnIds: [],
            extraction: 'skipped',
            intent: plan?.intent ?? 'chat',
          }),
        );

  yield {
    type: 'done',
    turnId: loaded?.id ?? savedId ?? assistant?.id ?? '',
    intent: plan?.intent ?? 'chat',
    userTurnId: userTurn.id,
    createdAtUtc: userTurn.createdAtUtc,
  };
};

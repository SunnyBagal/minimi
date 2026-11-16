/**
 * Lane 0 version of the turn pipeline: save the user turn, route, answer plain
 * chat. Lane 5 replaces this file with the full pipeline and keeps the export.
 *
 * Time functions and the verdict guard come from `deps`, never from an import.
 */
import type { AgentEvent, Intent, RunTurn, Turn } from '../contracts';

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export const runTurn: RunTurn = async function* (input, deps): AsyncIterable<AgentEvent> {
  const { clock, store, llm, time, config } = deps;
  const origin = input.origin ?? 'live';
  const turnDeadline = AbortSignal.timeout(config.deadlinesMs.turn);
  const signal = input.signal ? AbortSignal.any([input.signal, turnDeadline]) : turnDeadline;

  // Read history before saving, so `recent` never contains the current message.
  const recent = store.recentTurns(input.sessionId, config.limits.recentTurns);
  const askedAt = clock.now();
  const base: Omit<Turn, 'id' | 'role' | 'content' | 'createdAtUtc' | 'extraction' | 'intent'> = {
    sessionId: input.sessionId,
    tz: input.tz,
    localDate: time.toLocalDate(askedAt, input.tz),
    origin,
    topic: null,
    entities: [],
    summary: null,
    targetTurnIds: [],
  };
  const userTurn = store.saveTurn({
    ...base,
    role: 'user',
    content: input.message,
    createdAtUtc: askedAt.toISOString(),
    extraction: 'skipped',
    intent: null,
  });

  yield { type: 'status', text: 'Thinking…' };

  let intent: Intent = 'chat';
  let answer = '';
  let stage = 'route';
  try {
    const plan = await llm.route({
      message: input.message,
      recent,
      nowLocal: time.formatLocal(askedAt.toISOString(), input.tz),
      tz: input.tz,
    });
    intent = plan.intent;
    base.topic = plan.topic;
    base.entities = plan.entities;
    store.updateTurnMeta(userTurn.id, { topic: plan.topic, entities: plan.entities, summary: null });

    if (plan.intent === 'chat') {
      stage = 'write';
      for await (const delta of llm.write({ mode: 'chat', message: input.message, recent }, signal)) {
        answer += delta;
        yield { type: 'text', delta };
      }
    } else {
      stage = 'branch';
      const notice = `This build answers plain chat only. The "${plan.intent}" path arrives with Lane 5.`;
      yield { type: 'error', stage, message: notice };
      answer = notice;
      yield { type: 'text', delta: notice };
    }
  } catch (error) {
    yield { type: 'error', stage, message: describeError(error) };
  }

  // Save what exists, even after an error, so the turn is never half-recorded.
  const answeredAt = clock.now();
  const assistantTurn = store.saveTurn({
    ...base,
    role: 'assistant',
    content: answer,
    createdAtUtc: answeredAt.toISOString(),
    localDate: time.toLocalDate(answeredAt, input.tz),
    extraction: 'skipped',
    intent,
  });

  yield { type: 'done', turnId: assistantTurn.id, intent };
};

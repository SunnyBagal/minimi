/**
 * Chat: stream the writer's reply, save the assistant turn with intent 'chat'
 * and extraction 'skipped'. No sources, no claims.
 */
import type { AgentEvent } from '../contracts';
import type { TurnContext } from './context';

export async function* chat(ctx: TurnContext): AsyncIterable<AgentEvent> {
  ctx.stage = 'write';
  const doneWrite = ctx.timer('write');
  for await (const delta of ctx.deps.llm.write(
    { mode: 'chat', message: ctx.input.message, recent: ctx.recent },
    ctx.signal,
  )) {
    yield ctx.textEvent(delta);
  }
  yield doneWrite();
  ctx.saveAssistant({ intent: 'chat', extraction: 'skipped', targetTurnIds: [] });
}

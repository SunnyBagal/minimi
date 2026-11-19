import { describe, expect, it, vi } from 'vitest';
import type { AgentDeps, AgentEvent, TurnInput } from '../contracts';
import { defaultConfig } from '../config';
import { chatPlan, FakeClock, FakeLlm, FakeSearch, fakeTime, passThroughGuard } from '../testing/fakes';
import { InMemoryStore } from '../testing/inMemoryStore';
import { runTurn } from './runTurn';

const NOW = '2026-11-16T04:30:00.000Z';
const SESSION = 'edit-session';

async function drain(input: TurnInput, deps: AgentDeps): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runTurn(input, deps)) events.push(event);
  return events;
}

describe('edit hides an in-flight answer', () => {
  it('keeps the replacement and drops the late answer for the hidden prompt', async () => {
    const store = new InMemoryStore();
    const clock = new FakeClock(NOW);
    const deps = (llm: FakeLlm): AgentDeps => ({
      clock,
      store,
      search: new FakeSearch(clock),
      llm,
      time: fakeTime(),
      guardVerdict: passThroughGuard,
      config: defaultConfig,
    });
    const ask = (message: string, llm: FakeLlm) =>
      drain({ sessionId: SESSION, tz: 'UTC', message }, deps(llm));

    const first = await ask('first question', new FakeLlm({ write: ['first answer'] }));
    const firstUserId = first.find((event) => event.type === 'done' && event.userTurnId !== undefined);
    if (firstUserId === undefined || firstUserId.type !== 'done' || firstUserId.userTurnId === undefined) {
      throw new Error('first turn did not record a user id');
    }

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const follow = ask(
      'follow-up question',
      new FakeLlm({
        route: async () => {
          await gate;
          return chatPlan();
        },
        write: ['orphan answer'],
      }),
    );
    await vi.waitFor(() => {
      expect(store.recentTurns(SESSION, 10).some((turn) => turn.content === 'follow-up question')).toBe(true);
    });

    expect(store.hideFrom(SESSION, firstUserId.userTurnId)).toBe(3);
    await ask('replacement question', new FakeLlm({ write: ['replacement answer'] }));
    release();
    await follow;

    expect(store.recentTurns(SESSION, 20).map((turn) => turn.content)).toEqual([
      'replacement question',
      'replacement answer',
    ]);
    expect(store.allTurns()).toHaveLength(6);
    expect(store.allTurns().map((turn) => turn.content)).toContain('orphan answer');
    expect(store.recentTurns(SESSION, 20).map((turn) => turn.content).join('\n')).not.toContain('orphan');
    expect(store.recentTurns(SESSION, 20).map((turn) => turn.content).join('\n')).not.toContain('follow-up');
  });
});

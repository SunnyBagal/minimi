import { describe, expect, it } from 'vitest';
import { REPEAT_QUESTION_RULE } from '../recallHeadline';
import { InMemoryStore } from '../testing/inMemoryStore';
import { assistantTurn, claim, lastAssistant, plan, rig, SESSION, source, textOf, userTurn } from './testSupport';

const QUESTION = 'How long will it take to finish GTA 6?';
const EARLIER_SESSION = 'earlier-chat';
const MEMORY_ANSWER = 'The story is about 30 hours long.';

function earlierExchange(store: InMemoryStore, question = QUESTION, sessionId = EARLIER_SESSION) {
  const user = userTurn(store, { content: question, sessionId });
  const answer = assistantTurn(store, { content: MEMORY_ANSWER, sessionId, intent: 'chat' });
  return { user, answer };
}

describe('cross-session repeat questions', () => {
  it('re-checks claims from the newest near-duplicate, even when an older match scores higher', async () => {
    const store = new InMemoryStore();
    earlierExchange(store);
    const newer = userTurn(store, {
      content: 'How long to finish GTA 6?', sessionId: 'newer-chat',
      localDate: '2026-11-10', createdAtUtc: '2026-11-10T05:00:00.000Z',
    });
    const answer = assistantTurn(store, { sessionId: newer.sessionId, localDate: newer.localDate });
    const src = source(store, { firstParty: true });
    const saved = claim(store, answer.id, src.id, { entity: 'GTA 6', attribute: 'playtime', value: '30 hours', quote: MEMORY_ANSWER });
    const { run, llm, search } = rig({
      store,
      llm: { route: plan({ intent: 'fresh', queries: ['GTA 6 playtime'] }), write: ['Current summary.'] },
      search: { pages: { [src.url]: { status: 'ok', live: true, text: MEMORY_ANSWER } } },
    });

    const events = await run({ message: QUESTION });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({
      candidates: { rule: REPEAT_QUESTION_RULE }, chosen: newer.localDate,
      asked: { turnId: newer.id, question: newer.content, createdAtUtc: newer.createdAtUtc },
    });
    expect(events.filter((event) => event.type === 'verdict')).toMatchObject([
      { row: { claim: { id: saved.id }, check: { verdict: 'unchanged' } } },
    ]);
    expect(search.fetchCalls.map((call) => call.url)).toEqual([src.url]);
    expect(llm.calls('write').map((call) => call.input.mode)).toEqual(['recheck_summary']);
    expect(events.at(-1)).toMatchObject({ type: 'done', intent: 'recheck' });
    expect(lastAssistant(store)?.targetTurnIds).toEqual([answer.id]);
  });

  it('returns one labelled answer from memory when the earlier chat has no claims', async () => {
    const store = new InMemoryStore();
    const earlier = earlierExchange(store);
    const { run, llm, search } = rig({ store, llm: { route: plan({ intent: 'chat' }), write: ['Normal reply.'] } });

    const events = await run({ message: QUESTION });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({ asked: { turnId: earlier.user.id } });
    expect(textOf(events)).toBe(`From memory:\n\n${MEMORY_ANSWER}\n\nI can look this up fresh if you like.`);
    expect(events.filter((event) => event.type === 'verdict')).toEqual([]);
    expect(llm.calls('write')).toEqual([]);
    expect(search.fetchCalls).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'done', intent: 'recall' });
  });

  it.each([
    ['How long will it take to install GTA 6?', QUESTION],
    ['How long will it take to finish GTA 5?', QUESTION],
    ['Can I finish GTA 6 without a keyboard and mouse?', 'Can I finish GTA 6 with a keyboard and mouse?'],
  ])('keeps normal routing for a related question with a different meaning: %s', async (message, earlier) => {
    const store = new InMemoryStore();
    earlierExchange(store, earlier);
    const { run } = rig({ store, llm: { route: plan({ intent: 'chat', topic: 'GTA games' }), write: ['Normal reply.'] } });

    const events = await run({ message });
    expect(events.some((event) => event.type === 'recall')).toBe(false);
    expect(textOf(events)).toBe('Normal reply.');
  });

  it('keeps re-asking in the same session on the normal route', async () => {
    const store = new InMemoryStore();
    earlierExchange(store, QUESTION, SESSION);
    const { run } = rig({ store, llm: { route: plan({ intent: 'chat' }), write: ['In-thread reply.'] } });

    const events = await run({ message: QUESTION });
    expect(events.some((event) => event.type === 'recall')).toBe(false);
    expect(textOf(events)).toBe('In-thread reply.');
  });

  it('ignores an earlier exchange and its memory copy after the original is hidden', async () => {
    const store = new InMemoryStore();
    const { user } = earlierExchange(store);
    const { run } = rig({ store, llm: { route: plan({ intent: 'chat' }), write: ['Normal reply.'] } });
    await run({ message: QUESTION, sessionId: 'copy-chat' });
    expect(store.hideFrom(user.sessionId, user.id)).toBe(2);

    const events = await run({ message: QUESTION });
    expect(events.some((event) => event.type === 'recall')).toBe(false);
    expect(textOf(events)).toBe('Normal reply.');
  });

  it('ignores filler, case and punctuation', async () => {
    const store = new InMemoryStore();
    const { user } = earlierExchange(store, 'FROM EARLIER, please: how long will it take to finish GTA 6, right now?');
    const { run } = rig({ store, llm: { route: plan({ intent: 'recall', topic: 'GTA 6' }) } });

    const events = await run({ message: `${QUESTION.slice(0, -1).toLowerCase()}, right—now?` });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({
      candidates: { rule: REPEAT_QUESTION_RULE }, asked: { turnId: user.id },
    });
    expect(textOf(events)).toContain(MEMORY_ANSWER);
  });
});

import { describe, expect, it } from 'vitest';
import { REPEAT_FOLLOW_UP_RULE, REPEAT_QUESTION_RULE } from '../recallHeadline';
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
    expect(events.find((event) => event.type === 'recall')).toMatchObject({
      candidates: { rule: REPEAT_QUESTION_RULE }, asked: { turnId: earlier.user.id },
      hits: [{ assistantTurn: { id: earlier.answer.id } }],
    });
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

describe('follow-ups in the matched chat', () => {
  it('re-checks the claims from a later search that corrected the original chat answer', async () => {
    const store = new InMemoryStore();
    const { user, answer } = earlierExchange(store);
    const followUp = 'Search for this answer';
    const page = { url: 'https://rockstar.test/gta', title: 'GTA', text: 'The campaign takes 40 hours.', publishedAt: null };
    const { run, llm, search } = rig({
      store,
      llm: {
        route: ({ message }) => message === followUp
          ? plan({ intent: 'fresh', refersToPrevious: true, entities: ['Rockstar'], queries: ['GTA campaign length'] })
          : plan({ intent: 'chat' }),
        write: ({ mode }) => mode === 'fresh' ? [`${page.text} [1]`] : ['Checked the searched answer.'],
        extractClaims: [{ entity: 'GTA 6', attribute: 'campaign length', value: '40 hours', scope: {}, quote: page.text, sourceN: 1, volatility: 'high' }],
      },
      search: { results: { '*': [page] }, pages: { [page.url]: { status: 'ok', live: true, text: page.text } } },
    });

    await run({ message: followUp, sessionId: EARLIER_SESSION });
    const searched = lastAssistant(store);
    const stored = store.allClaims();
    expect(searched).toMatchObject({ intent: 'fresh', targetTurnIds: [] });
    expect(store.claimsForTurns([answer.id], 'as_stated')).toEqual([]);
    expect(stored).toMatchObject([{ turnId: searched?.id, value: '40 hours' }]);

    const events = await run({ message: QUESTION });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({
      candidates: { rule: REPEAT_FOLLOW_UP_RULE }, chosen: user.localDate,
      asked: { turnId: user.id, question: QUESTION }, hits: [{ assistantTurn: { id: searched?.id } }],
    });
    expect(events.filter((event) => event.type === 'verdict')).toMatchObject([
      { row: { claim: { id: stored[0]?.id, value: '40 hours' } } },
    ]);
    expect(search.fetchCalls.map((call) => call.url)).toEqual([page.url]);
    expect(llm.calls('write').map((call) => call.input.mode)).toEqual(['fresh', 'recheck_summary']);
    expect(textOf(events)).not.toContain(MEMORY_ANSWER);
  });

  it('uses the last of two adjacent follow-ups when there are no claims', async () => {
    const store = new InMemoryStore();
    earlierExchange(store);
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'Look it up' });
    const first = assistantTurn(store, { sessionId: EARLIER_SESSION, content: 'The first follow-up.' });
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'Is that still right?' });
    const last = assistantTurn(store, { sessionId: EARLIER_SESSION, content: 'The latest correction.', intent: 'chat' });
    const { run } = rig({ store });

    const events = await run({ message: QUESTION });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({
      candidates: { rule: REPEAT_FOLLOW_UP_RULE }, hits: [{ assistantTurn: { id: last.id } }],
    });
    expect(textOf(events)).toContain(`From memory:\n\n${last.content}`);
    expect(textOf(events)).not.toContain(first.content);
    expect(textOf(events)).not.toContain(MEMORY_ANSWER);
  });

  it('follows an explicit link to a follow-up across an unrelated exchange', async () => {
    const store = new InMemoryStore();
    const { answer: original } = earlierExchange(store);
    claim(store, original.id, source(store, { url: 'https://example.test/older' }).id);
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'Look it up' });
    const first = assistantTurn(store, { sessionId: EARLIER_SESSION });
    const src = source(store, { firstParty: true });
    const stored = claim(store, first.id, src.id, { entity: 'GTA 6', attribute: 'playtime', value: '30 hours' });
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'What platforms support GTA 6?' });
    assistantTurn(store, { sessionId: EARLIER_SESSION });
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'Re-check the GTA 6 playtime you found.' });
    const last = assistantTurn(store, { sessionId: EARLIER_SESSION, intent: 'recheck', targetTurnIds: [first.id] });
    const updatedSrc = source(store, { firstParty: true, url: 'https://example.test/correction' });
    const corrected = claim(store, last.id, updatedSrc.id, {
      entity: stored.entity, attribute: stored.attribute, value: '40 hours',
      quote: 'The campaign takes 40 hours.', supersedesId: stored.id,
    });
    const { run, search } = rig({
      store, search: { pages: { [updatedSrc.url]: { status: 'ok', live: true, text: corrected.quote } } },
    });

    const events = await run({ message: QUESTION });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({ hits: [{ assistantTurn: { id: last.id } }] });
    expect(events.filter((event) => event.type === 'verdict')).toMatchObject([{ row: { claim: { id: corrected.id } } }]);
    expect(search.fetchCalls.map((call) => call.url)).toEqual([updatedSrc.url]);
  });

  it('uses the nearest claim-bearing answer when the final follow-up has no claims', async () => {
    const store = new InMemoryStore();
    earlierExchange(store);
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'Look it up' });
    const first = assistantTurn(store, { sessionId: EARLIER_SESSION });
    const src = source(store, { firstParty: true });
    const stored = claim(store, first.id, src.id, { entity: 'GTA 6', attribute: 'playtime' });
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'Check that' });
    const last = assistantTurn(store, { sessionId: EARLIER_SESSION, content: 'I found no more information.' });
    const { run, search } = rig({ store, search: { pages: { [src.url]: { status: 'ok', live: true, text: stored.quote } } } });

    const events = await run({ message: QUESTION });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({ hits: [{ assistantTurn: { id: last.id } }] });
    expect(events.filter((event) => event.type === 'verdict')).toMatchObject([{ row: { claim: { id: stored.id } } }]);
    expect(search.fetchCalls.map((call) => call.url)).toEqual([src.url]);
    expect(textOf(events)).not.toContain('From memory');
  });

  it('stops the adjacent chain when a new question changes the subject', async () => {
    const store = new InMemoryStore();
    const { answer } = earlierExchange(store);
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'What platforms support GTA 6?' });
    const unrelated = assistantTurn(store, { sessionId: EARLIER_SESSION, content: 'Supported platforms.' });
    userTurn(store, { sessionId: EARLIER_SESSION, content: 'Check that' });
    assistantTurn(store, { sessionId: EARLIER_SESSION, intent: 'recheck', targetTurnIds: [unrelated.id] });
    const { run } = rig({ store });

    const events = await run({ message: QUESTION });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({
      candidates: { rule: REPEAT_QUESTION_RULE }, hits: [{ assistantTurn: { id: answer.id } }],
    });
    expect(textOf(events)).toContain(MEMORY_ANSWER);
    expect(textOf(events)).not.toContain(unrelated.content);
  });

  it('ignores a hidden follow-up and its claims', async () => {
    const store = new InMemoryStore();
    const { answer } = earlierExchange(store);
    const followUp = userTurn(store, { sessionId: EARLIER_SESSION, content: 'Search for this' });
    const hidden = assistantTurn(store, { sessionId: EARLIER_SESSION, content: 'Hidden correction.' });
    claim(store, hidden.id, source(store).id);
    expect(store.hideFrom(EARLIER_SESSION, followUp.id)).toBe(2);
    const { run, search } = rig({ store });

    const events = await run({ message: QUESTION });
    expect(events.find((event) => event.type === 'recall')).toMatchObject({
      candidates: { rule: REPEAT_QUESTION_RULE }, hits: [{ assistantTurn: { id: answer.id } }],
    });
    expect(textOf(events)).toContain(MEMORY_ANSWER);
    expect(textOf(events)).not.toContain(hidden.content);
    expect(search.fetchCalls).toEqual([]);
  });
});

import { Chat } from '@ai-sdk/react';
import { DefaultChatTransport, type ChatOnDataCallback } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDeps, AgentEvent, Check, Claim, NewSource, NewTurn, TurnInput, VerdictRow } from '../../../src/core/contracts';
import { defaultConfig } from '../../../src/core/config';
import { FakeClock, FakeLlm, FakeSearch, fakeTime, passThroughGuard } from '../../../src/core/testing/fakes';
import { InMemoryStore } from '../../../src/core/testing/inMemoryStore';
import type { ChatUIMessage } from './route';
import { DELETE, POST } from './route';

const { runTurnMock, receivedInputs, NOW, storeHolder } = vi.hoisted(() => ({
  runTurnMock: vi.fn(),
  receivedInputs: [] as TurnInput[],
  NOW: '2026-11-10T20:00:00.000Z',
  storeHolder: { current: null as InMemoryStore | null },
}));
const CLAIM_ID = 'claim-1';
const TURN_ID = 'turn-9';

vi.mock('../../../src/compose', () => {
  const clock = new FakeClock(NOW);
  const store = new InMemoryStore();
  storeHolder.current = store;
  const deps: AgentDeps = {
    clock,
    store,
    search: new FakeSearch(clock),
    llm: new FakeLlm(),
    time: fakeTime(),
    guardVerdict: passThroughGuard,
    config: defaultConfig,
  };
  return { getDeps: () => deps };
});

vi.mock('../../../src/core/pipeline/runTurn', () => ({ runTurn: runTurnMock }));

function claim(): Claim {
  return {
    id: CLAIM_ID,
    turnId: 'turn-1',
    entity: 'Example Co',
    attribute: 'price',
    value: '10 USD',
    scope: {},
    sourceId: 'source-1',
    quote: 'Example Co costs 10 USD',
    asOfUtc: NOW,
    volatility: 'high',
    lastVerifiedAtUtc: NOW,
    supersedesId: null,
  };
}

function check(): Check {
  return {
    id: 'check-1',
    claimId: CLAIM_ID,
    checkedAtUtc: NOW,
    verdict: 'unchanged',
    newValue: null,
    newSourceId: null,
    newQuote: null,
    reason: 'The quote is still on the page.',
    decidedBy: 'judge',
  };
}

const verdictRow: VerdictRow = { claim: claim(), check: check(), provenance: 'verified_now', nowSource: null };

/** Every AgentEvent the route maps, in one scripted turn. */
const SCRIPT: AgentEvent[] = [
  { type: 'status', text: 'Thinking…' },
  { type: 'text', delta: 'Hel' },
  { type: 'text', delta: 'lo' },
  { type: 'verdict', row: verdictRow },
  { type: 'text', delta: ' tail' },
  { type: 'citations', items: [{ n: 1, sourceId: 'source-1', url: 'https://example.com', title: 'Example', fetchedAtUtc: NOW, live: true, firstParty: true }] },
  { type: 'flags', strippedCitations: [2], uncitedNumbers: ['99'] },
  { type: 'timing', stage: 'write', ms: 12 },
  { type: 'error', stage: 'write', message: 'Error: boom' },
  { type: 'done', turnId: TURN_ID, intent: 'chat', userTurnId: 'user-9', createdAtUtc: NOW },
];

beforeEach(() => {
  receivedInputs.length = 0;
  runTurnMock.mockImplementation(async function* (input: TurnInput): AsyncIterable<AgentEvent> {
    receivedInputs.push(input);
    yield* SCRIPT;
  });
});

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://test/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

type Chunk = { type: string; [key: string]: unknown };

async function chunks(response: Response): Promise<Chunk[]> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as Chunk);
}

describe('POST /api/chat', () => {
  it('rejects a non-JSON body with 400', async () => {
    const response = await post('not json');
    expect(response.status).toBe(400);
  });

  it('rejects a missing message with 400', async () => {
    const response = await post({ sessionId: 's1' });
    expect(response.status).toBe(400);
  });

  it('rejects an empty sessionId with 400', async () => {
    const response = await post({ message: 'hi', sessionId: '' });
    expect(response.status).toBe(400);
  });

  it('falls back to UTC for an invalid tz', async () => {
    await post({ message: 'hi', sessionId: 's1', tz: 'Mars/Olympus' });
    expect(receivedInputs[0]?.tz).toBe('UTC');
  });

  it('passes a valid tz through', async () => {
    await post({ message: 'hi', sessionId: 's1', tz: 'Asia/Kolkata' });
    expect(receivedInputs[0]?.tz).toBe('Asia/Kolkata');
  });

  it('defaults a missing tz to UTC', async () => {
    await post({ message: 'hi', sessionId: 's1' });
    expect(receivedInputs[0]?.tz).toBe('UTC');
  });

  it('passes message and sessionId to runTurn', async () => {
    await post({ message: 'hello there', sessionId: 'sess-7', tz: 'UTC' });
    expect(receivedInputs[0]?.message).toBe('hello there');
    expect(receivedInputs[0]?.sessionId).toBe('sess-7');
  });

  it('maps AgentEvents onto the UI stream in order', async () => {
    const response = await post({ message: 'hi', sessionId: 's1', tz: 'UTC' });
    const stream = await chunks(response);
    const types = stream.map((chunk) => chunk.type);

    expect(types[0]).toBe('start');
    expect(types[1]).toBe('data-status');

    const status = stream[1];
    expect(status?.data).toEqual({ text: 'Thinking…' });
    expect(status?.transient).toBe(true);

    // First text run: text-start, two deltas, text-end.
    const firstEnd = types.indexOf('text-end');
    expect(types.slice(2, firstEnd + 1)).toEqual(['text-start', 'text-delta', 'text-delta', 'text-end']);
    const firstStart = stream[2];
    const deltas = stream.slice(3, 5).map((chunk) => chunk.delta);
    expect(deltas.join('')).toBe('Hello');

    // The verdict data part carries the claim id, and text after it opens a new text part.
    const verdictIndex = types.indexOf('data-verdict');
    expect(verdictIndex).toBeGreaterThan(firstEnd);
    const verdict = stream[verdictIndex];
    expect(verdict?.id).toBe(CLAIM_ID);

    const secondStart = stream[verdictIndex + 1];
    expect(secondStart?.type).toBe('text-start');
    expect(secondStart?.id).not.toBe(firstStart?.id);

    const rest = types.slice(verdictIndex + 1);
    expect(rest).toEqual([
      'text-start',
      'text-delta',
      'text-end',
      'data-citations',
      'data-flags',
      'data-timing',
      'data-error',
      'finish',
    ]);

    const finish = stream.at(-1);
    expect(finish?.messageMetadata).toEqual({
      turnId: TURN_ID,
      intent: 'chat',
      userTurnId: 'user-9',
      createdAtUtc: NOW,
    });
  });

  it('status is transient: reaches onData, absent from messages', async () => {
    const seen: Parameters<ChatOnDataCallback<ChatUIMessage>>[0][] = [];
    const chat = new Chat<ChatUIMessage>({
      transport: new DefaultChatTransport<ChatUIMessage>({
        api: 'http://test/api/chat',
        fetch: (url, init) => POST(new Request(url, init)),
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages.findLast((message) => message.role === 'user');
          const message = (last?.parts ?? [])
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join('');
          return { body: { message, sessionId: 's1', tz: 'UTC' } };
        },
      }),
      onData: (part) => seen.push(part),
    });

    await chat.sendMessage({ text: 'hi' });

    expect(seen.some((part) => part.type === 'data-status')).toBe(true);
    const assistant = chat.messages.findLast((message) => message.role === 'assistant');
    const partTypes = (assistant?.parts ?? []).map((part) => part.type);
    expect(partTypes).not.toContain('data-status');
    expect(JSON.stringify(chat.messages)).not.toContain('data-status');
    // The other data parts do land in message history.
    expect(partTypes).toContain('data-error');
    expect(partTypes).toContain('data-verdict');
    expect(chat.status).toBe('ready');
  });

  it('editFrom hides that user turn and every later turn before the turn runs', async () => {
    const store = storeHolder.current;
    if (store === null) throw new Error('store missing');
    const sessionId = 'edit-s';
    const saved = (fields: Partial<NewTurn> & { role: 'user' | 'assistant'; content: string }) =>
      store.saveTurn({
        sessionId,
        createdAtUtc: NOW,
        tz: 'UTC',
        localDate: '2026-11-10',
        origin: 'live',
        topic: null,
        entities: [],
        summary: null,
        extraction: 'skipped',
        intent: fields.role === 'assistant' ? 'chat' : null,
        targetTurnIds: [],
        ...fields,
      });
    saved({ role: 'user', content: 'first question about basalt' });
    saved({ role: 'assistant', content: 'first answer about basalt' });
    const secondUser = saved({ role: 'user', content: 'secret later question' });
    const secondAssistant = saved({ role: 'assistant', content: 'secret later answer' });
    const source: NewSource = {
      url: 'https://example.test/p',
      finalUrl: 'https://example.test/p',
      title: null,
      publishedAt: null,
      fetchedAtUtc: NOW,
      live: true,
      firstParty: true,
      httpStatus: 200,
      text: 'page text',
    };
    const savedSource = store.saveSource(source);
    store.saveClaims([
      {
        turnId: secondAssistant.id,
        entity: 'Basalt',
        attribute: 'price',
        value: '12 USD',
        scope: {},
        sourceId: savedSource.id,
        quote: 'secret later quote',
        asOfUtc: NOW,
        volatility: 'high',
        lastVerifiedAtUtc: NOW,
        supersedesId: null,
      },
    ]);

    const seen: string[][] = [];
    runTurnMock.mockImplementation(async function* (input: TurnInput) {
      receivedInputs.push(input);
      seen.push(store.recentTurns(sessionId, 20).map((turn) => turn.content));
      yield { type: 'done', turnId: 'new-a', intent: 'chat', userTurnId: 'new-u', createdAtUtc: NOW };
    });

    const edited = await post({ message: 'edited question', sessionId, tz: 'UTC', editFrom: secondUser.id });
    expect(edited.status).toBe(200);
    await chunks(edited);
    expect(seen[0]).toEqual(['first question about basalt', 'first answer about basalt']);
    expect(receivedInputs[0]?.message).toBe('edited question');

    const followUp = await post({ message: 'What did I ask?', sessionId, tz: 'UTC' });
    expect(followUp.status).toBe(200);
    await chunks(followUp);
    expect(seen[1]).toEqual(['first question about basalt', 'first answer about basalt']);
    expect(seen[1]?.join('\n')).not.toContain('secret later');
    expect(store.getTurns([secondUser.id, secondAssistant.id])).toEqual([]);
    expect(store.claimsForTurns([secondAssistant.id], 'as_stated')).toEqual([]);
    expect(store.claimsForTurns([secondAssistant.id], 'current')).toEqual([]);
  });

  it('an unknown editFrom hides nothing and does not run the turn', async () => {
    const store = storeHolder.current;
    if (store === null) throw new Error('store missing');
    const kept = store.saveTurn({
      sessionId: 'untouched',
      role: 'user',
      content: 'keep me',
      createdAtUtc: NOW,
      tz: 'UTC',
      localDate: '2026-11-10',
      origin: 'live',
      topic: null,
      entities: [],
      summary: null,
      extraction: 'skipped',
      intent: null,
      targetTurnIds: [],
    });
    const response = await post({ message: 'hi', sessionId: 'untouched', tz: 'UTC', editFrom: 'missing-turn' });
    expect(response.status).toBe(400);
    expect(receivedInputs).toEqual([]);
    expect(store.getTurns([kept.id]).map((turn) => turn.content)).toEqual(['keep me']);
  });

  it('rejects a replayed edit and leaves the replacement visible', async () => {
    const store = storeHolder.current;
    if (store === null) throw new Error('store missing');
    const sessionId = 'replay-s';
    const saved = (fields: Partial<NewTurn> & { role: 'user' | 'assistant'; content: string }) =>
      store.saveTurn({
        sessionId,
        createdAtUtc: NOW,
        tz: 'UTC',
        localDate: '2026-11-10',
        origin: 'live',
        topic: null,
        entities: [],
        summary: null,
        extraction: 'skipped',
        intent: fields.role === 'assistant' ? 'chat' : null,
        targetTurnIds: [],
        ...fields,
      });
    const original = saved({ role: 'user', content: 'original question' });
    saved({ role: 'assistant', content: 'original answer' });
    const first = await post({ message: 'edited question', sessionId, tz: 'UTC', editFrom: original.id });
    expect(first.status).toBe(200);
    await chunks(first);

    const replacement = saved({ role: 'user', content: 'replacement question' });
    saved({ role: 'assistant', content: 'replacement answer' });
    const again = await post({ message: 'edited again', sessionId, tz: 'UTC', editFrom: original.id });
    expect(again.status).toBe(400);
    expect(receivedInputs.map((input) => input.message)).toEqual(['edited question']);
    expect(store.recentTurns(sessionId, 10).map((turn) => turn.id)).toContain(replacement.id);
    expect(store.recentTurns(sessionId, 10).map((turn) => turn.content).join('\n')).not.toContain('original');
  });

  it('resolves a legacy assistant id to the preceding visible user turn', async () => {
    const store = storeHolder.current;
    if (store === null) throw new Error('store missing');
    const sessionId = 'legacy-s';
    const saved = (fields: Partial<NewTurn> & { role: 'user' | 'assistant'; content: string }) =>
      store.saveTurn({
        sessionId,
        createdAtUtc: NOW,
        tz: 'UTC',
        localDate: '2026-11-10',
        origin: 'live',
        topic: null,
        entities: [],
        summary: null,
        extraction: 'skipped',
        intent: fields.role === 'assistant' ? 'chat' : null,
        targetTurnIds: [],
        ...fields,
      });
    const user = saved({ role: 'user', content: 'old prompt' });
    const assistant = saved({ role: 'assistant', content: 'old answer' });
    const seen: string[][] = [];
    runTurnMock.mockImplementation(async function* (input: TurnInput) {
      receivedInputs.push(input);
      seen.push(store.recentTurns(sessionId, 20).map((turn) => turn.content));
      yield { type: 'done', turnId: 'new-a', intent: 'chat', userTurnId: 'new-u', createdAtUtc: NOW };
    });
    const response = await post({ message: 'edited old', sessionId, tz: 'UTC', editFrom: assistant.id });
    expect(response.status).toBe(200);
    await chunks(response);
    expect(seen[0]).toEqual([]);
    expect(store.getTurns([user.id, assistant.id])).toEqual([]);
  });

  it('pairs an overlapping legacy assistant with the user turn saved first', async () => {
    const store = storeHolder.current;
    if (store === null) throw new Error('store missing');
    const sessionId = 'overlap-s';
    const saved = (fields: Partial<NewTurn> & { role: 'user' | 'assistant'; content: string }) =>
      store.saveTurn({
        sessionId,
        createdAtUtc: NOW,
        tz: 'UTC',
        localDate: '2026-11-10',
        origin: 'live',
        topic: null,
        entities: [],
        summary: null,
        extraction: 'skipped',
        intent: fields.role === 'assistant' ? 'chat' : null,
        targetTurnIds: [],
        ...fields,
      });
    const userA = saved({ role: 'user', content: 'prompt A' });
    const userB = saved({ role: 'user', content: 'prompt B' });
    const assistantA = saved({ role: 'assistant', content: 'answer A' });
    const assistantB = saved({ role: 'assistant', content: 'answer B' });
    const response = await post({ message: 'edited A', sessionId, tz: 'UTC', editFrom: assistantA.id });
    expect(response.status).toBe(200);
    await chunks(response);
    expect(store.getTurns([userA.id, userB.id, assistantA.id, assistantB.id])).toEqual([]);
    expect(receivedInputs.map((input) => input.message)).toContain('edited A');
  });

  it('rejects an assistant id that has no preceding user turn', async () => {
    const store = storeHolder.current;
    if (store === null) throw new Error('store missing');
    const assistant = store.saveTurn({
      sessionId: 'solo-assistant',
      role: 'assistant',
      content: 'no prompt',
      createdAtUtc: NOW,
      tz: 'UTC',
      localDate: '2026-11-10',
      origin: 'live',
      topic: null,
      entities: [],
      summary: null,
      extraction: 'skipped',
      intent: 'chat',
      targetTurnIds: [],
    });
    const response = await post({ message: 'edit', sessionId: 'solo-assistant', tz: 'UTC', editFrom: assistant.id });
    expect(response.status).toBe(400);
    expect(receivedInputs).toEqual([]);
    expect(store.getTurns([assistant.id]).map((turn) => turn.content)).toEqual(['no prompt']);
  });
});

describe('DELETE /api/chat: deleting a chat forgets it', () => {
  const del = (body: unknown) =>
    DELETE(
      new Request('http://test/api/chat', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  const saveIn = (store: InMemoryStore, sessionId: string, role: 'user' | 'assistant', content: string) =>
    store.saveTurn({
      sessionId,
      role,
      content,
      createdAtUtc: NOW,
      tz: 'UTC',
      localDate: '2026-10-01', // a date no other test in this file uses
      origin: 'live',
      topic: null,
      entities: [],
      summary: null,
      extraction: 'skipped',
      intent: role === 'assistant' ? 'chat' : null,
      targetTurnIds: [],
    });

  it('hides every turn of that chat, so recall no longer finds it; other chats stay', async () => {
    const store = storeHolder.current;
    if (store === null) throw new Error('store missing');
    saveIn(store, 'forget-me', 'user', 'How long will it take to finish GTA 6?');
    saveIn(store, 'forget-me', 'assistant', 'About 30 hours.');
    saveIn(store, 'forget-me', 'user', 'And Red Dead Redemption 2?');
    saveIn(store, 'forget-me', 'assistant', 'About 50 hours.');
    const kept = saveIn(store, 'keep-me', 'user', 'GTA 6 release date?');
    const find = () => store.findTurns({ dates: ['2026-10-01'], topic: 'GTA 6', excludeTurnIds: [], limit: 10 });
    expect([...new Set(find().map((hit) => hit.userTurn.sessionId))].sort()).toEqual(['forget-me', 'keep-me']);

    const response = await del({ sessionId: 'forget-me' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ forgotten: 4 });
    expect(find().map((hit) => hit.userTurn.id)).toEqual([kept.id]);
    expect(store.recentTurns('forget-me', 10)).toEqual([]);
    expect(store.recentTurns('keep-me', 10)).toHaveLength(1);
  });

  it('an unknown or already forgotten chat succeeds and hides nothing', async () => {
    const store = storeHolder.current;
    if (store === null) throw new Error('store missing');
    expect(await (await del({ sessionId: 'never-seen' })).json()).toEqual({ forgotten: 0 });
    saveIn(store, 'twice', 'user', 'Neon price?');
    expect(await (await del({ sessionId: 'twice' })).json()).toEqual({ forgotten: 1 });
    expect(await (await del({ sessionId: 'twice' })).json()).toEqual({ forgotten: 0 });
  });

  it('rejects a body without a sessionId with 400', async () => {
    expect((await del({})).status).toBe(400);
    expect((await del('not json')).status).toBe(400);
  });
});


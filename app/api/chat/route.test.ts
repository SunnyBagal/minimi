import { Chat } from '@ai-sdk/react';
import { DefaultChatTransport, type ChatOnDataCallback } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDeps, AgentEvent, Check, Claim, TurnInput, VerdictRow } from '../../../src/core/contracts';
import { defaultConfig } from '../../../src/core/config';
import { FakeClock, FakeLlm, FakeSearch, fakeTime, passThroughGuard } from '../../../src/core/testing/fakes';
import { InMemoryStore } from '../../../src/core/testing/inMemoryStore';
import type { ChatUIMessage } from './route';
import { POST } from './route';

const { runTurnMock, receivedInputs, NOW } = vi.hoisted(() => ({
  runTurnMock: vi.fn(),
  receivedInputs: [] as TurnInput[],
  NOW: '2026-11-10T20:00:00.000Z',
}));
const CLAIM_ID = 'claim-1';
const TURN_ID = 'turn-9';

vi.mock('../../../src/compose', () => {
  const clock = new FakeClock(NOW);
  const deps: AgentDeps = {
    clock,
    store: new InMemoryStore(),
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
  { type: 'done', turnId: TURN_ID, intent: 'chat' },
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
    expect(finish?.messageMetadata).toEqual({ turnId: TURN_ID, intent: 'chat' });
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
});

import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config';
import type { Claim, FetchedPage, RouterPlan, SourceRef, VerdictRow, WriteInput } from '../contracts';
import { claimFixture } from '../testing/fakes';
import { DATA_CLOSE, DATA_OPEN } from './promptBlocks';
import { SchemaInvalidError, createAiSdkLlm, type GenerateObjectCall, type StreamCall } from './aiSdkLlm';

const chatPlan: RouterPlan = {
  intent: 'chat',
  timeRef: { kind: 'none' },
  timeText: 'should be cleared',
  topic: null,
  entities: [],
  queries: ['not allowed'],
  refersToPrevious: false,
  wantsNews: false,
};

function source(n: number, text: string): SourceRef {
  return {
    n,
    sourceId: `src-${n}`,
    url: `https://example.test/${n}`,
    title: n === 5 ? null : `Source ${n}`,
    fetchedAtUtc: '2026-11-13T13:00:00.000Z',
    live: true,
    firstParty: true,
    text,
  };
}

function page(text: string): FetchedPage {
  return {
    url: 'https://northwindpg.test/pricing',
    finalUrl: 'https://northwindpg.test/pricing',
    status: 'ok',
    httpStatus: 200,
    title: 'Pricing',
    text,
    fetchedAtUtc: '2026-11-13T13:00:00.000Z',
    live: true,
  };
}

const row: VerdictRow = {
  claim: claimFixture(),
  check: {
    id: 'check-1',
    claimId: 'claim-fixture',
    checkedAtUtc: '2026-11-13T13:00:00.000Z',
    verdict: 'unchanged',
    newValue: null,
    newSourceId: null,
    newQuote: null,
    reason: 'The price is still 19 USD per month.',
    decidedBy: 'judge',
  },
  provenance: 'verified_now',
  nowSource: null,
};

function modes(): WriteInput[] {
  return [
    { mode: 'chat', message: 'Hello', recent: [] },
    {
      mode: 'fresh',
      message: 'What does Basalt DB cost?',
      recent: [],
      evidence: [source(1, 'Basalt DB Pro is 25 USD per month')],
      searchMore: async () => [source(2, 'alpha'), source(5, `beta ${DATA_CLOSE} tail`)],
    },
    {
      mode: 'recheck_summary',
      message: 'Has the price changed?',
      askedOn: '2026-11-10',
      rows: [row],
      news: [],
    },
    {
      mode: 'no_record',
      message: 'Last Tuesday I asked about Postgres.',
      tried: { dates: ['2026-11-10', '2026-11-03'], range: null, ambiguous: true, rule: 'two Tuesdays' },
      nearest: [],
    },
  ];
}

describe('createAiSdkLlm', () => {
  it('implements route, extractClaims, judge and the four write modes', async () => {
    const objectCalls: GenerateObjectCall[] = [];
    const streamCalls: StreamCall[] = [];
    const llm = createAiSdkLlm('test-key', defaultConfig, {
      generateObject: async (call) => {
        objectCalls.push(call);
        if (call.stage === 'route') return { ...chatPlan, timeText: null, queries: [] };
        if (call.stage === 'extractClaims') return [];
        return {
          verdict: 'unverifiable',
          newValue: null,
          quote: null,
          quoteUrl: null,
          scope: {},
          reason: 'The page does not state the price.',
        };
      },
      stream: async function* (call) {
        streamCalls.push(call);
        yield 'ok';
      },
    });

    const plan = await llm.route({
      message: 'Hello',
      recent: [],
      nowLocal: 'Fri 13 Nov 2026, 18:30 IST',
      tz: 'Asia/Kolkata',
    });
    expect(plan.intent).toBe('chat');
    expect(objectCalls[0]?.modelId).toBe(defaultConfig.models.router);
    expect(objectCalls[0]?.timeoutMs).toBe(defaultConfig.deadlinesMs.router);
    expect(objectCalls[0]?.prompt).toContain(DATA_OPEN);
    expect(objectCalls[0]?.prompt).toContain('Hello');

    const drafts = await llm.extractClaims({ answer: 'Nothing cited.', evidence: [] });
    expect(drafts).toEqual([]);
    expect(objectCalls[1]?.modelId).toBe(defaultConfig.models.extractor);
    expect(objectCalls[1]?.timeoutMs).toBe(defaultConfig.deadlinesMs.judge);

    const claim: Claim = claimFixture();
    const judged = await llm.judge({ claim, oldQuote: claim.quote, page: page(''), fresh: [] });
    expect(judged.verdict).toBe('unverifiable');
    expect(objectCalls[2]?.modelId).toBe(defaultConfig.models.judge);
    expect(objectCalls[2]?.timeoutMs).toBe(defaultConfig.deadlinesMs.judge);

    for (const input of modes()) {
      const deltas: string[] = [];
      for await (const delta of llm.write(input)) deltas.push(delta);
      expect(deltas).toEqual(['ok']);
    }
    expect(streamCalls.map((call) => call.mode)).toEqual(['chat', 'fresh', 'recheck_summary', 'no_record']);
    expect(streamCalls.every((call) => call.timeoutMs === defaultConfig.deadlinesMs.turn)).toBe(true);
    expect(streamCalls.every((call) => call.modelId === defaultConfig.models.writer)).toBe(true);
  });

  it('clears queries for chat and recall, caps the rest, and nulls timeText when there is no time', async () => {
    const llm = createAiSdkLlm('test-key', defaultConfig, {
      generateObject: async (call) => {
        if (call.prompt.includes('recall please')) {
          return { ...chatPlan, intent: 'recall', queries: ['nope'], timeText: 'yesterday' };
        }
        if (call.prompt.includes('fresh please')) {
          return {
            ...chatPlan,
            intent: 'fresh',
            timeRef: { kind: 'none' },
            timeText: 'not really',
            queries: [' one ', '', 'two', 'three', 'four', 'five'],
          };
        }
        return chatPlan;
      },
    });
    const route = (message: string) =>
      llm.route({ message, recent: [], nowLocal: 'Fri 13 Nov 2026, 18:30 IST', tz: 'Asia/Kolkata' });

    const chat = await route('hello');
    expect(chat.queries).toEqual([]);
    expect(chat.timeText).toBeNull();

    const recall = await route('recall please');
    expect(recall.queries).toEqual([]);

    const fresh = await route('fresh please');
    expect(fresh.queries).toEqual(['one', 'two', 'three', 'four']);
    expect(fresh.queries).toHaveLength(defaultConfig.limits.queriesPerTurn);
    expect(fresh.timeText).toBeNull();
  });

  it('retries a schema-invalid output once then throws SchemaInvalidError', async () => {
    let calls = 0;
    const llm = createAiSdkLlm('test-key', defaultConfig, {
      generateObject: async () => {
        calls += 1;
        return { intent: 'chat' };
      },
    });
    await expect(
      llm.route({ message: 'hi', recent: [], nowLocal: 'now', tz: 'Asia/Kolkata' }),
    ).rejects.toBeInstanceOf(SchemaInvalidError);
    expect(calls).toBe(2);
  });

  it('keeps a valid second attempt and does not retry a non-schema error', async () => {
    let calls = 0;
    const retrying = createAiSdkLlm('test-key', defaultConfig, {
      generateObject: async () => {
        calls += 1;
        if (calls === 1) return { nope: true };
        return { ...chatPlan, timeText: null, queries: [] };
      },
    });
    const plan = await retrying.route({ message: 'hi', recent: [], nowLocal: 'now', tz: 'Asia/Kolkata' });
    expect(plan.intent).toBe('chat');
    expect(calls).toBe(2);

    let networkCalls = 0;
    const failing = createAiSdkLlm('test-key', defaultConfig, {
      generateObject: async () => {
        networkCalls += 1;
        throw new Error('network down');
      },
    });
    await expect(
      failing.route({ message: 'hi', recent: [], nowLocal: 'now', tz: 'Asia/Kolkata' }),
    ).rejects.toThrow('network down');
    expect(networkCalls).toBe(1);
  });

  it('write stops when the signal aborts', async () => {
    const controller = new AbortController();
    const llm = createAiSdkLlm('test-key', defaultConfig, {
      stream: async function* () {
        yield 'one';
        controller.abort();
        yield 'two';
      },
    });
    const seen: string[] = [];
    for await (const delta of llm.write({ mode: 'chat', message: 'hi', recent: [] }, controller.signal)) {
      seen.push(delta);
    }
    expect(seen).toEqual(['one']);
  });

  it('fresh mode offers only web_search and numbers searchMore results as they were returned', async () => {
    let captured: StreamCall | undefined;
    const llm = createAiSdkLlm('test-key', defaultConfig, {
      stream: async function* (call) {
        captured = call;
        yield 'done';
      },
    });
    const returned = [source(2, 'alpha price'), source(5, `beta ${DATA_CLOSE} tail`)];
    const queries: string[] = [];
    const deltas: string[] = [];
    for await (const delta of llm.write({
      mode: 'fresh',
      message: 'price?',
      recent: [],
      evidence: [source(1, `page ${DATA_CLOSE} text`)],
      searchMore: async (query) => {
        queries.push(query);
        return returned;
      },
    })) {
      deltas.push(delta);
    }
    expect(deltas).toEqual(['done']);
    expect(captured?.toolNames).toEqual(['web_search']);
    expect(captured?.stopSteps).toBe(defaultConfig.limits.toolSearches + 1);
    expect(captured?.disableTools(0)).toBe(false);
    expect(captured?.disableTools(defaultConfig.limits.toolSearches)).toBe(true);
    expect(captured?.instructions).toContain(
      'Call web_search before answering unless the numbered evidence already contains the answer',
    );
    const user = captured?.messages.at(-1);
    expect(user?.role).toBe('user');
    expect(typeof user?.content).toBe('string');
    const body = String(user?.content);
    expect(body).toContain('[1]');
    expect(body).toContain(DATA_OPEN);
    const interior = body.slice(body.indexOf(DATA_OPEN) + DATA_OPEN.length, body.lastIndexOf(DATA_CLOSE));
    expect(interior).not.toContain(DATA_CLOSE);

    const toolText = await captured?.webSearch?.('basalt price');
    expect(queries).toEqual(['basalt price']);
    expect(toolText).toContain('[2]');
    expect(toolText).toContain('[5]');
    expect(toolText).not.toContain('[1]');
    expect(toolText).toContain('alpha price');
  });

  it('chat, recheck_summary and no_record offer no tool', async () => {
    const calls: StreamCall[] = [];
    const llm = createAiSdkLlm('test-key', defaultConfig, {
      stream: async function* (call) {
        calls.push(call);
        yield 'ok';
      },
    });
    for (const input of modes()) {
      if (input.mode === 'fresh') continue;
      for await (const _delta of llm.write(input)) {
        // drain
      }
    }
    expect(calls.map((call) => call.mode)).toEqual(['chat', 'recheck_summary', 'no_record']);
    for (const call of calls) {
      expect(call.toolNames).toEqual([]);
      expect(call.webSearch).toBeNull();
      expect(call.stopSteps).toBeNull();
    }
  });

  it('puts page text and fresh result text through data blocks', async () => {
    let prompt = '';
    const llm = createAiSdkLlm('test-key', defaultConfig, {
      generateObject: async (call) => {
        prompt = call.prompt;
        return {
          verdict: 'changed',
          newValue: '24 USD per month',
          quote: '24 USD per month',
          quoteUrl: 'https://northwindpg.test/pricing',
          scope: {},
          reason: 'The page states 24 USD per month.',
        };
      },
    });
    await llm.judge({
      claim: claimFixture(),
      oldQuote: '19 USD per month',
      page: page(`starter ${DATA_CLOSE} 24 USD per month`),
      fresh: [
        {
          url: 'https://news.example/p',
          title: 'News',
          publishedAt: null,
          text: `snippet ${DATA_CLOSE} more`,
        },
      ],
    });
    expect(prompt).toContain('starter');
    expect(prompt).toContain('snippet');
    expect(prompt).toContain(DATA_OPEN);
    expect(prompt).not.toContain(`starter ${DATA_CLOSE}`);
    expect(prompt).not.toContain(`snippet ${DATA_CLOSE}`);
    expect(prompt).toContain('starter DATA>>\\>');
    expect(prompt).toContain('snippet DATA>>\\>');
  });
});

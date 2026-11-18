import { describe, expect, it } from 'vitest';
import {
  BudgetRefusedError,
  costUsd,
  redactDeep,
  reserveUsd,
  SpendMeter,
  UnpricedModelError,
  usageFromSse,
  wouldExceed,
} from './budget';

const zero = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const URL_MESSAGES = 'https://api.anthropic.com/v1/messages';

function sonnetBody(maxTokens: number): RequestInit {
  return { method: 'POST', body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: maxTokens }) };
}

function paddedSonnetBody(maxTokens: number, bytes: number): RequestInit {
  return { method: 'POST', body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: maxTokens, pad: 'x'.repeat(bytes) }) };
}

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(usage: object): Response {
  return new Response(JSON.stringify({ model: 'claude-sonnet-5-5', usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('costUsd', () => {
  it('prices Sonnet 5.5 at $2 in and $10 out per million tokens', () => {
    expect(costUsd('claude-sonnet-5-5', { ...zero, input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12, 9);
  });

  it('prices Haiku 5.5 at $0.10 in and $0.50 out, and at $0.50 / $2.50 above a 100K-token prompt', () => {
    expect(costUsd('claude-haiku-5-5', { ...zero, input_tokens: 50_000, output_tokens: 10_000 })).toBeCloseTo(0.01, 9);
    expect(costUsd('claude-haiku-5-5', { ...zero, input_tokens: 200_000, output_tokens: 10_000 })).toBeCloseTo(0.125, 9);
  });

  it('refuses to price an unknown model instead of guessing', () => {
    expect(() => costUsd('claude-unknown', { ...zero, input_tokens: 1 })).toThrow(UnpricedModelError);
  });

  it('reserves a request at one input token per body byte at the cache-write rate, plus its full max_tokens', () => {
    // 1M bytes at $2.50 (Sonnet cache write) + 100K output at $10.
    expect(reserveUsd('claude-sonnet-5-5', 1_000_000, 100_000)).toBeCloseTo(2.5 + 1, 9);
  });
});

describe('usageFromSse', () => {
  it('takes input and cache tokens from message_start and the output total from message_delta', () => {
    const body = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1200,"cache_read_input_tokens":300,"output_tokens":1}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
      'data: {"type":"message_delta","usage":{"output_tokens":450}}',
      '',
    ].join('\n');
    expect(usageFromSse(body)).toEqual({ ...zero, input_tokens: 1200, cache_read_input_tokens: 300, output_tokens: 450 });
  });

  it('merges cache totals that arrive only on the final message_delta, including zero updates', () => {
    const body = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
      'data: {"type":"message_delta","usage":{"output_tokens":10,"cache_creation_input_tokens":50000,"cache_read_input_tokens":10000,"input_tokens":null}}',
      '',
    ].join('\n');
    expect(usageFromSse(body)).toEqual({
      input_tokens: 100,
      output_tokens: 10,
      cache_creation_input_tokens: 50000,
      cache_read_input_tokens: 10000,
    });
    const revised = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":40}}}',
      'data: {"type":"message_delta","usage":{"output_tokens":5,"cache_read_input_tokens":0}}',
      '',
    ].join('\n');
    expect(usageFromSse(revised).cache_read_input_tokens).toBe(0);
  });
});

describe('SpendMeter', () => {
  it('records a streamed response and leaves the caller its full body', async () => {
    const sse =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1000000}}}\n\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":100000}}\n\n' +
      'data: {"type":"message_stop"}\n\n';
    const meter = new SpendMeter(100);
    const fetched = meter.wrap((async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch);
    // A body of 1M bytes reserves enough input for the 1M tokens the response reports.
    const response = await fetched(URL_MESSAGES, paddedSonnetBody(100_000, 1_000_000));
    expect(await response.text()).toBe(sse);
    await meter.settle();
    expect(meter.spentUsd()).toBeCloseTo(3, 9);
    expect(meter.incomplete).toBeNull();
  });

  function brokenStream(firstChunk: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(firstChunk));
        // The connection drops after the first chunk has been delivered.
        setTimeout(() => controller.error(new Error('connection reset')), 5);
      },
    });
  }

  it('charges a stream that breaks part-way its full reservation and carries on; the caller gets the same error', async () => {
    const meter = new SpendMeter(100);
    // 20K tokens of input, within a 60K-byte body's reservation.
    const stream = brokenStream('data: {"type":"message_start","message":{"usage":{"input_tokens":20000}}}\n\n');
    const fetched = meter.wrap((async () =>
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch);
    const init = paddedSonnetBody(1000, 60_000);
    const response = await fetched(URL_MESSAGES, init);
    await expect(response.text()).rejects.toThrow('connection reset');
    await meter.settle();
    const reserved = reserveUsd('claude-sonnet-5-5', new TextEncoder().encode(String(init.body)).length, 1000);
    expect(meter.spentUsd()).toBeCloseTo(reserved, 9);
    expect(meter.aborted).toBe(1);
    expect(meter.incomplete).toBeNull();
    expect(meter.exhausted()).toBe(false);
  });

  it('charges a broken stream at least the usage it already reported, and stops paid work when that passes the reservation', async () => {
    const meter = new SpendMeter(100);
    // 50K input tokens reported on a tiny request: $0.10 observed, far above its reservation.
    const stream = brokenStream('data: {"type":"message_start","message":{"usage":{"input_tokens":50000}}}\n\n');
    const fetched = meter.wrap((async () =>
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch);
    const response = await fetched(URL_MESSAGES, sonnetBody(1000));
    await expect(response.text()).rejects.toThrow('connection reset');
    await meter.settle();
    expect(meter.spentUsd()).toBeCloseTo(0.1, 9);
    expect(meter.incomplete).toBe('a broken response had already reported more than its reservation');
    expect(meter.exhausted()).toBe(true);
  });

  it('treats a complete but malformed JSON body as a protocol failure, not an abort', async () => {
    for (const body of ['{nonsense}', 'null']) {
      const meter = new SpendMeter(100);
      const fetched = meter.wrap((async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch);
      await (await fetched(URL_MESSAGES, sonnetBody(10))).text();
      await meter.settle();
      expect(meter.incomplete).toBe('a response body was not a JSON object');
      expect(meter.exhausted()).toBe(true);
    }
  });

  it('charges a request aborted before any response (a deadline) its full reservation and carries on', async () => {
    const meter = new SpendMeter(100);
    const fetched = meter.wrap((async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch);
    const init = sonnetBody(1000);
    await expect(fetched(URL_MESSAGES, init)).rejects.toThrow('timeout');
    const reserved = reserveUsd('claude-sonnet-5-5', new TextEncoder().encode(String(init.body)).length, 1000);
    expect(meter.spentUsd()).toBeCloseTo(reserved, 9);
    expect(meter.aborted).toBe(1);
    expect(meter.incomplete).toBeNull();
    expect(meter.exhausted()).toBe(false);
  });

  it('marks accounting incomplete for a JSON response with no usage, and refuses the next request', async () => {
    const meter = new SpendMeter(100);
    const fetched = meter.wrap((async () => new Response('{"model":"claude-sonnet-5-5"}', { status: 200 })) as typeof fetch);
    await (await fetched(URL_MESSAGES, sonnetBody(10))).text();
    await meter.settle();
    expect(meter.incomplete).not.toBeNull();
    await expect(fetched(URL_MESSAGES, sonnetBody(10))).rejects.toThrow(BudgetRefusedError);
  });

  it('refuses, without sending it, a request whose worst case could pass the budget', async () => {
    let sent = 0;
    const meter = new SpendMeter(1);
    const fetched = meter.wrap((async () => {
      sent += 1;
      return jsonResponse({ input_tokens: 10, output_tokens: 10 });
    }) as typeof fetch);
    // 200_000 max output tokens of Sonnet alone is $2.
    await expect(fetched(URL_MESSAGES, sonnetBody(200_000))).rejects.toThrow(BudgetRefusedError);
    expect(sent).toBe(0);
    expect(meter.refused).toBe(1);
    expect(meter.exhausted()).toBe(true);
  });

  it('counts in-flight reservations, so parallel requests cannot pass the budget together', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const meter = new SpendMeter(1.5);
    const fetched = meter.wrap((async () => {
      await gate;
      return jsonResponse({ input_tokens: 10, output_tokens: 10 });
    }) as typeof fetch);
    // Each reserves about $1 (100_000 output tokens of Sonnet); two in flight would pass $1.50.
    const first = fetched(URL_MESSAGES, sonnetBody(100_000));
    await expect(fetched(URL_MESSAGES, sonnetBody(100_000))).rejects.toThrow(BudgetRefusedError);
    release();
    await (await first).text();
    await meter.settle();
  });

  it('marks a stream that ends without message_stop, or with an error event, as incomplete, keeping its usage', async () => {
    const start = 'data: {"type":"message_start","message":{"usage":{"input_tokens":50000}}}\n\n';
    for (const body of [start, `${start}data: {"type":"error","error":{"type":"overloaded_error"}}\n\n`]) {
      const meter = new SpendMeter(100);
      const fetched = meter.wrap((async () => sseResponse(body)) as typeof fetch);
      await (await fetched(URL_MESSAGES, paddedSonnetBody(100, 60_000))).text();
      await meter.settle();
      expect(meter.spentUsd()).toBeCloseTo(0.1, 9);
      expect(meter.incomplete).not.toBeNull();
      expect(meter.exhausted()).toBe(true);
    }
  });

  it('requires an input count at message_start, and message_stop after the final usage', async () => {
    const cases: Array<[string, string]> = [
      [
        'data: {"type":"message_start","message":{"usage":{}}}\n\n' +
          'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
        'a stream did not report its input tokens at message_start',
      ],
      [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n' +
          'data: {"type":"message_stop"}\n\n' +
          'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n',
        'a stream stopped before its final usage',
      ],
    ];
    for (const [body, reason] of cases) {
      const meter = new SpendMeter(100);
      const fetched = meter.wrap((async () => sseResponse(body)) as typeof fetch);
      await (await fetched(URL_MESSAGES, sonnetBody(100))).text();
      await meter.settle();
      expect(meter.incomplete).toBe(reason);
    }
    // Out-of-order sequences stay incomplete even when later frames look valid.
    const start = 'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n';
    const delta = 'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n';
    const stop = 'data: {"type":"message_stop"}\n\n';
    for (const body of [delta + start + stop, start + delta + stop + delta, start + stop + delta + stop]) {
      const meter = new SpendMeter(100);
      await (await meter.wrap((async () => sseResponse(body)) as typeof fetch)(URL_MESSAGES, sonnetBody(100))).text();
      await meter.settle();
      expect(meter.incomplete).not.toBeNull();
      expect(meter.exhausted()).toBe(true);
    }
    // An explicit zero input count is valid.
    const zeroInput = new SpendMeter(100);
    const ok =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":0}}}\n\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":3}}\n\n' +
      'data: {"type":"message_stop"}\n\n';
    await (await zeroInput.wrap((async () => sseResponse(ok)) as typeof fetch)(URL_MESSAGES, sonnetBody(100))).text();
    await zeroInput.settle();
    expect(zeroInput.incomplete).toBeNull();
  });

  it('marks a stream with message_stop but no final output total as incomplete', async () => {
    const meter = new SpendMeter(100);
    const body =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n' + 'data: {"type":"message_stop"}\n\n';
    const fetched = meter.wrap((async () => sseResponse(body)) as typeof fetch);
    await (await fetched(URL_MESSAGES, sonnetBody(100))).text();
    await meter.settle();
    expect(meter.incomplete).toBe('a stream stopped before its final usage');
  });

  it('marks a successful response with no body, or JSON without both counts, as incomplete', async () => {
    const empty = new SpendMeter(100);
    await empty.wrap((async () => new Response(null, { status: 200 })) as typeof fetch)(URL_MESSAGES, sonnetBody(10));
    expect(empty.incomplete).toBe('a successful response had no body');

    const inputOnly = new SpendMeter(100);
    const fetched = inputOnly.wrap((async () => jsonResponse({ input_tokens: 10 })) as typeof fetch);
    await (await fetched(URL_MESSAGES, sonnetBody(10))).text();
    await inputOnly.settle();
    expect(inputOnly.incomplete).toBe('a response did not report both input and output tokens');
  });

  it('marks a response that cost more than its reservation as incomplete', async () => {
    const meter = new SpendMeter(100);
    // max_tokens 1 and a tiny body reserve far less than 1000 input + 1 output tokens.
    const fetched = meter.wrap((async () => jsonResponse({ input_tokens: 1000, output_tokens: 1 })) as typeof fetch);
    await (await fetched(URL_MESSAGES, sonnetBody(1))).text();
    await meter.settle();
    expect(meter.incomplete).toBe('a response cost more than its reservation');
  });

  it('after one refusal, sends nothing more, not even a smaller request', async () => {
    let sent = 0;
    const meter = new SpendMeter(0.0005);
    const fetched = meter.wrap((async () => {
      sent += 1;
      return jsonResponse({ input_tokens: 1, output_tokens: 1 });
    }) as typeof fetch);
    await expect(fetched(URL_MESSAGES, sonnetBody(100))).rejects.toThrow(BudgetRefusedError);
    await expect(fetched(URL_MESSAGES, sonnetBody(1))).rejects.toThrow(BudgetRefusedError);
    expect(sent).toBe(0);
  });

  it('refuses a request for an unpriced model', async () => {
    const meter = new SpendMeter(100);
    const fetched = meter.wrap((async () => jsonResponse({ input_tokens: 1 })) as typeof fetch);
    await expect(
      fetched(URL_MESSAGES, { method: 'POST', body: JSON.stringify({ model: 'claude-new-9', max_tokens: 10 }) }),
    ).rejects.toThrow(UnpricedModelError);
  });

  it('passes other requests through unmetered', async () => {
    const meter = new SpendMeter(0.000001);
    const fetched = meter.wrap((async () => new Response('{"usage":{"input_tokens":5}}', { status: 200 })) as typeof fetch);
    await (await fetched('https://api.exa.ai/search', { method: 'POST', body: '{}' })).text();
    await meter.settle();
    expect(meter.spentUsd()).toBe(0);
    expect(meter.refused).toBe(0);
  });
});

describe('wouldExceed', () => {
  it('lets the first run start, then stops when the dearest run so far would cross the budget', () => {
    expect(wouldExceed(0, 0, 1)).toBe(false);
    expect(wouldExceed(0.7, 0.7, 2)).toBe(false);
    expect(wouldExceed(1.4, 0.7, 2)).toBe(true);
  });
});

describe('redactDeep', () => {
  it('replaces a secret in every nested string and leaves the rest alone', () => {
    const secret = 'sk-test-SENTINEL';
    const value = {
      error: `request failed with key ${secret}`,
      rows: [{ check: { reason: `judge threw: ${secret}` } }, 3, null],
    };
    const out = redactDeep(value, [secret]);
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(out.rows[1]).toBe(3);
    expect(out.error).toBe('request failed with key [redacted]');
  });

  it('does nothing with an empty secret', () => {
    expect(redactDeep({ a: 'x' }, [''])).toEqual({ a: 'x' });
  });
});

import { describe, expect, it } from 'vitest';
import { costUsd, SpendMeter, usageFromSse, wouldExceed } from './budget';

const zero = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

describe('costUsd', () => {
  it('prices Sonnet 5.5 at $2 in and $10 out per million tokens', () => {
    expect(costUsd('claude-sonnet-5-5', { ...zero, input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(12, 9);
  });

  it('prices Haiku 5.5 at $0.10 in and $0.50 out, and at $0.50 / $2.50 above a 100K-token prompt', () => {
    expect(costUsd('claude-haiku-5-5', { ...zero, input_tokens: 50_000, output_tokens: 10_000 })).toBeCloseTo(0.01, 9);
    expect(costUsd('claude-haiku-5-5', { ...zero, input_tokens: 200_000, output_tokens: 10_000 })).toBeCloseTo(0.125, 9);
  });

  it('prices an unknown model at the dearest known rate', () => {
    expect(costUsd('claude-unknown', { ...zero, input_tokens: 1_000_000 })).toBeCloseTo(2, 9);
  });
});

describe('usageFromSse', () => {
  it('takes input and cache tokens from message_start and the output total from message_delta', () => {
    const body = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1200,"cache_read_input_tokens":300,"output_tokens":1}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":450}}',
      '',
    ].join('\n');
    expect(usageFromSse(body)).toEqual({ ...zero, input_tokens: 1200, cache_read_input_tokens: 300, output_tokens: 450 });
  });
});

describe('SpendMeter', () => {
  it('records a streamed response once its body has been read, and leaves the caller a full body', async () => {
    const sse =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1000000}}}\n\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":100000}}\n\n';
    const meter = new SpendMeter();
    const fetched = meter.wrap((async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch);
    const response = await fetched('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-sonnet-5-5' }),
    });
    expect(await response.text()).toBe(sse);
    await meter.settle();
    expect(meter.spentUsd()).toBeCloseTo(3, 9);
    expect(meter.report()['claude-sonnet-5-5']?.calls).toBe(1);
  });

  it('ignores responses that are not Anthropic Messages calls', async () => {
    const meter = new SpendMeter();
    const fetched = meter.wrap((async () => new Response('{"usage":{"input_tokens":5}}', { status: 200 })) as typeof fetch);
    await (await fetched('https://api.exa.ai/search', { method: 'POST', body: '{}' })).text();
    await meter.settle();
    expect(meter.spentUsd()).toBe(0);
  });
});

describe('wouldExceed', () => {
  it('lets the first run start, then stops when the dearest run so far would cross the budget', () => {
    expect(wouldExceed(0, 0, 1)).toBe(false);
    expect(wouldExceed(0.7, 0.7, 2)).toBe(false);
    expect(wouldExceed(1.4, 0.7, 2)).toBe(true);
  });
});

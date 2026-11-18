/**
 * Spend cap for live eval runs. It wraps `fetch`:
 *
 * - **Before** each Anthropic Messages request it reserves the request's
 *   worst case (prompt tokens estimated high from the body size, plus the
 *   request's `max_tokens` of output) and refuses the request, without
 *   sending it, when spent + in-flight reservations + this reservation would
 *   pass the budget. So the budget is a cap, not an estimate.
 * - **While** a response streams it reads usage incrementally (JSON `usage`,
 *   or SSE `message_start` then `message_delta`, merging every non-null field),
 *   so usage already reported survives a broken stream.
 * - A body it cannot account for (a read error, unparseable JSON, a stream
 *   with no usage) marks the meter `incomplete`; the runner then starts no
 *   further paid work. An unpriced model is refused, never guessed.
 *
 * Prices: USD per million tokens, from Anthropic's published list as given in
 * the `claude-api` skill's "Current Models" table (cached 2026-11-03):
 * Haiku 5.5 $0.10 in / $0.50 out for prompts up to 100K tokens ($0.50 / $2.50
 * beyond); Sonnet 5.5 $2 in / $10 out, cache reads $0.10. Two rates are not on
 * that list and use the usual multipliers: cache writes at 1.25x input (the
 * 5-minute TTL; this app requests no cache TTL) and Haiku cache reads at 0.1x
 * input.
 */

export const PRICE_SOURCE = 'claude-api skill, Current Models table, cached 2026-11-03';

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

interface Rate {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const HAIKU: Rate = { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 };
const HAIKU_LONG: Rate = { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 };
const SONNET: Rate = { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 };
const HAIKU_LONG_PROMPT = 100_000;

/** Output tokens to reserve when a request names no `max_tokens`. */
const DEFAULT_MAX_TOKENS_RESERVE = 64_000;
/** Prompt tokens are reserved at one per 2 body characters: a high estimate (text runs nearer 4). */
const CHARS_PER_TOKEN_RESERVE = 2;

export class UnpricedModelError extends Error {}
export class BudgetRefusedError extends Error {}

function rateFor(model: string, promptTokens: number): Rate {
  if (model.startsWith('claude-haiku-5-5')) return promptTokens > HAIKU_LONG_PROMPT ? HAIKU_LONG : HAIKU;
  if (model.startsWith('claude-sonnet-5-5')) return SONNET;
  throw new UnpricedModelError(`evals: no price for model ${model}`);
}

export function isPriced(model: string): boolean {
  return model.startsWith('claude-haiku-5-5') || model.startsWith('claude-sonnet-5-5');
}

export function costUsd(model: string, usage: Usage): number {
  const prompt = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  const rate = rateFor(model, prompt);
  return (
    (usage.input_tokens * rate.input +
      usage.output_tokens * rate.output +
      usage.cache_creation_input_tokens * rate.cacheWrite +
      usage.cache_read_input_tokens * rate.cacheRead) /
    1_000_000
  );
}

/** The most a request can cost: its prompt estimated high, all of it uncached, plus its full `max_tokens`. */
export function reserveUsd(model: string, bodyChars: number, maxTokens: number | null): number {
  const promptTokens = Math.ceil(bodyChars / CHARS_PER_TOKEN_RESERVE);
  return costUsd(model, {
    input_tokens: promptTokens,
    output_tokens: maxTokens ?? DEFAULT_MAX_TOKENS_RESERVE,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  });
}

function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

const USAGE_KEYS: readonly (keyof Usage)[] = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
];

/** Copies every numeric usage field present in `raw` onto `into`; null or absent fields leave it alone. */
function mergeUsage(into: Usage, raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false;
  const value = raw as Record<string, unknown>;
  let seen = false;
  for (const key of USAGE_KEYS) {
    const field = value[key];
    if (typeof field === 'number') {
      into[key] = field;
      seen = true;
    }
  }
  return seen;
}

/**
 * Reads SSE text as it arrives. `message_start` carries the first usage,
 * `message_delta` the running totals; every non-null field of either replaces
 * the value so far (output totals are cumulative, cache totals can arrive only
 * at the end).
 */
export class SseUsageReader {
  readonly usage: Usage = emptyUsage();
  sawUsage = false;
  private buffer = '';

  push(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.line(line);
  }

  end(): void {
    if (this.buffer !== '') this.line(this.buffer);
    this.buffer = '';
  }

  private line(line: string): void {
    if (!line.startsWith('data:')) return;
    let event: { type?: string; message?: { usage?: unknown }; usage?: unknown };
    try {
      event = JSON.parse(line.slice(5).trim()) as typeof event;
    } catch {
      return;
    }
    if (event.type === 'message_start') {
      if (mergeUsage(this.usage, event.message?.usage)) this.sawUsage = true;
    } else if (event.type === 'message_delta') {
      if (mergeUsage(this.usage, event.usage)) this.sawUsage = true;
    }
  }
}

/** Usage from a whole SSE body. */
export function usageFromSse(body: string): Usage {
  const reader = new SseUsageReader();
  reader.push(body);
  reader.end();
  return reader.usage;
}

export interface ModelSpend {
  calls: number;
  usage: Usage;
  usd: number;
}

interface RequestFacts {
  model: string;
  bodyChars: number;
  maxTokens: number | null;
}

function requestFacts(init: RequestInit | undefined): RequestFacts {
  if (typeof init?.body !== 'string') return { model: 'unknown', bodyChars: 0, maxTokens: null };
  try {
    const parsed = JSON.parse(init.body) as { model?: unknown; max_tokens?: unknown };
    return {
      model: typeof parsed.model === 'string' ? parsed.model : 'unknown',
      bodyChars: init.body.length,
      maxTokens: typeof parsed.max_tokens === 'number' ? parsed.max_tokens : null,
    };
  } catch {
    return { model: 'unknown', bodyChars: init.body.length, maxTokens: null };
  }
}

function isMessagesCall(input: Parameters<typeof fetch>[0]): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/v1/messages');
}

export class SpendMeter {
  private readonly byModel = new Map<string, ModelSpend>();
  private readonly pending = new Set<Promise<void>>();
  private reservedUsd = 0;
  /** Why accounting is no longer complete, or null while it is. */
  incomplete: string | null = null;
  /** Requests refused because they could have passed the budget. */
  refused = 0;

  constructor(readonly budgetUsd: number) {}

  record(model: string, usage: Usage): void {
    const entry = this.byModel.get(model) ?? { calls: 0, usage: emptyUsage(), usd: 0 };
    entry.calls += 1;
    for (const key of USAGE_KEYS) entry.usage[key] += usage[key];
    entry.usd += costUsd(model, usage);
    this.byModel.set(model, entry);
  }

  spentUsd(): number {
    let total = 0;
    for (const entry of this.byModel.values()) total += entry.usd;
    return total;
  }

  report(): Record<string, ModelSpend> {
    return Object.fromEntries(this.byModel);
  }

  /** Waits for response bodies still being read, so their usage is counted. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /** True when no further paid work may start. */
  exhausted(): boolean {
    return this.incomplete !== null || this.refused > 0 || this.spentUsd() >= this.budgetUsd;
  }

  private markIncomplete(reason: string): void {
    if (this.incomplete === null) this.incomplete = reason;
  }

  /** A fetch that refuses requests that could pass the budget and records the usage of every response. */
  wrap(base: typeof fetch): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!isMessagesCall(input)) return base(input, init);
      const facts = requestFacts(init);
      if (!isPriced(facts.model)) {
        this.refused += 1;
        throw new UnpricedModelError(`evals: refused a request for unpriced model ${facts.model}`);
      }
      if (this.incomplete !== null) {
        this.refused += 1;
        throw new BudgetRefusedError(`evals: refused a request: spend accounting is incomplete (${this.incomplete})`);
      }
      const reserve = reserveUsd(facts.model, facts.bodyChars, facts.maxTokens);
      if (this.spentUsd() + this.reservedUsd + reserve > this.budgetUsd) {
        this.refused += 1;
        throw new BudgetRefusedError(
          `evals: refused a request that could take spend past the $${this.budgetUsd} budget`,
        );
      }
      this.reservedUsd += reserve;
      let released = false;
      const release = (): void => {
        if (!released) {
          released = true;
          this.reservedUsd -= reserve;
        }
      };

      let response: Response;
      try {
        response = await base(input, init);
      } catch (error) {
        // Nothing came back: the request may or may not have been billed.
        release();
        this.markIncomplete('a request failed before a response arrived');
        throw error;
      }
      if (!response.ok || response.body === null) {
        release();
        return response;
      }
      const streaming = (response.headers.get('content-type') ?? '').includes('text/event-stream');
      const [forCaller, forMeter] = response.body.tee();
      const reading = this.read(facts.model, streaming, forMeter).finally(() => {
        release();
        this.pending.delete(reading);
      });
      this.pending.add(reading);
      return new Response(forCaller, { status: response.status, statusText: response.statusText, headers: response.headers });
    }) as typeof fetch;
  }

  private async read(model: string, streaming: boolean, body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseUsageReader();
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (streaming) sse.push(chunk);
        else text += chunk;
      }
      if (streaming) {
        sse.end();
        if (!sse.sawUsage) this.markIncomplete('a stream ended without usage');
        this.record(model, sse.usage);
        return;
      }
      const parsed = JSON.parse(text) as { usage?: unknown; model?: unknown };
      const usage = emptyUsage();
      if (!mergeUsage(usage, parsed.usage)) this.markIncomplete('a response carried no usage');
      this.record(model, usage);
    } catch {
      // Keep what the stream already reported; the rest is unknown, so stop paid work.
      if (streaming && sse.sawUsage) this.record(model, sse.usage);
      this.markIncomplete('a response body could not be read to the end');
    }
  }
}

/**
 * Case-run admission: true when one more case-run, estimated at the dearest one
 * so far, could take the spend over the budget. The per-request reservation in
 * `SpendMeter.wrap` is the cap; this only avoids starting a run that is likely
 * to be cut off part-way.
 */
export function wouldExceed(spentUsd: number, dearestRunUsd: number, budgetUsd: number): boolean {
  return spentUsd + dearestRunUsd > budgetUsd;
}

/** Replaces every occurrence of each secret in every string of a JSON-like value. */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  const live = secrets.filter((secret) => secret.length > 0);
  if (live.length === 0) return value;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return live.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), node);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, item]) => [key, walk(item)]));
    }
    return node;
  };
  return walk(value) as T;
}

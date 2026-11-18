/**
 * Spend meter for live eval runs. It wraps `fetch`, reads the token usage
 * Anthropic returns on every Messages response (JSON or streamed SSE), prices
 * it, and lets the runner stop before a case-run would cross the budget.
 *
 * Prices are USD per million tokens, from Anthropic's published price list
 * (claude-api skill, "Current Models", cached 2026-11-03): Haiku 5.5 $0.10 in /
 * $0.50 out for prompts up to 100K tokens ($0.50 / $2.50 beyond); Sonnet 5.5
 * $2 in / $10 out, cache reads $0.10. Cache writes are priced at 1.25x input
 * and Haiku cache reads at 0.1x input; those two are not on that list and are
 * the usual multipliers. An unknown model is priced at the dearest known rate,
 * so the meter overestimates rather than under.
 */

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

function rateFor(model: string, promptTokens: number): Rate {
  if (model.startsWith('claude-haiku-5-5')) return promptTokens > HAIKU_LONG_PROMPT ? HAIKU_LONG : HAIKU;
  if (model.startsWith('claude-sonnet-5-5')) return SONNET;
  return SONNET;
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

function toUsage(raw: unknown): Usage {
  const value = (raw ?? {}) as Record<string, unknown>;
  const num = (key: string): number => (typeof value[key] === 'number' ? (value[key] as number) : 0);
  return {
    input_tokens: num('input_tokens'),
    output_tokens: num('output_tokens'),
    cache_creation_input_tokens: num('cache_creation_input_tokens'),
    cache_read_input_tokens: num('cache_read_input_tokens'),
  };
}

function requestModel(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') return 'unknown';
  try {
    const parsed = JSON.parse(init.body) as { model?: unknown };
    return typeof parsed.model === 'string' ? parsed.model : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Usage from an SSE body: message_start carries input and cache tokens, message_delta the output total. */
export function usageFromSse(body: string): Usage {
  const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    let event: { type?: string; message?: { usage?: unknown }; usage?: unknown };
    try {
      event = JSON.parse(line.slice(5).trim()) as typeof event;
    } catch {
      continue;
    }
    if (event.type === 'message_start') {
      const start = toUsage(event.message?.usage);
      usage.input_tokens = start.input_tokens;
      usage.cache_creation_input_tokens = start.cache_creation_input_tokens;
      usage.cache_read_input_tokens = start.cache_read_input_tokens;
      usage.output_tokens = Math.max(usage.output_tokens, start.output_tokens);
    } else if (event.type === 'message_delta') {
      const delta = toUsage(event.usage);
      // message_delta's output_tokens is the running total for the message.
      usage.output_tokens = Math.max(usage.output_tokens, delta.output_tokens);
      if (delta.input_tokens > 0) usage.input_tokens = delta.input_tokens;
    }
  }
  return usage;
}

export interface ModelSpend {
  calls: number;
  usage: Usage;
  usd: number;
}

export class SpendMeter {
  private readonly byModel = new Map<string, ModelSpend>();
  private readonly pending = new Set<Promise<void>>();

  record(model: string, usage: Usage): void {
    const entry = this.byModel.get(model) ?? {
      calls: 0,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      usd: 0,
    };
    entry.calls += 1;
    entry.usage.input_tokens += usage.input_tokens;
    entry.usage.output_tokens += usage.output_tokens;
    entry.usage.cache_creation_input_tokens += usage.cache_creation_input_tokens;
    entry.usage.cache_read_input_tokens += usage.cache_read_input_tokens;
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

  /** Waits for streamed bodies still being read, so their usage is counted. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /** A fetch that records the usage of every Anthropic Messages response it returns. */
  wrap(base: typeof fetch): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const response = await base(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/v1/messages') || !response.ok || response.body === null) return response;
      const model = requestModel(init);
      const type = response.headers.get('content-type') ?? '';
      const [forCaller, forMeter] = response.body.tee();
      const reading = new Response(forMeter)
        .text()
        .then((text) => {
          if (type.includes('text/event-stream')) {
            this.record(model, usageFromSse(text));
          } else {
            const parsed = JSON.parse(text) as { usage?: unknown; model?: unknown };
            this.record(typeof parsed.model === 'string' ? parsed.model : model, toUsage(parsed.usage));
          }
        })
        .catch(() => {
          // An unreadable body is not counted; the caller still gets its copy.
        })
        .finally(() => {
          this.pending.delete(reading);
        });
      this.pending.add(reading);
      return new Response(forCaller, { status: response.status, statusText: response.statusText, headers: response.headers });
    }) as typeof fetch;
  }
}

/**
 * True when one more case-run, estimated at the dearest one so far, would take
 * the spend over the budget. Before any run has finished there is no estimate,
 * so the first run always starts.
 */
export function wouldExceed(spentUsd: number, dearestRunUsd: number, budgetUsd: number): boolean {
  return spentUsd + dearestRunUsd > budgetUsd;
}

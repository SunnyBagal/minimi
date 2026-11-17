/**
 * The Llm port on the AI SDK. This is the one file in src/core that may import
 * `ai` or `@ai-sdk/*`.
 *
 * Structured calls use `generateText` with `Output.object` or `Output.array`.
 * The writer streams text. In fresh mode it offers one tool, `web_search`.
 * V4: the step cap is one step more than `limits.toolSearches`, tools are off
 * on that last step, and parallel tool use is disabled.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
  generateText,
  isStepCount,
  NoObjectGeneratedError,
  Output,
  streamText,
  tool,
  type ModelMessage,
} from 'ai';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type {
  AgentConfig,
  Claim,
  ClaimDraft,
  DateCandidates,
  FetchedPage,
  JudgeOutput,
  Llm,
  MemoryHit,
  RouterPlan,
  SearchMore,
  SearchResult,
  SourceRef,
  Turn,
  VerdictRow,
  WriteInput,
} from '../contracts';
import { dataBlock, labeledBlock, numberedEvidence } from './promptBlocks';
import { claimDraftSchema, claimDraftsSchema, judgeOutputSchema, routerPlanSchema } from './schemas';

export class SchemaInvalidError extends Error {
  override readonly name = 'SchemaInvalidError';
  readonly stage: string;

  constructor(stage: string, cause?: unknown) {
    super(`Schema-invalid output from ${stage}`);
    this.stage = stage;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export interface GenerateObjectCall {
  stage: 'route' | 'extractClaims' | 'judge';
  modelId: string;
  timeoutMs: number;
  instructions: string;
  prompt: string;
  shape: 'object' | 'array';
}

export interface StreamCall {
  mode: WriteInput['mode'];
  modelId: string;
  timeoutMs: number;
  instructions: string;
  messages: ModelMessage[];
  /** Empty unless this mode offers a tool. Fresh offers exactly `web_search`. */
  toolNames: string[];
  /** Model steps allowed when a tool is offered. Null when there is no tool. */
  stopSteps: number | null;
  /** True on the last step, where tools are switched off. */
  disableTools: (stepNumber: number) => boolean;
  webSearch: ((query: string) => Promise<string>) | null;
  signal: AbortSignal | undefined;
}

export interface LlmDeps {
  /** Replaces the structured-output call. Tests return schema-invalid values. */
  generateObject?: (call: GenerateObjectCall) => Promise<unknown>;
  /** Replaces the writer stream. Yields text deltas. */
  stream?: (call: StreamCall) => AsyncIterable<string>;
}

const promptDir = join(dirname(fileURLToPath(import.meta.url)), 'prompts');

function readPrompt(name: string): string {
  return readFileSync(join(promptDir, name), 'utf8');
}

const prompts = {
  router: readPrompt('router.md'),
  extractor: readPrompt('extractor.md'),
  judge: readPrompt('judge.md'),
  chat: readPrompt('writer-chat.md'),
  fresh: readPrompt('writer-fresh.md'),
  recheck: readPrompt('writer-recheck.md'),
  noRecord: readPrompt('writer-no-record.md'),
};

const webSearchSchema = z.object({
  query: z.string(),
});

/**
 * Earlier turns as model messages, oldest first. Empty turns are dropped, and
 * so are assistant turns ahead of the first user turn, because the provider
 * expects a conversation to open with the user.
 */
function toMessages(recent: Turn[], message: string): ModelMessage[] {
  const history = recent.filter((turn) => turn.content.trim() !== '');
  const firstUser = history.findIndex((turn) => turn.role === 'user');
  const kept = firstUser === -1 ? [] : history.slice(firstUser);
  return [
    ...kept.map((turn): ModelMessage => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: message },
  ];
}

function recentText(turns: Turn[]): string {
  if (turns.length === 0) return '(none)';
  return turns.map((turn) => `${turn.role} (${turn.localDate}): ${turn.content}`).join('\n');
}

function evidenceText(items: readonly SourceRef[]): string {
  if (items.length === 0) return labeledBlock('Evidence', '(none)');
  return numberedEvidence(
    items.map((item) => ({ n: item.n, url: item.url, title: item.title, text: item.text })),
  );
}

function pageText(page: FetchedPage | null): string {
  if (page === null) return 'Page: (none)';
  // Status is our label. The URL is fetched data, so it stays inside the block.
  return labeledBlock(`Page (status ${page.status})`, `${page.finalUrl}\n${page.text}`);
}

function freshText(fresh: readonly SearchResult[]): string {
  if (fresh.length === 0) return 'Fresh results: (none)';
  return fresh
    .map((item) => labeledBlock('Fresh result', `${item.url}\n${item.text}`))
    .join('\n');
}

function rowsText(rows: readonly VerdictRow[]): string {
  if (rows.length === 0) return '(none)';
  return rows
    .map((row) => {
      const now = row.check.newValue === null ? '' : `; now ${row.check.newValue}`;
      return `${row.claim.entity} ${row.claim.attribute}: was ${row.claim.value}; verdict ${row.check.verdict}${now}; ${row.check.reason}`;
    })
    .join('\n');
}

/** A calendar date as words, for example "Tue 10 Nov 2026". No ISO form. */
function formatWriterDate(iso: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setLocale('en-GB').toFormat('ccc d LLL yyyy');
}

function triedText(tried: DateCandidates): string {
  const range =
    tried.range === null
      ? '(none)'
      : `${formatWriterDate(tried.range.from)} to ${formatWriterDate(tried.range.to)}`;
  const dates = tried.dates.map((date) => formatWriterDate(date)).join(', ') || '(none)';
  return `dates: ${dates}\nrange: ${range}\nambiguous: ${tried.ambiguous}\nrule: ${tried.rule}`;
}

function nearestText(nearest: readonly MemoryHit[]): string {
  if (nearest.length === 0) return '(none)';
  return nearest
    .map((hit) => `${formatWriterDate(hit.userTurn.localDate)} (${hit.matched}): ${hit.userTurn.content}`)
    .join('\n');
}

function finishRouterPlan(plan: RouterPlan, config: AgentConfig): RouterPlan {
  const capped = plan.queries
    .map((query) => query.trim())
    .filter((query) => query.length > 0)
    .slice(0, config.limits.queriesPerTurn);
  return {
    intent: plan.intent,
    timeRef: plan.timeRef,
    timeText: plan.timeRef.kind === 'none' ? null : plan.timeText,
    topic: plan.topic,
    entities: plan.entities,
    queries: plan.intent === 'chat' || plan.intent === 'recall' ? [] : capped,
    refersToPrevious: plan.refersToPrevious,
    wantsNews: plan.wantsNews,
  };
}

function isSchemaFailure(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error);
}

async function withSchemaRetry<T>(
  stage: string,
  schema: z.ZodType<T>,
  call: () => Promise<unknown>,
): Promise<T> {
  let cause: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let value: unknown;
    try {
      value = await call();
    } catch (error) {
      if (!isSchemaFailure(error)) throw error;
      cause = error;
      continue;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    cause = parsed.error;
  }
  throw new SchemaInvalidError(stage, cause);
}

function writerBody(input: WriteInput): string {
  switch (input.mode) {
    case 'chat':
      return input.message;
    case 'fresh':
      return `${input.message}\n\n${evidenceText(input.evidence)}`;
    case 'recheck_summary':
      return `${input.message}\n\nAsked on: ${formatWriterDate(input.askedOn)}\n\n${labeledBlock('Verdict rows', rowsText(input.rows))}\n${evidenceText(input.news)}`;
    case 'no_record':
      return `${input.message}\n\n${labeledBlock('Dates tried', triedText(input.tried))}\n${labeledBlock('Nearest matches', nearestText(input.nearest))}`;
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

function writerInstructions(mode: WriteInput['mode']): string {
  switch (mode) {
    case 'chat':
      return prompts.chat;
    case 'fresh':
      return prompts.fresh;
    case 'recheck_summary':
      return prompts.recheck;
    case 'no_record':
      return prompts.noRecord;
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

async function* readWriterText(
  stream: AsyncIterable<{ type: string; text?: string; error?: unknown }>,
  bucket: { textChars: number; aborted: boolean },
): AsyncIterable<string> {
  for await (const part of stream) {
    if (part.type === 'text-delta' && typeof part.text === 'string') {
      bucket.textChars += part.text.length;
      yield part.text;
    } else if (part.type === 'abort') {
      bucket.aborted = true;
      return;
    } else if (part.type === 'error') {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }
}

async function formatSearchMore(searchMore: SearchMore, query: string): Promise<string> {
  const found = await searchMore(query);
  if (found.length === 0) return dataBlock('(no results)');
  return numberedEvidence(
    found.map((item) => ({ n: item.n, url: item.url, title: item.title, text: item.text })),
  );
}

export function createAiSdkLlm(apiKey: string, config: AgentConfig, deps?: LlmDeps): Llm {
  // Explicit provider with an explicit key: a model object, never a bare
  // "provider/model" string, so no gateway key is involved.
  const anthropic = createAnthropic({ apiKey });

  async function produce(call: GenerateObjectCall, schema: z.ZodType): Promise<unknown> {
    if (deps?.generateObject) return deps.generateObject(call);
    const model = anthropic(call.modelId);
    const shared = {
      model,
      instructions: call.instructions,
      prompt: call.prompt,
      timeout: { totalMs: call.timeoutMs },
      onError: () => {},
    };
    if (call.shape === 'array') {
      const result = await generateText({
        ...shared,
        output: Output.array({ element: schema, name: call.stage }),
      });
      return result.output;
    }
    const result = await generateText({
      ...shared,
      output: Output.object({ schema, name: call.stage }),
    });
    return result.output;
  }

  async function* defaultStream(call: StreamCall): AsyncIterable<string> {
    const webSearch =
      call.webSearch === null
        ? undefined
        : {
            web_search: tool({
              description:
                'Look up one current fact that the numbered evidence does not already contain.',
              inputSchema: webSearchSchema,
              execute: async ({ query }) => call.webSearch!(query),
              toModelOutput: ({ output }) => ({ type: 'text' as const, value: output }),
            }),
          };

    const shared = {
      model: anthropic(call.modelId),
      instructions: call.instructions,
      abortSignal: call.signal,
      timeout: { totalMs: call.timeoutMs },
      onError: () => {},
    };
    const result = streamText({
      ...shared,
      messages: call.messages,
      ...(webSearch
        ? {
            tools: webSearch,
            stopWhen: isStepCount(call.stopSteps ?? config.limits.toolSearches + 1),
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              call.disableTools(stepNumber)
                ? { activeTools: [] as Array<'web_search'>, toolChoice: 'none' as const }
                : {},
            providerOptions: { anthropic: { disableParallelToolUse: true } },
          }
        : {}),
    });

    // claude-sonnet-5-5 sometimes ends the step after web_search with stop and
    // an empty text part. One continuation, with the tool turn replayed and
    // tools off, asks for the answer that step did not write.
    const bucket = { textChars: 0, aborted: false };
    yield* readWriterText(result.stream, bucket);
    if (bucket.aborted || bucket.textChars > 0 || call.signal?.aborted === true) return;

    const steps = await result.steps;
    const follow = streamText({
      ...shared,
      messages: [
        ...call.messages,
        ...steps.flatMap((step) => step.response.messages),
        {
          role: 'user',
          content: 'Write the answer now as text. Do not call a tool. Use only the evidence above.',
        },
      ],
    });
    yield* readWriterText(follow.stream, bucket);
  }

  return {
    async route(input): Promise<RouterPlan> {
      const prompt = [
        `Local time: ${input.nowLocal}`,
        `Time zone: ${input.tz}`,
        `Queries limit: ${config.limits.queriesPerTurn}`,
        labeledBlock('Recent turns', recentText(input.recent)),
        labeledBlock('Message', input.message),
      ].join('\n');
      const plan = await withSchemaRetry('route', routerPlanSchema, () =>
        produce(
          {
            stage: 'route',
            modelId: config.models.router,
            timeoutMs: config.deadlinesMs.router,
            instructions: prompts.router,
            prompt,
            shape: 'object',
          },
          routerPlanSchema,
        ),
      );
      return finishRouterPlan(plan, config);
    },

    async extractClaims(input): Promise<ClaimDraft[]> {
      const prompt = [labeledBlock('Answer', input.answer), evidenceText(input.evidence)].join('\n');
      return withSchemaRetry('extractClaims', claimDraftsSchema, () =>
        produce(
          {
            stage: 'extractClaims',
            modelId: config.models.extractor,
            timeoutMs: config.deadlinesMs.extract ?? config.deadlinesMs.judge,
            instructions: prompts.extractor,
            prompt,
            shape: 'array',
          },
          claimDraftSchema,
        ),
      );
    },

    async judge(input): Promise<JudgeOutput> {
      const claim: Pick<Claim, 'entity' | 'attribute' | 'value' | 'scope' | 'volatility'> = {
        entity: input.claim.entity,
        attribute: input.claim.attribute,
        value: input.claim.value,
        scope: input.claim.scope,
        volatility: input.claim.volatility,
      };
      const prompt = [
        labeledBlock('Claim', JSON.stringify(claim)),
        labeledBlock('Old quote', input.oldQuote),
        pageText(input.page),
        freshText(input.fresh),
      ].join('\n');
      return withSchemaRetry('judge', judgeOutputSchema, () =>
        produce(
          {
            stage: 'judge',
            modelId: config.models.judge,
            timeoutMs: config.deadlinesMs.judge,
            instructions: prompts.judge,
            prompt,
            shape: 'object',
          },
          judgeOutputSchema,
        ),
      );
    },

    async *write(input: WriteInput, signal?: AbortSignal): AsyncIterable<string> {
      const fresh = input.mode === 'fresh';
      const toolSearches = config.limits.toolSearches;
      const webSearch = fresh ? (query: string) => formatSearchMore(input.searchMore, query) : null;
      const call: StreamCall = {
        mode: input.mode,
        modelId: config.models.writer,
        timeoutMs: config.deadlinesMs.turn,
        instructions: writerInstructions(input.mode),
        messages: toMessages(input.mode === 'chat' || input.mode === 'fresh' ? input.recent : [], writerBody(input)),
        toolNames: webSearch === null ? [] : ['web_search'],
        stopSteps: webSearch === null ? null : toolSearches + 1,
        disableTools: (stepNumber) => webSearch !== null && stepNumber >= toolSearches,
        webSearch,
        signal,
      };
      const source = deps?.stream ? deps.stream(call) : defaultStream(call);
      try {
        for await (const delta of source) {
          if (signal?.aborted) return;
          yield delta;
        }
      } catch (error) {
        if (signal?.aborted) return;
        throw error;
      }
    },
  };
}

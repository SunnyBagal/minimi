/**
 * Runs the router and judge golden sets three times each, and the extractor
 * fixtures once, against the real models. Writes golden/results.json.
 *
 * Usage: npm run golden
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defaultConfig } from '../../config';
import type {
  Claim,
  ClaimDraft,
  FetchedPage,
  JudgeOutput,
  RouterPlan,
  SourceRef,
  TimeRef,
  Turn,
  Verdict,
} from '../../contracts';
import { containsQuote } from '../../search/index';
import { createLlm } from '../index';
import { timeRefSchema } from '../schemas';

const dir = dirname(fileURLToPath(import.meta.url));
const FETCHED_AT = '2026-11-13T13:00:00.000Z';
const RUNS = 3;

const routerFileSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      group: z.enum(['brief', 'eval', 'paraphrase']),
      message: z.string(),
      recent: z.array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
          localDate: z.string(),
        }),
      ),
      nowLocal: z.string(),
      tz: z.string(),
      expected: z.object({
        intent: z.enum(['chat', 'fresh', 'recall', 'recheck']),
        timeRef: timeRefSchema,
        refersToPrevious: z.boolean(),
        wantsNews: z.boolean(),
      }),
    }),
  ),
});

const scopeSchema = z.object({
  plan: z.string().optional(),
  period: z.enum(['month', 'year', 'one_time']).optional(),
  currency: z.string().optional(),
  unit: z.enum(['seat', 'flat', 'usage']).optional(),
});

const judgeFileSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      tag: z.string(),
      claim: z.object({
        entity: z.string(),
        attribute: z.string(),
        value: z.string(),
        scope: scopeSchema,
        quote: z.string(),
        volatility: z.enum(['high', 'medium', 'low']),
      }),
      oldQuote: z.string(),
      page: z
        .object({
          url: z.string(),
          finalUrl: z.string(),
          status: z.enum(['ok', 'not_found', 'blocked', 'timeout', 'error']),
          httpStatus: z.number().nullable(),
          title: z.string().nullable(),
          text: z.string(),
          live: z.boolean(),
        })
        .nullable(),
      fresh: z.array(
        z.object({
          url: z.string(),
          title: z.string().nullable(),
          publishedAt: z.string().nullable(),
          text: z.string(),
        }),
      ),
      expectedVerdict: z.enum(['unchanged', 'changed', 'source_unavailable', 'unverifiable']),
    }),
  ),
});

const extractorFileSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      answer: z.string(),
      evidence: z.array(
        z.object({
          n: z.number(),
          sourceId: z.string(),
          url: z.string(),
          title: z.string().nullable(),
          fetchedAtUtc: z.string(),
          live: z.boolean(),
          firstParty: z.boolean(),
          text: z.string(),
        }),
      ),
    }),
  ),
});

type RouterItem = z.infer<typeof routerFileSchema>['items'][number];
type JudgeItem = z.infer<typeof judgeFileSchema>['items'][number];

interface RunRecord<T> {
  pass: boolean;
  output: T | null;
  error: string | null;
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;
}

function sameTimeRef(actual: TimeRef, expected: TimeRef): boolean {
  switch (actual.kind) {
    case 'none':
    case 'future':
      return expected.kind === actual.kind;
    case 'named':
      return expected.kind === 'named' && expected.name === actual.name;
    case 'weekday':
      return (
        expected.kind === 'weekday' &&
        expected.weekday === actual.weekday &&
        expected.modifier === actual.modifier
      );
    case 'calendar':
      return (
        expected.kind === 'calendar' &&
        expected.day === actual.day &&
        expected.month === actual.month &&
        (expected.year ?? null) === (actual.year ?? null)
      );
    case 'numeric':
      return (
        expected.kind === 'numeric' &&
        expected.first === actual.first &&
        expected.second === actual.second &&
        (expected.year ?? null) === (actual.year ?? null)
      );
    case 'ago':
      return expected.kind === 'ago' && expected.unit === actual.unit && expected.n === actual.n;
    case 'period':
      return expected.kind === 'period' && expected.unit === actual.unit && expected.which === actual.which;
    default: {
      const unreachable: never = actual;
      return unreachable;
    }
  }
}

function routerPass(actual: RouterPlan, expected: RouterItem['expected']): boolean {
  return (
    actual.intent === expected.intent &&
    sameTimeRef(actual.timeRef, expected.timeRef) &&
    actual.refersToPrevious === expected.refersToPrevious &&
    actual.wantsNews === expected.wantsNews
  );
}

function toTurn(itemId: string, index: number, recent: RouterItem['recent'][number]): Turn {
  return {
    id: `${itemId}-recent-${index}`,
    sessionId: 'golden',
    role: recent.role,
    content: recent.content,
    createdAtUtc: FETCHED_AT,
    tz: 'Asia/Kolkata',
    localDate: recent.localDate,
    origin: 'live',
    topic: null,
    entities: [],
    summary: null,
    extraction: 'skipped',
    intent: recent.role === 'assistant' ? 'recheck' : null,
    targetTurnIds: [],
  };
}

function toClaim(item: JudgeItem): Claim {
  return {
    id: `claim-${item.id}`,
    turnId: 'turn-golden',
    entity: item.claim.entity,
    attribute: item.claim.attribute,
    value: item.claim.value,
    scope: item.claim.scope,
    sourceId: `source-${item.id}`,
    quote: item.claim.quote,
    asOfUtc: FETCHED_AT,
    volatility: item.claim.volatility,
    lastVerifiedAtUtc: FETCHED_AT,
    supersedesId: null,
  };
}

function toPage(page: NonNullable<JudgeItem['page']>): FetchedPage {
  return { ...page, fetchedAtUtc: FETCHED_AT };
}

function safeError(error: unknown, secret: string): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return secret.length > 0 ? text.split(secret).join('[redacted]') : text;
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const code = error.statusCode;
  return typeof code === 'number' ? code : undefined;
}

function isAuth(error: unknown): boolean {
  const code = statusCode(error);
  return code === 401 || code === 403;
}

function isRateLimit(error: unknown): boolean {
  return statusCode(error) === 429;
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function once<T>(secret: string, fn: () => Promise<T>): Promise<{ output: T | null; error: string | null }> {
  try {
    return { output: await fn(), error: null };
  } catch (error) {
    if (isRateLimit(error)) {
      try {
        return { output: await fn(), error: null };
      } catch (again) {
        if (isAuth(again)) throw again;
        return { output: null, error: safeError(again, secret) };
      }
    }
    if (isAuth(error)) throw error;
    return { output: null, error: safeError(error, secret) };
  }
}

function passesOf<T>(runs: Array<RunRecord<T>>): number {
  return runs.filter((run) => run.pass).length;
}

if (existsSync('.env')) process.loadEnvFile('.env');
const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
if (apiKey.length === 0) {
  console.error('ANTHROPIC_API_KEY is missing');
  process.exit(1);
}

const routerFile = routerFileSchema.parse(readJson('router.json'));
const judgeFile = judgeFileSchema.parse(readJson('judge.json'));
const extractorFile = extractorFileSchema.parse(readJson('extractor.json'));
const llm = createLlm(apiKey, defaultConfig);
const pool = defaultConfig.limits.judgeConcurrency;

const routerItems = await mapPool(routerFile.items, pool, async (item) => {
  const runs: Array<RunRecord<RouterPlan>> = [];
  for (let n = 0; n < RUNS; n += 1) {
    const result = await once(apiKey, () =>
      llm.route({
        message: item.message,
        recent: item.recent.map((turn, index) => toTurn(item.id, index, turn)),
        nowLocal: item.nowLocal,
        tz: item.tz,
      }),
    );
    runs.push({
      pass: result.output !== null && routerPass(result.output, item.expected),
      output: result.output,
      error: result.error,
    });
  }
  const passes = passesOf(runs);
  console.error(`router ${item.id} ${passes}/${RUNS}`);
  return { id: item.id, group: item.group, passes, runs };
});

const judgeItems = await mapPool(judgeFile.items, pool, async (item) => {
  const claim = toClaim(item);
  const page = item.page === null ? null : toPage(item.page);
  const runs: Array<RunRecord<JudgeOutput>> = [];
  for (let n = 0; n < RUNS; n += 1) {
    const result = await once(apiKey, () =>
      llm.judge({ claim, oldQuote: item.oldQuote, page, fresh: item.fresh }),
    );
    const verdict: Verdict | null = result.output?.verdict ?? null;
    runs.push({
      pass: verdict === item.expectedVerdict,
      output: result.output,
      error: result.error,
    });
  }
  const passes = passesOf(runs);
  console.error(`judge ${item.id} ${passes}/${RUNS}`);
  return { id: item.id, tag: item.tag, expected: item.expectedVerdict, passes, runs };
});

const extractorFixtures = [];
let quotesPass = 0;
let drafts = 0;
for (const item of extractorFile.items) {
  const evidence: SourceRef[] = item.evidence;
  const result = await once<ClaimDraft[]>(apiKey, () => llm.extractClaims({ answer: item.answer, evidence }));
  const rows = (result.output ?? []).map((draft) => {
    const source = evidence.find((entry) => entry.n === draft.sourceN);
    const pass = source !== undefined && containsQuote(source.text, draft.quote);
    return { sourceN: draft.sourceN, quote: draft.quote, pass };
  });
  quotesPass += rows.filter((row) => row.pass).length;
  drafts += rows.length;
  console.error(`extractor ${item.id} ${rows.filter((row) => row.pass).length}/${rows.length}`);
  extractorFixtures.push({ id: item.id, error: result.error, drafts: rows });
}

const routerAt3 = routerItems.filter((item) => item.passes === RUNS).length;
const judgeAt3 = judgeItems.filter((item) => item.passes === RUNS).length;
const share = drafts === 0 ? null : quotesPass / drafts;

const results = {
  router: { model: defaultConfig.models.router, passAt3of3: routerAt3, outOf: routerItems.length, items: routerItems },
  judge: { model: defaultConfig.models.judge, passAt3of3: judgeAt3, outOf: judgeItems.length, items: judgeItems },
  extractor: {
    model: defaultConfig.models.extractor,
    quotesPass,
    drafts,
    share,
    containsQuote: 'src/core/search/quote.ts containsQuote',
    fixtures: extractorFixtures,
  },
};

writeFileSync(join(dir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.error(
  `router ${routerAt3}/${routerItems.length} at ${RUNS} of ${RUNS}; judge ${judgeAt3}/${judgeItems.length} at ${RUNS} of ${RUNS}; extractor ${quotesPass}/${drafts}`,
);

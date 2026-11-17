/**
 * Zod schemas for the model steps. None of them has a field for a resolved date.
 * The router copies what the user wrote about time; other code resolves it.
 */
import { z } from 'zod';

const claimScopeSchema = z.strictObject({
  plan: z.string().optional(),
  period: z.enum(['month', 'year', 'one_time']).optional(),
  currency: z.string().optional(),
  unit: z.enum(['seat', 'flat', 'usage']).optional(),
});

const weekdayNumber = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);

/** What the user wrote about time. A discriminated union on `kind`. */
export const timeRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('future') }),
  z.strictObject({
    kind: z.literal('named'),
    name: z.enum(['today', 'yesterday']),
  }),
  z.strictObject({
    kind: z.literal('weekday'),
    weekday: weekdayNumber.describe('ISO weekday, Monday 1 through Sunday 7.'),
    modifier: z.enum(['bare', 'last', 'this']),
  }),
  z.strictObject({
    kind: z.literal('calendar'),
    day: z.number().int(),
    month: z.number().int(),
    year: z.number().int().optional(),
  }),
  z.strictObject({
    kind: z.literal('numeric'),
    first: z.number(),
    second: z.number(),
    year: z.number().int().optional(),
  }),
  z.strictObject({
    kind: z.literal('ago'),
    unit: z.enum(['day', 'week', 'month']),
    n: z.number().int(),
  }),
  z.strictObject({
    kind: z.literal('period'),
    unit: z.enum(['week', 'month']),
    which: z.enum(['last', 'this']),
  }),
]);

export const routerPlanSchema = z.strictObject({
  intent: z.enum(['chat', 'fresh', 'recall', 'recheck']),
  timeRef: timeRefSchema,
  timeText: z.string().nullable(),
  topic: z.string().nullable(),
  entities: z.array(z.string()),
  queries: z.array(z.string()),
  refersToPrevious: z.boolean(),
  wantsNews: z.boolean(),
});

export const claimDraftSchema = z.strictObject({
  entity: z.string(),
  attribute: z.string(),
  value: z.string(),
  scope: claimScopeSchema,
  quote: z.string(),
  volatility: z.enum(['high', 'medium', 'low']),
  sourceN: z.number().int(),
});

export const claimDraftsSchema = z.array(claimDraftSchema);

export const judgeOutputSchema = z.strictObject({
  verdict: z.enum(['unchanged', 'changed', 'source_unavailable', 'unverifiable']),
  newValue: z.string().nullable(),
  quote: z.string().nullable(),
  quoteUrl: z.string().nullable(),
  scope: claimScopeSchema,
  reason: z.string(),
});

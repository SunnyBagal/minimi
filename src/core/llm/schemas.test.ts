import { describe, expect, it } from 'vitest';
import { claimDraftSchema, claimDraftsSchema, judgeOutputSchema, routerPlanSchema, timeRefSchema } from './schemas';

const validPlan = {
  intent: 'recheck',
  timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' },
  timeText: 'Last Tuesday',
  topic: 'Postgres hosting',
  entities: ['Postgres'],
  queries: ['Postgres hosting pricing'],
  refersToPrevious: false,
  wantsNews: false,
};

const validDraft = {
  entity: 'Northwind PG',
  attribute: 'Starter price',
  value: '19 USD per month',
  scope: { plan: 'Starter', period: 'month', currency: 'USD', unit: 'flat' },
  quote: 'Northwind PG Starter is 19 USD per month',
  volatility: 'high',
  sourceN: 1,
};

const validJudge = {
  verdict: 'changed',
  newValue: '24 USD per month',
  quote: 'Northwind PG Starter is 24 USD per month',
  quoteUrl: 'https://northwindpg.test/pricing',
  scope: { plan: 'Starter', period: 'month', currency: 'USD' },
  reason: 'The plan table now says 24 USD per month.',
};

describe('schemas', () => {
  it('accepts a valid RouterPlan and rejects an invalid one', () => {
    expect(routerPlanSchema.safeParse(validPlan).success).toBe(true);
    expect(routerPlanSchema.safeParse({ ...validPlan, intent: 'sing' }).success).toBe(false);
  });

  it('accepts a valid ClaimDraft list and rejects an invalid one', () => {
    expect(claimDraftSchema.safeParse(validDraft).success).toBe(true);
    expect(claimDraftsSchema.safeParse([validDraft]).success).toBe(true);
    expect(claimDraftSchema.safeParse({ ...validDraft, quote: undefined }).success).toBe(false);
    expect(claimDraftsSchema.safeParse({ claims: [validDraft] }).success).toBe(false);
  });

  it('accepts a valid JudgeOutput and rejects an invalid one', () => {
    expect(judgeOutputSchema.safeParse(validJudge).success).toBe(true);
    expect(judgeOutputSchema.safeParse({ ...validJudge, verdict: 'maybe' }).success).toBe(false);
  });

  it('TimeRef accepts each kind and rejects an object with a date string field', () => {
    const samples = [
      { kind: 'none' },
      { kind: 'future' },
      { kind: 'named', name: 'today' },
      { kind: 'weekday', weekday: 1, modifier: 'bare' },
      { kind: 'calendar', day: 3, month: 11 },
      { kind: 'calendar', day: 3, month: 11, year: 2025 },
      { kind: 'numeric', first: 3, second: 11 },
      { kind: 'ago', unit: 'day', n: 3 },
      { kind: 'period', unit: 'week', which: 'last' },
    ];
    for (const sample of samples) {
      expect(timeRefSchema.safeParse(sample).success).toBe(true);
    }
    expect(timeRefSchema.safeParse({ kind: 'none', date: '2026-11-13' }).success).toBe(false);
    expect(timeRefSchema.safeParse({ date: '2026-11-13' }).success).toBe(false);
    expect(
      timeRefSchema.safeParse({ kind: 'calendar', day: 3, month: 11, date: '2026-11-03' }).success,
    ).toBe(false);
    expect(routerPlanSchema.safeParse({ ...validPlan, resolvedDate: '2026-11-10' }).success).toBe(false);
  });
});

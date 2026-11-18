import { describe, expect, it } from 'vitest';
import type { MemoryHit } from '../contracts';
import { literalExcerpt, noRecordLines } from './noRecord';

function hit(localDate: string, content: string): MemoryHit {
  return {
    userTurn: { localDate, content } as MemoryHit['userTurn'],
    assistantTurn: null,
    matched: 'topic',
    score: 1,
  };
}

describe('noRecordLines', () => {
  it('names the topic and every date tried, then the nearest matches', () => {
    const lines = noRecordLines(
      { dates: ['2026-11-10', '2026-11-03'], range: null, ambiguous: true, rule: 'last Tuesday' },
      [hit('2026-11-05', 'Compare Postgres hosting'), hit('2026-11-02', 'Neon pricing')],
      'Postgres hosting',
    );
    expect(lines).toBe(
      'I have nothing saved about Postgres hosting from 10 Nov 2026 or 3 Nov 2026, so I can\'t look that conversation up.\n' +
        'The nearest saved conversations:\n- 5 Nov 2026: `Compare Postgres hosting`\n- 2 Nov 2026: `Neon pricing`\n\n',
    );
  });

  it('states a range by its ends, and omits "about" without a topic', () => {
    expect(noRecordLines({ dates: [], range: { from: '2026-11-02', to: '2026-11-08' }, ambiguous: false, rule: 'last week' }, [], null)).toBe(
      'I have nothing saved from 2 Nov 2026 to 8 Nov 2026, so I can\'t look that conversation up.\n\n',
    );
  });

  it('is empty when no date was tried and nothing is near', () => {
    expect(noRecordLines({ dates: [], range: null, ambiguous: false, rule: 'none' }, [], 'x')).toBe('');
  });
});

describe('literalExcerpt', () => {
  it('keeps a stored question as one literal line that Markdown cannot reinterpret', () => {
    expect(literalExcerpt('Is the "Pro" plan 35 USD?\n\n# Options\n- [a](https://x.test)')).toBe(
      '`Is the "Pro" plan 35 USD? # Options - [a](https://x.test)`',
    );
    expect(literalExcerpt('use `code` here')).toBe("`use 'code' here`");
  });
});

import { describe, expect, it } from 'vitest';
import type { MemoryHit } from '../contracts';
import { literalExcerpt, mergeNearest, noRecordLines } from './noRecord';

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

describe('same-day questions in the no-record answer', () => {
  const dated = (id: string, localDate: string, content: string, score: number, matched: MemoryHit['matched']): MemoryHit => ({
    userTurn: { id, localDate, content } as MemoryHit['userTurn'],
    assistantTurn: null,
    matched,
    score,
  });

  it('names questions from a tried date as "On <date> I do have", apart from nearer days', () => {
    const tried = { dates: ['2026-11-19'], range: null, ambiguous: false, rule: 'last Thursday' };
    const text = noRecordLines(
      tried,
      [dated('a', '2026-11-19', 'How long will it take to finish GTA 6?', 0, 'date'), dated('b', '2026-11-20', 'GTA 6 trailer', 1, 'date')],
      'Grand Theft Auto VI',
    );
    expect(text).toBe(
      "I have nothing saved about Grand Theft Auto VI from 19 Nov 2026, so I can't look that conversation up.\n" +
        'On 19 Nov 2026 I do have: `How long will it take to finish GTA 6?`.\n' +
        'The nearest saved conversation is from 20 Nov 2026: `GTA 6 trailer`.\n\n',
    );
  });

  it('lists several same-day questions, and counts a range as tried', () => {
    const range = { dates: [], range: { from: '2026-11-16', to: '2026-11-20' }, ambiguous: false, rule: 'last week' };
    const text = noRecordLines(range, [dated('a', '2026-11-17', 'Neon price', 0, 'date'), dated('b', '2026-11-19', 'GTA 6', 0, 'date')], null);
    expect(text).toContain('On those dates I do have:\n- 17 Nov 2026: `Neon price`\n- 19 Nov 2026: `GTA 6`');
  });

  it('mergeNearest: topic matches elsewhere first, then same-day questions, each turn once, capped', () => {
    const topicElsewhere = dated('t', '2026-11-12', 'GTA 6 price', 2, 'topic');
    const adjacentNoTopic = dated('n', '2026-11-20', 'weather', 0, 'date');
    const sameDayA = dated('a', '2026-11-19', 'finish GTA 6?', 0, 'date');
    const sameDayB = dated('b', '2026-11-19', 'search for this answer', 0, 'date');
    const merged = mergeNearest([adjacentNoTopic, topicElsewhere], [sameDayA, sameDayB, topicElsewhere], 3);
    expect(merged.map((hit) => hit.userTurn.id)).toEqual(['t', 'a', 'b']);
    expect(mergeNearest([], [], 3)).toEqual([]);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { REPEAT_FOLLOW_UP_RULE, REPEAT_QUESTION_RULE } from '../../src/core/recallHeadline';
import { turnFixture } from '../../src/core/testing/fakes';
import { RecallCard } from './RecallCard';

const userTurn = turnFixture({
  content: 'How long will it take to finish GTA 6?',
  createdAtUtc: '2026-11-19T14:14:00.000Z',
  localDate: '2026-11-19',
  tz: 'UTC',
});

function renderRepeat(createdAtUtc: string, rule: string, intent: 'chat' | 'fresh' = 'fresh'): string {
  const assistantTurn = turnFixture({ id: 'answer', role: 'assistant', createdAtUtc, intent, tz: userTurn.tz });
  return renderToStaticMarkup(RecallCard({
    data: {
      candidates: { dates: [userTurn.localDate], range: null, ambiguous: false, rule },
      hits: [{ userTurn, assistantTurn, matched: 'topic', score: 1 }],
      chosen: userTurn.localDate,
      asked: {
        turnId: userTurn.id, question: userTurn.content, createdAtUtc: userTurn.createdAtUtc,
        tz: userTurn.tz, origin: userTurn.origin,
      },
    },
  }));
}

describe('repeat recall card', () => {
  it('keeps the original question date and adds the time of a same-day search', () => {
    const html = renderRepeat('2026-11-19T16:30:00.000Z', REPEAT_FOLLOW_UP_RULE);
    expect(html).toContain('You asked this before, on 19 Nov 2026 at 2:14 pm');
    expect(html).toContain('Last answered at 4:30 pm after a search.');
  });

  it('includes the date when the last answer was on a different day', () => {
    const html = renderRepeat('2026-11-20T09:05:00.000Z', REPEAT_FOLLOW_UP_RULE);
    expect(html).toContain('Last answered on 20 Nov 2026 at 9:05 am after a search.');
  });

  it('shows the later time for a plain chat follow-up without claiming a search', () => {
    const html = renderRepeat('2026-11-19T16:30:00.000Z', REPEAT_FOLLOW_UP_RULE, 'chat');
    expect(html).toContain('Last answered at 4:30 pm.');
    expect(html).not.toContain('after a search');
  });

  it('keeps the question headline alone for an original answer', () => {
    const html = renderRepeat('2026-11-19T14:15:00.000Z', REPEAT_QUESTION_RULE);
    expect(html).toContain('You asked this before, on 19 Nov 2026 at 2:14 pm');
    expect(html).not.toContain('Last answered');
  });
});

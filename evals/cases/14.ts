import { numbersAllowed, ok, quoteInPage, verdictFor } from '../assert';
import { MSG_CASE_3 } from '../messages';
import { readFixture } from '../pages';
import { scenarioBasaltReword } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

const PAGE = readFixture('basalt-pricing-v2-reword.txt');

export const evalCase: EvalCase = {
  id: 14,
  parts: [{ seeds: ['S-PG'], clock: CLOCK, tz: TZ, scenario: scenarioBasaltReword(), messages: [MSG_CASE_3] }],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const row = verdictFor(events, 'Basalt DB', 'price');
    return [
      ok('Basalt Pro is unchanged', row?.check.verdict === 'unchanged', row?.check.verdict ?? null),
      ok('decidedBy is judge', row?.check.decidedBy === 'judge', row?.check.decidedBy ?? null),
      ok('newQuote is in the v2 page', quoteInPage(row?.check.newQuote ?? null, PAGE), row?.check.newQuote ?? null),
      numbersAllowed(run, events, [PAGE]),
    ];
  },
};

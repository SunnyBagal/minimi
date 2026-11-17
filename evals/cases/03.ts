import { candidateDates, chosenIs, numbersAllowed, ok, quoteInPage, verdictFor, verdictsOf } from '../assert';
import { MSG_CASE_3 } from '../messages';
import { readFixture } from '../pages';
import { scenarioPgChanged } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

const PAGE = readFixture('northwind-pricing-v2.txt');

export const evalCase: EvalCase = {
  id: 3,
  parts: [
    { seeds: ['S-PG', 'S-NOV3'], clock: CLOCK, tz: TZ, scenario: scenarioPgChanged(), messages: [MSG_CASE_3] },
  ],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    const rows = verdictsOf(events);
    const northwind = verdictFor(events, 'Northwind PG', 'price');
    const basalt = verdictFor(events, 'Basalt DB', 'price');
    const entities = [...new Set(rows.map((row) => row.claim.entity))];
    const outside = entities.filter((entity) => entity !== 'Northwind PG' && entity !== 'Basalt DB');
    const settled = rows.filter((row) => row.check.verdict === 'changed' || row.check.verdict === 'unchanged');
    return [
      candidateDates(events, ['2026-11-10', '2026-11-03']),
      chosenIs(events, '2026-11-10'),
      ok('answer contains 10 Nov', answer.includes('10 Nov'), answer),
      ok('Northwind Starter is changed', northwind?.check.verdict === 'changed', northwind?.check.verdict ?? null),
      ok('Northwind newValue contains 24', (northwind?.check.newValue ?? '').includes('24'), northwind?.check.newValue ?? null),
      ok('Northwind newQuote is in the v2 page', quoteInPage(northwind?.check.newQuote ?? null, PAGE), northwind?.check.newQuote ?? null),
      ok('Basalt Pro is unchanged', basalt?.check.verdict === 'unchanged', basalt?.check.verdict ?? null),
      ok(
        'every changed or unchanged row has a live url',
        settled.every((row) => row.nowSource !== null && row.nowSource.live && row.nowSource.url.length > 0),
        settled.map((row) => ({ entity: row.claim.entity, live: row.nowSource?.live ?? null, url: row.nowSource?.url ?? null })),
      ),
      ok('no entity outside S-PG appears in a verdict', outside.length === 0, entities),
      numbersAllowed(run, events, [PAGE]),
    ];
  },
};

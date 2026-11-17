import { numbersAllowed, ok, verdictFor } from '../assert';
import { MSG_CASE_3 } from '../messages';
import { URLS } from '../pages';
import { scenarioThirdParty } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 15,
  parts: [
    {
      seeds: ['S-PG'],
      seedOptions: { northwindFromBlog: true },
      clock: CLOCK,
      tz: TZ,
      scenario: scenarioThirdParty(),
      messages: [MSG_CASE_3],
    },
  ],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const row = verdictFor(events, 'Northwind PG', 'price');
    return [
      ok('Northwind Starter is changed', row?.check.verdict === 'changed', row?.check.verdict ?? null),
      ok('newValue contains 24', (row?.check.newValue ?? '').includes('24'), row?.check.newValue ?? null),
      ok('source is the vendor page', row?.nowSource?.url === URLS.northwindPricing, row?.nowSource?.url ?? null),
      ok('decidedBy is not fast_path', row?.check.decidedBy !== 'fast_path' && row !== undefined, row?.check.decidedBy ?? null),
      numbersAllowed(run, events, []),
    ];
  },
};

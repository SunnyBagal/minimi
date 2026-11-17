import { numbersAllowed, ok, verdictFor } from '../assert';
import { MSG_CASE_3 } from '../messages';
import { readFixture } from '../pages';
import { scenarioBasaltAnnual } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 13,
  parts: [{ seeds: ['S-PG'], clock: CLOCK, tz: TZ, scenario: scenarioBasaltAnnual(), messages: [MSG_CASE_3] }],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const row = verdictFor(events, 'Basalt DB', 'price');
    const verdict = row?.check.verdict ?? null;
    const newValue = row?.check.newValue ?? '';
    const reason = row?.check.reason ?? '';
    const quote = row?.check.newQuote ?? '';
    const page = readFixture('basalt-pricing-v2-annual.txt');
    const changedWith240 = verdict === 'changed' && newValue.includes('240');
    const unverifiable =
      verdict === 'unverifiable' && /period|billing|annual|month/i.test(reason);
    const changedMonthly = verdict === 'changed' && /month/i.test(quote) && quote.length > 0 && page.includes(quote);
    return [
      ok(
        'Basalt Pro is not changed to 240',
        !changedWith240 && (unverifiable || changedMonthly),
        { verdict, newValue, reason },
      ),
      numbersAllowed(run, events, [page]),
    ];
  },
};

import { dateWords } from '../../src/core/dateWords';
import { claimsNoChangeAbout, formatLocalDate, judgeSaysNo, numbersAllowed, ok, verdictFor, verdictIs } from '../assert';
import { MSG_CASE_3 } from '../messages';
import { scenarioNorthwindTimeout } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 16,
  judges: ['J2'],
  parts: [{ seeds: ['S-PG'], clock: CLOCK, tz: TZ, scenario: scenarioNorthwindTimeout(), messages: [MSG_CASE_3] }],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    const reached = /could not|couldn't|timed out|unavailable|not reach|not be reached/i.test(answer);
    // One Northwind line pairs that row's own last value with its own last-verified date (not the old question's header).
    const north = verdictFor(events, 'Northwind PG', 'price');
    const lastDate = north === undefined ? null : dateWords(formatLocalDate(north.claim.lastVerifiedAtUtc, TZ));
    const lastValue =
      north !== undefined &&
      lastDate !== null &&
      answer
        .split('\n')
        .some((line) => /northwind/i.test(line) && line.includes(`${north.claim.value} on ${lastDate}`) && /couldn'?t verify/i.test(line));
    // Scoped to sentences about Northwind: "Basalt DB is unchanged" is not a claim about Northwind.
    const saysNoChange = claimsNoChangeAbout(answer, /northwind/i, /basalt/i);
    return [
      verdictIs(events, 'Northwind PG', 'price', 'source_unavailable'),
      ok('answer says the page could not be reached', reached && /northwind/i.test(answer), answer),
      ok('answer gives the last verified value with its date', lastValue, answer),
      ok('answer does not say no change about Northwind', !saysNoChange, saysNoChange),
      ...judgeSaysNo(run, 'J2'),
      numbersAllowed(run, events, []),
    ];
  },
};

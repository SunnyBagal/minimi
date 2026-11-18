import { claimsNoChangeAbout, judgeSaysNo, numbersAllowed, ok, verdictIs } from '../assert';
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
    // One Northwind line pairs the last verified value with its date (not the old question's header).
    const lastValue = answer
      .split('\n')
      .some((line) => /northwind/i.test(line) && /\b19\b/.test(line) && /\b10 Nov\b/.test(line));
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

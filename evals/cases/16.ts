import { judgeSaysNo, numbersAllowed, ok, verdictIs } from '../assert';
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
    const lastValue = answer.includes('19') && /10 Nov|Nov/.test(answer);
    const saysNoChange = /northwind[\s\S]{0,80}no change|no change[\s\S]{0,80}northwind|unchanged/i.test(answer);
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

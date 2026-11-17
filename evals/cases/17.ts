import { numbersAllowed, ofType, ok } from '../assert';
import { MSG_MUTEX, MSG_SHORTER } from '../messages';
import { scenarioEmpty } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

const STORED = /Northwind|Basalt|19 USD|25 USD/;

export const evalCase: EvalCase = {
  id: 17,
  parts: [{ seeds: ['S-PG'], clock: CLOCK, tz: TZ, scenario: scenarioEmpty(), messages: [MSG_SHORTER, MSG_MUTEX] }],
  check(run) {
    const traces = run.parts[0]?.traces ?? [];
    const log = run.parts[0]?.log ?? [];
    const checks = traces.flatMap((trace, index) => {
      const label = index === 0 ? 'shorter' : 'mutex';
      const events = trace.events;
      const done = ofType(events, 'done')[0];
      return [
        ok(`${label} done.intent is chat`, done?.intent === 'chat', done?.intent ?? null),
        ok(`${label} has no recall event`, ofType(events, 'recall').length === 0, ofType(events, 'recall').length),
        ok(`${label} has no verdict event`, ofType(events, 'verdict').length === 0, ofType(events, 'verdict').length),
        ok(`${label} has no citations event`, ofType(events, 'citations').length === 0, ofType(events, 'citations').length),
        ok(`${label} does not mention a stored claim`, !STORED.test(trace.answerText), trace.answerText),
        numbersAllowed(run, events, [], label),
      ];
    });
    return [ok('provider log is empty', log.length === 0, log.length), ...checks];
  },
};

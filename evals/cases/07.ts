import { noVerdicts, numbersAllowed, ok, recallOf } from '../assert';
import { MSG_CASE_3 } from '../messages';
import { scenarioPgChanged } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 7,
  parts: [
    { seeds: ['S-PG', 'S-PG-OLD'], clock: CLOCK, tz: TZ, scenario: scenarioPgChanged(), messages: [MSG_CASE_3] },
  ],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    const recall = recallOf(events);
    return [
      ok('candidates.ambiguous is true', recall?.candidates.ambiguous === true, recall?.candidates.ambiguous ?? null),
      ok('chosen is null', recall?.chosen === null, recall?.chosen ?? 'missing'),
      ok('answer shows 10 Nov', /10 Nov/.test(answer), answer),
      ok('answer shows 3 Nov', /3 Nov/.test(answer), answer),
      ok('answer asks which', /which/i.test(answer), answer),
      noVerdicts(events),
      numbersAllowed(run, events, []),
    ];
  },
};

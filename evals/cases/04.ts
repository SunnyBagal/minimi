import { judgeSaysNo, noVerdicts, numbersAllowed, ok, recallOf } from '../assert';
import { MSG_CASE_3 } from '../messages';
import { scenarioPgChanged } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 4,
  judges: ['J1'],
  parts: [{ seeds: [], clock: CLOCK, tz: TZ, scenario: scenarioPgChanged(), messages: [MSG_CASE_3] }],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    const recall = recallOf(events);
    const prices = /19|25|24/.test(answer);
    return [
      ok('recall.hits is empty', recall !== undefined && recall.hits.length === 0, recall?.hits.length ?? null),
      ok('answer names 10 Nov', /10 Nov/.test(answer), answer),
      ok('answer names 3 Nov', /3 Nov/.test(answer), answer),
      noVerdicts(events),
      ok('no then-price is stated', !prices, answer),
      ok(
        'answer offers to look up Postgres hosting pricing',
        /postgres/i.test(answer) && /look up|look this up|check now|fresh/i.test(answer),
        answer,
      ),
      ...judgeSaysNo(run, 'J1'),
      numbersAllowed(run, events, []),
    ];
  },
};

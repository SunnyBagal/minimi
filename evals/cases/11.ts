import { chosenIs, numbersAllowed, ok, verdictsOf } from '../assert';
import { MSG_CASE_3, MSG_TENTH } from '../messages';
import { scenarioPgChanged } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

const PG = ['Northwind PG price', 'Basalt DB price', 'Basalt DB free tier'];

export const evalCase: EvalCase = {
  id: 11,
  parts: [
    {
      seeds: ['S-PG', 'S-PG-OLD'],
      clock: CLOCK,
      tz: TZ,
      scenario: scenarioPgChanged(),
      messages: [MSG_CASE_3, MSG_TENTH],
    },
  ],
  check(run) {
    const events = run.parts[0]?.traces[1]?.events ?? [];
    const answer = run.parts[0]?.traces[1]?.answerText ?? '';
    const rows = verdictsOf(events);
    const keys = rows.map((row) => `${row.claim.entity} ${row.claim.attribute}`);
    return [
      chosenIs(events, '2026-11-10'),
      ok(
        'verdicts cover S-PG claims only',
        keys.length === PG.length && PG.every((key) => keys.includes(key)),
        keys,
      ),
      ok('answer does not ask the date question again', !/which one do you mean/i.test(answer), answer),
      numbersAllowed(run, events, []),
      numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], [], 'first turn'),
    ];
  },
};

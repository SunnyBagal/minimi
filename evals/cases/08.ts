import { candidateDates, chosenIs, numbersAllowed, ok } from '../assert';
import { MSG_CASE_8 } from '../messages';
import { scenarioPipeloomSame } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

/**
 * The eval asks for the words "3 November 2026". The recall line prints
 * formatLocal, which is "Tue 3 Nov 2026, …". The assertion keeps the eval's
 * words. See the handoff under Disputed.
 */
export const evalCase: EvalCase = {
  id: 8,
  parts: [{ seeds: ['S-NOV3'], clock: CLOCK, tz: TZ, scenario: scenarioPipeloomSame(), messages: [MSG_CASE_8] }],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    return [
      candidateDates(events, ['2026-11-03', '2026-03-11']),
      chosenIs(events, '2026-11-03'),
      ok('answer says 3 November 2026', answer.includes('3 November 2026'), answer),
      numbersAllowed(run, events, []),
    ];
  },
};

import { candidateDates, chosenIs, numbersAllowed, ok, recallOf } from '../assert';
import { MSG_CASE_1 } from '../messages';
import { scenarioCrmChanged } from '../scenarios';
import type { EvalCase } from '../types';

const CLOCK = '2026-11-16T04:30:00.000Z';

export const evalCase: EvalCase = {
  id: 9,
  parts: [{ seeds: ['S-CRM'], clock: CLOCK, tz: 'Asia/Kolkata', scenario: scenarioCrmChanged(), messages: [MSG_CASE_1] }],
  check(run) {
    const trace = run.parts[0]?.traces[0];
    const events = trace?.events ?? [];
    const answer = trace?.answerText ?? '';
    const hits = recallOf(events)?.hits ?? [];
    const self = hits.some((hit) => hit.userTurn.content === trace?.message);
    return [
      candidateDates(events, ['2026-11-16', '2026-11-09']),
      chosenIs(events, '2026-11-09'),
      ok('no hit is the current message', !self, self),
      ok('answer states Mon 9 Nov', answer.includes('Mon 9 Nov'), answer),
      numbersAllowed(run, events, []),
    ];
  },
};

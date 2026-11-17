import { chosenIs, numbersAllowed, ok, recallOf } from '../assert';
import { MSG_MONDAY, MSG_YESTERDAY } from '../messages';
import { scenarioEmpty } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

const LATE_CLOCK = '2026-11-10T18:40:00.000Z';

export const evalCase: EvalCase = {
  id: 18,
  parts: [
    { seeds: ['S-LATE'], clock: LATE_CLOCK, tz: TZ, scenario: scenarioEmpty(), messages: [MSG_YESTERDAY] },
    { seeds: ['S-LA'], clock: CLOCK, tz: TZ, scenario: scenarioEmpty(), messages: [MSG_MONDAY] },
  ],
  check(run) {
    const yesterday = run.parts[0]?.traces[0]?.events ?? [];
    const mondayEvents = run.parts[1]?.traces[0]?.events ?? [];
    const mondayAnswer = run.parts[1]?.traces[0]?.answerText ?? '';
    const hit = recallOf(yesterday)?.hits[0];
    const mondayHit = recallOf(mondayEvents)?.hits.find((item) => item.userTurn.localDate === '2026-11-09');
    return [
      chosenIs(yesterday, '2026-11-10'),
      ok(
        'yesterday hit is S-LATE',
        hit?.userTurn.content.includes('connection pooler') === true,
        hit?.userTurn.content ?? null,
      ),
      ok(
        'Monday hit is S-LA under 9 Nov',
        mondayHit?.userTurn.content.includes('Basalt DB') === true,
        mondayHit?.userTurn.localDate ?? null,
      ),
      ok('answer shows Mon 9 Nov, 23:30', mondayAnswer.includes('Mon 9 Nov') && mondayAnswer.includes('23:30'), mondayAnswer),
      ok('answer shows the Los Angeles zone', mondayAnswer.includes('America/Los_Angeles'), mondayAnswer),
      numbersAllowed(run, yesterday, [], 'yesterday'),
      numbersAllowed(run, mondayEvents, [], 'monday'),
    ];
  },
};

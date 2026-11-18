import { formatLocal } from '../../src/core/time/format';
import { chosenIs, numbersAllowed, ofType, ok, verdictIs, verdictsOf } from '../assert';
import { MSG_CASE_2 } from '../messages';
import { scenarioPipeloomSame } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 2,
  parts: [{ seeds: ['S-NOV3'], clock: CLOCK, tz: TZ, scenario: scenarioPipeloomSame(), messages: [MSG_CASE_2] }],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    const log = run.parts[0]?.log ?? [];
    const fetches = log.filter((call) => call.kind === 'fetchPage');
    const rows = verdictsOf(events);
    const row = rows[0];
    const flags = ofType(events, 'flags');
    return [
      chosenIs(events, '2026-11-03'),
      ok('answer contains Pipeloom and Team', answer.includes('Pipeloom') && answer.includes('Team'), answer),
      ok('one verdict', rows.length === 1, rows.length),
      verdictIs(events, 'Pipeloom', 'price', 'unchanged'),
      ok('decidedBy is fast_path', row?.check.decidedBy === 'fast_path', row?.check.decidedBy ?? null),
      ok('exactly 1 page fetch', fetches.length === 1, fetches.length),
      ok(
        "answer shows this check's time",
        verdictsOf(events).some((row) => answer.includes(`Checked ${formatLocal(row.check.checkedAtUtc, TZ)}`)),
        answer,
      ),
      ok(
        'flags.uncitedNumbers is empty',
        flags.length > 0 && flags.every((flag) => flag.uncitedNumbers.length === 0),
        flags.map((flag) => flag.uncitedNumbers),
      ),
      numbersAllowed(run, events, []),
    ];
  },
};

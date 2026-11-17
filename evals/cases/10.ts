import { intentIs, numbersAllowed, ok, verdictIs, verdictsOf } from '../assert';
import { MSG_CASE_10A, MSG_STILL } from '../messages';
import { scenarioBasaltV1Search } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 10,
  parts: [
    {
      seeds: [],
      clock: CLOCK,
      tz: TZ,
      scenario: scenarioBasaltV1Search(),
      messages: [MSG_CASE_10A, MSG_STILL],
    },
  ],
  check(run) {
    const second = run.parts[0]?.traces[1];
    const events = second?.events ?? [];
    const rows = verdictsOf(events);
    const recall = events.find((event) => event.type === 'recall');
    const usedDateLookup = recall !== undefined && recall.type === 'recall' && recall.candidates.rule !== 'the previous answer in this session';
    return [
      intentIs(events, 'recheck'),
      ok('found without a date lookup', recall !== undefined && !usedDateLookup, recall?.type === 'recall' ? recall.candidates.rule : null),
      ok('one verdict', rows.length === 1, rows.length),
      verdictIs(events, 'Basalt DB', 'price', 'unchanged'),
      numbersAllowed(run, events, []),
    ];
  },
};

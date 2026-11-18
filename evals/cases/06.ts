import { asksToConfirm, chosenIs, noVerdicts, numbersAllowed, ok, recallOf } from '../assert';
import { MSG_CASE_3 } from '../messages';
import { scenarioPgChanged } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

/**
 * docs/02-evals.md asks for a topic hit inside recall.hits. The pipeline's
 * no-record path emits recall with empty hits and hands nearest turns to the
 * writer. This check follows that reading. The eval wording is listed as disputed.
 */
export const evalCase: EvalCase = {
  id: 6,
  parts: [
    {
      seeds: ['S-NOV3', 'S-PG'],
      seedOptions: { pgOnThursday5Nov: true },
      clock: CLOCK,
      tz: TZ,
      scenario: scenarioPgChanged(),
      messages: [MSG_CASE_3],
    },
  ],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    const recall = recallOf(events);
    // The nearest matches the pipeline actually emitted (and showed), not a fresh store query.
    const topicHit = (recall?.nearest ?? []).find(
      (hit) => hit.matched === 'topic' && hit.userTurn.localDate === '2026-11-05',
    );
    return [
      chosenIs(events, null),
      ok('recall.hits is empty', recall !== undefined && recall.hits.length === 0, recall?.hits.length ?? null),
      ok('nearest 5 Nov hit is matched topic', topicHit !== undefined, topicHit?.matched ?? null),
      ok('answer names Tue 10 Nov or 10 Nov', /10 Nov/.test(answer), answer),
      ok('answer names Tue 3 Nov or 3 Nov', /3 Nov/.test(answer), answer),
      ok(
        'answer offers Thu 5 Nov by date and asks the user to confirm it',
        /5 Nov/.test(answer) && asksToConfirm(answer),
        answer,
      ),
      noVerdicts(events),
      numbersAllowed(run, events, []),
    ];
  },
};

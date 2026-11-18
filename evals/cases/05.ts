import { judgeSaysNo, noVerdicts, numbersAllowed, ok } from '../assert';
import { CRM_NAMES, MSG_CASE_1 } from '../messages';
import { scenarioEmpty } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 5,
  judges: ['J3'],
  parts: [{ seeds: [], clock: CLOCK, tz: TZ, scenario: scenarioEmpty(), messages: [MSG_CASE_1] }],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    const invented = CRM_NAMES.filter((name) => answer.includes(name));
    return [
      noVerdicts(events),
      ok('answer contains no fixture CRM name', invented.length === 0, invented),
      ok(
        'answer says the shortlist is not saved and asks for the names or offers a fresh shortlist',
        /not saved|don't have|do not have|no shortlist|isn't saved|is not saved|no saved|nothing saved/i.test(answer) &&
          // Asks for the names (a question about which tools / their names) or offers to build a fresh shortlist.
          (/\b(which|what)\b[^.?!]*\b(tools?|names?|crms?)\b[^.?!]*\?/i.test(answer) ||
            /\b(tell|send|share|give|list)\b[^.?!]*\b(names?|tools?)\b/i.test(answer) ||
            /\b(fresh|new)\b[^.?!]*\bshortlist\b|\b(put together|build|draw up|make)\b[^.?!]*\bshortlist\b/i.test(answer)),
        answer,
      ),
      ...judgeSaysNo(run, 'J3'),
      numbersAllowed(run, events, []),
    ];
  },
};

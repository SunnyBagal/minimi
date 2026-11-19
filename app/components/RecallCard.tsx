'use client';

import type { DateCandidates, MemoryHit, RecalledQuestion, Turn } from '../../src/core/contracts';
import { recallHeadline, REPEAT_FOLLOW_UP_RULE, REPEAT_QUESTION_RULE } from '../../src/core/recallHeadline';
import { formatClockTime, formatLocal } from '../../src/core/time/format';

interface RecallData {
  candidates: DateCandidates;
  hits: MemoryHit[];
  chosen: string | null;
  /** The recalled question. Absent on messages saved before it was added. */
  asked?: RecalledQuestion | null;
}

function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function repeatDate(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
}

function repeatHeadline(asked: RecalledQuestion): string {
  const instant = new Date(asked.createdAtUtc);
  const timeZone = asked.tz;
  const date = repeatDate(timeZone).format(instant);
  const time = formatClockTime(instant, timeZone, 'en-GB');
  const zone = timeZone === viewerZone() ? '' : ` (${timeZone})`;
  const seeded = asked.origin === 'seed' ? ' (seeded demo history)' : '';
  return `You asked this before, on ${date} at ${time}${zone}.${seeded}`;
}

function lastAnswered(asked: RecalledQuestion, answer: Turn): string {
  const instant = new Date(answer.createdAtUtc);
  const formatDate = repeatDate(asked.tz);
  const answeredDate = formatDate.format(instant);
  const sameDay = answeredDate === formatDate.format(new Date(asked.createdAtUtc));
  const when = sameDay ? '' : `on ${answeredDate} `;
  const time = formatClockTime(instant, asked.tz, 'en-GB');
  const searched = answer.intent === 'fresh' || (answer.intent === 'recheck' && answer.targetTurnIds.length > 0);
  const search = searched ? ' after a search' : '';
  return `Last answered ${when}at ${time}${search}.`;
}

/** The card that names the stored conversation the answer is about, and the question asked then. */
export function RecallCard({ data }: { data: RecallData }) {
  const asked = data.asked ?? null;
  const usedFollowUp = data.candidates.rule === REPEAT_FOLLOW_UP_RULE;
  if ((data.candidates.rule === REPEAT_QUESTION_RULE || usedFollowUp) && asked !== null) {
    const answer = usedFollowUp ? data.hits[0]?.assistantTurn : null;
    return (
      <div data-testid="recall" className="recall">
        <div className="recall-asked" data-testid="recall-asked">{repeatHeadline(asked)}</div>
        {answer != null ? <div className="recall-asked">{lastAnswered(asked, answer)}</div> : null}
      </div>
    );
  }

  const chosenHit = data.chosen !== null ? data.hits.find((hit) => hit.userTurn.localDate === data.chosen) : undefined;
  const seeded = (asked?.origin ?? chosenHit?.userTurn.origin) === 'seed';
  const others = data.candidates.dates.filter((date) => date !== data.chosen);
  return (
    <div data-testid="recall" className="recall">
      {data.chosen !== null ? (
        <div>
          <strong>About {data.chosen}</strong>
          {seeded ? <span className="recall-seeded">(seeded)</span> : null}
          {asked !== null ? (
            <div className="recall-asked" data-testid="recall-asked">
              {recallHeadline(asked, formatLocal, viewerZone())}
            </div>
          ) : null}
          {others.length > 0 ? <div className="recall-others">other dates considered: {others.join(', ')}</div> : null}
        </div>
      ) : data.hits.length === 0 ? (
        <span>No matching conversation.</span>
      ) : (
        <span>More than one conversation could match.</span>
      )}
    </div>
  );
}

'use client';

import type { DateCandidates, MemoryHit, RecalledQuestion } from '../../src/core/contracts';
import { recallHeadline } from '../../src/core/recallHeadline';
import { formatLocal } from '../../src/core/time/format';

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

/** The card that names the stored conversation the answer is about, and the question asked then. */
export function RecallCard({ data }: { data: RecallData }) {
  const chosenHit = data.chosen !== null ? data.hits.find((hit) => hit.userTurn.localDate === data.chosen) : undefined;
  const asked = data.asked ?? null;
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

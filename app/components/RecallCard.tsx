'use client';

import type { DateCandidates, MemoryHit } from '../../src/core/contracts';

interface RecallData {
  candidates: DateCandidates;
  hits: MemoryHit[];
  chosen: string | null;
}

/** The card that names the stored conversation the answer is about. */
export function RecallCard({ data }: { data: RecallData }) {
  const chosenHit = data.chosen !== null ? data.hits.find((hit) => hit.userTurn.localDate === data.chosen) : undefined;
  const seeded = chosenHit?.userTurn.origin === 'seed';
  const others = data.candidates.dates.filter((date) => date !== data.chosen);
  return (
    <div data-testid="recall" className="recall">
      {data.chosen !== null ? (
        <div>
          <strong>About {data.chosen}</strong>
          {seeded ? <span className="recall-seeded">(seeded)</span> : null}
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

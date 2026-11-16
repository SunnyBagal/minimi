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
    <div data-testid="recall" style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, margin: '6px 0', fontSize: 13 }}>
      {data.chosen !== null ? (
        <>
          <strong>About {data.chosen}</strong>
          {seeded ? <span style={{ marginLeft: 6, color: '#777' }}>(seeded)</span> : null}
          {others.length > 0 ? <div>other dates considered: {others.join(', ')}</div> : null}
        </>
      ) : data.hits.length === 0 ? (
        <span>No matching conversation.</span>
      ) : (
        <span>More than one conversation could match.</span>
      )}
    </div>
  );
}

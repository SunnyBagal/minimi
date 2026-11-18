'use client';

/** Per-stage timings of the last assistant turn, for development only. */
export function DevFooter({ timings }: { timings: { stage: string; ms: number }[] }) {
  if (timings.length === 0) return null;
  return (
    <footer data-testid="dev-footer" className="timings" aria-label="Timings">
      {timings.map((entry, index) => (
        <span key={index} className="timing">
          {entry.stage}: {entry.ms} ms
        </span>
      ))}
    </footer>
  );
}

'use client';

/** Per-stage timings of the last assistant turn, for development only. */
export function DevFooter({ timings }: { timings: { stage: string; ms: number }[] }) {
  if (timings.length === 0) return null;
  return (
    <footer data-testid="dev-footer" style={{ marginTop: 16, fontSize: 11, color: '#999' }}>
      {timings.map((entry, index) => (
        <span key={index} style={{ marginRight: 10 }}>
          {entry.stage}: {entry.ms} ms
        </span>
      ))}
    </footer>
  );
}

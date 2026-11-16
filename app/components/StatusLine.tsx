'use client';

/** The transient status text the pipeline emits between steps. */
export function StatusLine({ text, error }: { text: string; error: string | null }) {
  return (
    <p aria-live="polite" data-testid="status" style={{ minHeight: 20, color: '#555' }}>
      {error !== null ? `Error: ${error}` : text}
    </p>
  );
}

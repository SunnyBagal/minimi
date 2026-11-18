'use client';

import type { ReactNode } from 'react';

/** The transient status text the pipeline emits between steps, with a small working indicator. */
export function StatusLine({ text }: { text: string }) {
  return (
    <p aria-live="polite" data-testid="status" className="status">
      <span className="dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{text === '' ? 'Working' : text}</span>
    </p>
  );
}

/** An inline error inside an answer card. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="alert">
      {children}
    </div>
  );
}

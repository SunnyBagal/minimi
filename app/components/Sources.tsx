'use client';

import { checkedLabel, type Citation } from './CitedText';

/** The host name of a URL, without "www.", or the URL itself when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The numbered sources under an answer: number, host, title and when each was checked. */
export function Sources({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  const sorted = [...citations].sort((a, b) => a.n - b.n);
  return (
    <section className="sources" aria-label="Sources">
      <h3 className="sources-head">Sources</h3>
      <ol className="sources-list">
        {sorted.map((source) => (
          <li key={source.n}>
            <a className="source" href={source.url} target="_blank" rel="noopener noreferrer">
              <span className="source-n">{source.n}</span>
              <span className="source-host">{hostOf(source.url)}</span>
              {source.title !== null && source.title !== '' ? <span className="source-title">{source.title}</span> : null}
              <span className="source-checked">
                {checkedLabel(source)} · {source.live ? 'live' : 'cached'}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

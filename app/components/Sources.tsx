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
      <p className="sources-note">
        live: fetched when the answer was written. Search-index copy: the search engine&rsquo;s stored copy, which a
        re-check fetches live.
      </p>
      <ol className="sources-list">
        {sorted.map((source) => (
          <li key={source.n}>
            <a className="source" href={source.url} target="_blank" rel="noopener noreferrer">
              <span className="source-n">{source.n}</span>
              <span className="source-host">{hostOf(source.url)}</span>
              {source.title !== null && source.title !== '' ? <span className="source-title">{source.title}</span> : null}
              <span className="source-checked">{checkedLabel(source)}</span>
              <span className={source.live ? 'source-state source-live' : 'source-state'}>
                {source.live ? 'live' : 'search-index copy'}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

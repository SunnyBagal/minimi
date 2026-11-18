import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sources } from './Sources';

const CITATIONS = [
  { n: 2, sourceId: 's2', url: 'https://www.supabase.test/pricing', title: 'Pricing', fetchedAtUtc: '2026-11-16T04:30:00.000Z', live: false, firstParty: true },
  { n: 1, sourceId: 's1', url: 'https://supabase.test/docs', title: 'Docs', fetchedAtUtc: '2026-11-16T04:30:00.000Z', live: true, firstParty: true },
];

describe('Sources', () => {
  it('is a collapsed <details> whose summary reads "Sources (n)"', () => {
    const html = renderToStaticMarkup(Sources({ citations: CITATIONS }));
    expect(html.startsWith('<details class="sources">')).toBe(true);
    expect(html).not.toContain(' open');
    expect(html).toMatch(/<summary class="sources-head"><span>Sources \(2\)<\/span>/);
  });

  it('puts the live vs search-index note and the numbered links inside the dropdown', () => {
    const html = renderToStaticMarkup(Sources({ citations: CITATIONS }));
    const body = html.slice(html.indexOf('</summary>'));
    expect(body).toContain('Search-index copy');
    expect(body.indexOf('href="https://supabase.test/docs"')).toBeLessThan(body.indexOf('href="https://www.supabase.test/pricing"'));
    expect(body).toContain('search-index copy');
  });

  it('renders nothing without citations', () => {
    expect(Sources({ citations: [] })).toBeNull();
  });
});

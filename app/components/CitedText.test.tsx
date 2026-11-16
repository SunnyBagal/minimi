import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CitedText } from './CitedText';

const CITATIONS = [
  {
    n: 1,
    sourceId: 's1',
    url: 'https://neon.test/pricing',
    title: 'Neon pricing',
    fetchedAtUtc: '2026-11-16T04:30:00.000Z',
    live: true,
    firstParty: true,
  },
];

describe('CitedText', () => {
  it('renders [n] as a link to the source with a live marker', () => {
    const html = renderToStaticMarkup(CitedText({ text: 'It costs 19 USD [1].', citations: CITATIONS, uncited: [] }));
    expect(html).toContain('href="https://neon.test/pricing"');
    expect(html).toContain('checked');
    expect(html).toContain('live');
  });

  it('marks a cached source', () => {
    const cached = [{ ...CITATIONS[0]!, live: false }];
    const html = renderToStaticMarkup(CitedText({ text: 'See [1].', citations: cached, uncited: [] }));
    expect(html).toContain('cached');
  });

  it('wraps an uncited number in a not-verified mark', () => {
    const html = renderToStaticMarkup(CitedText({ text: 'It rose to 24 USD.', citations: [], uncited: ['24'] }));
    expect(html).toContain('<mark');
    expect(html).toContain('not verified');
    expect(html).toContain('24');
  });

  it('marks whole tokens only: "24" but not "240" or "1.24"', () => {
    const html = renderToStaticMarkup(
      CitedText({ text: '24 USD and 240 USD and 1.24 stay.', citations: [], uncited: ['24'] }),
    );
    const marks = html.match(/<mark/g) ?? [];
    expect(marks).toHaveLength(1);
    expect(html).toContain('>24<');
    expect(html).toContain('240 USD');
    expect(html).toContain('1.24');
  });
});

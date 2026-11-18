import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, safeHref } from './Markdown';

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
  {
    n: 2,
    sourceId: 's2',
    url: 'https://supabase.test/pricing',
    title: null,
    fetchedAtUtc: '2026-11-16T04:31:00.000Z',
    live: false,
    firstParty: true,
  },
];

function md(text: string, uncited: string[] = [], citations = CITATIONS): string {
  return renderToStaticMarkup(Markdown({ text, citations, uncited }));
}

describe('Markdown blocks', () => {
  it('splits paragraphs on blank lines and keeps single newlines as line breaks', () => {
    const html = md('First line\nsecond line\n\nNext paragraph');
    expect(html.match(/<p class="md-p">/g)).toHaveLength(2);
    expect(html).toContain('First line<br/>second line');
    expect(html).toContain('Next paragraph');
  });

  it('renders # to ### headings', () => {
    const html = md('# One\n## Two\n### Three\n#### Four');
    expect(html).toContain('<h3 class="md-h md-h1">One</h3>');
    expect(html).toContain('<h4 class="md-h md-h2">Two</h4>');
    expect(html).toContain('<h5 class="md-h md-h3">Three</h5>');
    expect(html).toContain('#### Four');
  });

  it('renders - and * bullet lists', () => {
    const html = md('- **Backend developer**\n- Frontend\n\n* one\n* two');
    expect(html.match(/<ul class="md-list">/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('<li><strong>Backend developer</strong></li>');
    expect(html).toContain('<li>Frontend</li>');
    expect(html).toContain('<li>one</li>');
    expect(html).not.toContain('- ');
  });

  it('renders numbered lists, keeping the start number', () => {
    const html = md('1. first\n2. second');
    expect(html).toContain('<ol class="md-list"><li>first</li><li>second</li></ol>');
    expect(md('3. third\n4. fourth')).toContain('<ol class="md-list" start="3">');
  });

  it('keeps items separated by blank lines in one list', () => {
    const html = md('1. first\n\n2. second');
    expect(html.match(/<ol/g)).toHaveLength(1);
  });

  it('nests one level of list', () => {
    const html = md('- Plans\n  - Free\n  - Pro\n- Limits');
    expect(html).toContain('<li>Plans<ul class="md-list"><li>Free</li><li>Pro</li></ul></li><li>Limits</li>');
  });

  it('renders a fenced code block verbatim, without inline formatting', () => {
    const html = md('Before\n\n```ts\nconst a = **b**;\n<b>x</b>\n```\n\nAfter');
    expect(html).toContain('<pre class="md-pre" data-lang="ts"><code>const a = **b**;\n&lt;b&gt;x&lt;/b&gt;</code></pre>');
    expect(html).toContain('After');
  });

  it('streams an unclosed code fence as a code block', () => {
    const html = md('```\nline one');
    expect(html).toContain('<pre class="md-pre"><code>line one</code></pre>');
  });

  it('renders --- as a rule', () => {
    expect(md('above\n\n---\n\nbelow')).toContain('<hr class="md-rule"/>');
  });
});

describe('Markdown inline', () => {
  it('renders **bold**', () => {
    expect(md('A **bold** word')).toContain('A <strong>bold</strong> word');
  });

  it('renders *italic*', () => {
    expect(md('An *italic* word')).toContain('An <em>italic</em> word');
  });

  it('leaves a lone asterisk in arithmetic alone', () => {
    expect(md('5 * 3 * 2')).toContain('5 * 3 * 2');
  });

  it('renders `code` without formatting inside it', () => {
    expect(md('Run `npm run **dev**` now')).toContain('<code class="md-code">npm run **dev**</code>');
  });

  it('renders [text](https://…) as a new-tab link with rel noopener noreferrer', () => {
    const html = md('See [the docs](https://example.com/docs).');
    expect(html).toContain(
      '<a class="md-link" href="https://example.com/docs" target="_blank" rel="noopener noreferrer">the docs</a>',
    );
  });

  it('renders an unclosed ** mid-stream as text, then bold once it closes', () => {
    const partial = md('The price is **24 USD');
    expect(partial).toContain('The price is **24 USD');
    expect(partial).not.toContain('<strong>');
    expect(md('The price is **24 USD**')).toContain('<strong>24 USD</strong>');
  });

  it('renders half-typed code and links as text without throwing', () => {
    for (const text of ['`npm', '[the docs](https://exa', '[the do', '*ital', '- ', '1.', '#', '```']) {
      expect(() => md(text)).not.toThrow();
    }
    expect(md('[the docs](https://exa')).toContain('[the docs](https://exa');
  });

  it('renders every prefix of a long answer without throwing', () => {
    const answer = '# Plans\n\nPro costs **$25** [1]. *Free* has `500 MB` [2].\n\n- a\n  - b\n1. c\n\n```\nx\n```\n[l](https://e.test)';
    for (let end = 0; end <= answer.length; end += 1) {
      expect(() => md(answer.slice(0, end), ['$25'])).not.toThrow();
    }
  });
});

describe('Markdown safety', () => {
  it('renders <script> and raw HTML as text', () => {
    const html = md('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders a javascript: link as text, not a link', () => {
    const html = md('[click](javascript:alert(1))');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
    expect(html).toContain('[click](javascript:alert(1))');
  });

  it('accepts only http and https URLs', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/');
    expect(safeHref('http://example.com/a')).toBe('http://example.com/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<b>x</b>')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
    expect(safeHref('https://exa mple.com')).toBeNull();
  });

  it('does not let a heading or link text inject attributes', () => {
    const html = md('# "><b onclick=x>hi\n\n[" onclick="x](https://example.com)');
    expect(html).not.toContain('<b ');
    expect(html).not.toContain('onclick="x"');
  });
});

describe('Markdown citations and uncited marks', () => {
  it('links [n] citations as CitedText does', () => {
    const html = md('It costs 19 USD [1].');
    expect(html).toContain('href="https://neon.test/pricing"');
    expect(html).toContain('class="cite"');
    expect(html).toContain('live');
    expect(md('See [2].')).toContain('cached');
  });

  it('links citations inside bold text', () => {
    const html = md('**Pro costs $25 [1]**');
    expect(html).toMatch(/<strong>Pro costs \$25 <a class="cite" href="https:\/\/neon\.test\/pricing"/);
  });

  it('links citations inside list items', () => {
    const html = md('- Pro: $25 [1]\n- Team: $599 [2]');
    expect(html).toMatch(/<li>Pro: \$25 <a class="cite" href="https:\/\/neon\.test\/pricing"/);
    expect(html).toMatch(/<li>Team: \$599 <a class="cite" href="https:\/\/supabase\.test\/pricing"/);
  });

  it('leaves an unknown citation number as plain text', () => {
    const html = md('See [9].');
    expect(html).toContain('See [9].');
    expect(html).not.toContain('class="cite"');
  });

  it('marks an uncited number, including inside bold and list items', () => {
    const html = md('It rose to **24 USD**.\n\n- Team is 599 USD', ['24', '599']);
    expect(html.match(/<mark/g)).toHaveLength(2);
    expect(html).toContain('<strong><mark class="uncited" title="not verified">24<small> (not verified)</small></mark> USD</strong>');
    expect(html).toMatch(/<li>Team is <mark class="uncited" title="not verified">599<small>/);
  });

  it('uses the same sentence rule as CitedText: a citation in the sentence covers the number', () => {
    expect(md('**It costs 24 USD.** [1]', ['24'])).not.toContain('<mark');
    expect(md('It costs **24 USD**. Plans vary [1].', ['24'])).toContain('<mark');
  });

  it('marks only the uncited occurrence when the same number is also cited', () => {
    const html = md('Pro starts at **$25/month** [1].\n\nThe page says "from $25/month".', ['$25']);
    expect(html.match(/<mark/g) ?? []).toHaveLength(1);
    expect(html.indexOf('<mark')).toBeGreaterThan(html.indexOf('href='));
  });

  it('never marks a digit inside a citation', () => {
    const html = md('- Free tier [1].', ['1']);
    expect(html).not.toContain('<mark');
    expect(html).toContain('href="https://neon.test/pricing"');
  });

  it('does not nest a citation link inside a markdown link', () => {
    const html = md('[see [1]](https://example.com)');
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});

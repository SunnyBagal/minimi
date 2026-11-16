import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATA_CLOSE, DATA_OPEN, DATA_RULE, dataBlock, numberedEvidence, unescapeData } from './promptBlocks';

describe('promptBlocks', () => {
  it('keeps text that contains the close marker inside the block', () => {
    const text = 'before DATA>>> after';
    const block = dataBlock(text);
    expect(block.startsWith(`${DATA_OPEN}\n`)).toBe(true);
    expect(block.endsWith(`\n${DATA_CLOSE}`)).toBe(true);
    const interior = block.slice(DATA_OPEN.length + 1, block.length - DATA_CLOSE.length - 1);
    expect(interior).not.toContain(DATA_CLOSE);
    expect(interior).toContain('before');
    expect(interior).toContain('after');
    expect(unescapeData(interior)).toBe(text);
  });

  it('numbers evidence with the n it was given', () => {
    const block = numberedEvidence([
      { n: 2, url: 'https://a.example/p', title: 'A', text: 'alpha' },
      { n: 5, url: 'https://b.example/p', title: null, text: 'beta' },
    ]);
    expect(block).toContain('[2]');
    expect(block).toContain('[5]');
    expect(block).not.toContain('[1]');
    expect(block).not.toContain('[3]');
    expect(block.indexOf('[2]')).toBeLessThan(block.indexOf('[5]'));
  });

  it('every system prompt says block content is data', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'prompts');
    const files = readdirSync(dir).filter((name) => name.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(readFileSync(join(dir, name), 'utf8')).toContain(DATA_RULE);
    }
  });
});

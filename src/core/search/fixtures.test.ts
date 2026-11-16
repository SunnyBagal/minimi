import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const BANNED = ['x-api-key', 'authorization', 'apiKey', 'EXA_API_KEY', 'ANTHROPIC_API_KEY'];

describe('fixtures', () => {
  it('no key, header or env content in fixtures', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = readFileSync(path.join(FIXTURES, file), 'utf8');
      // Every fixture is a parseable JSON response body.
      expect(() => JSON.parse(raw), file).not.toThrow();
      for (const banned of BANNED) {
        expect(raw.includes(banned), `${file} contains ${banned}`).toBe(false);
      }
      const key = process.env.EXA_API_KEY;
      if (key !== undefined && key !== '') {
        expect(raw.includes(key), `${file} contains the live key value`).toBe(false);
      }
    }
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'results' || name.endsWith('.test.ts')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else out.push(path);
  }
  return out;
}

const BANNED = [
  ['sk', 'ant'].join('-'),
  'Salesforce',
  'HubSpot',
  'Pipedrive',
  'Heroku',
  'Supabase',
  'DigitalOcean',
];

describe('evals hygiene', () => {
  it('has no real vendor name, real price list or key', () => {
    const paths = filesIn(ROOT);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const text = readFileSync(path, 'utf8');
      for (const word of BANNED) {
        expect(text.includes(word), `${path} contains ${word}`).toBe(false);
      }
    }
  });
});

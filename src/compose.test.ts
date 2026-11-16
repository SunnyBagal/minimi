import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeps, MissingEnvError } from './compose';
import type { AgentDeps } from './core/contracts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_SOURCE = readFileSync(path.join(REPO_ROOT, 'src', 'compose.ts'), 'utf8');

const globalHolder = globalThis as typeof globalThis & { __minimiDeps?: AgentDeps };

function requiredKeys(): string[] {
  const checkEnv = readFileSync(path.join(REPO_ROOT, 'scripts', 'check-env.mjs'), 'utf8');
  const match = /REQUIRED_ENV_KEYS\s*=\s*(?:\/\*\*[^]*?\*\/\s*)?\(\[([^\]]+)\]\)/.exec(checkEnv);
  if (match === null) throw new Error('REQUIRED_ENV_KEYS not found in check-env.mjs');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

beforeEach(() => {
  delete globalHolder.__minimiDeps;
});

afterEach(() => {
  delete globalHolder.__minimiDeps;
  vi.unstubAllEnvs();
});

describe('compose.ts env contract', () => {
  it('.env.example keys equal REQUIRED_ENV_KEYS equal the process.env reads', () => {
    const exampleKeys = readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8')
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
      .filter((key): key is string => key !== undefined)
      .sort();

    const envReads = [...COMPOSE_SOURCE.matchAll(/process\.env\.([A-Z0-9_]+)/g)]
      .map((match) => match[1] ?? '')
      .sort();

    expect(exampleKeys).toEqual(requiredKeys().slice().sort());
    expect(envReads).toEqual(requiredKeys().slice().sort());
  });

  it('imports only the allowed modules', () => {
    const specifiers = [...COMPOSE_SOURCE.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    const fromCore = specifiers.filter((specifier) => specifier.startsWith('./core')).sort();
    expect(fromCore).toEqual([
      './core/config',
      './core/contracts',
      './core/llm/index',
      './core/pipeline/guards',
      './core/search/index',
      './core/store/index',
      './core/systemClock',
      './core/time/index',
    ]);
    expect(specifiers.filter((specifier) => !specifier.startsWith('./core')).sort()).toEqual([
      '../scripts/check-env.mjs',
      'node:path',
    ]);
    // contracts is a type-only import.
    expect(COMPOSE_SOURCE).toMatch(/import type \{ AgentDeps \} from '\.\/core\/contracts'/);
  });
});

describe('getDeps', () => {
  it('throws MissingEnvError when a key is missing', () => {
    for (const key of requiredKeys()) vi.stubEnv(key, '');
    expect(() => getDeps()).toThrow(MissingEnvError);
  });

  it('returns the same object twice and every AgentDeps field', () => {
    for (const key of requiredKeys()) vi.stubEnv(key, `test-${key.toLowerCase()}`);
    const first = getDeps();
    const second = getDeps();
    expect(second).toBe(first);
    for (const field of ['clock', 'store', 'search', 'llm', 'time', 'guardVerdict', 'config'] as const) {
      expect(first[field]).toBeDefined();
    }
  });
});

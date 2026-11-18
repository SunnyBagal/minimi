import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { startupProblem } from './check-env.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-env.mjs');
const KEYS = { ANTHROPIC_API_KEY: 'test-anthropic', EXA_API_KEY: 'test-exa' };

describe('startupProblem', () => {
  it('reports MissingEnvError when ANTHROPIC_API_KEY is missing', () => {
    const problem = startupProblem({ EXA_API_KEY: 'test-exa' }, '26.13.0');
    expect(problem?.name).toBe('MissingEnvError');
  });

  it('names both missing keys in one problem', () => {
    const problem = startupProblem({}, '26.13.0');
    expect(problem?.name).toBe('MissingEnvError');
    expect(problem?.message).toContain('ANTHROPIC_API_KEY');
    expect(problem?.message).toContain('EXA_API_KEY');
  });

  it('counts a blank string as missing', () => {
    const problem = startupProblem({ ANTHROPIC_API_KEY: '   ', EXA_API_KEY: 'test-exa' }, '26.13.0');
    expect(problem?.name).toBe('MissingEnvError');
    expect(problem?.message).toContain('ANTHROPIC_API_KEY');
  });

  it('reports UnsupportedNodeError for Node 22.12.0 even with keys set', () => {
    const problem = startupProblem(KEYS, '26.12.0');
    expect(problem?.name).toBe('UnsupportedNodeError');
  });

  it('reports UnsupportedNodeError for Node 20.20.2', () => {
    const problem = startupProblem(KEYS, '20.20.2');
    expect(problem?.name).toBe('UnsupportedNodeError');
  });

  it('accepts Node 26.13.0 and 26.13.1 with keys set', () => {
    expect(startupProblem(KEYS, '26.13.0')).toBeNull();
    expect(startupProblem(KEYS, '26.13.1')).toBeNull();
  });
});

describe('check-env.mjs as a script', () => {
  it('prints one MissingEnvError line and exits 1 with no keys', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NODE_ENV: 'test' },
    });
    expect(result.status).toBe(1);
    const lines = result.stderr.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^MissingEnvError: /);
  });
});

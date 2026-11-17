import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execute } from './run';

describe('selftest', () => {
  it('exits 0 and makes no network call', async () => {
    const result = await execute(['--selftest']);
    expect(result.networkCalls).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^passAtAll \d+ flaky \d+ failing \d+$/);
    const latest = JSON.parse(readFileSync(new URL('./results/latest.json', import.meta.url), 'utf8')) as {
      mode: string;
      cases: Array<{ id: number; passedRuns: number; runs: number }>;
      passAtAll: number[];
      flaky: number[];
      failing: number[];
    };
    expect(latest.mode).toBe('selftest');
    const chat = latest.cases.find((item) => item.id === 17);
    expect(chat?.passedRuns).toBe(chat?.runs);
    expect(latest.passAtAll).toContain(17);
    expect(latest.passAtAll).not.toContain(1);
    expect(latest.flaky).not.toContain(17);
  });
});

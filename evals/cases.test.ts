import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { createStore } from '../src/core/store/index';
import { FakeClock } from '../src/core/testing/fakes';
import { CASES } from './cases/index';
import type { CaseRun } from './types';

function tempDb(): string {
  return join(mkdtempSync(join(tmpdir(), 'minimi-eval-')), 'store.db');
}

function emptyRun(id: number): CaseRun {
  const evalCase = CASES.find((item) => item.id === id);
  if (evalCase === undefined) throw new Error(`missing case ${id}`);
  return {
    parts: evalCase.parts.map((part) => ({
      traces: part.messages.map((message) => ({ message, events: [], answerText: '', log: [] })),
      log: [],
    })),
    store: createStore(tempDb(), new FakeClock('2026-11-13T13:00:00.000Z'), defaultConfig),
    judge: null,
  };
}

describe('cases', () => {
  it('has one file for every case from 1 to 19', () => {
    expect(CASES.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('every case check returns named assertions', () => {
    for (const evalCase of CASES) {
      const names = evalCase.check(emptyRun(evalCase.id)).map((item) => item.name);
      expect(names.length, `case ${evalCase.id}`).toBeGreaterThan(0);
      expect(new Set(names).size, `case ${evalCase.id}`).toBe(names.length);
    }
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-imports.mjs');

const tmpRoots: string[] = [];

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

/** A minimal clean tree: every allowed case the checker must not flag. */
const CLEAN_FILES: Record<string, string> = {
  'src/core/llm/aiSdkLlm.ts': "import { generateText } from 'ai';\nexport const llm = generateText;\n",
  'src/core/systemClock.ts': 'export const now = () => new Date();\n',
  'src/core/testing/x.ts': 'export const stamp = () => Date.now();\nexport const made = () => new Date();\n',
  'src/core/clocked.ts': '// mentions Date.now() in a comment and new Date()\nexport const made = () => new Date(0);\n',
  'src/core/pipeline/guards.ts': "import { something } from '../time';\nexport const guard = something;\n",
  'src/core/pipeline/foo.test.ts': "import { something } from '../time';\nimport { guard } from './guards';\nexport const testUses = [something, guard];\n",
};

function makeTree(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'check-imports-'));
  tmpRoots.push(root);
  for (const [file, source] of Object.entries({ ...CLEAN_FILES, ...extra })) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
}

function expectViolation(root: string, fileFragment: string) {
  const result = run(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(fileFragment);
}

describe('check-imports.mjs', () => {
  it('exits 0 on a clean tree with all allowed cases', () => {
    const result = run(makeTree());
    expect(result.status).toBe(0);
  });

  it('exits 0 on the real repository', () => {
    const result = run(REPO_ROOT);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('violation');
  });

  it("fails on a planted import 'ai'", () => {
    expectViolation(makeTree({ 'src/core/search/x.ts': "import 'ai';\n" }), 'src/core/search/x.ts');
  });

  it("fails on a planted import from '@ai-sdk/anthropic'", () => {
    expectViolation(
      makeTree({ 'src/core/search/x.ts': "import { anthropic } from '@ai-sdk/anthropic';\nexport const x = anthropic;\n" }),
      'src/core/search/x.ts',
    );
  });

  it("fails on a planted import from 'next/server'", () => {
    expectViolation(
      makeTree({ 'src/core/search/x.ts': "import { NextResponse } from 'next/server';\nexport const x = NextResponse;\n" }),
      'src/core/search/x.ts',
    );
  });

  it('fails on a planted Date.now()', () => {
    expectViolation(makeTree({ 'src/core/util.ts': 'export const stamp = () => Date.now();\n' }), 'src/core/util.ts');
  });

  it('fails on a planted new Date() with no argument', () => {
    expectViolation(makeTree({ 'src/core/util.ts': 'export const made = () => new Date();\n' }), 'src/core/util.ts');
  });

  it('fails on a pipeline file importing ../time', () => {
    expectViolation(
      makeTree({ 'src/core/pipeline/stage.ts': "import { something } from '../time';\nexport const x = something;\n" }),
      'src/core/pipeline/stage.ts',
    );
  });

  it('fails on a pipeline file importing ../time/index', () => {
    expectViolation(
      makeTree({ 'src/core/pipeline/stage.ts': "import { something } from '../time/index';\nexport const x = something;\n" }),
      'src/core/pipeline/stage.ts',
    );
  });

  it('fails on a pipeline file importing ./guards', () => {
    expectViolation(
      makeTree({ 'src/core/pipeline/stage.ts': "import { guard } from './guards';\nexport const x = guard;\n" }),
      'src/core/pipeline/stage.ts',
    );
  });
});

// Import-rule check, part of `npm run gate`.
//
//   node scripts/check-imports.mjs [root]
//
// Looks at every .ts, .tsx, .mts and .mjs file under <root>/src/core and fails
// (exit code 1) when:
//
//   1. a file imports `next`, `react`, `ai`, `@ai-sdk/*` or `@anthropic-ai/*`
//      (subpaths such as `next/server` count). Exception: llm/aiSdkLlm.ts.
//   2. a file calls `Date.now(` or `new Date()` with no argument.
//      Exceptions: systemClock.ts, anything under testing/, and *.test.ts(x).
//   3. a file under pipeline/ imports from src/core/time or from ./guards.
//      Exceptions: guards.ts itself, and *.test.ts(x), because Lane 1's
//      guards.test.ts must import ./guards and Lane 5 runs one pipeline test
//      per intent against the real time functions.
//
// Comments are ignored. Text inside string literals is ignored for rule 2.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_FILE = /\.(ts|tsx|mts|mjs)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;
const BANNED_PACKAGE = /^(next|react|ai)(\/|$)|^@ai-sdk\/|^@anthropic-ai\//;

/**
 * Replaces comments with spaces. With `blankStrings`, also empties string and
 * template literals. Newlines are kept, so line numbers still match.
 *
 * @param {string} source
 * @param {boolean} blankStrings
 * @returns {string}
 */
export function stripSource(source, blankStrings) {
  let out = '';
  let i = 0;
  const blank = (/** @type {string} */ text) => text.replace(/[^\n]/g, ' ');
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      out += blank(source.slice(i, end));
      i = end;
    } else if (char === '/' && next === '*') {
      let end = source.indexOf('*/', i + 2);
      end = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, end));
      i = end;
    } else if (char === "'" || char === '"' || char === '`') {
      let end = i + 1;
      while (end < source.length && source[end] !== char) {
        // A quote left open ends at the line break: plain strings cannot span lines.
        if (source[end] === '\n' && char !== '`') break;
        end += source[end] === '\\' ? 2 : 1;
      }
      end = Math.min(end, source.length);
      const body = source.slice(i + 1, end);
      const closed = source[end] === char;
      out += char + (blankStrings ? blank(body) : body) + (closed ? char : '');
      i = closed ? end + 1 : end;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/**
 * Every module specifier the source imports, with its line number.
 *
 * @param {string} code source with comments already stripped
 * @returns {{ specifier: string; line: number }[]}
 */
export function findImports(code) {
  const patterns = [
    // import x from 'y'; import type { x } from 'y'; export { x } from 'y'; export * from 'y'
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/g,
    // import 'y'
    /\bimport\s*(['"])([^'"\n]+)\1/g,
    // import('y') and require('y')
    /\b(?:import|require)\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  ];
  const found = [];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split('\n').length;
      found.push({ specifier: match[2], line });
    }
  }
  return found;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listSourceFiles(dir) {
  /** @type {string[]} */
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listSourceFiles(full));
    else if (SOURCE_FILE.test(entry)) files.push(full);
  }
  return files.sort();
}

/**
 * @param {string} root the repository root
 * @returns {string[]} one line per violation; empty when the rules hold
 */
export function checkImports(root) {
  const coreDir = path.join(root, 'src', 'core');
  const timeDir = path.join(coreDir, 'time');
  const pipelineDir = path.join(coreDir, 'pipeline');
  const guardsFile = path.join(pipelineDir, 'guards');
  const sdkFile = path.join(coreDir, 'llm', 'aiSdkLlm.ts');
  const clockFile = path.join(coreDir, 'systemClock.ts');
  const testingDir = path.join(coreDir, 'testing') + path.sep;

  /** @type {string[]} */
  const violations = [];
  for (const file of listSourceFiles(coreDir)) {
    const shown = path.relative(root, file).split(path.sep).join('/');
    const source = readFileSync(file, 'utf8');
    const isTest = TEST_FILE.test(file);
    const imports = findImports(stripSource(source, false));

    if (file !== sdkFile) {
      for (const { specifier, line } of imports) {
        if (BANNED_PACKAGE.test(specifier)) {
          violations.push(`${shown}:${line} imports "${specifier}". Only src/core/llm/aiSdkLlm.ts may import the SDK; nothing in src/core imports next or react.`);
        }
      }
    }

    if (file !== clockFile && !file.startsWith(testingDir) && !isTest) {
      const lines = stripSource(source, true).split('\n');
      lines.forEach((text, index) => {
        if (/\bDate\s*\.\s*now\s*\(/.test(text)) {
          violations.push(`${shown}:${index + 1} calls Date.now(). Take a Clock instead.`);
        }
        if (/\bnew\s+Date\s*\(\s*\)/.test(text) || /\bnew\s+Date\b(?!\s*[(.\w$])/.test(text)) {
          violations.push(`${shown}:${index + 1} calls new Date() with no argument. Take a Clock instead.`);
        }
      });
    }

    const isGuards = file === `${guardsFile}.ts`;
    if (file.startsWith(pipelineDir + path.sep) && !isGuards && !isTest) {
      for (const { specifier, line } of imports) {
        if (!specifier.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), specifier).replace(/\.(ts|tsx|js|mjs)$/, '');
        if (target === timeDir || target.startsWith(timeDir + path.sep)) {
          violations.push(`${shown}:${line} imports "${specifier}". The pipeline reaches time functions only through AgentDeps.`);
        }
        if (target === guardsFile) {
          violations.push(`${shown}:${line} imports "${specifier}". The pipeline reaches guardVerdict only through AgentDeps.`);
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const violations = checkImports(root);
  if (violations.length > 0) {
    console.error(`check-imports: ${violations.length} violation(s)`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
  }
  console.log('check-imports: ok');
}

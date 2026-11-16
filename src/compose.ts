/**
 * The one place that wires real modules into AgentDeps.
 *
 * It imports the fixed entry modules only. Lanes replace what those modules
 * contain; this file does not change.
 */
import path from 'node:path';
import { startupProblem } from '../scripts/check-env.mjs';
import { defaultConfig } from './core/config';
import type { AgentDeps } from './core/contracts';
import { createLlm } from './core/llm/index';
import { guardVerdict } from './core/pipeline/guards';
import { createSearch } from './core/search/index';
import { createStore } from './core/store/index';
import { systemClock } from './core/systemClock';
import { time } from './core/time/index';

export class MissingEnvError extends Error {
  override readonly name = 'MissingEnvError';
}

export class UnsupportedNodeError extends Error {
  override readonly name = 'UnsupportedNodeError';
}

/** Where the SQLite file lives, relative to the directory the app is started from. */
const DB_PATH = path.join('data', 'minimi.db');

function buildDeps(): AgentDeps {
  // The only environment variables the app reads. `.env.example` lists exactly these.
  const env = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    EXA_API_KEY: process.env.EXA_API_KEY,
  };
  const problem = startupProblem(env, process.versions.node);
  if (problem !== null) {
    throw problem.name === 'UnsupportedNodeError'
      ? new UnsupportedNodeError(problem.message)
      : new MissingEnvError(problem.message);
  }

  const config = defaultConfig;
  const clock = systemClock;
  return {
    clock,
    store: createStore(path.resolve(DB_PATH), clock, config),
    search: createSearch(env.EXA_API_KEY ?? '', clock, config),
    llm: createLlm(env.ANTHROPIC_API_KEY ?? '', config),
    time,
    guardVerdict,
    config,
  };
}

const globalHolder = globalThis as typeof globalThis & { __minimiDeps?: AgentDeps };

/**
 * The deps, built once per process. They are kept on globalThis so a hot
 * reload in development does not open a second database.
 * Throws MissingEnvError or UnsupportedNodeError when the app cannot start.
 */
export function getDeps(): AgentDeps {
  globalHolder.__minimiDeps ??= buildDeps();
  return globalHolder.__minimiDeps;
}

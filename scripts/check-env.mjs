// Startup checks, shared by next.config.mjs (server start) and src/compose.ts
// (first use of the deps). Plain JavaScript with no imports that an old Node
// could not load, because one of its jobs is to reject an old Node.
import { pathToFileURL } from 'node:url';

/** The environment variables the app reads. `.env.example` lists exactly these. */
export const REQUIRED_ENV_KEYS = /** @type {const} */ (['ANTHROPIC_API_KEY', 'EXA_API_KEY']);

/** Lowest supported Node version, as [major, minor]. Matches "engines" in package.json. */
export const MIN_NODE = /** @type {const} */ ([26, 13]);

/**
 * @param {string} nodeVersion for example "26.13.1"
 * @returns {boolean}
 */
export function isNodeSupported(nodeVersion) {
  const [major = 0, minor = 0] = nodeVersion.split('.').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(major) || Number.isNaN(minor)) return false;
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/**
 * The first thing that stops the app from starting, or null when it can start.
 * One problem at most, so startup prints one error.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} nodeVersion
 * @returns {{ name: 'UnsupportedNodeError' | 'MissingEnvError'; message: string } | null}
 */
export function startupProblem(env, nodeVersion) {
  if (!isNodeSupported(nodeVersion)) {
    return {
      name: 'UnsupportedNodeError',
      message: `Node ${nodeVersion} is too old. This app needs Node ${MIN_NODE[0]}.${MIN_NODE[1]} or later.`,
    };
  }
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key] || env[key].trim() === '');
  if (missing.length > 0) {
    return {
      name: 'MissingEnvError',
      message: `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set. Copy .env.example to .env and fill it in.`,
    };
  }
  return null;
}

/**
 * Prints the problem as one line and exits with code 1. Does nothing when the app can start.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} nodeVersion
 */
export function exitOnStartupProblem(env, nodeVersion) {
  const problem = startupProblem(env, nodeVersion);
  if (problem === null) return;
  console.error(`${problem.name}: ${problem.message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exitOnStartupProblem(process.env, process.versions.node);
  console.log('Startup checks passed.');
}

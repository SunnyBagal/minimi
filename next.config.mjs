import { exitOnStartupProblem, startupProblem } from './scripts/check-env.mjs';

const SERVER_PHASES = ['phase-development-server', 'phase-production-server'];

/**
 * A function config, so the checks run when a server starts. Next has already
 * loaded .env by the time it calls this. A build needs a supported Node but no
 * keys, so it checks the Node version only.
 *
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
export default function nextConfig(phase) {
  if (SERVER_PHASES.includes(phase)) {
    exitOnStartupProblem(process.env, process.versions.node);
  } else if (startupProblem({}, process.versions.node)?.name === 'UnsupportedNodeError') {
    exitOnStartupProblem({}, process.versions.node);
  }
  return {
    // Next would otherwise write an AGENTS.md into the repository on `next dev`.
    agentRules: false,
  };
}

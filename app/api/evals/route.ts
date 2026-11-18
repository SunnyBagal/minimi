/**
 * GET /api/evals?set=main|heldout|heldout-first: a summary of one scripted eval run
 * (evals/results/latest.json, heldout.json or heldout-first.json; main by default).
 * Counts and case ids only; an unknown set is 400. See summary.ts.
 */
import path from 'node:path';
import { evalsRequest, type EvalSet } from './summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Literal paths, one per set, so the build traces these three files and nothing else.
const FILES: Record<EvalSet, string> = {
  main: path.join(process.cwd(), 'evals', 'results', 'latest.json'),
  heldout: path.join(process.cwd(), 'evals', 'results', 'heldout.json'),
  'heldout-first': path.join(process.cwd(), 'evals', 'results', 'heldout-first.json'),
};

export async function GET(request: Request): Promise<Response> {
  return evalsRequest(request.url, (set) => FILES[set]);
}

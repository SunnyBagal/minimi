/**
 * GET /api/evals: a summary of the last scripted eval run (evals/results/latest.json).
 * Counts and case ids only; see summary.ts.
 */
import path from 'node:path';
import { evalsResponse } from './summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return evalsResponse(path.join(process.cwd(), 'evals', 'results', 'latest.json'));
}

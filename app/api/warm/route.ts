/**
 * GET /api/warm. The page calls this on mount so the first real message does
 * not pay for compiling the chat route's dependencies or building the deps.
 */
import { getDeps } from '../../../src/compose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  getDeps();
  return new Response(null, { status: 204 });
}

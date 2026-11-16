/**
 * POST /api/chat. The only file that maps AgentEvent onto the UI message stream.
 *
 *   status                    -> transient data part (never in message history)
 *   recall, citations, flags,
 *   timing, error             -> data parts
 *   verdict                   -> data part whose id is the claim id
 *   text                      -> text deltas
 *   done                      -> ends the message; turnId and intent are its metadata
 *
 * Everything else about a turn lives in runTurn.
 */
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { z } from 'zod';
import { getDeps } from '../../../src/compose';
import type { AgentEvent, IanaTz } from '../../../src/core/contracts';
import { runTurn } from '../../../src/core/pipeline/runTurn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventData<T extends AgentEvent['type']> = Omit<Extract<AgentEvent, { type: T }>, 'type'>;

/** One data part type per AgentEvent that is not text and not `done`. */
export type ChatDataParts = {
  [T in Exclude<AgentEvent['type'], 'text' | 'done'>]: EventData<T>;
};
/** From the `done` event. */
export type ChatMetadata = EventData<'done'>;
export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataParts>;

const bodySchema = z.object({
  message: z.string().trim().min(1),
  sessionId: z.string().min(1),
  tz: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: 'Expected { message, sessionId, tz }.' }, { status: 400 });
  }
  const deps = getDeps();

  // An unknown zone makes the time functions throw; the turn then runs in UTC.
  let tz: IanaTz = body.data.tz ?? 'UTC';
  try {
    deps.time.toLocalDate(deps.clock.now(), tz);
  } catch {
    tz = 'UTC';
  }

  const stream = createUIMessageStream<ChatUIMessage>({
    onError: (error) => (error instanceof Error ? `${error.name}: ${error.message}` : 'The turn failed.'),
    execute: async ({ writer }) => {
      let textPart = 0;
      let textOpen = false;
      const closeText = () => {
        if (textOpen) writer.write({ type: 'text-end', id: `text-${textPart}` });
        textOpen = false;
      };

      writer.write({ type: 'start' });
      const turn = { sessionId: body.data.sessionId, message: body.data.message, tz, signal: request.signal };
      for await (const event of runTurn(turn, deps)) {
        switch (event.type) {
          case 'status':
            writer.write({ type: 'data-status', data: { text: event.text }, transient: true });
            break;
          case 'text':
            if (!textOpen) {
              textPart += 1;
              textOpen = true;
              writer.write({ type: 'text-start', id: `text-${textPart}` });
            }
            writer.write({ type: 'text-delta', id: `text-${textPart}`, delta: event.delta });
            break;
          case 'recall':
            closeText();
            writer.write({
              type: 'data-recall',
              data: { candidates: event.candidates, hits: event.hits, chosen: event.chosen },
            });
            break;
          case 'verdict':
            closeText();
            writer.write({ type: 'data-verdict', id: event.row.claim.id, data: { row: event.row } });
            break;
          case 'citations':
            closeText();
            writer.write({ type: 'data-citations', data: { items: event.items } });
            break;
          case 'flags':
            closeText();
            writer.write({
              type: 'data-flags',
              data: { strippedCitations: event.strippedCitations, uncitedNumbers: event.uncitedNumbers },
            });
            break;
          case 'timing':
            closeText();
            writer.write({ type: 'data-timing', data: { stage: event.stage, ms: event.ms } });
            break;
          case 'error':
            closeText();
            writer.write({ type: 'data-error', data: { stage: event.stage, message: event.message } });
            break;
          case 'done':
            closeText();
            writer.write({ type: 'finish', messageMetadata: { turnId: event.turnId, intent: event.intent } });
            break;
        }
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}

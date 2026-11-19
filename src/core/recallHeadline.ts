/**
 * The "On <date> you asked: ..." line for a recalled question. The pipeline
 * sends the question as a structured field on the recall event; the UI's
 * recall card renders it with this function, and the eval harness uses the
 * same function so it checks what the user sees.
 */
import type { IanaTz, IsoUtc, RecalledQuestion } from './contracts';

/** Rule on the recall event for questions matched across sessions. */
export const REPEAT_QUESTION_RULE = 'repeated question from another session';

export function recallHeadline(
  asked: RecalledQuestion,
  formatLocal: (utc: IsoUtc, tz: IanaTz) => string,
  viewerTz: IanaTz,
): string {
  const when = formatLocal(asked.createdAtUtc, asked.tz);
  const zoneNote = asked.tz !== viewerTz ? ` (${asked.tz})` : '';
  const seeded = asked.origin === 'seed' ? ' (seeded demo history)' : '';
  return `On ${when}${zoneNote} you asked: "${asked.question}".${seeded}`;
}

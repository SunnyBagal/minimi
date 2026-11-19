import type { MemoryHit, Turn } from '../contracts';
import type { TurnContext } from './context';

const MIN_REPEAT_OVERLAP = 0.8;
const FILLER = /\b(?:from earlier|right now|at the moment|could you|can you|would you|please)\b/gu;
const STOP_WORDS = new Set(['a', 'an', 'the', 'do', 'does', 'did', 'is', 'are', 'it', 'to', 'will', 'would']);

function questionWords(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase()
    .replace(/n['’]t\b/gu, ' not')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(FILLER, ' ');
  return (normalized.match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !STOP_WORDS.has(word));
}

/** Keep a change of quantity or polarity from passing on word overlap alone. */
function qualifiers(words: readonly string[]): string {
  return words.filter((word) => /\p{N}|^(?:not|never|without)$/u.test(word)).join(' ');
}

type AnsweredHit = MemoryHit & { assistantTurn: Turn };

/** Dated lookups and references to the last answer keep their explicit target. */
export function findRepeatedQuestion(ctx: TurnContext): AnsweredHit | null {
  if (ctx.plan.timeRef.kind !== 'none' || ctx.plan.refersToPrevious) return null;

  const words = questionWords(ctx.input.message);
  const current = new Set(words);
  if (current.size < 2) return null;
  const currentQualifiers = qualifiers(words);
  const hits = ctx.store.findTurns({
    topic: [...current].join(' '),
    excludeTurnIds: [ctx.currentId],
    // The store ranks by overlap, so a score cutoff could hide the newest near-duplicate.
    limit: Number.MAX_SAFE_INTEGER,
  });

  let newest: AnsweredHit | null = null;
  for (const hit of hits) {
    const { userTurn, assistantTurn } = hit;
    if (userTurn.sessionId === ctx.input.sessionId || assistantTurn === null || assistantTurn.content.trim() === '') continue;
    if (newest !== null && userTurn.createdAtUtc <= newest.userTurn.createdAtUtc) continue;
    // A previous memory-only reply is a copy of an answer and cannot back another repeat.
    if (assistantTurn.intent === 'recall' && assistantTurn.targetTurnIds.length === 0) continue;
    const previousWords = questionWords(userTurn.content);
    if (qualifiers(previousWords) !== currentQualifiers) continue;
    const previous = new Set(previousWords);
    const shared = [...previous].filter((word) => current.has(word)).length;
    if (shared / (current.size + previous.size - shared) >= MIN_REPEAT_OVERLAP) {
      newest = { ...hit, assistantTurn };
    }
  }
  return newest;
}

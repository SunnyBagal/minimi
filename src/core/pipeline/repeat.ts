import type { MemoryHit, MemoryStore, Turn } from '../contracts';
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

export interface RepeatedQuestion {
  hit: AnsweredHit;
  followUps: Turn[];
}

const FOLLOW_UP_REQUESTS = [
  /^search(?: the web| online)?(?: for)? (?:this|that|it|(?:this|that|your) answer)(?: online| again)?$/u,
  /^(?:look (?:this|that|it) up|google (?:this|that|it)|(?:check|verify|double check) (?:this|that|it|your answer))(?: online| again)?$/u,
  /^is (?:this|that|it|your answer) (?:still )?(?:right|correct|true|accurate)$/u,
  /^has (?:this|that|it) changed$/u,
];

/** Legacy follow-ups may have no stored target, even when the router recognised one. */
function isFollowUp(text: string): boolean {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .replace(/^(?:please |(?:can|could|would) you )+| please$/gu, '');
  return FOLLOW_UP_REQUESTS.some((request) => request.test(words));
}

/** Walk in store order. Explicit links can reconnect the chain after a new topic. */
function laterAnswers(store: MemoryStore, original: Turn): Turn[] | null {
  const thread = store.recentTurns(original.sessionId, Number.MAX_SAFE_INTEGER);
  const anchor = thread.findIndex((turn) => turn.id === original.id);
  if (anchor === -1) return null;

  const followUps: Turn[] = [];
  const related = new Set([original.id]);
  let adjacent = true;
  let prompt: Turn | null = null;
  for (const turn of thread.slice(anchor + 1)) {
    if (turn.role === 'user') {
      if (prompt !== null) adjacent = false;
      prompt = turn;
      continue;
    }
    const linksBack = turn.targetTurnIds.some((id) => related.has(id));
    const refersBack: boolean = adjacent && turn.targetTurnIds.length === 0 && prompt !== null && isFollowUp(prompt.content);
    adjacent = turn.content.trim() !== '' && (linksBack || refersBack);
    prompt = null;
    if (adjacent) {
      followUps.push(turn);
      related.add(turn.id);
    }
  }
  return followUps;
}

/** Dated lookups and references to the last answer keep their explicit target. */
export function findRepeatedQuestion(ctx: TurnContext): RepeatedQuestion | null {
  if (ctx.plan.timeRef.kind !== 'none' || ctx.plan.refersToPrevious || isFollowUp(ctx.input.message)) return null;

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
  if (newest === null) return null;
  const followUps = laterAnswers(ctx.store, newest.assistantTurn);
  return followUps === null ? null : { hit: newest, followUps };
}

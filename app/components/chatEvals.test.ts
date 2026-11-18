import { describe, expect, it } from 'vitest';
import type { Intent, Provenance, Verdict, VerdictRow } from '../../src/core/contracts';
import type { ChatUIMessage } from '../api/chat/route';
import { chatEvals, chatSubtitle, citesInline, coverageCaption, duration, percent } from './chatEvals';

type Part = ChatUIMessage['parts'][number];
let nextId = 0;

function user(text: string): ChatUIMessage {
  nextId += 1;
  return { id: `u${nextId}`, role: 'user', parts: [{ type: 'text', text }] };
}

/** An assistant message; with an intent it is a finished turn (the metadata arrives with `done`). */
function answer(parts: Part[], intent?: Intent): ChatUIMessage {
  nextId += 1;
  return {
    id: `a${nextId}`,
    role: 'assistant',
    parts,
    ...(intent === undefined ? {} : { metadata: { turnId: `t${nextId}`, intent } }),
  };
}

const text = (value: string): Part => ({ type: 'text', text: value });
const citations = (items: { live: boolean; firstParty: boolean }[]): Part => ({
  type: 'data-citations',
  data: {
    items: items.map((item, index) => ({
      n: index + 1,
      sourceId: `s${index}`,
      url: `https://example.test/${index}`,
      title: null,
      fetchedAtUtc: '2026-11-18T10:00:00.000Z',
      ...item,
    })),
  },
});
const one = citations([{ live: true, firstParty: true }]);
const flags = (uncitedNumbers: string[]): Part => ({
  type: 'data-flags',
  data: { strippedCitations: [], uncitedNumbers },
});
const timing = (stage: string, ms: number): Part => ({ type: 'data-timing', data: { stage, ms } });
const error = (): Part => ({ type: 'data-error', data: { stage: 'write', message: 'Timed out.' } });
const verdict = (value: Verdict, provenance: Provenance): Part => ({
  type: 'data-verdict',
  data: { row: { check: { verdict: value }, provenance } as unknown as VerdictRow },
});

describe('chatEvals', () => {
  it('an empty chat has no answers and every share is null, not 0', () => {
    const evals = chatEvals([]);
    expect(evals.answers).toBe(0);
    expect(evals.intents).toBeNull();
    expect(evals.coverage).toEqual({
      validated: 0,
      pending: 0,
      citing: 0,
      citingClean: 0,
      share: null,
      uncitedNumbers: 0,
    });
    expect(evals.sources).toEqual({ supplied: 0, live: 0, firstParty: 0, liveShare: null, firstPartyShare: null });
    expect(evals.verdicts.rows).toBe(0);
    expect(evals.verdicts.verifiedShare).toBeNull();
    expect(evals.latency).toEqual({ stages: [], perAnswer: [], avgAnswerMs: null, inProgress: 0 });
    expect(evals.errors).toBe(0);
  });

  it('counts answers once they have answer text, and splits them by intent', () => {
    const evals = chatEvals([
      user('a'),
      answer([text('x')], 'fresh'),
      user('b'),
      answer([text('y')], 'fresh'),
      user('c'),
      answer([text('z')], 'recheck'),
      answer([], 'chat'), // nothing on screen: not an answer
      answer([text('   ')], 'chat'), // whitespace only: not an answer
      answer([text('streaming')]),
    ]);
    expect(evals.answers).toBe(4);
    expect(evals.intents).toEqual({ fresh: 2, recheck: 1, recall: 0, chat: 0 });
    expect(evals.answersWithoutIntent).toBe(1);
  });

  it('a turn that has only sent its first timings is not an answer and has no total yet', () => {
    const evals = chatEvals([answer([timing('route', 20)])]);
    expect(evals.answers).toBe(0);
    expect(evals.latency.perAnswer).toEqual([]);
    expect(evals.latency.avgAnswerMs).toBeNull();
    expect(evals.latency.inProgress).toBe(1);
    // The stage observation still counts.
    expect(evals.latency.stages).toEqual([{ stage: 'route', avgMs: 20, count: 1 }]);
  });

  it('a failed turn with no answer text stays out of the answers and the totals, but its error counts', () => {
    const evals = chatEvals([answer([timing('persist', 3), timing('route', 50), error()], 'fresh')]);
    expect(evals.answers).toBe(0);
    expect(evals.latency.perAnswer).toEqual([]);
    expect(evals.latency.inProgress).toBe(0);
    expect(evals.errors).toBe(1);
  });

  it('omits the intent split when no answer carries an intent', () => {
    expect(chatEvals([answer([text('x')])]).intents).toBeNull();
  });

  it('coverage is pending, not 100%, while the sources have arrived and the validator result has not', () => {
    const evals = chatEvals([answer([text('Pro costs $25 [1].'), one])]);
    expect(evals.coverage).toMatchObject({ validated: 0, pending: 1, citing: 0, share: null });
    expect(coverageCaption(evals)).toBe('Validation pending for 1 answer.');
  });

  it('coverage counts only answers that cite a supplied source inline, once validated', () => {
    const evals = chatEvals([
      answer([text('Pro costs $25 [1].'), one, flags([])], 'fresh'),
      answer([text('It has 8 GB [1] and costs 25.'), one, flags(['25'])], 'fresh'),
      // Sources were supplied but the answer cites none: not a citing answer.
      answer([text('The sources do not say.'), one, flags([])], 'fresh'),
      // [3] is not a supplied source.
      answer([text('See [3].'), one, flags([])], 'fresh'),
    ]);
    expect(evals.coverage).toEqual({
      validated: 4,
      pending: 0,
      citing: 2,
      citingClean: 1,
      share: 0.5,
      uncitedNumbers: 1,
    });
    expect(coverageCaption(evals)).toBe(
      '1 of 2 answers citing sources had no uncited numbers flagged · 1 uncited number flagged',
    );
  });

  it('coverage with validated answers but no inline citation is null with a reason', () => {
    const evals = chatEvals([answer([text('The sources do not say.'), one, flags([])], 'fresh')]);
    expect(evals.coverage.share).toBeNull();
    expect(coverageCaption(evals)).toBe('No validated answer cites a source inline yet.');
    expect(coverageCaption(chatEvals([]))).toBe('No answer in this chat has been checked for citations yet.');
  });

  it('the coverage caption mentions answers still awaiting validation', () => {
    const evals = chatEvals([answer([text('A [1].'), one, flags([])], 'fresh'), answer([text('B [1].'), one])]);
    expect(evals.coverage.share).toBe(1);
    expect(coverageCaption(evals)).toBe(
      '1 of 1 answer citing sources had no uncited numbers flagged · 0 uncited numbers flagged · 1 answer awaiting validation',
    );
  });

  it('citesInline reads [n] markers against the supplied numbers', () => {
    expect(citesInline('A [2] b', new Set([1, 2]))).toBe(true);
    expect(citesInline('A [5] b', new Set([1, 2]))).toBe(false);
    expect(citesInline('no markers', new Set([1]))).toBe(false);
  });

  it('sources: supplied, live share and first-party share over every supplied source', () => {
    const evals = chatEvals([
      answer([
        citations([
          { live: true, firstParty: true },
          { live: false, firstParty: true },
        ]),
      ]),
      answer([
        citations([
          { live: false, firstParty: false },
          { live: false, firstParty: true },
        ]),
      ]),
    ]);
    expect(evals.sources).toEqual({ supplied: 4, live: 1, firstParty: 3, liveShare: 0.25, firstPartyShare: 0.75 });
  });

  it('verdicts: counts per verdict across all rows and the verified-now share', () => {
    const evals = chatEvals([
      answer(
        [
          verdict('unchanged', 'verified_now'),
          verdict('unchanged', 'verified_now'),
          verdict('changed', 'verified_now'),
        ],
        'recheck',
      ),
      answer([verdict('unverifiable', 'could_not_verify'), verdict('source_unavailable', 'from_memory')], 'recheck'),
    ]);
    expect(evals.verdicts.rows).toBe(5);
    expect(evals.verdicts.counts).toEqual({ unchanged: 2, changed: 1, unverifiable: 1, source_unavailable: 1 });
    expect(evals.verdicts.verifiedNow).toBe(3);
    expect(evals.verdicts.verifiedShare).toBe(0.6);
  });

  it('latency: average per stage over every timing, totals for finished answers only', () => {
    const evals = chatEvals([
      answer([timing('route', 100), timing('persist', 4), text('a'), timing('write', 3000)], 'fresh'),
      answer([text('no timings')], 'chat'),
      answer(
        [timing('persist', 6), timing('route', 300), text('b'), timing('custom', 50), timing('search', 1000)],
        'fresh',
      ),
      answer([timing('persist', 2), text('still streaming')]), // not finished: no total yet
    ]);
    expect(evals.latency.stages).toEqual([
      { stage: 'persist', avgMs: 4, count: 3 },
      { stage: 'route', avgMs: 200, count: 2 },
      { stage: 'search', avgMs: 1000, count: 1 },
      { stage: 'write', avgMs: 3000, count: 1 },
      { stage: 'custom', avgMs: 50, count: 1 },
    ]);
    expect(evals.latency.perAnswer).toEqual([3104, 1356]);
    expect(evals.latency.avgAnswerMs).toBe(2230);
    expect(evals.latency.inProgress).toBe(1);
  });

  it('errors: counts error parts', () => {
    expect(chatEvals([answer([error()]), answer([text('ok'), error()])]).errors).toBe(2);
  });

  it('ignores user messages entirely', () => {
    const fake = { ...user('x'), parts: [citations([{ live: true, firstParty: true }])] } as ChatUIMessage;
    expect(chatEvals([fake]).sources.supplied).toBe(0);
  });
});

describe('chatSubtitle and formatting', () => {
  it('reads "4 answers · 1 re-check"', () => {
    const messages = [
      answer([text('a')], 'fresh'),
      answer([text('b')], 'fresh'),
      answer([text('c')], 'fresh'),
      answer([text('d')], 'recheck'),
    ];
    expect(chatSubtitle(chatEvals(messages))).toBe('4 answers · 1 re-check');
    expect(chatSubtitle(chatEvals([answer([text('a')], 'recall')]))).toBe('1 answer · 1 recall');
    expect(chatSubtitle(chatEvals([]))).toBe('No answers yet');
  });

  it('formats shares and durations, with "—" for no data', () => {
    expect(percent(2 / 3)).toBe('67%');
    expect(percent(0)).toBe('0%');
    expect(percent(null)).toBe('—');
    expect(duration(640.4)).toBe('640 ms');
    expect(duration(2440)).toBe('2.4 s');
    expect(duration(null)).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import type { Intent, Provenance, Verdict, VerdictRow } from '../../src/core/contracts';
import type { ChatUIMessage } from '../api/chat/route';
import { chatEvals, chatSubtitle, duration, percent } from './chatEvals';

type Part = ChatUIMessage['parts'][number];
let nextId = 0;

function user(text: string): ChatUIMessage {
  nextId += 1;
  return { id: `u${nextId}`, role: 'user', parts: [{ type: 'text', text }] };
}

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
const flags = (uncitedNumbers: string[]): Part => ({ type: 'data-flags', data: { strippedCitations: [], uncitedNumbers } });
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
    expect(evals.coverage).toEqual({ citedAnswers: 0, fullyCited: 0, share: null, uncitedNumbers: 0 });
    expect(evals.sources).toEqual({ total: 0, live: 0, firstParty: 0, liveShare: null, firstPartyShare: null });
    expect(evals.verdicts.rows).toBe(0);
    expect(evals.verdicts.verifiedShare).toBeNull();
    expect(evals.latency).toEqual({ stages: [], perAnswer: [], avgAnswerMs: null });
    expect(evals.errors).toBe(0);
  });

  it('counts answers (assistant messages with content) and splits them by intent', () => {
    const evals = chatEvals([
      user('a'),
      answer([text('x')], 'fresh'),
      user('b'),
      answer([text('y')], 'fresh'),
      user('c'),
      answer([text('z')], 'recheck'),
      answer([], 'chat'), // no content yet: not an answer
      answer([text('streaming')]),
    ]);
    expect(evals.answers).toBe(4);
    expect(evals.intents).toEqual({ fresh: 2, recheck: 1, recall: 0, chat: 0 });
    expect(evals.answersWithoutIntent).toBe(1);
  });

  it('omits the intent split when no answer carries an intent', () => {
    expect(chatEvals([answer([text('x')])]).intents).toBeNull();
  });

  it('citation coverage: of the answers that cited sources, the share with no uncited number', () => {
    const evals = chatEvals([
      answer([text('a'), citations([{ live: true, firstParty: true }])]),
      answer([text('b'), citations([{ live: false, firstParty: false }]), flags(['$25', '8 GB'])]),
      answer([text('c'), citations([{ live: false, firstParty: true }]), flags([])]),
      answer([text('d'), flags(['3'])]), // no citations: not in the share, but its flag counts
    ]);
    expect(evals.coverage).toEqual({ citedAnswers: 3, fullyCited: 2, share: 2 / 3, uncitedNumbers: 3 });
  });

  it('sources: totals, live share and first-party share over every citation entry', () => {
    const evals = chatEvals([
      answer([citations([{ live: true, firstParty: true }, { live: false, firstParty: true }])]),
      answer([citations([{ live: false, firstParty: false }, { live: false, firstParty: true }])]),
    ]);
    expect(evals.sources).toEqual({ total: 4, live: 1, firstParty: 3, liveShare: 0.25, firstPartyShare: 0.75 });
  });

  it('verdicts: counts per verdict across all rows and the verified-now share', () => {
    const evals = chatEvals([
      answer([verdict('unchanged', 'verified_now'), verdict('unchanged', 'verified_now'), verdict('changed', 'verified_now')], 'recheck'),
      answer([verdict('unverifiable', 'could_not_verify'), verdict('source_unavailable', 'from_memory')], 'recheck'),
    ]);
    expect(evals.verdicts.rows).toBe(5);
    expect(evals.verdicts.counts).toEqual({ unchanged: 2, changed: 1, unverifiable: 1, source_unavailable: 1 });
    expect(evals.verdicts.verifiedNow).toBe(3);
    expect(evals.verdicts.verifiedShare).toBe(0.6);
  });

  it('latency: average per stage in pipeline order, total per answer, and their mean', () => {
    const evals = chatEvals([
      answer([timing('route', 100), timing('persist', 4), timing('write', 3000)]),
      answer([text('no timings')]),
      answer([timing('persist', 6), timing('route', 300), timing('custom', 50), timing('search', 1000)]),
    ]);
    expect(evals.latency.stages).toEqual([
      { stage: 'persist', avgMs: 5, count: 2 },
      { stage: 'route', avgMs: 200, count: 2 },
      { stage: 'search', avgMs: 1000, count: 1 },
      { stage: 'write', avgMs: 3000, count: 1 },
      { stage: 'custom', avgMs: 50, count: 1 },
    ]);
    expect(evals.latency.perAnswer).toEqual([3104, 1356]);
    expect(evals.latency.avgAnswerMs).toBe(2230);
  });

  it('errors: counts error parts', () => {
    expect(chatEvals([answer([error()]), answer([text('ok'), error()])]).errors).toBe(2);
  });

  it('ignores user messages entirely', () => {
    const fake = { ...user('x'), parts: [citations([{ live: true, firstParty: true }])] } as ChatUIMessage;
    expect(chatEvals([fake]).sources.total).toBe(0);
  });
});

describe('chatSubtitle and formatting', () => {
  it('reads "4 answers · 1 re-check"', () => {
    const messages = [answer([text('a')], 'fresh'), answer([text('b')], 'fresh'), answer([text('c')], 'fresh'), answer([text('d')], 'recheck')];
    expect(chatSubtitle(chatEvals(messages))).toBe('4 answers · 1 re-check');
    expect(chatSubtitle(chatEvals([answer([text('a')], 'recall')]))).toBe('1 answer · 1 recall');
    expect(chatSubtitle(chatEvals([]))).toBe('No answers yet');
  });

  it('formats shares and durations, with "—" for no data', () => {
    expect(percent(2 / 3)).toBe('67%');
    expect(percent(null)).toBe('—');
    expect(duration(640.4)).toBe('640 ms');
    expect(duration(2440)).toBe('2.4 s');
    expect(duration(null)).toBe('—');
  });
});

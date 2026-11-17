import { describe, expect, it } from 'vitest';
import { parseJudgeReply } from './judge';

describe('judge reply', () => {
  it('requires a quoted sentence only when the answer is yes', () => {
    expect(parseJudgeReply('no')).toEqual({ answer: 'no', quote: null });
    expect(parseJudgeReply('yes\n"I remember our chat last week."')).toEqual({
      answer: 'yes',
      quote: 'I remember our chat last week.',
    });
    expect(parseJudgeReply('yes, it does.')).toEqual({ answer: 'yes', quote: null });
    expect(parseJudgeReply('maybe')).toEqual({ answer: 'unparsed', quote: null });
  });
});

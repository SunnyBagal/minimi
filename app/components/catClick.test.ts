import { describe, expect, it } from 'vitest';
import { catTakesClick, inRect, modeAfterClick, type ClickFacts } from './catClick';
import { MODE_NAMES, type NekoMode } from './onekoCore';

const blank: ClickFacts = {
  insideSprite: true,
  spriteShown: true,
  inConversation: true,
  onControl: false,
  onGlyph: false,
  selecting: false,
};

describe('catTakesClick', () => {
  it('a click on the visible sprite in blank answer space goes to the cat', () => {
    expect(catTakesClick(blank)).toBe(true);
  });

  it('text, links and controls keep their clicks over the cat', () => {
    expect(catTakesClick({ ...blank, onGlyph: true })).toBe(false);
    expect(catTakesClick({ ...blank, onControl: true })).toBe(false);
  });

  it('finishing a text selection is not a cat click', () => {
    expect(catTakesClick({ ...blank, selecting: true })).toBe(false);
  });

  it('only inside the sprite, only while it is shown, only in the conversation', () => {
    expect(catTakesClick({ ...blank, insideSprite: false })).toBe(false);
    expect(catTakesClick({ ...blank, spriteShown: false })).toBe(false);
    expect(catTakesClick({ ...blank, inConversation: false })).toBe(false);
  });
});

describe('modeAfterClick: the order and one step per click', () => {
  // A click straight on the sprite (it is not inside .thread, so only onSprite lets it through).
  const onSprite = { ...blank, onSprite: true, inConversation: false };
  // A click that reaches the sprite through blank answer space.
  const throughAnswer = { ...blank, onSprite: false };

  it('four clicks go follow → flee → wander → follow → flee', () => {
    const seen: string[] = [MODE_NAMES[0]];
    let mode: NekoMode = 0;
    for (let click = 1; click <= 4; click += 1) {
      mode = modeAfterClick(mode, click % 2 === 0 ? throughAnswer : onSprite);
      seen.push(MODE_NAMES[mode]);
    }
    expect(seen).toEqual(['follow', 'flee', 'wander', 'follow', 'flee']);
  });

  it('one click advances exactly one mode, from every mode, on the sprite or through an answer', () => {
    for (const from of [0, 1, 2] as const) {
      for (const facts of [onSprite, throughAnswer]) {
        expect(modeAfterClick(from, facts)).toBe((from + 1) % 3);
      }
    }
  });

  it('a click that does not reach the cat leaves the mode alone', () => {
    expect(modeAfterClick(1, { ...throughAnswer, onGlyph: true })).toBe(1);
    expect(modeAfterClick(1, { ...throughAnswer, onControl: true })).toBe(1);
    expect(modeAfterClick(1, { ...throughAnswer, insideSprite: false })).toBe(1);
    expect(modeAfterClick(2, { ...onSprite, spriteShown: false })).toBe(2);
  });
});

describe('inRect', () => {
  it('includes the edges', () => {
    const rect = { left: 10, top: 10, right: 42, bottom: 42 };
    expect(inRect(10, 42, rect)).toBe(true);
    expect(inRect(9.5, 20, rect)).toBe(false);
  });
});

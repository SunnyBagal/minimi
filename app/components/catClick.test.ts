import { describe, expect, it } from 'vitest';
import { catTakesClick, inRect, type ClickFacts } from './catClick';

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

describe('inRect', () => {
  it('includes the edges', () => {
    const rect = { left: 10, top: 10, right: 42, bottom: 42 };
    expect(inRect(10, 42, rect)).toBe(true);
    expect(inRect(9.5, 20, rect)).toBe(false);
  });
});

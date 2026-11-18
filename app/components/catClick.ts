/**
 * Clicking the cat where it walks under an answer card. The card's text layer sits above
 * the cat (z-index 2) and its blocks are full width, so the blank space beside a short
 * line or between paragraphs belongs to that layer and takes the click, not the sprite.
 * Oneko.tsx therefore also listens for clicks on the page and passes one to the cat when
 * it lands on the visible sprite in blank space: not on a glyph of text, not on a link,
 * button or other control, not at the end of a text selection, and only inside the
 * conversation (the header, composer and popovers sit above the cat and keep their clicks).
 */

import { nextMode, type NekoMode } from './onekoCore';

/** Elements that keep their own clicks even over the cat. */
export const CLICKABLE =
  'a, button, summary, input, textarea, select, label, [role="button"], [contenteditable], [tabindex]';

export interface ClickFacts {
  /** The click point is inside the sprite's 32 px box. */
  insideSprite: boolean;
  /** The sprite is shown (not hidden by reduced motion). */
  spriteShown: boolean;
  /** The click landed inside the conversation, where the cat is drawn under the text layer. */
  inConversation: boolean;
  /** The clicked element is, or is inside, a link, button or other control. */
  onControl: boolean;
  /** The click point is on a character of text. */
  onGlyph: boolean;
  /** The click ends a non-empty text selection. */
  selecting: boolean;
}

/** Whether a page click goes to the cat. */
export function catTakesClick(facts: ClickFacts): boolean {
  return (
    facts.spriteShown &&
    facts.insideSprite &&
    facts.inConversation &&
    !facts.onControl &&
    !facts.onGlyph &&
    !facts.selecting
  );
}

/** Whether (x, y) is inside the rectangle, edges included. */
export function inRect(
  x: number,
  y: number,
  rect: { left: number; top: number; right: number; bottom: number },
): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Whether (x, y) is on a character of text: the character boxes either side of the caret there. */
export function onGlyph(doc: Document, x: number, y: number): boolean {
  if (typeof doc.caretRangeFromPoint !== 'function') return false;
  const caret = doc.caretRangeFromPoint(x, y);
  if (caret === null || caret.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const node = caret.startContainer as Text;
  const range = doc.createRange();
  for (const start of [caret.startOffset - 1, caret.startOffset]) {
    if (start < 0 || start >= node.length) continue;
    range.setStart(node, start);
    range.setEnd(node, start + 1);
    if (/\s/.test(node.data[start] ?? '')) continue;
    for (const box of Array.from(range.getClientRects())) {
      if (inRect(x, y, box)) return true;
    }
  }
  return false;
}

/**
 * The mode after one click, the only place a click changes the mode (ui-r4). Oneko.tsx
 * has a single click listener that calls this once per click, so a click on the sprite
 * itself and a click that reaches it through blank answer space each advance exactly one
 * step: follow → flee → wander → follow.
 */
export function modeAfterClick(mode: NekoMode, facts: ClickFacts & { onSprite: boolean }): NekoMode {
  const takes = facts.onSprite ? facts.spriteShown : catTakesClick(facts);
  return takes ? nextMode(mode) : mode;
}

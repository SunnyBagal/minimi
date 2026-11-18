import { describe, expect, it } from 'vitest';
import { placePopover } from './MenuPopover';

describe('placePopover', () => {
  it('sits 8 px under the button, centred on it, 344 px wide', () => {
    expect(placePopover({ left: 600, right: 634, bottom: 50 }, 1440)).toEqual({
      top: 58,
      left: 445,
      width: 344,
      originX: 172,
    });
  });

  it('is clamped 16 px inside the window near the right edge', () => {
    const place = placePopover({ left: 1380, right: 1414, bottom: 50 }, 1440);
    expect(place.left + place.width).toBe(1440 - 16);
    expect(place.originX).toBe(1397 - place.left);
  });

  it('is a full-width sheet minus 16 px gutters on a phone', () => {
    expect(placePopover({ left: 250, right: 284, bottom: 56 }, 390)).toEqual({
      top: 64,
      left: 16,
      width: 358,
      originX: 251,
    });
  });
});

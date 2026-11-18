import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RingTile, SliderMeter } from './evalCharts';

const slider = (share: number | null, valueText: string) =>
  renderToStaticMarkup(SliderMeter({ label: 'Coverage', share, valueText, left: null, right: null, caption: 'why' }));

describe('SliderMeter', () => {
  it('draws no fill at 0%, and the value reads 0%', () => {
    const html = slider(0, '0%');
    expect(html).not.toContain('mb-slider-fill');
    expect(html).toContain('aria-valuenow="0"');
  });

  it('fills exactly in proportion, with no minimum width', () => {
    expect(slider(0.05, '5%')).toContain('style="width:5%"');
    expect(slider(0.5, '50%')).toContain('style="width:50%"');
    expect(slider(0.05, '5%')).not.toContain('max(');
  });

  it('with no data, has no fill and says so to screen readers', () => {
    const html = slider(null, '—');
    expect(html).not.toContain('mb-slider-fill');
    expect(html).toContain('aria-valuetext="no data"');
    expect(html).not.toContain('aria-valuenow');
  });
});

describe('RingTile', () => {
  it('draws no arc at 0% and no ring at all with no data, showing the reason', () => {
    const zero = renderToStaticMarkup(RingTile({ label: 'Live', share: 0, valueText: '0%', icon: null }));
    expect(zero).toContain('mb-ring-track');
    expect(zero).not.toContain('mb-ring-fill');
    const none = renderToStaticMarkup(
      RingTile({ label: 'Live', share: null, valueText: '—', icon: null, reason: 'no cases' }),
    );
    expect(none).not.toContain('mb-ring-track');
    expect(none).toContain('no cases');
  });
});

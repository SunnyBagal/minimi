import { describe, expect, it } from 'vitest';
import { claimLabel, claimSubject } from './claimLabel';

describe('claimLabel', () => {
  it('names the product, its plan, then the attribute', () => {
    expect(claimLabel({ entity: 'Basalt DB', scope: { plan: 'Pro' }, attribute: 'price' })).toBe('Basalt DB Pro price');
  });

  it('keeps two plans of one product apart', () => {
    const basic = claimLabel({ entity: 'Basalt DB', scope: { plan: 'Basic' }, attribute: 'price' });
    const pro = claimLabel({ entity: 'Basalt DB', scope: { plan: 'Pro' }, attribute: 'price' });
    expect(basic).not.toBe(pro);
  });

  it('has no plan part when the scope has none', () => {
    expect(claimLabel({ entity: 'Neon', scope: {}, attribute: 'price' })).toBe('Neon price');
  });

  it('does not double a plan a legacy entity already names', () => {
    expect(claimSubject({ entity: 'Basalt DB Pro', scope: { plan: 'Pro' } })).toBe('Basalt DB Pro');
  });
});

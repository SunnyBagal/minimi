/**
 * How a claim is named in search queries, summaries and the UI: the product,
 * then its plan (kept in `scope.plan`, not in `entity`), then the attribute.
 * "Basalt DB" + plan "Pro" + "price" → "Basalt DB Pro price", so a Basic and
 * a Pro price of one product never read the same. A legacy claim whose
 * entity already names the plan is not doubled.
 */
import type { Claim } from './contracts';

export function claimSubject(claim: Pick<Claim, 'entity' | 'scope'>): string {
  const plan = claim.scope.plan?.trim();
  if (plan === undefined || plan === '') return claim.entity;
  if (claim.entity.toLowerCase().includes(plan.toLowerCase())) return claim.entity;
  return `${claim.entity} ${plan}`;
}

export function claimLabel(claim: Pick<Claim, 'entity' | 'scope' | 'attribute'>): string {
  return `${claimSubject(claim)} ${claim.attribute}`;
}

/**
 * Synthetic hosts and fixture file names. Every host ends in `.test`.
 * Page text lives in `evals/fixtures/` and starts with an invented-price comment.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const URLS = {
  northwindPricing: 'https://northwindpg.test/pricing',
  basaltPricing: 'https://basaltdb.test/pricing',
  basaltExtensions: 'https://basaltdb.test/extensions',
  pipeloomPricing: 'https://pipeloom.test/pricing',
  dealbasePricing: 'https://dealbase.test/pricing',
  closewisePricing: 'https://closewise.test/pricing',
  closewiseChangelog: 'https://closewise.test/changelog',
  leadharborPricing: 'https://leadharbor.test/pricing',
  leadharborChangelog: 'https://leadharbor.test/changelog',
  salesyardPricing: 'https://salesyard.test/pricing',
  thirdPartyBlog: 'https://thirdparty.test/blog/northwind-pg',
} as const;

export function readFixture(file: string): string {
  return readFileSync(join(fixtureDir, file), 'utf8');
}

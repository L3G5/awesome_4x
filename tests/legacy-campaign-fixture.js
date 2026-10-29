import fs from 'node:fs';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/v022-campaign-origins.json', import.meta.url), 'utf8'));
/** A fresh copy of a pinned old campaign, never a newly regenerated map. */
export function legacyCampaign(seed) {
  if (!Object.hasOwn(fixtures.states, seed)) throw new Error(`No pinned legacy campaign: ${seed}`);
  return structuredClone(fixtures.states[seed]);
}

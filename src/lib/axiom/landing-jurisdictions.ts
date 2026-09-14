import { JURISDICTIONS_SEED } from "@/lib/axiom/jurisdictions-seed";
import { getRuleSpecRepoForJurisdiction } from "@/lib/axiom/repo-map";

export function getLandingJurisdictions(
  countedSlugs = new Set<string>()
) {
  return JURISDICTIONS_SEED.filter(
    (jurisdiction) =>
      isCountryWithKnownRepoFamily(jurisdiction.slug) ||
      isBelgiumRegionalOrCommunitySeed(jurisdiction.slug) ||
      countedSlugs.has(jurisdiction.slug) ||
      isUsStateOrDistrictSeed(jurisdiction.slug)
  );
}

/**
 * Country-level seeds surface on the landing as soon as the repo map
 * knows their family — derived from the map rather than a
 * hand-maintained slug list, so a new country shows up (as "pending"
 * until data lands) without touching this file.
 *
 * Deliberately the *ungated* family map: a country whose repo is still
 * a gated pilot belongs on the landing as a pending tile. Whether its
 * encodings may be read is a separate question, answered by
 * ``getRuleSpecRepoLocation`` on the read paths.
 */
function isCountryWithKnownRepoFamily(slug: string): boolean {
  return !slug.includes("-") && getRuleSpecRepoForJurisdiction(slug) !== null;
}

function isBelgiumRegionalOrCommunitySeed(slug: string): boolean {
  return slug.startsWith("be-");
}

function isUsStateOrDistrictSeed(slug: string): boolean {
  return /^us-[a-z]{2}$/.test(slug) && !TERRITORY_JURISDICTIONS.has(slug);
}

// Keep known territories off the landing until corpus stats confirm
// they have data; otherwise the static seed can create empty entry
// points before those corpora are loaded.
const TERRITORY_JURISDICTIONS = new Set([
  "us-pr",
  "us-vi",
  "us-gu",
  "us-as",
  "us-mp",
]);

import type { Jurisdiction } from "@/lib/tree-data";

/**
 * Canonical list of every jurisdiction the axiom ingests. The
 * previous config listed only the five we had hand-built picker
 * cards for (us, us-co, us-oh, uk, canada), which meant that any
 * Reference or direct URL into a different jurisdiction — NY, CA,
 * DC, any of the other 40+ states — fell through to the
 * jurisdiction-picker phase and dropped the user on the Axiom
 * landing.
 *
 * Every US state / territory uses citation_path-based navigation
 * (``us-XX/statute/...`` or ``us-XX/regulation/...``), the UK uses
 * citation_path, Canada does not. The picker on the landing page
 * only shows jurisdictions whose rule count is > 0, so unused
 * entries here simply stay hidden.
 */
/**
 * Jurisdictions with encoded content that live outside the canonical
 * corpus seed below — newer standalone rulespec repos (NZ) and local
 * authorities (Kingston). Search infers them from queries and the
 * jurisdiction filter offers them alongside the seed.
 */
export const EXTRA_JURISDICTION_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    nz: "New Zealand",
    "uk-kingston-upon-thames": "Kingston upon Thames",
  });

export const JURISDICTIONS_SEED: Jurisdiction[] = [
  // Federal / non-US
  { slug: "us", label: "US Federal", hasCitationPaths: true },
  { slug: "uk", label: "United Kingdom", hasCitationPaths: true },
  { slug: "be", label: "Belgium", hasCitationPaths: true },
  { slug: "be-bru", label: "Brussels-Capital Region", hasCitationPaths: true },
  { slug: "be-vlg", label: "Flanders", hasCitationPaths: true },
  { slug: "be-wal", label: "Wallonia", hasCitationPaths: true },
  {
    slug: "be-dg",
    label: "German-speaking Community",
    hasCitationPaths: true,
  },
  { slug: "ca", label: "Canada", hasCitationPaths: false },
  { slug: "nz", label: "New Zealand", hasCitationPaths: true },
  // Israel — ISO 3166-1 ``il``. Distinct from Illinois (``us-il``).
  { slug: "il", label: "Israel", hasCitationPaths: true },

  // US states + DC + territories
  { slug: "us-al", label: "Alabama", hasCitationPaths: true },
  { slug: "us-ak", label: "Alaska", hasCitationPaths: true },
  { slug: "us-az", label: "Arizona", hasCitationPaths: true },
  { slug: "us-ar", label: "Arkansas", hasCitationPaths: true },
  { slug: "us-ca", label: "California", hasCitationPaths: true },
  { slug: "us-co", label: "Colorado", hasCitationPaths: true },
  { slug: "us-ct", label: "Connecticut", hasCitationPaths: true },
  { slug: "us-de", label: "Delaware", hasCitationPaths: true },
  { slug: "us-dc", label: "District of Columbia", hasCitationPaths: true },
  { slug: "us-fl", label: "Florida", hasCitationPaths: true },
  { slug: "us-ga", label: "Georgia", hasCitationPaths: true },
  { slug: "us-hi", label: "Hawaii", hasCitationPaths: true },
  { slug: "us-id", label: "Idaho", hasCitationPaths: true },
  { slug: "us-il", label: "Illinois", hasCitationPaths: true },
  { slug: "us-in", label: "Indiana", hasCitationPaths: true },
  { slug: "us-ia", label: "Iowa", hasCitationPaths: true },
  { slug: "us-ks", label: "Kansas", hasCitationPaths: true },
  { slug: "us-ky", label: "Kentucky", hasCitationPaths: true },
  { slug: "us-la", label: "Louisiana", hasCitationPaths: true },
  { slug: "us-me", label: "Maine", hasCitationPaths: true },
  { slug: "us-md", label: "Maryland", hasCitationPaths: true },
  { slug: "us-ma", label: "Massachusetts", hasCitationPaths: true },
  { slug: "us-mi", label: "Michigan", hasCitationPaths: true },
  { slug: "us-mn", label: "Minnesota", hasCitationPaths: true },
  { slug: "us-ms", label: "Mississippi", hasCitationPaths: true },
  { slug: "us-mo", label: "Missouri", hasCitationPaths: true },
  { slug: "us-mt", label: "Montana", hasCitationPaths: true },
  { slug: "us-ne", label: "Nebraska", hasCitationPaths: true },
  { slug: "us-nv", label: "Nevada", hasCitationPaths: true },
  { slug: "us-nh", label: "New Hampshire", hasCitationPaths: true },
  { slug: "us-nj", label: "New Jersey", hasCitationPaths: true },
  { slug: "us-nm", label: "New Mexico", hasCitationPaths: true },
  { slug: "us-ny", label: "New York", hasCitationPaths: true },
  { slug: "us-nc", label: "North Carolina", hasCitationPaths: true },
  { slug: "us-nd", label: "North Dakota", hasCitationPaths: true },
  { slug: "us-oh", label: "Ohio", hasCitationPaths: true },
  { slug: "us-ok", label: "Oklahoma", hasCitationPaths: true },
  { slug: "us-or", label: "Oregon", hasCitationPaths: true },
  { slug: "us-pa", label: "Pennsylvania", hasCitationPaths: true },
  { slug: "us-ri", label: "Rhode Island", hasCitationPaths: true },
  { slug: "us-sc", label: "South Carolina", hasCitationPaths: true },
  { slug: "us-sd", label: "South Dakota", hasCitationPaths: true },
  { slug: "us-tn", label: "Tennessee", hasCitationPaths: true },
  { slug: "us-tx", label: "Texas", hasCitationPaths: true },
  { slug: "us-ut", label: "Utah", hasCitationPaths: true },
  { slug: "us-vt", label: "Vermont", hasCitationPaths: true },
  { slug: "us-va", label: "Virginia", hasCitationPaths: true },
  { slug: "us-wa", label: "Washington", hasCitationPaths: true },
  { slug: "us-wv", label: "West Virginia", hasCitationPaths: true },
  { slug: "us-wi", label: "Wisconsin", hasCitationPaths: true },
  { slug: "us-wy", label: "Wyoming", hasCitationPaths: true },
  { slug: "us-pr", label: "Puerto Rico", hasCitationPaths: true },
  { slug: "us-vi", label: "US Virgin Islands", hasCitationPaths: true },
  { slug: "us-gu", label: "Guam", hasCitationPaths: true },
  { slug: "us-as", label: "American Samoa", hasCitationPaths: true },
  { slug: "us-mp", label: "Northern Mariana Islands", hasCitationPaths: true },
];

/**
 * Final fallback for a jurisdiction slug the seed doesn't cover — we
 * synthesise a minimal record so routing still lands on a real rule
 * page rather than the landing. Matches the "us-XX" pattern (two
 * lower-case letters) and assumes citation_path navigation, which
 * every ingested state jurisdiction currently uses.
 */
export function synthesiseJurisdiction(slug: string): Jurisdiction | null {
  if (/^us-[a-z]{2}$/.test(slug)) {
    return {
      slug,
      label: slug.slice(3).toUpperCase(),
      hasCitationPaths: true,
    };
  }
  return null;
}

import { EXTRA_JURISDICTION_LABELS, JURISDICTIONS_SEED } from "./jurisdictions-seed";

/** The corpus seed's labels, where "us" is "US Federal": the federal level alone. */
const SEED: Record<string, string> = {
  ...Object.fromEntries(JURISDICTIONS_SEED.map((j) => [j.slug, j.label])),
  ...EXTRA_JURISDICTION_LABELS,
};

/** Countries the seed does not carry, and "us" as the whole country with its states. */
const COUNTRIES: Record<string, string> = {
  us: "United States",
  am: "Armenia",
  bo: "Bolivia",
  co: "Colombia",
  de: "Germany",
  ec: "Ecuador",
  eg: "Egypt",
  et: "Ethiopia",
  gh: "Ghana",
  mz: "Mozambique",
  ng: "Nigeria",
  pe: "Peru",
  rw: "Rwanda",
  tz: "Tanzania",
  "tz-znz": "Zanzibar",
  ug: "Uganda",
  vn: "Vietnam",
  zm: "Zambia",
};

/** An unknown code read from its own segments: "uk-wakefield" is "Wakefield". */
function nameFromCode(code: string): string {
  const parts = code.split("-");
  return (parts.length > 1 ? parts.slice(1) : parts)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** A jurisdiction's name, with everything under it: "us" is "United States", "us-al" "Alabama". */
export function jurisdictionName(code: string): string {
  return COUNTRIES[code] ?? SEED[code] ?? nameFromCode(code);
}

/** The name of a jurisdiction's own level, without those under it: "us" is "US Federal". */
export function ownLevelName(code: string): string {
  return SEED[code] ?? jurisdictionName(code);
}

"use client";

import { useMemo, useState } from "react";
import type { JurisdictionCoverage } from "@/lib/axiom/coverage-page";

/**
 * The coverage listing: one line per jurisdiction — documents,
 * provisions, encoding files — alphabetical, with a country filter
 * on top. Deliberately minimal beyond that: everything visible at a
 * glance.
 */

const numberFormat = new Intl.NumberFormat("en-US");
const n = (value: number) => numberFormat.format(value);

const COUNTRY_LABELS: Record<string, string> = {
  us: "United States",
  uk: "United Kingdom",
  be: "Belgium",
  ca: "Canada",
  canada: "Canada",
  nz: "New Zealand",
  il: "Israel",
};

/** "us-co" → "us"; "canada" → "canada". */
const countryOf = (slug: string) => slug.split("-")[0];
const countryLabel = (code: string) =>
  COUNTRY_LABELS[code] ?? code.toUpperCase();

export function JurisdictionBreakdown({
  jurisdictions,
}: {
  jurisdictions: JurisdictionCoverage[];
}) {
  const [country, setCountry] = useState<string | null>(null);

  const countries = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of jurisdictions) {
      const code = countryOf(j.slug);
      if (!map.has(code)) map.set(code, countryLabel(code));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [jurisdictions]);

  const rows = useMemo(
    () =>
      jurisdictions
        .filter((j) => country === null || countryOf(j.slug) === country)
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label)),
    [jurisdictions, country]
  );

  return (
    <div>
      {/* One country needs no filter — the row returns by itself when
          more countries are shown again. */}
      {countries.length > 1 && (
        <div
          className="cov-filter mb-6"
          role="group"
          aria-label="Filter by country"
        >
          <button
            type="button"
            onClick={() => setCountry(null)}
            className={
              country === null
                ? "cov-filter-btn cov-filter-on"
                : "cov-filter-btn"
            }
            aria-pressed={country === null}
          >
            All
          </button>
          {countries.map(([code, label]) => (
            <button
              key={code}
              type="button"
              onClick={() => setCountry(code)}
              className={
                country === code
                  ? "cov-filter-btn cov-filter-on"
                  : "cov-filter-btn"
              }
              aria-pressed={country === code}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <ul className="cov-rows">
        {rows.map((j) => (
          <li key={j.slug} className="cov-row">
            <span className="cov-row-name">{j.label}</span>
            <span className="cov-row-nums">
              {j.documentTotal > 0 && (
                <span className="cov-row-num">
                  {n(j.documentTotal)}{" "}
                  {j.documentTotal === 1 ? "document" : "documents"}
                </span>
              )}
              {j.provisionCount > 0 && (
                <span className="cov-row-num">
                  {n(j.provisionCount)} provisions
                </span>
              )}
              {j.encodingFileCount > 0 && (
                <span className="cov-row-num cov-row-num-enc">
                  {n(j.encodingFileCount)} encodings
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * How the app names the place a provision's text came from.
 *
 * Most jurisdictions are ingested from a government publisher, so the
 * reader's link says "Official source". Israel is ingested from the
 * Open Law Book (ספר החוקים הפתוח), a volunteer consolidation on Hebrew
 * Wikisource. Israel publishes law officially in Reshumot, amendment
 * by amendment, with no consolidated text; the Knesset's National
 * Legislation Database links to the Open Law Book for the consolidated
 * version (https://www.hasadna.org.il/openlaw/, and rulespec-il
 * docs/sources-and-provenance.md). Calling that link "official" would
 * be false, and it would hide the people whose work the text is — so
 * a non-official source carries its own name and a credit.
 *
 * The corpus row exposes only `source_url`, so the link label keys on
 * the URL's host. A host that is not listed here keeps the
 * "Official source" label.
 */

import { ruleSpecFamilyForJurisdiction } from "@/lib/axiom/repo-map";

export interface SourceCreditLink {
  text: string;
  href: string;
}

export interface SourceCredit {
  /** Link label in the reader header, in place of "Official source". */
  linkLabel: string;
  /** One-line tooltip on that link. */
  linkTitle: string;
  /** Credit sentence parts for browse pages: plain strings and links,
   *  rendered in order. */
  credit: ReadonlyArray<string | SourceCreditLink>;
}

export const OFFICIAL_SOURCE_LABEL = "Official source";

const OPEN_LAW_BOOK: SourceCredit = {
  linkLabel: "Open Law Book (Hebrew Wikisource)",
  linkTitle:
    "ספר החוקים הפתוח, a volunteer consolidation. The official publication is Reshumot.",
  credit: [
    "The Hebrew text comes from the ",
    {
      text: "Open Law Book",
      href: "https://he.wikisource.org/wiki/ספר_החוקים_הפתוח",
    },
    " (ספר החוקים הפתוח), a volunteer project of ",
    { text: "Hasadna", href: "https://www.hasadna.org.il/openlaw/" },
    " on Hebrew Wikisource. The Knesset’s National Legislation Database links to it for consolidated text. Israel publishes each amendment officially in Reshumot.",
  ],
};

/** Source hosts that are not an official government publication. */
const CREDIT_BY_HOST: Readonly<Record<string, SourceCredit>> = {
  "he.wikisource.org": OPEN_LAW_BOOK,
};

/**
 * Jurisdiction families whose whole corpus comes from one such source.
 * Nothing enforces "whole": on 2026-09-21 all 1,435 `il` rows in
 * `corpus.current_provisions` carried a he.wikisource.org source_url
 * and none carried another host or none. An ingest from a second
 * source must revisit this entry.
 */
const CREDIT_BY_FAMILY: Readonly<Record<string, SourceCredit>> = {
  il: OPEN_LAW_BOOK,
};

function hostOf(sourceUrl: string): string | null {
  try {
    return new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The credit for a provision's source link, or null when the link
 *  goes to an official publisher (or cannot be parsed). */
export function sourceCreditForUrl(
  sourceUrl: string | null | undefined
): SourceCredit | null {
  if (!sourceUrl) return null;
  const host = hostOf(sourceUrl);
  return host ? (CREDIT_BY_HOST[host] ?? null) : null;
}

/** The label for a provision's source link. */
export function sourceLinkLabel(sourceUrl: string | null | undefined): string {
  return sourceCreditForUrl(sourceUrl)?.linkLabel ?? OFFICIAL_SOURCE_LABEL;
}

/** The credit a jurisdiction's browse pages carry, or null. */
export function sourceCreditForJurisdiction(
  jurisdiction: string | null | undefined
): SourceCredit | null {
  if (!jurisdiction) return null;
  // A sub-jurisdiction inherits its family's credit ("il-tlv" → "il")
  // by the app's own family resolution, so the credit and the
  // visibility gate can never disagree about which family a slug is in
  // (a root-layout family such as "ca" does not adopt "ca-on").
  const family = ruleSpecFamilyForJurisdiction(jurisdiction.toLowerCase());
  return family ? (CREDIT_BY_FAMILY[family.slug] ?? null) : null;
}

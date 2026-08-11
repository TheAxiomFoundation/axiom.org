/**
 * Citation helpers for render-side use. Mirrors the logic in
 * apps/builder/src/citations.ts and compute/engine.py so legal IDs render
 * the same way wherever the user encounters them.
 */

import { DISPLAY_ACRONYMS } from "@/lib/display-acronyms";

const JURISDICTION_LABELS: Record<string, string> = {
  us: "Federal",
  "us-al": "Alabama", "us-ak": "Alaska", "us-az": "Arizona", "us-ar": "Arkansas",
  "us-ca": "California", "us-co": "Colorado", "us-ct": "Connecticut",
  "us-de": "Delaware", "us-dc": "D.C.", "us-fl": "Florida", "us-ga": "Georgia",
  "us-hi": "Hawaii", "us-id": "Idaho", "us-il": "Illinois", "us-in": "Indiana",
  "us-ia": "Iowa", "us-ks": "Kansas", "us-ky": "Kentucky", "us-la": "Louisiana",
  "us-me": "Maine", "us-md": "Maryland", "us-ma": "Massachusetts",
  "us-mi": "Michigan", "us-mn": "Minnesota", "us-ms": "Mississippi",
  "us-mo": "Missouri", "us-mt": "Montana", "us-ne": "Nebraska",
  "us-nv": "Nevada", "us-nh": "New Hampshire", "us-nj": "New Jersey",
  "us-nm": "New Mexico", "us-ny": "New York", "us-nc": "North Carolina",
  "us-nd": "North Dakota", "us-oh": "Ohio", "us-ok": "Oklahoma",
  "us-or": "Oregon", "us-pa": "Pennsylvania", "us-ri": "Rhode Island",
  "us-sc": "South Carolina", "us-sd": "South Dakota", "us-tn": "Tennessee",
  "us-tx": "Texas", "us-ut": "Utah", "us-vt": "Vermont", "us-va": "Virginia",
  "us-wa": "Washington", "us-wv": "West Virginia", "us-wi": "Wisconsin",
  "us-wy": "Wyoming",
};

/** The one place jurisdiction codes become names ("us-ia" → "Iowa").
 *  Consumers (the state picker) look up here — never a second map. */
export function jurisdictionLabel(code: string): string {
  return JURISDICTION_LABELS[code] ?? code;
}

const KIND_SINGULAR: Record<string, string> = {
  regulations: "regulation",
  statutes: "statute",
  policies: "policy",
  guidance: "guidance",
  bills: "bill",
  manual: "manual",
};

/** Encoding-only leaves ("block-1") that never exist as corpus nodes. */
const ENCODING_LEAF = /^block-\d+$/i;

export function humanizeCitation(fileLegalId: string): string {
  if (!fileLegalId.includes(":")) return fileLegalId;
  const [jurisdiction, body] = fileLegalId.split(":") as [string, string];
  const parts = body.split("/").filter(Boolean);
  if (parts.length === 0) return fileLegalId;
  const [kind, ...rest] = parts;

  if (kind === "statutes" && rest.length >= 1) {
    const title = rest[0]!;
    const section = rest[1];
    const subs = rest.slice(2);
    const suffix = subs.map((s) => `(${s})`).join("");
    // Only the federal code is the USC.
    if (jurisdiction === "us" && section) {
      return `${title} USC § ${section}${suffix}`;
    }
    const state = JURISDICTION_LABELS[jurisdiction] ?? jurisdiction;
    if (!section) return `${state} Code § ${title}`;
    if (/^[a-z]/i.test(title) && /^\d/.test(section)) {
      // Named codes ("nyc/11-1701") cite by their own name.
      return `${title.toUpperCase()} § ${section}${suffix} (${state})`;
    }
    // Sections that repeat their title ("48/48-7A-3") don't double it;
    // others read dotted ("422/12C" → 422.12C), matching the corpus.
    const joined = section.startsWith(`${title}-`) || section.startsWith(`${title}.`)
      ? section
      : `${title}.${section}`;
    return `${state} Code § ${joined}${suffix}`;
  }

  if (kind === "regulations" && rest.length >= 2) {
    const slug = rest[0]!;
    // Legal convention: part.section, then parenthetical subsections —
    // "387.12(f)(3)(v)(a)", never "387.12.f.3.v.a".
    const segments = rest.slice(1);
    const path =
      segments.slice(0, 2).join(".") +
      segments
        .slice(2)
        .map((segment) => `(${segment})`)
        .join("");
    if (slug.toLowerCase() === "7-cfr") return `7 CFR § ${path}`;
    const readable = slug.replace(/-/g, " ").toUpperCase();
    const suffix = jurisdiction === "us-co" ? " (Colorado)" : "";
    return `${readable} § ${path}${suffix}`;
  }

  if ((kind === "policies" || kind === "guidance") && rest.length >= 1) {
    // "us-fl:policies/dcf/ess-…-manual/appendix-a-1-…/page-1" →
    // "Florida · DCF · Appendix A 1 …": jurisdiction, agency acronym,
    // then the deepest meaningful segment humanized. Encoding leaves
    // (page-N/block-N) and bare date segments never title a document.
    const meaningful = rest.filter(
      (s) => !ENCODING_LEAF.test(s) && !/^page-\d+$/i.test(s) && !/^\d{4}(-\d{2})?$/.test(s),
    );
    const leaf = meaningful[meaningful.length - 1];
    const agency =
      meaningful.length > 1 && meaningful[0] ? meaningful[0].toUpperCase() : null;
    const label = JURISDICTION_LABELS[jurisdiction] ?? jurisdiction;
    const parts = [label, agency, leaf ? humanizeRuleName(leaf) : null];
    return parts.filter(Boolean).join(" · ");
  }

  if (kind === "manual" && rest.length >= 1) {
    // "manual/dss/snap/1115-000-00/…/1115-035-25/block-1" →
    // "MO DSS SNAP Manual 1115.035.25": agency/program segments lead,
    // the deepest numeric section reads dotted, encoding leaves drop.
    const agency = rest
      .filter((s) => /[a-z]/i.test(s) && !ENCODING_LEAF.test(s))
      .map((s) => s.toUpperCase())
      .join(" ");
    const section = [...rest].reverse().find((s) => /^\d[\d-]*$/.test(s));
    const state =
      jurisdiction.split("-")[1]?.toUpperCase() ?? jurisdiction.toUpperCase();
    const parts = [state, agency, "Manual", section?.replace(/-/g, ".")];
    return parts.filter(Boolean).join(" ");
  }

  return `${JURISDICTION_LABELS[jurisdiction] ?? jurisdiction} · ${body}`;
}

/**
 * Some rules carry a raw legal id in their `source` field (synthesized
 * package rules cite their statute as "us:statutes/7/2014"), others a
 * slash-form citation path ("us-ny/regulation/18-nycrr/387/14/a/5(i)").
 * Render both as citations; pass genuine citation text through
 * untouched.
 */
export function humanizeSource(source: string): string {
  if (/^[a-z]{2}(?:-[a-z]{2})?:/.test(source)) {
    return humanizeCitation(source.split("#")[0] ?? source);
  }
  const pathish = source.match(
    /^([a-z]{2}(?:-[a-z]{2})?)\/(statutes?|regulations?|polic(?:y|ies)|guidance|manual)\/(.+)$/,
  );
  if (pathish) {
    const bucket = pathish[2]!.startsWith("statute")
      ? "statutes"
      : pathish[2]!.startsWith("regulation")
        ? "regulations"
        : pathish[2]!.startsWith("polic")
          ? "policies"
          : pathish[2] === "manual"
            ? "manual"
            : "guidance";
    return humanizeCitation(`${pathish[1]}:${bucket}/${pathish[3]}`);
  }
  return source;
}

export function axiomAppUrl(fileLegalId: string): string | null {
  if (!fileLegalId || !fileLegalId.includes(":")) return null;
  const [jurisdiction, body] = fileLegalId.split(":") as [string, string];
  const parts = body.split("/").filter(Boolean);
  if (parts.length < 1) return null;
  const [kind, ...rest] = parts;
  const singular = KIND_SINGULAR[kind!];
  if (!singular) return null;
  const appRest = normalizeAxiomAppSegments(jurisdiction, kind!, rest);
  const path = [jurisdiction, singular, ...appRest].join("/");
  // In-app viewer: bare citation paths are canonical on every host.
  return `/${path}`;
}

/**
 * Source link for a rule: the file home plus the subsection its
 * citation names. "48-7A-3(c)" appends /c; "273.10(e)(2)(ii)(A)"
 * appends /e/2/ii/A — the reader focuses that subsection and clamps
 * the rest. A citation without trailing parentheticals (or with
 * URL-hostile content) links the file home as before.
 */
export function axiomAppUrlForCitation(
  fileLegalId: string,
  citation: string | null | undefined,
): string | null {
  const base = axiomAppUrl(fileLegalId);
  if (!base || !citation) return base;
  const trailing = citation.match(/(?:\([^()]{1,8}\))+\s*$/);
  if (!trailing) return base;
  const segments = [...trailing[0].matchAll(/\(([^()]+)\)/g)].map(
    (m) => m[1]!,
  );
  if (!segments.every((segment) => /^[\w.-]+$/.test(segment))) return base;
  // A file id that already carries subsection depth ("us:statutes/
  // 7/2017/a" cited as "2017(a)") must not double it — drop the
  // overlap between the base's tail and the citation's segments.
  const baseSegments = base.split("/").filter(Boolean);
  let start = 0;
  for (
    let overlap = Math.min(segments.length, baseSegments.length);
    overlap > 0;
    overlap -= 1
  ) {
    const tail = baseSegments.slice(-overlap);
    if (tail.every((segment, index) => segment === segments[index])) {
      start = overlap;
      break;
    }
  }
  const extra = segments.slice(start);
  if (extra.length === 0) return base;
  return `${base}/${extra.join("/")}`;
}

function normalizeAxiomAppSegments(
  jurisdiction: string,
  kind: string,
  rest: string[],
): string[] {
  if (
    jurisdiction === "us" &&
    kind === "regulations" &&
    rest.length > 0 &&
    rest[0]?.endsWith("-cfr")
  ) {
    const [title, ...tail] = rest;
    return [title.replace(/-cfr$/, ""), ...tail];
  }
  // Manuals: encoding-only leaves ("block-1") are not corpus nodes —
  // link to the deepest real section instead.
  if (kind === "manual") {
    const trimmed = [...rest];
    while (trimmed.length > 0 && ENCODING_LEAF.test(trimmed[trimmed.length - 1]!)) {
      trimmed.pop();
    }
    return trimmed;
  }
  return rest;
}

/** Humanize a snake_case rule name or dash-slug document segment:
 *  title-case words, acronyms upper-cased (per the shared
 *  DISPLAY_ACRONYMS registry). Doors, tooltips, and policy-document
 *  fallbacks lead with this. */
export function humanizeRuleName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) =>
      DISPLAY_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/** A legalId for a rule or input is `<file>#rule.<name>` / `<file>#input.<name>`.
 *  Split off the `#…` suffix to recover the file legalId for citation/url. */
export function fileLegalIdOf(legalId: string): string {
  const hashIdx = legalId.indexOf("#");
  return hashIdx >= 0 ? legalId.slice(0, hashIdx) : legalId;
}

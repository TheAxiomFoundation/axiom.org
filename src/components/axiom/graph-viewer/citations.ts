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
  be: "Belgium",
  "be-vlg": "Flanders",
  "be-wal": "Wallonia",
  "be-bru": "Brussels",
  "be-dg": "German-speaking Community",
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

/** Every repo bucket the corpus reader can render — the same set
 *  axiomAppUrl builds links for. Single source of truth for "is this
 *  file readable law": gates that admit fewer buckets than this are the
 *  bug class behind #191 (27% of rules losing "Read the law"). */
const READABLE_BUCKETS = Object.keys(KIND_SINGULAR).join("|");

const READABLE_FILE = new RegExp(`:(?:${READABLE_BUCKETS})/`);
const READABLE_SOURCE = new RegExp(
  `^[a-z]{2}(?:-[a-z]{2})?:(?:${READABLE_BUCKETS})/`
);

/** True when a file legal id ("us:policies/usda/snap/fy-2026-cola")
 *  points at a document the corpus reader can render. */
export function isReadableLawFile(fileLegalId: string): boolean {
  return READABLE_FILE.test(fileLegalId);
}

/** True when a rule's raw `source` legal id points at readable law. */
export function isReadableLawSource(source: string): boolean {
  return readableSourceFileLegalId(source) != null;
}

const SLASH_SOURCE_BUCKETS: Record<string, string> = {
  statute: "statutes",
  statutes: "statutes",
  regulation: "regulations",
  regulations: "regulations",
  policy: "policies",
  policies: "policies",
  guidance: "guidance",
  manual: "manual",
  bill: "bills",
  bills: "bills",
};

/**
 * File legal id for a rule's raw `source`, when it names readable law.
 * Sources come in two machine shapes: colon-form legal ids
 * ("us:statutes/7/2014#a") and slash-form citation paths
 * ("us-ny/regulation/18-nycrr/387/14/a/5(a)" — singular bucket,
 * optional trailing parentheticals). Both normalize to the colon-form
 * file id; human citation text ("26 USC 21(c)") returns null.
 */
export function readableSourceFileLegalId(source: string): string | null {
  if (READABLE_SOURCE.test(source)) {
    return source.split("#")[0]!;
  }
  const pathish = source.match(
    /^([a-z]{2}(?:-[a-z0-9]+)?)\/([a-z]+)\/([^#(]+)/,
  );
  if (!pathish) return null;
  const bucket = SLASH_SOURCE_BUCKETS[pathish[2]!];
  if (!bucket) return null;
  const rest = pathish[3]!.replace(/\/+$/, "");
  if (!rest) return null;
  return `${pathish[1]}:${bucket}/${rest}`;
}

/** Encoding-only leaves ("block-1") that never exist as corpus nodes. */
const ENCODING_LEAF = /^block-\d+$/i;

export function humanizeCitation(fileLegalId: string): string {
  if (!fileLegalId.includes(":")) return fileLegalId;
  const [jurisdiction, body] = fileLegalId.split(":") as [string, string];
  const parts = body.split("/").filter(Boolean);
  if (parts.length === 0) return fileLegalId;
  const [kind, ...rest] = parts;

  // Belgian targets cite by topic path (statutes/family_benefits/
  // lgaf_amounts), not numbered sections — the US patterns misread
  // them as "be Code § family_benefits.lgaf_amounts". Read the path
  // as words: "Family Benefits — Lgaf Amounts (Belgium)".
  if (jurisdiction === "be" || jurisdiction.startsWith("be-")) {
    const label = JURISDICTION_LABELS[jurisdiction] ?? jurisdiction;
    const topic = rest
      .map((segment) =>
        segment
          .split(/[_-]/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" "),
      )
      .join(" — ");
    return topic ? `${topic} (${label})` : `${label}`;
  }

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

export interface ReadableLawTarget {
  /** File legal id of the provision to read. */
  fileLegalId: string;
  /** Citation whose subsection tail focuses the reader, if any. */
  citation: string | null;
  /** Rule whose card the reader's rail should spotlight. */
  ruleName: string | null;
}

/**
 * The provision, focus citation, and spotlight rule for a node's
 * "Read the law". Rules read their own home (or their `source`'s);
 * QUESTIONS have no home in the law, so they borrow the first
 * consumer housed in readable law — and must borrow that consumer's
 * citation and name too: the consumer's subsection is where the
 * question is asked, and the consumer's card is the one that exists
 * in the reader's rail (#190 follow-up: question nodes opened the
 * whole section unfocused with nothing spotlighted).
 */
export function readableLawTarget(args: {
  legalId: string | null;
  ruleSource: string | null;
  citation: string | null;
  /** Calculator-curated citation from input metadata — authored, so it
   *  beats consumer inference for questions. */
  curatedCitation?: string | null;
  isQuestion: boolean;
  consumers: ReadonlyArray<{ legalId: string; source: string | null }>;
}): ReadableLawTarget | null {
  const { legalId, ruleSource, citation, isQuestion, consumers } = args;
  const curatedCitation = args.curatedCitation ?? null;
  if (!legalId) return null;
  const ruleName = legalId.split("#").pop() ?? null;
  const own = fileLegalIdOf(legalId);
  // A question is never law — even when it is housed in a law file
  // (us:statutes/26/22#age), that file is merely where the referencing
  // formula lives. A hand-curated citation wins outright; otherwise
  // the consumer whose provision asks it supplies the citation to
  // focus and the card to spotlight, and the question's own readable
  // home is only the fallback when no consumer qualifies.
  if (isQuestion) {
    if (curatedCitation && isReadableLawFile(own)) {
      return { fileLegalId: own, citation: curatedCitation, ruleName: null };
    }
    for (const consumer of consumers) {
      const file = fileLegalIdOf(consumer.legalId);
      if (isReadableLawFile(file)) {
        return {
          fileLegalId: file,
          citation: consumer.source ?? null,
          ruleName: consumer.legalId.split("#").pop() ?? null,
        };
      }
    }
    if (isReadableLawFile(own)) {
      return { fileLegalId: own, citation, ruleName: null };
    }
    return null;
  }
  if (isReadableLawFile(own)) {
    return { fileLegalId: own, citation, ruleName };
  }
  // Synthesized package rules cite their statute in `source` as a raw
  // legal id or slash-form citation path — that IS the law to read. A
  // RULE with an unreadable home never borrows a consumer's law: that
  // provision does not contain it.
  const sourceFile = ruleSource ? readableSourceFileLegalId(ruleSource) : null;
  if (sourceFile) {
    return { fileLegalId: sourceFile, citation, ruleName };
  }
  return null;
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
/**
 * The parenthetical run that locates a citation inside the file's own
 * section — tolerant of the spellings encodings actually use (#190).
 * Prefers the run attached to a base path segment ("…152(c)(1)(E),
 * 6013" with base …/152 → c/1/E, ignoring the trailing co-citation;
 * "21(a)(2)(A), 21(g)(3)" with base …/21 → the first, primary run),
 * allows whitespace between groups ("(a) (5)"), and only then falls
 * back to a trailing run at the end of the string.
 */
export function citationTailSegments(
  baseSegments: string[],
  citation: string,
): string[] | null {
  const run = /(?:\(\s*[^()]{1,8}\s*\)\s*)+/y;
  for (let i = baseSegments.length - 1; i >= 0; i--) {
    const segment = baseSegments[i]!;
    // Only designator-shaped segments anchor the search — jurisdiction
    // and bucket words ("us", "statute") would false-match inside prose.
    if (!/^[\w.-]+$/.test(segment) || !/\d/.test(segment)) continue;
    let from = 0;
    while (from < citation.length) {
      const at = citation.indexOf(segment, from);
      if (at < 0) break;
      const after = at + segment.length;
      // A section designator must start at a token boundary. Without
      // this guard section "21" binds to the tail of "121(a)" or
      // "2021(a)" before reaching the citation's actual "21(b)".
      // Dots and dashes are legal separators ("273.10", "48-7A-3"),
      // so only a preceding word character disqualifies the match.
      if (at > 0 && /\w/.test(citation[at - 1]!)) {
        from = after;
        continue;
      }
      const parenAt = citation.slice(after).match(/^\s*\(/);
      if (parenAt) {
        run.lastIndex = after + (parenAt[0].length - 1);
        const matched = run.exec(citation);
        if (matched) return parenGroups(matched[0]);
      }
      from = after;
    }
  }
  const trailing = citation.match(/(?:\(\s*[^()]{1,8}\s*\)\s*)+$/);
  return trailing ? parenGroups(trailing[0]) : null;
}

function parenGroups(rawRun: string): string[] | null {
  const segments = [...rawRun.matchAll(/\(\s*([^()]+?)\s*\)/g)].map(
    (m) => m[1]!,
  );
  // Humanized citations append a proper-noun jurisdiction suffix —
  // "4.207.3(a) (Colorado)" — which is not a subsection designator.
  // Designators are short case-runs ("iv", "A", "aa", "12"), never
  // capitalized words, so cut the run at the first proper noun.
  const properNoun = segments.findIndex((segment) =>
    /^[A-Z][a-z]{2,}$/.test(segment),
  );
  const designators =
    properNoun >= 0 ? segments.slice(0, properNoun) : segments;
  if (designators.length === 0) return null;
  return designators.every((segment) => /^[\w.-]+$/.test(segment))
    ? designators
    : null;
}

export function axiomAppUrlForCitation(
  fileLegalId: string,
  citation: string | null | undefined,
): string | null {
  const base = axiomAppUrl(fileLegalId);
  if (!base || !citation) return base;
  const segments = citationTailSegments(
    base.split("/").filter(Boolean),
    citation,
  );
  if (!segments) return base;
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

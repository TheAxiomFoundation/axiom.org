/**
 * Deep links from a section page into the rule-graph viewer — now a
 * first-class in-app surface at /graph (the F3 promise). The viewer
 * accepts ?program=<jurisdiction>/<program_id> to select a program
 * and ?focus=<fileLegalId prefix> to pre-select the rules derived
 * from the provision the reader came from. NEXT_PUBLIC_GRAPH_VIEWER_URL
 * still overrides to an external deployment when set.
 *
 * Pure module: safe to import from client components.
 */

function viewerBase(): string {
  const override = process.env.NEXT_PUBLIC_GRAPH_VIEWER_URL;
  return override ? override.replace(/\/$/, "") : "/app";
}

const CITATION_TO_REPO_BUCKET: Readonly<Record<string, string>> =
  Object.freeze({
    statute: "statutes",
    regulation: "regulations",
    policy: "policies",
  });

/**
 * Engine fileLegalId prefix for a corpus citation path:
 * ``us/statute/7/2017`` → ``us:statutes/7/2017``. Mirrors the repo
 * naming rules (plural buckets; federal-regulation titles carry the
 * ``-cfr`` suffix the corpus drops).
 */
export function graphFocusForCitationPath(
  citationPath: string
): string | null {
  const segments = citationPath.split("/").filter(Boolean);
  if (segments.length < 3) return null;
  const [slug, docType, ...rest] = segments;
  const bucket = CITATION_TO_REPO_BUCKET[docType] ?? docType;
  if (
    slug === "us" &&
    docType === "regulation" &&
    rest[0] &&
    !rest[0].endsWith("-cfr")
  ) {
    rest[0] = `${rest[0]}-cfr`;
  }
  return `${slug}:${bucket}/${rest.join("/")}`;
}

/**
 * Full legal ID for one rule: repo file path (already bucket-rooted,
 * ``-cfr`` included where applicable) + ``#`` + rule name. This is
 * the ``?focus=`` form that selects a single node in the viewer.
 */
export function ruleGraphFocus(
  jurisdictionSlug: string,
  filePath: string,
  ruleName: string
): string {
  return `${jurisdictionSlug}:${filePath.replace(/\.yaml$/, "")}#${ruleName}`;
}

/** File legal id for a repo file path: ``regulations/47-cfr/54/403.yaml``
 *  under ``us`` → ``us:regulations/47-cfr/54/403``. */
export function fileGraphFocus(
  jurisdictionSlug: string,
  filePath: string
): string {
  return `${jurisdictionSlug}:${filePath.replace(/\.yaml$/, "")}`;
}

/**
 * Viewer deep link for law that is encoded but not inside any compiled
 * program package: the viewer asks the API to compose the graph on
 * demand from the encodings mirror (`?compose=`). ``focus`` is a file
 * or rule legal id from fileGraphFocus/ruleGraphFocus.
 */
export function composeGraphViewerUrl(focus: string): string {
  return `${viewerBase()}?compose=${encodeURIComponent(focus)}`;
}

// axiom.org serves the builder at /gallery/builder through a vercel.json
// rewrite; links name that address, not the builder's Vercel host.
const DEFAULT_BUILDER_BASE = "https://axiom.org/gallery/builder";

/**
 * Deep link into the dashboard builder with this rule preselected as
 * an output — "use this encoding in a calculator". The builder
 * resolves which curated program contains the rule, so no program
 * coordinates are needed here.
 */
export function builderUrlForRule(ruleLegalId: string): string {
  const base = (
    process.env.NEXT_PUBLIC_BUILDER_URL ?? DEFAULT_BUILDER_BASE
  ).replace(/\/$/, "");
  return `${base}/?output=${encodeURIComponent(ruleLegalId)}`;
}

export function graphViewerUrl(
  program: { jurisdiction: string; programId: string },
  focus: string | null
): string {
  const params = new URLSearchParams();
  const country = program.jurisdiction.split("-")[0];
  if (country && country !== "us") params.set("country", country);
  params.set("program", `${program.jurisdiction}/${program.programId}`);
  if (focus) params.set("focus", focus);
  return `${viewerBase()}?${params.toString()}`;
}

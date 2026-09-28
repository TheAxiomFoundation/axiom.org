/**
 * Read-the-law sweep: verify that every node of real composed modules
 * produces a working, focused "Read the law" link.
 *
 * For each module: fetch its composed graph from a running dev server,
 * run every rule and input through readableLawTarget + axiomAppUrlForCitation
 * (the exact inspector code path), then fetch the resulting reader URL and
 * assert it renders (not a 404) and, when a rule is spotlighted, that the
 * rule's card is present in the rendered rail.
 *
 * Run against a dev server with live Supabase credentials:
 *   bunx tsx scripts/read-the-law-sweep.mts
 *   SWEEP_BASE=http://localhost:3001 bunx tsx scripts/read-the-law-sweep.mts
 *
 * This is a live-data check, not a vitest suite: it exists to catch gaps the
 * unit fixtures can't — nodes shaped in ways we didn't anticipate. Add any
 * module a user reports a broken link in.
 */
import {
  readableLawTarget,
  axiomAppUrlForCitation,
} from "../src/components/axiom/graph-viewer/citations";

const MODULES = [
  "us:statutes/26/21",
  "us:statutes/26/22",
  "us:statutes/26/32",
  "us:statutes/7/2014/a",
  "us-ny:regulations/18-nycrr/387/14/a/5",
  "us-ak:policies/dpa/apa/standards/2026/state-supplement-payment-standard",
  "us-co:regulations/10-ccr-2506-1/4.110",
  // CAPI: corpus holds MPP 49-025 as one flat provision (no child
  // anchors), so its links are file-level by necessity — the sweep
  // verifies they still render with the rule spotlighted.
  "us-ca:regulations/cdss/eas/49/49-025",
];

const base = process.env.SWEEP_BASE ?? "http://localhost:3000";
let checked = 0;
const problems: string[] = [];

for (const mod of MODULES) {
  const res = await fetch(
    `${base}/api/axiom/graph/compose?focus=${encodeURIComponent(mod)}`
  );
  if (!res.ok) {
    problems.push(`COMPOSE FAIL ${mod} (${res.status})`);
    continue;
  }
  const graph = (await res.json()).data.graph;
  const rules: any[] = graph.rules ?? [];
  const inputs: any[] = graph.inputs ?? [];
  const consumersOf = (id: string) =>
    rules.filter(
      (r) => (r.ruleDeps ?? []).includes(id) || (r.inputDeps ?? []).includes(id)
    );

  const nodes = [
    ...rules.map((r) => ({ legalId: r.legalId, source: r.source, isQuestion: false })),
    ...inputs.map((i) => ({ legalId: i.legalId, source: null, isQuestion: true })),
  ];
  for (const node of nodes) {
    checked++;
    const target = readableLawTarget({
      legalId: node.legalId,
      ruleSource: node.source,
      citation: node.source,
      isQuestion: node.isQuestion,
      consumers: consumersOf(node.legalId),
    });
    const name = node.legalId?.split("#").pop();
    if (!target) {
      // A node with no readable home anywhere is allowed (pure package
      // math with no law behind it) — but flag it so additions get eyes.
      problems.push(`NO TARGET  ${mod} # ${name}`);
      continue;
    }
    const href = axiomAppUrlForCitation(target.fileLegalId, target.citation);
    if (!href) {
      problems.push(`NO HREF    ${mod} # ${name}`);
      continue;
    }
    const url = `${base}${href}?embed=1${
      target.ruleName ? `&rule=${encodeURIComponent(target.ruleName)}` : ""
    }`;
    const page = await fetch(url);
    const body = await page.text();
    // Next renders soft 404s with 200s; the reader's real pages always
    // carry provision markup while the not-found page never does.
    const renders404 =
      !body.includes("citation_path") &&
      body.includes("could not be found") &&
      !body.includes("IN VIEW");
    if (!page.ok || renders404) {
      problems.push(`DEAD LINK  ${href}  (${mod} # ${name})`);
      continue;
    }
    if (target.ruleName && !body.includes(target.ruleName)) {
      problems.push(`NO SPOTLIGHT ${href}  rule=${target.ruleName}`);
    }
  }
}

console.log(`checked=${checked} problems=${problems.length}`);
for (const p of problems) console.log(" ", p);
if (problems.length > 0) process.exit(1);

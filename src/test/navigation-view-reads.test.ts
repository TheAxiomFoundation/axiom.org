import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NAVIGATION_NODES_VIEW } from "@/lib/axiom/navigation-index/table";

const ROOT = process.cwd();
const SCANNED = ["src", "scripts"];
/** The parser kind of each JS and TS suffix, as TypeScript picks it: .ts,
 *  .mts and .cts parse as TS (type assertions, no JSX), .tsx as TSX, and
 *  .js, .mjs and .cjs as JS, which admits JSX as .jsx does. */
const SCRIPT_KINDS = new Map<string, ts.ScriptKind>([
  [".ts", ts.ScriptKind.TS],
  [".mts", ts.ScriptKind.TS],
  [".cts", ts.ScriptKind.TS],
  [".tsx", ts.ScriptKind.TSX],
  [".js", ts.ScriptKind.JS],
  [".mjs", ts.ScriptKind.JS],
  [".cjs", ts.ScriptKind.JS],
  [".jsx", ts.ScriptKind.JSX],
]);
/** Python and shell scripts, which the check reads as plain text. */
const TEXT_SUFFIXES = new Set([".py", ".sh"]);
const TEST_RE = /\.test\.[cm]?[jt]sx?$/;
const TABLE_RE = /(?<![A-Za-z0-9_])navigation_nodes(?![A-Za-z0-9_])/;

/** Whether the check reads a file of this name: a JS, TS, Python or shell
 *  source that is not a JS or TS test file. */
function scanned(name: string): boolean {
  const suffix = extname(name);
  return (
    (SCRIPT_KINDS.has(suffix) || TEXT_SUFFIXES.has(suffix)) &&
    !TEST_RE.test(name)
  );
}

/** Scanned sources under src/ and scripts/, as paths from the repo root. */
function sources(dir?: string): string[] {
  if (dir === undefined) {
    return SCANNED.flatMap((top) => sources(join(ROOT, top)));
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return scanned(entry.name) ? [relative(ROOT, path)] : [];
  });
}

const text = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Lines of `file` that name the `navigation_nodes` table as a whole word.
 *  In a JS or TS source that means a string or template literal: the bare
 *  name, a qualified `corpus.navigation_nodes`, or a REST path. Comments
 *  are not literals, so a comment that names the table does not count.
 *  Python and shell scripts have no parser here, so any mention counts,
 *  comments included. */
function tableLines(file: string, code = text(file)): number[] {
  const kind = SCRIPT_KINDS.get(extname(file));
  if (kind === undefined) {
    return code
      .split("\n")
      .flatMap((line, index) => (TABLE_RE.test(line) ? [index + 1] : []));
  }
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      TABLE_RE.test(node.text)
    ) {
      lines.push(
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

// Once a pair serves a base scope, a direct navigation_nodes read returns
// each row's stored per-scope tree fields, so a primary section whose title
// exists only in the base lists as a top-level document. The
// corpus.current_navigation_nodes view serves the merged tree (axiom-corpus
// #779, Deployment item 5). Reads in src/ name it through
// NAVIGATION_NODES_VIEW (lib/axiom/navigation-index/table.ts);
// scripts/collect-program-bundles.mjs names the view itself. This check
// covers the JS, TS, Python and shell sources under src/ and scripts/. It
// is a tripwire for a new read that names the table, not a proof: a name
// built at run time gets past it.
describe("navigation view reads", () => {
  it("the scan reaches every file that reads the navigation index", () => {
    expect(sources()).toEqual(
      expect.arrayContaining([
        "src/lib/axiom/navigation-index/read.ts",
        "src/lib/axiom/section-page.ts",
        "src/lib/axiom/coverage-page.ts",
        "src/lib/supabase.ts",
        "src/lib/corpus-status.ts",
        "scripts/collect-program-bundles.mjs",
      ]),
    );
  });

  it("the scan reaches the scripts in each other format scripts/ holds", () => {
    expect(sources()).toEqual(
      expect.arrayContaining([
        "scripts/read-the-law-sweep.mts",
        "scripts/journey-pacing.cjs",
        "scripts/check-encoder-record-reference.py",
        "scripts/generate-wordmark.sh",
      ]),
    );
  });

  it("the scan reads every JS, TS, Python and shell suffix and skips tests", () => {
    const names = [
      "a.ts",
      "a.tsx",
      "a.mts",
      "a.cts",
      "a.js",
      "a.jsx",
      "a.mjs",
      "a.cjs",
      "a.py",
      "a.sh",
      "a.test.ts",
      "a.test.tsx",
      "a.test.mts",
      "a.test.cts",
      "a.test.js",
      "a.test.jsx",
      "a.test.mjs",
      "a.test.cjs",
      "a.json",
      "a.md",
      "a.css",
    ];
    expect(names.filter(scanned)).toEqual([
      "a.ts",
      "a.tsx",
      "a.mts",
      "a.cts",
      "a.js",
      "a.jsx",
      "a.mjs",
      "a.cjs",
      "a.py",
      "a.sh",
    ]);
  });

  it("no scanned source names the navigation_nodes table", () => {
    const offenders = sources().flatMap((file) =>
      tableLines(file).map((line) => `${file}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the shared name is the served view", () => {
    expect(NAVIGATION_NODES_VIEW).toBe("current_navigation_nodes");
  });

  it("the check sees the table name in every quote style and skips comments", () => {
    const probe = (code: string) => tableLines("probe.ts", code).length > 0;
    expect(probe('db.from("navigation_nodes");')).toBe(true);
    expect(probe("db.from('navigation_nodes');")).toBe(true);
    expect(probe("db.from(`navigation_nodes`);")).toBe(true);
    expect(probe('read(config, "corpus", "navigation_nodes", {});')).toBe(true);
    expect(
      probe(
        '// reads navigation_nodes directly\n/* "navigation_nodes" */ db.from(VIEW);',
      ),
    ).toBe(false);
    expect(probe('db.from("corpus.navigation_nodes");')).toBe(true);
    expect(
      probe("fetch(`${config.url}/rest/v1/navigation_nodes?select=path`);"),
    ).toBe(true);
    expect(probe('db.from("current_navigation_nodes");')).toBe(false);
    expect(probe('const column = "navigation_nodes_count";')).toBe(false);
  });

  it("each JS and TS suffix parses with its own syntax", () => {
    // A type assertion parses only as TS; a fragment only where JSX is on.
    const assertion = 'const t = <string>db.from("navigation_nodes");';
    const fragment = 'const el = <></>; db.from("navigation_nodes");';
    for (const suffix of [".ts", ".mts", ".cts"]) {
      expect(tableLines(`probe${suffix}`, assertion), suffix).toEqual([1]);
    }
    for (const suffix of [".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(tableLines(`probe${suffix}`, fragment), suffix).toEqual([1]);
    }
  });

  it("the check reads Python and shell scripts as plain text", () => {
    expect(
      tableLines("probe.py", 'rows = get(f"{url}/rest/v1/navigation_nodes")'),
    ).toEqual([1]);
    expect(
      tableLines("probe.sh", 'curl "$URL/rest/v1/navigation_nodes?select=path"'),
    ).toEqual([1]);
    expect(tableLines("probe.sh", "# reads navigation_nodes")).toEqual([1]);
    expect(tableLines("probe.py", 'view = "current_navigation_nodes"')).toEqual(
      [],
    );
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NAVIGATION_NODES_VIEW } from "@/lib/axiom/navigation-index/table";

const ROOT = process.cwd();
const SCANNED = ["src", "scripts"];
const SOURCE_RE = /\.(?:tsx?|jsx?|mjs)$/;
const TEST_RE = /\.test\.(?:tsx?|jsx?|mjs)$/;
const TABLE_RE = /(?<![A-Za-z0-9_])navigation_nodes(?![A-Za-z0-9_])/;

/** Non-test sources under src/ and scripts/, as paths from the repo root. */
function sources(dir?: string): string[] {
  if (dir === undefined) {
    return SCANNED.flatMap((top) => sources(join(ROOT, top)));
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return SOURCE_RE.test(entry.name) && !TEST_RE.test(entry.name)
      ? [relative(ROOT, path)]
      : [];
  });
}

const text = (file: string) => readFileSync(join(ROOT, file), "utf8");

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.m?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Lines of `code` holding a string or template literal that names the
 *  `navigation_nodes` table as a whole word: the bare name, a qualified
 *  `corpus.navigation_nodes`, or a REST path. Comments are not literals,
 *  so a comment that names the table does not count. */
function tableLiterals(file: string, code = text(file)): number[] {
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
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
// #779, Deployment item 5). Every read names it through NAVIGATION_NODES_VIEW
// (lib/axiom/navigation-index/table.ts). This check is a tripwire for a new
// read that names the table, not a proof: a name built at run time gets past
// it.
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

  it("no non-test source names the navigation_nodes table in a string", () => {
    const offenders = sources().flatMap((file) =>
      tableLiterals(file).map((line) => `${file}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the shared name is the served view", () => {
    expect(NAVIGATION_NODES_VIEW).toBe("current_navigation_nodes");
  });

  it("the check sees the table name in every quote style and skips comments", () => {
    const probe = (code: string) => tableLiterals("probe.ts", code).length > 0;
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
});

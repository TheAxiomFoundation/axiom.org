import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NAVIGATION_NODES_VIEW } from "@/lib/axiom/navigation-index/table";

const SRC = join(process.cwd(), "src");
const SOURCE_RE = /\.(?:tsx?|jsx?|mjs)$/;
const TEST_RE = /\.test\.(?:tsx?|jsx?|mjs)$/;

/** Non-test sources under `dir`, as paths under src/. */
function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return SOURCE_RE.test(entry.name) && !TEST_RE.test(entry.name)
      ? [relative(SRC, path)]
      : [];
  });
}

const text = (file: string) => readFileSync(join(SRC, file), "utf8");

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.m?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Lines of `code` holding a string literal that is exactly
 *  `navigation_nodes`, in any quote style. Comments are not literals,
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
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === "navigation_nodes"
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
    expect(probe('db.from("current_navigation_nodes");')).toBe(false);
  });
});

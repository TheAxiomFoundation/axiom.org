import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

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

/** Whether `code` sets dangerouslySetInnerHTML on a JSX <script>,
 *  however the HTML it passes was built. */
function writesRawScript(file: string, code = text(file)): boolean {
  const source = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    false,
    /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = (node: ts.Node): boolean => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(source) === "script" &&
      node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(source) === "dangerouslySetInnerHTML",
      )
    ) {
      return true;
    }
    return ts.forEachChild(node, found) ?? false;
  };
  return found(source);
}

// The 2026-10-22 review found both readers writing JSON.stringify output
// into a JSON-LD script, which a reader URL could close. The rule since:
// every inline script with markup-set content goes through
// components/json-ld.tsx, whose serializer escapes `<` (proved by the
// property tests in lib/json-ld.test.ts and components/json-ld.test.tsx).
// These checks are a tripwire for that rule, not a proof: a script built
// with createElement or written outside JSX would get past them.
describe("JSON-LD sinks", () => {
  it("only components/json-ld.tsx sets a <script>'s HTML", () => {
    expect(sources().filter((file) => writesRawScript(file))).toEqual([
      "components/json-ld.tsx",
    ]);
  });

  it("only components/json-ld.tsx names the ld+json type", () => {
    expect(sources().filter((file) => text(file).includes("ld+json"))).toEqual([
      "components/json-ld.tsx",
    ]);
  });

  it("the AST check sees a raw script however its HTML is built", () => {
    const probe = (code: string) => writesRawScript("probe.tsx", code);
    expect(probe('const raw = JSON.stringify(d); const a = <script type={"application/" + "ld+json"} dangerouslySetInnerHTML={{ __html: raw }} />;')).toBe(true);
    expect(probe("const a = <script dangerouslySetInnerHTML={{ __html: `x=${JSON.stringify(d)}` }}></script>;")).toBe(true);
    expect(probe('const a = <div dangerouslySetInnerHTML={{ __html: html }} />;')).toBe(false);
  });
});

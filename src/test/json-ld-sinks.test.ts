import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/** Non-test TypeScript sources under `dir`, as paths under src/. */
function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [relative(SRC, path)]
      : [];
  });
}

const text = (file: string) => readFileSync(join(SRC, file), "utf8");

// The 2026-10-22 review found both readers writing JSON.stringify output
// into a JSON-LD script, which a reader URL could close. Every JSON-LD
// block goes through components/json-ld.tsx, whose serializer escapes `<`.
describe("JSON-LD sinks", () => {
  it("only components/json-ld.tsx writes an application/ld+json script", () => {
    const writers = sources().filter((file) => text(file).includes("application/ld+json"));
    expect(writers).toEqual(["components/json-ld.tsx"]);
  });

  it("no source hands raw JSON.stringify output to dangerouslySetInnerHTML", () => {
    const raw = sources().filter((file) =>
      /__html:\s*JSON\.stringify\(/.test(text(file)),
    );
    expect(raw).toEqual([]);
  });
});

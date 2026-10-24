import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOCK_POLICYBENCH_EXPORT } from "../src/test/aspen-free-plan-export.mock";
import { parseArgs, run } from "./aspen-free-plan";

const SHA = "a".repeat(64);

describe("parseArgs", () => {
  it("reads the export, its sha256, the models and --write in any order", () => {
    expect(parseArgs(["x.json", "--sha256", SHA, "--models", "a, b,,c"])).toEqual({ file: "x.json", sha256: SHA, models: ["a", "b", "c"], write: false });
    expect(parseArgs(["--write", "--models", "a", "--sha256", SHA, "x.json"]).write).toBe(true);
  });

  it("refuses missing arguments, a second export, an unknown flag and a bad sha256", () => {
    expect(() => parseArgs(["x.json", "--sha256", SHA])).toThrow(/^usage:/);
    expect(() => parseArgs(["x.json", "--models", "a"])).toThrow(/^usage:/);
    expect(() => parseArgs(["--sha256", SHA, "--models", "a"])).toThrow(/^usage:/);
    expect(() => parseArgs(["x.json", "--sha256", SHA, "--models", ""])).toThrow(/^usage:/);
    expect(() => parseArgs(["x.json", "y.json", "--sha256", SHA, "--models", "a"])).toThrow("one export at a time");
    expect(() => parseArgs(["x.json", "--sha256", SHA, "--models", "a", "--force"])).toThrow("unknown flag --force");
    expect(() => parseArgs(["x.json", "--sha256", "ABC", "--models", "a"])).toThrow("--sha256 ABC isn't a sha256");
  });
});

describe("run", () => {
  let dir: string;
  let file: string;
  let sha: string;
  let content: string;
  const before = "head\n// BEGIN FREE_PLAN_PILOT: x\nexport const FREE_PLAN_PILOT: FreePlanPilot | null = null;\n// END FREE_PLAN_PILOT\ntail\n";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aspen-free-plan-"));
    file = join(dir, "free-plan-mock.json");
    const bytes = JSON.stringify(MOCK_POLICYBENCH_EXPORT);
    writeFileSync(file, bytes);
    sha = createHash("sha256").update(bytes).digest("hex");
    content = join(dir, "content.ts");
    writeFileSync(content, before);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses an export whose sha256 isn't the one sent", () => {
    expect(() => run([file, "--sha256", SHA, "--models", "mock-a"], { contentPath: content, log: () => {} })).toThrow(
      `free-plan-mock.json has sha256 ${sha}, not ${SHA}`,
    );
  });

  it("prints the rows, each model's free-plan basis and the warnings, and writes nothing without --write", () => {
    const lines: string[] = [];
    run([file, "--sha256", sha, "--models", "mock-c,mock-a"], { contentPath: content, log: (l) => lines.push(l) });
    expect(lines).toEqual([
      "The models on free plans, with web search and with the tool",
      "  Mock model A (On Mock Free): alone 10/48, web 15/48, tool 38/48, both 39/48; tool vs alone 58.3 [43.333333333333336, 73.33333333333334]",
      "  Mock model C: alone 30/48, web 33/48, tool 44/48, both 45/48; tool vs alone 29.2 [14.166666666666668, 44.16666666666667]",
      `Caveat, for these models: ${MOCK_POLICYBENCH_EXPORT.caveat}`,
      "Free-plan basis, for the presenter:",
      "  Mock model C: MOCK: a comparison model",
      "  Mock model A: MOCK: the default on Mock Free",
      "Warnings:",
      "  benefit amounts: at most 3 per model, too few to say anything about benefits",
      "Not written; pass --write to put this in content.ts.",
    ]);
    expect(readFileSync(content, "utf8")).toBe(before);
  });

  it("with --write, puts the slide's data and where it came from in content.ts", () => {
    const lines: string[] = [];
    run([file, "--sha256", sha, "--models", "mock-a", "--write"], { contentPath: content, log: (l) => lines.push(l) });
    expect(lines.at(-1)).toBe("Wrote 1 models into content.ts.");
    const written = readFileSync(content, "utf8");
    expect(written).toContain(`// PolicyBench free-plan pilot export free-plan-mock.json, sha256 ${sha}.\n`);
    expect(written).toContain("// Generated 2026-10-24T03:30:00Z by aspen_export.py at 0000000mock; models mock-a.\n");
    expect(written).toContain('"model": "Mock model A"');
    expect(written.startsWith("head\n// BEGIN FREE_PLAN_PILOT")).toBe(true);
    expect(written.endsWith("// END FREE_PLAN_PILOT\ntail\n")).toBe(true);
  });

  it("prints PolicyBench's tool line for the presenter when the export has one", () => {
    const bytes = JSON.stringify({ ...MOCK_POLICYBENCH_EXPORT, tool: "MOCK: the tool line" });
    writeFileSync(file, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const lines: string[] = [];
    run([file, "--sha256", digest, "--models", "mock-a"], { contentPath: content, log: (l) => lines.push(l) });
    expect(lines).toContain("PolicyBench's tool line: MOCK: the tool line");
  });

  it("says when the export doesn't record where it came from", () => {
    const bytes = JSON.stringify({ ...MOCK_POLICYBENCH_EXPORT, source: undefined });
    writeFileSync(file, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    run([file, "--sha256", digest, "--models", "mock-a", "--write"], { contentPath: content, log: () => {} });
    expect(readFileSync(content, "utf8")).toContain("// Generated at an unrecorded time by aspen_export.py at an unrecorded commit; models mock-a.\n");
  });
});

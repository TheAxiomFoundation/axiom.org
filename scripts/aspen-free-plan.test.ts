import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOCK_POLICYBENCH_EXPORT, MOCK_WEB_SEARCH_AUDIT } from "../src/test/aspen-free-plan-export.mock";
import { parseArgs, run } from "./aspen-free-plan";

const SHA = "a".repeat(64);

describe("parseArgs", () => {
  it("reads the export, its sha256, the models and --write in any order", () => {
    expect(parseArgs(["x.json", "--sha256", SHA, "--models", "a, b,,c"])).toEqual({ file: "x.json", sha256: SHA, models: ["a", "b", "c"], write: false });
    expect(parseArgs(["--write", "--models", "a", "--sha256", SHA, "x.json"]).write).toBe(true);
  });

  it("reads a web-search audit with its sha256", () => {
    const sha2 = "b".repeat(64);
    expect(parseArgs(["x.json", "--sha256", SHA, "--models", "a", "--web-audit", "w.json", "--web-audit-sha256", sha2]).webAudit).toEqual({ file: "w.json", sha256: sha2 });
    expect(parseArgs(["x.json", "--sha256", SHA, "--models", "a"]).webAudit).toBeUndefined();
    expect(() => parseArgs(["x.json", "--sha256", SHA, "--models", "a", "--web-audit", "w.json"])).toThrow("--web-audit and --web-audit-sha256 go together");
    expect(() => parseArgs(["x.json", "--sha256", SHA, "--models", "a", "--web-audit-sha256", sha2])).toThrow("--web-audit and --web-audit-sha256 go together");
    expect(() => parseArgs(["x.json", "--sha256", SHA, "--models", "a", "--web-audit", "w.json", "--web-audit-sha256", "XYZ"])).toThrow(
      "--web-audit-sha256 XYZ isn't a sha256",
    );
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
      "The models on free plans, with and without the PolicyEngine tool",
      "  Mock model A (On Mock Free): web 15/48, both 39/48; adding the tool 50.0 [35, 65]",
      "  Mock model C: web 33/48, both 45/48; adding the tool 25.0 [10, 40]",
      `Caveat, for these models: ${MOCK_POLICYBENCH_EXPORT.caveat}`,
      "Footnotes, run in after the caveat:",
      "  Web search is each provider's own search tool, told not to search PolicyBench.",
      "  The tool runs PolicyEngine (policyengine-us 0.0.0-mock), the engine behind the reference answers, so this shows whether a model can use it, not whether it's right.",
      "Free-plan basis, for the presenter:",
      "  Mock model C: MOCK: a comparison model",
      "  Mock model A: MOCK: the default on Mock Free",
      "Warnings:",
      "  benefit amounts: at most 3 per model, too few to say anything about benefits",
      "  no web-search audit given, so the slide doesn't say whether a model searched for PolicyBench; pass --web-audit",
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

  describe("with a web-search audit", () => {
    let auditFile: string;
    /** Writes the audit, of the mock export unless told otherwise, and returns its sha256. */
    const writeAudit = (change: (a: typeof MOCK_WEB_SEARCH_AUDIT) => unknown = (a) => a) => {
      const bytes = JSON.stringify(change({ ...MOCK_WEB_SEARCH_AUDIT, export: { file: "free-plan-mock.json", sha256: sha } }));
      writeFileSync(auditFile, bytes);
      return createHash("sha256").update(bytes).digest("hex");
    };
    beforeEach(() => {
      auditFile = join(dir, "web-search-audit.json");
    });

    it("checks it, prints its scan for the presenter, and records it with --write", () => {
      const auditSha = writeAudit();
      const lines: string[] = [];
      run([file, "--sha256", sha, "--models", "mock-a", "--web-audit", auditFile, "--web-audit-sha256", auditSha, "--write"], { contentPath: content, log: (l) => lines.push(l) });
      expect(lines).toContain("PolicyBench's scan for these households' answers: MOCK: no mock household's answers were found");
      expect(lines).toContain("Why the audit doesn't rule out a copy elsewhere: MOCK: a scan can't show there's no copy anywhere");
      expect(lines.some((l) => l.includes("no web-search audit given"))).toBe(false);
      expect(readFileSync(content, "utf8")).toContain(`// Web-search audit web-search-audit.json, sha256 ${auditSha}, generated 2026-10-24T06:00:00Z at 0000000mock.\n`);
    });

    it("gives the presenter the release assets' dates, not the slide, when a model on it searched for PolicyBench", () => {
      const auditSha = writeAudit((a) => ({ ...a, models: { ...a.models, "mock-a": { ...a.models["mock-a"], web: { ...a.models["mock-a"].web!, policyBenchQueries: 1, policyBenchHouseholds: ["mt_01"] } } } }));
      const lines: string[] = [];
      run([file, "--sha256", sha, "--models", "mock-a", "--web-audit", auditFile, "--web-audit-sha256", auditSha], { contentPath: content, log: (l) => lines.push(l) });
      expect(lines).toContain("  Mock model A searched for it anyway in 1 of 20 households; a scan of PolicyBench's public repository found no match for these households' answers.");
      expect(lines.slice(lines.indexOf("Warnings:") + 1)).toContain(
        "  PolicyBench's release assets are checked by date, not read: the newest was updated September 30, 2026, before the references were generated October 3, 2026; the slide doesn't say so",
      );
      expect(readFileSync(content, "utf8")).toBe(before);
    });

    it("refuses an audit whose sha256 isn't the one sent, or one of another export", () => {
      writeAudit();
      expect(() => run([file, "--sha256", sha, "--models", "mock-a", "--web-audit", auditFile, "--web-audit-sha256", SHA], { contentPath: content, log: () => {} })).toThrow(
        /^web-search-audit\.json has sha256 [0-9a-f]{64}, not a{64}$/,
      );
      const other = writeAudit((a) => ({ ...a, export: { sha256: "c".repeat(64) } }));
      expect(() => run([file, "--sha256", sha, "--models", "mock-a", "--web-audit", auditFile, "--web-audit-sha256", other], { contentPath: content, log: () => {} })).toThrow(
        `web-search-audit.json audits export ${"c".repeat(64)}, not free-plan-mock.json (${sha})`,
      );
      expect(readFileSync(content, "utf8")).toBe(before);
    });
  });

  it("says when the export doesn't record where it came from", () => {
    const bytes = JSON.stringify({ ...MOCK_POLICYBENCH_EXPORT, source: undefined });
    writeFileSync(file, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    run([file, "--sha256", digest, "--models", "mock-a", "--write"], { contentPath: content, log: () => {} });
    expect(readFileSync(content, "utf8")).toContain("// Generated at an unrecorded time by aspen_export.py at an unrecorded commit; models mock-a.\n");
  });
});

// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSupabaseRows: vi.fn(), getSupabaseRestConfig: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/lib/corpus-status", () => ({
  readSupabaseRows: mocks.readSupabaseRows,
  getSupabaseRestConfig: mocks.getSupabaseRestConfig,
}));

const row = {
  global_id: "us:x",
  repo: "rulespec-us",
  jurisdiction: "us",
  entry_id: "x",
  program: null,
  status: "open",
  question: "q",
  reading: "r",
  basis: null,
  alternatives: [],
  ruling: null,
  citation_paths: ["us/statute/42/403/f/1"],
  pending_citations: [],
  adopted_by: [{ module: "us/statutes/42/403/f", interpretation: "i" }],
  source_url: "https://github.com/TheAxiomFoundation/rulespec-us/blob/main/known-source-conflicts.yaml",
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getSupabaseRestConfig.mockReturnValue({ url: "https://x.supabase.co", anonKey: "anon" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("matches the table's conflicts to paths and modules", async () => {
  mocks.readSupabaseRows.mockResolvedValue([row]);
  const { conflictsForCitationPaths, conflictsForModules } = await import("./source-conflicts");
  const byPath = await conflictsForCitationPaths(["us/statute/42/403/f", "us/statute/26/32"]);
  expect(Object.keys(byPath)).toEqual(["us/statute/42/403/f"]);
  expect(byPath["us/statute/42/403/f"][0]).toMatchObject({ globalId: "us:x", id: "x" });
  expect(Object.keys(await conflictsForModules(["us/statutes/42/403/f.yaml"]))).toEqual(["us/statutes/42/403/f.yaml"]);
  expect(mocks.readSupabaseRows.mock.calls[0].slice(1, 3)).toEqual(["encodings", "source_conflicts"]);
});

it("returns {} and warns once when the table is missing", async () => {
  mocks.readSupabaseRows.mockRejectedValue(new Error("Supabase returned 404 for encodings.source_conflicts"));
  const { conflictsForCitationPaths } = await import("./source-conflicts");
  expect(await conflictsForCitationPaths(["us/statute/42/403/f"])).toEqual({});
  expect(await conflictsForCitationPaths(["us/statute/42/403/f"])).toEqual({});
  expect(console.warn).toHaveBeenCalledTimes(1);
});

it("reads the collector's dry-run file in development", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "source-conflicts-")), "out.json");
  writeFileSync(file, JSON.stringify({ collected_at: "2026-11-06T00:00:00Z", counts: { "rulespec-us": 1 }, rows: [row] }));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AXIOM_SOURCE_CONFLICTS_FILE", file);
  const { conflictsForCitationPaths } = await import("./source-conflicts");
  const result = await conflictsForCitationPaths(["us/statute/42/403/f/1/A"]);
  expect(result["us/statute/42/403/f/1/A"][0].globalId).toBe("us:x");
  expect(mocks.readSupabaseRows).not.toHaveBeenCalled();
});

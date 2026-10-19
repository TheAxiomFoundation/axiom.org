// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  createClient: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("node:fs", async (original) => ({
  ...await original<typeof import("node:fs")>(),
  readFileSync: io.readFileSync,
  writeFileSync: io.writeFileSync,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: io.createClient }));

const REPO = "TheAxiomFoundation/axiom-oracles";
const DATA = "dashboard/public/data";
const DATA_SHA = "a".repeat(40);
const MAIN_SHA = "b".repeat(40);
const ADVANCED_SHA = "c".repeat(40);
const REPORT_NAMES = ["axiom-policyengine-snap-ca.json", "axiom-policyengine-snap-ny.json"];
const DATE = "2026-10-14T12:00:00Z";
const OUTPUT = ".hub-scratch/oracle-collector-test.json";
const BUNDLE = ".hub-scratch/oracle-collector-bundle.json";
const COMPILE = ".hub-scratch/oracle-collector-compile.json";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Keep the collectors' joins and output code real. Only their external I/O is
// replaced; an accidental additional GitHub request fails the test.
function emptyDatabase() {
  const result = { data: [], error: null };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "not", "in", "or", "gte", "lt", "like", "range"])
    query[method] = vi.fn(() => query);
  for (const method of ["upsert", "insert", "update", "delete"])
    query[method] = vi.fn(() => { io.mutate(method); return query; });
  query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  const client = { from: vi.fn(() => query), schema: vi.fn() };
  client.schema.mockReturnValue(client);
  io.createClient.mockReturnValue(client);
}

type BranchStatus = number | "network";

function mockGithub(branchStatus: BranchStatus = 200, options: { mainStatus?: number; malformedJson?: boolean; storableRun?: boolean } = {}) {
  let resolutions = 0;
  const requests: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    if (url === `https://api.github.com/repos/${REPO}/branches/oracle-data`) {
      resolutions += 1;
      if (branchStatus === "network") throw new Error("connection lost resolving oracle-data");
      if (options.malformedJson) return new Response("{not-json", { status: 200 });
      // If the collector resolves again, the branch has advanced. Every
      // report and its provenance must still come from the first commit.
      return response({ commit: { sha: resolutions === 1 ? DATA_SHA : ADVANCED_SHA } }, branchStatus);
    }
    if (url === `https://api.github.com/repos/${REPO}/branches/main`)
      return response({ commit: { sha: MAIN_SHA } }, options.mainStatus);
    const pinned = branchStatus === 404 ? MAIN_SHA : DATA_SHA;
    if (url === `https://api.github.com/repos/${REPO}/contents/${DATA}?ref=${pinned}`) {
      return response(REPORT_NAMES.map((name) => ({
        type: "file", name, path: `${DATA}/${name}`,
        // A contents response can carry an old/default-branch URL. A pinned
        // collector constructs its raw URL instead of trusting this field.
        download_url: `https://raw.githubusercontent.com/${REPO}/main/${DATA}/${name}`,
      })));
    }
    if (REPORT_NAMES.some((name) => url === `https://raw.githubusercontent.com/${REPO}/${pinned}/${DATA}/${name}`)) {
      const state = url.includes("snap-ca.json") ? "ca" : "ny";
      return response({
        case_count: 2, aggregates: [{ concept: `us-${state}:policies/snap#eligible`, mismatch_count: 0 }],
        cases: [], mismatches: [], summary: { mismatch_count: 0 },
      });
    }
    if (REPORT_NAMES.some((name) => url === `https://api.github.com/repos/${REPO}/commits?sha=${pinned}&per_page=1&path=${encodeURIComponent(`${DATA}/${name}`)}`))
      return response([{ commit: { committer: { date: DATE } } }]);
    if (url === "https://pypi.org/pypi/policyengine-us/json")
      return response({ info: { version: "1.0.0" } });
    if (url.includes("/actions/workflows/targeted-signed-reencode.yml/runs?"))
      return response({ total_count: 1, workflow_runs: [{
        id: 42,
        display_title: options.storableRun
          ? "Targeted signed RuleSpec re-encode [adhoc:adhoc:adhoc] us-ca/policies/snap"
          : "Unrelated dispatch",
        status: "in_progress",
        created_at: DATE, updated_at: DATE, head_sha: null,
      }] });
    if (url === "https://api.github.com/graphql") {
      expect(init?.method).toBe("POST");
      return response({ data: { search: { issueCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } });
    }
    throw new Error(`Unexpected collector request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

const collectors = [
  {
    name: "program bundles",
    args: ["--out", OUTPUT, "--bundle", BUNDLE],
    run: () => import("./collect-program-bundles.mjs"),
    provenanceRequests: 2,
  },
  {
    name: "encoding pipeline",
    args: ["--out", OUTPUT, "--oracles", "--compile-sweep", COMPILE, "--run-detail-lookups", "0"],
    run: () => import("./collect-encoding-pipeline.mjs"),
    provenanceRequests: 0,
  },
];

const originalArgv = process.argv;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://collector-test.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "collector-test-key");
  vi.stubEnv("GITHUB_TOKEN", "collector-test-token");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code): never => { throw new Error(`process.exit(${code})`); });
  emptyDatabase();
  io.readFileSync.mockImplementation((path: string) => {
    if (path === COMPILE) return JSON.stringify({ generated_at: DATE, rows: [] });
    if (path !== BUNDLE) throw new Error(`Unexpected collector file read: ${path}`);
    return JSON.stringify({
      schema: "axiom-program-bundle/v2", program: "snap", title: "SNAP", as_of: "2026-10-14",
      tiers: [{ id: "screener" }, { id: "full" }],
      comparison: { repo: REPO, suite: "snap-{st}" },
      layers: ["us", "us-ca", "us-ny"].map((jurisdiction) => ({ jurisdiction, screener: [], full: [] })),
    });
  });
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

for (const collector of collectors) {
  describe(`${collector.name} oracle-data reads`, () => {
    beforeEach(() => { process.argv = [originalArgv[0], "collector", ...collector.args]; });

    for (const scenario of [
      { label: "oracle-data exists", status: 200, sha: DATA_SHA, branch: "oracle-data" },
      { label: "only main exists", status: 404, sha: MAIN_SHA, branch: "main" },
    ]) {
      it(`pins every report request to one SHA when ${scenario.label}, even if the branch advances`, async () => {
        const { requests } = mockGithub(scenario.status);
        const collect = await import("../src/lib/axiom/encoding-pipeline-collect");
        const verdicts = vi.spyOn(collect, "oracleVerdicts");
        await collector.run();

        const oracleRequests = requests.filter((url) => url.includes(REPO));
        expect(oracleRequests.filter((url) => url.endsWith("/branches/oracle-data"))).toHaveLength(1);
        expect(oracleRequests.filter((url) => url.endsWith("/branches/main"))).toHaveLength(scenario.status === 404 ? 1 : 0);
        const dataRequests = oracleRequests.filter((url) => !url.includes("/branches/"));
        expect(dataRequests.filter((url) => url.includes("/contents/"))).toEqual([
          `https://api.github.com/repos/${REPO}/contents/${DATA}?ref=${scenario.sha}`,
        ]);
        expect(dataRequests.filter((url) => url.includes("raw.githubusercontent.com"))).toEqual(
          REPORT_NAMES.map((name) => `https://raw.githubusercontent.com/${REPO}/${scenario.sha}/${DATA}/${name}`),
        );
        expect(dataRequests.filter((url) => url.includes("/commits?"))).toHaveLength(collector.provenanceRequests);
        expect(dataRequests.every((url) => url.includes(scenario.sha))).toBe(true);
        expect(dataRequests.join("\n")).not.toMatch(/\/main\/|ref=main|sha=main/);
        expect(dataRequests.join("\n")).not.toContain(ADVANCED_SHA);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(scenario.branch));
        expect(io.writeFileSync).toHaveBeenCalledTimes(1);
        expect(io.mutate).not.toHaveBeenCalled();

        if (collector.name === "program bundles") {
          const output = JSON.parse(String(io.writeFileSync.mock.calls[0][1]));
          const parity = output.bundles.filter((bundle: { jurisdiction: string }) => bundle.jurisdiction !== "us")
            .map((bundle: { parity: { report_url: string; generated_at: string; dated_by: string } }) => bundle.parity);
          expect(parity.map((value: { report_url: string }) => value.report_url)).toEqual(REPORT_NAMES.map((name) =>
            `https://github.com/${REPO}/blob/${scenario.sha}/${DATA}/${name}`));
          expect(parity).toEqual(expect.arrayContaining([expect.objectContaining({ generated_at: DATE, dated_by: "commit" })]));
        } else {
          expect(verdicts).toHaveBeenCalledTimes(1);
          const actual: ReturnType<typeof collect.oracleVerdicts> = verdicts.mock.results[0].value;
          expect(actual.size).toBe(3);
          for (const [index, state] of ["ca", "ny"].entries()) {
            expect(actual.get(`rulespec-us:us-${state}/policies/snap.yaml`)).toMatchObject({
              status: "match", report: REPORT_NAMES[index],
            });
          }
        }
      });
    }

    it.each<BranchStatus>([401, 403, 429, 500, "network"])("fails without writes or main fallback when resolution returns %s", async (status) => {
      const { requests } = mockGithub(status);
      await expect(collector.run()).rejects.toThrow();
      expect(requests.filter((url) => url.includes(REPO))).toEqual([
        `https://api.github.com/repos/${REPO}/branches/oracle-data`,
      ]);
      expect(io.writeFileSync).not.toHaveBeenCalled();
      expect(io.mutate).not.toHaveBeenCalled();
    });

    it("fails without writes when the missing branch's main fallback cannot resolve", async () => {
      const { requests } = mockGithub(404, { mainStatus: 500 });
      await expect(collector.run()).rejects.toThrow();
      expect(requests.filter((url) => url.includes(REPO))).toEqual([
        `https://api.github.com/repos/${REPO}/branches/oracle-data`,
        `https://api.github.com/repos/${REPO}/branches/main`,
      ]);
      expect(io.writeFileSync).not.toHaveBeenCalled();
      expect(io.mutate).not.toHaveBeenCalled();
    });

    it("fails without writes or fallback when the branch response is malformed JSON", async () => {
      const { requests } = mockGithub(200, { malformedJson: true });
      await expect(collector.run()).rejects.toThrow();
      expect(requests.filter((url) => url.includes(REPO))).toEqual([
        `https://api.github.com/repos/${REPO}/branches/oracle-data`,
      ]);
      expect(io.writeFileSync).not.toHaveBeenCalled();
      expect(io.mutate).not.toHaveBeenCalled();
    });

    describe("production writes", () => {
      beforeEach(() => {
        // Exercise the database-writing path, without the --out dry-run guard.
        process.argv = [originalArgv[0], "collector", ...collector.args.slice(2)];
      });

      it("reaches mocked database writes after successful resolution", async () => {
        mockGithub(200, { storableRun: true });
        await collector.run();

        expect(io.mutate).toHaveBeenCalledWith("upsert");
        expect(io.writeFileSync).not.toHaveBeenCalled();
      });

      it.each<BranchStatus>([403, 500, "network"])("aborts before database writes when resolution returns %s", async (status) => {
        const { requests } = mockGithub(status);
        await expect(collector.run()).rejects.toThrow();

        expect(requests.filter((url) => url.includes(REPO))).toEqual([
          `https://api.github.com/repos/${REPO}/branches/oracle-data`,
        ]);
        expect(io.mutate).not.toHaveBeenCalled();
        expect(io.writeFileSync).not.toHaveBeenCalled();
      });

      it("aborts before database writes when fallback resolution fails", async () => {
        const { requests } = mockGithub(404, { mainStatus: 500 });
        await expect(collector.run()).rejects.toThrow();

        expect(requests.filter((url) => url.includes(REPO))).toEqual([
          `https://api.github.com/repos/${REPO}/branches/oracle-data`,
          `https://api.github.com/repos/${REPO}/branches/main`,
        ]);
        expect(io.mutate).not.toHaveBeenCalled();
        expect(io.writeFileSync).not.toHaveBeenCalled();
      });
    });
  });
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKFLOWS,
  getWorkflowHealth,
  gradeWorkflow,
  readWorkflow,
  runsPageUrl,
  type WorkflowRead,
  type WorkflowSpec,
} from "./workflow-health";

vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));

const NOW = Date.parse("2026-10-14T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

function read(overrides: Partial<WorkflowRead> = {}): WorkflowRead {
  return {
    state: "active",
    last: { conclusion: "success", at: hoursAgo(2), url: "https://github.com/run/1" },
    running: null,
    week: { runs: 10, failed: 0, cancelled: 0 },
    ...overrides,
  };
}

describe("gradeWorkflow", () => {
  it("is ok when the last run passed and the week has no failures", () => {
    expect(gradeWorkflow({}, read(), NOW)).toEqual({ grade: "ok", reason: "Last run passed" });
    // Cancellations alone do not warn; only a cancelled last run does.
    expect(gradeWorkflow({}, read({ week: { runs: 10, failed: 0, cancelled: 3 } }), NOW).grade).toBe("ok");
  });

  it("warns on failures this week under a last run that passed", () => {
    expect(gradeWorkflow({}, read({ week: { runs: 10, failed: 3, cancelled: 0 } }), NOW)).toEqual({
      grade: "warning",
      reason: "3 failed in 7 days; the last run passed",
    });
  });

  it("warns when the last run was cancelled or ended another way", () => {
    const cancelled = read({ last: { conclusion: "cancelled", at: hoursAgo(1), url: "u" } });
    expect(gradeWorkflow({}, cancelled, NOW)).toEqual({ grade: "warning", reason: "Last run cancelled" });
    const approval = read({ last: { conclusion: "action_required", at: hoursAgo(1), url: "u" } });
    expect(gradeWorkflow({}, approval, NOW)).toEqual({ grade: "warning", reason: "Last run ended: action required" });
  });

  it("is failing when the last finished run failed, whatever else holds", () => {
    for (const conclusion of ["failure", "timed_out", "startup_failure"]) {
      const failed = read({
        last: { conclusion, at: hoursAgo(1), url: "u" },
        running: { conclusion: "in_progress", at: hoursAgo(0.1), url: "u", waiting: false },
      });
      expect(gradeWorkflow({}, failed, NOW)).toEqual({ grade: "failing", reason: "Last run failed" });
    }
  });

  it("is off when the workflow is turned off, before anything about its runs", () => {
    const off = read({ state: "disabled_manually", last: { conclusion: "failure", at: hoursAgo(300), url: "u" } });
    expect(gradeWorkflow({}, off, NOW)).toEqual({ grade: "off", reason: "Turned off (disabled manually)" });
    expect(gradeWorkflow({ stateOnly: true }, read({ state: "disabled_inactivity" }), NOW).grade).toBe("off");
  });

  it("is unknown when unread or with no finished run", () => {
    expect(gradeWorkflow({}, null, NOW)).toEqual({ grade: "unknown", reason: "Could not be read from GitHub" });
    expect(gradeWorkflow({}, read({ last: null }), NOW)).toEqual({ grade: "unknown", reason: "No finished run found" });
    const first = read({ last: null, running: { conclusion: "in_progress", at: hoursAgo(0.1), url: "u", waiting: false } });
    expect(gradeWorkflow({}, first, NOW).grade).toBe("ok");
  });

  it("warns when no run is in progress and the last one is older than expected", () => {
    const quiet = read({ last: { conclusion: "success", at: hoursAgo(3), url: "u" } });
    expect(gradeWorkflow({ staleAfterMinutes: 90 }, quiet, NOW)).toEqual({ grade: "warning", reason: "No run for 3h" });
    // A run in progress is not stale, and without a limit age does not matter.
    const running = { ...quiet, running: { conclusion: "in_progress", at: hoursAgo(0.2), url: "u", waiting: false } };
    expect(gradeWorkflow({ staleAfterMinutes: 90 }, running, NOW).grade).toBe("ok");
    expect(gradeWorkflow({}, quiet, NOW).grade).toBe("ok");
  });

  it("grades a state-only workflow by its state alone", () => {
    const failed = read({ last: { conclusion: "failure", at: hoursAgo(1), url: "u" }, week: null });
    expect(gradeWorkflow({ stateOnly: true }, failed, NOW)).toEqual({ grade: "ok", reason: "On" });
    expect(gradeWorkflow({ stateOnly: true }, null, NOW).grade).toBe("unknown");
  });
});

describe("runsPageUrl", () => {
  it("links the workflow's runs, narrowed to its branch when it counts one", () => {
    expect(runsPageUrl({ repo: "axiom-corpus", file: "publish.yml" })).toBe(
      "https://github.com/TheAxiomFoundation/axiom-corpus/actions/workflows/publish.yml"
    );
    expect(runsPageUrl({ repo: "axiom-encode", file: "signing-supervisor.yml", branch: "main" })).toBe(
      "https://github.com/TheAxiomFoundation/axiom-encode/actions/workflows/signing-supervisor.yml?query=branch%3Amain"
    );
  });
});

/* ── Reads, against a stubbed GitHub ── */

interface Run {
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  html_url: string;
}

function run(id: number, status: string, conclusion: string | null, hours: number): Run {
  return {
    status,
    conclusion,
    created_at: hoursAgo(hours + 0.1),
    updated_at: hoursAgo(hours),
    run_started_at: hoursAgo(hours + 0.1),
    html_url: `https://github.com/run/${id}`,
  };
}

const json = (value: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 502, json: async () => value }) as Response;

/** A stubbed GitHub: the workflow's state, and runs answered by query. */
function stubGitHub(answer: (url: URL) => unknown) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const value = answer(new URL(String(input)));
    return value instanceof Error ? json({}, false) : json(value);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SPEC: WorkflowSpec = { repo: "axiom-corpus", file: "activate-release.yml", label: "Release activation", does: "x" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("readWorkflow", () => {
  it("reads the state and one page of the week's runs, and counts them", async () => {
    const runs = [
      run(5, "in_progress", null, 0),
      run(4, "completed", "failure", 1),
      run(3, "completed", "cancelled", 5),
      run(2, "completed", "success", 30),
      run(1, "completed", "timed_out", 60),
    ];
    const fetchMock = stubGitHub((url) =>
      url.pathname.endsWith("/runs") ? { total_count: runs.length, workflow_runs: runs } : { state: "active" }
    );
    const result = await readWorkflow(SPEC, NOW);
    expect(result).toEqual({
      state: "active",
      last: { conclusion: "failure", at: hoursAgo(1), url: "https://github.com/run/4" },
      running: { conclusion: "in_progress", at: hoursAgo(0.1), url: "https://github.com/run/5", waiting: false },
      week: { runs: 5, failed: 2, cancelled: 1 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const runsUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(runsUrl.pathname).toBe("/repos/TheAxiomFoundation/axiom-corpus/actions/workflows/activate-release.yml/runs");
    expect(runsUrl.searchParams.get("created")).toBe(">=2026-10-07T12:00:00Z");
    expect(runsUrl.searchParams.get("per_page")).toBe("100");
  });

  it("skips cancelled runs for the last run when cancellations are routine", async () => {
    const runs = [run(3, "completed", "cancelled", 1), run(2, "completed", "skipped", 2), run(1, "completed", "success", 3)];
    stubGitHub((url) =>
      url.pathname.endsWith("/runs") ? { total_count: runs.length, workflow_runs: runs } : { state: "active" }
    );
    const routine = await readWorkflow({ ...SPEC, routineCancels: true }, NOW);
    expect(routine.last?.url).toBe("https://github.com/run/1");
    expect(routine.week).toEqual({ runs: 3, failed: 0, cancelled: 1 });
    const plain = await readWorkflow(SPEC, NOW);
    expect(plain.last?.conclusion).toBe("cancelled");
  });

  it("prefers the run in progress over a newer one waiting to start", async () => {
    const runs = [run(3, "pending", null, 0.5), run(2, "in_progress", null, 2), run(1, "completed", "success", 3)];
    stubGitHub((url) =>
      url.pathname.endsWith("/runs") ? { total_count: runs.length, workflow_runs: runs } : { state: "active" }
    );
    expect((await readWorkflow(SPEC, NOW)).running?.url).toBe("https://github.com/run/2");
    const waiting = [run(3, "waiting", null, 0.5), run(1, "completed", "success", 3)];
    stubGitHub((url) =>
      url.pathname.endsWith("/runs") ? { total_count: waiting.length, workflow_runs: waiting } : { state: "active" }
    );
    expect((await readWorkflow(SPEC, NOW)).running).toMatchObject({ conclusion: "waiting", waiting: true });
  });

  it("reads a second page when the week holds up to 200 runs", async () => {
    const first = Array.from({ length: 100 }, (_, i) => run(200 - i, "completed", "success", 1 + i));
    const second = Array.from({ length: 50 }, (_, i) => run(100 - i, "completed", i < 2 ? "failure" : "success", 101 + i));
    const fetchMock = stubGitHub((url) => {
      if (!url.pathname.endsWith("/runs")) return { state: "active" };
      return { total_count: 150, workflow_runs: url.searchParams.get("page") === "2" ? second : first };
    });
    expect((await readWorkflow(SPEC, NOW)).week).toEqual({ runs: 150, failed: 2, cancelled: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("counts failures and cancellations with filtered reads past 200 runs", async () => {
    const first = Array.from({ length: 100 }, (_, i) => run(400 - i, "completed", "success", 0.5 + i / 10));
    const fetchMock = stubGitHub((url) => {
      if (!url.pathname.endsWith("/runs")) return { state: "active" };
      const status = url.searchParams.get("status");
      if (status === "failure") return { total_count: 6, workflow_runs: [] };
      if (status === "cancelled") return { total_count: 2, workflow_runs: [] };
      return { total_count: 316, workflow_runs: first };
    });
    const result = await readWorkflow({ ...SPEC, branch: "main" }, NOW);
    expect(result.week).toEqual({ runs: 316, failed: 6, cancelled: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Every runs read keeps the branch and the window.
    for (const [input] of fetchMock.mock.calls.slice(1)) {
      const url = new URL(String(input));
      expect(url.searchParams.get("branch")).toBe("main");
      expect(url.searchParams.get("created")).toBe(">=2026-10-07T12:00:00Z");
    }
  });

  it("looks past the window for the last run when none finished in it", async () => {
    const fetchMock = stubGitHub((url) => {
      if (!url.pathname.endsWith("/runs")) return { state: "disabled_manually" };
      if (url.searchParams.get("status") === "completed") {
        return { total_count: 900, workflow_runs: [run(9, "completed", "success", 300)] };
      }
      return { total_count: 0, workflow_runs: [] };
    });
    const result = await readWorkflow(SPEC, NOW);
    expect(result).toMatchObject({
      state: "disabled_manually",
      last: { conclusion: "success", url: "https://github.com/run/9" },
      week: { runs: 0, failed: 0, cancelled: 0 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get("created")).toBeNull();
  });

  it("does not count a state-only workflow's week", async () => {
    const first = Array.from({ length: 100 }, (_, i) => run(400 - i, "completed", "failure", 0.5 + i / 10));
    const fetchMock = stubGitHub((url) =>
      url.pathname.endsWith("/runs") ? { total_count: 316, workflow_runs: first } : { state: "active" }
    );
    const result = await readWorkflow({ ...SPEC, stateOnly: true }, NOW);
    expect(result.week).toBeNull();
    expect(result.last?.conclusion).toBe("failure");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends the token only to the GitHub API", async () => {
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "token-1");
    const fetchMock = stubGitHub((url) =>
      url.pathname.endsWith("/runs") ? { total_count: 1, workflow_runs: [run(1, "completed", "success", 1)] } : { state: "active" }
    );
    await readWorkflow(SPEC, NOW);
    for (const [input, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(String(input).startsWith("https://api.github.com/")).toBe(true);
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    }
  });

  it("throws when GitHub cannot be read, so a failure is not cached", async () => {
    stubGitHub((url) => (url.pathname.endsWith("/runs") ? new Error("502") : { state: "active" }));
    await expect(readWorkflow(SPEC, NOW)).rejects.toThrow("502");
  });
});

describe("getWorkflowHealth", () => {
  it("leaves a workflow that cannot be read unknown and reads the rest", async () => {
    stubGitHub((url) => {
      if (url.pathname.includes("/axiom-corpus/")) return new Error("502");
      return url.pathname.endsWith("/runs")
        ? { total_count: 1, workflow_runs: [run(1, "completed", "success", 1)] }
        : { state: "active" };
    });
    const health = await getWorkflowHealth();
    expect(health.map((w) => w.file)).toEqual(WORKFLOWS.map((w) => w.file));
    for (const workflow of health) {
      if (workflow.repo === "axiom-corpus") {
        expect(workflow.read).toBeNull();
        expect(gradeWorkflow(workflow, workflow.read, Date.now()).grade).toBe("unknown");
      } else {
        expect(workflow.read?.state).toBe("active");
      }
      expect(workflow.url).toBe(runsPageUrl(workflow));
    }
  });

  it("never throws, even when every read does", async () => {
    const health = await getWorkflowHealth(WORKFLOWS, async () => {
      throw new Error("rate limited");
    });
    expect(health).toHaveLength(WORKFLOWS.length);
    expect(health.every((workflow) => workflow.read === null)).toBe(true);
  });
});

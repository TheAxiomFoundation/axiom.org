import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowHealthStrip, workflowChip } from "./workflow-health";
import { runsPageUrl, type WorkflowHealth, type WorkflowRead } from "@/lib/axiom/workflow-health";

vi.mock("next/navigation", () => ({ usePathname: () => "/ops", useRouter: () => ({ push: vi.fn() }) }));

const NOW = Date.parse("2026-10-14T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

function workflow(
  spec: Partial<WorkflowHealth> & Pick<WorkflowHealth, "file" | "label">,
  read: WorkflowRead | null
): WorkflowHealth {
  const base = { repo: "axiom-corpus", does: "Does a thing", ...spec };
  return { ...base, url: runsPageUrl(base), read };
}

const passed = (overrides: Partial<WorkflowRead> = {}): WorkflowRead => ({
  state: "active",
  last: { conclusion: "success", at: hoursAgo(2), url: "https://github.com/run/1" },
  running: null,
  week: { runs: 9, failed: 0, cancelled: 0 },
  ...overrides,
});

const WORKFLOWS: WorkflowHealth[] = [
  workflow({ file: "publish.yml", label: "Corpus publish", does: "Signs and uploads a corpus release" }, passed({
    week: { runs: 9, failed: 1, cancelled: 1 },
  })),
  workflow({ file: "activate-release.yml", label: "Release activation" }, passed({
    last: { conclusion: "failure", at: hoursAgo(17), url: "https://github.com/run/2" },
    week: { runs: 10, failed: 5, cancelled: 1 },
  })),
  workflow({ repo: "axiom-encode", file: "snap-dispatch-queue.yml", label: "SNAP queue" }, passed({
    state: "disabled_manually",
    last: { conclusion: "success", at: hoursAgo(13 * 24), url: "https://github.com/run/3" },
    week: { runs: 0, failed: 0, cancelled: 0 },
  })),
  workflow({ repo: "axiom-encode", file: "targeted-signed-reencode.yml", label: "Encode runs", stateOnly: true }, passed({
    last: { conclusion: "failure", at: hoursAgo(1), url: "https://github.com/run/4" },
    running: { conclusion: "waiting", at: hoursAgo(0.5), url: "https://github.com/run/5", waiting: true },
    week: null,
  })),
  workflow({ repo: "axiom-encode", file: "signing-supervisor.yml", label: "Signing supervisor", branch: "main" }, passed()),
  workflow({ repo: "axiom.org", file: "collector-heartbeat.yml", label: "Collector heartbeat" }, passed({
    running: { conclusion: "in_progress", at: hoursAgo(1.5), url: "https://github.com/run/6", waiting: false },
  })),
  workflow({ repo: "axiom.org", file: "collect-encoding-pipeline.yml", label: "Ops collector" }, null),
];

afterEach(cleanup);

describe("WorkflowHealthStrip", () => {
  it("shows one chip per workflow, linked to its runs page", () => {
    render(<WorkflowHealthStrip workflows={WORKFLOWS} referenceMs={NOW} />);
    const strip = screen.getByRole("region", { name: "Workflows" });
    const links = within(strip).getAllByRole("link");
    expect(links).toHaveLength(WORKFLOWS.length);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://github.com/TheAxiomFoundation/axiom-corpus/actions/workflows/publish.yml",
      "https://github.com/TheAxiomFoundation/axiom-corpus/actions/workflows/activate-release.yml",
      "https://github.com/TheAxiomFoundation/axiom-encode/actions/workflows/snap-dispatch-queue.yml",
      "https://github.com/TheAxiomFoundation/axiom-encode/actions/workflows/targeted-signed-reencode.yml",
      "https://github.com/TheAxiomFoundation/axiom-encode/actions/workflows/signing-supervisor.yml?query=branch%3Amain",
      "https://github.com/TheAxiomFoundation/axiom.org/actions/workflows/collector-heartbeat.yml",
      "https://github.com/TheAxiomFoundation/axiom.org/actions/workflows/collect-encoding-pipeline.yml",
    ]);
    for (const link of links) expect(link).toHaveAttribute("target", "_blank");
  });

  it("names each grade in words, not by color alone", () => {
    render(<WorkflowHealthStrip workflows={WORKFLOWS} referenceMs={NOW} />);
    const names = screen.getAllByRole("link").map((link) => link.textContent);
    expect(names).toEqual([
      "Warning: Corpus publish2h ago1 failed in 7 days",
      "Failing: Release activation17h ago5 failed in 7 days",
      "Off: SNAP queueoff · 13d ago",
      "OK: Encode runswaiting",
      "OK: Signing supervisor2h ago",
      "OK: Collector heartbeatrunning",
      "Unknown: Ops collectorunknown",
    ]);
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("data-grade"))).toEqual([
      "warning",
      "failing",
      "off",
      "ok",
      "ok",
      "ok",
      "unknown",
    ]);
  });

  it("says what each workflow does and how its last run ended in the tooltip", () => {
    render(<WorkflowHealthStrip workflows={WORKFLOWS} referenceMs={NOW} />);
    const [publish, activation, , encode, , , collector] = screen.getAllByRole("link");
    expect(publish).toHaveAttribute(
      "title",
      "Signs and uploads a corpus release. 1 failed in 7 days; the last run passed. Last run: passed, 2h ago. Last 7 days: 9 runs, 1 failed, 1 cancelled."
    );
    expect(activation.getAttribute("title")).toContain("Last run failed. Last run: failed, 17h ago.");
    // A state-only workflow has no week line: its failures are counted elsewhere.
    expect(encode.getAttribute("title")).toBe("Does a thing. On. Last run: failed, 1h ago. A run is waiting to start.");
    expect(collector).toHaveAttribute("title", "Does a thing. Could not be read from GitHub.");
  });

  it("explains the strip behind its question mark", () => {
    render(<WorkflowHealthStrip workflows={WORKFLOWS} referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "What Workflows means" }));
    expect(screen.getByRole("note")).toHaveTextContent("it can still have done part of its work");
  });

  it("renders nothing without workflows", () => {
    const { container } = render(<WorkflowHealthStrip workflows={[]} referenceMs={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("workflowChip", () => {
  it("shows the failures only when there are some", () => {
    expect(workflowChip(WORKFLOWS[4], NOW).failed).toBeNull();
    expect(workflowChip(WORKFLOWS[0], NOW).failed).toBe("1 failed in 7 days");
  });

  it("says no runs when none finished and none is running", () => {
    const quiet = workflow({ file: "x.yml", label: "X" }, passed({ last: null }));
    expect(workflowChip(quiet, NOW)).toMatchObject({ grade: "unknown", when: "no runs" });
  });
});

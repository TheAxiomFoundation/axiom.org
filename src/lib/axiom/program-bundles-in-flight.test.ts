import { describe, expect, it } from "vitest";
import recorded from "@/test/rulespec-open-prs.json";
import {
  addedModules,
  inFlightModules,
  MAX_OPEN_PR_PAGES,
  manifestModules,
  moduleCitations,
  readOpenPrs,
  type OpenPrNode,
  type OpenPrsData,
} from "./program-bundles-in-flight";

// Recorded GraphQL payloads (src/test/rulespec-open-prs.json): the open
// rulespec-us PRs on 2026-11-15, and the PRs of the 2026-11-13 Arizona medical
// merge train, now closed or merged (the classifier reads no PR state: the
// query asks for open PRs only).
const openPages = recorded.open.map((page) => page.data as OpenPrsData);
const historical = recorded.historical.data.repository as unknown as Record<string, OpenPrNode>;
const pr = (n: number) => historical[`pr${n}`];

/** A fetchPage that answers with these pages in turn. */
const pagesOf = (pages: OpenPrsData[]) => {
  let i = 0;
  return async () => pages[i++];
};

const MEDICAL = "us-az/policies/des/faa5/na-medical-expenses-and-deduction";
const UTILITY = "us-az/policies/des/faa5/na-utility-expenses-and-allowances";

describe("readOpenPrs", () => {
  it("reads every page of open PRs and the default branch", async () => {
    const read = await readOpenPrs(pagesOf(openPages));
    expect(read?.defaultBranch).toBe("main");
    expect(read?.prs.map((p) => p.number)).toEqual([911, 1790, 2044, 2153, 2161, 2197, 2266, 2268, 2273, 2275]);
  });

  it("gives no data, never no PRs, when a page fails or comes back without pull requests", async () => {
    const lines: string[] = [];
    const failing = async (cursor: string | null) => {
      if (cursor) throw new Error("GraphQL: HTTP 502");
      return openPages[0];
    };
    expect(await readOpenPrs(failing, (line) => lines.push(line))).toBeNull();
    expect(await readOpenPrs(async () => ({ repository: null }), (line) => lines.push(line))).toBeNull();
    expect(lines).toEqual(["open PRs not read: GraphQL: HTTP 502", "open PRs not read: the response holds no pull requests"]);
  });

  it("gives no data when the open PRs run past the cap", async () => {
    let calls = 0;
    const endless = async () => {
      calls++;
      return openPages[0];
    };
    const lines: string[] = [];
    expect(await readOpenPrs(endless, (line) => lines.push(line))).toBeNull();
    expect(calls).toBe(MAX_OPEN_PR_PAGES);
    expect(lines).toEqual(["open PRs not read: more than 500 open PRs (the cap)"]);
  });
});

describe("moduleCitations", () => {
  it("is the index's citation from the module path, then the classes the corpus files policy material under", () => {
    expect(moduleCitations("rulespec-us", `${MEDICAL}/block-4.yaml`)).toEqual([
      "us-az/policy/des/faa5/na-medical-expenses-and-deduction/block-4",
      "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-4",
      "us-az/guidance/des/faa5/na-medical-expenses-and-deduction/block-4",
    ]);
    // Law has one spelling; a federal regulation's title drops "-cfr", as in the index.
    expect(moduleCitations("rulespec-us", "us-ut/statutes/59-10-1043.yaml")).toEqual(["us-ut/statute/59-10-1043"]);
    expect(moduleCitations("rulespec-us", "us/regulations/45-cfr/1302/12/i/1/ii.yaml")).toEqual([
      "us/regulation/45/1302/12/i/1/ii",
    ]);
  });
});

describe("addedModules and manifestModules", () => {
  it("reads the primary modules a PR adds, and the modules it carries a signed manifest for", () => {
    // A candidate: its module and companion tests, the index changed beside them.
    const candidate = openPages[0].repository!.pullRequests.nodes.find((n) => n?.number === 2044)!;
    expect(addedModules(candidate)).toEqual(["us-az/policies/des/faa5/na-child-support-expense/block-4.yaml"]);
    expect(manifestModules(candidate)).toEqual([]);
    // The train adds three modules and a manifest for each.
    expect(addedModules(pr(2205))).toEqual([`${MEDICAL}/block-11.yaml`, `${MEDICAL}/block-12.yaml`, `${MEDICAL}/block-7.yaml`]);
    expect(manifestModules(pr(2205))).toEqual([`${MEDICAL}/block-11.yaml`, `${MEDICAL}/block-12.yaml`, `${MEDICAL}/block-7.yaml`]);
    // A manifest PR into a candidate's branch adds no module.
    expect(addedModules(pr(2204))).toEqual([]);
    expect(manifestModules(pr(2204))).toEqual([`${MEDICAL}/block-7.yaml`]);
  });
});

describe("inFlightModules", () => {
  it("lists the modules the open PRs add, with each PR's state", async () => {
    const read = (await readOpenPrs(pagesOf(openPages)))!;
    const lines: string[] = [];
    const modules = inFlightModules(read.prs, { defaultBranch: read.defaultBranch }, (line) => lines.push(line));
    expect(modules.map((m) => [m.pr, m.module, m.state, m.draft, m.review_decision])).toEqual([
      [2044, "us-az/policies/des/faa5/na-child-support-expense/block-4.yaml", "candidate", true, null],
      [2268, `${MEDICAL}/block-13.yaml`, "candidate", true, null],
      [2266, `${MEDICAL}/block-4.yaml`, "candidate", true, null],
      [2197, `${UTILITY}/block-10.yaml`, "changes-requested", false, "CHANGES_REQUESTED"],
      [2275, `${UTILITY}/block-12.yaml`, "candidate", true, null],
      [2273, `${UTILITY}/block-6.yaml`, "candidate", false, null],
      [2153, "us-ut/statutes/59-10-1043.yaml", "candidate", true, null],
    ]);
    // #911 changes 4,702 files: no candidate or train, and the log says it was not read.
    expect(lines).toEqual(["#911: more than 100 changed files, not read as a candidate or train"]);
    // #1790 changes a module already on its branch, and #2161 a notice: neither adds a module.
    expect(modules.some((m) => m.pr === 1790 || m.pr === 2161)).toBe(false);
    const block4 = modules.find((m) => m.pr === 2266)!;
    expect(block4).toEqual({
      module: `${MEDICAL}/block-4.yaml`,
      citations: [
        "us-az/policy/des/faa5/na-medical-expenses-and-deduction/block-4",
        "us-az/manual/des/faa5/na-medical-expenses-and-deduction/block-4",
        "us-az/guidance/des/faa5/na-medical-expenses-and-deduction/block-4",
      ],
      pr: 2266,
      url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/2266",
      state: "candidate",
      review_decision: null,
      draft: true,
      manifest_pr: null,
    });
  });

  it("reads an approved candidate as reviewed", () => {
    // GitHub gives no review decision on a merged PR; #2046 was approved at
    // its head before it was signed, as an open PR it read APPROVED.
    const approved = { ...pr(2046), reviewDecision: "APPROVED" };
    expect(inFlightModules([approved], { defaultBranch: "main" }).map((m) => [m.pr, m.state])).toEqual([
      [2046, "candidate-reviewed"],
    ]);
    expect(inFlightModules([pr(2046)], { defaultBranch: "main" }).map((m) => m.state)).toEqual(["candidate"]);
  });

  it("reads a candidate as signed when a manifest PR into its branch, or the PR itself, carries its manifest", () => {
    const modules = inFlightModules([pr(2046), pr(2204), pr(2045)], { defaultBranch: "main" });
    expect(modules.map((m) => [m.pr, m.state, m.manifest_pr?.number ?? null])).toEqual([
      [2046, "signed", 2204],
      [2045, "signed", null],
    ]);
    expect(modules[0].manifest_pr).toEqual({ number: 2204, url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/2204" });
    expect(modules[1].module).toBe(`${UTILITY}/block-13.yaml`);
  });

  it("puts each module of a merge train in the train, beside its signed candidate", () => {
    const modules = inFlightModules([pr(2046), pr(2047), pr(2202), pr(2204), pr(2205)], { defaultBranch: "main" });
    expect(modules.map((m) => [m.module.split("/").pop(), m.pr, m.state, m.manifest_pr?.number ?? null])).toEqual([
      ["block-11.yaml", 2047, "signed", 2202],
      ["block-11.yaml", 2205, "in-train", null],
      ["block-12.yaml", 2205, "in-train", null],
      ["block-7.yaml", 2046, "signed", 2204],
      ["block-7.yaml", 2205, "in-train", null],
    ]);
  });

  it("does not read a PR into a side branch, or one module with its manifest, as a train", () => {
    const sideBranch = { ...pr(2205), baseRefName: "codex/az-medical" };
    expect(new Set(inFlightModules([sideBranch], { defaultBranch: "main" }).map((m) => m.state))).toEqual(new Set(["signed"]));
    expect(inFlightModules([pr(2045)], { defaultBranch: "main" }).map((m) => m.state)).toEqual(["signed"]);
  });
});

import fc from "fast-check";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOCK_POLICYBENCH_EXPORT, MOCK_WEB_SEARCH_AUDIT } from "@/test/aspen-free-plan-export.mock";
import { distinguishable, formatPoints, freePlanProblems, shownChange, wholeShare, type FreePlanPilot } from "./content";
import {
  EXPORT_ARMS,
  VS_WEB,
  caveatText,
  freePlanFromExport,
  noisePoints,
  runDateRange,
  sizeGroups,
  utcDay,
  writePilotInto,
  type ExportModel,
  type PolicyBenchExport,
  type WebSearchArm,
  type WebSearchAudit,
} from "./free-plan-export";

const ALL = ["mock-c", "mock-a", "mock-d", "mock-b"];
const exp = MOCK_POLICYBENCH_EXPORT;
const audit = MOCK_WEB_SEARCH_AUDIT;

/** The audit with one model's web setting changed. */
function withSearches(id: string, arm: "web" | "both", change: Partial<WebSearchArm>, from: WebSearchAudit = audit): WebSearchAudit {
  return { ...from, models: { ...from.models, [id]: { ...from.models[id], [arm]: { ...from.models[id][arm]!, ...change } } } };
}

/** The export with one model changed. */
function withModel(id: string, change: (m: ExportModel) => ExportModel): PolicyBenchExport {
  return { ...exp, models: exp.models.map((m) => (m.id === id ? change(m) : m)) };
}

describe("freePlanFromExport", () => {
  it("puts the free-plan models first, in the order chosen, and carries the export's counts and changes", () => {
    const { pilot } = freePlanFromExport(exp, { models: ALL });
    expect(pilot.rows.map((r) => r.model)).toEqual(["Mock model A", "Mock model B", "Mock model C", "Mock model D"]);
    expect(pilot.rows.map((r) => r.freePlan)).toEqual(["On Mock Free", "On Mock Chat Free", null, null]);
    const a = pilot.rows[0];
    expect(a.counts).toEqual({ web: { k: 15, n: 48 }, both: { k: 39, n: 48 } });
    expect(a.bothVsWeb).toEqual({ points: 50, lo: 35, hi: 65 });
    // The bootstrap percent and interval stay in the export; the slide shows k of n.
    expect(Object.keys(a.counts.web!)).toEqual(["k", "n"]);
    expect(pilot.arms).toBe(EXPORT_ARMS);
    expect(freePlanProblems(pilot)).toEqual([]);
  });

  it("says what is counted, where it comes from and that it's preliminary", () => {
    const { pilot } = freePlanFromExport(exp, { models: ALL });
    expect(pilot.title).toBe("The models on free plans, with and without the PolicyEngine tool");
    expect(pilot.label).toBe("Preliminary internal pilot");
    expect(pilot.note).toBe("Dollar amounts that aren't $0, within $1 of PolicyBench's reference: 48 per model in 20 households sampled from PolicyEngine's microdata");
    expect(pilot.caveat).toBe(exp.caveat);
    // The rows name the free-plan models and the caveat says they were called through their APIs.
    expect(pilot.footnotes).toEqual([
      "Web search is each provider's own search tool, told not to search PolicyBench.",
      "The tool runs PolicyEngine (policyengine-us 0.0.0-mock), the engine behind the reference answers, so this shows whether a model can use it, not whether it's right.",
    ]);
    expect(pilot.source).toBe("PolicyBench preliminary internal pilot, not a PolicyBench result · runs October 23–24, 2026");
  });

  it("titles a slide without free-plan models as the same models, and takes a title and label", () => {
    const { pilot } = freePlanFromExport(exp, { models: ["mock-d", "mock-c"] });
    expect(pilot.rows.map((r) => r.model)).toEqual(["Mock model D", "Mock model C"]);
    expect(pilot.title).toBe("The same models, with and without the PolicyEngine tool");
    expect(pilot.footnotes[0]).toBe("Web search is each provider's own search tool, told not to search PolicyBench.");
    const named = freePlanFromExport(exp, { models: ["mock-a"], title: "T", label: "L" }).pilot;
    expect([named.title, named.label]).toEqual(["T", "L"]);
  });

  it("refuses a model that isn't in the export, or one chosen twice", () => {
    expect(() => freePlanFromExport(exp, { models: ["mock-a", "mock-z", "mock-y"] })).toThrow("not in the export: mock-z, mock-y");
    expect(() => freePlanFromExport(exp, { models: ["mock-a", "mock-a"] })).toThrow("a model is chosen twice");
  });

  it("refuses an export that disagrees with itself", () => {
    expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, freePlan: null })), { models: ["mock-a"] })).toThrow(
      'Mock model A: group free-plan but freePlan null',
    );
    expect(() => freePlanFromExport(withModel("mock-c", (m) => ({ ...m, freePlan: "X" })), { models: ["mock-c"] })).toThrow(
      'Mock model C: group other but freePlan "X"',
    );
    expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, freePlan: " " })), { models: ["mock-a"] })).toThrow(
      'Mock model A: group free-plan but freePlan " "',
    );
    expect(() => freePlanFromExport(withModel("mock-c", (m) => ({ ...m, freePlan: "" })), { models: ["mock-c"] })).toThrow(
      'Mock model C: group other but freePlan ""',
    );
    for (const households of [-1, 0, 0.5]) {
      expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, households })), { models: ["mock-a"] })).toThrow(
        `Mock model A: ${households} households isn't a count`,
      );
    }
    // Any of a chosen model's changes: those from no tools feed the check of PolicyBench's caveat, and the one shown the slide's noise width.
    for (const [lo, hi] of [[-1e308, 10], [0, 1e308], [5, 1], [NaN, 1]]) {
      expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, vsAlone: { ...m.vsAlone, web: { points: 1, lo, hi } } })), { models: ["mock-a"] })).toThrow(
        `Mock model A web: change 1 with interval ${lo} to ${hi} isn't a change in points`,
      );
      expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, vsWeb: { both: { points: 1, lo, hi } } })), { models: ["mock-a"] })).toThrow(
        `Mock model A both vs web: change 1 with interval ${lo} to ${hi} isn't a change in points`,
      );
    }
    // An export from before October 25 has no change from web search, so it can't fill this slide.
    for (const vsWeb of [undefined, {}]) {
      expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, vsWeb })), { models: ["mock-a"] })).toThrow(
        "Mock model A: no change from web search to web search and the tool",
      );
    }
    // The changes from no tools aren't shown, so the slide doesn't need the tool's.
    expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, vsAlone: { web: m.vsAlone.web } })), { models: ["mock-a"] })).not.toThrow();
    expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, arms: { ...m.arms, both: undefined } })), { models: ["mock-a"] })).toThrow(
      "Mock model A: no count for both",
    );
    expect(() =>
      freePlanFromExport(withModel("mock-a", (m) => ({ ...m, arms: { ...m.arms, web: { ...m.arms.web!, pct: 40 } } })), { models: ["mock-a"] }),
    ).toThrow("Mock model A web: 40% isn't 15 of 48");
    expect(() =>
      freePlanFromExport(withModel("mock-a", (m) => ({ ...m, arms: { ...m.arms, web: { k: 0, n: 0, pct: 0, lo: 0, hi: 0 } } })), { models: ["mock-a"] }),
    ).toThrow("Mock model A web: 0% isn't 0 of 0");
  });

  it("shows each change as its counts' own difference, and refuses an export whose change, to one decimal, isn't it", () => {
    // D's counts give 27.08; the export's one decimal passes, and the slide keeps the exact difference.
    const rounded = withModel("mock-d", (m) => ({ ...m, vsWeb: { both: { ...m.vsWeb!.both!, points: 27.1 } } }));
    expect(freePlanFromExport(rounded, { models: ["mock-d"] }).pilot.rows[0].bothVsWeb.points).toBe((100 * 13) / 48);
    for (const points of [27.6, 20]) {
      const off = withModel("mock-d", (m) => ({ ...m, vsWeb: { both: { ...m.vsWeb!.both!, points } } }));
      expect(() => freePlanFromExport(off, { models: ["mock-d"] })).toThrow(`Mock model D: change ${points}, but its counts give 27.08`);
    }
  });

  it("makes the change exact even where that sits just past the export's rounded interval, and the slide prints it at that end", () => {
    // aspen_export.py's own output for a synthetic run review 5 made: 100 households, one tool success
    // in each and none without the tool, eight amounts in all but one, which has nine. It rounds the change
    // and both ends to 12.5; the counts give 12.48, which alone would print as +12 beside +13 to +13.
    const c = (k: number) => ({ k, n: 801, pct: Math.round((1000 * k) / 801) / 10, lo: 0, hi: 100 });
    const tenth = { points: 12.5, lo: 12.5, hi: 12.5 };
    const one: ExportModel = {
      ...exp.models.find((m) => m.id === "mock-a")!,
      households: 100,
      arms: { alone: c(0), web: c(0), tool: c(100), both: c(100) },
      vsAlone: { web: { points: 0, lo: 0, hi: 0 }, tool: tenth, both: tenth },
      vsWeb: { both: tenth },
    };
    const run = { ...exp, models: [one], sizes: undefined, caveat: caveatText(sizeGroups([one])) };
    const change = freePlanFromExport(run, { models: [one.id] }).pilot.rows[0].bothVsWeb;
    expect(change).toEqual({ points: (100 * 100) / 801, lo: 12.5, hi: 12.5 });
    expect([shownChange(change), change.lo, change.hi].map(formatPoints)).toEqual(["+13", "+13", "+13"]);
  });

  it("uses PolicyBench's unrounded interval ends where it gives them, so no end on the slide is rounded twice", () => {
    // B's ends, -2.5 and 27.5 to one decimal, print as −2 and +28; unrounded, as −3 and +27.
    const rounded = freePlanFromExport(exp, { models: ["mock-b"] });
    expect([rounded.pilot.rows[0].bothVsWeb.lo, rounded.pilot.rows[0].bothVsWeb.hi].map(formatPoints)).toEqual(["−2", "+28"]);
    expect(rounded.warnings).toContain(
      "Mock model B: its interval's -2.5 and 27.5 were rounded to one decimal before the slide rounds to whole points, so each may print one off; ask PolicyBench for loExact and hiExact",
    );
    const exact = withModel("mock-b", (m) => ({ ...m, vsWeb: { both: { ...m.vsWeb!.both!, loExact: -2.54, hiExact: 27.46 } } }));
    const { pilot, warnings } = freePlanFromExport(exact, { models: ["mock-b"] });
    expect(pilot.rows[0].bothVsWeb).toEqual({ points: 12.5, lo: -2.54, hi: 27.46 });
    expect([pilot.rows[0].bothVsWeb.lo, pilot.rows[0].bothVsWeb.hi].map(formatPoints)).toEqual(["−3", "+27"]);
    expect(warnings.some((w) => w.includes("loExact"))).toBe(false);
    // PolicyBench takes its noise width from the rounded ends, and so does the slide.
    expect(pilot.caveat).toBe(rounded.pilot.caveat);
  });

  it("knows which side of zero an end of 0 was on where PolicyBench says, and otherwise says the interval includes 0 and warns", () => {
    const at = (loExact?: number) =>
      withModel("mock-a", (m) => ({ ...m, vsWeb: { both: { points: 50, lo: 0, hi: 65, ...(loExact === undefined ? {} : { loExact, hiExact: 65 }) } } }));
    const unsure = freePlanFromExport(at(), { models: ["mock-a"] });
    expect(distinguishable(unsure.pilot.rows[0].bothVsWeb)).toBe(false);
    expect(unsure.warnings).toContain(
      "Mock model A: its interval has an end of 0 to one decimal, so the slide can't tell whether it leaves out zero and says it includes 0; ask PolicyBench for loExact and hiExact",
    );
    for (const [loExact, leavesOut, printed] of [[0.03, true, "+0.03"], [-0.03, false, "−0.03"], [0, false, "0"]] as const) {
      const { pilot, warnings } = freePlanFromExport(at(loExact), { models: ["mock-a"] });
      expect(distinguishable(pilot.rows[0].bothVsWeb)).toBe(leavesOut);
      expect(formatPoints(pilot.rows[0].bothVsWeb.lo)).toBe(printed);
      expect(warnings.some((w) => w.includes("loExact"))).toBe(false);
    }
  });

  it("refuses unrounded ends that don't round to the export's, come one without the other, run backward or pass 100 points", () => {
    const at = (both: object) => withModel("mock-b", (m) => ({ ...m, vsWeb: { both: { ...m.vsWeb!.both!, ...both } } }));
    for (const [both, lo, hi] of [
      [{ loExact: -2.54 }, -2.54, undefined],
      [{ hiExact: 27.46 }, undefined, 27.46],
      [{ loExact: -2.6, hiExact: 27.46 }, -2.6, 27.46],
      [{ loExact: -2.54, hiExact: 27.4 }, -2.54, 27.4],
      [{ loExact: NaN, hiExact: 27.46 }, NaN, 27.46],
      [{ loExact: -2.54, hiExact: Infinity }, -2.54, Infinity],
      [{ loExact: "-2.54", hiExact: 27.46 }, -2.54, 27.46],
    ] as const) {
      expect(() => freePlanFromExport(at(both), { models: ["mock-b"] })).toThrow(`Mock model B: unrounded interval ${lo} to ${hi} isn't the export's -2.5 to 27.5 before rounding`);
    }
    const flat = withModel("mock-a", (m) => ({ ...m, vsWeb: { both: { points: 50, lo: 50, hi: 50, loExact: 50.04, hiExact: 49.96 } } }));
    expect(() => freePlanFromExport(flat, { models: ["mock-a"] })).toThrow("Mock model A: unrounded interval 50.04 to 49.96 isn't the export's 50 to 50 before rounding");
    const edge = withModel("mock-a", (m) => ({ ...m, vsWeb: { both: { points: 50, lo: 0, hi: 100, loExact: 0, hiExact: 100.04 } } }));
    expect(() => freePlanFromExport(edge, { models: ["mock-a"] })).toThrow("Mock model A: unrounded interval 0 to 100.04 isn't the export's 0 to 100 before rounding");
  });

  it("moves a degenerate interval's unrounded ends out to the change only where they miss it in the last bits", () => {
    // Review 5's run, where every resample gives the counts' change, which the bootstrap can write a few bits off.
    const c = (k: number) => ({ k, n: 801, pct: Math.round((1000 * k) / 801) / 10, lo: 0, hi: 100 });
    const points = (100 * 100) / 801;
    const tenth = { points: 12.5, lo: 12.5, hi: 12.5 };
    const one = (loExact: number, hiExact: number): ExportModel => ({
      ...exp.models.find((m) => m.id === "mock-a")!,
      households: 100,
      arms: { alone: c(0), web: c(0), tool: c(100), both: c(100) },
      vsAlone: { web: { points: 0, lo: 0, hi: 0 }, tool: tenth, both: tenth },
      vsWeb: { both: { ...tenth, loExact, hiExact } },
    });
    const slide = (m: ExportModel) => freePlanFromExport({ ...exp, models: [m], sizes: undefined, caveat: caveatText(sizeGroups([m])) }, { models: [m.id] }).pilot.rows[0].bothVsWeb;
    expect(slide(one(points + 1e-12, points + 1e-12))).toEqual({ points, lo: points, hi: points + 1e-12 });
    expect(slide(one(points - 1e-12, points - 1e-12))).toEqual({ points, lo: points - 1e-12, hi: points });
    expect(slide(one(points, points))).toEqual({ points, lo: points, hi: points });
    // Further off, the change is outside its interval, and the slide's checks say so.
    expect(() => slide(one(points + 0.01, points + 0.01))).toThrow("is outside its interval");
  });

  it("refuses data the slide's own checks reject, and says which", () => {
    const off = withModel("mock-a", (m) => ({ ...m, vsWeb: { both: { points: 50, lo: 60, hi: 70 } } }));
    expect(() => freePlanFromExport(off, { models: ["mock-a"] })).toThrow("the export fails the slide's checks:\n- Mock model A: 50 is outside its interval 60 to 70");
    const seven = { ...exp, models: Array.from({ length: 7 }, (_, i) => ({ ...exp.models[0], id: `m${i}`, model: `Mock model ${i}` })) };
    expect(() => freePlanFromExport(seven, { models: seven.models.map((m) => m.id) })).toThrow("7 rows; the slide fits 1 to 6");
  });

  it("always warns how few benefit amounts there are, and only that when the export is clean, its ends unrounded and its searches audited", () => {
    // B's interval, -2.5 to 27.5, is the one with ends at a half; unrounded, it's clean.
    const clean = withModel("mock-b", (m) => ({ ...m, vsWeb: { both: { ...m.vsWeb!.both!, loExact: -2.54, hiExact: 27.46 } } }));
    expect(freePlanFromExport(clean, { models: ALL, webAudit: audit }).warnings).toEqual(["benefit amounts: at most 3 per model, too few to say anything about benefits"]);
    const none = withModel("mock-a", (m) => ({ ...m, benefits: {} }));
    expect(freePlanFromExport(none, { models: ["mock-a"], webAudit: audit }).warnings).toEqual([
      "benefit amounts: none in these households, so this says nothing about benefits",
    ]);
  });

  it("warns when no web-search audit is given, since the slide can't then say whether a model searched for PolicyBench", () => {
    const { pilot, warnings } = freePlanFromExport(exp, { models: ALL });
    expect(warnings).toContain("no web-search audit given, so the slide doesn't say whether a model searched for PolicyBench; pass --web-audit");
    // Nor how often each one searched.
    const audited = freePlanFromExport(exp, { models: ALL, webAudit: audit }).pilot.footnotes;
    expect(audited).toHaveLength(pilot.footnotes.length + 1);
    expect(pilot.footnotes).toEqual(audited.filter((f) => !f.startsWith("Web search queries")));
  });

  it("says which models on the slide searched for PolicyBench anyway, in how many households, and that PolicyBench's scan found no match for the answers", () => {
    const web = "Web search is each provider's own search tool, told not to search PolicyBench.";
    // B searched in three households across its two web settings, one of them in both.
    const b = withSearches("mock-b", "both", { queries: 30, policyBenchQueries: 2, policyBenchHouseholds: ["mt_04"] }, withSearches("mock-b", "web", { policyBenchQueries: 5, policyBenchHouseholds: ["mt_01", "mt_04", "mt_09"] }));
    const one = freePlanFromExport(exp, { models: ALL, webAudit: b });
    // Right after the web line, which says they were told not to.
    expect(one.pilot.footnotes.slice(0, 2)).toEqual([web, "Mock model B searched for it anyway in 3 of 20 households; a scan of PolicyBench's public repository found no match for these households' answers."]);
    expect(one.warnings).toContain("Mock model B searched for PolicyBench in 3 of 20 households, though told not to; the slide says so");
    // Not on the slide, not in the footnote.
    const without = freePlanFromExport(exp, { models: ["mock-a", "mock-c"], webAudit: b });
    expect(without.pilot.footnotes[1]).toMatch(/^Web search queries/);
    expect(without.warnings.some((w) => w.includes("searched for PolicyBench"))).toBe(false);
    // Two read as a list, the first with the full wording.
    const two = freePlanFromExport(exp, { models: ALL, webAudit: withSearches("mock-c", "web", { policyBenchQueries: 1, policyBenchHouseholds: ["mt_02"] }, b) }).pilot;
    expect(two.footnotes[1]).toBe(
      "Mock model B searched for it anyway in 3 of 20 households and Mock model C in 1 of 20; a scan of PolicyBench's public repository found no match for these households' answers.",
    );
  });

  it("gives each model's web search queries in both settings, in the slide's order, and says they fell only when each one's did", () => {
    const tool = "The tool runs PolicyEngine (policyengine-us 0.0.0-mock), the engine behind the reference answers, so this shows whether a model can use it, not whether it's right.";
    // Each mock model searched 40 times in each setting.
    expect(freePlanFromExport(exp, { models: ALL, webAudit: audit }).pilot.footnotes.slice(1)).toEqual([
      "Web search queries, without the tool and with it available: Mock model A from 40 to 40, Mock model B from 40 to 40, Mock model C from 40 to 40 and Mock model D from 40 to 40.",
      tool,
    ]);
    const fell = withSearches("mock-a", "both", { queries: 12 }, withSearches("mock-a", "web", { queries: 232 }, withSearches("mock-b", "web", { queries: 1439 }, withSearches("mock-b", "both", { queries: 0 }))));
    expect(freePlanFromExport(exp, { models: ["mock-b", "mock-a"], webAudit: fell }).pilot.footnotes[1]).toBe(
      "Web search queries fell with the tool available: Mock model B from 1,439 to 0 and Mock model A from 232 to 12.",
    );
    // With one that didn't fall, the lead claims no direction. The free-plan model comes first, as in the rows.
    expect(freePlanFromExport(exp, { models: ["mock-c", "mock-a"], webAudit: fell }).pilot.footnotes[1]).toBe(
      "Web search queries, without the tool and with it available: Mock model A from 232 to 12 and Mock model C from 40 to 40.",
    );
    // After the PolicyBench line, whose "it" is the web line's.
    const searchedToo = withSearches("mock-b", "web", { policyBenchQueries: 2, policyBenchHouseholds: ["mt_01"] }, fell);
    const notes = freePlanFromExport(exp, { models: ["mock-a", "mock-b"], webAudit: searchedToo }).pilot.footnotes;
    const starts = ["Web search is", "Mock model B searched for it anyway", "Web search queries", "The tool runs"];
    expect(notes).toHaveLength(starts.length);
    notes.forEach((f, i) => expect(f.startsWith(starts[i])).toBe(true));
  });

  it("refuses a web-search audit that doesn't cover a model on the slide, doesn't add up, or doesn't say its scan found no match for the answers", () => {
    const { "mock-a": _, ...rest } = audit.models;
    expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: { ...audit, models: rest } })).toThrow("Mock model A: no web searches in the web-search audit");
    expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: { ...audit, models: { ...audit.models, "mock-a": { web: audit.models["mock-a"].web } } } })).toThrow(
      "Mock model A: no both searches in the web-search audit",
    );
    expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: withSearches("mock-a", "web", { households: 10 }) })).toThrow(
      "Mock model A web: the web-search audit's households don't match the export's 20",
    );
    expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: withSearches("mock-a", "web", { policyBenchQueries: 2, policyBenchHouseholds: ["mt_01", "mt_01"] }) })).toThrow(
      "Mock model A web: the web-search audit's households don't match the export's 20",
    );
    for (const [change, says] of [
      [{ policyBenchQueries: 0, policyBenchHouseholds: ["mt_01"] }, "0 PolicyBench queries of 40 in 1 households"],
      [{ policyBenchQueries: 2, policyBenchHouseholds: [] }, "2 PolicyBench queries of 40 in 0 households"],
      [{ policyBenchQueries: 1, policyBenchHouseholds: ["mt_01", "mt_02"] }, "1 PolicyBench queries of 40 in 2 households"],
      [{ queries: 3, policyBenchQueries: 4, policyBenchHouseholds: ["mt_01"] }, "4 PolicyBench queries of 3 in 1 households"],
    ] satisfies [Partial<WebSearchArm>, string][]) {
      expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: withSearches("mock-a", "web", change) })).toThrow(`Mock model A web: ${says} don't add up`);
    }
    for (const change of [{ queries: 40.5 }, { policyBenchQueries: -1 }, { households: undefined }, { policyBenchHouseholds: undefined }] as Partial<WebSearchArm>[]) {
      expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: withSearches("mock-a", "web", change) })).toThrow(
        "Mock model A web: the web-search audit's counts aren't whole numbers with a list of households",
      );
    }
    // Each setting names 12 of the 20 households, but not the same ones: 24 in all can't be.
    const hh = (from: number) => Array.from({ length: 12 }, (_, i) => `mt_${from + i}`);
    const disjoint = withSearches("mock-a", "both", { policyBenchQueries: 12, policyBenchHouseholds: hh(100) }, withSearches("mock-a", "web", { policyBenchQueries: 12, policyBenchHouseholds: hh(200) }));
    expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: { ...disjoint, answersPublished: false } })).toThrow(
      "Mock model A: the web-search audit names 24 households across its web settings, more than the export's 20",
    );
    const searched = withSearches("mock-b", "web", { policyBenchQueries: 1, policyBenchHouseholds: ["mt_01"] });
    expect(() => freePlanFromExport(exp, { models: ["mock-b"], webAudit: searched })).not.toThrow();
    const unsaid = "Mock model B searched for PolicyBench, and the web-search audit doesn't say its scan found no match for these households' answers";
    const unread = "the web-search audit doesn't show its scan read the PolicyEngine/policybench repository the footnote names";
    const listed = "Mock model B searched for PolicyBench, and the web-search audit's scan lists a match, or no list of them";
    const check = searched.publicationCheck!;
    for (const [change, says] of [
      [{ answersPublished: true }, "Mock model B searched for PolicyBench, and the web-search audit says these households' answers are published"],
      // Also set when a release asset changed after the answers were made, so the message says possible.
      [{ matchingAnswersFound: true }, `${unsaid}; it flags a possible match`],
      // No scan can show there's no copy anywhere, so the older audit's false is no longer enough.
      [{ answersPublished: false }, unsaid],
      [{ matchingAnswersFound: null }, unsaid],
      [{ matchingAnswersFound: undefined }, unsaid],
      [{ matchingScope: "every file version in a public repository" }, unread],
      [{ matchingScope: undefined }, unread],
      [{ publicationCheck: undefined }, unread],
      [{ publicationCheck: { ...check, fileVersions: 0 } }, unread],
      [{ publicationCheck: { ...check, fileVersions: 1.5 } }, unread],
      // More than it read, so only the whole-number check refuses it.
      [{ publicationCheck: { ...check, fileVersions: 100.5 } }, unread],
      // It found files but read none of them, as with a repository of images.
      [{ publicationCheck: { ...check, readAs: { text: 0, gzip: 0, pdf: 0 } } }, unread],
      [{ publicationCheck: { ...check, readAs: undefined } }, unread],
      [{ publicationCheck: { ...check, readAs: {} } }, unread],
      [{ publicationCheck: { ...check, readAs: { text: 0.5, gzip: 0, pdf: 0 } } }, unread],
      [{ publicationCheck: { ...check, readAs: { text: 101, gzip: 0, pdf: 0 } } }, unread],
      // The summary flag says nothing was found, but the scan's own record lists a match.
      [{ publicationCheck: { ...check, matches: [{ path: "data.json", idsNamed: ["mt_01"] }] } }, listed],
      [{ publicationCheck: { ...check, householdsMatched: { mt_01: ["scenarios.csv"] } } }, listed],
      [{ publicationCheck: { ...check, matches: undefined } }, listed],
      [{ publicationCheck: { ...check, householdsMatched: [] as unknown as Record<string, unknown> } }, listed],
    ] satisfies [Partial<WebSearchAudit>, string][]) {
      expect(() => freePlanFromExport(exp, { models: ["mock-b"], webAudit: { ...searched, ...change } })).toThrow(says);
      // Nobody on the slide searched, so there's nothing to rule out.
      expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: { ...searched, ...change } })).not.toThrow();
    }
  });

  it("tells the presenter, not the slide, about GitHub and Hugging Face searches and results that can't be audited", () => {
    // Three households across the two settings, one of them in both.
    const gh = withSearches("mock-c", "both", { githubHfQueries: 3, githubHfHouseholds: ["mt_02", "mt_05"] }, withSearches("mock-c", "web", { githubHfQueries: 2, githubHfHouseholds: ["mt_05", "mt_07"] }));
    const blind = withSearches("mock-d", "web", { resultsVisible: false }, withSearches("mock-a", "both", { resultsVisible: false }, gh));
    const { pilot, warnings } = freePlanFromExport(exp, { models: ALL, webAudit: blind });
    expect(warnings).toContain("Mock model C searched GitHub or Hugging Face, not naming PolicyBench, in 3 of 20 households; the slide doesn't say so");
    expect(warnings).toContain("Mock model A and Mock model D: the search tool returns no result URLs, so what they read can't be audited; the slide doesn't say so");
    expect(freePlanFromExport(exp, { models: ["mock-d"], webAudit: blind }).warnings).toContain(
      "Mock model D: the search tool returns no result URLs, so what it read can't be audited; the slide doesn't say so",
    );
    expect(pilot.footnotes).toEqual(freePlanFromExport(exp, { models: ALL, webAudit: audit }).pilot.footnotes);
    expect(freePlanFromExport(exp, { models: ALL, webAudit: audit }).warnings.some((w) => w.includes("GitHub") || w.includes("result URLs"))).toBe(false);
    for (const change of [
      { githubHfQueries: 1 },
      { githubHfHouseholds: ["mt_01"] },
      { githubHfQueries: 0, githubHfHouseholds: ["mt_01"] },
      { githubHfQueries: 2, githubHfHouseholds: [] },
      { githubHfQueries: 1, githubHfHouseholds: ["mt_01", "mt_02"] },
      { githubHfQueries: 2, githubHfHouseholds: ["mt_01", "mt_01"] },
      { githubHfQueries: 1.5, githubHfHouseholds: ["mt_01"] },
      { githubHfQueries: 1, githubHfHouseholds: "mt_01" as unknown as string[] },
      { githubHfQueries: 30, githubHfHouseholds: Array.from({ length: 21 }, (_, i) => `mt_${i}`) },
      // More than the queries that don't name PolicyBench, since a query is in one class at most.
      { queries: 40, githubHfQueries: 41, githubHfHouseholds: ["mt_01"] },
      { queries: 1, policyBenchQueries: 1, policyBenchHouseholds: ["mt_01"], githubHfQueries: 1, githubHfHouseholds: ["mt_01"] },
    ] as Partial<WebSearchArm>[]) {
      expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: withSearches("mock-a", "web", change) })).toThrow(
        "Mock model A web: the web-search audit's GitHub and Hugging Face queries don't add up",
      );
    }
  });

  it("tells the presenter, not the slide, the release assets' dates, since the scan checks those instead of reading them", () => {
    const searched = withSearches("mock-b", "web", { policyBenchQueries: 1, policyBenchHouseholds: ["mt_01"] });
    const check = searched.publicationCheck!;
    const warned = (change: Partial<typeof check>) => freePlanFromExport(exp, { models: ["mock-b"], webAudit: { ...searched, publicationCheck: { ...check, ...change } } }).warnings;
    const dated = (newest: string, order: string) =>
      `PolicyBench's release assets are checked by date, not read: the newest was updated ${newest}, ${order} the references were generated October 3, 2026; the slide doesn't say so`;
    expect(warned({})).toContain(dated("September 30, 2026", "before"));
    // A second earlier is before; the same instant isn't.
    expect(warned({ newestReleaseAssetUpdate: "2026-10-03T11:59:59Z" })).toContain(dated("October 3, 2026", "before"));
    expect(warned({ newestReleaseAssetUpdate: "2026-10-03T12:00:00.000Z" })).toContain(dated("October 3, 2026", "not before"));
    expect(warned({ newestReleaseAssetUpdate: "2026-10-04T00:00:00Z" })).toContain(dated("October 4, 2026", "not before"));
    expect(warned({ newestReleaseAssetUpdate: null })).toContain("the web-search audit lists no PolicyBench release assets; the references were generated October 3, 2026");
    const undated = "the web-search audit doesn't give the dates of the references and PolicyBench's release assets; the slide doesn't say so";
    for (const change of [
      { newestReleaseAssetUpdate: undefined },
      { referencesGeneratedAtUtc: undefined },
      { referencesGeneratedAtUtc: undefined, newestReleaseAssetUpdate: null },
      { newestReleaseAssetUpdate: "2026-09-30" },
      { newestReleaseAssetUpdate: "2026-02-30T08:00:00Z" },
      { referencesGeneratedAtUtc: "2026-10-03T24:00:00Z" },
      { referencesGeneratedAtUtc: "2026-10-03T12:00:00+00:00" },
      { newestReleaseAssetUpdate: 1 as unknown as string },
    ]) {
      const w = warned(change);
      expect(w).toContain(undated);
      expect(w.some((x) => x.includes("checked by date") || x.includes("lists no"))).toBe(false);
    }
    // Not on the slide, and not said when nobody on it searched.
    expect(freePlanFromExport(exp, { models: ["mock-b"], webAudit: searched }).pilot.footnotes.join(" ")).not.toMatch(/release|October|September/);
    expect(freePlanFromExport(exp, { models: ["mock-a"], webAudit: searched }).warnings.some((w) => w.includes("release assets"))).toBe(false);
  });

  it("reads a UTC timestamp's day only when the timestamp is one", () => {
    expect(utcDay("2026-10-14T08:23:00Z")).toEqual({ at: Date.UTC(2026, 9, 14, 8, 23), text: "October 14, 2026" });
    expect(utcDay("2026-12-31T23:59:59.999Z")?.text).toBe("December 31, 2026");
    expect(utcDay("2028-02-29T00:00:00Z")?.text).toBe("February 29, 2028");
    for (const s of ["2027-02-29T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-14T08:60:00Z", "2026-10-14 08:23:00Z", "2026-10-14T08:23:00", "", null, 0]) expect(utcDay(s)).toBeNull();
  });

  it("for any audit, names exactly the models on the slide that searched for PolicyBench, each with its households across both web settings", () => {
    const ids = exp.models.map((m) => m.id);
    const households = fc.uniqueArray(fc.constantFrom("h1", "h2", "h3", "h4", "h5"), { maxLength: 5 });
    const arm = households.chain((hh) => fc.record({ hh: fc.constant(hh), extra: fc.nat(3) }));
    fc.assert(
      fc.property(
        fc.record(Object.fromEntries(ids.map((id) => [id, fc.record({ web: arm, both: arm })]))),
        fc.shuffledSubarray(ids, { minLength: 1 }),
        fc.constantFrom<boolean | null>(false, null, true),
        fc.constantFrom<boolean | null | undefined>(false, null, true, undefined),
        (byModel, chosen, answersPublished, matchingAnswersFound) => {
          const webAudit: WebSearchAudit = {
            ...audit,
            answersPublished,
            matchingAnswersFound,
            models: Object.fromEntries(
              ids.map((id) => [
                id,
                Object.fromEntries(
                  (["web", "both"] as const).map((a) => {
                    const { hh, extra } = byModel[id][a];
                    const policyBenchQueries = hh.length ? hh.length + extra : 0;
                    return [a, { households: 20, queries: policyBenchQueries + 10, policyBenchQueries, policyBenchHouseholds: hh, domainBlock: null }];
                  }),
                ),
              ]),
            ),
          };
          // The oracle: the slide's order (free-plan models first, each group as chosen), and each model's distinct households.
          const name = (id: string) => exp.models.find((m) => m.id === id)!;
          const order = [...chosen.filter((id) => name(id).group === "free-plan"), ...chosen.filter((id) => name(id).group !== "free-plan")];
          const expected = order
            .map((id) => ({ model: name(id).model, k: new Set([...byModel[id].web.hh, ...byModel[id].both.hh]).size }))
            .filter((x) => x.k > 0);
          // Only a scan that found no match, with nothing claiming more, clears a model that searched.
          if (expected.length && !(answersPublished === null && matchingAnswersFound === false)) {
            expect(() => freePlanFromExport(exp, { models: chosen, webAudit })).toThrow(/answers are published|doesn't say its scan found no match/);
            return;
          }
          const { pilot, warnings } = freePlanFromExport(exp, { models: chosen, webAudit });
          const said = pilot.footnotes.filter((f) => f.includes("searched for it anyway"));
          expect(warnings.filter((w) => w.includes("searched for PolicyBench in"))).toEqual(
            expected.map((x) => `${x.model} searched for PolicyBench in ${x.k} of 20 households, though told not to; the slide says so`),
          );
          if (!expected.length) {
            expect(said).toEqual([]);
            return;
          }
          expect(said).toHaveLength(1);
          expect(pilot.footnotes.indexOf(said[0])).toBe(1);
          // Each model on the slide is named exactly when it searched, with its own count.
          for (const id of chosen) {
            const hit = expected.find((x) => x.model === name(id).model);
            expect(said[0].includes(`${name(id).model}${hit ? "" : " "}`)).toBe(Boolean(hit));
            if (hit) expect(said[0]).toMatch(new RegExp(`${name(id).model}( searched for it anyway)? in ${hit.k} of 20`));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("for any audit, gives each model on the slide its own two query counts, in the slide's order, and says they fell exactly when each one's did", () => {
    const ids = exp.models.map((m) => m.id);
    const model = (id: string) => exp.models.find((m) => m.id === id)!;
    fc.assert(
      fc.property(
        fc.record(Object.fromEntries(ids.map((id) => [id, fc.record({ web: fc.nat(20_000), both: fc.nat(20_000) })]))),
        fc.shuffledSubarray(ids, { minLength: 1 }),
        (byModel, chosen) => {
          const webAudit: WebSearchAudit = {
            ...audit,
            models: Object.fromEntries(ids.map((id) => [id, Object.fromEntries((["web", "both"] as const).map((a) => [a, { ...audit.models[id][a]!, queries: byModel[id][a] }]))])),
          };
          const { pilot } = freePlanFromExport(exp, { models: chosen, webAudit });
          const said = pilot.footnotes.filter((f) => f.startsWith("Web search queries"));
          expect(said).toHaveLength(1);
          // The oracle: the rows' order, and the counts as en-US writes them.
          const order = pilot.rows.map((r) => exp.models.find((m) => m.model === r.model)!.id);
          expect(order.slice().sort()).toEqual(chosen.slice().sort());
          const parts = order.map((id) => `${model(id).model} from ${byModel[id].web.toLocaleString("en-US")} to ${byModel[id].both.toLocaleString("en-US")}`);
          const listed = parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
          const fell = order.every((id) => byModel[id].both < byModel[id].web);
          expect(said[0]).toBe(`${fell ? "Web search queries fell with the tool available" : "Web search queries, without the tool and with it available"}: ${listed}.`);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("says when a model's tool was told another engine version than the one every calculation ran on, and only for those models", () => {
    const older = (m: ExportModel) => ({ ...m, toolStatedEngine: "policyengine-us 0.0.0-older" })
    const mixed = { ...withModel("mock-c", older), models: withModel("mock-c", older).models.map((m) => (m.id === "mock-d" ? older(m) : m)) };
    const { pilot, warnings } = freePlanFromExport(mixed, { models: ALL });
    const tool = pilot.footnotes.indexOf(
      "The tool runs PolicyEngine (policyengine-us 0.0.0-mock), the engine behind the reference answers, so this shows whether a model can use it, not whether it's right.",
    );
    // Right after the tool's line, which names the engine that ran.
    expect(pilot.footnotes.slice(tool + 1)).toEqual(["Its instructions to Mock model C and Mock model D named policyengine-us 0.0.0-older instead."]);
    expect(warnings).toContain(
      "Mock model C and Mock model D: the tool's instructions named policyengine-us 0.0.0-older, but every calculation ran on policyengine-us 0.0.0-mock; the slide says so",
    );
    // The free-plan models alone were told the engine that ran: nothing to say.
    const free = freePlanFromExport(mixed, { models: ["mock-a", "mock-b"] });
    expect(free.pilot.footnotes.some((f) => f.startsWith("Its instructions"))).toBe(false);
    expect(free.warnings.some((w) => w.includes("instructions named"))).toBe(false);
    // Three models read as a list.
    const three = freePlanFromExport(
      { ...mixed, models: [...mixed.models, { ...older(exp.models.find((m) => m.id === "mock-d")!), id: "mock-e", model: "Mock model E" }] },
      { models: ["mock-c", "mock-d", "mock-e"] },
    ).pilot;
    expect(three.footnotes.at(-1)).toBe("Its instructions to Mock model C, Mock model D and Mock model E named policyengine-us 0.0.0-older instead.");
  });

  it("warns when an older export doesn't say which engine version each tool was told, and refuses a tool told none", () => {
    const unsaid = { ...exp, models: exp.models.map(({ toolStatedEngine: _, ...m }) => m) };
    const { pilot, warnings } = freePlanFromExport(unsaid, { models: ["mock-a"] });
    expect(warnings).toContain("the export doesn't say which engine version each model's tool was told; check its tool line before showing");
    expect(pilot.footnotes.some((f) => f.startsWith("Its instructions"))).toBe(false);
    expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, toolStatedEngine: null })), { models: ["mock-a"] })).toThrow(
      "Mock model A: a tool arm, but no engine named to it",
    );
    expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, toolStatedEngine: " " })), { models: ["mock-a"] })).toThrow(
      "Mock model A: an empty engine named to its tool",
    );
    // The tool footnote names the engine, so an export without one can't say what the tool runs.
    for (const engine of ["", " "]) expect(() => freePlanFromExport({ ...exp, engine }, { models: ["mock-a"] })).toThrow("the export names no engine");
  });

  it("warns about answers that never came back, batches left out and a dirty export tree", () => {
    const messy = {
      ...withModel("mock-a", (m) => ({ ...m, missing: { alone: 0, web: 2, tool: 0, both: 1 }, partialBatches: [{ batch: 3 }] })),
      source: { ...exp.source, scriptTreeDirty: true },
    };
    expect(freePlanFromExport(messy, { models: ["mock-a", "mock-c"], webAudit: audit }).warnings).toEqual([
      "Mock model A: answers counted as misses because none came back (2 web, 1 both)",
      "Mock model A: 1 household batch(es) left out because a setting hadn't reached them",
      "benefit amounts: at most 3 per model, too few to say anything about benefits",
      "the export script ran from a dirty tree",
    ]);
  });

  // MOCK: C and D at 10 mock households with 24 amounts, A and B (the free-plan models) at 20 with 48.
  const arm24 = (k: number) => ({ k, n: 24, pct: (100 * k) / 24, lo: 0, hi: 100 });
  const change24 = (from: number, to: number, spread: number) => {
    const points = (100 * (to - from)) / 24;
    return { points, lo: points - spread, hi: points + spread };
  };
  const at10 = (m: ExportModel, k: [number, number, number, number], spread: number): ExportModel => ({
    ...m,
    households: 10,
    arms: { alone: arm24(k[0]), web: arm24(k[1]), tool: arm24(k[2]), both: arm24(k[3]) },
    vsAlone: { web: change24(k[0], k[1], spread), tool: change24(k[0], k[2], spread), both: change24(k[0], k[3], spread) },
    vsWeb: { both: change24(k[1], k[3], spread) },
  });
  // PolicyBench's two-size wording, written out by hand: the free-plan size first, each size's noise from its own models
  // (A and B: half-widths of 15; C and D: 22 and 31, median 26.5, rounded up to 30), alike from no tools and from web search.
  const TWO_SIZES: PolicyBenchExport = {
    ...exp,
    households: 20,
    models: exp.models.map((m) =>
      m.id === "mock-c" ? at10(m, [15, 16, 22, 22], 22) : m.id === "mock-d" ? at10(m, [12, 14, 20, 21], 31) : m,
    ),
    sizes: [
      { households: 20, n: 48, models: ["mock-a", "mock-b"], noisePoints: 15 },
      { households: 10, n: 24, models: ["mock-c", "mock-d"], noisePoints: 30 },
    ],
    caveat:
      "Preliminary internal pilot on households sampled from PolicyEngine's microdata: 20 households, with 48 nonzero dollar amounts per model and setting, for Mock model A and Mock model B; 10 households, with 24, for Mock model C and Mock model D. The models were called through their APIs with our prompt, not used in the free chat apps, and a change of less than about 15 points between settings is within noise at 20 households (about 30 at 10).",
  };

  it("keeps PolicyBench's caveat for all its models, and drops the single size from the note when they ran on different households", () => {
    const { pilot, warnings } = freePlanFromExport(TWO_SIZES, { models: ALL });
    expect(pilot.caveat).toBe(TWO_SIZES.caveat);
    expect(pilot.note).toBe(
      "Dollar amounts that aren't $0, within $1 of PolicyBench's reference, in households sampled from PolicyEngine's microdata. Each count shows its own total",
    );
    expect(warnings).toContain(
      "the chosen models ran on different households (48 amounts in 20 households; 24 amounts in 10 households); the caveat says which, so read each count against its own total",
    );
    expect(pilot.rows[2].counts.web).toEqual({ k: 16, n: 24 });
  });

  it("rebuilds the caveat for the models on the slide, in PolicyBench's wording, with each size's noise from those models", () => {
    // The free-plan models alone: one size, so PolicyBench's one-size sentence.
    const free = freePlanFromExport(TWO_SIZES, { models: ["mock-b", "mock-a"] }).pilot;
    expect(free.caveat).toBe(
      "Preliminary internal pilot: 20 households sampled from PolicyEngine's microdata, 48 nonzero dollar amounts per model and setting. The models were called through their APIs with our prompt, not used in the free chat apps, and a change of less than about 15 points between settings is within noise at this size.",
    );
    expect(free.note).toBe("Dollar amounts that aren't $0, within $1 of PolicyBench's reference: 48 per model in 20 households sampled from PolicyEngine's microdata");
    // One model of each size: C's noise is its own (half-width 22, rounded up to 25), not the 30 C and D give together.
    expect(freePlanFromExport(TWO_SIZES, { models: ["mock-c", "mock-a"] }).pilot.caveat).toBe(
      "Preliminary internal pilot on households sampled from PolicyEngine's microdata: 20 households, with 48 nonzero dollar amounts per model and setting, for Mock model A; 10 households, with 24, for Mock model C. The models were called through their APIs with our prompt, not used in the free chat apps, and a change of less than about 15 points between settings is within noise at 20 households (about 25 at 10).",
    );
    // No free-plan model: every shown model's intervals set the width.
    expect(freePlanFromExport(TWO_SIZES, { models: ["mock-c", "mock-d"] }).pilot.caveat).toBe(
      "Preliminary internal pilot: 10 households sampled from PolicyEngine's microdata, 24 nonzero dollar amounts per model and setting. The models were called through their APIs with our prompt, not used in the free chat apps, and a change of less than about 30 points between settings is within noise at this size.",
    );
  });

  it("takes the slide's noise width from the change it shows, and checks PolicyBench's caveat by PolicyBench's own", () => {
    // A and B's changes from adding the tool are wider than their changes from no tools: half-widths 22 and 24, median 23, rounded up to 25.
    const half = { "mock-a": 22, "mock-b": 24 } as Record<string, number>;
    const wider = {
      ...exp,
      models: exp.models.map((m) => (half[m.id] ? { ...m, vsWeb: { both: { points: m.vsWeb!.both!.points, lo: m.vsWeb!.both!.points - half[m.id], hi: m.vsWeb!.both!.points + half[m.id] } } } : m)),
    };
    const free = wider.models.filter((m) => m.group === "free-plan");
    expect([noisePoints(free), noisePoints(free, VS_WEB)]).toEqual([15, 25]);
    // The export's caveat, at 15, still passes the check against PolicyBench's rule; the slide says 25.
    expect(freePlanFromExport(wider, { models: ALL }).pilot.caveat).toBe(exp.caveat.replace("about 15 points", "about 25 points"));
    // Where PolicyBench states the width from web search, overall or by size, it has to be the rule's.
    expect(() => freePlanFromExport({ ...wider, noisePointsVsWeb: 25 }, { models: ALL })).not.toThrow();
    expect(() => freePlanFromExport({ ...wider, noisePointsVsWeb: 15 }, { models: ALL })).toThrow(
      "the export's noise width from web search, 15, isn't PolicyBench's rule's for its models, 25",
    );
  });

  it("refuses an export whose noise widths from web search, by size, aren't PolicyBench's rule's", () => {
    const sizes = TWO_SIZES.sizes!;
    const stated = (a?: number, b?: number) => ({ ...TWO_SIZES, sizes: [{ ...sizes[0], noisePointsVsWeb: a }, { ...sizes[1], noisePointsVsWeb: b }] });
    expect(() => freePlanFromExport(stated(15, 30), { models: ALL })).not.toThrow();
    expect(() => freePlanFromExport(stated(), { models: ALL })).not.toThrow();
    for (const [a, b] of [[15, 25], [20, 30], [15, undefined]]) {
      expect(() => freePlanFromExport(stated(a, b), { models: ALL })).toThrow(
        `the export's noise widths from web search, ${JSON.stringify([a, b])}, aren't PolicyBench's rule's for its models, [15,30]`,
      );
    }
  });

  it("refuses an export whose sizes or caveat aren't what PolicyBench's rule gives for its models", () => {
    const sizes = TWO_SIZES.sizes!;
    expect(() => freePlanFromExport({ ...TWO_SIZES, sizes: [{ ...sizes[0], noisePoints: 20 }, sizes[1]] }, { models: ["mock-a"] })).toThrow(
      "the export's sizes aren't its models' sizes",
    );
    expect(() => freePlanFromExport({ ...TWO_SIZES, sizes: [sizes[1], sizes[0]] }, { models: ["mock-a"] })).toThrow("the export's sizes aren't its models' sizes");
    // Any change to the wording, so a subset's caveat can't be built from a template that no longer matches.
    expect(() => freePlanFromExport({ ...TWO_SIZES, caveat: TWO_SIZES.caveat.replace("about 15", "about 10") }, { models: ["mock-a"] })).toThrow(
      "the export's caveat isn't PolicyBench's wording for its models",
    );
    // An export from before sizes still has to match the one-size wording.
    expect(() => freePlanFromExport({ ...exp, caveat: exp.caveat + " " }, { models: ["mock-a"] })).toThrow("the export's caveat isn't PolicyBench's wording");
  });

  it("takes PolicyBench's noise width: the free-plan models' median half-width, rounded up to 5", () => {
    const withHalves = (halves: number[], group: "free-plan" | "other" = "free-plan"): ExportModel => ({
      ...exp.models[1],
      group,
      vsAlone: Object.fromEntries(halves.map((h, i) => [["web", "tool", "both"][i], { points: 0, lo: -h, hi: h }])),
    });
    expect(noisePoints([withHalves([10, 10, 10])])).toBe(10);
    expect(noisePoints([withHalves([10, 11, 30])])).toBe(15);
    // An even count takes the mean of the middle two.
    expect(noisePoints([withHalves([4, 6]), withHalves([20, 30])])).toBe(15);
    // Comparison models' intervals don't count while a free-plan model is there.
    expect(noisePoints([withHalves([7]), withHalves([40, 40, 40], "other")])).toBe(10);
    expect(noisePoints([withHalves([40, 40, 40], "other")])).toBe(40);
    expect(noisePoints([withHalves([])])).toBe(0);
    // A free-plan model with no intervals falls back to every model's, as PolicyBench's does (found by the differential check).
    expect(noisePoints([withHalves([]), withHalves([12, 12], "other")])).toBe(15);
    // The slide's width comes from the change it shows, by the same rule.
    const shown = (h: number, group: "free-plan" | "other" = "free-plan"): ExportModel => ({ ...withHalves([1, 1, 1], group), vsWeb: { both: { points: 0, lo: -h, hi: h } } });
    expect([noisePoints([shown(22), shown(24)]), noisePoints([shown(22), shown(24)], VS_WEB)]).toEqual([5, 25]);
    expect(noisePoints([shown(7), shown(40, "other")], VS_WEB)).toBe(10);
    expect(noisePoints([{ ...shown(7), vsWeb: undefined }], VS_WEB)).toBe(0);
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 60, noNaN: true }), { minLength: 1, maxLength: 9 }), (halves) => {
        const w = noisePoints([withHalves(halves.slice(0, 3)), withHalves(halves.slice(3, 6)), withHalves(halves.slice(6))].filter((m) => Object.keys(m.vsAlone).length));
        const sorted = [...halves].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        expect(w % 5).toBe(0);
        expect(w).toBeGreaterThanOrEqual(median - 1e-9);
        // Less than 5 above it (w − median, since a tiny median plus 5 rounds to 5).
        expect(w - median).toBeLessThan(5 + 1e-9);
      }),
    );
  });

  it("groups models by size as PolicyBench does: the free-plan models' size first, then larger ones, in the export's order", () => {
    const groups = sizeGroups(TWO_SIZES.models);
    expect(groups.map((g) => [g.households, g.n, g.models])).toEqual([
      [20, 48, ["mock-a", "mock-b"]],
      [10, 24, ["mock-c", "mock-d"]],
    ]);
    // Without a free-plan model, the larger size leads.
    const others = TWO_SIZES.models.filter((m) => m.group === "other").concat(TWO_SIZES.models.filter((m) => m.group === "free-plan").map((m) => ({ ...m, group: "other" as const, freePlan: null })));
    expect(sizeGroups(others).map((g) => g.households)).toEqual([20, 10]);
    expect(() => sizeGroups([{ ...exp.models[0], arms: { ...exp.models[0].arms, both: arm24(3) } }])).toThrow("settings score different numbers of amounts");
    expect(() => caveatText([])).toThrow("no models");
  });

  it("gives any consistent export a slide that passes its checks, with each share its export percent made whole", () => {
    const count = (n: number) => fc.integer({ min: 0, max: n });
    const model = fc
      .integer({ min: 1, max: 400 })
      .chain((n) =>
        fc.tuple(fc.constant(n), count(n), count(n), count(n), count(n), fc.double({ min: 0, max: 30, noNaN: true }), fc.double({ min: 0, max: 30, noNaN: true }), fc.boolean(), fc.boolean()),
      );
    fc.assert(
      fc.property(fc.array(model, { minLength: 1, maxLength: 6 }), (specs) => {
        const models: ExportModel[] = specs.map(([n, alone, web, tool, both, spread, shownSpread, free, exact], i) => {
          const arm = (k: number) => ({ k, n, pct: (100 * k) / n, lo: 0, hi: 100 });
          // As the export writes them: the change and its interval's ends to one decimal, so an interval can collapse onto a
          // rounded change; and, for some, the ends unrounded too.
          const oneDecimal = (x: number) => Math.round(x * 10) / 10;
          const exported = (from: number, to: number, s: number, unrounded = false) => {
            const points = (100 * (to - from)) / n;
            const [lo, hi] = [Math.max(-100, points - s), Math.min(100, points + s)];
            return { points: oneDecimal(points), lo: oneDecimal(lo), hi: oneDecimal(hi), ...(unrounded ? { loExact: lo, hiExact: hi } : {}) };
          };
          return {
            ...exp.models[0],
            id: `m${i}`,
            model: `Mock model ${i}`,
            group: free ? "free-plan" : "other",
            freePlan: free ? "Mock Free" : null,
            arms: { alone: arm(alone), web: arm(web), tool: arm(tool), both: arm(both) },
            // A bootstrap of a difference of two shares stays within 100 points either way.
            vsAlone: { tool: exported(alone, tool, spread) },
            vsWeb: { both: exported(web, both, shownSpread, exact) },
          };
        });
        const consistent = { ...exp, models, sizes: undefined, caveat: caveatText(sizeGroups(models)) };
        const { pilot } = freePlanFromExport(consistent, { models: models.map((m) => m.id) });
        expect(freePlanProblems(pilot)).toEqual([]);
        // PolicyBench's wording, with the noise of the change the slide shows.
        expect(pilot.caveat).toBe(caveatText(sizeGroups(models, VS_WEB)));
        // A slide of the first model alone describes only its size.
        const one = freePlanFromExport(consistent, { models: [models[0].id] }).pilot;
        expect(one.caveat).toMatch(new RegExp(`^Preliminary internal pilot: 20 households sampled from PolicyEngine's microdata, ${models[0].arms.alone!.n} nonzero`));
        for (const r of pilot.rows) {
          const m = models.find((x) => x.model === r.model)!;
          for (const a of EXPORT_ARMS) expect(Math.abs(wholeShare(r.counts[a.id]!) - m.arms[a.id]!.pct)).toBeLessThanOrEqual(0.5 + 1e-9);
          // The interval's ends as PolicyBench gives them, unrounded where it can.
          const c = m.vsWeb!.both!;
          expect([r.bothVsWeb.lo, r.bothVsWeb.hi]).toEqual(c.loExact === undefined ? [c.lo, c.hi] : [c.loExact, c.hiExact]);
        }
        const firstOther = pilot.rows.findIndex((r) => r.freePlan === null);
        if (firstOther >= 0) expect(pilot.rows.slice(firstOther).every((r) => r.freePlan === null)).toBe(true);
      }),
    );
  });
});

describe("runDateRange", () => {
  it("names one day, consecutive days in a month, and a run across months", () => {
    expect(runDateRange(["2026-10-23"])).toBe("October 23, 2026");
    expect(runDateRange(["2026-10-24", "2026-10-23", "2026-10-24"])).toBe("October 23–24, 2026");
    expect(runDateRange(["2026-11-01", "2026-10-31"])).toBe("October 31, 2026 to November 1, 2026");
    expect(runDateRange(["2026-12-31", "2027-01-01"])).toBe("December 31, 2026 to January 1, 2027");
  });

  it("refuses no dates and a date that isn't YYYY-MM-DD", () => {
    expect(() => runDateRange([])).toThrow("no run dates");
    expect(() => runDateRange(["2026-10-23 UTC"])).toThrow("run date 2026-10-23 UTC isn't YYYY-MM-DD");
    for (const d of ["2026-13-99", "2026-00-10", "2026-02-29", "2026-04-31"]) expect(() => runDateRange([d])).toThrow(`run date ${d} isn't a date`);
    expect(runDateRange(["2028-02-29"])).toBe("February 29, 2028");
    expect(runDateRange(["0099-01-01"])).toBe("January 1, 99");
  });
});

describe("writePilotInto", () => {
  const block = (body: string) => `before\n// BEGIN FREE_PLAN_PILOT: old note\n${body}\n// END FREE_PLAN_PILOT\nafter\n`;
  const pilot = freePlanFromExport(exp, { models: ALL }).pilot;

  it("replaces only the block, keeps its markers, and can replace it again", () => {
    const once = writePilotInto(block("export const FREE_PLAN_PILOT: FreePlanPilot | null = null;"), pilot, ["From mock.json"]);
    expect(once.startsWith("before\n// BEGIN FREE_PLAN_PILOT: scripts/aspen-free-plan.ts --write replaces this block.\n// From mock.json\n")).toBe(true);
    expect(once.endsWith("\n// END FREE_PLAN_PILOT\nafter\n")).toBe(true);
    const json = once.slice(once.indexOf("= ") + 2, once.lastIndexOf(";"));
    expect(JSON.parse(json) as FreePlanPilot).toEqual(pilot);
    expect(writePilotInto(once, pilot, ["From mock.json"])).toBe(once);
    expect(writePilotInto(once, null, [])).toBe(
      "before\n// BEGIN FREE_PLAN_PILOT: scripts/aspen-free-plan.ts --write replaces this block.\nexport const FREE_PLAN_PILOT: FreePlanPilot | null = null;\n// END FREE_PLAN_PILOT\nafter\n",
    );
  });

  it("refuses content without exactly one block", () => {
    const err = "content.ts needs exactly one FREE_PLAN_PILOT block";
    expect(() => writePilotInto("no block", pilot, [])).toThrow(err);
    expect(() => writePilotInto("// END FREE_PLAN_PILOT\n// BEGIN FREE_PLAN_PILOT", pilot, [])).toThrow(err);
    expect(() => writePilotInto(block("x") + block("y"), pilot, [])).toThrow(err);
  });

  it("finds the one block in content.ts, so --write has somewhere to go", () => {
    const content = readFileSync("src/lib/aspen/content.ts", "utf8");
    // Whatever the block holds now, emptying it leaves the rest of the file as it was.
    const emptied = writePilotInto(content, null, []);
    const outside = (s: string) => [s.slice(0, s.indexOf("// BEGIN FREE_PLAN_PILOT")), s.slice(s.indexOf("// END FREE_PLAN_PILOT"))];
    expect(outside(emptied)).toEqual(outside(content));
    expect(writePilotInto(emptied, null, [])).toBe(emptied);
  });
});

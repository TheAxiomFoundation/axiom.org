import fc from "fast-check";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOCK_POLICYBENCH_EXPORT, MOCK_WEB_SEARCH_AUDIT } from "@/test/aspen-free-plan-export.mock";
import { formatPoints, freePlanProblems, shownChange, wholeShare, type FreePlanPilot } from "./content";
import {
  EXPORT_ARMS,
  caveatText,
  freePlanFromExport,
  noisePoints,
  runDateRange,
  sizeGroups,
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
    expect(a.counts).toEqual({ alone: { k: 10, n: 48 }, web: { k: 15, n: 48 }, tool: { k: 38, n: 48 }, both: { k: 39, n: 48 } });
    expect(a.toolVsAlone).toEqual({ points: (100 * 28) / 48, lo: (100 * 28) / 48 - 15, hi: (100 * 28) / 48 + 15 });
    // The bootstrap percent and interval stay in the export; the slide shows k of n.
    expect(Object.keys(a.counts.alone!)).toEqual(["k", "n"]);
    expect(pilot.arms).toBe(EXPORT_ARMS);
    expect(freePlanProblems(pilot)).toEqual([]);
  });

  it("says what is counted, where it comes from and that it's preliminary", () => {
    const { pilot } = freePlanFromExport(exp, { models: ALL });
    expect(pilot.title).toBe("The models on free plans, with web search and with the tool");
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
    expect(pilot.title).toBe("The same models, with web search and with the tool");
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
    // Any of a chosen model's changes, since each feeds the caveat's noise width.
    for (const [lo, hi] of [[-1e308, 10], [0, 1e308], [5, 1], [NaN, 1]]) {
      expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, vsAlone: { ...m.vsAlone, web: { points: 1, lo, hi } } })), { models: ["mock-a"] })).toThrow(
        `Mock model A web: change 1 with interval ${lo} to ${hi} isn't a change in points`,
      );
    }
    expect(() => freePlanFromExport(withModel("mock-a", (m) => ({ ...m, vsAlone: { web: m.vsAlone.web } })), { models: ["mock-a"] })).toThrow(
      "Mock model A: no change from no tools to the tool",
    );
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
    // A's counts give 58.33; the export's one decimal passes, and the slide keeps the exact difference.
    const rounded = withModel("mock-a", (m) => ({ ...m, vsAlone: { ...m.vsAlone, tool: { ...m.vsAlone.tool!, points: 58.3 } } }));
    expect(freePlanFromExport(rounded, { models: ["mock-a"] }).pilot.rows[0].toolVsAlone.points).toBe((100 * 28) / 48);
    for (const points of [58.8, 50]) {
      const off = withModel("mock-a", (m) => ({ ...m, vsAlone: { ...m.vsAlone, tool: { ...m.vsAlone.tool!, points } } }));
      expect(() => freePlanFromExport(off, { models: ["mock-a"] })).toThrow(`Mock model A: change ${points}, but its counts give 58.33`);
    }
  });

  it("makes the change exact even where that sits just past the export's rounded interval, and the slide prints it at that end", () => {
    // aspen_export.py's own output for a synthetic run review 5 made: 100 households, one tool success
    // in each and none without tools, eight amounts in all but one, which has nine. It rounds the change
    // and both ends to 12.5; the counts give 12.48, which alone would print as +12 beside +13 to +13.
    const c = (k: number) => ({ k, n: 801, pct: Math.round((1000 * k) / 801) / 10, lo: 0, hi: 100 });
    const one: ExportModel = {
      ...exp.models.find((m) => m.id === "mock-a")!,
      households: 100,
      arms: { alone: c(0), web: c(0), tool: c(100), both: c(100) },
      vsAlone: { web: { points: 0, lo: 0, hi: 0 }, tool: { points: 12.5, lo: 12.5, hi: 12.5 }, both: { points: 12.5, lo: 12.5, hi: 12.5 } },
    };
    const run = { ...exp, models: [one], sizes: undefined, caveat: caveatText(sizeGroups([one])) };
    const change = freePlanFromExport(run, { models: [one.id] }).pilot.rows[0].toolVsAlone;
    expect(change).toEqual({ points: (100 * 100) / 801, lo: 12.5, hi: 12.5 });
    expect([shownChange(change), change.lo, change.hi].map(formatPoints)).toEqual(["+13", "+13", "+13"]);
  });

  it("refuses data the slide's own checks reject, and says which", () => {
    const off = withModel("mock-a", (m) => ({ ...m, vsAlone: { ...m.vsAlone, tool: { points: (100 * 28) / 48, lo: 60, hi: 70 } } }));
    expect(() => freePlanFromExport(off, { models: ["mock-a"] })).toThrow(
      `the export fails the slide's checks:\n- Mock model A: ${(100 * 28) / 48} is outside its interval 60 to 70`,
    );
    const seven = { ...exp, models: Array.from({ length: 7 }, (_, i) => ({ ...exp.models[0], id: `m${i}`, model: `Mock model ${i}` })) };
    expect(() => freePlanFromExport(seven, { models: seven.models.map((m) => m.id) })).toThrow("7 rows; the slide fits 1 to 6");
  });

  it("always warns how few benefit amounts there are, and only that when the export is clean and its searches audited", () => {
    expect(freePlanFromExport(exp, { models: ALL, webAudit: audit }).warnings).toEqual(["benefit amounts: at most 3 per model, too few to say anything about benefits"]);
    const none = withModel("mock-a", (m) => ({ ...m, benefits: {} }));
    expect(freePlanFromExport(none, { models: ["mock-a"], webAudit: audit }).warnings).toEqual([
      "benefit amounts: none in these households, so this says nothing about benefits",
    ]);
  });

  it("warns when no web-search audit is given, since the slide can't then say whether a model searched for PolicyBench", () => {
    const { pilot, warnings } = freePlanFromExport(exp, { models: ALL });
    expect(warnings).toContain("no web-search audit given, so the slide doesn't say whether a model searched for PolicyBench; pass --web-audit");
    expect(pilot.footnotes).toEqual(freePlanFromExport(exp, { models: ALL, webAudit: audit }).pilot.footnotes);
  });

  it("says which models on the slide searched for PolicyBench anyway, in how many households, and that no answers are published", () => {
    const web = "Web search is each provider's own search tool, told not to search PolicyBench.";
    // B searched in three households across its two web settings, one of them in both.
    const b = withSearches("mock-b", "both", { queries: 30, policyBenchQueries: 2, policyBenchHouseholds: ["mt_04"] }, withSearches("mock-b", "web", { policyBenchQueries: 5, policyBenchHouseholds: ["mt_01", "mt_04", "mt_09"] }));
    const one = freePlanFromExport(exp, { models: ALL, webAudit: b });
    // Right after the web line, which says they were told not to.
    expect(one.pilot.footnotes.slice(0, 2)).toEqual([web, "Mock model B searched for it anyway in 3 of 20 households; PolicyBench has published no answers for these households."]);
    expect(one.warnings).toContain("Mock model B searched for PolicyBench in 3 of 20 households, though told not to; the slide says so");
    // Not on the slide, not in the footnote.
    const without = freePlanFromExport(exp, { models: ["mock-a", "mock-c"], webAudit: b });
    expect(without.pilot.footnotes[1]).toMatch(/^The tool runs/);
    expect(without.warnings.some((w) => w.includes("searched for PolicyBench"))).toBe(false);
    // Two read as a list, the first with the full wording.
    const two = freePlanFromExport(exp, { models: ALL, webAudit: withSearches("mock-c", "web", { policyBenchQueries: 1, policyBenchHouseholds: ["mt_02"] }, b) }).pilot;
    expect(two.footnotes[1]).toBe(
      "Mock model B searched for it anyway in 3 of 20 households and Mock model C in 1 of 20; PolicyBench has published no answers for these households.",
    );
  });

  it("refuses a web-search audit that doesn't cover a model on the slide, doesn't add up, or doesn't rule out published answers", () => {
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
    for (const answersPublished of [null, true]) {
      expect(() => freePlanFromExport(exp, { models: ["mock-b"], webAudit: { ...searched, answersPublished } })).toThrow(
        "Mock model B searched for PolicyBench, and the web-search audit doesn't rule out published answers for these households",
      );
      // Nobody on the slide searched, so published answers or not, there's nothing to rule out.
      expect(() => freePlanFromExport(exp, { models: ["mock-a"], webAudit: { ...searched, answersPublished } })).not.toThrow();
    }
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
        (byModel, chosen, answersPublished) => {
          const webAudit: WebSearchAudit = {
            ...audit,
            answersPublished,
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
          if (expected.length && answersPublished !== false) {
            expect(() => freePlanFromExport(exp, { models: chosen, webAudit })).toThrow("doesn't rule out published answers");
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
  });
  // PolicyBench's two-size wording, written out by hand: the free-plan size first, each size's noise from its own models
  // (A and B: half-widths of 15 and 16.5, median 15; C and D: 22 and 31, median 26.5, rounded up to 30).
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
    expect(pilot.rows[2].counts.alone).toEqual({ k: 15, n: 24 });
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
      .chain((n) => fc.tuple(fc.constant(n), count(n), count(n), count(n), count(n), fc.double({ min: 0, max: 30, noNaN: true }), fc.boolean()));
    fc.assert(
      fc.property(fc.array(model, { minLength: 1, maxLength: 6 }), (specs) => {
        const models: ExportModel[] = specs.map(([n, alone, web, tool, both, spread, free], i) => {
          const arm = (k: number) => ({ k, n, pct: (100 * k) / n, lo: 0, hi: 100 });
          // As the export writes them: the change and its interval's ends to one decimal, so an interval can collapse onto a rounded change.
          const points = (100 * (tool - alone)) / n;
          const oneDecimal = (x: number) => Math.round(x * 10) / 10;
          return {
            ...exp.models[0],
            id: `m${i}`,
            model: `Mock model ${i}`,
            group: free ? "free-plan" : "other",
            freePlan: free ? "Mock Free" : null,
            arms: { alone: arm(alone), web: arm(web), tool: arm(tool), both: arm(both) },
            // A bootstrap of a difference of two shares stays within 100 points either way.
            vsAlone: { tool: { points: oneDecimal(points), lo: oneDecimal(Math.max(-100, points - spread)), hi: oneDecimal(Math.min(100, points + spread)) } },
          };
        });
        const consistent = { ...exp, models, sizes: undefined, caveat: caveatText(sizeGroups(models)) };
        const { pilot } = freePlanFromExport(consistent, { models: models.map((m) => m.id) });
        expect(freePlanProblems(pilot)).toEqual([]);
        expect(pilot.caveat).toBe(consistent.caveat);
        // A slide of the first model alone describes only its size.
        const one = freePlanFromExport(consistent, { models: [models[0].id] }).pilot;
        expect(one.caveat).toMatch(new RegExp(`^Preliminary internal pilot: 20 households sampled from PolicyEngine's microdata, ${models[0].arms.alone!.n} nonzero`));
        for (const r of pilot.rows) {
          const m = models.find((x) => x.model === r.model)!;
          for (const a of EXPORT_ARMS) expect(Math.abs(wholeShare(r.counts[a.id]!) - m.arms[a.id]!.pct)).toBeLessThanOrEqual(0.5 + 1e-9);
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
    expect(writePilotInto(content, null, [])).toBe(content);
  });
});

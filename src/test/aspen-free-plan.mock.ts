import type { FreePlanPilot } from "@/lib/aspen/content";

/**
 * MOCK DATA for tests and layout checks only: invented counts in the shape of
 * PolicyBench's free-plan pilot, not results and not derived from any run. Six models, the most the slide
 * is laid out for, with one change whose interval includes zero. The label
 * says MOCK so a screenshot of it can't pass for the real slide.
 */
export const MOCK_FREE_PLAN_PILOT: FreePlanPilot = {
  title: "The models on free plans, with and without the tool",
  label: "MOCK DATA, not results",
  note: "Dollar amounts that aren't $0, within $1 of the reference: about 50 per model in mock households",
  arms: [
    { id: "web", label: "Web search available" },
    { id: "both", label: "Web search and the PolicyEngine tool available" },
  ],
  rows: [
    {
      model: "Mock model A",
      freePlan: "On mock plan A",
      counts: { web: { k: 20, n: 48 }, both: { k: 41, n: 48 } },
      bothVsWeb: { points: 43.8, lo: 27, hi: 59 },
    },
    {
      model: "Mock model B",
      freePlan: "On mock plan B",
      counts: { web: { k: 26, n: 48 }, both: { k: 37, n: 48 } },
      bothVsWeb: { points: 22.9, lo: 6, hi: 40 },
    },
    {
      model: "Mock model C",
      freePlan: "On mock plan C",
      counts: { web: { k: 13, n: 47 }, both: { k: 16, n: 47 } },
      bothVsWeb: { points: 6.4, lo: -11, hi: 25 },
    },
    {
      model: "Mock model D",
      freePlan: null,
      counts: { web: { k: 33, n: 48 }, both: { k: 45, n: 48 } },
      bothVsWeb: { points: 25, lo: 13, hi: 37 },
    },
    {
      model: "Mock model E",
      freePlan: null,
      counts: { web: { k: 36, n: 48 }, both: { k: 46, n: 48 } },
      bothVsWeb: { points: 20.8, lo: 9, hi: 33 },
    },
    {
      model: "Mock model F",
      freePlan: null,
      counts: { web: { k: 30, n: 48 }, both: { k: 47, n: 48 } },
      bothVsWeb: { points: 35.4, lo: 22, hi: 49 },
    },
  ],
  caveat:
    "MOCK caveat: invented counts for a layout check. Read each model's change from adding the tool, not gaps between models.",
  footnotes: [
    "MOCK footnote: web search is each provider's own search tool.",
    "MOCK footnote: the tool runs the engine behind the reference answers.",
  ],
  source: "MOCK source line · not a PolicyBench result",
};

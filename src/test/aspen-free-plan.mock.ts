import type { FreePlanPilot } from "@/lib/aspen/content";

/**
 * MOCK DATA for tests and layout checks only: invented counts in the shape of
 * PolicyBench's free-plan pilot, not results and not derived from any run. Six models, the most the slide
 * is laid out for, with one change whose interval includes zero. The label
 * says MOCK so a screenshot of it can't pass for the real slide.
 */
export const MOCK_FREE_PLAN_PILOT: FreePlanPilot = {
  title: "The models on free plans, with web search and with the tool",
  label: "MOCK DATA, not results",
  note: "Dollar amounts that aren't $0, within $1 of the reference: about 50 per model in mock households",
  arms: [
    { id: "alone", label: "On its own" },
    { id: "web", label: "With web search" },
    { id: "tool", label: "With the PolicyEngine tool" },
    { id: "both", label: "With both" },
  ],
  rows: [
    {
      model: "Mock model A",
      freePlan: "On mock plan A",
      counts: { alone: { k: 12, n: 48 }, web: { k: 20, n: 48 }, tool: { k: 40, n: 48 }, both: { k: 41, n: 48 } },
      toolVsAlone: { points: 58.3, lo: 41, hi: 73 },
    },
    {
      model: "Mock model B",
      freePlan: "On mock plan B",
      counts: { alone: { k: 22, n: 48 }, web: { k: 26, n: 48 }, tool: { k: 35, n: 48 }, both: { k: 37, n: 48 } },
      toolVsAlone: { points: 27.1, lo: 9, hi: 44 },
    },
    {
      model: "Mock model C",
      freePlan: "On mock plan C",
      counts: { alone: { k: 9, n: 47 }, web: { k: 13, n: 47 }, tool: { k: 12, n: 47 }, both: { k: 16, n: 47 } },
      toolVsAlone: { points: 6.4, lo: -11, hi: 25 },
    },
    {
      model: "Mock model D",
      freePlan: null,
      counts: { alone: { k: 31, n: 48 }, web: { k: 33, n: 48 }, tool: { k: 44, n: 48 }, both: { k: 45, n: 48 } },
      toolVsAlone: { points: 27.1, lo: 15, hi: 39 },
    },
    {
      model: "Mock model E",
      freePlan: null,
      counts: { alone: { k: 35, n: 48 }, web: { k: 36, n: 48 }, tool: { k: 47, n: 48 }, both: { k: 46, n: 48 } },
      toolVsAlone: { points: 25, lo: 13, hi: 37 },
    },
    {
      model: "Mock model F",
      freePlan: null,
      counts: { alone: { k: 18, n: 48 }, web: { k: 30, n: 48 }, tool: { k: 46, n: 48 }, both: { k: 47, n: 48 } },
      toolVsAlone: { points: 58.3, lo: 44, hi: 71 },
    },
  ],
  caveat:
    "MOCK caveat: invented counts for a layout check. Read each model's change, not gaps between models.",
  footnotes: [
    "MOCK footnote: the models on free plans, named and sourced.",
    "MOCK footnote: web search is each provider's own search tool.",
  ],
  source: "MOCK source line · not a PolicyBench result",
};

import {
  acceptedSeries,
  citationPrograms,
  moduleLedger,
  programIndex,
  UNTAGGED,
  type AcceptedSeries,
  type ModuleLedger,
} from "./accepted-modules";
import { getBundleIndex } from "./program-bundles-data";
import { getPipelineEvents, getStationTargets, type EventsOrigin } from "./pipeline-events-data";
import type { PipelineEvent } from "./pipeline-events";
import { mineFlow, type FlowModel, type Population, type WorkflowSignal } from "./pipeline-flow";
import { getWorkflowHealth, gradeWorkflow, WORKFLOWS, type WorkflowSpec } from "./workflow-health";

/** The workflows /ops watches, and the axiom-api ones the flow depends on. */
export const FLOW_WORKFLOWS: WorkflowSpec[] = [
  ...WORKFLOWS,
  {
    repo: "axiom-api",
    file: "bump-artifact-pins.yml",
    label: "axiom-api pin bump",
    does: "Moves axiom-api onto the newest corpus and RuleSpec artifacts",
  },
  {
    repo: "axiom-api",
    file: "compile-sweep.yml",
    label: "Compile sweep",
    does: "Compiles every indexed module nightly (the Compile station)",
  },
];

export const WINDOW_OPTIONS = [7, 30, 90] as const;
export const DEFAULT_WINDOW = 30;

const POPULATIONS: Population[] = ["all", "runs", "prs", "modules"];

/** The line's population from a query value; every case by default. */
export function parsePopulation(value: string | string[] | null | undefined): Population {
  const v = Array.isArray(value) ? value[0] : value;
  return POPULATIONS.includes(v as Population) ? (v as Population) : "all";
}

export function parseWindow(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (WINDOW_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_WINDOW;
}

export interface FlowData {
  model: FlowModel;
  events: PipelineEvent[];
  origin: EventsOrigin;
  targetsSeeded: boolean;
  error: string | null;
}

/** Dated items the events carry: waiver expiry, failure-bundle retention. */
export function eventDeadlines(events: PipelineEvent[], now: number): Array<{ label: string; at: string; href: string | null }> {
  const waivers = new Map<string, { repo: string; at: string; count: number; href: string | null }>();
  const bundles = new Map<string, number>();
  for (const e of events) {
    const expires = typeof e.attrs?.expires_at === "string" ? e.attrs.expires_at : null;
    if (e.source === "waiver_ledger" && expires) {
      const repo = String(e.attrs.repo ?? e.jurisdiction ?? "");
      const key = `${repo}|${expires}`;
      const entry = waivers.get(key) ?? { repo, at: expires, count: 0, href: `https://github.com/TheAxiomFoundation/${repo}/blob/main/known-validation-gaps.yaml` };
      entry.count++;
      waivers.set(key, entry);
    }
    const bundleExpires = typeof e.attrs?.bundle_expires_at === "string" ? e.attrs.bundle_expires_at : null;
    if (bundleExpires && Date.parse(bundleExpires) > now) bundles.set(e.case_id, Date.parse(bundleExpires));
  }
  const out = [...waivers.values()].map((w) => ({
    label: `${w.count.toLocaleString("en-US")} ${w.repo} validation waivers expire`,
    at: new Date(w.at).toISOString(),
    href: w.href,
  }));
  if (bundles.size) {
    const first = Math.min(...bundles.values());
    const soon = [...bundles.values()].filter((t) => t - first < 30 * 86_400_000).length;
    out.push({
      label: `${soon} failure bundles start to expire on GitHub (archive them)`,
      at: new Date(first).toISOString(),
      href: "https://github.com/TheAxiomFoundation/axiom-encode/actions/workflows/targeted-signed-reencode.yml",
    });
  }
  return out;
}

/** Everything /ops/flow and /api/ops/flow need, mined once per request. */
export async function loadFlow(options: { days: number; jurisdiction: string | null; population?: Population; now?: number }): Promise<FlowData> {
  const now = options.now ?? Date.now();
  const [events, targets, workflows] = await Promise.all([
    getPipelineEvents(),
    getStationTargets(),
    getWorkflowHealth(FLOW_WORKFLOWS).catch(() => []),
  ]);
  const signals: WorkflowSignal[] = workflows.map((w) => {
    const { grade, reason } = gradeWorkflow(w, w.read, now);
    return { label: w.label, grade, url: w.url, detail: reason };
  });
  const model = mineFlow(events.events, {
    now,
    days: options.days,
    jurisdiction: options.jurisdiction,
    population: options.population,
    targets: targets.targets,
    workflows: signals,
    deadlines: eventDeadlines(events.events, now),
  });
  return { model, events: events.events, origin: events.origin, targetsSeeded: targets.seeded, error: events.error };
}

/**
 * The weekly strict-accepted module count, by route, sub-route and program,
 * with rework and the modules not measured, from the
 * event log. Events the backfill tagged carry their programs; untagged ones
 * (events derived from pipeline_attempts at request time) are looked up in
 * the bundle tables here, only for the accepted modules. When that lookup
 * finds nothing at all (the tables are unreachable), they stay `untagged`
 * rather than read as out of plan.
 */
export async function loadAccepted(events: PipelineEvent[], now = Date.now()): Promise<AcceptedSeries & { modules: ModuleLedger }> {
  const ledger = moduleLedger(events);
  const untagged = ledger.accepted.filter((m) => m.programs.includes(UNTAGGED));
  if (untagged.length) {
    const members = await getBundleIndex([...new Set(untagged.map((m) => m.citation))]).catch(() => []);
    if (members.length) {
      const index = programIndex(members);
      for (const m of untagged) m.programs = citationPrograms(m.citation, index);
    }
  }
  return { ...acceptedSeries(ledger, now), modules: ledger };
}

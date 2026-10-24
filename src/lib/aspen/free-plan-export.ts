import {
  freePlanProblems,
  type FreePlanPilot,
  type PilotChange,
  type PilotCount,
  type ToolPilotArmId,
} from "./content";

/**
 * The JSON PolicyBench's free-plan pilot exports for this slide
 * (scripts/aspen_export.py in the pilot's review folder). Only the fields the
 * slide reads, or checks, are typed; the rest pass through unread.
 */
export interface PolicyBenchExport {
  households: number;
  engine: string;
  caveat: string;
  models: ExportModel[];
  source?: { scriptCommit?: string; scriptTreeDirty?: boolean; generatedAtUtc?: string };
}

export interface ExportModel {
  model: string;
  id: string;
  group: "free-plan" | "other";
  /** The free plan, as PolicyBench names it, e.g. "ChatGPT Free"; null when the model isn't a free-plan default. */
  freePlan: string | null;
  freePlanBasis: string;
  households: number;
  partialBatches: unknown[];
  /** ISO dates, e.g. "2026-10-24". */
  runDates: string[];
  /** pct is 100k/n, with its household-bootstrap interval. */
  arms: Partial<Record<ToolPilotArmId, ExportArm>>;
  missing: Partial<Record<ToolPilotArmId, number>>;
  vsAlone: Partial<Record<Exclude<ToolPilotArmId, "alone">, PilotChange>>;
  benefits: Partial<Record<ToolPilotArmId, PilotCount>>;
}

export interface ExportArm extends PilotCount {
  pct: number;
  lo: number;
  hi: number;
}

export interface ExportOptions {
  /** Export ids, in the order to show them; free-plan models move to the front. */
  models: readonly string[];
  title?: string;
  label?: string;
}

export const EXPORT_ARMS: FreePlanPilot["arms"] = [
  { id: "alone", label: "On its own" },
  { id: "web", label: "With web search" },
  { id: "tool", label: "With the PolicyEngine tool" },
  { id: "both", label: "With both" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 23, 2026", or "October 23–24, 2026" for a run over consecutive days in one month. */
export function runDateRange(dates: readonly string[]): string {
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) throw new Error("no run dates");
  const parts = sorted.map((d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) throw new Error(`run date ${d} isn't YYYY-MM-DD`);
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  });
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first.y !== last.y || first.m !== last.m) {
    return `${MONTHS[first.m - 1]} ${first.d}, ${first.y} to ${MONTHS[last.m - 1]} ${last.d}, ${last.y}`;
  }
  const day = first.d === last.d ? `${first.d}` : `${first.d}–${last.d}`;
  return `${MONTHS[first.m - 1]} ${day}, ${first.y}`;
}

/** "A", "A and B", "A, B and C". */
function list(names: readonly string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The slide's data from PolicyBench's export, for the chosen models. It
 * throws on anything that would put a wrong number on the screen, and
 * returns warnings for what the presenter should know: missing answers
 * counted as misses, batches left out, models on different households, and
 * how few benefit amounts there are.
 */
export function freePlanFromExport(exp: PolicyBenchExport, opts: ExportOptions): { pilot: FreePlanPilot; warnings: string[] } {
  const warnings: string[] = [];
  const byId = new Map(exp.models.map((m) => [m.id, m]));
  const unknown = opts.models.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`not in the export: ${unknown.join(", ")}`);
  if (new Set(opts.models).size !== opts.models.length) throw new Error("a model is chosen twice");
  const chosen = opts.models.map((id) => byId.get(id) as ExportModel);
  // Free-plan models first, each group in the order chosen.
  const ordered = [...chosen.filter((m) => m.group === "free-plan"), ...chosen.filter((m) => m.group !== "free-plan")];
  for (const m of ordered) {
    if ((m.group === "free-plan") !== (m.freePlan !== null)) {
      throw new Error(`${m.model}: group ${m.group} but freePlan ${JSON.stringify(m.freePlan)}`);
    }
    const tool = m.vsAlone.tool;
    if (!tool) throw new Error(`${m.model}: no change from no tools to the tool`);
    for (const arm of EXPORT_ARMS) {
      const c = m.arms[arm.id];
      if (!c) throw new Error(`${m.model}: no count for ${arm.id}`);
      // The slide shows k of n; the export's own percent must say the same.
      if (!(c.n > 0) || Math.abs(c.pct - (100 * c.k) / c.n) > 0.05) throw new Error(`${m.model} ${arm.id}: ${c.pct}% isn't ${c.k} of ${c.n}`);
    }
    const missed = EXPORT_ARMS.filter((a) => (m.missing[a.id] ?? 0) > 0).map((a) => `${m.missing[a.id]} ${a.id}`);
    if (missed.length) warnings.push(`${m.model}: answers counted as misses because none came back (${missed.join(", ")})`);
    if (m.partialBatches.length) warnings.push(`${m.model}: ${m.partialBatches.length} household batch(es) left out because a setting hadn't reached them`);
  }

  const sizes = [...new Set(ordered.map((m) => `${m.arms.alone!.n}|${m.households}`))];
  const [n, households] = sizes[0].split("|").map(Number);
  let note: string;
  if (sizes.length === 1) {
    note = `Dollar amounts that aren't $0, within $1 of PolicyBench's reference: ${n} per model in ${households} households sampled from PolicyEngine's microdata`;
  } else {
    note = "Dollar amounts that aren't $0, within $1 of PolicyBench's reference, in households sampled from PolicyEngine's microdata. Each count shows its own total";
    warnings.push(`the chosen models ran on different households (${sizes.map((s) => s.replace("|", " amounts in ") + " households").join("; ")}); the export's caveat states one size, so check it`);
  }

  const benefitAmounts = Math.max(0, ...ordered.map((m) => m.benefits.alone?.n ?? 0));
  warnings.push(
    benefitAmounts
      ? `benefit amounts: at most ${benefitAmounts} per model, too few to say anything about benefits`
      : "benefit amounts: none in these households, so this says nothing about benefits",
  );

  const free = ordered.filter((m) => m.freePlan !== null);
  const footnotes = [
    ...(free.length ? [`The models on free plans: ${list(free.map((m) => m.model))}, called through each provider's API.`] : []),
    "Web search is each provider's own search tool, told not to search PolicyBench.",
    `The tool runs PolicyEngine (${exp.engine}), the engine behind the reference answers, so this shows whether a model can use it, not whether it's right.`,
  ];

  const pilot: FreePlanPilot = {
    title: opts.title ?? (free.length ? "The models on free plans, with web search and with the tool" : "The same models, with web search and with the tool"),
    label: opts.label ?? "Preliminary internal pilot",
    note,
    arms: EXPORT_ARMS,
    rows: ordered.map((m) => ({
      model: m.model,
      freePlan: m.freePlan ? `On ${m.freePlan}` : null,
      counts: Object.fromEntries(EXPORT_ARMS.map((a) => [a.id, { k: m.arms[a.id]!.k, n: m.arms[a.id]!.n }])),
      toolVsAlone: { points: m.vsAlone.tool!.points, lo: m.vsAlone.tool!.lo, hi: m.vsAlone.tool!.hi },
    })),
    caveat: exp.caveat,
    footnotes,
    source: `PolicyBench preliminary internal pilot, not a PolicyBench result · runs ${runDateRange(ordered.flatMap((m) => m.runDates))}`,
  };
  const problems = freePlanProblems(pilot);
  if (problems.length) throw new Error(`the export fails the slide's checks:\n- ${problems.join("\n- ")}`);
  if (exp.source?.scriptTreeDirty) warnings.push("the export script ran from a dirty tree");
  return { pilot, warnings };
}

const BEGIN = "// BEGIN FREE_PLAN_PILOT";
const END = "// END FREE_PLAN_PILOT";

/** content.ts with its FREE_PLAN_PILOT block replaced; the markers stay, so it can be replaced again. */
export function writePilotInto(content: string, pilot: FreePlanPilot | null, header: readonly string[]): string {
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (start < 0 || end < start || content.indexOf(BEGIN, start + 1) >= 0) throw new Error("content.ts needs exactly one FREE_PLAN_PILOT block");
  const lines = [
    `${BEGIN}: scripts/aspen-free-plan.ts --write replaces this block.`,
    ...header.map((h) => `// ${h}`),
    `export const FREE_PLAN_PILOT: FreePlanPilot | null = ${pilot ? JSON.stringify(pilot, null, 2) : "null"};`,
    END,
  ];
  return content.slice(0, start) + lines.join("\n") + content.slice(end + END.length);
}

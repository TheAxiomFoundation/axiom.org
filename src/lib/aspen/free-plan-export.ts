import {
  FREE_PLAN_ARMS,
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
  /** The free-plan models' household count; null when they ran on different counts. */
  households: number | null;
  engine: string;
  caveat: string;
  /** The free-plan models' noise width, in points. */
  noisePoints?: number;
  /** The models by household size, free-plan models' size first. Exports from before October 24 have none. */
  sizes?: ExportSize[];
  models: ExportModel[];
  /** PolicyBench's own line on the tool, for the presenter; the slide doesn't show it. */
  tool?: string;
  source?: { scriptCommit?: string; scriptTreeDirty?: boolean; generatedAtUtc?: string };
}

/** One household size: its households, nonzero amounts per model and setting, models, and noise width. */
export interface ExportSize {
  households: number;
  n: number;
  models: string[];
  noisePoints: number;
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
  /**
   * The engine its calculator's notice and description named, e.g.
   * "policyengine-us 2.60.4"; null with no calculator. It can differ from the
   * engine every calculation ran on (the export's `engine`). Exports from
   * before October 24 have none.
   */
  toolStatedEngine?: string | null;
}

export interface ExportArm extends PilotCount {
  pct: number;
  lo: number;
  hi: number;
}

/**
 * PolicyBench's audit of the searches in the export's web settings
 * (web_search_audit.py), a separate file checked against the export it audits.
 */
export interface WebSearchAudit {
  /** The export it audits; the script checks this against the export's own sha256. */
  export: { file?: string; sha256: string };
  /**
   * Whether any answer for these households is published. PolicyBench leaves it
   * null: no scan can show there's no copy anywhere, since one could be
   * re-keyed or encoded. The slide relies on matchingAnswersFound instead.
   */
  answersPublished: boolean | null;
  /** Why it's left as it is, for the presenter. */
  answersPublishedNote?: string;
  /** false when PolicyBench's scan of the channels in matchingScope found no copy of these households' answers. */
  matchingAnswersFound?: boolean | null;
  /** The channels the scan read, which the footnote names. */
  matchingScope?: string;
  /** What the scan read and found, for the presenter. */
  matchingBasis?: string;
  /** By export id, each web setting's searches. */
  models: Record<string, Partial<Record<WebArmId, WebSearchArm>>>;
  source?: { scriptCommit?: string; generatedAtUtc?: string };
}

/** The settings with web search. */
export const WEB_ARMS = ["web", "both"] as const;
export type WebArmId = (typeof WEB_ARMS)[number];

export interface WebSearchArm {
  households: number;
  queries: number;
  /** Queries naming PolicyBench, which the models were told not to search for. */
  policyBenchQueries: number;
  /** The households in which those queries were sent. */
  policyBenchHouseholds: string[];
  /** The sites the search tool blocked; null when it takes no list. */
  domainBlock: string[] | null;
  /** Queries naming GitHub or Hugging Face but not PolicyBench, and their households. */
  githubHfQueries?: number;
  githubHfHouseholds?: string[];
  /** false when the provider returns no result URLs, so what the model read can't be audited. */
  resultsVisible?: boolean;
}

/** The channels the search footnote says PolicyBench's scan read; the audit's matchingScope has to name both. */
export const SCANNED_CHANNELS = ["public PolicyEngine/policybench repository", "release assets"] as const;

export interface ExportOptions {
  /** Export ids, in the order to show them; free-plan models move to the front. */
  models: readonly string[];
  title?: string;
  label?: string;
  /** Without it, the slide can't say whether a model searched for PolicyBench, and the converter warns. */
  webAudit?: WebSearchAudit;
}

export const EXPORT_ARMS: FreePlanPilot["arms"] = FREE_PLAN_ARMS;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 23, 2026", or "October 23–24, 2026" for a run over consecutive days in one month. */
export function runDateRange(dates: readonly string[]): string {
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) throw new Error("no run dates");
  const parts = sorted.map((d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) throw new Error(`run date ${d} isn't YYYY-MM-DD`);
    const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = new Date(0);
    t.setUTCFullYear(y, mo - 1, day);
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== day) throw new Error(`run date ${d} isn't a date`);
    return { y, m: mo, d: day };
  });
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first.y !== last.y || first.m !== last.m) {
    return `${MONTHS[first.m - 1]} ${first.d}, ${first.y} to ${MONTHS[last.m - 1]} ${last.d}, ${last.y}`;
  }
  const day = first.d === last.d ? `${first.d}` : `${first.d}–${last.d}`;
  return `${MONTHS[first.m - 1]} ${day}, ${first.y}`;
}

/** A model's change from no tools to the tool, in points: its own counts' difference on the same amounts. */
function changeFromCounts(m: ExportModel): number {
  return (100 * (m.arms.tool!.k - m.arms.alone!.k)) / m.arms.tool!.n;
}

/** "A", "A and B", "A, B and C". */
function list(names: readonly string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * PolicyBench's noise width for some models (aspen_export.py noise_points):
 * the median half-width of the free-plan models' paired intervals, or every
 * model's when the free-plan models have none, rounded up to a multiple of 5.
 */
export function noisePoints(models: readonly ExportModel[]): number {
  const halvesOf = (ms: readonly ExportModel[]) =>
    ms
      .flatMap((m) => Object.values(m.vsAlone))
      .filter((c): c is PilotChange => Boolean(c))
      .map((c) => (c.hi - c.lo) / 2);
  const free = halvesOf(models.filter((m) => m.group === "free-plan"));
  const halves = (free.length ? free : halvesOf(models)).sort((a, b) => a - b);
  if (!halves.length) return 0;
  const mid = Math.floor(halves.length / 2);
  const median = halves.length % 2 ? halves[mid] : (halves[mid - 1] + halves[mid]) / 2;
  return 5 * Math.ceil(median / 5);
}

/**
 * Models grouped by household size, as aspen_export.py size_groups does: the
 * free-plan models' size first, then larger sizes first; models in the
 * export's order; each size with its own noise width.
 */
export function sizeGroups(models: readonly ExportModel[]): (ExportSize & { names: string[] })[] {
  const groups = new Map<string, ExportModel[]>();
  for (const m of models) {
    const ns = [...new Set(Object.values(m.arms).flatMap((c) => (c ? [c.n] : [])))];
    if (ns.length !== 1 || typeof ns[0] !== "number") throw new Error(`${m.model}: settings score different numbers of amounts`);
    const key = `${m.households}|${ns[0]}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const rank = (ms: ExportModel[]) => (ms.some((m) => m.group === "free-plan") ? 0 : 1);
  return [...groups.entries()]
    .map(([key, ms]) => ({ ms, households: Number(key.split("|")[0]), n: Number(key.split("|")[1]) }))
    .sort((a, b) => rank(a.ms) - rank(b.ms) || b.households - a.households || b.n - a.n)
    .map(({ ms, households, n }) => ({ households, n, models: ms.map((m) => m.id), noisePoints: noisePoints(ms), names: ms.map((m) => m.model) }));
}

/** PolicyBench's caveat for these sizes, word for word as aspen_export.py caveat_text writes it. */
export function caveatText(groups: readonly (ExportSize & { names: string[] })[]): string {
  const tail = "The models were called through their APIs with our prompt, not used in the free chat apps, and a change of less than about ";
  if (!groups.length) throw new Error("no models");
  const [first, ...rest] = groups;
  if (!rest.length) {
    return `Preliminary internal pilot: ${first.households} households sampled from PolicyEngine's microdata, ${first.n} nonzero dollar amounts per model and setting. ${tail}${first.noisePoints} points between settings is within noise at this size.`;
  }
  const sizes = [
    `${first.households} households, with ${first.n} nonzero dollar amounts per model and setting, for ${list(first.names)}`,
    ...rest.map((g) => `${g.households} households, with ${g.n}, for ${list(g.names)}`),
  ];
  const widths = rest.map((g) => `about ${g.noisePoints} at ${g.households}`).join(", ");
  return `Preliminary internal pilot on households sampled from PolicyEngine's microdata: ${sizes.join("; ")}. ${tail}${first.noisePoints} points between settings is within noise at ${first.households} households (${widths}).`;
}

/**
 * The slide's data from PolicyBench's export, for the chosen models. It
 * throws on anything that would put a wrong number on the screen, and
 * returns warnings for what the presenter should know: missing answers
 * counted as misses, batches left out, models on different households, and
 * how few benefit amounts there are.
 *
 * The caveat names the households, amounts and noise width of the models on
 * the slide, so it's rebuilt for them with PolicyBench's own wording and
 * rule. That rebuild is checked first against the export: for all its models
 * it must give the export's sizes and caveat exactly.
 */
export function freePlanFromExport(exp: PolicyBenchExport, opts: ExportOptions): { pilot: FreePlanPilot; warnings: string[] } {
  const warnings: string[] = [];
  // The tool footnote names it.
  if (typeof exp.engine !== "string" || !exp.engine.trim()) throw new Error("the export names no engine");
  const byId = new Map(exp.models.map((m) => [m.id, m]));
  const unknown = opts.models.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`not in the export: ${unknown.join(", ")}`);
  if (new Set(opts.models).size !== opts.models.length) throw new Error("a model is chosen twice");
  const chosen = opts.models.map((id) => byId.get(id) as ExportModel);
  // Free-plan models first, each group in the order chosen.
  const ordered = [...chosen.filter((m) => m.group === "free-plan"), ...chosen.filter((m) => m.group !== "free-plan")];
  for (const m of ordered) {
    // A free-plan model says which plan; any other says none.
    if (m.group === "free-plan" ? !(typeof m.freePlan === "string" && m.freePlan.trim()) : m.freePlan !== null) {
      throw new Error(`${m.model}: group ${m.group} but freePlan ${JSON.stringify(m.freePlan)}`);
    }
    if (!Number.isSafeInteger(m.households) || m.households < 1) throw new Error(`${m.model}: ${m.households} households isn't a count`);
    // Every change of a chosen model, not just the tool's, feeds the caveat's noise width.
    for (const [id, c] of Object.entries(m.vsAlone)) {
      if (c && !([c.points, c.lo, c.hi].every(Number.isFinite) && -100 <= c.lo && c.lo <= c.hi && c.hi <= 100)) {
        throw new Error(`${m.model} ${id}: change ${c.points} with interval ${c.lo} to ${c.hi} isn't a change in points`);
      }
    }
    const tool = m.vsAlone.tool;
    if (!tool) throw new Error(`${m.model}: no change from no tools to the tool`);
    // The slide shows the counts' own difference, so the export's change, to its one decimal, must be it.
    const [alone, withTool] = [m.arms.alone, m.arms.tool];
    if (alone && withTool && alone.n === withTool.n && Math.abs(tool.points - changeFromCounts(m)) > 0.05 + 1e-9) {
      throw new Error(`${m.model}: change ${tool.points}, but its counts give ${changeFromCounts(m).toFixed(2)}`);
    }
    for (const arm of EXPORT_ARMS) {
      const c = m.arms[arm.id];
      if (!c) throw new Error(`${m.model}: no count for ${arm.id}`);
      // The slide shows k of n; the export's own percent must say the same.
      if (!(c.n > 0) || Math.abs(c.pct - (100 * c.k) / c.n) > 0.05 + 1e-9) throw new Error(`${m.model} ${arm.id}: ${c.pct}% isn't ${c.k} of ${c.n}`);
    }
    if (m.toolStatedEngine === null) throw new Error(`${m.model}: a tool arm, but no engine named to it`);
    if (typeof m.toolStatedEngine === "string" && !m.toolStatedEngine.trim()) throw new Error(`${m.model}: an empty engine named to its tool`);
    const missed = EXPORT_ARMS.filter((a) => (m.missing[a.id] ?? 0) > 0).map((a) => `${m.missing[a.id]} ${a.id}`);
    if (missed.length) warnings.push(`${m.model}: answers counted as misses because none came back (${missed.join(", ")})`);
    if (m.partialBatches.length) warnings.push(`${m.model}: ${m.partialBatches.length} household batch(es) left out because a setting hadn't reached them`);
  }

  // The rebuild must match PolicyBench's own sizes and caveat before it's trusted for a subset.
  const allGroups = sizeGroups(exp.models);
  const strip = (gs: readonly ExportSize[]) => gs.map(({ households, n, models, noisePoints: w }) => ({ households, n, models, noisePoints: w }));
  if (exp.sizes && JSON.stringify(strip(allGroups)) !== JSON.stringify(strip(exp.sizes))) {
    throw new Error(`the export's sizes aren't its models' sizes: ${JSON.stringify(exp.sizes)}`);
  }
  if (caveatText(allGroups) !== exp.caveat) {
    throw new Error(`the export's caveat isn't PolicyBench's wording for its models, so it can't be rebuilt for a subset:\n  export:  ${exp.caveat}\n  rebuilt: ${caveatText(allGroups)}`);
  }
  const sizes = [...new Set(ordered.map((m) => `${m.arms.alone!.n}|${m.households}`))];
  const [n, households] = sizes[0].split("|").map(Number);
  let note: string;
  if (sizes.length === 1) {
    note = `Dollar amounts that aren't $0, within $1 of PolicyBench's reference: ${n} per model in ${households} households sampled from PolicyEngine's microdata`;
  } else {
    note = "Dollar amounts that aren't $0, within $1 of PolicyBench's reference, in households sampled from PolicyEngine's microdata. Each count shows its own total";
    warnings.push(`the chosen models ran on different households (${sizes.map((s) => s.replace("|", " amounts in ") + " households").join("; ")}); the caveat says which, so read each count against its own total`);
  }

  const benefitAmounts = Math.max(0, ...ordered.map((m) => m.benefits.alone?.n ?? 0));
  warnings.push(
    benefitAmounts
      ? `benefit amounts: at most ${benefitAmounts} per model, too few to say anything about benefits`
      : "benefit amounts: none in these households, so this says nothing about benefits",
  );

  // A calculator told one engine version that ran on another computes the same; the slide says so for those models.
  const toldOther = new Map<string, string[]>();
  for (const m of ordered) {
    if (m.toolStatedEngine && m.toolStatedEngine !== exp.engine) toldOther.set(m.toolStatedEngine, [...(toldOther.get(m.toolStatedEngine) ?? []), m.model]);
  }
  if (ordered.some((m) => m.toolStatedEngine === undefined)) {
    warnings.push("the export doesn't say which engine version each model's tool was told; check its tool line before showing");
  }
  for (const [stated, models] of toldOther) {
    warnings.push(`${list(models)}: the tool's instructions named ${stated}, but every calculation ran on ${exp.engine}; the slide says so`);
  }

  // Who searched for PolicyBench anyway, in either web setting. The slide says so, and that PolicyBench's scan found no copy of the answers.
  const searched: { model: string; households: number; of: number }[] = [];
  const blind: string[] = [];
  if (!opts.webAudit) {
    warnings.push("no web-search audit given, so the slide doesn't say whether a model searched for PolicyBench; pass --web-audit");
  } else {
    for (const m of ordered) {
      const audited = opts.webAudit.models[m.id];
      const households = new Set<string>();
      const githubHf = new Set<string>();
      let unseen = false;
      for (const id of WEB_ARMS) {
        const a = audited?.[id];
        if (!a) throw new Error(`${m.model}: no ${id} searches in the web-search audit`);
        if (![a.households, a.queries, a.policyBenchQueries].every((c) => Number.isSafeInteger(c) && c >= 0) || !Array.isArray(a.policyBenchHouseholds)) {
          throw new Error(`${m.model} ${id}: the web-search audit's counts aren't whole numbers with a list of households`);
        }
        const named = new Set(a.policyBenchHouseholds);
        if (a.households !== m.households || named.size !== a.policyBenchHouseholds.length || named.size > a.households) {
          throw new Error(`${m.model} ${id}: the web-search audit's households don't match the export's ${m.households}`);
        }
        if (a.policyBenchQueries < named.size || a.policyBenchQueries > a.queries || (a.policyBenchQueries > 0) !== (named.size > 0)) {
          throw new Error(`${m.model} ${id}: ${a.policyBenchQueries} PolicyBench queries of ${a.queries} in ${named.size} households don't add up`);
        }
        for (const h of named) households.add(h);
        if (a.githubHfQueries !== undefined || a.githubHfHouseholds !== undefined) {
          const [q, hh] = [a.githubHfQueries, a.githubHfHouseholds];
          const gh = Array.isArray(hh) ? new Set(hh) : null;
          if (!Number.isSafeInteger(q) || !gh || gh.size !== hh!.length || gh.size > a.households || q! < gh.size || (q! > 0) !== (gh.size > 0)) {
            throw new Error(`${m.model} ${id}: the web-search audit's GitHub and Hugging Face queries don't add up`);
          }
          for (const h of gh) githubHf.add(h);
        }
        if (a.resultsVisible === false) unseen = true;
      }
      if (households.size > m.households) {
        throw new Error(`${m.model}: the web-search audit names ${households.size} households across its web settings, more than the export's ${m.households}`);
      }
      if (households.size) searched.push({ model: m.model, households: households.size, of: m.households });
      // For the presenter, not the slide: neither shows a model reading PolicyBench's answers.
      if (githubHf.size) warnings.push(`${m.model} searched GitHub or Hugging Face, not naming PolicyBench, in ${githubHf.size} of ${m.households} households; the slide doesn't say so`);
      if (unseen) blind.push(m.model);
    }
    if (blind.length) warnings.push(`${list(blind)}: the search tool returns no result URLs, so what ${blind.length > 1 ? "they" : "it"} read can't be audited; the slide doesn't say so`);
    if (searched.length) {
      const audit = opts.webAudit;
      if (audit.answersPublished === true || audit.matchingAnswersFound === true) {
        throw new Error(`${list(searched.map((s) => s.model))} searched for PolicyBench, and the web-search audit found these households' answers published`);
      }
      if (audit.answersPublished !== null || audit.matchingAnswersFound !== false) {
        throw new Error(`${list(searched.map((s) => s.model))} searched for PolicyBench, and the web-search audit doesn't say its scan found no copy of these households' answers`);
      }
      const missing = SCANNED_CHANNELS.filter((c) => !audit.matchingScope?.includes(c));
      if (missing.length) throw new Error(`the web-search audit's scan doesn't say it read the ${missing.join(" or the ")} the footnote names`);
    }
    for (const s of searched) {
      warnings.push(`${s.model} searched for PolicyBench in ${s.households} of ${s.of} households, though told not to; the slide says so`);
    }
  }

  const free = ordered.filter((m) => m.freePlan !== null);
  // The rows name each free-plan model and the caveat says they were called
  // through their APIs, so the footnotes don't repeat either.
  const footnotes = [
    "Web search is each provider's own search tool, told not to search PolicyBench.",
    ...(searched.length
      ? [
          `${list(searched.map((s, i) => `${s.model}${i ? "" : " searched for it anyway"} in ${s.households} of ${s.of}${i ? "" : " households"}`))}; a scan of PolicyBench's public repository and release data found no copy of these households' answers.`,
        ]
      : []),
    `The tool runs PolicyEngine (${exp.engine}), the engine behind the reference answers, so this shows whether a model can use it, not whether it's right.`,
    ...[...toldOther].map(([stated, models]) => `Its instructions to ${list(models)} named ${stated} instead.`),
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
      // The change from the counts, exact; its interval from PolicyBench's household bootstrap.
      toolVsAlone: { points: changeFromCounts(m), lo: m.vsAlone.tool!.lo, hi: m.vsAlone.tool!.hi },
    })),
    // The chosen models in the export's order, as PolicyBench lists them.
    caveat: caveatText(sizeGroups(exp.models.filter((m) => opts.models.includes(m.id)))),
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

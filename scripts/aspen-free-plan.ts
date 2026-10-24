import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freePlanFromExport, writePilotInto, type PolicyBenchExport } from "../src/lib/aspen/free-plan-export";

// Turns PolicyBench's free-plan export into the Aspen free-plan slide's data:
//
//   bun scripts/aspen-free-plan.ts <export.json> --sha256 <hex> --models id,id,... [--write]
//
// It checks the file against the sha256 PolicyBench sent, prints the slide's
// rows, its caveat (rebuilt for the chosen models), what the presenter should
// know and each model's free-plan basis, and with --write puts the data in
// src/lib/aspen/content.ts. This repo is public: write only once the numbers
// are cleared to show.

const CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/aspen/content.ts");

export interface Args {
  file: string;
  sha256: string;
  models: string[];
  write: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const usage = "usage: aspen-free-plan.ts <export.json> --sha256 <hex> --models id,id,... [--write]";
  let file: string | undefined;
  let sha256: string | undefined;
  let models: string[] | undefined;
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") write = true;
    else if (a === "--sha256") sha256 = argv[++i];
    else if (a === "--models") models = argv[++i]?.split(",").map((m) => m.trim()).filter(Boolean);
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}\n${usage}`);
    else if (file) throw new Error(`one export at a time\n${usage}`);
    else file = a;
  }
  if (!file || !sha256 || !models?.length) throw new Error(usage);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`--sha256 ${sha256} isn't a sha256`);
  return { file, sha256, models, write };
}

export function run(argv: readonly string[], { contentPath = CONTENT, log = console.log }: { contentPath?: string; log?: (line: string) => void } = {}): void {
  const args = parseArgs(argv);
  const bytes = readFileSync(args.file);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== args.sha256) throw new Error(`${basename(args.file)} has sha256 ${actual}, not ${args.sha256}`);
  const exp = JSON.parse(bytes.toString("utf8")) as PolicyBenchExport;
  const { pilot, warnings } = freePlanFromExport(exp, { models: args.models });

  log(pilot.title);
  for (const r of pilot.rows) {
    const shares = pilot.arms.map((a) => `${a.id} ${r.counts[a.id]!.k}/${r.counts[a.id]!.n}`).join(", ");
    log(`  ${r.model}${r.freePlan ? ` (${r.freePlan})` : ""}: ${shares}; tool vs alone ${r.toolVsAlone.points.toFixed(1)} [${r.toolVsAlone.lo}, ${r.toolVsAlone.hi}]`);
  }
  log(`Caveat, for these models: ${pilot.caveat}`);
  log("Free-plan basis, for the presenter:");
  for (const id of args.models) {
    const m = exp.models.find((x) => x.id === id)!;
    log(`  ${m.model}: ${m.freePlanBasis}`);
  }
  if (warnings.length) {
    log("Warnings:");
    for (const w of warnings) log(`  ${w}`);
  }
  if (!args.write) {
    log("Not written; pass --write to put this in content.ts.");
    return;
  }
  const header = [
    `PolicyBench free-plan pilot export ${basename(args.file)}, sha256 ${actual}.`,
    `Generated ${exp.source?.generatedAtUtc ?? "at an unrecorded time"} by aspen_export.py at ${exp.source?.scriptCommit ?? "an unrecorded commit"}; models ${args.models.join(", ")}.`,
  ];
  writeFileSync(contentPath, writePilotInto(readFileSync(contentPath, "utf8"), pilot, header));
  log(`Wrote ${pilot.rows.length} models into ${basename(contentPath)}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

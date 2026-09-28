import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

export const RULESPEC_COMMIT = "c55778119c0dd208a5ea3366092a17d0b0392c8b";
export const CORPUS_COMMIT = "bef19f24206a9de4ef29d9ba2b5924f3cc6a00c6";
export const CORPUS_RELEASE = "2026-08-09-usitc-hts-2026-rev15-full-schedule";
export const CERTIFICATE_SHA256 = "7b6de59a83d37829f7c8a247722538fd1b3a35689337b591c900e7bf709caf18";
export const EXPECTED_LINE_COUNT = 13_790;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function siblingRepo(name: string) {
  const candidates = [resolve(ROOT, "..", name), resolve(ROOT, "../../..", name)];
  return candidates.find(existsSync) ?? candidates[0];
}
const RULESPEC = process.env.RULESPEC_US_PATH ?? siblingRepo("_b1wt/rulespec-us");
const CORPUS = process.env.AXIOM_CORPUS_PATH ?? siblingRepo("axiom-corpus-b1-full");
const OUT_PUBLIC_JSON = resolve(ROOT, "public/downloads/tariff-schedule.json");
const OUT_CSV = resolve(ROOT, "public/downloads/tariff-schedule.csv");

type Rule = { name: string; source?: string; versions?: { values?: Record<string, unknown> }[]; metadata?: { proof?: { atoms?: Atom[] } } };
type Atom = { source?: { corpus_citation_path?: string; excerpt?: string }; context?: { subdivision?: string } };
type Module = { module?: { source_verification?: { corpus_citation_paths?: string[] } }; rules?: Rule[] };
export type Membership = { family: string; explanation: string; citationPath: string };
export type TariffLine = {
  hts10: string; displayCode: string; description: string;
  generalRate: string; column2Rate: string;
  generalDisposition: string; column2Disposition: string;
  citations: { field: string; path: string; excerpt: string }[];
  memberships: Membership[]; canada338Warning: boolean;
};

export const COVERAGE_FAMILIES = [
  { family: "Rated schedule lines except 9802", status: "encoded", note: "The Rev. 15 generated chapter tables supply the general and column 2 schedule fields." },
  { family: "9802 partial-value rated lines", status: "partially encoded", note: "The schedule fields are encoded, but the dutiable partial value must be supplied as an entry input." },
  { family: "Section 232 metals — notes 16 and 19", status: "encoded", note: "Steel and aluminum incidence tables and composed overlays are present." },
  { family: "Section 201 solar — note 18", status: "encoded", note: "Solar safeguard incidence and its overlay are composed." },
  { family: "Section 301 China lists — note 20", status: "encoded", note: "The original China list incidence tables are composed." },
  { family: "Section 122 exemptions — note 2(aa)", status: "encoded", note: "The temporary-surcharge incidence table and overlay are composed." },
  { family: "Section 338 Canada — note 51", status: "pending", note: "Pending merge; note 51 is not on rulespec-us main." },
  { family: "Brazil Section 301 — note 50", status: "pending", note: "Pending merge; the branch module is not on rulespec-us main." },
  { family: "Forced-labor Section 301 — note 52", status: "pending", note: "Pending merge; the branch module is not on rulespec-us main." },
  { family: "Other chapter 99 pages", status: "partially encoded", note: "No page-level census proves that every other chapter 99 note is covered." },
  { family: "Section 232 non-metal annexes", status: "pending", note: "Auto, copper, semiconductor, vehicle, and wood annexes are not encoded on main." },
  { family: "Original 2018 China Section 301 instruments", status: "absent", note: "The instruments are absent from the closure corpus." },
] as const;

function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}
function show(repo: string, commit: string, path: string) { return git(repo, "show", `${commit}:${path}`); }
function parseModule(path: string): Module { return yaml.load(show(RULESPEC, RULESPEC_COMMIT, path)) as Module; }
function values(rule?: Rule) { return rule?.versions?.[0]?.values ?? {}; }
function code10(value: string | number) { return String(value).replace(/\D/g, "").padStart(10, "0"); }
function citationCode10(value: string) { return value.replace(/\D/g, "").padEnd(10, "0"); }
function displayCode(code: string) { return `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6, 8)}.${code.slice(8)}`; }
function dispositionLabel(value: unknown) { return typeof value === "string" ? value : "empty"; }
function csvCell(value: unknown) { const s = typeof value === "string" ? value : JSON.stringify(value); return `"${s.replaceAll('"', '""')}"`; }

function rateText(atom: Atom | undefined, disposition: string, rate: unknown) {
  const excerpt = atom?.source?.excerpt ?? "";
  const raw = excerpt.split(":").slice(1).join(":").trim();
  if (raw) return raw;
  if (disposition === "free" || rate === 0) return "Free";
  if (typeof rate === "number") return `${Number((rate * 100).toFixed(6))}%`;
  return "not determined";
}

const membershipCopy: Record<string, { family: string; label: string }> = {
  note16: { family: "Section 232 steel", label: "Section 232 steel scope" },
  note18: { family: "Section 201 solar", label: "Section 201 solar scope" },
  note19: { family: "Section 232 aluminum", label: "Section 232 aluminum scope" },
  note20: { family: "Section 301 China", label: "Section 301 China list scope" },
  note2aa: { family: "Section 122 exemptions", label: "Section 122 exemption scope" },
};

export function renderMembershipExplanation(fileKey: string, rule: Rule, atom: Atom) {
  const copy = membershipCopy[fileKey];
  const subdivision = atom.context?.subdivision;
  const page = atom.source?.corpus_citation_path?.match(/page-(\d+)/)?.[1];
  return `${copy.label}${subdivision ? ` — U.S. note ${subdivision}` : ""}${page ? `, page ${page}` : ""}`;
}

function loadCorpus() {
  const path = `data/corpus/provisions/us/statute/${CORPUS_RELEASE}.jsonl`;
  const text = show(CORPUS, CORPUS_COMMIT, path);
  const records = new Map<string, { body: string; citation_path: string }>();
  for (const raw of text.trim().split("\n")) {
    const row = JSON.parse(raw);
    if (row.citation_path?.startsWith("us/statute/hts/")) records.set(row.citation_path, row);
  }
  return records;
}

export function buildArtifact() {
  if (git(RULESPEC, "rev-parse", `${RULESPEC_COMMIT}^{commit}`).trim() !== RULESPEC_COMMIT) throw new Error("rulespec pin unavailable");
  if (git(CORPUS, "rev-parse", `${CORPUS_COMMIT}^{commit}`).trim() !== CORPUS_COMMIT) throw new Error("corpus pin unavailable");
  const corpus = loadCorpus();
  const lines = new Map<string, TariffLine>();
  const chapterPaths = git(RULESPEC, "ls-tree", "-r", "--name-only", RULESPEC_COMMIT, "--", "us/policies/usitc/us-tariff-duty/lines/generated")
    .trim().split("\n").filter((p) => /\/ch\d+[a-z]?\.yaml$/.test(p));
  for (const path of chapterPaths) {
    const mod = parseModule(path); const rules = mod.rules ?? [];
    const bySuffix = (suffix: string) => rules.find((r) => r.name.endsWith(suffix));
    const gr = bySuffix("_general_rate"), cr = bySuffix("_column2_rate");
    const gd = bySuffix("_general_disposition"), cd = bySuffix("_column2_disposition");
    const keys = new Set([...Object.keys(values(gd)), ...Object.keys(values(cd))]);
    if (!keys.size) continue;
    const atoms = [...(gr?.metadata?.proof?.atoms ?? []), ...(cr?.metadata?.proof?.atoms ?? []), ...(gd?.metadata?.proof?.atoms ?? []), ...(cd?.metadata?.proof?.atoms ?? [])];
    for (const key of keys) {
      const hts10 = code10(key); const generalDisposition = dispositionLabel(values(gd)[key]); const column2Disposition = dispositionLabel(values(cd)[key]);
      const matching = atoms.filter((a) => citationCode10(a.source?.corpus_citation_path?.split("/").at(-1) ?? "") === hts10);
      const pathFromAtom = matching[0]?.source?.corpus_citation_path;
      const citationPath = pathFromAtom ?? `us/statute/hts/${displayCode(hts10)}`;
      const record = corpus.get(citationPath);
      const bodyLines = record?.body?.split("\n") ?? [];
      const description = bodyLines.find((v) => !/^(Rates of duty|Unit of quantity|Footnote)/.test(v)) || "Description not determined";
      const generalAtom = matching.find((a) => a.source?.excerpt?.includes("1-General"));
      const columnAtom = matching.find((a) => a.source?.excerpt?.includes("duty (2)"));
      lines.set(hts10, { hts10, displayCode: displayCode(hts10), description,
        generalRate: rateText(generalAtom, generalDisposition, values(gr)[key]), column2Rate: rateText(columnAtom, column2Disposition, values(cr)[key]),
        generalDisposition, column2Disposition,
        citations: [
          { field: "General rate", path: `/${citationPath}`, excerpt: generalAtom?.source?.excerpt ?? "Source text available in corpus reader" },
          { field: "Column 2 rate", path: `/${citationPath}`, excerpt: columnAtom?.source?.excerpt ?? "Source text available in corpus reader" },
        ], memberships: [], canada338Warning: hts10 === "2203000000" });
    }
  }
  const incidenceFiles = ["note16-232-steel", "note18-201-solar", "note19-232-aluminum", "note20-china-301", "note2aa-122-exemptions"];
  for (const filename of incidenceFiles) {
    const key = filename.split("-")[0]; const mod = parseModule(`us/policies/usitc/us-tariff-incidence/generated/${filename}.yaml`);
    for (const rule of mod.rules ?? []) for (const member of Object.keys(values(rule))) {
      const prefix = String(member).padStart(String(member).length % 2 ? String(member).length + 1 : String(member).length, "0");
      const atom = rule.metadata?.proof?.atoms?.find((a) => code10(a.source?.excerpt ?? "").startsWith(prefix)) ?? rule.metadata?.proof?.atoms?.[0];
      if (!atom?.source?.corpus_citation_path) continue;
      for (const line of lines.values()) if (line.hts10.startsWith(prefix)) line.memberships.push({ family: membershipCopy[key].family, explanation: renderMembershipExplanation(key, rule, atom), citationPath: `/${atom.source.corpus_citation_path}` });
    }
  }
  const sorted = [...lines.values()].sort((a, b) => a.hts10.localeCompare(b.hts10));
  if (sorted.length !== EXPECTED_LINE_COUNT) throw new Error(`expected ${EXPECTED_LINE_COUNT} lines, got ${sorted.length}`);
  const builtAt = new Date(Number(git(RULESPEC, "show", "-s", "--format=%ct", RULESPEC_COMMIT).trim()) * 1000).toISOString();
  const artifact = { metadata: { schema: "axiom.tariff_schedule.v1", rulespecCommit: RULESPEC_COMMIT, corpusCommit: CORPUS_COMMIT, corpusRelease: CORPUS_RELEASE, certificateSha256: CERTIFICATE_SHA256, builtAt, lineCount: sorted.length, coverageFamilies: COVERAGE_FAMILIES }, lines: sorted };
  return artifact;
}

if (import.meta.main) {
  const artifact = buildArtifact(); mkdirSync(dirname(OUT_PUBLIC_JSON), { recursive: true }); mkdirSync(dirname(OUT_CSV), { recursive: true });
  const json = `${JSON.stringify(artifact)}\n`; writeFileSync(OUT_PUBLIC_JSON, json);
  const meta = artifact.metadata;
  const rows = [
    ["hts10", "display_code", "description", "general_rate", "general_disposition", "column_2_rate", "column_2_disposition", "memberships", "membership_citations", "rate_citations", "canada_338_warning", "rulespec_commit", "corpus_release", "certificate_sha256", "built_at"],
    ...artifact.lines.map((l) => [l.hts10, l.displayCode, l.description, l.generalRate, l.generalDisposition, l.column2Rate, l.column2Disposition, l.memberships.map((m) => m.explanation).join(" | ") || "not determined", l.memberships.map((m) => m.citationPath).join(" | ") || "not determined", l.citations.map((c) => `${c.field}: ${c.path}`).join(" | "), String(l.canada338Warning), meta.rulespecCommit, meta.corpusRelease, meta.certificateSha256, meta.builtAt]),
  ];
  writeFileSync(OUT_CSV, `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`);
  console.log(`wrote ${artifact.lines.length} lines (${createHash("sha256").update(json).digest("hex")})`);
}

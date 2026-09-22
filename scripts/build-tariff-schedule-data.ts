import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { CERTIFICATE_COMMIT, certificateDownloadPath } from "../src/lib/tariff-certificate";
import {
  COVERAGE_COPY, INCIDENCE_COPY, PENDING_INCIDENCE_TABLES, coverageStatusWord, linesSha256, partitionRateLines,
  type CoverageEvidence, type CoverageRow, type IncidenceTable, type TariffArtifact, type TariffLine,
} from "../src/lib/tariff-coverage";
import { REPO_ROOT, locateSourceRepo } from "./source-repos";

// rulespec-us main on 2026-09-18. Its tariff trees (TARIFF_TREES) are
// byte-identical to the commit the vendored certificate evaluates; the build
// fails if that ever stops being true.
export const RULESPEC_COMMIT = "c654250f07c39c35ca7f3e79975368b019d0e4ca";
// The corpus Git object the certificate's reproduction contract names; the
// build fails if the vendored certificate names a different one.
export const CORPUS_COMMIT = "bef19f24206a9de4ef29d9ba2b5924f3cc6a00c6";
export const CORPUS_RELEASE = "2026-08-09-usitc-hts-2026-rev15-full-schedule";
export const EXPECTED_LINE_COUNT = 13_790;
export const CLOSURE_LEDGER_PATH = "conformance/closure/us-tariff-duty.yaml";
export const TARIFF_TREES = ["us/policies/usitc", "us/policies/cbp", "programs/us/us-tariff-duty", "programs/us/us-tariff-schedule"] as const;
const INCIDENCE_DIR = "us/policies/usitc/us-tariff-incidence/generated";

export const SOURCES = {
  rulespec: locateSourceRepo({ envVar: "RULESPEC_US_PATH", names: ["rulespec-us", "_b1wt/rulespec-us"], commit: RULESPEC_COMMIT }),
  corpus: locateSourceRepo({ envVar: "AXIOM_CORPUS_PATH", names: ["axiom-corpus", "axiom-corpus-b1-full"], commit: CORPUS_COMMIT }),
  oracles: locateSourceRepo({ envVar: "AXIOM_ORACLES_PATH", names: ["axiom-oracles"], commit: CERTIFICATE_COMMIT }),
};
const RULESPEC = SOURCES.rulespec.path;
const CORPUS = SOURCES.corpus.path;
const ORACLES = SOURCES.oracles.path;
const OUT_PUBLIC_JSON = resolve(REPO_ROOT, "public/downloads/tariff-schedule.json");
const OUT_CSV = resolve(REPO_ROOT, "public/downloads/tariff-schedule.csv");
export const CERTIFICATE_FILE = resolve(REPO_ROOT, `public${certificateDownloadPath}`);

type Rule = { name: string; source?: string; versions?: { values?: Record<string, unknown> }[]; metadata?: { proof?: { atoms?: Atom[] } } };
type Atom = { source?: { corpus_citation_path?: string; excerpt?: string }; context?: { subdivision?: string } };
type Module = { module?: { source_verification?: { corpus_citation_paths?: string[] } }; rules?: Rule[] };
type Certificate = {
  evidence?: { artifact?: string; sha256?: string }[];
  verdicts?: { closed?: { rulespec_commit?: string; reproduction_contract?: { external_corpus_git_object?: { commit?: string } } } };
};
type Ledger = {
  program?: { rulespec_ref?: string };
  reproduction_contract?: { external_corpus_git_object?: { commit?: string } };
  generated_facts?: {
    corpus_roots?: Record<string, { path?: string; commit?: string; sha256?: string; version?: string }>;
    rate_table_correspondence?: Record<string, unknown>;
  };
  committed_decisions?: { ledger?: { root: string; family: string; status: string; count: number }[] };
};

function sha256(data: string | Buffer) { return createHash("sha256").update(data).digest("hex"); }
function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}
// A blob read that fails loudly: an empty read would otherwise parse as an
// empty module and silently drop a chapter.
function show(repo: string, commit: string, path: string) {
  const text = git(repo, "cat-file", "blob", `${commit}:${path}`);
  if (!text) throw new Error(`empty blob ${commit}:${path} in ${repo}`);
  return text;
}
function treeHash(repo: string, commit: string, path: string) { return git(repo, "rev-parse", `${commit}:${path}`).trim(); }
function listFiles(repo: string, commit: string, path: string) {
  return git(repo, "ls-tree", "-r", "--name-only", commit, "--", path).trim().split("\n").filter(Boolean);
}
function parseModule(path: string): Module {
  const mod = yaml.load(show(RULESPEC, RULESPEC_COMMIT, path));
  if (!mod || typeof mod !== "object") throw new Error(`module ${path} did not parse to a mapping`);
  return mod as Module;
}
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

export function renderMembershipExplanation(fileKey: string, rule: Rule, atom: Atom) {
  const copy = INCIDENCE_COPY[fileKey];
  const subdivision = atom.context?.subdivision;
  const page = atom.source?.corpus_citation_path?.match(/page-(\d+)/)?.[1];
  return `${copy.label}${subdivision ? ` — U.S. note ${subdivision}` : ""}${page ? `, page ${page}` : ""}`;
}

export const CORPUS_PATH = `data/corpus/provisions/us/statute/${CORPUS_RELEASE}.jsonl`;

function loadCorpus() {
  const text = show(CORPUS, CORPUS_COMMIT, CORPUS_PATH);
  const records = new Map<string, { body: string; citation_path: string }>();
  for (const raw of text.trim().split("\n")) {
    const row = JSON.parse(raw);
    if (row.citation_path?.startsWith("us/statute/hts/")) records.set(row.citation_path, row);
  }
  return { records, sha256: sha256(text) };
}

// The page calls this scope a corpus scope, not a signed release, because no
// release selector at the corpus pin includes it; fail if that changes.
function assertScopeOutsideReleaseSelectors() {
  for (const path of listFiles(CORPUS, CORPUS_COMMIT, "manifests/releases")) {
    if (show(CORPUS, CORPUS_COMMIT, path).includes(`"${CORPUS_RELEASE}"`)) throw new Error(`${path} now includes ${CORPUS_RELEASE}; update the corpus copy on the tariff pages`);
  }
}

// The certificate is vendored byte-for-byte (src/lib/tariff-certificate.ts);
// the closure ledger it content-addresses is read from the same pinned
// axiom-oracles commit and must hash to the certificate's evidence entry.
export function loadCertificateBinding() {
  const bytes = readFileSync(CERTIFICATE_FILE);
  const certificate = JSON.parse(bytes.toString("utf8")) as Certificate;
  const ledgerEvidence = certificate.evidence?.find((item) => item.artifact === CLOSURE_LEDGER_PATH);
  if (!ledgerEvidence?.sha256) throw new Error(`certificate has no evidence entry for ${CLOSURE_LEDGER_PATH}`);
  const ledgerText = show(ORACLES, CERTIFICATE_COMMIT, CLOSURE_LEDGER_PATH);
  if (sha256(ledgerText) !== ledgerEvidence.sha256) throw new Error("closure ledger does not hash to the certificate's evidence entry");
  const ledger = yaml.load(ledgerText) as Ledger;
  const evaluated = certificate.verdicts?.closed?.rulespec_commit;
  if (!evaluated || ledger.program?.rulespec_ref !== evaluated) throw new Error("certificate and closure ledger name different rulespec commits");
  const certificateCorpus = certificate.verdicts?.closed?.reproduction_contract?.external_corpus_git_object?.commit;
  if (certificateCorpus !== CORPUS_COMMIT || ledger.reproduction_contract?.external_corpus_git_object?.commit !== CORPUS_COMMIT) {
    throw new Error(`certificate names corpus ${certificateCorpus}, not the pinned ${CORPUS_COMMIT}`);
  }
  const tariffTrees = Object.fromEntries(TARIFF_TREES.map((path) => {
    const pinned = treeHash(RULESPEC, RULESPEC_COMMIT, path);
    if (pinned !== treeHash(RULESPEC, evaluated, path)) throw new Error(`${path} at ${RULESPEC_COMMIT} differs from the certificate's evaluated ${evaluated}`);
    return [path, pinned];
  }));
  return { sha256: sha256(bytes), evaluatedRulespecCommit: evaluated, ledger, ledgerSha256: ledgerEvidence.sha256, tariffTrees };
}

// A rule is "defined" when some module lists it by name; one the compositions
// reference but nothing defines can only arrive as an input.
function ruleIsDefined(name: string) {
  try {
    git(RULESPEC, "grep", "-q", "-E", `^ *- name: ${name} *$`, RULESPEC_COMMIT, "--", "us", "programs");
    return true;
  } catch {
    return false;
  }
}

function checkEvidence(label: string, evidence: CoverageEvidence | undefined, pinnedFiles: string[]) {
  if (!evidence) return;
  const fail = (message: string) => { throw new Error(`${label}: ${message} at rulespec-us ${RULESPEC_COMMIT}`); };
  for (const path of evidence.present ?? []) if (!pinnedFiles.includes(path)) fail(`expected ${path}`);
  for (const prefix of evidence.absent ?? []) if (pinnedFiles.some((file) => file.startsWith(prefix))) fail(`expected nothing under ${prefix}`);
  if (evidence.absentMatching) {
    const pattern = new RegExp(evidence.absentMatching, "i");
    const hit = pinnedFiles.find((file) => pattern.test(file));
    if (hit) fail(`expected no path matching ${pattern}, found ${hit}`);
  }
  for (const { module, rules } of evidence.rules ?? []) {
    const names = new Set((parseModule(module).rules ?? []).map((rule) => rule.name));
    for (const name of rules) if (!names.has(name)) fail(`expected rule ${name} in ${module}`);
  }
  for (const { module, imports } of evidence.imports ?? []) {
    const declared = new Set((parseModule(module) as { imports?: string[] }).imports ?? []);
    for (const name of imports) if (!declared.has(name)) fail(`expected ${module} to import ${name}`);
  }
  for (const name of evidence.undefinedRules ?? []) if (ruleIsDefined(name)) fail(`expected no module to define ${name}`);
}

function fillCount(note: string, count: number) {
  return note.replace("{count}", count.toLocaleString("en-US"));
}

export function buildArtifact(): TariffArtifact {
  for (const [name, repo] of Object.entries(SOURCES)) if (!repo.available) throw new Error(`${name} pin unavailable at ${repo.path}`);
  const binding = loadCertificateBinding();
  const { records: corpus, sha256: corpusSha256 } = loadCorpus();
  const corpusRoot = binding.ledger.generated_facts?.corpus_roots?.["hts-rate-provisions"];
  if (corpusRoot?.path !== CORPUS_PATH || corpusRoot.commit !== CORPUS_COMMIT || corpusRoot.version !== CORPUS_RELEASE || corpusRoot.sha256 !== corpusSha256) {
    throw new Error("the corpus scope the build reads is not the closure ledger's hts-rate-provisions root");
  }
  assertScopeOutsideReleaseSelectors();
  const lines = new Map<string, TariffLine>();
  const chapterPaths = listFiles(RULESPEC, RULESPEC_COMMIT, "us/policies/usitc/us-tariff-duty/lines/generated").filter((p) => /\/ch\d+[a-z]?\.yaml$/.test(p));
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

  // Every incidence table at the pin needs page copy, so a newly merged table
  // (for example U.S. notes 50 and 52) fails the build until the page names it.
  const pinnedFiles = listFiles(RULESPEC, RULESPEC_COMMIT, "us/policies");
  const incidenceFiles = pinnedFiles.filter((p) => p.startsWith(`${INCIDENCE_DIR}/`) && p.endsWith(".yaml") && !p.endsWith(".test.yaml"))
    .map((p) => p.slice(INCIDENCE_DIR.length + 1, -".yaml".length));
  const incidenceTables: IncidenceTable[] = [];
  for (const filename of incidenceFiles) {
    const key = filename.split("-")[0];
    if (!INCIDENCE_COPY[key]) throw new Error(`incidence table ${filename} has no page copy in INCIDENCE_COPY`);
    const mod = parseModule(`${INCIDENCE_DIR}/${filename}.yaml`);
    const matched = new Set<string>();
    for (const rule of mod.rules ?? []) for (const member of Object.keys(values(rule))) {
      const prefix = String(member).padStart(String(member).length % 2 ? String(member).length + 1 : String(member).length, "0");
      const atom = rule.metadata?.proof?.atoms?.find((a) => code10(a.source?.excerpt ?? "").startsWith(prefix)) ?? rule.metadata?.proof?.atoms?.[0];
      if (!atom?.source?.corpus_citation_path) continue;
      for (const line of lines.values()) {
        if (!line.hts10.startsWith(prefix)) continue;
        matched.add(line.hts10);
        line.memberships.push({ family: INCIDENCE_COPY[key].family, explanation: renderMembershipExplanation(key, rule, atom), citationPath: `/${atom.source.corpus_citation_path}` });
      }
    }
    incidenceTables.push({ module: `${INCIDENCE_DIR}/${filename}.yaml`, note: INCIDENCE_COPY[key].note, family: INCIDENCE_COPY[key].family, status: "encoded", lineCount: matched.size });
  }
  for (const pending of PENDING_INCIDENCE_TABLES) {
    checkEvidence(pending.family, { absent: [pending.absentPrefix] }, pinnedFiles);
    incidenceTables.push({ module: null, note: pending.note, family: pending.family, status: pending.status, lineCount: 0, detail: pending.detail });
  }

  const sorted = [...lines.values()].sort((a, b) => a.hts10.localeCompare(b.hts10));
  if (sorted.length !== EXPECTED_LINE_COUNT) throw new Error(`expected ${EXPECTED_LINE_COUNT} lines, got ${sorted.length}`);

  // The page's line counts must be the certificate ledger's, recomputed here
  // from the pinned tables rather than copied.
  const partition = partitionRateLines(sorted);
  const facts = binding.ledger.generated_facts?.rate_table_correspondence ?? {};
  const expected = {
    corpus_rate_bearing_count: sorted.length,
    encoded_count: partition.encoded.length, encoded_paths_sha256: linesSha256(partition.encoded),
    partial_count: partition.partial.length, partial_paths_sha256: linesSha256(partition.partial),
  };
  for (const [key, value] of Object.entries(expected)) if (facts[key] !== value) throw new Error(`closure ledger ${key} is ${facts[key]}, the pinned tables give ${value}`);

  const decisions = binding.ledger.committed_decisions?.ledger ?? [];
  const decided = new Set(decisions.map((d) => d.family));
  for (const family of Object.keys(COVERAGE_COPY)) if (!decided.has(family)) throw new Error(`COVERAGE_COPY names ${family}, which the closure ledger does not`);
  const coverageFamilies: CoverageRow[] = decisions.map((decision) => {
    const copy = COVERAGE_COPY[decision.family];
    if (!copy) throw new Error(`closure ledger family ${decision.family} has no page copy in COVERAGE_COPY`);
    checkEvidence(decision.family, copy.evidence, pinnedFiles);
    return { family: copy.label, status: coverageStatusWord(decision.status), note: fillCount(copy.note, decision.count), ledgerFamily: decision.family, ledgerRoot: decision.root, count: decision.count };
  });

  const commitDate = (...args: string[]) => new Date(Number(git(RULESPEC, "log", "-1", "--format=%ct", RULESPEC_COMMIT, ...args).trim()) * 1000).toISOString();
  const builtAt = commitDate();
  // The pin is a recent main commit; the tariff encodings themselves may be older.
  const tariffEncodingsChangedAt = commitDate("--", ...TARIFF_TREES);
  return {
    metadata: {
      schema: "axiom.tariff_schedule.v1", rulespecCommit: RULESPEC_COMMIT, corpusCommit: CORPUS_COMMIT, corpusRelease: CORPUS_RELEASE,
      certificateSha256: binding.sha256, certificateCommit: CERTIFICATE_COMMIT, certificateRulespecCommit: binding.evaluatedRulespecCommit,
      closureLedgerSha256: binding.ledgerSha256, tariffTrees: binding.tariffTrees, corpusSha256,
      builtAt, tariffEncodingsChangedAt, lineCount: sorted.length,
      encodedLineCount: partition.encoded.length, encodedPathsSha256: expected.encoded_paths_sha256,
      partialLineCount: partition.partial.length, partialPathsSha256: expected.partial_paths_sha256,
      coverageFamilies, incidenceTables,
    },
    lines: sorted,
  };
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
  console.log(`wrote ${artifact.lines.length} lines (${sha256(json)})`);
}

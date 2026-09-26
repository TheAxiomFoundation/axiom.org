import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { CERTIFICATE_COMMIT, certificateDownloadPath } from "../src/lib/tariff-certificate";
import {
  COVERAGE_COPY, INCIDENCE_COPY, PENDING_INCIDENCE_TABLES, coverageStatusWord, linesSha256, partitionRateLines, rateLineClass,
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
const CHAPTER_DIR = "us/policies/cbp/us-tariff-schedule/generated";
const EXPECTED_CHAPTER_COUNT = 100;
const MISSING_EXCERPT = "Source text available in corpus reader";

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

type Rule = { name: string; source?: string; versions?: { values?: Record<string, unknown>; formula?: string }[]; metadata?: { proof?: { atoms?: Atom[] } } };
type Atom = { source?: { corpus_citation_path?: string; excerpt?: string }; context?: { subdivision?: string } };
type Module = { module?: { source_verification?: { corpus_citation_paths?: string[] } }; imports?: string[]; rules?: Rule[] };
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
function parseYaml(text: string, path: string): Module {
  const mod = yaml.load(text);
  if (!mod || typeof mod !== "object") throw new Error(`module ${path} did not parse to a mapping`);
  return mod as Module;
}
function parseModule(path: string): Module { return parseYaml(show(RULESPEC, RULESPEC_COMMIT, path), path); }
function values(rule?: Rule) { return rule?.versions?.[0]?.values ?? {}; }
function code10(value: string | number) { return String(value).replace(/\D/g, "").padStart(10, "0"); }
function citationCode10(value: string) { return value.replace(/\D/g, "").padEnd(10, "0"); }
function displayCode(code: string) { return `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6, 8)}.${code.slice(8)}`; }
function dispositionLabel(value: unknown) { return typeof value === "string" ? value : "empty"; }
function csvCell(value: unknown) { const s = typeof value === "string" ? value : JSON.stringify(value); return `"${s.replaceAll('"', '""')}"`; }
function escapeRegExp(text: string) { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function mentions(text: string, name: string) { return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text); }

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

// Incidence tables key members by heading, subheading or statistical line,
// stored as numbers, so a leading zero may be lost ("301" for 0301).
export function memberPrefix(member: string) {
  return member.padStart(member.length % 2 ? member.length + 1 : member.length, "0");
}

// The one proof atom whose excerpt is the member's code. Anything else means
// the page would cite a page that does not list the code, so it fails.
export function atomNamingMember(atoms: Atom[], prefix: string, where: string) {
  const named = atoms.filter((atom) => (atom.source?.excerpt ?? "").replace(/\D/g, "") === prefix);
  if (named.length !== 1 || !named[0].source?.corpus_citation_path) throw new Error(`${where}: ${named.length} proof atoms name member ${prefix}`);
  return named[0];
}

export const CORPUS_PATH = `data/corpus/provisions/us/statute/${CORPUS_RELEASE}.jsonl`;
// The chapter 99 notes the incidence tables cite (the ledger's chapter-99-notes root).
export const NOTES_RELEASE = "2026-08-04-usitc-hts-2026-rev15-notes";
const NOTES_PATH = `data/corpus/provisions/us/statute/${NOTES_RELEASE}.jsonl`;

function loadCorpus(path = CORPUS_PATH) {
  const text = show(CORPUS, CORPUS_COMMIT, path);
  const records = new Map<string, { body: string; citation_path: string }>();
  for (const raw of text.trim().split("\n")) {
    const row = JSON.parse(raw);
    if (row.citation_path?.startsWith("us/statute/hts/")) records.set(row.citation_path, row);
  }
  return { records, sha256: sha256(text) };
}

function assertLedgerRoot(ledger: Ledger, root: string, path: string, version: string, digest: string) {
  const entry = ledger.generated_facts?.corpus_roots?.[root];
  if (entry?.path !== path || entry.commit !== CORPUS_COMMIT || entry.version !== version || entry.sha256 !== digest) {
    throw new Error(`${path} at ${CORPUS_COMMIT} is not the closure ledger's ${root} root`);
  }
}

// The page calls this scope a corpus scope, not a signed release, because no
// release selector at the corpus pin includes it; fail if that changes.
function assertScopeOutsideReleaseSelectors() {
  for (const path of listFiles(CORPUS, CORPUS_COMMIT, "manifests/releases")) {
    if (show(CORPUS, CORPUS_COMMIT, path).includes(`"${CORPUS_RELEASE}"`)) throw new Error(`${path} now includes ${CORPUS_RELEASE}; update the corpus copy on the tariff pages`);
  }
}

// The certificate is vendored byte-for-byte (src/lib/tariff-certificate.ts);
// the closure ledger it content-addresses must hash to the certificate's
// evidence entry and name the same rulespec and corpus commits.
export function bindCertificate(certificateBytes: Buffer, ledgerText: string, corpusCommit = CORPUS_COMMIT) {
  const certificate = JSON.parse(certificateBytes.toString("utf8")) as Certificate;
  const ledgerEvidence = certificate.evidence?.find((item) => item.artifact === CLOSURE_LEDGER_PATH);
  if (!ledgerEvidence?.sha256) throw new Error(`certificate has no evidence entry for ${CLOSURE_LEDGER_PATH}`);
  if (sha256(ledgerText) !== ledgerEvidence.sha256) throw new Error("closure ledger does not hash to the certificate's evidence entry");
  const ledger = yaml.load(ledgerText) as Ledger;
  const evaluated = certificate.verdicts?.closed?.rulespec_commit;
  if (!evaluated || ledger.program?.rulespec_ref !== evaluated) throw new Error("certificate and closure ledger name different rulespec commits");
  const certificateCorpus = certificate.verdicts?.closed?.reproduction_contract?.external_corpus_git_object?.commit;
  if (certificateCorpus !== corpusCommit || ledger.reproduction_contract?.external_corpus_git_object?.commit !== corpusCommit) {
    throw new Error(`certificate names corpus ${certificateCorpus}, not the pinned ${corpusCommit}`);
  }
  return { sha256: sha256(certificateBytes), evaluatedRulespecCommit: evaluated, ledger, ledgerSha256: ledgerEvidence.sha256 };
}

export function loadCertificateBinding() {
  const binding = bindCertificate(readFileSync(CERTIFICATE_FILE), show(ORACLES, CERTIFICATE_COMMIT, CLOSURE_LEDGER_PATH));
  const tariffTrees = Object.fromEntries(TARIFF_TREES.map((path) => {
    const pinned = treeHash(RULESPEC, RULESPEC_COMMIT, path);
    if (pinned !== treeHash(RULESPEC, binding.evaluatedRulespecCommit, path)) throw new Error(`${path} at ${RULESPEC_COMMIT} differs from the certificate's evaluated ${binding.evaluatedRulespecCommit}`);
    return [path, pinned];
  }));
  return { ...binding, tariffTrees };
}

// A rule is "defined" when some module lists it by name; one the compositions
// reference but nothing defines can only arrive as an input. git grep exits 1
// for no match; any other failure is an error, not an absence.
function ruleIsDefined(name: string) {
  try {
    git(RULESPEC, "grep", "-q", "-E", `^ *- name: ${escapeRegExp(name)} *$`, RULESPEC_COMMIT, "--", "us", "programs");
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

type Chapter = { path: string; text: string; module: Module };
let cachedChapters: Chapter[] | undefined;
function chapterCompositions() {
  if (!cachedChapters) {
    cachedChapters = listFiles(RULESPEC, RULESPEC_COMMIT, CHAPTER_DIR).filter((p) => p.endsWith(".yaml") && !p.endsWith(".test.yaml")).map((path) => {
      const text = show(RULESPEC, RULESPEC_COMMIT, path);
      return { path, text, module: parseYaml(text, path) };
    });
    if (cachedChapters.length !== EXPECTED_CHAPTER_COUNT) throw new Error(`expected ${EXPECTED_CHAPTER_COUNT} chapter compositions, found ${cachedChapters.length}`);
  }
  return cachedChapters;
}

function stackFormula(chapter: Chapter) {
  const stack = chapter.module.rules?.find((rule) => rule.name === "schedule_statutory_stack");
  const formula = stack?.versions?.at(-1)?.formula;
  if (!formula) throw new Error(`${chapter.path} has no schedule_statutory_stack formula`);
  return formula;
}

export function checkEvidence(label: string, evidence: CoverageEvidence | undefined, pinnedFiles: string[]) {
  if (!evidence) return;
  const fail = (message: string) => { throw new Error(`${label}: ${message} at rulespec-us ${RULESPEC_COMMIT}`); };
  for (const path of evidence.present ?? []) if (!pinnedFiles.includes(path)) fail(`expected ${path}`);
  for (const prefix of evidence.absent ?? []) if (pinnedFiles.some((file) => file.startsWith(prefix))) fail(`expected nothing under ${prefix}`);
  if (evidence.absentMatching) {
    const pattern = new RegExp(evidence.absentMatching, "i");
    const hit = pinnedFiles.find((file) => pattern.test(file));
    if (hit) fail(`expected no path matching ${pattern}, found ${hit}`);
  }
  for (const { path, text } of evidence.fileContains ?? []) if (!show(RULESPEC, RULESPEC_COMMIT, path).includes(text)) fail(`expected ${path} to contain ${text}`);
  for (const { module, rules } of evidence.rules ?? []) {
    const names = new Set((parseModule(module).rules ?? []).map((rule) => rule.name));
    for (const name of rules) if (!names.has(name)) fail(`expected rule ${name} in ${module}`);
  }
  if (evidence.chapters) {
    const { imports = [], rules = [], stackTerms = [], references = [], notDefined = [] } = evidence.chapters;
    for (const chapter of chapterCompositions()) {
      const declared = new Set(chapter.module.imports ?? []);
      const names = new Set((chapter.module.rules ?? []).map((rule) => rule.name));
      const stack = stackTerms.length ? stackFormula(chapter) : "";
      for (const name of imports) if (!declared.has(name)) fail(`expected ${chapter.path} to import ${name}`);
      for (const name of rules) if (!names.has(name)) fail(`expected rule ${name} in ${chapter.path}`);
      for (const term of stackTerms) if (!mentions(stack, term)) fail(`expected ${chapter.path} to sum ${term} into schedule_statutory_stack`);
      for (const name of references) if (!mentions(chapter.text, name)) fail(`expected ${chapter.path} to reference ${name}`);
      for (const name of notDefined) if (names.has(name)) fail(`expected ${chapter.path} not to define ${name}`);
    }
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
  assertLedgerRoot(binding.ledger, "hts-rate-provisions", CORPUS_PATH, CORPUS_RELEASE, corpusSha256);
  const { records: notes, sha256: notesSha256 } = loadCorpus(NOTES_PATH);
  assertLedgerRoot(binding.ledger, "chapter-99-notes", NOTES_PATH, NOTES_RELEASE, notesSha256);
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
          { field: "General rate", path: `/${citationPath}`, excerpt: generalAtom?.source?.excerpt ?? MISSING_EXCERPT },
          { field: "Column 2 rate", path: `/${citationPath}`, excerpt: columnAtom?.source?.excerpt ?? MISSING_EXCERPT },
        ], memberships: [], canada338Warning: hts10 === "2203000000" });
    }
  }

  // Every incidence table at the pin needs page copy, so a newly merged table
  // (for example U.S. notes 50 and 52) fails the build until the page names it.
  // A member covers every rate line under its code. A 10-digit statistical
  // member under an 8-digit rate line is attributed to that rate line with the
  // statistical number named, because the note lists part of the line only.
  const pinnedFiles = listFiles(RULESPEC, RULESPEC_COMMIT, "us/policies");
  const incidenceFiles = pinnedFiles.filter((p) => p.startsWith(`${INCIDENCE_DIR}/`) && p.endsWith(".yaml") && !p.endsWith(".test.yaml"))
    .map((p) => p.slice(INCIDENCE_DIR.length + 1, -".yaml".length));
  const incidenceTables: IncidenceTable[] = [];
  for (const filename of incidenceFiles) {
    const key = filename.split("-")[0];
    const copy = INCIDENCE_COPY[key];
    if (!copy) throw new Error(`incidence table ${filename} has no page copy in INCIDENCE_COPY`);
    const mod = parseModule(`${INCIDENCE_DIR}/${filename}.yaml`);
    const subdivisions = new Set<string>();
    const whole = new Set<string>();
    const bySuffix = new Set<string>();
    for (const rule of mod.rules ?? []) {
      const atoms = rule.metadata?.proof?.atoms ?? [];
      for (const atom of atoms) if (atom.context?.subdivision) subdivisions.add(atom.context.subdivision);
      for (const member of Object.keys(values(rule))) {
        const prefix = memberPrefix(member);
        const atom = atomNamingMember(atoms, prefix, `${filename} ${rule.name}`);
        // The "read authority" link must land on a page that lists the code.
        if (!notes.get(atom.source!.corpus_citation_path!)?.body.includes(atom.source!.excerpt!)) throw new Error(`${filename}: ${atom.source!.corpus_citation_path} does not list ${atom.source!.excerpt}`);
        const explanation = renderMembershipExplanation(key, rule, atom);
        const citationPath = `/${atom.source!.corpus_citation_path}`;
        let covered = 0;
        for (const line of lines.values()) {
          if (!line.hts10.startsWith(prefix)) continue;
          covered += 1;
          whole.add(line.hts10);
          line.memberships.push({ family: copy.family, explanation, citationPath });
        }
        if (covered) continue;
        const rateLine = prefix.length === 10 ? lines.get(`${prefix.slice(0, 8)}00`) : undefined;
        if (!rateLine || rateLine.citations[0].path.split("/").at(-1)!.replace(/\D/g, "").length !== 8) throw new Error(`${filename} ${rule.name}: member ${prefix} matches no rate line`);
        bySuffix.add(rateLine.hts10);
        rateLine.memberships.push({ family: copy.family, explanation: `${explanation}, via statistical reporting number ${displayCode(prefix)}`, citationPath });
      }
    }
    const lineCount = new Set([...whole, ...bySuffix]).size;
    const suffixOnlyLineCount = [...bySuffix].filter((code) => !whole.has(code)).length;
    incidenceTables.push({ module: `${INCIDENCE_DIR}/${filename}.yaml`, note: copy.note, family: copy.family, status: "encoded", subdivisions: [...subdivisions].sort(), lineCount, suffixOnlyLineCount });
  }
  for (const pending of PENDING_INCIDENCE_TABLES) {
    checkEvidence(pending.family, { absent: [pending.absentPrefix] }, pinnedFiles);
    incidenceTables.push({ module: null, note: pending.note, family: pending.family, status: pending.status, subdivisions: [], lineCount: 0, suffixOnlyLineCount: 0, detail: pending.detail });
  }

  const sorted = [...lines.values()].sort((a, b) => a.hts10.localeCompare(b.hts10));
  if (sorted.length !== EXPECTED_LINE_COUNT) throw new Error(`expected ${EXPECTED_LINE_COUNT} lines, got ${sorted.length}`);
  // The encoded row says each rate cites its Rev. 15 text.
  for (const line of sorted) {
    if (rateLineClass(line) === "encoded" && line.citations.some((citation) => citation.excerpt === MISSING_EXCERPT)) throw new Error(`encoded line ${line.hts10} lacks a rate excerpt`);
  }

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

  // --first-parent dates changes by when they reached the pinned branch, so a
  // side-branch commit's own date is never reported.
  const commitDate = (...args: string[]) => new Date(Number(git(RULESPEC, "log", "--first-parent", "-1", "--format=%ct", RULESPEC_COMMIT, ...args).trim()) * 1000).toISOString();
  const builtAt = commitDate();
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

export function renderJson(artifact: TariffArtifact) {
  return `${JSON.stringify(artifact)}\n`;
}

export function renderCsv(artifact: TariffArtifact) {
  const meta = artifact.metadata;
  const rows = [
    ["hts10", "display_code", "description", "general_rate", "general_disposition", "column_2_rate", "column_2_disposition", "memberships", "membership_citations", "rate_citations", "canada_338_warning", "rulespec_commit", "corpus_release", "certificate_sha256", "built_at"],
    ...artifact.lines.map((l) => [l.hts10, l.displayCode, l.description, l.generalRate, l.generalDisposition, l.column2Rate, l.column2Disposition, l.memberships.map((m) => m.explanation).join(" | ") || "not determined", l.memberships.map((m) => m.citationPath).join(" | ") || "not determined", l.citations.map((c) => `${c.field}: ${c.path}`).join(" | "), String(l.canada338Warning), meta.rulespecCommit, meta.corpusRelease, meta.certificateSha256, meta.builtAt]),
  ];
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

if (import.meta.main) {
  const artifact = buildArtifact(); mkdirSync(dirname(OUT_PUBLIC_JSON), { recursive: true }); mkdirSync(dirname(OUT_CSV), { recursive: true });
  const json = renderJson(artifact);
  writeFileSync(OUT_PUBLIC_JSON, json);
  writeFileSync(OUT_CSV, renderCsv(artifact));
  console.log(`wrote ${artifact.lines.length} lines (${sha256(json)})`);
}

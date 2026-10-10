/**
 * What a RuleSpec module actually encodes, read from its YAML, for the
 * program bundle measure. A module's declared source is not proof that it
 * encodes that provision: a module can defer branches of it, or hold no rules
 * at all. So the measure credits only the provisions its rules cite, and
 * records what it defers and whether it merged under a validation waiver.
 *
 * Collector-only: it parses YAML, so the page never loads it.
 */
import yaml from "js-yaml";
import type { ModuleFacts } from "./program-bundles";

interface ModuleRow {
  citation_path: string;
  jurisdiction: string;
  file_path: string;
  raw_yaml: string | null;
  source_citation_paths: string[] | null;
}

type Yaml = Record<string, unknown>;

const isLaw = (path: string) => ["statute", "regulation"].includes(path.split("/")[1]);

/**
 * A law path at its section or above: us/statute/7/2015, us/regulation/7/273/9.
 * Proof atoms often name the whole section a formula draws on, which says
 * nothing about which of its paragraphs the rule encodes.
 */
const sectionOrAbove = (path: string) => {
  const parts = path.split("/");
  return (parts[1] === "statute" && parts.length <= 4) || (parts[1] === "regulation" && parts.length <= 5);
};

/** Atom kinds that point at another rule, not at the law a rule encodes. */
const REFERENCE_ATOMS = new Set(["import", "ordering"]);

/**
 * A rule's source text as a corpus path, when it names a US Code or CFR
 * provision: "7 CFR 273.9(a)(1)" is us/regulation/7/273/9/a/1, "7 U.S.C.
 * 2014(e)(6)(A)" is us/statute/7/2014/e/6/A. Prose sources give null.
 */
export function sourceTextPath(text: string): string | null {
  const parts = (tail: string) => [...tail.matchAll(/\(([^()\s]+)\)/g)].map((m) => m[1]);
  const cfr = text.match(/(\d+)\s*C\.?\s*F\.?\s*R\.?\s*(?:§+\s*)?(\d+)\.(\d+[a-z]?)((?:\([^()\s]+\))*)/i);
  if (cfr) return ["us", "regulation", cfr[1], cfr[2], cfr[3], ...parts(cfr[4])].join("/");
  const usc = text.match(/(\d+)\s*U\.?\s*S\.?\s*C\.?\s*(?:§+\s*)?(\d+[A-Za-z]*(?:-\d+)?)((?:\([^()\s]+\))*)/);
  if (usc) return ["us", "statute", usc[1], usc[2], ...parts(usc[3])].join("/");
  return null;
}

/**
 * A module output path as a corpus path: us:statutes/26/3401/a#wages is
 * us/statute/26/3401/a; us:regulations/7-cfr/273/9/b#x is
 * us/regulation/7/273/9/b. Policy outputs have no corpus path.
 */
export function outputPath(output: string): string | null {
  const m = output.match(/^([a-z-]+):([^#]+)/);
  if (!m) return null;
  const [, jurisdiction, path] = m;
  const statute = path.match(/^statutes\/(.+)$/);
  if (statute) return `${jurisdiction}/statute/${statute[1]}`;
  const cfr = path.match(/^regulations\/(\d+)-cfr\/(.+)$/);
  if (cfr) return `${jurisdiction}/regulation/${cfr[1]}/${cfr[2]}`;
  const regulation = path.match(/^regulations\/(.+)$/);
  if (regulation) return `${jurisdiction}/regulation/${regulation[1]}`;
  return null;
}

/** The provisions a rule's proof atoms ground it in, finer than a law section. */
function proofPaths(rule: Yaml): string[] {
  const metadata = rule.metadata as Yaml | undefined;
  const proof = metadata?.proof as Yaml | undefined;
  const atoms = (proof?.atoms as Yaml[] | undefined) ?? [];
  return atoms
    .filter((atom) => !REFERENCE_ATOMS.has(atom.kind as string))
    .map((atom) => ((atom.source as Yaml | undefined)?.corpus_citation_path as string | undefined) ?? null)
    .filter((p): p is string => Boolean(p) && !(isLaw(p as string) && sectionOrAbove(p as string)));
}

/**
 * A module's facts. Its rules' cited paths are each rule's own source text
 * (when it names a code or CFR provision below a section) and its proof
 * atoms' corpus paths below a law section. What it names only as a whole is
 * broad: a rule source naming a whole section, and, when its rules name
 * nothing readable, its own source (a law module's own path, a policy
 * module's non-law sources); a broad path makes provisions partly encoded.
 * A deferred module, or one with no rules, cites nothing and defers its
 * source. Policy modules keep only non-law sources: a pipeline that builds on
 * a statute does not encode it.
 */
export function moduleFacts(row: ModuleRow, declared: string[], waivers: Set<string>): ModuleFacts {
  let doc: Yaml = {};
  try {
    doc = (yaml.load(row.raw_yaml ?? "") as Yaml) ?? {};
  } catch {
    doc = {};
  }
  const module = (doc.module as Yaml | undefined) ?? {};
  const rules = ((doc.rules as Yaml[] | undefined) ?? []).filter((r) => r && typeof r === "object");
  const law = isLaw(row.citation_path);
  const sources = law
    ? [row.citation_path]
    : (declared.length ? declared : (row.source_citation_paths ?? [])).filter((s) => !isLaw(s));
  const deferredOutputs = ((module.deferred_outputs as Yaml[] | undefined) ?? [])
    .map((d) => (typeof d.output === "string" ? outputPath(d.output) : null))
    .filter((p): p is string => Boolean(p));
  const deferredModule = module.status === "deferred" || rules.length === 0;

  const cited = new Set<string>();
  const broad = new Set<string>();
  if (!deferredModule) {
    for (const rule of rules) {
      const fromText = typeof rule.source === "string" ? sourceTextPath(rule.source) : null;
      // A source naming a whole law section says no more than a section-wide proof atom.
      if (fromText) (isLaw(fromText) && sectionOrAbove(fromText) ? broad : cited).add(fromText);
      for (const path of proofPaths(rule)) cited.add(path);
    }
    // Rules that name nothing a path can be read from: the module touches its
    // own source, without saying which of its provisions it encodes.
    if (cited.size === 0 && broad.size === 0) for (const source of sources) broad.add(source);
  }
  return {
    module: row.citation_path,
    sources,
    cited: [...cited],
    broad: [...broad],
    deferred: [...new Set([...deferredOutputs, ...(deferredModule ? sources : [])])],
    rules: rules.length,
    waived: waivers.has(`${row.jurisdiction}/${row.file_path}`),
  };
}

/** The module files that merged under a validation waiver, as <jurisdiction>/<file path>. */
export function waivedModules(knownValidationGaps: string): Set<string> {
  try {
    const doc = (yaml.load(knownValidationGaps) as Yaml) ?? {};
    return new Set(Object.keys((doc.validate_failures as Yaml | undefined) ?? {}));
  } catch {
    return new Set();
  }
}

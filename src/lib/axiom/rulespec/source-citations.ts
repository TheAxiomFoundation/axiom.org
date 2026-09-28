import { dumpRuleYaml, type RuleSpecDoc, type RuleSpecRule } from "./doc";

/**
 * Which corpus provisions does a RuleSpec module encode?
 *
 * Every module declares its sources twice over: at module level
 * (``source_verification.corpus_citation_path`` — the singular form
 * the singular-source rule mandates, used by 889 of 1,139 rulespec-us
 * modules — or the legacy plural ``corpus_citation_paths`` list) and
 * per rule through proof atoms (``metadata.proof.atoms[].source
 * .corpus_citation_path``).
 *
 * Two sets come out of that, with different search meanings:
 *
 * - ``all``: every declared path, including import and ordering
 *   references. Good for broad source search.
 * - ``values``: every provision that grounds a rule, excluding only
 *   import and ordering references, plus the singular module source.
 *   This broad set is a search aid. The reader uses materialized
 *   rule-level rows so it can rank and bound common citations without
 *   fetching whole files.
 */
export const VALUE_ATOM_KINDS: ReadonlySet<string> = new Set([
  "parameter",
  "parameter_table",
  "table_cell",
  "amount",
  "effective_period",
  "unit",
  "default",
]);

/** Atom kinds that point between RuleSpec declarations rather than
 * grounding a rule in corpus text. */
export const REFERENCE_ATOM_KINDS = new Set(["import", "ordering"]);

export type RuleCitationRank = 0 | 1 | 2 | 3;

export interface RuleCitationRow {
  citation_path: string;
  module_citation_path: string;
  rule_name: string;
  file_path: string;
  repo: string;
  jurisdiction: string;
  is_module_source: boolean;
  atom_kinds: string[];
  rank: RuleCitationRank;
  rule_yaml: string;
}

export interface CitationPathSets {
  all: string[];
  values: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeCitationPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^\/+/, "").trim();
  return normalized || null;
}

/** Module-level declarations: the singular source (if any) and the
 *  legacy plural list (possibly empty). */
export function moduleSourcePaths(doc: RuleSpecDoc): {
  singular: string | null;
  plural: string[];
} {
  const verification = asRecord(doc.module.source_verification);
  const singular = normalizeCitationPath(verification?.corpus_citation_path);
  const pluralRaw = verification?.corpus_citation_paths;
  const plural: string[] = [];
  if (Array.isArray(pluralRaw)) {
    for (const entry of pluralRaw) {
      const path = normalizeCitationPath(entry);
      if (path && !plural.includes(path)) plural.push(path);
    }
  }
  return { singular, plural };
}

function* ruleAtoms(
  rule: RuleSpecRule,
): Generator<{ kind: string | null; path: string }> {
  const metadata = asRecord(rule.raw.metadata);
  const proof = asRecord(metadata?.proof);
  const atoms = proof?.atoms;
  if (!Array.isArray(atoms)) return;
  for (const atomValue of atoms) {
    const atom = asRecord(atomValue);
    const source = asRecord(atom?.source);
    const path = normalizeCitationPath(source?.corpus_citation_path);
    if (!path) continue;
    const kind = typeof atom?.kind === "string" ? atom.kind : null;
    yield { kind, path };
  }
}

/** Rank a rule-level citation for bounded reader presentation. */
export function rankForKinds(
  kinds: Set<string>,
  isModuleSource: boolean,
): RuleCitationRank {
  if (isModuleSource) return 0;
  for (const kind of kinds) {
    if (VALUE_ATOM_KINDS.has(kind)) return 1;
  }
  if (kinds.has("formula") || kinds.has("effective_period")) return 2;
  return 3;
}

/** Paths a rule's non-reference grounding atoms cite. */
export function ruleValueCitationPaths(rule: RuleSpecRule): Set<string> {
  const paths = new Set<string>();
  for (const atom of ruleAtoms(rule)) {
    if (!atom.kind || !REFERENCE_ATOM_KINDS.has(atom.kind)) {
      paths.add(atom.path);
    }
  }
  return paths;
}

/**
 * Materialize one row per rule and cited corpus path.
 *
 * A module's singular source grounds every rule in that module. Proof atoms
 * add rule-specific paths unless they are import or ordering references. The
 * YAML stays as a list item so callers can splice rows beneath a synthetic
 * document's ``rules`` key without parsing the original module file.
 */
export function ruleCitationRows(
  doc: RuleSpecDoc,
  moduleCitationPath: string,
  filePath: string,
  repo: string,
  jurisdiction: string,
): RuleCitationRow[] {
  const { singular } = moduleSourcePaths(doc);
  const rows: RuleCitationRow[] = [];

  for (const rule of doc.rules) {
    const kindsByPath = new Map<string, Set<string>>();
    if (singular) kindsByPath.set(singular, new Set());

    for (const atom of ruleAtoms(rule)) {
      if (atom.kind && REFERENCE_ATOM_KINDS.has(atom.kind)) continue;
      let kinds = kindsByPath.get(atom.path);
      if (!kinds) {
        kinds = new Set();
        kindsByPath.set(atom.path, kinds);
      }
      if (atom.kind) kinds.add(atom.kind);
    }

    const ruleYaml = dumpRuleYaml(rule);
    for (const [citationPath, kinds] of kindsByPath) {
      const isModuleSource = citationPath === singular;
      rows.push({
        citation_path: citationPath,
        module_citation_path: moduleCitationPath,
        rule_name: rule.name,
        file_path: filePath,
        repo,
        jurisdiction,
        is_module_source: isModuleSource,
        atom_kinds: [...kinds],
        rank: rankForKinds(kinds, isModuleSource),
        rule_yaml: ruleYaml,
      });
    }
  }

  return rows;
}

export function extractCitationPathSets(doc: RuleSpecDoc): CitationPathSets {
  const all = new Set<string>();
  const values = new Set<string>();
  const { singular, plural } = moduleSourcePaths(doc);
  if (singular) {
    all.add(singular);
    values.add(singular);
  }
  for (const path of plural) all.add(path);
  for (const rule of doc.rules) {
    for (const atom of ruleAtoms(rule)) {
      all.add(atom.path);
      if (!atom.kind || !REFERENCE_ATOM_KINDS.has(atom.kind)) {
        values.add(atom.path);
      }
    }
  }
  return { all: [...all], values: [...values] };
}

/**
 * Does this rule encode the provision at ``citationPath``? True when
 * the module's singular source IS that provision (every rule in the
 * module is encoded from it — including the 135 rulespec-us modules
 * that carry no proof atoms at all) or when the rule's own
 * non-reference grounding atoms cite it.
 */
export function ruleEncodesProvision(
  doc: RuleSpecDoc,
  rule: RuleSpecRule,
  citationPath: string,
): boolean {
  const { singular } = moduleSourcePaths(doc);
  if (singular === citationPath) return true;
  return ruleValueCitationPaths(rule).has(citationPath);
}

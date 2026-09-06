import { parseAppVisibility, type AppVisibility } from "./registry-visibility";
import { searchRules, type SearchHit } from "@/lib/supabase";
import {
  EXTRA_JURISDICTION_LABELS,
  JURISDICTIONS_SEED,
} from "@/lib/axiom/jurisdictions-seed";
import {
  findPrograms,
  type Program,
  type ProgramAnchor,
} from "@/lib/axiom/programs";
import {
  gitHubApiHeaders,
  ruleSpecRepoAppVisibility,
} from "@/lib/axiom/repo-map";
import { parseTreeEntries, type EncodedFile } from "@/lib/axiom/rulespec/repo-listing";
import {
  parseRuleSpec,
  tokenizeFormula,
  type RuleSpecRule,
} from "@/lib/axiom/rulespec/doc";
import {
  HAYSTACK_TOKEN_IMPLICATIONS,
  QUERY_STOPWORDS,
  QUERY_TOKEN_IMPLICATIONS,
  SINGLE_TOKEN_PROGRAM_ALIASES,
  type TokenImplication,
} from "@/lib/axiom/search-lexicon";
import { fetchIndexedRuleSpecCandidates } from "@/lib/axiom/rulespec-index";
import {
  isGatedJurisdiction,
  readableJurisdictionHints,
  withoutGatedRows,
} from "@/lib/axiom/rulespec/index-visibility";

export interface AxiomSearchOptions {
  jurisdiction?: string;
  docType?: string;
  limit?: number;
}

export interface ProgramSearchResult {
  program: Program;
  anchors: ProgramAnchor[];
}

export interface EncodedSearchResult extends EncodedFile {
  label: string;
  jurisdictionLabel: string;
  matchKind: "file" | "symbol";
  symbolMatches: RuleSpecSymbolMatch[];
  fileSummary: RuleSpecFileSummary | null;
  score: number;
}

export interface RuleSpecSymbolMatch {
  name: string;
  label: string;
  kind: string | null;
  source: string | null;
  formula: string | null;
  matchedTerms: string[];
  score: number;
}

export interface RuleSpecFileSummary {
  summary: string | null;
  ruleCount: number;
  importCount: number;
  imports: string[];
  previewRules: RuleSpecSymbolMatch[];
}

export interface AxiomSearchResults {
  query: string;
  programs: ProgramSearchResult[];
  encoded: EncodedSearchResult[];
  corpus: SearchHit[];
}

interface GitHubRepo {
  name: string;
  default_branch: string;
  archived?: boolean;
}

interface GitHubTreeEntry {
  path: string;
  type: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[];
}

interface RuleSpecSearchRoot {
  repo: string;
  branch: string;
  jurisdiction: string;
  prefix: string | null;
}

interface EncodedFileCandidate extends EncodedFile {
  /** Repo location for on-demand YAML fetches; null for index rows. */
  root: RuleSpecSearchRoot | null;
  /** Raw YAML when it arrived with the candidate (index rows). */
  content?: string | null;
}

interface EncodedFileBaseScore
  extends Omit<EncodedSearchResult, "symbolMatches" | "matchKind" | "fileSummary"> {
  pathMatchScore: number;
}

interface TokenMatch {
  queryToken: string;
  canonicalToken: string;
  similarity: number;
}

const GITHUB_ORG = "TheAxiomFoundation";
const REVALIDATE_SECONDS = 600;
const ENCODED_LIMIT_DEFAULT = 12;
const PROGRAM_LIMIT = 4;
const CORPUS_LIMIT_DEFAULT = 20;
const JURISDICTION_BY_SLUG = new Map(
  JURISDICTIONS_SEED.map((jurisdiction) => [jurisdiction.slug, jurisdiction])
);
const DOC_TYPE_TO_REPO_BUCKET: Readonly<Record<string, string>> = Object.freeze({
  statute: "statutes",
  regulation: "regulations",
  policy: "policies",
  manual: "manuals",
  rulemaking: "rulemaking",
  form: "forms",
  guidance: "guidance",
});
const ACRONYMS = new Set([
  "aca",
  "cdhs",
  "cfr",
  "cola",
  "eitc",
  "fy",
  "gst",
  "hhs",
  "irs",
  "snap",
  "ssi",
  "tanf",
  "uc",
  "usc",
  "usda",
  "wic",
]);

export async function searchAxiom(
  query: string,
  options: AxiomSearchOptions = {}
): Promise<AxiomSearchResults> {
  const q = query.trim();
  if (!q) return { query: "", programs: [], encoded: [], corpus: [] };

  const limit = Math.max(1, Math.min(options.limit ?? CORPUS_LIMIT_DEFAULT, 50));
  const [rawPrograms, encoded, corpus] = await Promise.all([
    searchProgramResults(q, options),
    searchEncodedRuleSpecs(q, options, Math.min(limit, ENCODED_LIMIT_DEFAULT)).catch(
      () => []
    ),
    searchRules(q, {
      jurisdiction: options.jurisdiction,
      docType: options.docType,
      limit,
    }),
  ]);

  const encodedPaths = new Set(encoded.map((hit) => hit.citationPath));
  const programs = pruneProgramResults(q, rawPrograms, encoded);
  return {
    query: q,
    programs,
    encoded,
    corpus: corpus.filter((hit) => !encodedPaths.has(hit.citation_path)),
  };
}

function pruneProgramResults(
  query: string,
  programs: ProgramSearchResult[],
  encoded: EncodedSearchResult[]
): ProgramSearchResult[] {
  const tokens = expandQueryTokens(tokenise(query));
  const hintedStates = [...inferJurisdictions(tokens)].filter((jurisdiction) =>
    /^us-[a-z]{2}$/.test(jurisdiction)
  );
  if (hintedStates.length === 0) return programs;
  const isPrunable = (result: ProgramSearchResult) =>
    result.program.jurisdiction === "us" &&
    result.program.stateAdministered === true;
  if (!programs.some(isPrunable)) return programs;

  const hasStateEncodedHit = encoded.some((hit) => {
    const jurisdiction = hit.citationPath.split("/")[0];
    return hintedStates.includes(jurisdiction);
  });
  const hasStateProgram = programs.some((result) =>
    hintedStates.includes(result.program.jurisdiction)
  );
  if (!hasStateEncodedHit || hasStateProgram) return programs;

  return programs.filter((result) => !isPrunable(result));
}

function searchProgramResults(
  query: string,
  options: AxiomSearchOptions
): ProgramSearchResult[] {
  const queryTokens = expandQueryTokens(tokenise(query));
  return findPrograms(query, PROGRAM_LIMIT)
    .filter((program) => !options.jurisdiction || program.jurisdiction === options.jurisdiction)
    .map((program) => {
      const anchors = program.anchors.filter((anchor) => {
        if (!options.docType) return true;
        return anchor.citationPath.split("/")[1] === options.docType;
      });
      return {
        program,
        anchors: rankProgramAnchors(program, anchors, queryTokens),
      };
    })
    .filter((result) => result.anchors.length > 0);
}

function rankProgramAnchors(
  program: Program,
  anchors: ProgramAnchor[],
  queryTokens: string[]
): ProgramAnchor[] {
  const topicTokens = programTopicTokens(program, queryTokens);
  if (topicTokens.length === 0) return anchors;

  const scored = anchors
    .map((anchor, index) => ({
      anchor,
      index,
      score: scoreProgramAnchor(anchor, topicTokens),
    }))
    .filter((item) => item.score > 0);

  if (scored.length > 0) {
    return scored
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 2)
      .map((item) => item.anchor);
  }

  // Keep curated destinations when the query clearly names this program but
  // the extra topic words do not map cleanly to one anchor. Examples:
  // "TANF cash assistance" and "premium tax credit poverty line".
  if (programAliasFullyMatched(program, queryTokens)) return anchors.slice(0, 2);
  // Keep a single curated destination for highly specific state program
  // results such as "CO SNAP standard deduction"; it serves as context,
  // while encoded symbol hits carry the actual answer.
  if (anchors.length === 1 && program.jurisdiction !== "us") return anchors;
  return [];
}

function programAliasFullyMatched(program: Program, queryTokens: string[]): boolean {
  return program.aliases.some((alias) => {
    const aliasTokens = tokenise(alias);
    return (
      aliasTokens.length > 0 &&
      aliasTokens.every((token) => queryTokens.includes(token))
    );
  });
}

function programTopicTokens(program: Program, queryTokens: string[]): string[] {
  const programTokens = new Set<string>();
  for (const alias of program.aliases) {
    const aliasTokens = tokenise(alias);
    if (aliasTokens.every((token) => queryTokens.includes(token))) {
      for (const token of aliasTokens) programTokens.add(token);
    }
  }
  for (const token of jurisdictionAliases(program.jurisdiction, jurisdictionLabelFor(program.jurisdiction)).flat()) {
    programTokens.add(token);
  }
  return queryTokens.filter(
    (token) => !programTokens.has(token) && !isJurisdictionToken(token)
  );
}

function scoreProgramAnchor(anchor: ProgramAnchor, topicTokens: string[]): number {
  const anchorTokens = new Set(
    tokenise(
      `${anchor.role} ${anchor.label} ${anchor.displayCitation ?? ""} ${anchor.citationPath}`
    ).flatMap(tokenVariants)
  );
  return topicTokens.reduce(
    (score, token) => score + (anchorTokens.has(token) ? 1 : 0),
    0
  );
}

export async function searchEncodedRuleSpecs(
  query: string,
  options: AxiomSearchOptions = {},
  limit = ENCODED_LIMIT_DEFAULT
): Promise<EncodedSearchResult[]> {
  const tokens = expandQueryTokens(tokenise(query));
  if (tokens.length === 0) return [];

  const matchedPrograms = fullyMatchedPrograms(query, tokens);
  const hintedJurisdictions = options.jurisdiction
    ? new Set([options.jurisdiction])
    : inferJurisdictions(tokens);
  if (!options.jurisdiction) {
    for (const jurisdiction of inferProgramJurisdictions(matchedPrograms)) {
      hintedJurisdictions.add(jurisdiction);
    }
    // A state-administered federal program has rules in both places:
    // "colorado snap" should surface the CDHS manual and the federal
    // baseline it implements.
    const stateHinted = [...hintedJurisdictions].some((jurisdiction) =>
      /^us-[a-z]{2}$/.test(jurisdiction)
    );
    if (
      stateHinted &&
      matchedPrograms.some(
        (program) => program.jurisdiction === "us" && program.stateAdministered
      )
    ) {
      hintedJurisdictions.add("us");
    }
  }
  const bucket = options.docType ? DOC_TYPE_TO_REPO_BUCKET[options.docType] : null;
  const files = await listEncodedFileCandidates(
    tokens,
    hintedJurisdictions,
    bucket
  );

  const scored = await Promise.all(
    files
      .filter((file) => !bucket || file.bucket === bucket)
      .map((file) =>
        scoreEncodedCandidate(file, tokens, hintedJurisdictions, matchedPrograms)
      )
  );

  return scored
    .filter((hit): hit is EncodedSearchResult => hit !== null)
    .sort((a, b) => b.score - a.score || a.citationPath.localeCompare(b.citationPath))
    .slice(0, limit);
}

async function scoreEncodedCandidate(
  file: EncodedFileCandidate,
  queryTokens: string[],
  hintedJurisdictions: Set<string>,
  matchedPrograms: Program[]
): Promise<EncodedSearchResult | null> {
  const base = scoreEncodedFile(
    file,
    queryTokens,
    hintedJurisdictions,
    matchedPrograms
  );
  const analysis = base ? await analyzeRuleSpecFile(file, queryTokens) : null;
  const symbolMatches = analysis?.symbolMatches ?? [];
  if (!base && symbolMatches.length === 0) return null;

  const bestSymbolScore = symbolMatches[0]?.score ?? 0;
  const pathMatchScore = base?.pathMatchScore ?? 0;
  const symbolContribution =
    pathMatchScore >= 650 ? Math.min(bestSymbolScore, 180) : bestSymbolScore;
  return {
    filePath: file.filePath,
    citationPath: file.citationPath,
    bucket: file.bucket,
    label:
      symbolMatches.length > 0
        ? symbolResultLabel(symbolMatches, file)
        : labelFromEncodedFile(file),
    jurisdictionLabel: jurisdictionLabelFor(file.citationPath.split("/")[0]),
    matchKind: symbolMatches.length > 0 ? "symbol" : "file",
    symbolMatches,
    fileSummary: analysis?.summary ?? null,
    score: (base?.score ?? 0) + symbolContribution + symbolMatches.length * 20,
  };
}

function scoreEncodedFile(
  file: EncodedFile,
  queryTokens: string[],
  hintedJurisdictions: Set<string>,
  matchedPrograms: Program[]
): EncodedFileBaseScore | null {
  const jurisdictionLabel = jurisdictionLabelFor(file.citationPath.split("/")[0]);
  const haystackTokens = encodedFileTokenSet(
    tokenise(`${file.citationPath} ${file.filePath} ${jurisdictionLabel}`)
  );
  const queryWithoutJurisdiction = queryTokens.filter(
    (token) => !isJurisdictionToken(token)
  );
  const contentTokens =
    queryWithoutJurisdiction.length > 0 ? queryWithoutJurisdiction : queryTokens;
  const tokenMatches = matchQueryTokens(contentTokens, haystackTokens);
  const matched = tokenMatches.map((match) => match.canonicalToken);
  const affinityBoost = programAffinityBoost(file, matchedPrograms);
  if (matched.length === 0 && affinityBoost === 0) return null;
  if (
    contentTokens.length >= 3 &&
    matched.length === 1 &&
    !SINGLE_TOKEN_PROGRAM_ALIASES.has(matched[0])
  ) {
    return null;
  }

  const jurisdiction = file.citationPath.split("/")[0];
  const hasStateHint = [...hintedJurisdictions].some((hint) =>
    /^us-[a-z]{2}$/.test(hint)
  );
  const jurisdictionBoost = hintedJurisdictions.has(jurisdiction)
    ? jurisdiction === "us" && hasStateHint
      ? 120
      : 450
    : 0;
  const allContentMatched = matched.length === contentTokens.length;
  const exactSegmentBoost = contentTokens.some((token) =>
    file.citationPath.split("/").includes(token)
  )
    ? 80
    : 0;
  const pathMatchScore = scoreEncodedPathMatch(file, contentTokens);
  const score =
    jurisdictionBoost +
    matched.length * 60 +
    (allContentMatched ? 240 : 0) +
    exactSegmentBoost +
    pathMatchScore +
    affinityBoost +
    fiscalYearBoost(file) +
    (file.bucket === "policies" ? 20 : 0);

  return {
    ...file,
    label: labelFromEncodedFile(file),
    jurisdictionLabel,
    score,
    pathMatchScore,
  };
}

function scoreEncodedPathMatch(file: EncodedFile, contentTokens: string[]): number {
  const meaningfulQuery = meaningfulTokens(contentTokens);
  if (meaningfulQuery.length < 2) return 0;

  const terminalSegments = file.citationPath
    .split("/")
    .slice(-2)
    .join(" ");
  const fileName = file.filePath.split("/").at(-1)?.replace(/\.yaml$/, "") ?? "";
  const terminalTokens = new Set(
    tokenise(`${terminalSegments} ${fileName}`).flatMap(tokenVariants)
  );
  const matched = meaningfulQuery.filter((token) => terminalTokens.has(token));
  if (matched.length < 2) return 0;

  const coverage = matched.length / meaningfulQuery.length;
  const exactTerminalBoost = coverage === 1 ? 900 : 0;
  return Math.round(260 + matched.length * 95 + coverage * 220 + exactTerminalBoost);
}

/**
 * Boost files the program registry already points at. Anchor paths are
 * curated one-click destinations; a terminal path segment carrying the
 * program's slug tokens is that program's own encoding. Both signals
 * come from seed data, so new programs get them for free.
 */
function programAffinityBoost(
  file: EncodedFile,
  matchedPrograms: Program[]
): number {
  let boost = 0;
  for (const program of matchedPrograms) {
    if (
      program.anchors.some(
        (anchor) =>
          file.citationPath === anchor.citationPath ||
          file.citationPath.startsWith(`${anchor.citationPath}/`)
      )
    ) {
      boost = Math.max(boost, 700);
      continue;
    }
    const slugTokens = tokenise(program.slug).filter(
      (token) => !isJurisdictionToken(token)
    );
    if (slugTokens.length === 0) continue;
    const terminalTokens = new Set(
      tokenise(file.citationPath.split("/").slice(-2).join(" ")).flatMap(
        tokenVariants
      )
    );
    if (slugTokens.every((token) => terminalTokens.has(token))) {
      boost = Math.max(boost, 600);
    }
  }
  return boost;
}

/**
 * Prefer the most recent fiscal-year edition when sibling files differ
 * only by year ("fy-2026-benefit-calculation" over "fy-2025-…").
 */
function fiscalYearBoost(file: EncodedFile): number {
  const match = file.citationPath.match(/fy-(20\d{2})/);
  if (!match) return 0;
  return Math.min(40, Math.max(0, Number(match[1]) - 2000));
}

/**
 * List candidate files for scoring — from the database index when it
 * is populated (one query, YAML included), otherwise by crawling the
 * rulespec-* repos on GitHub at request time.
 *
 * Both branches are gated on the registered ``app_visibility``: the
 * crawl through ``rootsFromRepo`` below, and the index rows through
 * ``rulespec/index-visibility.ts``. The filter is repeated here rather
 * than trusted to the index reader because this is the single funnel
 * every encoded search passes through — a future candidate source
 * wired in beside these two inherits the gate instead of re-opening
 * the hole.
 */
async function listEncodedFileCandidates(
  tokens: string[],
  hintedJurisdictions: Set<string>,
  bucket: string | null
): Promise<EncodedFileCandidate[]> {
  const readableHints = readableJurisdictionHints(hintedJurisdictions);
  if (readableHints === null) return [];
  const indexed = await fetchIndexedRuleSpecCandidates(
    tokens,
    new Set(readableHints),
    bucket
  );
  if (indexed !== null) {
    return withoutGatedRows(indexed, (row) => row.citationPath).map((row) => ({
      filePath: row.filePath,
      citationPath: row.citationPath,
      bucket: row.bucket,
      root: null,
      content: row.rawYaml,
    }));
  }

  const roots = await discoverRuleSpecSearchRoots();
  const hintedRoots =
    readableHints.length > 0
      ? roots.filter((root) => readableHints.includes(root.jurisdiction))
      : roots;
  const candidateRoots = hintedRoots.filter(
    (root) => !isGatedJurisdiction(root.jurisdiction)
  );
  return withoutGatedRows(
    dedupeEncodedFileCandidates(
      (
        await Promise.all(
          candidateRoots.map((root) => listEncodedFileCandidatesFromRoot(root))
        )
      ).flat()
    ),
    (file) => file.citationPath
  );
}

async function analyzeRuleSpecFile(
  file: EncodedFileCandidate,
  queryTokens: string[]
): Promise<{
  symbolMatches: RuleSpecSymbolMatch[];
  summary: RuleSpecFileSummary;
} | null> {
  const content =
    file.content !== undefined
      ? file.content
      : await fetchRuleSpecYaml(file).catch(() => null);
  if (!content) return null;
  const doc = parseRuleSpec(content);
  const symbolMatches = dedupeSymbolMatches(
    doc.rules.flatMap((rule) => [
      scoreRuleSpecSymbol(rule, file, queryTokens),
      ...scoreFormulaReferences(rule, file, queryTokens),
    ])
  )
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 5);
  return {
    symbolMatches,
    summary: {
      summary: doc.module.summary,
      ruleCount: doc.rules.length,
      importCount: ruleSpecImports(doc.raw).length,
      imports: ruleSpecImports(doc.raw).slice(0, 5),
      previewRules: previewRuleSpecRules(doc.rules),
    },
  };
}

function scoreRuleSpecSymbol(
  rule: RuleSpecRule,
  file: EncodedFileCandidate,
  queryTokens: string[]
): RuleSpecSymbolMatch | null {
  const formula = rule.versions.map((version) => version.formula).find(Boolean) ?? null;
  const text = [
    rule.name,
    rule.kind,
    rule.entity,
    rule.dtype,
    rule.source,
    rule.source_ref,
    formula,
  ]
    .filter(Boolean)
    .join(" ");
  const haystackTokens = new Set(tokenise(text));
  const contextTokens = contextTokenSet(
    tokenise(
      `${file.citationPath} ${file.filePath} ${jurisdictionLabelFor(
        file.citationPath.split("/")[0]
      )}`
    )
  );
  const contentTokens = queryTokens.filter(
    (token) => !isJurisdictionToken(token) && !contextTokens.has(token)
  );
  if (contentTokens.length === 0) return null;
  const tokenMatches = matchQueryTokens(contentTokens, haystackTokens);
  const matchedTerms = tokenMatches.map((match) => match.canonicalToken);
  if (matchedTerms.length === 0) return null;
  if (contentTokens.length >= 3 && matchedTerms.length === 1) return null;

  const allMatched = matchedTerms.length === contentTokens.length;
  const nameTokens = new Set(tokenise(rule.name));
  const nameMatches = matchedTerms.filter((term) => nameTokens.has(term)).length;
  const formulaTokens = new Set(tokenise(formula ?? ""));
  const formulaMatches = matchedTerms.filter((term) => formulaTokens.has(term)).length;
  const fuzzyPenalty = tokenMatches.reduce(
    (penalty, match) => penalty + (1 - match.similarity) * 45,
    0
  );
  const score =
    matchedTerms.length * 110 +
    (allMatched ? 420 : 0) +
    nameMatches * 90 +
    formulaMatches * 35 +
    (rule.kind === "derived" || rule.kind === "parameter" ? 40 : 0) -
    fuzzyPenalty;

  return {
    name: rule.name,
    label: titleise(rule.name),
    kind: rule.kind,
    source: rule.source,
    formula: formula ? compactFormula(formula) : null,
    matchedTerms,
    score,
  };
}

function scoreFormulaReferences(
  rule: RuleSpecRule,
  file: EncodedFileCandidate,
  queryTokens: string[]
): RuleSpecSymbolMatch[] {
  return rule.versions.flatMap((version) => {
    const formula = version.formula;
    if (!formula) return [];
    const identifiers = Array.from(
      new Set(
        tokenizeFormula(formula)
          .filter((segment) => segment.isIdentifier)
          .map((segment) => segment.text)
      )
    );
    return identifiers
      .map((identifier) =>
        scoreFormulaReference(identifier, rule, file, formula, queryTokens)
      )
      .filter((match): match is RuleSpecSymbolMatch => match !== null);
  });
}

function scoreFormulaReference(
  identifier: string,
  ownerRule: RuleSpecRule,
  file: EncodedFileCandidate,
  formula: string,
  queryTokens: string[]
): RuleSpecSymbolMatch | null {
  const contextTokens = contextTokenSet(
    tokenise(
      `${file.citationPath} ${file.filePath} ${jurisdictionLabelFor(
        file.citationPath.split("/")[0]
      )}`
    )
  );
  const contentTokens = queryTokens.filter(
    (token) => !isJurisdictionToken(token) && !contextTokens.has(token)
  );
  if (contentTokens.length === 0) return null;
  const identifierTokens = new Set(tokenise(identifier));
  const tokenMatches = matchQueryTokens(contentTokens, identifierTokens);
  const matchedTerms = tokenMatches.map((match) => match.canonicalToken);
  if (matchedTerms.length === 0) return null;
  if (contentTokens.length >= 3 && matchedTerms.length === 1) return null;
  const allMatched = matchedTerms.length === contentTokens.length;
  const fuzzyPenalty = tokenMatches.reduce(
    (penalty, match) => penalty + (1 - match.similarity) * 45,
    0
  );
  return {
    name: identifier,
    label: titleise(identifier),
    kind: "formula_ref",
    source: ownerRule.name,
    formula: compactFormula(formula),
    matchedTerms,
    score: matchedTerms.length * 140 + (allMatched ? 520 : 0) + 70 - fuzzyPenalty,
  };
}

function dedupeSymbolMatches(
  matches: Array<RuleSpecSymbolMatch | null>
): RuleSpecSymbolMatch[] {
  const byName = new Map<string, RuleSpecSymbolMatch>();
  for (const match of matches) {
    if (!match) continue;
    const existing = byName.get(match.name);
    if (!existing || match.score > existing.score) byName.set(match.name, match);
  }
  return [...byName.values()];
}

function ruleSpecImports(raw: Record<string, unknown>): string[] {
  const imports = raw.imports;
  if (!Array.isArray(imports)) return [];
  return imports
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function previewRuleSpecRules(rules: RuleSpecRule[]): RuleSpecSymbolMatch[] {
  return [...rules]
    .filter((rule) => rule.kind !== "source_relation" && rule.kind !== "data_relation")
    .sort((a, b) => previewRuleScore(b) - previewRuleScore(a) || a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((rule) => {
      const formula = rule.versions.map((version) => version.formula).find(Boolean) ?? null;
      return {
        name: rule.name,
        label: titleise(rule.name),
        kind: rule.kind,
        source: rule.source,
        formula: formula ? compactFormula(formula) : null,
        matchedTerms: [],
        score: 0,
      };
    });
}

function previewRuleScore(rule: RuleSpecRule): number {
  const nameTokens = new Set(tokenise(rule.name));
  let score = 0;
  if (rule.kind === "derived") score += 40;
  if (rule.kind === "parameter") score += 15;
  for (const [token, weight] of Object.entries(PREVIEW_RULE_WEIGHTS)) {
    if (nameTokens.has(token)) score += weight;
  }
  score -= Math.max(0, tokenise(rule.name).length - 4) * 2;
  return score;
}

const PREVIEW_RULE_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  eligible: 55,
  eligibility: 55,
  benefit: 45,
  allotment: 42,
  income: 40,
  deduction: 38,
  shelter: 34,
  resources: 30,
  resource: 30,
  monthly: 16,
  gross: 12,
  total: 8,
});

async function fetchRuleSpecYaml(file: EncodedFileCandidate): Promise<string | null> {
  if (!file.root) return null;
  const prefixedPath = file.root.prefix
    ? `${file.root.prefix}/${file.filePath}`
    : file.filePath;
  const url = `https://raw.githubusercontent.com/${GITHUB_ORG}/${file.root.repo}/${file.root.branch}/${prefixedPath}`;
  const response = await fetch(url, {
    headers: gitHubApiHeaders(),
    next: { revalidate: REVALIDATE_SECONDS },
  } as RequestInit);
  if (!response.ok) return null;
  return response.text();
}

function dedupeEncodedFileCandidates(
  files: EncodedFileCandidate[]
): EncodedFileCandidate[] {
  const byPath = new Map<string, EncodedFileCandidate>();
  for (const file of files) {
    if (!byPath.has(file.citationPath)) byPath.set(file.citationPath, file);
  }
  return [...byPath.values()];
}

async function discoverRuleSpecSearchRoots(): Promise<RuleSpecSearchRoot[]> {
  const repos = await githubJson<GitHubRepo[]>(
    `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&type=all&sort=pushed`
  ).catch(() => []);
  const roots = (
    await Promise.all(
      repos
        .filter((repo) => repo.name.startsWith("rulespec-"))
        .map(async (repo) => rootsFromRepo(repo))
    )
  ).flat();
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = `${root.repo}:${root.prefix ?? ""}:${root.jurisdiction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function rootsFromRepo(repo: GitHubRepo): Promise<RuleSpecSearchRoot[]> {
  // Archived repos are read-only parked lanes, never app surfaces —
  // same skip the index sync applies (scripts/lib/rulespec-discovery.mjs).
  if (repo.archived) return [];
  // A repo the app itself registers as gated is skipped without asking
  // GitHub. ``fetchAppVisibility`` below fails OPEN (a hiccup must not
  // hide a live country), which is right for repos the map doesn't
  // know but would leak a registered pilot the one time raw.github is
  // unreachable. Unregistered repos still discover normally, so a new
  // country needs no repo-map entry to become searchable.
  if (ruleSpecRepoAppVisibility(repo.name) === "experimental") return [];
  if ((await fetchAppVisibility(repo)) === "experimental") return [];
  const tree = await githubJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${GITHUB_ORG}/${repo.name}/git/trees/${repo.default_branch}`
  ).catch(() => null);
  if (!tree) return [];
  const entries = tree.tree ?? [];
  const jurisdictionDirs = entries
    .filter((entry) => entry.type === "tree" && isJurisdictionSegment(entry.path))
    .map((entry) => entry.path);
  if (jurisdictionDirs.length > 0) {
    return jurisdictionDirs.map((jurisdiction) => ({
      repo: repo.name,
      branch: repo.default_branch,
      jurisdiction,
      prefix: jurisdiction,
    }));
  }

  if (entries.some((entry) => entry.type === "tree" && isRulespecBucket(entry.path))) {
    const jurisdiction = jurisdictionFromRepoName(repo.name);
    if (jurisdiction) {
      return [
        {
          repo: repo.name,
          branch: repo.default_branch,
          jurisdiction,
          prefix: null,
        },
      ];
    }
  }
  return [];
}

async function listEncodedFileCandidatesFromRoot(
  root: RuleSpecSearchRoot
): Promise<EncodedFileCandidate[]> {
  const treePath = root.prefix
    ? `${root.branch}:${root.prefix}`
    : root.branch;
  const body = await githubJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${GITHUB_ORG}/${root.repo}/git/trees/${treePath}?recursive=1`
  ).catch(() => null);
  return parseTreeEntries(body, root.jurisdiction).map((file) => ({
    ...file,
    root,
  }));
}

async function fetchAppVisibility(repo: GitHubRepo): Promise<AppVisibility> {
  const url = `https://raw.githubusercontent.com/${GITHUB_ORG}/${repo.name}/${repo.default_branch}/.axiom/registry.toml`;
  const res = await fetch(url, {
    headers: gitHubApiHeaders(),
    next: { revalidate: REVALIDATE_SECONDS },
  } as RequestInit).catch(() => null);
  if (!res || !res.ok) return "public";
  return parseAppVisibility(await res.text().catch(() => null));
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      ...gitHubApiHeaders(),
      "X-GitHub-Api-Version": "2022-11-28",
    },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

function inferJurisdictions(tokens: string[]): Set<string> {
  const joined = tokens.join(" ");
  const out = new Set<string>();
  for (const jurisdiction of JURISDICTIONS_SEED) {
    const aliases = jurisdictionAliases(jurisdiction.slug, jurisdiction.label);
    if (aliases.some((alias) => alias.every((token) => tokens.includes(token)))) {
      out.add(jurisdiction.slug);
    }
    if (joined.includes(jurisdiction.label.toLowerCase())) {
      out.add(jurisdiction.slug);
    }
  }
  for (const [slug, label] of Object.entries(EXTRA_JURISDICTION_LABELS)) {
    const aliases = jurisdictionAliases(slug, label);
    if (aliases.some((alias) => alias.every((token) => tokens.includes(token)))) {
      out.add(slug);
    }
  }
  return out;
}

function fullyMatchedPrograms(query: string, tokens: string[]): Program[] {
  return findPrograms(query, PROGRAM_LIMIT).filter((program) =>
    programAliasFullyMatched(program, tokens)
  );
}

function inferProgramJurisdictions(matchedPrograms: Program[]): Set<string> {
  const out = new Set<string>();
  for (const program of matchedPrograms) {
    // State-administered federal programs live in state manuals too, so
    // their name alone must not narrow the search to federal sources.
    if (program.jurisdiction === "us" && program.stateAdministered) continue;
    out.add(program.jurisdiction);
  }
  return out;
}

function isJurisdictionToken(token: string): boolean {
  for (const jurisdiction of JURISDICTIONS_SEED) {
    if (
      jurisdictionAliases(jurisdiction.slug, jurisdiction.label).some((alias) =>
        alias.includes(token)
      )
    ) {
      return true;
    }
  }
  for (const [slug, label] of Object.entries(EXTRA_JURISDICTION_LABELS)) {
    if (
      jurisdictionAliases(slug, label).some((alias) => alias.includes(token))
    ) {
      return true;
    }
  }
  return false;
}

function jurisdictionAliases(slug: string, label: string): string[][] {
  const aliases = [tokenise(label), tokenise(slug)];
  if (slug.startsWith("us-")) aliases.push([slug.slice(3)]);
  if (slug === "uk-kingston-upon-thames") aliases.push(["kingston"]);
  if (slug === "us") aliases.push(["federal"], ["usa"]);
  if (slug === "uk") aliases.push(["britain"], ["gb"]);
  if (slug === "ca") aliases.push(["canada"]);
  return aliases.filter((alias) => alias.length > 0);
}

function jurisdictionFromRepoName(repoName: string): string | null {
  const suffix = repoName.replace(/^rulespec-/, "");
  if (!suffix || suffix === repoName) return null;
  return suffix;
}

function isJurisdictionSegment(value: string): boolean {
  // Mirror the JURISDICTION_DIR_RE the rulespec repos' own layout tests
  // enforce (^[a-z]{2}(-[a-z0-9-]+)*$): a bare alpha-2 code (us, uk, gh,
  // ng, ...) or a compound sub-jurisdiction (us-co, be-vlg). A hardcoded
  // allowlist here silently dropped new countries from encoded search.
  return /^[a-z]{2}(-[a-z0-9-]+)*$/.test(value);
}

function isRulespecBucket(value: string): boolean {
  return Object.values(DOC_TYPE_TO_REPO_BUCKET).includes(value);
}

function labelFromEncodedFile(file: EncodedFile): string {
  const [, , ...tail] = file.citationPath.split("/");
  const usefulTail = tail.slice(-3).join(" ");
  return titleise(usefulTail || file.citationPath);
}

function symbolResultLabel(
  matches: RuleSpecSymbolMatch[],
  file: EncodedFile
): string {
  if (matches.length === 1) return matches[0].label;
  const commonMatchedTerms = commonMeaningfulTokens(
    matches.map((match) => match.matchedTerms.join(" "))
  );
  if (commonMatchedTerms.length >= 2) {
    return titleise(commonMatchedTerms.join(" "));
  }
  const bestMeaningfulTerms = meaningfulTokens(matches[0]?.matchedTerms ?? []);
  if (bestMeaningfulTerms.length >= 2) return matches[0].label;
  const commonTokens = commonMeaningfulTokens(matches.map((match) => match.name));
  if (commonTokens.length >= 2) return titleise(commonTokens.join(" "));
  return labelFromEncodedFile(file);
}

function commonMeaningfulTokens(values: string[]): string[] {
  if (values.length === 0) return [];
  const sets = values.map((value) =>
    new Set(meaningfulTokens(tokenise(value)))
  );
  const [first, ...rest] = sets;
  return [...first].filter((token) => rest.every((set) => set.has(token)));
}

/**
 * Strip tokens that describe context rather than topic: program names,
 * jurisdictions, and fiscal-year markers. What remains is what the
 * user is actually asking about ("standard deduction", not "snap co").
 */
function meaningfulTokens(tokens: string[]): string[] {
  return tokens.filter(
    (token) =>
      !SINGLE_TOKEN_PROGRAM_ALIASES.has(token) &&
      !isJurisdictionToken(token) &&
      token !== "fy" &&
      !/^(19|20)\d{2}$/.test(token)
  );
}

function compactFormula(formula: string): string {
  return formula.replace(/\s+/g, " ").trim().slice(0, 240);
}

function jurisdictionLabelFor(slug: string): string {
  return JURISDICTION_BY_SLUG.get(slug)?.label ?? EXTRA_JURISDICTION_LABELS[slug] ?? titleise(slug);
}

function titleise(value: string): string {
  return value
    .replace(/[-_/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function tokenise(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2 && !QUERY_STOPWORDS.has(token))
    )
  );
}

function tokenVariants(token: string): string[] {
  if (token.endsWith("ies") && token.length > 4) {
    return [token, `${token.slice(0, -3)}y`];
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return [token, token.slice(0, -1)];
  }
  return [token];
}

function contextTokenSet(tokens: string[]): Set<string> {
  return encodedFileTokenSet(tokens);
}

function encodedFileTokenSet(tokens: string[]): Set<string> {
  return applyImplications(
    new Set(tokens.flatMap(tokenVariants)),
    HAYSTACK_TOKEN_IMPLICATIONS
  );
}

function matchQueryTokens(
  queryTokens: string[],
  haystackTokensInput: Iterable<string>
): TokenMatch[] {
  const haystackTokens = Array.from(
    new Set(Array.from(haystackTokensInput).flatMap(tokenVariants))
  );
  const haystack = new Set(haystackTokens);
  const matches: TokenMatch[] = [];
  const seenCanonical = new Set<string>();
  const seenQuery = new Set<string>();

  for (const queryToken of queryTokens) {
    if (seenQuery.has(queryToken)) continue;
    seenQuery.add(queryToken);

    if (haystack.has(queryToken)) {
      if (!seenCanonical.has(queryToken)) {
        seenCanonical.add(queryToken);
        matches.push({
          queryToken,
          canonicalToken: queryToken,
          similarity: 1,
        });
      }
      continue;
    }

    const fuzzy = bestFuzzyTokenMatch(queryToken, haystackTokens);
    if (fuzzy && !seenCanonical.has(fuzzy.token)) {
      seenCanonical.add(fuzzy.token);
      matches.push({
        queryToken,
        canonicalToken: fuzzy.token,
        similarity: fuzzy.similarity,
      });
    }
  }

  return matches;
}

function bestFuzzyTokenMatch(
  queryToken: string,
  haystackTokens: string[]
): { token: string; similarity: number } | null {
  if (!canFuzzyMatch(queryToken)) return null;
  let best: { token: string; similarity: number } | null = null;
  for (const token of haystackTokens) {
    if (!canFuzzyMatch(token)) continue;
    const similarity = fuzzyTokenSimilarity(queryToken, token);
    if (similarity < 0.72) continue;
    if (!best || similarity > best.similarity) {
      best = { token, similarity };
    }
  }
  return best;
}

function canFuzzyMatch(token: string): boolean {
  return token.length >= 5 && !ACRONYMS.has(token);
}

function fuzzyTokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  const distance = boundedEditDistance(a, b, maxLen >= 8 ? 2 : 1);
  if (distance !== null) return 1 - distance / maxLen;
  return trigramSimilarity(a, b);
}

function boundedEditDistance(a: string, b: string, maxDistance: number): number | null {
  if (Math.abs(a.length - b.length) > maxDistance) return null;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let rowMin = i;
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return null;
    previous.splice(0, previous.length, ...current);
  }
  const distance = previous[b.length];
  return distance <= maxDistance ? distance : null;
}

function trigramSimilarity(a: string, b: string): number {
  const aTrigrams = trigrams(a);
  const bTrigrams = trigrams(b);
  if (aTrigrams.size === 0 || bTrigrams.size === 0) return 0;
  let shared = 0;
  for (const trigram of aTrigrams) {
    if (bTrigrams.has(trigram)) shared++;
  }
  return (2 * shared) / (aTrigrams.size + bTrigrams.size);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}

function applyImplications(
  expanded: Set<string>,
  implications: readonly TokenImplication[]
): Set<string> {
  for (const { when, add } of implications) {
    if (!when.every((token) => expanded.has(token))) continue;
    for (const token of add) {
      for (const variant of tokenVariants(token)) expanded.add(variant);
    }
  }
  return expanded;
}

function expandQueryTokens(tokens: string[]): string[] {
  return [
    ...applyImplications(
      new Set(tokens.flatMap(tokenVariants)),
      QUERY_TOKEN_IMPLICATIONS
    ),
  ];
}

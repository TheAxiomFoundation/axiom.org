import type { Rule } from "@/lib/supabase";
import type { TreeNode } from "@/lib/tree-data";
import { DISPLAY_ACRONYMS } from "@/lib/display-acronyms";
import {
  listEncodedFiles,
  type EncodedFile,
} from "@/lib/axiom/rulespec/repo-listing";
import {
  synthesisedRuleId,
  synthesiseRuleFromCitationPath,
} from "@/lib/axiom/rulespec/synth-rule";
import {
  getNavigationDocTypes,
  getNavigationIndexChildren,
  getNavigationIndexNode,
  getNavigationIndexPrefixRows,
  getProvisionByCitationPath,
  getProvisionCoveredDocTypes,
  getProvisionForNavigationNode,
  getResolvableNavigationNodeIds,
  navigationDocTypeToTreeNode,
  navigationRowToTreeNode,
  NavigationIndexMissingError,
} from "@/lib/axiom/navigation-index/read";
import type { NavigationNodeRow } from "@/lib/axiom/navigation-index/types";

export interface TreeNodeLoadParams {
  dbJurisdictionId: string;
  ruleSegments: string[];
  hasCitationPaths: boolean;
  encodedOnly: boolean;
  page: number;
  encodedPaths?: Set<string>;
}

export interface TreeNodeLoadResult {
  nodes: TreeNode[];
  hasMore: boolean;
  currentRule?: Rule | null;
  leafRule?: Rule | null;
  encodedPaths?: Set<string>;
}

/**
 * Load browse-tree nodes from the precomputed corpus.navigation_nodes index.
 *
 * The legal text still lives in corpus.current_provisions. This loader only uses
 * provisions for the exact current/leaf rule detail after the navigation
 * index has resolved the route. It intentionally does not fall back to the
 * old broad provisions scans; source-index gaps should stay visible. The
 * one exception is RuleSpec-only branches from the canonical rulespec-* repos:
 * those are surfaced as synthetic encoded leaves so checked-in encodings are
 * not hidden just because the source corpus has not ingested the document.
 */
export async function loadTreeNodes({
  dbJurisdictionId,
  ruleSegments: segs,
  encodedOnly,
  page,
  encodedPaths: existingEncodedPaths,
}: TreeNodeLoadParams): Promise<TreeNodeLoadResult> {
  if (segs.length === 0) {
    // Treat a missing navigation index as "no doc types yet" rather than a
    // hard error: jurisdictions seeded for the picker (uk, canada, us-ar,
    // us-ms, …) may have zero corpus rows before ingestion lands. The
    // rulespec fallback still surfaces any checked-in encodings; if both
    // are empty the UI renders an empty state instead of a 404.
    const docTypes = await getNavigationDocTypes(dbJurisdictionId, encodedOnly)
      .then((result) => result.docTypes)
      .catch((error) => {
        if (error instanceof NavigationIndexMissingError) return [] as string[];
        throw error;
      });
    const encodedDocTypes = await getEncodedDocTypes(dbJurisdictionId);
    const provisionDocTypes =
      encodedOnly || docTypes.length === 0
        ? new Set<string>()
        : await getProvisionCoveredDocTypes(dbJurisdictionId, docTypes);
    const navigationDocTypes = encodedOnly
      ? []
      : docTypes.filter((docType) => provisionDocTypes.has(docType));
    return {
      nodes: mergeDocTypes(navigationDocTypes, encodedDocTypes).map(
        navigationDocTypeToTreeNode
      ),
      hasMore: false,
      encodedPaths: existingEncodedPaths,
    };
  }

  const [docType] = segs;
  const scopePath = navigationPath(dbJurisdictionId, [docType]);
  const scopeRoot = await getNavigationIndexNode(scopePath);
  const queryDocType = scopeRoot?.doc_type ?? docType;
  const parentPath =
    segs.length === 1
      ? scopeRoot?.has_children
        ? scopePath
        : null
      : navigationPath(dbJurisdictionId, segs);
  const childResult = await getNavigationIndexChildren({
    jurisdiction: dbJurisdictionId,
    docType: queryDocType,
    parentPath,
    encodedOnly,
    page,
  });
  let encodedFilesPromise: Promise<EncodedFile[]> | null =
    childResult.rows.length > 0 ? listEncodedFiles(dbJurisdictionId) : null;
  const getEncodedFiles = async () => {
    encodedFilesPromise ??= listEncodedFiles(dbJurisdictionId);
    return encodedFilesPromise;
  };
  const encodedFiles =
    childResult.rows.length > 0 ? await getEncodedFiles() : [];
  const navigationRows = encodedOnly
    ? childResult.rows.filter((row) =>
        navigationRowHasEncodedCoverage(row, encodedFiles)
      )
    : childResult.rows;
  const indexRows = await filterNavigableRows(navigationRows, encodedFiles);
  const rulespecOnly =
    page === 0 && (encodedOnly || indexRows.length === 0)
      ? await loadRulespecOnlyTreeNodes(
          dbJurisdictionId,
          segs,
          page,
          getEncodedFiles
        )
      : null;

  if (segs.length === 1) {
    const nodes = mergeTreeNodes(
      navigationRowsToTreeNodes(indexRows, encodedFiles),
      rulespecOnly?.nodes
    );
    if (nodes.length === 0) {
      if (page > 0 || childResult.rows.length > 0) {
        return {
          nodes: [],
          hasMore: false,
          encodedPaths: existingEncodedPaths,
        };
      }
      if (encodedOnly) {
        return {
          nodes: [],
          hasMore: false,
          encodedPaths: existingEncodedPaths,
        };
      }
      throw new NavigationIndexMissingError(
        `Navigation index has no rows for ${dbJurisdictionId}/${docType}.`
      );
    }
    return {
      nodes,
      hasMore: childResult.hasMore,
      encodedPaths: existingEncodedPaths,
    };
  }

  const currentPath = navigationPath(dbJurisdictionId, segs);
  const currentNode = await getNavigationIndexNode(currentPath);

  if (indexRows.length === 0) {
    if (!currentNode) {
      const sparsePrefix = await loadSparsePrefixTreeNodes({
        jurisdiction: dbJurisdictionId,
        docType: queryDocType,
        currentPath,
        segs,
        encodedOnly,
      });
      if (sparsePrefix) return sparsePrefix;
      if (rulespecOnly) return rulespecOnly;
      if (!encodedOnly) {
        const nearestProvision = await getNearestProvisionForMissingNode(
          currentPath,
          await getEncodedFiles()
        );
        if (nearestProvision) {
          return {
            nodes: [],
            hasMore: false,
            currentRule: nearestProvision,
            encodedPaths: existingEncodedPaths,
          };
        }
      }
      throw new NavigationIndexMissingError(
        `Navigation index has no node for ${currentPath}.`
      );
    }
    if (rulespecOnly) {
      const files = await getEncodedFiles();
      if (rulespecOnly.nodes.length > 0) {
        return {
          ...rulespecOnly,
          currentRule: await getOptionalProvisionForNode(currentNode, files),
        };
      }
      // The synthesised rulespec leaf is a stand-in for encodings with
      // no corpus backing. When the navigation node resolves to a real
      // provision that provision must be the leaf, or the page renders
      // the YAML module summary in place of the source text (Canada's
      // T691 form hid 27k chars of captured text behind a 190-char
      // stub). requireProvisionForNode falls back to the synthesised
      // rule itself when no provision exists, preserving the
      // rulespec-only behaviour.
      return {
        ...rulespecOnly,
        leafRule: await requireProvisionForNode(currentNode, files),
      };
    }
    if (currentNode.has_children) {
      const rule = await getOptionalProvisionForNode(
        currentNode,
        await getEncodedFiles()
      );
      return {
        nodes: [],
        hasMore: false,
        currentRule: rule,
        encodedPaths: existingEncodedPaths,
      };
    }
    const rule = await getOptionalNavigationLeaf(
      currentNode,
      await getEncodedFiles()
    );
    return {
      nodes: [],
      hasMore: false,
      leafRule: rule ?? null,
      encodedPaths: existingEncodedPaths,
    };
  }

  const currentRule = currentNode
    ? await getOptionalProvisionForNode(currentNode, encodedFiles)
    : null;

  return {
    nodes: mergeTreeNodes(
      navigationRowsToTreeNodes(indexRows, encodedFiles),
      rulespecOnly?.nodes
    ),
    hasMore: childResult.hasMore,
    currentRule,
    encodedPaths: existingEncodedPaths,
  };
}

function navigationPath(jurisdiction: string, ruleSegments: string[]): string {
  return `${jurisdiction}/${ruleSegments.join("/")}`;
}

async function requireProvisionForNode(
  node: NavigationNodeRow,
  encodedFiles: EncodedFile[]
): Promise<Rule> {
  const rule = await getProvisionForNavigationNode(node);
  if (rule) return ruleWithActualRuleSpec(rule, encodedFiles);

  const encodedRule = await synthesiseEncodedNavigationLeaf(node);
  if (encodedRule) return encodedRule;

  throw new NavigationIndexMissingError(
    `Navigation node ${node.path} does not resolve to a corpus provision.`
  );
}

async function getOptionalProvisionForNode(
  node: NavigationNodeRow,
  encodedFiles: EncodedFile[]
): Promise<Rule | null> {
  try {
    const rule = await getProvisionForNavigationNode(node);
    return rule ? ruleWithActualRuleSpec(rule, encodedFiles) : null;
  } catch {
    return null;
  }
}

async function getOptionalNavigationLeaf(
  node: NavigationNodeRow,
  encodedFiles: EncodedFile[]
): Promise<Rule | null> {
  const rule = await getProvisionForNavigationNode(node);
  if (rule) return ruleWithActualRuleSpec(rule, encodedFiles);
  return await synthesiseEncodedNavigationLeaf(node);
}

async function getNearestProvisionForMissingNode(
  currentPath: string,
  encodedFiles: EncodedFile[]
): Promise<Rule | null> {
  for (const { path, exact } of provisionFallbackPaths(currentPath)) {
    const rule = await getProvisionByCitationPath(path);
    if (!rule) continue;
    if (exact || (rule.body && rule.body.trim().length > 0)) {
      return ruleWithActualRuleSpec(rule, encodedFiles);
    }
  }
  return null;
}

function provisionFallbackPaths(
  currentPath: string
): Array<{ path: string; exact: boolean }> {
  const parts = currentPath.split("/").filter(Boolean);
  const paths: Array<{ path: string; exact: boolean }> = [];
  for (let end = parts.length; end >= 3; end--) {
    paths.push({
      path: parts.slice(0, end).join("/"),
      exact: end === parts.length,
    });
  }
  return paths;
}

async function synthesiseEncodedNavigationLeaf(
  node: NavigationNodeRow
): Promise<Rule | null> {
  const citationPath = node.citation_path ?? node.path;
  const repoRule = await synthesiseRuleFromCitationPath(
    node.jurisdiction,
    citationPath
  );
  if (repoRule) return repoRule;

  return null;
}

function navigationRowHasEncodedCoverage(
  row: NavigationNodeRow,
  files: EncodedFile[]
): boolean {
  const paths = [row.path, row.citation_path].filter(
    (path): path is string => Boolean(path)
  );
  for (const path of paths) {
    if (files.some((file) => encodedFileCoversPath(file, path))) return true;
  }
  return false;
}

function encodedFileCoversPath(file: EncodedFile, path: string): boolean {
  return file.citationPath === path || file.citationPath.startsWith(`${path}/`);
}

function encodedFileExactlyMatchesPath(
  file: EncodedFile,
  path: string
): boolean {
  return file.citationPath === path;
}

function navigationRowHasExactEncoding(
  row: NavigationNodeRow,
  files: EncodedFile[]
): boolean {
  const paths = [row.path, row.citation_path].filter(
    (path): path is string => Boolean(path)
  );
  return paths.some((path) =>
    files.some((file) => encodedFileExactlyMatchesPath(file, path))
  );
}

function navigationRowsToTreeNodes(
  rows: NavigationNodeRow[],
  encodedFiles: EncodedFile[]
): TreeNode[] {
  return rows.map((row) => {
    const node = navigationRowToTreeNode(row);
    const hasRuleSpec = navigationRowHasEncodedCoverage(row, encodedFiles);
    const hasExactRuleSpec = navigationRowHasExactEncoding(row, encodedFiles);
    return {
      ...node,
      hasRuleSpec,
      ...(node.rule && {
        rule: {
          ...node.rule,
          has_rulespec: hasExactRuleSpec,
          rulespec_path: hasExactRuleSpec
            ? exactEncodedFilePathForRule(node.rule, encodedFiles)
            : null,
        },
      }),
    };
  });
}

function ruleWithActualRuleSpec(
  rule: Rule,
  encodedFiles: EncodedFile[]
): Rule {
  const filePath = exactEncodedFilePathForRule(rule, encodedFiles);
  return {
    ...rule,
    has_rulespec: Boolean(filePath),
    rulespec_path: filePath,
  };
}

function exactEncodedFilePathForRule(
  rule: Pick<Rule, "citation_path">,
  encodedFiles: EncodedFile[]
): string | null {
  const citationPath = rule.citation_path;
  if (!citationPath) return null;
  return (
    encodedFiles.find((file) =>
      encodedFileExactlyMatchesPath(file, citationPath)
    )?.filePath ?? null
  );
}

async function filterNavigableRows(
  rows: NavigationNodeRow[],
  encodedFiles: EncodedFile[]
): Promise<NavigationNodeRow[]> {
  if (rows.length === 0) return rows;

  // The resolvability check is cosmetic (it hides rows whose backing
  // provision vanished). If it can't answer in time, fail open and
  // show the level rather than 503ing it — us/policy went dark this
  // way (2026-07-20).
  let resolvableIds: Set<string>;
  try {
    resolvableIds = await getResolvableNavigationNodeIds(rows);
  } catch {
    return rows;
  }
  return rows.filter((row) => {
    if (resolvableIds.has(row.id)) return true;
    return navigationRowHasEncodedCoverage(row, encodedFiles);
  });
}

async function getEncodedDocTypes(jurisdiction: string): Promise<string[]> {
  const files = await listEncodedFiles(jurisdiction);
  return Array.from(
    new Set(
      files
        .map((file) => file.citationPath.split("/")[1])
        .filter((docType): docType is string => Boolean(docType))
    )
  );
}

function mergeDocTypes(docTypes: string[], encodedDocTypes: string[]): string[] {
  return Array.from(new Set([...docTypes, ...encodedDocTypes])).sort();
}

function mergeTreeNodes(indexNodes: TreeNode[], rulespecNodes?: TreeNode[]): TreeNode[] {
  if (!rulespecNodes || rulespecNodes.length === 0) return indexNodes;
  const bySegment = new Map<string, TreeNode>();
  for (const node of rulespecNodes) {
    bySegment.set(node.segment, node);
  }
  for (const node of indexNodes) {
    bySegment.set(node.segment, node);
  }
  return Array.from(bySegment.values()).sort((a, b) =>
    a.segment.localeCompare(b.segment, undefined, { numeric: true })
  );
}

async function loadSparsePrefixTreeNodes({
  jurisdiction,
  docType,
  currentPath,
  segs,
  encodedOnly,
}: {
  jurisdiction: string;
  docType: string;
  currentPath: string;
  segs: string[];
  encodedOnly: boolean;
}): Promise<TreeNodeLoadResult | null> {
  const rows = await getNavigationIndexPrefixRows({
    jurisdiction,
    docType,
    pathPrefix: currentPath,
    encodedOnly,
  });
  if (rows.length === 0) return null;

  return {
    nodes: sparsePrefixChildren(jurisdiction, segs, rows),
    hasMore: false,
    currentRule: null,
  };
}

function sparsePrefixChildren(
  jurisdiction: string,
  segs: string[],
  rows: NavigationNodeRow[]
): TreeNode[] {
  const childIndex = segs.length + 1;
  const bySegment = new Map<
    string,
    {
      exact?: NavigationNodeRow;
      descendantCount: number;
      hasDeeper: boolean;
    }
  >();

  for (const row of rows) {
    const parts = row.path.split("/");
    const segment = parts[childIndex];
    if (!segment) continue;
    const entry =
      bySegment.get(segment) ??
      {
        descendantCount: 0,
        hasDeeper: false,
      };
    entry.descendantCount += 1;
    if (parts.length === childIndex + 1) entry.exact = row;
    if (parts.length > childIndex + 1) entry.hasDeeper = true;
    bySegment.set(segment, entry);
  }

  return Array.from(bySegment.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segment, entry]) => {
      if (entry.exact && !entry.hasDeeper) {
        return navigationRowToTreeNode(entry.exact);
      }
      const exactNode = entry.exact
        ? navigationRowToTreeNode(entry.exact)
        : null;
      return {
        segment,
        label: exactNode?.label ?? formatRulespecOnlySegment(segment),
        hasChildren: true,
        childCount: entry.descendantCount,
        nodeType: "section",
        ...(exactNode?.rule && { rule: exactNode.rule }),
        ...(exactNode?.hasRuleSpec && { hasRuleSpec: true }),
      } satisfies TreeNode;
    });
}

async function loadRulespecOnlyTreeNodes(
  jurisdiction: string,
  segs: string[],
  page: number,
  getEncodedFiles: () => Promise<EncodedFile[]> = () =>
    listEncodedFiles(jurisdiction)
): Promise<TreeNodeLoadResult | null> {
  if (page > 0 || segs.length === 0) return null;
  const files = await getEncodedFiles();
  if (files.length === 0) return null;

  const currentPath = navigationPath(jurisdiction, segs);
  const exact = files.find((file) => file.citationPath === currentPath);
  const descendants = files.filter((file) =>
    file.citationPath.startsWith(`${currentPath}/`)
  );

  if (!exact && descendants.length === 0) return null;

  if (descendants.length === 0 && exact) {
    const leafRule = await synthesiseRuleFromCitationPath(
      jurisdiction,
      currentPath
    );
    if (!leafRule) return null;
    return {
      nodes: [],
      hasMore: false,
      leafRule,
    };
  }

  return {
    nodes: rulespecOnlyChildren(jurisdiction, segs, descendants),
    hasMore: false,
    currentRule: null,
  };
}

function rulespecOnlyChildren(
  jurisdiction: string,
  segs: string[],
  descendants: EncodedFile[]
): TreeNode[] {
  const childIndex = segs.length + 1;
  const bySegment = new Map<
    string,
    {
      citationPath: string;
      exact?: EncodedFile;
      descendantCount: number;
      hasDeeper: boolean;
    }
  >();

  for (const file of descendants) {
    const parts = file.citationPath.split("/");
    const segment = parts[childIndex];
    if (!segment) continue;
    const citationPath = [jurisdiction, ...segs, segment].join("/");
    const entry =
      bySegment.get(segment) ??
      {
        citationPath,
        descendantCount: 0,
        hasDeeper: false,
      };
    entry.descendantCount += 1;
    if (parts.length === childIndex + 1) entry.exact = file;
    if (parts.length > childIndex + 1) entry.hasDeeper = true;
    bySegment.set(segment, entry);
  }

  return Array.from(bySegment.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segment, entry]) => {
      const exactOnly = Boolean(entry.exact) && !entry.hasDeeper;
      return {
        segment,
        label: formatRulespecOnlyNodeLabel(segs, segment),
        hasChildren: entry.hasDeeper,
        childCount: entry.hasDeeper ? entry.descendantCount : undefined,
        nodeType: "section",
        hasRuleSpec: true,
        ...(exactOnly && {
          rule: rulespecOnlyMinimalRule(
            jurisdiction,
            [...segs, segment],
            entry.citationPath,
            entry.exact
          ),
        }),
      } satisfies TreeNode;
    });
}

function rulespecOnlyMinimalRule(
  jurisdiction: string,
  segs: string[],
  citationPath: string,
  file?: EncodedFile,
  heading?: string
): Rule {
  const now = "";
  return {
    id: synthesisedRuleId(citationPath),
    jurisdiction,
    doc_type: segs[0] ?? "policy",
    parent_id: null,
    level: segs.length,
    ordinal: null,
    heading:
      heading ?? formatRulespecOnlySegment(segs[segs.length - 1] ?? citationPath),
    body: null,
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: null,
    citation_path: citationPath,
    rulespec_path: file?.filePath ?? null,
    has_rulespec: true,
    created_at: now,
    updated_at: now,
  };
}

function formatRulespecOnlyNodeLabel(segs: string[], segment: string): string {
  const docType = segs[0];
  if (segs.length === 1 && (docType === "statute" || docType === "regulation")) {
    return `Title ${segment}`;
  }
  if (
    (docType === "statute" || docType === "regulation") &&
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(segment)
  ) {
    return `§ ${segment}`;
  }
  return formatRulespecOnlySegment(segment);
}

function formatRulespecOnlySegment(segment: string): string {
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) =>
      DISPLAY_ACRONYMS.has(part.toLowerCase())
        ? part.toUpperCase()
        : /^fy\d+$/i.test(part)
          ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}

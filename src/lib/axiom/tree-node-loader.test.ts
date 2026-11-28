import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTreeNodes } from "./tree-node-loader";
import { NavigationIndexMissingError } from "./navigation-index/read";
import type { NavigationNodeRow } from "./navigation-index/types";

const mockGetNavigationDocTypes = vi.fn();
const mockGetNavigationIndexChildren = vi.fn();
const mockGetNavigationIndexNode = vi.fn();
const mockGetNavigationIndexPrefixRows = vi.fn();
const mockGetProvisionByCitationPath = vi.fn();
const mockGetProvisionForNavigationNode = vi.fn();
const mockGetProvisionCoveredDocTypes = vi.fn();
const mockGetResolvableNavigationNodeIds = vi.fn();
const mockListEncodedFiles = vi.fn();
const mockSynthesiseRuleFromCitationPath = vi.fn();
const mockNavigationDocTypeToTreeNode = vi.fn((segment: string) => ({
  segment,
  label: segment,
  hasChildren: true,
  nodeType: "doc_type",
}));
const mockNavigationRowToTreeNode = vi.fn((row: NavigationNodeRow) => ({
  segment: row.segment,
  label: row.label,
  hasChildren: row.has_children,
  childCount: row.child_count || undefined,
  nodeType: "section",
  rule: { id: row.provision_id ?? row.id, citation_path: row.path },
}));

vi.mock("./navigation-index/read", async () => {
  const actual = await vi.importActual<typeof import("./navigation-index/read")>(
    "./navigation-index/read"
  );
  return {
    ...actual,
    getNavigationDocTypes: (...args: unknown[]) =>
      mockGetNavigationDocTypes(...args),
    getNavigationIndexChildren: (...args: unknown[]) =>
      mockGetNavigationIndexChildren(...args),
    getNavigationIndexNode: (...args: unknown[]) =>
      mockGetNavigationIndexNode(...args),
    getNavigationIndexPrefixRows: (...args: unknown[]) =>
      mockGetNavigationIndexPrefixRows(...args),
    getProvisionByCitationPath: (...args: unknown[]) =>
      mockGetProvisionByCitationPath(...args),
    getProvisionForNavigationNode: (...args: unknown[]) =>
      mockGetProvisionForNavigationNode(...args),
    getProvisionCoveredDocTypes: (...args: unknown[]) =>
      mockGetProvisionCoveredDocTypes(...args),
    getResolvableNavigationNodeIds: (...args: unknown[]) =>
      mockGetResolvableNavigationNodeIds(...args),
    navigationDocTypeToTreeNode: (segment: string) =>
      mockNavigationDocTypeToTreeNode(segment),
    navigationRowToTreeNode: (row: NavigationNodeRow) =>
      mockNavigationRowToTreeNode(row),
  };
});

vi.mock("@/lib/axiom/rulespec/repo-listing", () => ({
  listEncodedFiles: (...args: unknown[]) => mockListEncodedFiles(...args),
}));

vi.mock("@/lib/axiom/rulespec/synth-rule", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/axiom/rulespec/synth-rule")
  >("@/lib/axiom/rulespec/synth-rule");
  return {
    ...actual,
    synthesiseRuleFromCitationPath: (...args: unknown[]) =>
      mockSynthesiseRuleFromCitationPath(...args),
  };
});

function navRow(overrides: Partial<NavigationNodeRow> = {}): NavigationNodeRow {
  return {
    id: "nav-1",
    jurisdiction: "us-co",
    doc_type: "regulation",
    path: "us-co/regulation/10-ccr-2506-1",
    parent_path: null,
    segment: "10-ccr-2506-1",
    label: "10 CCR 2506-1",
    sort_key: "0001",
    depth: 0,
    provision_id: "provision-1",
    citation_path: "us-co/regulation/10-ccr-2506-1",
    has_children: true,
    child_count: 3,
    has_rulespec: false,
    encoded_descendant_count: 0,
    status: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListEncodedFiles.mockResolvedValue([]);
  mockGetNavigationIndexPrefixRows.mockResolvedValue([]);
  mockGetProvisionByCitationPath.mockResolvedValue(null);
  mockGetProvisionCoveredDocTypes.mockImplementation(
    async (_jurisdiction: string, docTypes: string[]) => new Set(docTypes)
  );
  mockGetResolvableNavigationNodeIds.mockImplementation(
    async (rows: NavigationNodeRow[]) => new Set(rows.map((row) => row.id))
  );
});

describe("loadTreeNodes", () => {
  it("loads document type nodes from the navigation index", async () => {
    mockGetNavigationDocTypes.mockResolvedValue({
      docTypes: ["regulation", "statute"],
    });

    const result = await loadTreeNodes({
      dbJurisdictionId: "us-co",
      ruleSegments: [],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(mockGetNavigationDocTypes).toHaveBeenCalledWith("us-co", false);
    expect(result.nodes.map((node) => node.segment)).toEqual([
      "regulation",
      "statute",
    ]);
    expect(result.hasMore).toBe(false);
  });

  it("adds document type roots that only exist in RuleSpec repos", async () => {
    mockGetNavigationDocTypes.mockResolvedValue({
      docTypes: ["guidance", "regulation"],
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "policies/usda/snap/fy-2026-cola/deductions.yaml",
        citationPath: "us/policy/usda/snap/fy-2026-cola/deductions",
        bucket: "policies",
      },
      {
        filePath: "statutes/26/3101/a.yaml",
        citationPath: "us/statute/26/3101/a",
        bucket: "statutes",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: [],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes.map((node) => node.segment)).toEqual([
      "guidance",
      "policy",
      "regulation",
      "statute",
    ]);
  });

  it("uses actual RuleSpec files as the source of truth for encoded-only roots", async () => {
    mockGetNavigationDocTypes.mockResolvedValue({
      docTypes: ["regulation"],
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "statutes/26/3101/a.yaml",
        citationPath: "us/statute/26/3101/a",
        bucket: "statutes",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: [],
      hasCitationPaths: true,
      encodedOnly: true,
      page: 0,
    });

    expect(mockGetNavigationDocTypes).toHaveBeenCalledWith("us", true);
    expect(result.nodes.map((node) => node.segment)).toEqual(["statute"]);
  });

  it("renders an empty root when the index is missing and no RuleSpec files exist", async () => {
    mockGetNavigationDocTypes.mockRejectedValue(
      new NavigationIndexMissingError(
        "Navigation index has no document types for uk."
      )
    );
    mockListEncodedFiles.mockResolvedValue([]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "uk",
      ruleSegments: [],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([]);
    expect(mockGetProvisionCoveredDocTypes).not.toHaveBeenCalled();
  });

  it("falls back to RuleSpec-only roots when the navigation index is missing", async () => {
    mockGetNavigationDocTypes.mockRejectedValue(
      new NavigationIndexMissingError(
        "Navigation index has no document types for us-ar."
      )
    );
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "statutes/26/3101/a.yaml",
        citationPath: "us-ar/statute/26/3101/a",
        bucket: "statutes",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us-ar",
      ruleSegments: [],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes.map((node) => node.segment)).toEqual(["statute"]);
  });

  it("propagates index-unavailable errors at the root", async () => {
    const { NavigationIndexUnavailableError } = await import(
      "./navigation-index/read"
    );
    mockGetNavigationDocTypes.mockRejectedValue(
      new NavigationIndexUnavailableError()
    );
    mockListEncodedFiles.mockResolvedValue([]);

    await expect(
      loadTreeNodes({
        dbJurisdictionId: "us",
        ruleSegments: [],
        hasCitationPaths: true,
        encodedOnly: false,
        page: 0,
      })
    ).rejects.toThrow(NavigationIndexUnavailableError);
  });

  it("filters stale root document types with no provision or RuleSpec coverage", async () => {
    mockGetNavigationDocTypes.mockResolvedValue({
      docTypes: ["legislation"],
    });
    mockGetProvisionCoveredDocTypes.mockResolvedValue(new Set());
    mockListEncodedFiles.mockResolvedValue([]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "uk",
      ruleSegments: [],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(mockGetProvisionCoveredDocTypes).toHaveBeenCalledWith("uk", [
      "legislation",
    ]);
    expect(result.nodes).toEqual([]);
  });

  it("builds tree branches from RuleSpec-only files when corpus navigation has no node", async () => {
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "policies/usda/snap/fy-2026-cola/deductions.yaml",
        citationPath: "us/policy/usda/snap/fy-2026-cola/deductions",
        bucket: "policies",
      },
      {
        filePath: "policies/irs/rev-proc-2025-32/standard-deduction.yaml",
        citationPath: "us/policy/irs/rev-proc-2025-32/standard-deduction",
        bucket: "policies",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["policy"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "irs",
        label: "IRS",
        hasChildren: true,
        hasRuleSpec: true,
      }),
      expect.objectContaining({
        segment: "usda",
        label: "USDA",
        hasChildren: true,
        hasRuleSpec: true,
      }),
    ]);
  });

  it("merges RuleSpec-only encoded title branches with encoded navigation rows", async () => {
    mockGetNavigationIndexNode.mockResolvedValue(
      navRow({
        jurisdiction: "us",
        doc_type: "statute",
        path: "us/statute",
        segment: "statute",
        has_children: true,
      })
    );
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [
        navRow({
          jurisdiction: "us",
          doc_type: "statute",
          path: "us/statute/26",
          segment: "26",
          label: "INTERNAL REVENUE CODE",
          has_children: true,
          encoded_descendant_count: 10,
        }),
      ],
      hasMore: false,
      total: 1,
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "statutes/7/2017/a.yaml",
        citationPath: "us/statute/7/2017/a",
        bucket: "statutes",
      },
      {
        filePath: "statutes/26/3101/a.yaml",
        citationPath: "us/statute/26/3101/a",
        bucket: "statutes",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["statute"],
      hasCitationPaths: true,
      encodedOnly: true,
      page: 0,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "7",
        hasRuleSpec: true,
      }),
      expect.objectContaining({
        segment: "26",
        label: "INTERNAL REVENUE CODE",
      }),
    ]);
  });

  it("filters encoded-only navigation rows against actual RuleSpec files", async () => {
    mockGetNavigationIndexNode.mockResolvedValue(
      navRow({
        jurisdiction: "uk",
        doc_type: "legislation",
        path: "uk/legislation/uksi/2013/376/regulation/22/1/b",
        segment: "b",
        has_children: true,
      })
    );
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [
        navRow({
          jurisdiction: "uk",
          doc_type: "legislation",
          path: "uk/legislation/uksi/2013/376/regulation/22/1/b/i",
          citation_path: "uk/legislation/uksi/2013/376/regulation/22/1/b/i",
          segment: "i",
          label: "(i)",
          has_rulespec: true,
          has_children: false,
        }),
        navRow({
          jurisdiction: "uk",
          doc_type: "legislation",
          path: "uk/legislation/uksi/2013/376/regulation/22/1/b/ii",
          citation_path: "uk/legislation/uksi/2013/376/regulation/22/1/b/ii",
          segment: "ii",
          label: "(ii)",
          has_rulespec: true,
          has_children: false,
        }),
      ],
      hasMore: false,
      total: 2,
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "legislation/uksi/2013/376/regulation/22/1/b/ii.yaml",
        citationPath: "uk/legislation/uksi/2013/376/regulation/22/1/b/ii",
        bucket: "legislation",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "uk",
      ruleSegments: ["legislation", "uksi", "2013", "376", "regulation", "22", "1", "b"],
      hasCitationPaths: true,
      encodedOnly: true,
      page: 0,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "ii",
        label: "(ii)",
      }),
    ]);
  });

  it("filters stale full-navigation leaf rows that do not resolve to provisions or RuleSpec files", async () => {
    const staleLeaf = navRow({
      id: "stale-leaf",
      jurisdiction: "uk",
      doc_type: "legislation",
      path: "uk/legislation/ukpga/2002/16/section/3ZA/3",
      citation_path: "uk/legislation/ukpga/2002/16/section/3ZA/3",
      segment: "3",
      label: "(3)",
      has_children: false,
      provision_id: "missing-provision",
    });
    const liveLeaf = navRow({
      id: "live-leaf",
      jurisdiction: "uk",
      doc_type: "legislation",
      path: "uk/legislation/ukpga/2002/16/section/3ZA/4",
      citation_path: "uk/legislation/ukpga/2002/16/section/3ZA/4",
      segment: "4",
      label: "(4)",
      has_children: false,
      provision_id: "live-provision",
    });
    mockGetNavigationIndexNode.mockResolvedValue(
      navRow({
        jurisdiction: "uk",
        doc_type: "legislation",
        path: "uk/legislation/ukpga/2002/16/section/3ZA",
        segment: "3ZA",
        has_children: true,
      })
    );
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [staleLeaf, liveLeaf],
      hasMore: false,
      total: 2,
    });
    mockGetResolvableNavigationNodeIds.mockResolvedValue(
      new Set(["live-leaf"])
    );

    const result = await loadTreeNodes({
      dbJurisdictionId: "uk",
      ruleSegments: ["legislation", "ukpga", "2002", "16", "section", "3ZA"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "4",
        label: "(4)",
      }),
    ]);
  });

  it("filters stale full-navigation container rows that have no provision descendants or RuleSpec files", async () => {
    const staleContainer = navRow({
      id: "stale-container",
      jurisdiction: "uk",
      doc_type: "legislation",
      path: "uk/legislation/ukpga/2002/16/section/3ZA",
      citation_path: "uk/legislation/ukpga/2002/16/section/3ZA",
      segment: "3ZA",
      label: "(3ZA)",
      has_children: true,
      child_count: 1,
      encoded_descendant_count: 1,
      provision_id: "missing-container-provision",
    });
    const liveContainer = navRow({
      id: "live-container",
      jurisdiction: "uk",
      doc_type: "legislation",
      path: "uk/legislation/ukpga/2002/16/section/4",
      citation_path: "uk/legislation/ukpga/2002/16/section/4",
      segment: "4",
      label: "Section 4",
      has_children: true,
      child_count: 2,
      provision_id: "live-container-provision",
    });
    mockGetNavigationIndexNode.mockResolvedValue(
      navRow({
        jurisdiction: "uk",
        doc_type: "legislation",
        path: "uk/legislation/ukpga/2002/16/section",
        segment: "section",
        has_children: true,
      })
    );
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [staleContainer, liveContainer],
      hasMore: false,
      total: 2,
    });
    mockGetResolvableNavigationNodeIds.mockResolvedValue(
      new Set(["live-container"])
    );

    const result = await loadTreeNodes({
      dbJurisdictionId: "uk",
      ruleSegments: ["legislation", "ukpga", "2002", "16", "section"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "4",
        label: "Section 4",
      }),
    ]);
  });

  it("surfaces RuleSpec-only descendants under an existing encoded-only corpus node", async () => {
    mockGetNavigationIndexNode
      .mockResolvedValueOnce(
        navRow({
          jurisdiction: "us",
          doc_type: "statute",
          path: "us/statute",
          segment: "statute",
          has_children: true,
        })
      )
      .mockResolvedValueOnce(
        navRow({
          jurisdiction: "us",
          doc_type: "statute",
          path: "us/statute/7",
          segment: "7",
          label: "AGRICULTURE",
          has_children: true,
        })
      );
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    const currentRule = {
      id: "title-7",
      citation_path: "us/statute/7",
    };
    mockGetProvisionForNavigationNode.mockResolvedValue(currentRule);
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "statutes/7/2017/a.yaml",
        citationPath: "us/statute/7/2017/a",
        bucket: "statutes",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["statute", "7"],
      hasCitationPaths: true,
      encodedOnly: true,
      page: 0,
    });

    expect(result.currentRule).toEqual(
      expect.objectContaining({
        ...currentRule,
        has_rulespec: false,
        rulespec_path: null,
      })
    );
    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "2017",
        hasRuleSpec: true,
        childCount: 1,
      }),
    ]);
  });

  it("marks exact RuleSpec-only child files as clickable encoded leaves", async () => {
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "policies/irs/rev-proc-2025-32.yaml",
        citationPath: "us/policy/irs/rev-proc-2025-32",
        bucket: "policies",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["policy", "irs"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "rev-proc-2025-32",
        hasChildren: false,
        hasRuleSpec: true,
        rule: expect.objectContaining({
          id: "github:us/policy/irs/rev-proc-2025-32",
          citation_path: "us/policy/irs/rev-proc-2025-32",
          rulespec_path: "policies/irs/rev-proc-2025-32.yaml",
        }),
      }),
    ]);
  });

  it("returns a synthesised leaf rule for an exact RuleSpec-only path", async () => {
    const leafRule = {
      id: "github:us/policy/usda/snap/fy-2026-cola/deductions",
      citation_path: "us/policy/usda/snap/fy-2026-cola/deductions",
    };
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "policies/usda/snap/fy-2026-cola/deductions.yaml",
        citationPath: "us/policy/usda/snap/fy-2026-cola/deductions",
        bucket: "policies",
      },
    ]);
    mockSynthesiseRuleFromCitationPath.mockResolvedValue(leafRule);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["policy", "usda", "snap", "fy-2026-cola", "deductions"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(mockSynthesiseRuleFromCitationPath).toHaveBeenCalledWith(
      "us",
      "us/policy/usda/snap/fy-2026-cola/deductions"
    );
    expect(result.leafRule).toEqual(leafRule);
    expect(result.nodes).toEqual([]);
  });

  it("prefers the real corpus provision over the synthesised stub when both exist", async () => {
    // Canada regression: every ca leaf has a corpus provision AND an
    // encoding at the same citation path. The synthesised RuleSpec stub
    // (module summary) must not mask the provision's verbatim body.
    const leaf = navRow({
      jurisdiction: "ca",
      doc_type: "policy",
      path: "ca/policy/cra/t1-2025/alternative-minimum-tax",
      citation_path: "ca/policy/cra/t1-2025/alternative-minimum-tax",
      segment: "alternative-minimum-tax",
      has_children: false,
      child_count: 0,
    });
    const provision = {
      id: "amt-provision",
      citation_path: leaf.path,
      body: "Protected B when completed… (the full captured form text)",
    };
    const stub = {
      id: "github:ca/policy/cra/t1-2025/alternative-minimum-tax",
      citation_path: leaf.path,
      body: "CRA Form T691 for 2025 calculates federal alternative minimum tax",
    };
    mockGetNavigationIndexNode.mockResolvedValue(leaf);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "policies/cra/t1-2025/alternative-minimum-tax.yaml",
        citationPath: leaf.path,
        bucket: "policies",
      },
    ]);
    mockSynthesiseRuleFromCitationPath.mockResolvedValue(stub);
    mockGetProvisionForNavigationNode.mockResolvedValue(provision);

    const result = await loadTreeNodes({
      dbJurisdictionId: "ca",
      ruleSegments: ["policy", "cra", "t1-2025", "alternative-minimum-tax"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.leafRule).toEqual(
      expect.objectContaining({
        id: "amt-provision",
        body: provision.body,
        has_rulespec: true,
      })
    );
    expect(result.nodes).toEqual([]);
  });

  it("builds sparse intermediate folders when indexed citation paths skip parent nodes", async () => {
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexPrefixRows.mockResolvedValue([
      navRow({
        jurisdiction: "us",
        doc_type: "guidance",
        path: "us/guidance/usda/fns/snap-fy2026-cola",
        segment: "snap-fy2026-cola",
        label: "SNAP FY 2026 Maximum Allotments and Deductions",
      }),
      navRow({
        jurisdiction: "us",
        doc_type: "guidance",
        path: "us/guidance/usda/fns/snap-fy2026-income-eligibility-standards",
        segment: "snap-fy2026-income-eligibility-standards",
        label: "SNAP FY 2026 Income Eligibility Standards",
      }),
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["guidance", "usda"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(mockGetNavigationIndexPrefixRows).toHaveBeenCalledWith({
      jurisdiction: "us",
      docType: "guidance",
      pathPrefix: "us/guidance/usda",
      encodedOnly: false,
    });
    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "fns",
        label: "FNS",
        hasChildren: true,
        childCount: 2,
      }),
    ]);
  });

  it("uses the real sparse row when the next prefix child has an exact index node", async () => {
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexPrefixRows.mockResolvedValue([
      navRow({
        jurisdiction: "us",
        doc_type: "guidance",
        path: "us/guidance/usda/fns/snap-fy2026-cola",
        segment: "snap-fy2026-cola",
        label: "SNAP FY 2026 Maximum Allotments and Deductions",
        has_children: true,
      }),
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["guidance", "usda", "fns"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "snap-fy2026-cola",
        label: "SNAP FY 2026 Maximum Allotments and Deductions",
        hasChildren: true,
      }),
    ]);
  });

  it("does not use RuleSpec-only fallback for later top-level pagination pages", async () => {
    // A later page the count still reaches; one past the end of a level
    // with no children at all answers as page 0 (below).
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 150,
    });

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["policy"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 1,
    });

    expect(result.nodes).toEqual([]);
    expect(mockListEncodedFiles).not.toHaveBeenCalled();
  });

  it.each([
    // children, requested page, the level's last page
    [["statute", "26"], 15, 1, 0],
    [["statute", "26"], 100, 1, 0],
    [["statute", "26"], 101, 2, 1],
    [["statute", "26"], 250, 5, 2],
    [["statute"], 54, 2, 0],
  ])(
    "names the last page when %j has %i children and page %i starts past them",
    async (ruleSegments, total, page, lastPage) => {
      mockGetNavigationIndexNode.mockResolvedValue(
        navRow({
          jurisdiction: "us",
          doc_type: "statute",
          path: "us/statute",
          segment: "statute",
          has_children: true,
        })
      );
      mockGetNavigationIndexChildren.mockResolvedValue({
        rows: [],
        hasMore: false,
        total,
      });

      const result = await loadTreeNodes({
        dbJurisdictionId: "us",
        ruleSegments,
        hasCitationPaths: true,
        encodedOnly: false,
        page,
      });

      expect(result).toEqual({ nodes: [], hasMore: false, lastPage });
      // Only the scope root: a page past the end reads nothing more.
      expect(mockGetNavigationIndexNode).toHaveBeenCalledTimes(1);
      expect(mockListEncodedFiles).not.toHaveBeenCalled();
    }
  );

  it("keeps an empty page that the count still reaches as an ordinary page", async () => {
    // Rows can land between the page read and the count; such a page is
    // not past the end, so it names no last page to send a reader to.
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 101,
    });

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["policy"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 1,
    });

    expect(result.nodes).toEqual([]);
    expect(result).not.toHaveProperty("lastPage");
  });

  it("never names a last page for a later page that lists children", async () => {
    // A page whose answer carried no count falls back to its row count,
    // which can sit below the page's own offset.
    mockGetNavigationIndexNode.mockResolvedValue(navRow());
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [navRow({ id: "nav-201", segment: "201", path: "us/statute/26/201" })],
      hasMore: false,
      total: 1,
    });

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["statute", "26"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 2,
    });

    expect(result).not.toHaveProperty("lastPage");
    expect(result.nodes.map((node) => node.segment)).toEqual(["201"]);
  });

  describe("with no children at all, past page 0", () => {
    const scopeRoot = navRow({
      jurisdiction: "us",
      doc_type: "statute",
      path: "us/statute",
      segment: "statute",
      has_children: true,
    });
    const load = (ruleSegments: string[], page: number) =>
      loadTreeNodes({
        dbJurisdictionId: "us",
        ruleSegments,
        hasCitationPaths: true,
        encodedOnly: false,
        page,
      });

    beforeEach(() => {
      mockGetNavigationIndexChildren.mockResolvedValue({
        rows: [],
        hasMore: false,
        total: 0,
      });
      // Only the doc type's scope root has a node.
      mockGetNavigationIndexNode.mockImplementation(async (path: string) =>
        path === "us/statute" ? scopeRoot : null
      );
    });

    it("names page 0 when page 0 finds the level's node", async () => {
      mockGetNavigationIndexNode.mockResolvedValue(scopeRoot);

      expect(await load(["statute", "27"], 3)).toEqual({
        nodes: [],
        hasMore: false,
        lastPage: 0,
      });
    });

    it("names page 0 when page 0 finds a sparse prefix", async () => {
      mockGetNavigationIndexPrefixRows.mockResolvedValue([
        navRow({ jurisdiction: "us", path: "us/statute/27/a/1", segment: "1" }),
      ]);

      expect(await load(["statute", "27"], 3)).toEqual({
        nodes: [],
        hasMore: false,
        lastPage: 0,
      });
    });

    it.each([[["statute"]], [["statute", "27"]]])(
      "names page 0 when page 0 under %j finds encodings",
      async (ruleSegments) => {
        mockListEncodedFiles.mockResolvedValue([
          {
            citationPath: "us/statute/27/1",
            filePath: "statutes/27/1.yaml",
            bucket: "statutes",
          },
        ]);

        expect(await load(ruleSegments, 3)).toEqual({
          nodes: [],
          hasMore: false,
          lastPage: 0,
        });
      }
    );

    it.each([[["statute"]], [["statute", "nonexistent"]]])(
      "throws for a missing level %j past page 0 as at page 0",
      async (ruleSegments) => {
        if (ruleSegments.length === 1) mockGetNavigationIndexNode.mockResolvedValue(null);
        await expect(load(ruleSegments, 0)).rejects.toThrow(
          NavigationIndexMissingError
        );
        await expect(load(ruleSegments, 3)).rejects.toThrow(
          NavigationIndexMissingError
        );
      }
    );

    it("answers with the nearest provision past page 0 as at page 0", async () => {
      mockGetProvisionByCitationPath.mockImplementation(async (path: string) =>
        path === "us/statute/26/3241"
          ? { id: "section-3241", body: "(b) Tax rate schedule", citation_path: path }
          : null
      );

      const first = await load(["statute", "26", "3241", "b"], 0);
      expect(first.currentRule?.citation_path).toBe("us/statute/26/3241");
      expect(await load(["statute", "26", "3241", "b"], 3)).toEqual(first);
    });
  });

  it("loads top-level doc_type children from an explicit scope root when present", async () => {
    const scopeRoot = navRow({
      path: "us-co/regulation",
      segment: "regulation",
      parent_path: null,
      has_children: true,
    });
    const row = navRow();
    mockGetNavigationIndexNode.mockResolvedValue(scopeRoot);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [row],
      hasMore: true,
      total: 101,
    });
    mockListEncodedFiles.mockResolvedValue([
      {
        filePath: "regulations/10-ccr-2506-1.yaml",
        citationPath: row.path,
        bucket: "regulations",
      },
    ]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us-co",
      ruleSegments: ["regulation"],
      hasCitationPaths: true,
      encodedOnly: true,
      page: 1,
    });

    expect(mockGetNavigationIndexChildren).toHaveBeenCalledWith({
      jurisdiction: "us-co",
      docType: "regulation",
      parentPath: "us-co/regulation",
      encodedOnly: true,
      page: 1,
    });
    expect(result.nodes[0]).toEqual(
      expect.objectContaining({ segment: "10-ccr-2506-1" })
    );
    expect(result.hasMore).toBe(true);
  });

  it("loads top-level doc_type children from parent_path null when no scope root exists", async () => {
    const row = navRow({
      jurisdiction: "us",
      doc_type: "statute",
      path: "us/statute/26",
      segment: "26",
    });
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [row],
      hasMore: false,
      total: 1,
    });

    await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["statute"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(mockGetNavigationIndexNode).toHaveBeenCalledWith("us/statute");
    expect(mockGetNavigationIndexChildren).toHaveBeenCalledWith({
      jurisdiction: "us",
      docType: "statute",
      parentPath: null,
      encodedOnly: false,
      page: 0,
    });
  });

  it("loads deep children and current provision from the index path", async () => {
    const child = navRow({
      path: "us-co/regulation/10-ccr-2506-1/4.401",
      parent_path: "us-co/regulation/10-ccr-2506-1",
      segment: "4.401",
      label: "4.401",
    });
    const current = navRow();
    const currentRule = {
      id: "provision-1",
      citation_path: "us-co/regulation/10-ccr-2506-1",
    };
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [child],
      hasMore: false,
      total: 1,
    });
    mockGetNavigationIndexNode.mockResolvedValue(current);
    mockGetProvisionForNavigationNode.mockResolvedValue(currentRule);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us-co",
      ruleSegments: ["regulation", "10-ccr-2506-1"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(mockGetNavigationIndexChildren).toHaveBeenCalledWith({
      jurisdiction: "us-co",
      docType: "regulation",
      parentPath: "us-co/regulation/10-ccr-2506-1",
      encodedOnly: false,
      page: 0,
    });
    expect(mockGetNavigationIndexNode).toHaveBeenCalledWith(
      "us-co/regulation/10-ccr-2506-1"
    );
    expect(result.currentRule).toEqual(
      expect.objectContaining({
        ...currentRule,
        has_rulespec: false,
        rulespec_path: null,
      })
    );
    expect(result.nodes.map((node) => node.segment)).toEqual(["4.401"]);
  });

  it("keeps deep navigation available when the optional current provision lookup fails", async () => {
    const child = navRow({
      path: "us-co/regulation/10-ccr-2506-1/4.401",
      parent_path: "us-co/regulation/10-ccr-2506-1",
      segment: "4.401",
      label: "4.401",
    });
    const current = navRow();
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [child],
      hasMore: false,
      total: 1,
    });
    mockGetNavigationIndexNode.mockResolvedValue(current);
    mockGetProvisionForNavigationNode.mockRejectedValue(
      new Error("permission denied")
    );

    const result = await loadTreeNodes({
      dbJurisdictionId: "us-co",
      ruleSegments: ["regulation", "10-ccr-2506-1"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.currentRule).toBeNull();
    expect(result.nodes.map((node) => node.segment)).toEqual(["4.401"]);
  });

  it("keeps empty indexed containers available when the optional current provision lookup fails", async () => {
    const current = navRow({
      has_children: true,
      child_count: 1,
    });
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(current);
    mockGetProvisionForNavigationNode.mockRejectedValue(
      new Error("permission denied")
    );

    const result = await loadTreeNodes({
      dbJurisdictionId: "us-co",
      ruleSegments: ["regulation", "10-ccr-2506-1"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.currentRule).toBeNull();
    expect(result.nodes).toEqual([]);
  });

  it("returns a leaf rule when the indexed node has no children", async () => {
    const leaf = navRow({
      path: "us-co/regulation/10-ccr-2506-1/4.401",
      parent_path: "us-co/regulation/10-ccr-2506-1",
      segment: "4.401",
      has_children: false,
      child_count: 0,
    });
    const leafRule = {
      id: "leaf-provision",
      citation_path: leaf.path,
    };
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(leaf);
    mockGetProvisionForNavigationNode.mockResolvedValue(leafRule);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us-co",
      ruleSegments: ["regulation", "10-ccr-2506-1", "4.401"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.leafRule).toEqual(
      expect.objectContaining({
        ...leafRule,
        has_rulespec: false,
        rulespec_path: null,
      })
    );
    expect(result.nodes).toEqual([]);
  });

  it("does not show RuleSpec badges from stale navigation flags without a real RuleSpec file", async () => {
    const staleChild = navRow({
      jurisdiction: "uk",
      doc_type: "legislation",
      path: "uk/legislation/uksi/2013/376/regulation/22/1/b/i",
      citation_path: "uk/legislation/uksi/2013/376/regulation/22/1/b/i",
      segment: "i",
      label: "(i)",
      has_children: false,
      has_rulespec: true,
      encoded_descendant_count: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(
      navRow({
        jurisdiction: "uk",
        doc_type: "legislation",
        path: "uk/legislation/uksi/2013/376/regulation/22/1/b",
        segment: "b",
        has_children: true,
      })
    );
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [staleChild],
      hasMore: false,
      total: 1,
    });
    mockListEncodedFiles.mockResolvedValue([]);

    const result = await loadTreeNodes({
      dbJurisdictionId: "uk",
      ruleSegments: [
        "legislation",
        "uksi",
        "2013",
        "376",
        "regulation",
        "22",
        "1",
        "b",
      ],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        segment: "i",
        hasRuleSpec: false,
        rule: expect.objectContaining({
          has_rulespec: false,
          rulespec_path: null,
        }),
      }),
    ]);
  });

  it("returns a synthetic leaf when an encoded navigation leaf has no current provision but has a real RuleSpec file", async () => {
    const leaf = navRow({
      jurisdiction: "uk",
      doc_type: "regulation",
      path: "uk/legislation/ukpga/2002/16/section/3ZA/3",
      citation_path: "uk/legislation/ukpga/2002/16/section/3ZA/3",
      parent_path: "uk/legislation/ukpga/2002/16/section/3ZA",
      segment: "3",
      label: "(3)",
      has_children: false,
      child_count: 0,
      has_rulespec: false,
    });
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(leaf);
    mockGetProvisionForNavigationNode.mockResolvedValue(null);
    mockSynthesiseRuleFromCitationPath.mockResolvedValue({
      id: "github:uk/legislation/ukpga/2002/16/section/3ZA/3",
      citation_path: "uk/legislation/ukpga/2002/16/section/3ZA/3",
      heading: "Encoded rule",
      has_rulespec: true,
    });

    const result = await loadTreeNodes({
      dbJurisdictionId: "uk",
      ruleSegments: [
        "legislation",
        "ukpga",
        "2002",
        "16",
        "section",
        "3ZA",
        "3",
      ],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(mockSynthesiseRuleFromCitationPath).toHaveBeenCalledWith(
      "uk",
      "uk/legislation/ukpga/2002/16/section/3ZA/3"
    );
    expect(result.nodes).toEqual([]);
    expect(result.leafRule).toEqual(
      expect.objectContaining({
        id: "github:uk/legislation/ukpga/2002/16/section/3ZA/3",
        citation_path: "uk/legislation/ukpga/2002/16/section/3ZA/3",
        heading: "Encoded rule",
        has_rulespec: true,
      })
    );
  });

  it("does not hard-error on stale navigation has_rulespec alone", async () => {
    const leaf = navRow({
      jurisdiction: "uk",
      doc_type: "legislation",
      path: "uk/legislation/uksi/2013/376/regulation/22/1/b/i",
      citation_path: "uk/legislation/uksi/2013/376/regulation/22/1/b/i",
      parent_path: "uk/legislation/uksi/2013/376/regulation/22/1/b",
      segment: "i",
      label: "(i)",
      has_children: false,
      child_count: 0,
      has_rulespec: true,
    });
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(leaf);
    mockGetProvisionForNavigationNode.mockResolvedValue(null);
    mockSynthesiseRuleFromCitationPath.mockResolvedValue(null);

    const result = await loadTreeNodes({
      dbJurisdictionId: "uk",
      ruleSegments: [
        "legislation",
        "uksi",
        "2013",
        "376",
        "regulation",
        "22",
        "1",
        "b",
        "i",
      ],
      hasCitationPaths: true,
      encodedOnly: true,
      page: 0,
    });

    expect(result.nodes).toEqual([]);
    expect(result.leafRule).toBeNull();
  });

  it("returns an empty result when an indexed leaf has no provision", async () => {
    const leaf = navRow({
      path: "us-co/regulation/10-ccr-2506-1/4.401",
      parent_path: "us-co/regulation/10-ccr-2506-1",
      segment: "4.401",
      has_children: false,
      child_count: 0,
    });
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(leaf);
    mockGetProvisionForNavigationNode.mockResolvedValue(null);

    const result = await loadTreeNodes({
      dbJurisdictionId: "us-co",
      ruleSegments: ["regulation", "10-ccr-2506-1", "4.401"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([]);
    expect(result.leafRule).toBeNull();
  });

  it("throws a clear missing-index error when a deep route has no node", async () => {
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(null);

    await expect(
      loadTreeNodes({
        dbJurisdictionId: "us-co",
        ruleSegments: ["regulation", "missing"],
        hasCitationPaths: true,
        encodedOnly: false,
        page: 0,
      })
    ).rejects.toThrow(NavigationIndexMissingError);
  });

  it("falls back to the nearest body-bearing provision when a subsection is missing from the navigation index", async () => {
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(null);
    mockGetProvisionByCitationPath.mockImplementation(async (path: string) => {
      if (path === "us/statute/26/3241/b") return null;
      if (path === "us/statute/26/3241") {
        return {
          id: "section-3241",
          jurisdiction: "us",
          doc_type: "statute",
          parent_id: null,
          level: 3,
          ordinal: null,
          heading:
            "Determination of tier 2 tax rate based on average account benefits ratio",
          body: "(b) Tax rate schedule | Average account benefits ratio | Applicable percentage",
          effective_date: null,
          repeal_date: null,
          source_url: null,
          source_path: null,
          citation_path: "us/statute/26/3241",
          rulespec_path: null,
          has_rulespec: false,
          created_at: "",
          updated_at: "",
        };
      }
      return null;
    });

    const result = await loadTreeNodes({
      dbJurisdictionId: "us",
      ruleSegments: ["statute", "26", "3241", "b"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
    });

    expect(result.nodes).toEqual([]);
    expect(result.currentRule?.citation_path).toBe("us/statute/26/3241");
    expect(mockGetProvisionByCitationPath).toHaveBeenCalledWith(
      "us/statute/26/3241/b"
    );
    expect(mockGetProvisionByCitationPath).toHaveBeenCalledWith(
      "us/statute/26/3241"
    );
  });

  it("does not use corpus provision fallback in encoded-only navigation", async () => {
    mockGetNavigationIndexChildren.mockResolvedValue({
      rows: [],
      hasMore: false,
      total: 0,
    });
    mockGetNavigationIndexNode.mockResolvedValue(null);

    await expect(
      loadTreeNodes({
        dbJurisdictionId: "us",
        ruleSegments: ["statute", "26", "3241", "b"],
        hasCitationPaths: true,
        encodedOnly: true,
        page: 0,
      })
    ).rejects.toThrow(NavigationIndexMissingError);

    expect(mockGetProvisionByCitationPath).not.toHaveBeenCalled();
  });
});

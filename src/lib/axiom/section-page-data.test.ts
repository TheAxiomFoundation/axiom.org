import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Rule } from "@/lib/supabase";

/**
 * Integration-shaped tests for getSectionPageData: the Supabase
 * clients and navigation-index reads are mocked at the module
 * boundary; assembly logic (fallback walk, chunking, toc, neighbor
 * resolution, encoding mapping) runs for real.
 */

const { fromMock, encodingsFromMock, getRuleReferencesMock, getRuleEncodingMock } =
  vi.hoisted(() => ({
    fromMock: vi.fn(),
    encodingsFromMock: vi.fn(),
    getRuleReferencesMock: vi.fn(),
    getRuleEncodingMock: vi.fn(),
  }));
const { getProvisionByCitationPathMock } = vi.hoisted(() => ({
  getProvisionByCitationPathMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseCorpus: { from: fromMock },
  supabaseEncodings: { from: encodingsFromMock },
  getRuleReferences: getRuleReferencesMock,
  getRuleEncoding: getRuleEncodingMock,
}));

vi.mock("@/lib/axiom/navigation-index/read", () => ({
  getProvisionByCitationPath: getProvisionByCitationPathMock,
}));

// The descendant-file aggregation has its own tests
// (section-encoding.test.ts); here it stays inert so the primary
// getRuleEncoding path drives the assertions.
vi.mock("@/lib/axiom/rulespec/repo-listing", () => ({
  findEncodedDescendants: vi.fn(async () => []),
  fetchEncodedFile: vi.fn(async () => null),
}));

vi.mock("@/lib/tree-data", () => ({
  resolveAxiomPath: (segments: string[]) =>
    segments.length >= 2
      ? {
          phase: "rule",
          jurisdiction: { slug: segments[0], hasCitationPaths: true },
          ruleSegments: segments.slice(1),
        }
      : { phase: "jurisdiction-picker", jurisdiction: null, ruleSegments: [] },
  buildBreadcrumbs: (segments: string[]) =>
    segments.map((segment, index) => ({
      label: segment,
      href: "/" + segments.slice(0, index + 1).join("/"),
    })),
}));

import {
  getSectionPageData,
  resolveSection,
  rulespecSourceCitationPath,
} from "./section-page";

/** Chainable query stub: every builder method returns the chain, the
 *  chain is thenable, and maybeSingle resolves the same result. */
function chain(result: { data: unknown; error: unknown }) {
  const self: Record<string, unknown> = {};
  for (const method of [
    "select",
    "gte",
    "lt",
    "gt",
    "eq",
    "is",
    "order",
    "limit",
  ]) {
    self[method] = () => self;
  }
  self.maybeSingle = () => Promise.resolve(result);
  self.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return self;
}

function rule(citationPath: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id: `id-${citationPath}`,
    jurisdiction: "us",
    doc_type: "statute",
    parent_id: null,
    level: citationPath.split("/").length,
    ordinal: null,
    heading: "Heading",
    body: "(a) First subsection text.\n\n(b) Second subsection text.",
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: null,
    citation_path: citationPath,
    rulespec_path: null,
    has_rulespec: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const NAV_NODE = {
  id: "nav-1",
  jurisdiction: "us",
  doc_type: "statute",
  path: "us/statute/26/32",
  parent_path: "us/statute/26",
  segment: "32",
  label: "§ 32",
  sort_key: "0032",
  depth: 3,
  provision_id: null,
  citation_path: "us/statute/26/32",
  has_children: false,
  child_count: 0,
  has_rulespec: true,
  encoded_descendant_count: 0,
  status: null,
};

const YAML = [
  "format: rulespec/v1",
  "module:",
  "  name: eitc",
  "rules:",
  "  - name: rule_a",
  "    kind: derived",
  "    source: 26 USC 32(a)",
  "    versions:",
  "      - effective_from: '2026-01-01'",
  "        formula: 'x'",
].join("\n");

function queueTables(queues: Record<string, Array<{ data: unknown; error: unknown }>>) {
  fromMock.mockImplementation((table: string) => {
    const next = queues[table]?.shift();
    return chain(next ?? { data: null, error: { message: `no queued result for ${table}` } });
  });
}

beforeEach(() => {
  fromMock.mockReset();
  encodingsFromMock
    .mockReset()
    .mockImplementation(() => chain({ data: [], error: null }));
  getRuleReferencesMock.mockReset().mockResolvedValue([]);
  getRuleEncodingMock.mockReset().mockResolvedValue(null);
  getProvisionByCitationPathMock.mockReset();
});

describe("getSectionPageData", () => {
  it("assembles a section-granular page: chunks, toc, neighbors, encoding map", async () => {
    getProvisionByCitationPathMock.mockResolvedValue(rule("us/statute/26/32"));
    getRuleEncodingMock.mockResolvedValue({ rulespec_content: YAML });
    queueTables({
      current_provisions: [{ data: [], error: null }], // empty subtree
      navigation_nodes: [
        { data: NAV_NODE, error: null }, // current node
        { data: [{ path: "us/statute/26/31", citation_path: "us/statute/26/31", label: "§ 31" }], error: null }, // prev
        { data: [{ path: "us/statute/26/33", citation_path: null, label: "§ 33" }], error: null }, // next
      ],
    });

    const data = await getSectionPageData(["us", "statute", "26", "32"]);
    expect(data).not.toBeNull();
    expect(data!.citationPath).toBe("us/statute/26/32");
    expect(data!.focusAnchor).toBeNull();
    expect(data!.bodyChunks.map((chunk) => chunk.anchor)).toEqual(["a", "b"]);
    expect(data!.toc.map((entry) => entry.anchor)).toEqual(["a", "b"]);
    expect(data!.prev).toEqual({
      citationPath: "us/statute/26/31",
      label: "§ 31",
    });
    // next falls back to path when citation_path is null
    expect(data!.next).toEqual({
      citationPath: "us/statute/26/33",
      label: "§ 33",
    });
    expect(data!.encodedRules).toEqual([
      { name: "rule_a", kind: "derived", anchors: ["a"] },
    ]);
    expect(data!.breadcrumbs.at(-1)?.label).toBe("32");
  });

  it("prefers descendant rows over body chunks when they exist", async () => {
    getProvisionByCitationPathMock.mockResolvedValue(rule("us/statute/26/32"));
    queueTables({
      current_provisions: [
        {
          data: [
            rule("us/statute/26/32/a/1", { heading: null }),
            rule("us/statute/26/32/a", { heading: "In general" }),
          ],
          error: null,
        },
      ],
      navigation_nodes: [{ data: null, error: null }],
    });

    const data = await getSectionPageData(["us", "statute", "26", "32"]);
    expect(data!.provisions.map((p) => p.anchor)).toEqual(["a", "a-1"]);
    expect(data!.bodyChunks).toEqual([]);
    expect(data!.toc[0].label).toBe("(a) In general");
    expect(data!.prev).toBeNull();
    expect(data!.next).toBeNull();
  });

  it("walks up to the nearest ingested ancestor and sets the focus anchor", async () => {
    getProvisionByCitationPathMock.mockImplementation((path: string) =>
      Promise.resolve(path === "us/statute/26/32" ? rule(path) : null)
    );
    queueTables({
      current_provisions: [{ data: [], error: null }],
      navigation_nodes: [{ data: null, error: null }],
    });

    const data = await getSectionPageData(["us", "statute", "26", "32", "a", "1"]);
    expect(data!.citationPath).toBe("us/statute/26/32");
    expect(data!.focusAnchor).toBe("a");
  });

  it("renders the section unfocused when the cited anchor cannot be located", async () => {
    // Subsection markers vary by ingest ("(3)" vs "3.") and Source
    // links append them best-effort — a body-bearing section still
    // satisfies the citation, just without a focus highlight.
    getProvisionByCitationPathMock.mockImplementation((path: string) =>
      Promise.resolve(path === "us/statute/26/32" ? rule(path) : null)
    );
    queueTables({
      current_provisions: [{ data: [], error: null }],
      navigation_nodes: [{ data: null, error: null }],
    });

    // The fixture body only has subsections (a) and (b) — "z" is not
    // among them, so the section renders without a focus anchor.
    const data = await getSectionPageData(["us", "statute", "26", "32", "z"]);
    expect(data!.citationPath).toBe("us/statute/26/32");
    expect(data!.focusAnchor).toBeNull();
  });

  it("still 404s when only a bodyless container satisfies the walk-up", async () => {
    // /us/statute/26/2011 with §2011 missing must 404, not silently
    // render Title 26 as though it satisfied the URL.
    getProvisionByCitationPathMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "us/statute/26" ? rule(path, { body: null }) : null
      )
    );
    queueTables({
      current_provisions: [{ data: [], error: null }],
      navigation_nodes: [{ data: null, error: null }],
    });

    const data = await getSectionPageData(["us", "statute", "26", "2011"]);
    expect(data).toBeNull();
  });

  it("falls back to the en-dash spelling for hyphenated section ids", async () => {
    // Corpus stores us/statute/42/1396u–1 (en dash); the URL arrives
    // with the hyphen everyone types.
    getProvisionByCitationPathMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "us/statute/42/1396u–1" ? rule(path) : null
      )
    );
    queueTables({
      current_provisions: [
        { data: [], error: null }, // hyphen subtree probe: empty
        { data: [], error: null }, // post-resolve subtree fetch
      ],
      navigation_nodes: [{ data: null, error: null }],
    });

    const data = await getSectionPageData(["us", "statute", "42", "1396u-1"]);
    expect(data).not.toBeNull();
    expect(data!.citationPath).toBe("us/statute/42/1396u–1");
  });

  it("returns null when nothing at, below, or above the path is ingested", async () => {
    getProvisionByCitationPathMock.mockResolvedValue(null);
    // The subtree probe (new root-less-section path) finds nothing.
    queueTables({ current_provisions: [{ data: [], error: null }] });
    const data = await getSectionPageData(["us", "statute", "99", "9999"]);
    expect(data).toBeNull();
  });

  it("synthesizes a root over an ingested subtree when the section row is missing", async () => {
    // 42 USC 1396a shape: descendants exist, the section row does not.
    getProvisionByCitationPathMock.mockResolvedValue(null);
    queueTables({
      current_provisions: [
        {
          data: [
            rule("us/statute/42/1396a/a"),
            rule("us/statute/42/1396a/a/10"),
            rule("us/statute/42/1396a/e"),
          ],
          error: null,
        },
      ],
      navigation_nodes: [
        {
          data: {
            jurisdiction: "us",
            doc_type: "statute",
            path: "us/statute/42/1396a",
            parent_path: "us/statute/42",
            sort_key: "x",
            label: "§ 1396a - State plans for medical assistance",
          },
          error: null,
        },
        // Second navigation lookup (neighbors pass) finds nothing.
        { data: null, error: null },
      ],
    });

    const data = await getSectionPageData(["us", "statute", "42", "1396a"]);
    expect(data).not.toBeNull();
    expect(data!.citationPath).toBe("us/statute/42/1396a");
    expect(data!.root.id).toBe("synthetic:us/statute/42/1396a");
    expect(data!.root.heading).toBe(
      "§ 1396a - State plans for medical assistance"
    );
    expect(data!.provisions.map((p) => p.anchor)).toEqual([
      "a",
      "a-10",
      "e",
    ]);
    expect(data!.toc.map((entry) => entry.anchor)).toEqual(["a", "e"]);
  });

  it("returns null for unresolvable paths", async () => {
    expect(await getSectionPageData(["us"])).toBeNull();
  });

  it("survives query errors with empty neighbors and subtree", async () => {
    getProvisionByCitationPathMock.mockResolvedValue(rule("us/statute/26/32"));
    getRuleReferencesMock.mockRejectedValue(new Error("rpc down"));
    getRuleEncodingMock.mockRejectedValue(new Error("encoding down"));
    queueTables({
      current_provisions: [{ data: null, error: { message: "boom" } }],
      navigation_nodes: [{ data: null, error: { message: "boom" } }],
    });

    const data = await getSectionPageData(["us", "statute", "26", "32"]);
    expect(data).not.toBeNull();
    expect(data!.rootRefs).toEqual([]);
    expect(data!.encoding).toBeNull();
    expect(data!.prev).toBeNull();
    expect(data!.next).toBeNull();
  });
});

describe("resolveSection childless-leaf lift", () => {
  it("lifts an enumeration item to its bodied parent, focused", async () => {
    getProvisionByCitationPathMock.mockImplementation(async (path: string) => {
      if (path === "us/statute/26/21/c/1") {
        return rule("us/statute/26/21/c/1", {
          body: "$3,000 if there is 1 qualifying individual, or",
        });
      }
      if (path === "us/statute/26/21/c") {
        return rule("us/statute/26/21/c", {
          body:
            "The amount taken into account shall not exceed—\n\n" +
            "(1) $3,000 if there is 1 qualifying individual, or\n\n" +
            "(2) $6,000 if there are 2 or more.",
        });
      }
      return null;
    });
    queueTables({
      current_provisions: [
        { data: [], error: null }, // leaf subtree probe: childless
        { data: [], error: null }, // parent subtree
      ],
    });

    const resolution = await resolveSection([
      "us",
      "statute",
      "26",
      "21",
      "c",
      "1",
    ]);
    expect(resolution).not.toBeNull();
    expect(resolution!.citationPath).toBe("us/statute/26/21/c");
    expect(resolution!.focusAnchor).toBe("1");
  });

  it("keeps a leaf that has its own subtree", async () => {
    getProvisionByCitationPathMock.mockImplementation(async (path: string) =>
      path === "us-ny/regulation/18-nycrr/387/14/a/5"
        ? rule("us-ny/regulation/18-nycrr/387/14/a/5", {
            body: "(5) Categorical eligibility.",
          })
        : null
    );
    queueTables({
      current_provisions: [
        {
          data: [rule("us-ny/regulation/18-nycrr/387/14/a/5/i")],
          error: null,
        },
      ],
    });

    const resolution = await resolveSection([
      "us-ny",
      "regulation",
      "18-nycrr",
      "387",
      "14",
      "a",
      "5",
    ]);
    expect(resolution).not.toBeNull();
    expect(resolution!.citationPath).toBe(
      "us-ny/regulation/18-nycrr/387/14/a/5"
    );
    expect(resolution!.focusAnchor).toBeNull();
  });

  it("keeps a section-granular exact hit untouched", async () => {
    getProvisionByCitationPathMock.mockImplementation(async (path: string) =>
      path === "us/statute/26/32" ? rule("us/statute/26/32") : null
    );
    const resolution = await resolveSection(["us", "statute", "26", "32"]);
    expect(resolution).not.toBeNull();
    expect(resolution!.citationPath).toBe("us/statute/26/32");
    expect(resolution!.focusAnchor).toBeNull();
  });
});

describe("resolveSection policy-adjacent fallbacks (#191)", () => {
  it("crosswalks a policy path to its manual-classified corpus home", async () => {
    getProvisionByCitationPathMock.mockImplementation(async (path: string) =>
      path === "us-nc/manual/dhhs/glossary"
        ? rule("us-nc/manual/dhhs/glossary", { doc_type: "manual" })
        : null
    );
    queueTables({
      // Subtree probes along the miss ladder come back empty.
      current_provisions: [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ],
    });

    const resolution = await resolveSection([
      "us-nc",
      "policy",
      "dhhs",
      "glossary",
    ]);
    expect(resolution).not.toBeNull();
    expect(resolution!.citationPath).toBe("us-nc/manual/dhhs/glossary");
    expect(resolution!.synthetic).toBe(false);
  });

  it("resolves through the rulespec mirror's corpus_citation_path", async () => {
    getProvisionByCitationPathMock.mockImplementation(async (path: string) =>
      path === "us-ak/guidance/dpa/standards/page-1"
        ? rule("us-ak/guidance/dpa/standards/page-1", { doc_type: "guidance" })
        : null
    );
    encodingsFromMock.mockImplementation(() =>
      chain({
        data: [
          {
            raw_yaml: [
              "module:",
              "  source_verification:",
              "    corpus_citation_path: us-ak/guidance/dpa/standards/page-1",
            ].join("\n"),
          },
        ],
        error: null,
      })
    );
    queueTables({
      current_provisions: [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ],
    });

    const resolution = await resolveSection([
      "us-ak",
      "policy",
      "dpa",
      "standards",
    ]);
    expect(resolution).not.toBeNull();
    expect(resolution!.citationPath).toBe("us-ak/guidance/dpa/standards/page-1");
  });

  it("survives rejecting lookups at every rung of the ladder", async () => {
    // Every provision lookup rejects outright — the .catch guards on
    // each rung must swallow the failure and keep walking.
    getProvisionByCitationPathMock.mockRejectedValue(new Error("boom"));
    encodingsFromMock.mockImplementation(() => {
      throw new Error("mirror down");
    });
    queueTables({
      current_provisions: Array.from({ length: 8 }, () => ({
        data: [],
        error: null,
      })),
    });
    expect(
      // A hyphen past the first segment exercises the en-dash retry too.
      await resolveSection(["us-nc", "policy", "dhh-s", "glossary"])
    ).toBeNull();

    // Mirror answers with a corpus path whose provision lookup rejects:
    // the source-path guard swallows that as well.
    encodingsFromMock.mockImplementation(() =>
      chain({
        data: [
          {
            raw_yaml:
              "module:\n  source_verification:\n    corpus_citation_path: us-nc/guidance/x/y",
          },
        ],
        error: null,
      })
    );
    queueTables({
      current_provisions: Array.from({ length: 8 }, () => ({
        data: [],
        error: null,
      })),
    });
    expect(
      await resolveSection(["us-nc", "policy", "dhh-s", "glossary"])
    ).toBeNull();
  });

  it("ignores an empty corpus_citation_path scalar instead of eating the next line", async () => {
    encodingsFromMock.mockImplementation(() =>
      chain({
        data: [
          {
            raw_yaml: [
              "module:",
              "  source_verification:",
              "    corpus_citation_path:",
              "    verified_by: someone/else",
            ].join("\n"),
          },
        ],
        error: null,
      })
    );
    getProvisionByCitationPathMock.mockResolvedValue(null);
    queueTables({
      current_provisions: Array.from({ length: 12 }, () => ({
        data: [],
        error: null,
      })),
    });

    const resolution = await resolveSection([
      "us",
      "policy",
      "irs",
      "rev-proc-2025-32",
      "earned-income-credit",
    ]);
    // No path extracted → the mirror rung yields nothing and the
    // ladder exhausts to a 404 rather than resolving "verified_by".
    expect(resolution).toBeNull();
  });

  it("reads the plural corpus_citation_paths list from the mirror", async () => {
    getProvisionByCitationPathMock.mockImplementation(async (path: string) =>
      path === "us/guidance/irs/rev-proc-2025-32/page-14"
        ? rule("us/guidance/irs/rev-proc-2025-32/page-14", {
            doc_type: "guidance",
          })
        : null
    );
    encodingsFromMock.mockImplementation(() =>
      chain({
        data: [
          {
            raw_yaml: [
              "module:",
              "  source_verification:",
              "    corpus_citation_paths:",
              "      - us/guidance/irs/rev-proc-2025-32/page-14",
              "      - us/guidance/irs/rev-proc-2025-32/page-15",
            ].join("\n"),
          },
        ],
        error: null,
      })
    );
    queueTables({
      current_provisions: Array.from({ length: 6 }, () => ({
        data: [],
        error: null,
      })),
    });

    const resolution = await resolveSection([
      "us",
      "policy",
      "irs",
      "rev-proc-2025-32",
      "earned-income-credit",
    ]);
    expect(resolution).not.toBeNull();
    expect(resolution!.citationPath).toBe(
      "us/guidance/irs/rev-proc-2025-32/page-14"
    );
  });

  it("still 404s a policy path with no crosswalk, mirror, or corpus home", async () => {
    getProvisionByCitationPathMock.mockResolvedValue(null);
    queueTables({
      current_provisions: [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ],
    });
    expect(
      await resolveSection(["us-zz", "policy", "nowhere", "at-all"])
    ).toBeNull();
  });
});

describe("rulespecSourceCitationPath", () => {
  it("reads a module's attested corpus home out of the mirror", async () => {
    encodingsFromMock.mockImplementation(() =>
      chain({
        data: [
          {
            raw_yaml:
              "module:\n  source_verification:\n    corpus_citation_path: us/statute/26/32\n",
          },
        ],
        error: null,
      })
    );

    expect(
      await rulespecSourceCitationPath("us", ["policy", "irs", "notice"])
    ).toBe("us/statute/26/32");
  });

  it("refuses the mirror for a gated pilot family", async () => {
    // Same registered-visibility refusal getSectionEncoding makes: a
    // gated family's YAML is unreadable everywhere else, so it must not
    // attest a corpus home through the index either.
    encodingsFromMock.mockImplementation(() =>
      chain({
        data: [
          {
            raw_yaml:
              "module:\n  source_verification:\n    corpus_citation_path: il/statute/income-tax-ordinance/section-121\n",
          },
        ],
        error: null,
      })
    );

    expect(
      await rulespecSourceCitationPath("il", [
        "statute",
        "income-tax-ordinance",
        "section-121",
      ])
    ).toBeNull();
    expect(encodingsFromMock).not.toHaveBeenCalled();
  });
});

import fc from "fast-check";
import { describe, it, expect, vi } from "vitest";
import { serializeJsonLd } from "@/lib/json-ld";
import { hostileString } from "@/test/hostile-strings";

const { mockIn } = vi.hoisted(() => ({ mockIn: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabaseCorpus: {
    from: () => ({
      select: () => ({
        in: mockIn,
      }),
    }),
  },
}));

import {
  AXIOM_APP_URL,
  citationUrl,
  getAxiomRuleMetadata,
  buildLegislationJsonLd,
} from "./metadata";

describe("getAxiomRuleMetadata", () => {
  it("returns a generic axiom payload when segments is empty", async () => {
    const meta = await getAxiomRuleMetadata(undefined);
    expect(meta.rule).toBeNull();
    expect(meta.citationPath).toBe("");
    expect(meta.canonicalUrl).toBe(AXIOM_APP_URL);
    expect(meta.title).toContain("Axiom");
    expect(meta.description).toContain("encoded legal code");
  });

  it("returns axiom payload for empty segments array", async () => {
    const meta = await getAxiomRuleMetadata([]);
    expect(meta.citationPath).toBe("");
    expect(meta.canonicalUrl).toBe(AXIOM_APP_URL);
  });

  it("returns a rule-specific payload when the path resolves to an ingested rule", async () => {
    mockIn.mockResolvedValue({
      data: [
        {
          id: "r1",
          citation_path: "us/statute/26/32",
          heading: "Earned income",
          body: "There shall be allowed a credit...",
          jurisdiction: "us",
          doc_type: "statute",
          updated_at: "2026-01-01",
        },
      ],
      error: null,
    });
    const meta = await getAxiomRuleMetadata(["us", "statute", "26", "32"]);
    expect(meta.rule?.id).toBe("r1");
    expect(meta.citationPath).toBe("us/statute/26/32");
    expect(meta.canonicalUrl).toBe(`${AXIOM_APP_URL}/us/statute/26/32`);
    expect(meta.title).toContain("Earned income");
    expect(meta.title).toContain("us/statute/26/32");
    expect(meta.description).toContain("There shall be allowed");
    expect(meta.jurisdiction).toBe("us");
    expect(meta.docType).toBe("statute");
  });

  it("returns neutral metadata when no exact rule or ancestor matches", async () => {
    mockIn.mockResolvedValue({ data: [], error: null });
    const meta = await getAxiomRuleMetadata(["us", "statute", "99", "99"]);
    expect(meta.rule).toBeNull();
    expect(meta.citationPath).toBe("us/statute/99/99");
    expect(meta.title).toContain("us/statute/99/99");
    expect(meta.description).toContain("Browse available Axiom legal-code entries");
  });

  it("resolves chapter-prefixed state statute aliases to canonical metadata", async () => {
    let lookupPaths: string[] = [];
    mockIn.mockImplementation((_column: string, paths: string[]) => {
      lookupPaths = paths;
      return Promise.resolve({
        data: [
          {
            id: "ky-12-215",
            citation_path: "us-ky/statute/3/12.215",
            heading: "Expenses incurred by Attorney General",
            body: "The expenses incurred by the Attorney General...",
            jurisdiction: "us-ky",
            doc_type: "statute",
            updated_at: "2026-01-01",
          },
        ],
        error: null,
      });
    });

    const meta = await getAxiomRuleMetadata([
      "us-ky",
      "statute",
      "3",
      "chapter-12",
      "12.215",
    ]);

    expect(lookupPaths).toEqual([
      "us-ky/statute/3/chapter-12/12.215",
      "us-ky/statute/3/12.215",
      "us-ky/statute/3/chapter-12",
      "us-ky/statute/3",
      "us-ky/statute",
      "us-ky",
    ]);
    expect(meta.rule?.id).toBe("ky-12-215");
    expect(meta.canonicalUrl).toBe(
      `${AXIOM_APP_URL}/us-ky/statute/3/12.215`
    );
    expect(meta.title).toContain("us-ky/statute/3/12.215");
  });

  it("uses heading in description when body is absent", async () => {
    mockIn.mockResolvedValue({
      data: [
        {
          id: "r",
          citation_path: "us/statute/26/32",
          heading: "Earned income",
          body: null,
          jurisdiction: "us",
          doc_type: "statute",
          updated_at: null,
        },
      ],
      error: null,
    });
    const meta = await getAxiomRuleMetadata(["us", "statute", "26", "32"]);
    expect(meta.description).toContain("Earned income");
  });

  it("falls back to citation-only description when heading and body are both absent", async () => {
    mockIn.mockResolvedValue({
      data: [
        {
          id: "r",
          citation_path: "us/statute/26/32",
          heading: null,
          body: null,
          jurisdiction: "us",
          doc_type: "statute",
          updated_at: null,
        },
      ],
      error: null,
    });
    const meta = await getAxiomRuleMetadata(["us", "statute", "26", "32"]);
    expect(meta.description).toContain("us/statute/26/32");
    expect(meta.title).toBe("us/statute/26/32 · Axiom");
  });

  it("truncates long bodies at a sentence boundary in the description", async () => {
    const longBody = "a".repeat(250);
    mockIn.mockResolvedValue({
      data: [
        {
          id: "r",
          citation_path: "us/statute/26/32",
          heading: "H",
          body: longBody,
          jurisdiction: "us",
          doc_type: "statute",
          updated_at: null,
        },
      ],
      error: null,
    });
    const meta = await getAxiomRuleMetadata(["us", "statute", "26", "32"]);
    // 200-char cap with ellipsis; our truncator appends "…"
    expect(meta.description.length).toBeLessThanOrEqual(201);
    expect(meta.description.endsWith("…")).toBe(true);
  });
});

describe("buildLegislationJsonLd", () => {
  it("returns null when metadata has no rule", () => {
    const json = buildLegislationJsonLd({
      rule: null,
      title: "",
      description: "",
      canonicalUrl: "",
      citationPath: "",
      jurisdiction: null,
      docType: null,
    });
    expect(json).toBeNull();
  });

  it("maps statute rules to schema.org Statute", () => {
    const json = buildLegislationJsonLd({
      rule: {
        id: "r",
        citation_path: "us/statute/26/32",
        heading: "Earned income",
        body: "Body",
        jurisdiction: "us",
        doc_type: "statute",
        updated_at: "2026-01-01",
      } as unknown as Parameters<typeof buildLegislationJsonLd>[0]["rule"],
      title: "",
      description: "",
      canonicalUrl: "https://example.com/x",
      citationPath: "us/statute/26/32",
      jurisdiction: "us",
      docType: "statute",
    }) as Record<string, unknown>;
    expect(json["@type"]).toBe("Legislation");
    expect(json.legislationType).toBe("Statute");
    expect(json.legislationIdentifier).toBe("us/statute/26/32");
    expect(json.legislationJurisdiction).toBe("us");
    expect(json.url).toBe(`${AXIOM_APP_URL}/us/statute/26/32`);
  });

  it("maps regulation rules to schema.org Regulation", () => {
    const json = buildLegislationJsonLd({
      rule: {
        id: "r",
        citation_path: "us/regulation/7/273",
        heading: "Part 273",
        body: null,
        jurisdiction: "us",
        doc_type: "regulation",
        updated_at: null,
      } as unknown as Parameters<typeof buildLegislationJsonLd>[0]["rule"],
      title: "",
      description: "",
      canonicalUrl: "x",
      citationPath: "us/regulation/7/273",
      jurisdiction: "us",
      docType: "regulation",
    }) as Record<string, unknown>;
    expect(json.legislationType).toBe("Regulation");
  });

  it("maps UK legislation rules to schema.org Act", () => {
    const json = buildLegislationJsonLd({
      rule: {
        id: "r",
        citation_path: "uk/legislation/ukpga/2012/5",
        heading: "Welfare Reform Act",
        body: null,
        jurisdiction: "uk",
        doc_type: "legislation",
        updated_at: null,
      } as unknown as Parameters<typeof buildLegislationJsonLd>[0]["rule"],
      title: "",
      description: "",
      canonicalUrl: "x",
      citationPath: "uk/legislation/ukpga/2012/5",
      jurisdiction: "uk",
      docType: "legislation",
    }) as Record<string, unknown>;
    expect(json.legislationType).toBe("Act");
  });
});

// A body-bearing section: the reader renders it for any suffix below it
// (src/lib/axiom/section-page.ts, ancestor fallback), so the suffix is
// attacker-chosen text the metadata must not carry into URLs.
const SECTION = {
  id: "r1",
  citation_path: "us/statute/26/32",
  heading: "Earned income",
  body: "There shall be allowed a credit...",
  jurisdiction: "us",
  doc_type: "statute",
  updated_at: "2026-01-01",
};
const SECTION_URL = `${AXIOM_APP_URL}/us/statute/26/32`;

/** Answer the metadata lookup from `rows`, as current_provisions would. */
function serveRows(rows: Array<{ citation_path: string }>) {
  mockIn.mockImplementation((_column: string, paths: string[]) =>
    Promise.resolve({
      data: rows.filter((row) => paths.includes(row.citation_path)),
      error: null,
    })
  );
}

describe("reader URLs come from the resolved row", () => {
  it("canonicalizes a suffix with no row of its own to the section it renders", async () => {
    serveRows([SECTION]);
    const meta = await getAxiomRuleMetadata([
      "us",
      "statute",
      "26",
      "32",
      "</script><script>alert(document.domain)</script>",
    ]);
    expect(meta.rule?.id).toBe("r1");
    expect(meta.canonicalUrl).toBe(SECTION_URL);
    expect(meta.title).not.toContain("<");
    const json = buildLegislationJsonLd(meta) as Record<string, unknown>;
    expect(json.url).toBe(SECTION_URL);
    expect(serializeJsonLd(json)).not.toContain("<");
  });

  it("keeps a deeper row's own URL when the suffix names it", async () => {
    serveRows([SECTION, { ...SECTION, id: "r2", citation_path: "us/statute/26/32/a" }]);
    const meta = await getAxiomRuleMetadata(["us", "statute", "26", "32", "a"]);
    expect(meta.rule?.id).toBe("r2");
    expect(meta.canonicalUrl).toBe(`${SECTION_URL}/a`);
  });

  it("encodes the requested path when no row matches", async () => {
    serveRows([]);
    const meta = await getAxiomRuleMetadata(["us", "statute", "99", "<b>?x#y"]);
    expect(meta.rule).toBeNull();
    expect(meta.canonicalUrl).toBe(
      `${AXIOM_APP_URL}/us/statute/99/%3Cb%3E%3Fx%23y`
    );
    expect(buildLegislationJsonLd(meta)).toBeNull();
  });

  it("for any suffix and any corpus text, JSON-LD and canonical name only the section, and never spell </script", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(hostileString, { minLength: 1, maxLength: 4 }),
        hostileString,
        hostileString,
        async (suffix, heading, body) => {
          serveRows([{ ...SECTION, heading, body }]);
          const meta = await getAxiomRuleMetadata([
            "us",
            "statute",
            "26",
            "32",
            ...suffix,
          ]);
          expect(meta.canonicalUrl).toBe(SECTION_URL);
          const json = buildLegislationJsonLd(meta) as Record<string, unknown>;
          expect(json.url).toBe(SECTION_URL);
          const out = serializeJsonLd(json);
          expect(out).not.toMatch(/<\/script/i);
          expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(json)));
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("citationUrl", () => {
  it("joins plain segments under the app URL", () => {
    expect(citationUrl("us/statute/26/32")).toBe(SECTION_URL);
    expect(citationUrl("")).toBe(AXIOM_APP_URL);
    expect(citationUrl("/us//statute/")).toBe(`${AXIOM_APP_URL}/us/statute`);
  });

  it("encodes the en dash the corpus uses for lettered USC sections", () => {
    expect(citationUrl("us/statute/42/1396u\u20131")).toBe(
      `${AXIOM_APP_URL}/us/statute/42/1396u%E2%80%931`
    );
  });

  it("gives one URL for the encoded and decoded spellings of a path", () => {
    expect(citationUrl("us/statute/42/1396u%E2%80%931")).toBe(
      citationUrl("us/statute/42/1396u\u20131")
    );
    expect(citationUrl("us/x/%3C%2Fscript%3E")).toBe(
      `${AXIOM_APP_URL}/us/x/%3C%2Fscript%3E`
    );
  });

  // Every segment, whatever it holds, becomes exactly one URL path level
  // made only of characters a URL path and HTML both read literally.
  const segmentText = fc.oneof(hostileString, fc.string({ unit: "binary" }));

  it("emits one inert path level per input segment, for any segments", () => {
    fc.assert(
      fc.property(fc.array(segmentText, { maxLength: 6 }), (segments) => {
        const url = citationUrl(segments.join("/"));
        const levels = segments.join("/").split("/").filter(Boolean).length;
        expect(url.startsWith(AXIOM_APP_URL)).toBe(true);
        const path = url.slice(AXIOM_APP_URL.length);
        expect(path).toMatch(/^(\/[A-Za-z0-9\-_.!~*'()%]+)*$/);
        expect(path.split("/").filter(Boolean)).toHaveLength(levels);
      }),
      { numRuns: 500 }
    );
  });

  it("is idempotent: re-encoding its own path changes nothing", () => {
    fc.assert(
      fc.property(fc.array(segmentText, { maxLength: 6 }), (segments) => {
        const url = citationUrl(segments.join("/"));
        expect(citationUrl(url.slice(AXIOM_APP_URL.length))).toBe(url);
      }),
      { numRuns: 500 }
    );
  });
});

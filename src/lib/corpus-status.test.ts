import { afterEach, describe, expect, it, vi } from "vitest";
import {
  documentRootFor,
  getEncodingStatus,
  getRecentCorpusScopes,
  groupRecentScopes,
  ingestPlace,
  versionDate,
  supabaseRestUrl,
  type SupabaseRestConfig,
} from "./corpus-status";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubSupabaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
}

describe("corpus status helpers", () => {
  it("builds schema REST URLs for Supabase status reads", () => {
    const config: SupabaseRestConfig = {
      url: "https://example.supabase.co",
      anonKey: "anon-key",
    };

    expect(
      supabaseRestUrl(config, "encoding_runs", {
        select: "id,timestamp",
        order: "timestamp.desc",
        limit: "12",
      })
    ).toBe(
      "https://example.supabase.co/rest/v1/encoding_runs?select=id%2Ctimestamp&order=timestamp.desc&limit=12"
    );
    expect(
      supabaseRestUrl({ ...config, url: "https://example.supabase.co/" }, "encoding_runs", {})
    ).toBe("https://example.supabase.co/rest/v1/encoding_runs");
  });
});

describe("documentRootFor", () => {
  it("takes the shallowest parentless node with a heading of its own above a path", () => {
    // The corpus leaves IRC sections without a parent beside the code itself.
    const irc = new Map([
      ["us/statute/26", true],
      ["us/statute/26/32", true],
    ]);
    expect(documentRootFor("us/statute/26/32", irc)).toBe("us/statute/26");
    expect(documentRootFor("us/statute/26/63/c/6", irc)).toBe("us/statute/26");
    // A stray headless part is not its own document.
    expect(
      documentRootFor("us/regulation/42/435/603/b", new Map([["us/regulation/42/435", true], ["us/regulation/42/435/603/b", false]]))
    ).toBe("us/regulation/42/435");
    // A headless folder of documents gives way to the document under it that has a heading.
    const faa5 = new Map([
      ["us-az/manual/des/faa5", false],
      ["us-az/manual/des/faa5/na-categorical-eligibility", true],
    ]);
    expect(documentRootFor("us-az/manual/des/faa5/na-categorical-eligibility/block-3", faa5)).toBe(
      "us-az/manual/des/faa5/na-categorical-eligibility"
    );
    expect(documentRootFor("us-az/manual/des/faa5", faa5)).toBe("us-az/manual/des/faa5");
    // Only on a "/" boundary, and nothing when no node is above it.
    expect(documentRootFor("us/statute/261/1", irc)).toBeNull();
  });
});

describe("getEncodingStatus", () => {
  it("reads encoding runs, live runs and citation labels from Supabase", async () => {
    stubSupabaseEnv();
    const fetchMock = vi.fn(mockSupabaseFetch);
    vi.stubGlobal("fetch", fetchMock);

    const status = await getEncodingStatus();

    expect(status.key).toBe("supabase://encodings.encoding_runs");
    expect(status.source).toBe("supabase");
    expect(status.error).toBeNull();
    // /ops reads only these fields; nothing else is fetched for it.
    expect(Object.keys(status.value ?? {}).sort()).toEqual([
      "citation_document_paths",
      "citation_labels",
      "latest_runs",
      "live_runs",
      "refreshed_at",
    ]);
    const supabaseTables = fetchMock.mock.calls
      .map(([input]) => new URL(input.toString()))
      .filter((url) => url.hostname === "example.supabase.co")
      .map((url) => url.pathname.replace("/rest/v1/", ""))
      .sort();
    expect(supabaseTables).toEqual([
      "current_provisions",
      "encoding_runs",
      "live_encoding_runs",
      "navigation_nodes",
    ]);
    expect(status.value?.latest_runs.map((run) => run.id)).toEqual([
      "enc-1",
      "enc-2",
    ]);
    // Live runs surface, and their citations resolve labels via the
    // provisions-heading fallback (the navigation node's label is blank).
    expect(status.value?.live_runs).toHaveLength(1);
    expect(status.value?.live_runs[0]?.runner?.reported_via).toBe(
      "public_ingest"
    );
    expect(status.value?.citation_labels).toEqual({
      "us-ms/statute/27-7-5": "Rate of tax",
    });
  });

  it("resolves document roots from parent metadata across different path depths", async () => {
    stubSupabaseEnv();
    const roots = [
      "us/guidance/agency/publication",
      "us/guidance/agency/office/other-publication",
    ];
    const citations = roots.map((root) => root.replace("/", ":") + "/page-1");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (
          url.pathname.endsWith("/encoding_runs") &&
          url.searchParams.get("select")?.includes("citation")
        ) {
          return Promise.resolve(
            jsonResponse(
              citations.map((citation, i) => ({ id: String(i), citation })),
            ),
          );
        }
        if (url.pathname.endsWith("/current_provisions")) {
          return Promise.resolve(
            jsonResponse(
              roots.flatMap((root, i) => [
                {
                  citation_path: root,
                  heading: `Official publication ${i}`,
                  parent_id: null,
                },
                {
                  citation_path: `${root}/page-1`,
                  heading: "Page 1",
                  parent_id: `root-${i}`,
                },
              ]),
            ),
          );
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const result = await getEncodingStatus({ fresh: true });
    expect(result.value?.citation_document_paths).toEqual(
      Object.fromEntries(citations.map((citation, i) => [citation, roots[i]])),
    );
    expect(result.value?.citation_labels?.[roots[1]]).toBe(
      "Official publication 1",
    );
  });

  it("keeps encoding status when the best-effort live and label reads fail", async () => {
    stubSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        if (/\/(live_encoding_runs|navigation_nodes|current_provisions)$/.test(url.pathname)) {
          return Promise.resolve(jsonResponse({ message: "down" }, { status: 503 }));
        }
        if (
          url.pathname.endsWith("/encoding_runs") &&
          url.searchParams.get("select")?.includes("citation")
        ) {
          return Promise.resolve(
            jsonResponse([
              { id: "parsed", citation: "us-ms/statute/27-7-5", has_issues: false },
              { id: "unparsed", citation: "not a citation", has_issues: false },
            ])
          );
        }
        return mockSupabaseFetch(input);
      })
    );

    const status = await getEncodingStatus();

    expect(status.error).toBeNull();
    expect(status.value?.latest_runs.map((run) => run.id)).toEqual([
      "parsed",
      "unparsed",
    ]);
    expect(status.value?.live_runs).toEqual([]);
    expect(status.value?.citation_labels).toEqual({});
    expect(status.value?.citation_document_paths).toEqual({});
  });

  it("reports missing Supabase configuration without fetching", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const fetchMock = vi.fn(mockSupabaseFetch);
    vi.stubGlobal("fetch", fetchMock);

    const status = await getEncodingStatus();

    expect(status.source).toBeNull();
    expect(status.value).toBeNull();
    expect(status.error).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures Supabase read failures", async () => {
    stubSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ message: "bad" }, { status: 500 })))
    );

    const status = await getEncodingStatus();

    expect(status.value).toBeNull();
    expect(status.error).toMatch(/Supabase returned 500/);
  });

  it("captures malformed Supabase row payloads", async () => {
    stubSupabaseEnv();
    vi.stubGlobal("fetch", vi.fn(mockMalformedSupabaseFetch));

    const status = await getEncodingStatus();

    expect(status.value).toBeNull();
    expect(status.error).toMatch(/non-array payload/);
  });

  it("redacts credentials from read errors", async () => {
    stubSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.reject(
          new Error(
            'Headers.append: "Bearer anon-key.secret-part" is an invalid header value; "AWS4-HMAC-SHA256 Credential=access-key/20260504/auto/s3/aws4_request, SignedHeaders=host, Signature=abc123"'
          )
        )
      )
    );

    const status = await getEncodingStatus();

    expect(status.error).toContain("Bearer [redacted]");
    expect(status.error).toContain("AWS4-HMAC-SHA256 Credential=[redacted]");
    expect(status.error).not.toContain("anon-key.secret-part");
    expect(status.error).not.toContain("access-key");
    expect(status.error).not.toContain("abc123");

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject("Bearer thrown-string-token")));
    expect((await getEncodingStatus()).error).toBe("Bearer [redacted]");
  });
});

describe("getRecentCorpusScopes", () => {
  it("returns the newest release scopes and empty on missing config", async () => {
    vi.unstubAllEnvs();
    expect(await getRecentCorpusScopes()).toEqual([]);

    stubSupabaseEnv();
    vi.stubGlobal("fetch", vi.fn(mockSupabaseFetch));
    const scopes = await getRecentCorpusScopes();
    expect(scopes).toHaveLength(3);
    expect(scopes[0]).toMatchObject({
      jurisdiction: "us",
      document_class: "guidance",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: true }, { status: 500 }))
    );
    expect(await getRecentCorpusScopes()).toEqual([]);
  });
});

function mockSupabaseFetch(input: RequestInfo | URL) {
  const url = new URL(input.toString());

  if (url.hostname === "example.supabase.co") {
    if (url.pathname.endsWith("/current_release_scopes")) {
      return Promise.resolve(
        jsonResponse([
          {
            release_name: "current",
            jurisdiction: "us",
            document_class: "guidance",
            version: "2026-05-01-snap-fy2026-cola",
            synced_at: "2026-05-01T12:00:00.000Z",
          },
          {
            release_name: "current",
            jurisdiction: "us",
            document_class: "guidance",
            version: "2026-05-02-irs-rev-proc-2025-32",
            synced_at: "2026-05-02T12:00:00.000Z",
          },
          {
            release_name: "current",
            jurisdiction: "us-co",
            document_class: "statute",
            version: "2026-04-29",
            synced_at: "2026-04-29T12:00:00.000Z",
          },
        ])
      );
    }

    if (url.pathname.endsWith("/navigation_nodes")) {
      return Promise.resolve(
        jsonResponse([
          { path: "us-ms/statute/27-7-5", label: "   " },
          { path: "us-ms/statute", label: null },
        ])
      );
    }

    if (url.pathname.endsWith("/live_encoding_runs")) {
      return Promise.resolve(
        jsonResponse([
          {
            id: "live-1",
            citation: "us-ms/statute/27-7-5",
            status: "failed",
            started_at: "2026-05-03T12:30:00.000Z",
            last_heartbeat_at: "2026-05-03T12:31:00.000Z",
            finished_at: "2026-05-03T12:31:00.000Z",
            phase: null,
            attempt: 4,
            backend: "openai",
            model: "gpt-5.4",
            encoder_version: "0.4.2",
            run_id: null,
            runner: { hostname: "ci-1", reported_via: "public_ingest" },
          },
        ])
      );
    }

    if (
      url.pathname.endsWith("/current_provisions") &&
      url.searchParams.get("select") === "citation_path,heading,parent_id"
    ) {
      return Promise.resolve(
        jsonResponse([
          { citation_path: "us-ms/statute/27-7-5", heading: "Rate of tax", parent_id: null },
          { citation_path: null, heading: "orphan heading" },
          { citation_path: "us-ms/statute/27-7-5", heading: "duplicate" },
        ])
      );
    }

    if (url.pathname.endsWith("/encoding_runs")) {
      return Promise.resolve(
        jsonResponse([
          {
            id: "enc-1",
            timestamp: "2026-05-03T12:00:00.000Z",
            citation: "C.R.S. 26-2-703",
            total_duration_ms: 125000,
            agent_type: "encoder",
            agent_model: "gpt-5.4",
            data_source: "reviewer_agent",
            has_issues: false,
            session_id: "sdk-1",
            encoder_version: "0.4.2",
          },
          {
            id: "enc-2",
            timestamp: "2026-05-03T11:00:00.000Z",
            citation: "C.R.S. 26-2-704",
            total_duration_ms: 85000,
            agent_type: "encoder",
            agent_model: "gpt-5.4",
            data_source: null,
            has_issues: false,
            session_id: null,
            encoder_version: "0.4.2",
          },
        ])
      );
    }
  }

  return Promise.resolve(jsonResponse({ message: "not found" }, { status: 404 }));
}

function mockMalformedSupabaseFetch(input: RequestInfo | URL) {
  const url = new URL(input.toString());
  if (url.hostname === "example.supabase.co") {
    return Promise.resolve(jsonResponse({ rows: [] }));
  }
  return Promise.resolve(jsonResponse({ message: "not found" }, { status: 404 }));
}

function jsonResponse(value: unknown, options: { status?: number } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  return new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers,
  });
}

describe("groupRecentScopes", () => {
  const scope = (jurisdiction: string, document_class: string, version: string) => ({
    jurisdiction,
    document_class,
    version,
  });

  it("makes one entry per place, newest place first, with its days newest first", () => {
    const places = groupRecentScopes([
      scope("us-co", "regulation", "2026-10-12-w7-state-benefits-regulation-co"),
      scope("us", "statute", "2026-10-12-w7-federal-usc-closure-title-26"),
      scope("us", "form", "2026-10-06-w6-federal-irs-forms"),
      scope("us-co", "statute", "2026-09-15-co-statutes"),
      scope("uk-wakefield", "policy", "2026-09-05-uk-councils-wakefield"),
      scope("uk-leeds", "policy", "2026-09-05-uk-councils-leeds"),
      scope("be-bru", "statute", "2026-07-10-be-regions"),
    ]);
    expect(
      places.map((p) => [p.place, p.days.map((d) => [d.day, d.scopes.length])]),
    ).toEqual([
      ["us", [["2026-10-12", 1], ["2026-10-06", 1]]],
      ["us-co", [["2026-10-12", 1], ["2026-09-15", 1]]],
      ["uk", [["2026-09-05", 2]]],
      ["be", [["2026-07-10", 1]]],
    ]);
    expect(places[2].days[0].scopes.map((s) => s.jurisdiction)).toEqual(["uk-leeds", "uk-wakefield"]);
    const [federal] = groupRecentScopes([
      scope("us", "statute", "2026-10-12-w7-usc-title-26"),
      scope("us", "statute", "2026-10-12-w7-usc-title-8"),
    ]);
    expect(federal.days[0].scopes.map((s) => s.version)).toEqual([
      "2026-10-12-w7-usc-title-8",
      "2026-10-12-w7-usc-title-26",
    ]);
  });

  it("keeps each place's newest days and skips versions without a date", () => {
    const [place] = groupRecentScopes(
      [
        scope("us", "form", "2026-10-12-a"),
        scope("us-ky", "form", "2026-740-es"),
        scope("us", "form", "2026-10-11-b"),
        scope("us", "form", "2026-10-10-c"),
      ],
      2,
    );
    expect(place.days.map((d) => d.day)).toEqual(["2026-10-12", "2026-10-11"]);
    expect(versionDate("2026-740-es")).toBeNull();
    expect(versionDate("2026-10-12-w7-x")).toBe("2026-10-12");
    expect(["us", "us-co", "us-co-denver", "uk-wakefield", "dk"].map(ingestPlace)).toEqual([
      "us",
      "us-co",
      "us-co",
      "uk",
      "dk",
    ]);
  });
});

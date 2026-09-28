import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildR2GetRequest,
  countFromContentRange,
  corpusKeyFromPath,
  getCorpusStatus,
  provisionCountsKeyFromCompletionReports,
  provisionCountsKeyFromStateReport,
  supabaseRestUrl,
  type R2Config,
  type SupabaseRestConfig,
  getRecentCorpusScopes,
  getEncodingStatus,
} from "./corpus-status";

const stateReport = {
  complete: false,
  expected_jurisdiction_count: 51,
  productionized_and_validated_count: 14,
  unfinished_count: 37,
  release: "current",
  status_counts: {},
  rows: [],
  unfinished_jurisdictions: [],
  validation_report_ok: true,
  validation_report_path: null,
  supabase_counts_path: "data/corpus/snapshots/provision-counts-test.json",
};

const regulationReport = {
  complete: false,
  document_class: "regulation",
  expected_jurisdiction_count: 52,
  productionized_and_validated_count: 3,
  unfinished_count: 49,
  release: "current",
  status_counts: {},
  rows: [],
  unfinished_jurisdictions: [],
  validation_report_ok: true,
  validation_report_path: null,
  supabase_counts_path:
    "data/corpus/snapshots/provision-counts-regulation-test.json",
};

const artifactReport = {
  release: "current",
  scope_count: 1,
  release_scope_count: 1,
  local_count: 2,
  remote_count: 2,
  local_bytes: 10,
  remote_bytes: 10,
  mismatch_count: 0,
  supabase_group_count: 1,
  supabase_mismatch_count: 0,
  rows: [],
};

const validationReport = {
  ok: true,
  release: "current",
  scope_count: 1,
  error_count: 0,
  warning_count: 0,
  issue_count: 0,
  issues_truncated: false,
  issues: [],
};

const provisionCounts = {
  refreshed_at: "2026-05-03T12:00:00.000Z",
  rows: [],
};

const sourceDiscovery = {
  generated_at: "2026-05-11T12:00:00.000Z",
  source_name: "policyengine-us",
  input_paths: ["sources/policyengine-us/state_references.txt"],
  raw_url_count: 3267,
  invalid_url_count: 0,
  unique_url_count: 1752,
  release: "current",
  release_scope_count: 55,
  ready_for_manifest_count: 609,
  needs_review_count: 780,
  blocked_or_excluded_count: 363,
  release_scope_present_count: 130,
  source_status_counts: {
    primary_official: 609,
    secondary_mirror: 300,
  },
  disposition_counts: {
    ready_for_manifest: 609,
    needs_review: 780,
  },
  document_class_counts: {
    form: 400,
    statute: 100,
  },
  jurisdiction_counts: {
    us: 100,
    "us-ca": 39,
  },
  domain_rows: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("corpus status helpers", () => {
  it("normalizes local data/corpus paths to artifact keys", () => {
    expect(
      corpusKeyFromPath("data/corpus/analytics/state-statute-completion-current.json")
    ).toBe("analytics/state-statute-completion-current.json");
    expect(
      corpusKeyFromPath(
        "/Users/maxghenis/TheAxiomFoundation/axiom-corpus/data/corpus/snapshots/provision-counts-2026-05-02.json"
      )
    ).toBe("snapshots/provision-counts-2026-05-02.json");
  });

  it("derives provision count snapshot keys from the state completion report", () => {
    expect(
      provisionCountsKeyFromStateReport({
        complete: false,
        expected_jurisdiction_count: 51,
        productionized_and_validated_count: 14,
        unfinished_count: 37,
        release: "current",
        status_counts: {},
        rows: [],
        unfinished_jurisdictions: [],
        validation_report_ok: true,
        validation_report_path: null,
        supabase_counts_path:
          "data/corpus/snapshots/provision-counts-2026-05-02.json",
      })
    ).toBe("snapshots/provision-counts-2026-05-02.json");
  });

  it("derives provision count snapshot keys from ordered completion reports", () => {
    expect(
      provisionCountsKeyFromCompletionReports(regulationReport, stateReport)
    ).toBe("snapshots/provision-counts-regulation-test.json");
    expect(provisionCountsKeyFromCompletionReports(null, stateReport)).toBe(
      "snapshots/provision-counts-test.json"
    );
  });

  it("builds an authenticated R2 GET request without placing secrets in the URL", () => {
    const config: R2Config = {
      endpoint: "https://example.r2.cloudflarestorage.com",
      bucket: "axiom-corpus",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    };

    const request = buildR2GetRequest(
      config,
      "analytics/state statute completion.json",
      new Date("2026-05-03T12:34:56.000Z")
    );

    expect(request.url).toBe(
      "https://example.r2.cloudflarestorage.com/axiom-corpus/analytics/state%20statute%20completion.json"
    );
    expect(request.url).not.toContain("secret-key");
    expect(request.headers["x-amz-date"]).toBe("20260503T123456Z");
    expect(request.headers.Authorization).toContain(
      "Credential=access-key/20260503/auto/s3/aws4_request"
    );
    expect(request.headers.Authorization).toContain("Signature=");
  });

  it("trims R2 credentials before building signed headers", () => {
    const config: R2Config = {
      endpoint: "https://example.r2.cloudflarestorage.com/",
      bucket: "axiom-corpus\n",
      accessKeyId: "access-key\n",
      secretAccessKey: "secret-key\n",
    };

    const request = buildR2GetRequest(
      config,
      "analytics/state-statute-completion-current.json",
      new Date("2026-05-03T12:34:56.000Z")
    );

    expect(request.url).toBe(
      "https://example.r2.cloudflarestorage.com/axiom-corpus/analytics/state-statute-completion-current.json"
    );
    expect(request.headers.Authorization).not.toContain("\n");
    expect(request.headers.Authorization).toContain(
      "Credential=access-key/20260503/auto/s3/aws4_request"
    );
  });

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
  });

  it("resolves document roots from parent metadata across different path depths", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
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
        return Promise.resolve(jsonResponse([], { contentRange: "0-0/0" }));
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

  it("parses exact Supabase counts from content-range", () => {
    expect(countFromContentRange("0-0/42")).toBe(42);
    expect(countFromContentRange("*/0")).toBe(0);
    expect(countFromContentRange("malformed")).toBeNull();
    expect(countFromContentRange(null)).toBeNull();
  });

  it("loads corpus artifacts from a status URL and encoding status from Supabase", async () => {
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "https://status.example/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "github-token");
    vi.stubEnv("AXIOM_COMPILED_ARTIFACT_REPOS", "axiom-programs");
    vi.stubGlobal("fetch", vi.fn(mockStatusFetch));

    const status = await getCorpusStatus();

    expect(status.stateStatutes.source).toBe("status-url");
    expect(status.regulations.source).toBe("status-url");
    expect(status.provisionCounts.key).toBe(
      "snapshots/provision-counts-regulation-test.json"
    );
    expect(status.encodingStatus.source).toBe("supabase");
    expect(status.encodingStatus.value?.run_count).toBe(42);
    expect(status.encodingStatus.value?.recent_run_count).toBe(5);
    expect(status.encodingStatus.value?.issue_run_count).toBe(1);
    expect(status.encodingStatus.value?.active_session_count).toBe(1);
    expect(status.encodingStatus.value?.earliest_run_at).toBe(
      "2026-05-03T12:00:00.000Z"
    );
    expect(status.encodingStatus.value?.latest_source_counts).toEqual({
      reviewer_agent: 1,
      unknown: 1,
    });
    // Live runs surface, and their citations resolve labels via the
    // provisions-heading fallback (the navigation node's label is blank).
    expect(status.encodingStatus.value?.live_runs).toHaveLength(1);
    expect(status.encodingStatus.value?.live_runs[0]?.runner?.reported_via).toBe(
      "public_ingest"
    );
    expect(status.encodingStatus.value?.citation_labels).toEqual({
      "us-ms/statute/27-7-5": "Rate of tax",
    });
    expect(status.corpusStats?.source).toBe("supabase");
    expect(status.corpusStats?.value?.document_classes).toEqual([
      {
        document_class: "statute",
        count: 2161435,
        body_count: 1874670,
        top_level_count: 4102,
        rulespec_count: 0,
        refreshed_at: "2026-06-07T15:26:49.300257+00:00",
      },
      {
        document_class: "regulation",
        count: 659947,
        body_count: 566047,
        top_level_count: 8494,
        rulespec_count: 0,
        refreshed_at: "2026-06-07T15:26:49.300257+00:00",
      },
    ]);
    expect(status.rulespecRepoActivity?.source).toBe("github");
    expect(status.rulespecRepoActivity?.value?.repo_count).toBe(1);
    expect(status.rulespecRepoActivity?.value?.rulespec_count).toBe(2);
    expect(status.rulespecRepoActivity?.value?.test_count).toBe(1);
    expect(status.rulespecRepoActivity?.value?.corpus_provision_file_count).toBe(1);
    expect(status.rulespecRepoActivity?.value?.rows[0]).toMatchObject({
      name: "rulespec-nz",
      rulespec_count: 2,
      latest_commit: {
        author: "Max Ghenis",
        message: "Encode NZ taxable income core",
      },
    });
    expect(status.compiledArtifacts?.source).toBe("github");
    expect(status.compiledArtifacts?.value?.artifact_count).toBe(2);
    expect(status.compiledArtifacts?.value?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repo: "axiom-programs",
          path: "artifacts/uk/universal-credit/fy-2026-27.compiled.json",
          package_id: "universal-credit/fy-2026-27",
          package_type: "compiled-runtime",
          has_manifest: true,
          has_rulespec_bundle: true,
          latest_commit: expect.objectContaining({
            author: "Pavel Makarchuk",
            message: "Update UK Universal Credit compiled package",
          }),
        }),
        expect.objectContaining({
          repo: "axiom-programs",
          path: ".axiom/encoding-manifests/policies/example/snap.json",
          package_id: "policies/example/snap",
          package_type: "applied-rulespec",
          has_manifest: true,
          has_rulespec_bundle: true,
          latest_commit: null,
        }),
      ])
    );
  });

  it("rebuilds the release artifact report from Supabase when the status artifact is absent", async () => {
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "https://status.example/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("fetch", vi.fn(mockMissingArtifactReportFetch));

    const status = await getCorpusStatus();

    expect(status.artifactReport.source).toBe("supabase");
    expect(status.artifactReport.value?.counts_mode).toBe("live");
    expect(status.artifactReport.value?.rows).toEqual([
      expect.objectContaining({
        jurisdiction: "us",
        document_class: "guidance",
        version: "2026-05-01-snap-fy2026-cola",
        provision_count: 3,
        source_count: null,
        local_complete: null,
        coverage_complete: null,
        r2_complete: true,
        supabase_count: 3,
        supabase_matches_provisions: null,
      }),
      expect.objectContaining({
        jurisdiction: "us",
        document_class: "guidance",
        version: "2026-05-02-irs-rev-proc-2025-32",
        provision_count: 37,
        source_count: null,
        local_complete: null,
        coverage_complete: null,
        r2_complete: true,
        supabase_count: 37,
        supabase_matches_provisions: null,
      }),
      expect.objectContaining({
        jurisdiction: "us-co",
        document_class: "statute",
        version: "2026-04-29",
        provision_count: null,
        source_count: null,
        r2_complete: true,
        supabase_count: null,
        supabase_matches_provisions: null,
        mismatch_reasons: ["exact_scope_count_unavailable"],
      }),
    ]);
    expect(status.artifactReport.value?.supabase_group_count).toBe(2);
    expect(status.artifactReport.value?.supabase_mismatch_count).toBe(1);
    expect(status.artifactReport.value?.local_count).toBe(0);
  });

  it("loads corpus artifacts from a local root when no remote source is configured", async () => {
    const root = path.join(tmpdir(), `axiom-corpus-status-${crypto.randomUUID()}`);
    await writeJson(
      path.join(root, "analytics/state-statute-completion-current.json"),
      stateReport
    );
    await writeJson(
      path.join(root, "analytics/regulation-completion-current.json"),
      regulationReport
    );
    await writeJson(
      path.join(root, "analytics/artifact-report-current-r2.json"),
      artifactReport
    );
    await writeJson(
      path.join(root, "analytics/validate-release-current.json"),
      validationReport
    );
    await writeJson(
      path.join(root, "analytics/source-discovery-current.json"),
      sourceDiscovery
    );
    await writeJson(
      path.join(root, "snapshots/provision-counts-regulation-test.json"),
      provisionCounts
    );
    vi.stubEnv("AXIOM_CORPUS_LOCAL_ROOT", root);
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "");
    vi.stubEnv("AXIOM_CORPUS_R2_ENDPOINT", "");
    vi.stubEnv("AXIOM_CORPUS_R2_BUCKET", "");
    vi.stubEnv("AXIOM_CORPUS_R2_ACCESS_KEY_ID", "");
    vi.stubEnv("AXIOM_CORPUS_R2_SECRET_ACCESS_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    try {
      const status = await getCorpusStatus();

      expect(status.stateStatutes.source).toBe("local");
      expect(status.regulations.source).toBe("local");
      expect(status.sourceDiscovery.value?.ready_for_manifest_count).toBe(609);
      expect(status.artifactReport.value?.local_count).toBe(2);
      expect(status.encodingStatus.value).toBeNull();
      expect(status.encodingStatus.error).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("loads corpus artifacts from R2 when R2 credentials are configured", async () => {
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "");
    vi.stubEnv("AXIOM_CORPUS_R2_ENDPOINT", "https://r2.example.com");
    vi.stubEnv("AXIOM_CORPUS_R2_BUCKET", "axiom-corpus");
    vi.stubEnv("AXIOM_CORPUS_R2_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("AXIOM_CORPUS_R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubGlobal("fetch", vi.fn(mockR2Fetch));

    const status = await getCorpusStatus();

    expect(status.stateStatutes.source).toBe("r2");
    expect(status.regulations.source).toBe("r2");
    expect(status.validationReport.value?.ok).toBe(true);
    expect(status.provisionCounts.source).toBe("r2");
  });

  it("falls through to local artifacts when a status URL read fails", async () => {
    const root = path.join(tmpdir(), `axiom-corpus-status-${crypto.randomUUID()}`);
    await writeJson(
      path.join(root, "analytics/state-statute-completion-current.json"),
      stateReport
    );
    await writeJson(
      path.join(root, "analytics/regulation-completion-current.json"),
      regulationReport
    );
    await writeJson(
      path.join(root, "analytics/artifact-report-current-r2.json"),
      artifactReport
    );
    await writeJson(
      path.join(root, "analytics/validate-release-current.json"),
      validationReport
    );
    await writeJson(
      path.join(root, "analytics/source-discovery-current.json"),
      sourceDiscovery
    );
    await writeJson(
      path.join(root, "snapshots/provision-counts-regulation-test.json"),
      provisionCounts
    );
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "https://status.example/");
    vi.stubEnv("AXIOM_CORPUS_LOCAL_ROOT", root);
    vi.stubEnv("AXIOM_CORPUS_R2_ENDPOINT", "");
    vi.stubEnv("AXIOM_CORPUS_R2_BUCKET", "");
    vi.stubEnv("AXIOM_CORPUS_R2_ACCESS_KEY_ID", "");
    vi.stubEnv("AXIOM_CORPUS_R2_SECRET_ACCESS_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({}, { status: 503 })))
    );

    try {
      const status = await getCorpusStatus();

      expect(status.stateStatutes.source).toBe("local");
      expect(status.regulations.source).toBe("local");
      expect(status.sourceDiscovery.source).toBe("local");
      expect(status.stateStatutes.error).toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("returns artifact errors when no corpus source is configured", async () => {
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "");
    vi.stubEnv("AXIOM_CORPUS_LOCAL_ROOT", "");
    vi.stubEnv("AXIOM_CORPUS_R2_ENDPOINT", "");
    vi.stubEnv("AXIOM_CORPUS_R2_BUCKET", "");
    vi.stubEnv("AXIOM_CORPUS_R2_ACCESS_KEY_ID", "");
    vi.stubEnv("AXIOM_CORPUS_R2_SECRET_ACCESS_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const status = await getCorpusStatus();

    expect(status.stateStatutes.value).toBeNull();
    expect(status.regulations.value).toBeNull();
    expect(status.sourceDiscovery.value).toBeNull();
    expect(status.stateStatutes.error).toMatch(/AXIOM_CORPUS_LOCAL_ROOT/);
    expect(status.encodingStatus.error).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("captures R2 and Supabase status read failures", async () => {
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "");
    vi.stubEnv("AXIOM_CORPUS_R2_ENDPOINT", "https://r2.example.com");
    vi.stubEnv("AXIOM_CORPUS_R2_BUCKET", "axiom-corpus");
    vi.stubEnv("AXIOM_CORPUS_R2_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("AXIOM_CORPUS_R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("fetch", vi.fn(mockFailureFetch));

    const status = await getCorpusStatus();

    expect(status.stateStatutes.error).toMatch(/R2 returned 404/);
    expect(status.regulations.error).toMatch(/R2 returned 404/);
    expect(status.sourceDiscovery.error).toMatch(/R2 returned 404/);
    expect(status.encodingStatus.error).toMatch(/Supabase returned 500/);
  });

  it("redacts signed R2 request details from status errors", async () => {
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "");
    vi.stubEnv("AXIOM_CORPUS_R2_ENDPOINT", "https://r2.example.com");
    vi.stubEnv("AXIOM_CORPUS_R2_BUCKET", "axiom-corpus");
    vi.stubEnv("AXIOM_CORPUS_R2_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("AXIOM_CORPUS_R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("AXIOM_CORPUS_LOCAL_ROOT", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.reject(
          new Error(
            'Headers.append: "AWS4-HMAC-SHA256 Credential=access-key/20260504/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=abc123" is an invalid header value.'
          )
        )
      )
    );

    const status = await getCorpusStatus();

    expect(status.stateStatutes.error).toContain(
      "AWS4-HMAC-SHA256 Credential=[redacted]"
    );
    expect(status.stateStatutes.error).not.toContain("access-key");
    expect(status.stateStatutes.error).not.toContain("abc123");
  });

  it("captures malformed Supabase row payloads", async () => {
    vi.stubEnv("AXIOM_CORPUS_STATUS_BASE_URL", "https://status.example/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("fetch", vi.fn(mockMalformedSupabaseFetch));

    const status = await getCorpusStatus();

    expect(status.stateStatutes.source).toBe("status-url");
    expect(status.regulations.source).toBe("status-url");
    expect(status.encodingStatus.error).toMatch(/non-array payload/);
  });
});

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

function mockStatusFetch(input: RequestInfo | URL) {
  const url = new URL(input.toString());

  if (url.hostname === "status.example") {
    const artifacts: Record<string, unknown> = {
      "/analytics/state-statute-completion-current.json": stateReport,
      "/analytics/regulation-completion-current.json": regulationReport,
      "/analytics/artifact-report-current-r2.json": artifactReport,
      "/analytics/validate-release-current.json": validationReport,
      "/analytics/source-discovery-current.json": sourceDiscovery,
      "/snapshots/provision-counts-test.json": provisionCounts,
      "/snapshots/provision-counts-regulation-test.json": provisionCounts,
    };
    const value = artifacts[url.pathname];
    return Promise.resolve(jsonResponse(value ?? {}, { status: value ? 200 : 404 }));
  }

  if (url.hostname === "example.supabase.co") {
    if (url.pathname.endsWith("/rpc/get_corpus_stats")) {
      return Promise.resolve(
        jsonResponse({
          refreshed_at: "2026-06-07T15:26:49.300257+00:00",
          document_classes: [
            {
              document_class: "statute",
              count: 2161435,
              body_count: 1874670,
              top_level_count: 4102,
              rulespec_count: 0,
              refreshed_at: "2026-06-07T15:26:49.300257+00:00",
            },
            {
              document_class: "regulation",
              count: 659947,
              body_count: 566047,
              top_level_count: 8494,
              rulespec_count: 0,
              refreshed_at: "2026-06-07T15:26:49.300257+00:00",
            },
          ],
        })
      );
    }

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

    if (url.pathname.endsWith("/current_provision_counts")) {
      return Promise.resolve(
        jsonResponse([
          {
            jurisdiction: "us",
            document_class: "guidance",
            provision_count: 40,
            body_count: 40,
            top_level_count: 2,
            rulespec_count: 0,
            refreshed_at: "2026-06-07T15:26:49.300257+00:00",
          },
          {
            jurisdiction: "us-co",
            document_class: "statute",
            provision_count: 39920,
            body_count: 39920,
            top_level_count: 1,
            rulespec_count: 0,
            refreshed_at: "2026-06-07T15:26:49.300257+00:00",
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

    if (url.pathname.endsWith("/current_provisions")) {
      if (url.searchParams.get("select") === "citation_path,heading,parent_id") {
        return Promise.resolve(
          jsonResponse([
            { citation_path: "us-ms/statute/27-7-5", heading: "Rate of tax", parent_id: null },
            { citation_path: null, heading: "orphan heading" },
            { citation_path: "us-ms/statute/27-7-5", heading: "duplicate" },
          ])
        );
      }
      const version = url.searchParams.get("version");
      if (version === "eq.2026-04-29") {
        return Promise.resolve(
          jsonResponse(
            { message: "canceling statement due to statement timeout" },
            { status: 500 }
          )
        );
      }
      const count =
        version === "eq.2026-05-01-snap-fy2026-cola"
          ? 3
          : version === "eq.2026-05-02-irs-rev-proc-2025-32"
            ? 37
            : 0;
      return Promise.resolve(jsonResponse([{ id: "provision-1" }], { contentRange: `0-0/${count}` }));
    }

    if (url.pathname.endsWith("/encoding_runs")) {
      if (url.searchParams.get("select") === "id") {
        const count = url.searchParams.has("timestamp")
          ? 5
          : url.searchParams.has("has_issues")
            ? 1
            : 42;
        return Promise.resolve(jsonResponse([], { contentRange: `0-0/${count}` }));
      }
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

    if (url.pathname.endsWith("/sdk_sessions")) {
      if (url.searchParams.get("select") === "id") {
        return Promise.resolve(jsonResponse([], { contentRange: "0-0/1" }));
      }
      return Promise.resolve(
        jsonResponse([
          {
            id: "sdk-1",
            started_at: "2026-05-03T12:00:00.000Z",
            ended_at: null,
            model: "gpt-5.4",
            event_count: 18,
            input_tokens: 1200,
            output_tokens: 800,
            estimated_cost_usd: 0.314,
            encoder_version: "0.4.2",
          },
        ])
      );
    }
  }

  if (url.hostname === "api.github.com") {
    if (url.pathname === "/orgs/TheAxiomFoundation/repos") {
      return Promise.resolve(
        jsonResponse([
          {
            name: "rulespec-nz",
            html_url: "https://github.com/TheAxiomFoundation/rulespec-nz",
            default_branch: "main",
            pushed_at: "2026-06-17T13:23:33Z",
          },
          {
            name: "axiom-encode",
            html_url: "https://github.com/TheAxiomFoundation/axiom-encode",
            default_branch: "main",
            pushed_at: "2026-06-18T08:35:45Z",
          },
        ])
      );
    }
    if (
      url.pathname ===
      "/repos/TheAxiomFoundation/rulespec-nz/git/trees/main"
    ) {
      return Promise.resolve(
        jsonResponse({
          tree: [
            { path: "nz/statutes/income_tax/core/taxable_income.yaml", type: "blob" },
            { path: "nz/statutes/income_tax/core/taxable_income.test.yaml", type: "blob" },
            { path: "nz/regulations/acc/earners_levy.yaml", type: "blob" },
            { path: "data/corpus/provisions/nz/statute/2026-06-17-taxable-income-core.jsonl", type: "blob" },
            { path: "data/coverage/tax-benefit-source-map.json", type: "blob" },
            { path: "data/oracles/oracle-index.json", type: "blob" },
          ],
        })
      );
    }
    if (url.pathname === "/repos/TheAxiomFoundation/rulespec-nz/commits") {
      return Promise.resolve(
        jsonResponse([
          {
            sha: "b918e1a245093b5f06eef9abfc6e80842a2659af",
            html_url:
              "https://github.com/TheAxiomFoundation/rulespec-nz/commit/b918e1a245093b5f06eef9abfc6e80842a2659af",
            commit: {
              author: {
                name: "Max Ghenis",
                date: "2026-06-17T13:23:33Z",
              },
              message: "Encode NZ taxable income core\n\nMore detail",
            },
          },
        ])
      );
    }
    if (url.pathname === "/repos/TheAxiomFoundation/axiom-programs") {
      return Promise.resolve(
        jsonResponse({
          name: "axiom-programs",
          html_url: "https://github.com/TheAxiomFoundation/axiom-programs",
          default_branch: "main",
          pushed_at: "2026-06-10T05:11:09Z",
        })
      );
    }
    if (
      url.pathname ===
      "/repos/TheAxiomFoundation/axiom-programs/git/trees/main"
    ) {
      return Promise.resolve(
        jsonResponse({
          tree: [
            { path: "artifacts/uk/universal-credit/fy-2026-27.compiled.json", type: "blob" },
            { path: "artifacts/uk/universal-credit/fy-2026-27.manifest.json", type: "blob" },
            { path: "artifacts/uk/universal-credit/fy-2026-27.rulespec.yaml", type: "blob" },
            { path: ".axiom/encoding-manifests/policies/example/snap.json", type: "blob" },
          ],
        })
      );
    }
    if (
      url.pathname === "/repos/TheAxiomFoundation/axiom-programs/commits" &&
      url.searchParams.get("path") ===
        "artifacts/uk/universal-credit/fy-2026-27.compiled.json"
    ) {
      return Promise.resolve(
        jsonResponse([
          {
            sha: "abc123456789",
            html_url:
              "https://github.com/TheAxiomFoundation/axiom-programs/commit/abc123456789",
            commit: {
              author: {
                name: "Pavel Makarchuk",
                date: "2026-06-10T05:11:09Z",
              },
              message: "Update UK Universal Credit compiled package",
            },
          },
        ])
      );
    }
  }

  return Promise.resolve(jsonResponse({ message: "not found" }, { status: 404 }));
}

function mockMissingArtifactReportFetch(input: RequestInfo | URL) {
  const url = new URL(input.toString());
  if (
    url.hostname === "status.example" &&
    url.pathname === "/analytics/artifact-report-current-r2.json"
  ) {
    return Promise.resolve(jsonResponse({ message: "missing" }, { status: 404 }));
  }
  return mockStatusFetch(input);
}

function mockR2Fetch(input: RequestInfo | URL) {
  const url = new URL(input.toString());
  const key = url.pathname.replace("/axiom-corpus/", "/");
  const artifacts: Record<string, unknown> = {
    "/analytics/state-statute-completion-current.json": stateReport,
    "/analytics/regulation-completion-current.json": regulationReport,
    "/analytics/artifact-report-current-r2.json": artifactReport,
    "/analytics/validate-release-current.json": validationReport,
    "/analytics/source-discovery-current.json": sourceDiscovery,
    "/snapshots/provision-counts-test.json": provisionCounts,
    "/snapshots/provision-counts-regulation-test.json": provisionCounts,
  };
  const value = artifacts[key];
  return Promise.resolve(jsonResponse(value ?? {}, { status: value ? 200 : 404 }));
}

function mockFailureFetch(input: RequestInfo | URL) {
  const url = new URL(input.toString());
  if (url.hostname === "example.supabase.co") {
    return Promise.resolve(jsonResponse({ message: "bad" }, { status: 500 }));
  }
  return Promise.resolve(jsonResponse({ message: "missing" }, { status: 404 }));
}

function mockMalformedSupabaseFetch(input: RequestInfo | URL) {
  const url = new URL(input.toString());
  if (url.hostname === "example.supabase.co") {
    if (url.searchParams.get("select") === "id") {
      return Promise.resolve(jsonResponse([], { contentRange: "0-0/1" }));
    }
    return Promise.resolve(jsonResponse({ rows: [] }));
  }
  return mockStatusFetch(input);
}

function jsonResponse(
  value: unknown,
  options: { status?: number; contentRange?: string } = {}
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.contentRange) headers.set("content-range", options.contentRange);
  return new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers,
  });
}

describe("getRecentCorpusScopes", () => {
  it("returns the newest release scopes and empty on missing config", async () => {
    vi.unstubAllEnvs();
    expect(await getRecentCorpusScopes()).toEqual([]);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("fetch", vi.fn(mockStatusFetch));
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

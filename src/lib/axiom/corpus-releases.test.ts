import { afterEach, describe, expect, it, vi } from "vitest";
import {
  corpusView,
  getCorpusView,
  parsePin,
  readCorpusView,
  releaseJurisdiction,
  scopeCorpus,
  type ServingPointer,
  type SignedRelease,
} from "./corpus-releases";

vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const release = (name: string, signedAt: string, jurisdictions: string[], scopes = 1): SignedRelease => ({
  name,
  signedAt,
  jurisdictions,
  scopes,
});
const pointer = (release_name: string, activated_at: string, jurisdiction = "x"): ServingPointer => ({
  jurisdiction,
  document_class: "statute",
  release_name,
  activated_at,
});

describe("releaseJurisdiction", () => {
  it("is the scope jurisdiction the name starts with, else the shortest", () => {
    expect(releaseJurisdiction({ name: "us-rulespec-union", jurisdictions: ["us-al", "us", "us-ca"] })).toBe("us");
    expect(releaseJurisdiction({ name: "us-ca-2026-07-28-calfresh", jurisdictions: ["us-ca"] })).toBe("us-ca");
    expect(releaseJurisdiction({ name: "tz-znz-rulespec", jurisdictions: ["tz-znz"] })).toBe("tz-znz");
    expect(releaseJurisdiction({ name: "odd", jurisdictions: ["de-by", "de"] })).toBe("de");
    expect(releaseJurisdiction({ name: "empty", jurisdictions: [] })).toBeNull();
  });
});

describe("parsePin", () => {
  it("reads the pinned corpus release", () => {
    expect(parsePin('# binding\naxiom_corpus_release = "uk-rulespec-2026-09-07"\naxiom_corpus_release_content_sha256 = "x"')).toBe(
      "uk-rulespec-2026-09-07"
    );
    expect(parsePin("axiom_corpus_ref = \"abc\"")).toBeNull();
  });
});

describe("corpusView", () => {
  const releases = [
    // Never activated.
    release("de-rulespec-1", "2026-09-08T00:00:00Z", ["de"], 22),
    release("de-rulespec-2", "2026-09-15T00:00:00Z", ["de"], 62),
    // A newer release signed after the serving one was activated.
    release("us-rulespec-union", "2026-09-14T00:00:00Z", ["us", "us-al"], 1040),
    release("us-rulespec-cola", "2026-09-25T00:00:00Z", ["us"], 273),
    release("us-rulespec-old", "2026-08-08T00:00:00Z", ["us"], 900),
    // Encoder pinned to an older release.
    release("be-rulespec-old", "2026-07-10T00:00:00Z", ["be"]),
    release("be-rulespec-new", "2026-08-23T00:00:00Z", ["be"]),
    // Encoder pinned to a newer release the site does not serve.
    release("dk-rulespec-a", "2026-08-07T00:00:00Z", ["dk"]),
    release("dk-rulespec-b", "2026-08-01T00:00:00Z", ["dk"]),
    // Up to date.
    release("uk-rulespec-1", "2026-09-07T00:00:00Z", ["uk"], 191),
    release("nz-rulespec-1", "2026-07-25T00:00:00Z", ["nz"], 8),
    release("nameless", "2026-07-01T00:00:00Z", []),
  ];
  const pointers = [
    pointer("us-rulespec-union", "2026-09-14T21:00:00Z", "us"),
    pointer("us-rulespec-union", "2026-09-14T22:00:00Z", "us-al"),
    pointer("us-rulespec-union", "2026-09-14T20:00:00Z", "us"),
    pointer("be-rulespec-new", "2026-08-23T21:00:00Z"),
    pointer("dk-rulespec-b", "2026-08-08T00:00:00Z"),
    pointer("uk-rulespec-1", "2026-09-13T00:00:00Z"),
    pointer("nz-rulespec-1", "2026-07-25T00:00:00Z"),
    // A pointer to a release that is not registered keeps its own jurisdiction.
    pointer("ghost", "2026-07-01T00:00:00Z", "zz"),
  ];
  const pins = {
    de: "de-rulespec-1",
    us: "us-rulespec-old",
    be: "be-rulespec-old",
    dk: "dk-rulespec-a",
    uk: "uk-rulespec-1",
    ng: "ng-unregistered",
  };

  it("says per jurisdiction whether serving, the newest release, and the encoder agree", () => {
    const view = corpusView(releases, pointers, pins);
    expect(view.outOfSync).toBe(4);
    expect(view.jurisdictions.map((j) => [j.jurisdiction, j.status])).toEqual([
      ["dk", "encoder_off"],
      ["be", "encoder_behind"],
      ["de", "not_serving"],
      ["us", "newer_not_active"],
      ["nz", "current"],
      ["uk", "current"],
    ]);
    const [dk, be, de, us, nz] = view.jurisdictions;
    expect(de).toMatchObject({
      name: "Germany",
      serving: null,
      newest: { release: "de-rulespec-2", scopes: 62 },
      encoder: { repo: "rulespec-de", release: "de-rulespec-1", registered: true },
      since: "2026-09-08T00:00:00Z",
    });
    expect(us).toMatchObject({
      name: "United States",
      serving: { release: "us-rulespec-union", since: "2026-09-14T22:00:00Z", scopes: 1040 },
      newest: { release: "us-rulespec-cola" },
      since: "2026-09-25T00:00:00Z",
    });
    expect(be).toMatchObject({ status: "encoder_behind", since: "2026-08-23T21:00:00Z" });
    expect(dk).toMatchObject({ status: "encoder_off", since: "2026-08-07T00:00:00Z" });
    expect(nz).toMatchObject({ encoder: null, since: null });
    expect(view).toMatchObject({ openPrs: null, lastPublish: null });
  });

  it("marks a pin that is not a registered release, and tolerates an unknown serving release", () => {
    const view = corpusView(
      [release("ng-rulespec-1", "2026-07-12T00:00:00Z", ["ng"])],
      [pointer("ng-rulespec-1", "2026-07-13T00:00:00Z", "ng"), pointer("ghost", "2026-07-14T00:00:00Z", "ng")],
      { ng: "ng-unregistered" }
    );
    expect(view.jurisdictions[0]).toMatchObject({
      status: "encoder_off",
      serving: { release: "ghost", scopes: 0 },
      encoder: { registered: false },
      since: null,
    });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => value, text: async () => String(value) } as Response;
}

function stubCorpusFetch(overrides: Record<string, Response | Error> = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    for (const [fragment, response] of Object.entries(overrides)) {
      if (url.includes(fragment)) {
        if (response instanceof Error) throw response;
        return response;
      }
    }
    if (url.includes("/release_objects")) {
      return jsonResponse([
        { release_name: "uk-rulespec-1", created_at: "2026-09-07T00:00:00Z", scopes: [{ jurisdiction: "uk" }, {}] },
        { release_name: "de-rulespec-1", created_at: "2026-09-15T00:00:00Z", scopes: null },
      ]);
    }
    if (url.includes("/active_scope_pointer")) return jsonResponse([pointer("uk-rulespec-1", "2026-09-13T00:00:00Z", "uk")]);
    if (url.includes("rulespec-uk/main/.axiom/toolchain.toml")) return jsonResponse('axiom_corpus_release = "uk-rulespec-1"');
    if (url.includes("/search/issues")) return jsonResponse({ total_count: 47, items: [{ created_at: "2026-07-16T19:13:12Z" }] });
    if (url.includes("/publish.yml/runs")) {
      return jsonResponse({
        workflow_runs: [
          { conclusion: "cancelled", created_at: "2026-09-26T00:00:00Z", html_url: "c" },
          { conclusion: "success", created_at: "2026-09-25T00:00:00Z", html_url: "https://github.com/run/1" },
        ],
      });
    }
    return jsonResponse("", 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("readCorpusView", () => {
  it("joins the release tables, the encoder pins, and axiom-corpus activity", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "token");
    const fetchMock = stubCorpusFetch();
    const view = await readCorpusView();
    expect(view.jurisdictions.map((j) => [j.jurisdiction, j.status, j.encoder?.release ?? null])).toEqual([
      ["uk", "current", "uk-rulespec-1"],
    ]);
    expect(view.openPrs).toEqual({
      count: 47,
      oldestAt: "2026-07-16T19:13:12Z",
      url: "https://github.com/TheAxiomFoundation/axiom-corpus/pulls",
    });
    expect(view.lastPublish).toEqual({ conclusion: "success", at: "2026-09-25T00:00:00Z", url: "https://github.com/run/1" });
    const search = fetchMock.mock.calls.find(([url]) => String(url).includes("/search/issues"));
    expect(search?.[1]?.headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("leaves out GitHub parts it cannot read, and fails when the release tables are unreadable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    stubCorpusFetch({
      "/search/issues": jsonResponse({ message: "rate limited" }, 403),
      "/publish.yml/runs": jsonResponse({ workflow_runs: [{ conclusion: "cancelled", created_at: "x", html_url: "y" }] }),
      "toolchain.toml": new Error("offline"),
    });
    const view = await readCorpusView();
    expect(view).toMatchObject({ openPrs: null, lastPublish: null });
    expect(view.jurisdictions[0].encoder).toBeNull();

    stubCorpusFetch({ "/publish.yml/runs": jsonResponse({}, 500), "/release_objects": jsonResponse({}, 500) });
    await expect(readCorpusView()).rejects.toThrow(/500/);
    expect(await getCorpusView()).toBeNull();
  });

  it("needs Supabase", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(readCorpusView()).rejects.toThrow(/not configured/);
    expect(await getCorpusView()).toBeNull();
  });

  it("serves the cached view", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    stubCorpusFetch();
    expect((await getCorpusView())?.outOfSync).toBe(0);
  });
});

describe("scopeCorpus", () => {
  it("keeps one top-level jurisdiction and recounts what is out of sync", () => {
    const view = corpusView(
      [
        release("us-rulespec-1", "2026-09-14T00:00:00Z", ["us", "us-al"]),
        release("us-ca-1", "2026-09-15T00:00:00Z", ["us-ca"]),
        release("uk-rulespec-1", "2026-09-07T00:00:00Z", ["uk"]),
        release("usx-1", "2026-09-07T00:00:00Z", ["usx"]),
      ],
      [pointer("us-rulespec-1", "2026-09-14T01:00:00Z", "us"), pointer("uk-rulespec-1", "2026-09-08T00:00:00Z", "uk")],
      {}
    );
    expect(scopeCorpus(view, null)).toBe(view);
    const us = scopeCorpus(view, "us");
    expect(us.jurisdictions.map((j) => j.jurisdiction).sort()).toEqual(["us", "us-ca"]);
    expect(us.outOfSync).toBe(1);
    expect(scopeCorpus(view, "uk")).toMatchObject({ outOfSync: 0, jurisdictions: [{ jurisdiction: "uk" }] });
  });
});

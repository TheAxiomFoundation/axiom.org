import { afterEach, describe, expect, it, vi } from "vitest";
import {
  corpusView,
  getCorpusView,
  parsePin,
  readCorpusView,
  releaseJurisdiction,
  scopeCorpus,
  type ReleaseScope,
  type ServedScope,
  type ServingPointer,
  type SignedRelease,
} from "./corpus-releases";

vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A scope written "jurisdiction/document_class/version", with its provisions when given. */
const scope = (path: string, provisions?: number): ReleaseScope => {
  const [jurisdiction, document_class, version] = path.split("/");
  return { jurisdiction, document_class, version, ...(provisions === undefined ? {} : { provisions }) };
};
const release = (name: string, signedAt: string, scopes: ReleaseScope[]): SignedRelease => ({
  name,
  signedAt,
  jurisdictions: [...new Set(scopes.map((s) => s.jurisdiction))],
  scopes,
});
const pointer = (release_name: string, activated_at: string, jurisdiction = "x", document_class = "statute"): ServingPointer => ({
  jurisdiction,
  document_class,
  release_name,
  activated_at,
});
/** The served rows of a release's scopes (all of them, or the paths given). */
const serves = (r: SignedRelease, only?: string[]): ServedScope[] =>
  r.scopes
    .filter((s) => !only || only.includes(`${s.jurisdiction}/${s.document_class}/${s.version}`))
    .map((s) => ({ release_name: r.name, jurisdiction: s.jurisdiction, document_class: s.document_class, version: s.version }));

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
    // A placeholder names the key only in a comment.
    expect(parsePin('# Required key 1: axiom_corpus_release = "ch-rulespec-YYYY-MM-DD"\n[toolchain]')).toBeNull();
  });
});

describe("corpusView", () => {
  // The US serves a wide union; a narrow release signed after it would drop most of it.
  const usW6 = release("us-rulespec-w6-union", "2026-10-07T21:16:00Z", [scope("us/statute/2026-07-13-usc"), scope("us-al/manual/2026-09-01-al-snap")]);
  const usW7 = release("us-rulespec-w7-union", "2026-10-13T14:10:00Z", [
    scope("us/statute/2026-07-13-usc", 100),
    scope("us-al/manual/2026-09-01-al-snap", 50),
    scope("us/regulation/2026-10-01-cfr", 30),
  ]);
  const usSnap = release("us-rulespec-snap-memo", "2026-10-13T17:32:00Z", [
    scope("us/statute/2026-07-13-usc"),
    scope("us/guidance/2026-10-13-snap-memo"),
  ]);
  // Belgium's next release re-ingests one served batch with a later date.
  const beOld = release("be-rulespec-old", "2026-07-12T15:30:00Z", [scope("be/statute/2026-07-10-be-source"), scope("be-bru/regulation/2026-07-10-bru")]);
  const beMid = release("be-rulespec-mid", "2026-08-23T21:37:00Z", beOld.scopes);
  const beNew = release("be-rulespec-new", "2026-08-30T01:15:00Z", [scope("be/statute/2026-08-23-be-source"), scope("be-bru/regulation/2026-07-10-bru")]);
  // Denmark's next release keeps what serves and adds guidance; an older one is no successor.
  const dkA = release("dk-rulespec-a", "2026-07-12T20:08:00Z", [scope("dk/statute/2026-07-12-child")]);
  const dkB = release("dk-rulespec-b", "2026-08-07T19:20:00Z", [scope("dk/statute/2026-08-04-tier1", 1922)]);
  const dkC = release("dk-rulespec-c", "2026-08-22T18:32:00Z", [scope("dk/statute/2026-08-04-tier1"), scope("dk/guidance/2026-08-22-g")]);
  // The encoder already reads the next release.
  const ee1 = release("ee-rulespec-1", "2026-09-01T00:00:00Z", [scope("ee/statute/2026-09-01-a")]);
  const ee2 = release("ee-rulespec-2", "2026-09-02T00:00:00Z", [scope("ee/statute/2026-09-01-a"), scope("ee/statute/2026-09-02-b")]);
  // The UK serves from two releases; its pin holds only one's scopes.
  const uk0 = release("uk-rulespec-0", "2026-07-26T13:28:00Z", [scope("uk/statute/2026-07-26-old"), scope("uk-x/regulation/2026-07-26-c", 4)]);
  const uk1 = release("uk-rulespec-1", "2026-09-13T15:08:00Z", [scope("uk/statute/2026-09-01-a", 10), scope("uk/statute/2026-09-01-b", 11)]);
  const nz1 = release("nz-rulespec-1", "2026-07-25T20:22:00Z", [scope("nz/statute/2026-06-16-pco")]);
  const de1 = release("de-rulespec-1", "2026-07-16T00:00:00Z", [scope("de/statute/2026-07-16-a")]);
  const de2 = release("de-rulespec-2", "2026-09-15T00:00:00Z", [scope("de/statute/2026-07-16-a"), scope("de/statute/2026-09-15-b")]);
  const tz1 = release("tz-rulespec-1", "2026-07-16T16:00:00Z", [scope("tz/statute/2026-07-16-a")]);
  const releases = [usW6, usW7, usSnap, beOld, beMid, beNew, dkA, dkB, dkC, ee1, ee2, uk0, uk1, nz1, de1, de2, tz1, release("nameless", "2026-07-01T00:00:00Z", [])];
  const pointers = [
    pointer(usW7.name, "2026-10-13T16:29:00Z", "us"),
    pointer(usW7.name, "2026-10-13T16:29:00Z", "us", "regulation"),
    pointer(usW7.name, "2026-10-13T16:20:00Z", "us-al", "manual"),
    pointer(beMid.name, "2026-08-23T21:44:00Z", "be"),
    pointer(beMid.name, "2026-08-23T21:44:00Z", "be-bru", "regulation"),
    pointer(dkB.name, "2026-08-07T19:39:00Z", "dk"),
    pointer(ee1.name, "2026-09-01T12:00:00Z", "ee"),
    pointer(uk1.name, "2026-09-13T15:28:00Z", "uk"),
    pointer(uk0.name, "2026-07-26T13:30:00Z", "uk-x", "regulation"),
    pointer(nz1.name, "2026-07-25T20:22:00Z", "nz"),
    // A pointer to a release that is not registered keeps its own jurisdiction, which has no row.
    pointer("ghost", "2026-07-01T00:00:00Z", "zy"),
  ];
  const served = [
    ...serves(usW7),
    ...serves(beMid),
    ...serves(dkB),
    ...serves(ee1),
    ...serves(uk1),
    ...serves(uk0, ["uk-x/regulation/2026-07-26-c"]),
    ...serves(nz1),
    { release_name: "ghost", jurisdiction: "zy", document_class: "statute", version: "v" },
  ];
  const pins = {
    us: { release: usSnap.name },
    be: { release: beOld.name },
    dk: { release: dkB.name },
    ee: { release: ee2.name },
    uk: { release: uk1.name },
    nz: { release: nz1.name },
    de: { release: de1.name },
    tz: { release: "tz-rulespec-2", manifest: true },
    bo: { release: "bo-rulespec-2026-07-24-r2", manifest: true },
    ch: { release: null },
    qq: { release: "qq-ghost" },
  };
  const view = corpusView({ releases, pointers, served, pins, repos: ["us", "be", "bo", "ch", "zz"] });
  const row = (jurisdiction: string) => view.jurisdictions.find((r) => r.jurisdiction === jurisdiction)!;

  it("flags every way serving, the next release, and the encoder disagree, oldest first", () => {
    expect(view.jurisdictions.map((r) => [r.jurisdiction, r.flags])).toEqual([
      ["de", ["not_serving"]],
      ["tz", ["not_serving", "pin_unsigned"]],
      ["dk", ["newer_not_active"]],
      ["be", ["newer_not_active", "encoder_other"]],
      ["ee", ["newer_not_active", "encoder_off"]],
      ["uk", ["encoder_lacks"]],
      ["us", ["encoder_lacks"]],
      ["bo", ["pin_unsigned"]],
      ["qq", ["pin_unknown"]],
      ["ch", ["no_release"]],
      ["zz", ["no_release"]],
      ["nz", []],
    ]);
    expect(view.outOfSync).toBe(11);
    expect(view).toMatchObject({ openPrs: null, lastPublish: null });
  });

  it("does not offer a narrow release that would drop served scope versions as the next one", () => {
    expect(row("us")).toMatchObject({
      name: "United States",
      serving: { release: usW7.name, since: "2026-10-13T16:29:00Z", releases: 1, scopes: 3, provisions: 180 },
      newest: { release: usSnap.name, scopes: 2 },
      next: null,
      other: { release: usSnap.name, scopes: 2, lacks: 2 },
      encoder: { repo: "rulespec-us", release: usSnap.name, state: "signed", lacks: 2, extra: 1 },
      // The mismatch began once the pinned release was signed after the activation.
      since: "2026-10-13T17:32:00Z",
    });
  });

  it("names the next release: a later ingest of a served batch stands in for it", () => {
    expect(row("be")).toMatchObject({
      serving: { release: beMid.name, scopes: 2, provisions: null },
      next: { release: beNew.name, adds: 1, scopes: 2 },
      other: null,
      encoder: { release: beOld.name, lacks: 0, extra: 0 },
      since: "2026-08-30T01:15:00Z",
    });
    expect(row("dk")).toMatchObject({
      serving: { provisions: 1922 },
      next: { release: dkC.name, adds: 1 },
      other: null,
      encoder: { lacks: 0, extra: 0 },
    });
    expect(row("ee")).toMatchObject({ next: { release: ee2.name }, encoder: { lacks: 0, extra: 1 } });
  });

  it("compares the pin with every release that serves", () => {
    expect(row("uk")).toMatchObject({
      serving: { release: uk1.name, releases: 2, scopes: 3, provisions: 25 },
      next: null,
      encoder: { lacks: 1, extra: 0 },
      since: "2026-09-13T15:28:00Z",
    });
  });

  it("lists repos with unsigned, unknown, placeholder, or no pins, and does not compare what does not serve", () => {
    expect(row("de")).toMatchObject({
      name: "Germany",
      serving: null,
      newest: { release: de2.name, scopes: 2 },
      next: null,
      encoder: { release: de1.name, state: "signed", lacks: null, extra: null },
      since: "2026-07-16T00:00:00Z",
    });
    expect(row("tz").encoder).toMatchObject({ state: "manifest", release: "tz-rulespec-2" });
    expect(row("bo")).toMatchObject({ name: "Bolivia", serving: null, newest: null, encoder: { state: "manifest" }, since: null });
    expect(row("qq").encoder).toMatchObject({ state: "unknown", release: "qq-ghost" });
    expect(row("ch")).toMatchObject({ name: "Switzerland", encoder: { state: "placeholder", release: null } });
    expect(row("zz")).toMatchObject({ encoder: null, newest: null });
    expect(row("nz")).toMatchObject({ since: null, encoder: { lacks: 0, extra: 0 } });
    expect(view.jurisdictions.find((r) => r.jurisdiction === "zy")).toBeUndefined();
  });

  it("flags a placeholder pin where a release exists, and tolerates an unknown serving release", () => {
    const ng1 = release("ng-rulespec-1", "2026-07-12T00:00:00Z", [scope("ng/statute/2026-07-10-a")]);
    const ng = corpusView({
      releases: [ng1],
      pointers: [pointer(ng1.name, "2026-07-13T00:00:00Z", "ng"), pointer("ghost", "2026-07-14T00:00:00Z", "ng", "guidance")],
      served: [],
      pins: { ng: { release: null } },
    }).jurisdictions[0];
    expect(ng).toMatchObject({
      flags: ["pin_unknown"],
      // Without the served scope versions, nothing is compared.
      serving: { release: "ghost", releases: 2, scopes: 0, provisions: null },
      next: null,
      encoder: { state: "placeholder", lacks: null },
    });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => value, text: async () => String(value) } as Response;
}

const servedRow = (i: number) => ({ release_name: "uk-rulespec-1", jurisdiction: "uk", document_class: "statute", version: `v${i}` });

function stubCorpusFetch(overrides: Record<string, Response | Error> = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    for (const [fragment, response] of Object.entries(overrides)) {
      if (url.includes(fragment)) {
        if (response instanceof Error) throw response;
        return response;
      }
    }
    const offset = Number(new URL(url, "https://x").searchParams.get("offset") ?? 0);
    if (url.includes("/release_objects")) {
      return jsonResponse(
        offset > 0
          ? []
          : [
              {
                release_name: "uk-rulespec-1",
                created_at: "2026-09-07T00:00:00Z",
                scopes: [
                  { jurisdiction: "uk", document_class: "statute", version: "v0", provision_rows: 7 },
                  { jurisdiction: "uk", document_class: "statute", version: "v1000" },
                  {},
                ],
              },
              { release_name: "de-rulespec-1", created_at: "2026-09-15T00:00:00Z", scopes: null },
            ]
      );
    }
    if (url.includes("/active_scope_pointer")) return jsonResponse([pointer("uk-rulespec-1", "2026-09-13T00:00:00Z", "uk")]);
    // Over a page of served rows: the read must take a second page.
    if (url.includes("/current_release_scopes")) {
      return jsonResponse(offset === 0 ? Array.from({ length: 1000 }, (_, i) => servedRow(i)) : [servedRow(1000)]);
    }
    if (url.includes("rulespec-uk/main/.axiom/toolchain.toml")) return jsonResponse('axiom_corpus_release = "uk-rulespec-1"');
    if (url.includes("rulespec-bo/main/.axiom/toolchain.toml")) return jsonResponse('axiom_corpus_release = "bo-rulespec-x"');
    if (url.includes("rulespec-ch/main/.axiom/toolchain.toml")) return jsonResponse("# NON-VALIDATING PLACEHOLDER\n[toolchain]");
    if (url.includes("manifests/releases/bo-rulespec-x.json")) return jsonResponse({ name: "bo-rulespec-x" });
    if (url.includes("/search/repositories")) {
      return jsonResponse({
        items: [
          { name: "rulespec-uk" },
          { name: "rulespec-bo" },
          { name: "rulespec-ch" },
          { name: "rulespec-graph-viewer" },
          { name: "rulespec-us-al", archived: true },
        ],
      });
    }
    if (url.includes("/search/issues") && decodeURIComponent(url).includes("draft:true")) return jsonResponse({ total_count: 20, items: [] });
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

const calls = (fetchMock: ReturnType<typeof stubCorpusFetch>, fragment: string) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes(fragment));

describe("readCorpusView", () => {
  it("joins the release tables, every page of them, the repos and their pins, and axiom-corpus activity", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "token");
    const fetchMock = stubCorpusFetch();
    const view = await readCorpusView();
    expect(view.jurisdictions.map((j) => [j.jurisdiction, j.flags, j.encoder?.release ?? null, j.encoder?.state ?? null])).toEqual([
      ["uk", ["encoder_lacks"], "uk-rulespec-1", "signed"],
      ["bo", ["pin_unsigned"], "bo-rulespec-x", "manifest"],
      ["ch", ["no_release"], null, "placeholder"],
    ]);
    // 1,001 served scope versions, of which the pinned release holds two.
    expect(view.jurisdictions[0]).toMatchObject({
      serving: { scopes: 1001, provisions: 7 },
      encoder: { lacks: 999, extra: 0 },
    });
    expect(view.openPrs).toEqual({
      count: 47,
      draft: 20,
      oldestAt: "2026-07-16T19:13:12Z",
      url: "https://github.com/TheAxiomFoundation/axiom-corpus/pulls",
    });
    expect(view.lastPublish).toEqual({ conclusion: "success", at: "2026-09-25T00:00:00Z", url: "https://github.com/run/1" });
    const search = fetchMock.mock.calls.find(([url]) => String(url).includes("/search/issues"));
    expect(search?.[1]?.headers).toMatchObject({ Authorization: "Bearer token" });
    expect(calls(fetchMock, "/current_release_scopes").map((url) => new URL(url).searchParams.get("offset"))).toEqual(["0", "1000"]);
    expect(calls(fetchMock, "/active_scope_pointer")).toHaveLength(1);
    expect(new URL(calls(fetchMock, "/release_objects")[0]).searchParams.get("limit")).toBe("10");
    // Only a pin that names no signed release is looked up among the manifests.
    expect(calls(fetchMock, "manifests/releases/")).toHaveLength(1);
  });

  it("leaves out GitHub parts it cannot read, and fails when the release tables are unreadable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    stubCorpusFetch({
      "/search/issues": jsonResponse({ message: "rate limited" }, 403),
      "/search/repositories": jsonResponse({ message: "rate limited" }, 403),
      "/publish.yml/runs": jsonResponse({ workflow_runs: [{ conclusion: "cancelled", created_at: "x", html_url: "y" }] }),
      "toolchain.toml": new Error("offline"),
    });
    const view = await readCorpusView();
    expect(view).toMatchObject({ openPrs: null, lastPublish: null });
    // The known repos stand in for the search; with no pins read, those without a release have none cut.
    expect(view.jurisdictions).toHaveLength(27);
    expect(view.jurisdictions.find((j) => j.jurisdiction === "uk")?.encoder).toBeNull();
    expect(view.jurisdictions.find((j) => j.jurisdiction === "pe")).toMatchObject({ flags: ["no_release"] });

    stubCorpusFetch({ "draft%3Atrue": jsonResponse({}, 500) });
    expect((await readCorpusView()).openPrs).toMatchObject({ count: 47, draft: null });

    stubCorpusFetch({ "/publish.yml/runs": jsonResponse({}, 500), "/release_objects": jsonResponse({}, 500) });
    await expect(readCorpusView()).rejects.toThrow(/500/);
    expect(await getCorpusView()).toBeNull();

    stubCorpusFetch({ "/current_release_scopes": jsonResponse({}, 500) });
    await expect(readCorpusView()).rejects.toThrow(/current_release_scopes/);
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
    expect((await getCorpusView())?.outOfSync).toBe(3);
  });
});

describe("scopeCorpus", () => {
  it("keeps one top-level jurisdiction and recounts what is out of sync", () => {
    const us1 = release("us-rulespec-1", "2026-09-14T00:00:00Z", [scope("us/statute/a"), scope("us-al/statute/b")]);
    const usCa = release("us-ca-1", "2026-09-15T00:00:00Z", [scope("us-ca/statute/c")]);
    const uk1 = release("uk-rulespec-1", "2026-09-07T00:00:00Z", [scope("uk/statute/d")]);
    const view = corpusView({
      releases: [us1, usCa, uk1, release("usx-1", "2026-09-07T00:00:00Z", [scope("usx/statute/e")])],
      pointers: [pointer(us1.name, "2026-09-14T01:00:00Z", "us"), pointer(uk1.name, "2026-09-08T00:00:00Z", "uk")],
      served: [...serves(us1), ...serves(uk1)],
      pins: {},
    });
    expect(scopeCorpus(view, null)).toBe(view);
    const us = scopeCorpus(view, "us");
    expect(us.jurisdictions.map((j) => j.jurisdiction).sort()).toEqual(["us", "us-ca"]);
    expect(us.outOfSync).toBe(1);
    expect(scopeCorpus(view, "uk")).toMatchObject({ outOfSync: 0, jurisdictions: [{ jurisdiction: "uk" }] });
  });
});

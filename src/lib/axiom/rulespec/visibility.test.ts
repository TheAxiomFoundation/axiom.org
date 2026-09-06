import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  fetchRuleSpecRepoVisibility,
  isRuleSpecRepoReadable,
  ruleSpecReadLocation,
} from "./visibility";
import { _resetRawFetchCache } from "./raw-cache";

const REGISTRY = (repo: string) =>
  `https://raw.githubusercontent.com/TheAxiomFoundation/${repo}/main/.axiom/registry.toml`;

/** A ``fetch`` stub serving ``.axiom/registry.toml`` bodies by repo. */
function stubRegistry(bodies: Record<string, string>) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    const repo = Object.keys(bodies).find((name) => url === REGISTRY(name));
    if (!repo) return { ok: false, status: 404 };
    return { ok: true, status: 200, text: async () => bodies[repo] };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchRuleSpecRepoVisibility", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
  });

  it("reads the marker a repo declares for itself", async () => {
    stubRegistry({
      "rulespec-nz": '[registry]\napp_visibility = "experimental"\n',
    });
    expect(await fetchRuleSpecRepoVisibility("rulespec-nz")).toBe(
      "experimental"
    );
  });

  it("treats an absent marker as public", async () => {
    stubRegistry({ "rulespec-nz": "[registry]\nowner = \"axiom\"\n" });
    expect(await fetchRuleSpecRepoVisibility("rulespec-nz")).toBe("public");
  });

  it("fails open when the registry file is missing or the fetch dies", async () => {
    // A GitHub hiccup must not blank a live country's tiles — the same
    // contract discoverRoots() and lib/axiom/search.ts keep.
    stubRegistry({});
    expect(await fetchRuleSpecRepoVisibility("rulespec-us")).toBe("public");

    _resetRawFetchCache();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dns")));
    expect(await fetchRuleSpecRepoVisibility("rulespec-us")).toBe("public");
  });

  it("dedupes the marker read across callers", async () => {
    const fetchMock = stubRegistry({ "rulespec-us": "[registry]\n" });
    await Promise.all([
      isRuleSpecRepoReadable("rulespec-us"),
      isRuleSpecRepoReadable("rulespec-us"),
      isRuleSpecRepoReadable("rulespec-us"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("isRuleSpecRepoReadable", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
  });

  it("refuses a repo off the read list without asking GitHub", async () => {
    // The registered gate fails CLOSED: no network call can open a
    // pilot repo, so a rate limit or an outage cannot leak it.
    const fetchMock = stubRegistry({ "rulespec-il": "[registry]\n" });
    expect(await isRuleSpecRepoReadable("rulespec-il")).toBe(false);
    expect(await isRuleSpecRepoReadable("rulespec-nowhere")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a listed repo that gates itself upstream", async () => {
    stubRegistry({
      "rulespec-nz": '[registry]\napp_visibility = "experimental"\n',
    });
    expect(await isRuleSpecRepoReadable("rulespec-nz")).toBe(false);
  });

  it("allows a listed repo that declares nothing", async () => {
    stubRegistry({ "rulespec-us": "" });
    expect(await isRuleSpecRepoReadable("rulespec-us")).toBe(true);
  });
});

describe("ruleSpecReadLocation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
  });

  it("resolves a readable jurisdiction to its monorepo location", async () => {
    stubRegistry({ "rulespec-us": "[registry]\n" });
    expect(await ruleSpecReadLocation("us-ny")).toEqual({
      repo: "rulespec-us",
      prefix: "us-ny",
    });
    expect(await ruleSpecReadLocation("ca")).toEqual({
      repo: "rulespec-ca",
      prefix: "",
    });
  });

  it("returns null for a slug no family claims", async () => {
    stubRegistry({});
    expect(await ruleSpecReadLocation("fr")).toBeNull();
  });

  it("returns null for a gated family, with no GitHub call at all", async () => {
    const fetchMock = stubRegistry({});
    expect(await ruleSpecReadLocation("il")).toBeNull();
    expect(await ruleSpecReadLocation("il-tlv")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for a listed repo that has gated itself", async () => {
    stubRegistry({
      "rulespec-nz": '[registry]\napp_visibility = "experimental"  # pilot\n',
    });
    expect(await ruleSpecReadLocation("nz")).toBeNull();
  });
});

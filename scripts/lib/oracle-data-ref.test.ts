import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOracleDataRef } from "./oracle-data-ref.mjs";

const BRANCH_URL =
  "https://api.github.com/repos/TheAxiomFoundation/axiom-oracles/branches/";
const ORACLE_SHA = "a".repeat(40);
const MAIN_SHA = "b".repeat(40);

function branchResponse(sha: string) {
  return new Response(JSON.stringify({ commit: { sha } }), { status: 200 });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveOracleDataRef", () => {
  it("pins oracle-data and sends the caller's headers in a GET request", async () => {
    const fetch = vi.fn().mockResolvedValue(branchResponse(ORACLE_SHA));
    const log = vi.fn();
    const headers = { Authorization: "Bearer test-token" };

    await expect(resolveOracleDataRef({ fetch, headers, log })).resolves.toEqual({
      branch: "oracle-data",
      sha: ORACLE_SHA,
    });

    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${BRANCH_URL}oracle-data`, {
      method: "GET",
      headers,
    });
    expect(log).toHaveBeenCalledExactlyOnceWith(
      `[oracle-data] Using TheAxiomFoundation/axiom-oracles oracle-data at ${ORACLE_SHA}`,
    );
    expect(fetch.mock.calls.flat().join(" ")).not.toMatch(
      /\/main\/|ref=main|sha=main/,
    );
  });

  it("falls back to main's SHA only when oracle-data returns 404", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(branchResponse(MAIN_SHA));
    const log = vi.fn();

    await expect(resolveOracleDataRef({ fetch, log })).resolves.toEqual({
      branch: "main",
      sha: MAIN_SHA,
    });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${BRANCH_URL}oracle-data`,
      `${BRANCH_URL}main`,
    ]);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      `[oracle-data] Using TheAxiomFoundation/axiom-oracles main at ${MAIN_SHA}`,
    );
  });

  it.each([401, 403, 429, 500, 503])(
    "rejects oracle-data HTTP %s without requesting main",
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
      const log = vi.fn();

      await expect(resolveOracleDataRef({ fetch, log })).rejects.toThrow(
        `Could not resolve TheAxiomFoundation/axiom-oracles branch oracle-data: HTTP ${status}`,
      );

      expect(fetch).toHaveBeenCalledOnce();
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("rejects transport errors without requesting main", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const log = vi.fn();

    await expect(resolveOracleDataRef({ fetch, log })).rejects.toThrow(
      "network unavailable",
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([404, 403, 500])("rejects fallback main HTTP %s", async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status }));
    const log = vi.fn();

    await expect(resolveOracleDataRef({ fetch, log })).rejects.toThrow(
      `Could not resolve TheAxiomFoundation/axiom-oracles branch main: HTTP ${status}`,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([null, {}, { commit: {} }, { commit: { sha: "main" } }])(
    "rejects malformed branch metadata %j without requesting main",
    async (metadata) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(metadata), { status: 200 }),
      );
      const log = vi.fn();

      await expect(resolveOracleDataRef({ fetch, log })).rejects.toThrow(
        "Invalid commit SHA for TheAxiomFoundation/axiom-oracles branch oracle-data",
      );
      expect(fetch).toHaveBeenCalledOnce();
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid JSON without requesting main", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("not-json", { status: 200 }));
    const log = vi.fn();

    await expect(resolveOracleDataRef({ fetch, log })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it("uses the global fetch and console logger by default", async () => {
    const fetch = vi.fn().mockResolvedValue(branchResponse(ORACLE_SHA));
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(resolveOracleDataRef()).resolves.toEqual({
      branch: "oracle-data",
      sha: ORACLE_SHA,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
  });
});

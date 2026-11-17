import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET } from "./route";

const EN = String.fromCharCode(0x2013);

// The corpus stores 42 USC 1395w-113 with an en dash.
const rows = [
  { id: "title", citation_path: "us/statute/42" },
  { id: "section", citation_path: `us/statute/42/1395w${EN}113` },
];

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function request() {
  return new Request("http://localhost/api/axiom/resolve");
}

beforeEach(() => {
  mockIn.mockReset();
  // Answer only the paths the query asked for, like the real ``.in()``.
  mockIn.mockImplementation((_column: string, paths: string[]) =>
    Promise.resolve({
      data: rows.filter((row) => paths.includes(row.citation_path)),
      error: null,
    })
  );
});

describe("GET /api/axiom/resolve", () => {
  it("resolves a section typed with a hyphen to its en-dash row", async () => {
    const response = await GET(
      request(),
      context(["us", "statute", "42", "1395w-113"])
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      match: "exact",
      citation_path: "us/statute/42/1395w-113",
      resolved_citation_path: `us/statute/42/1395w${EN}113`,
      missing_tail: [],
      href: `/us/statute/42/1395w${EN}113`,
    });
  });

  it("resolves the percent-encoded en-dash spelling as before", async () => {
    const response = await GET(
      request(),
      context(["us", "statute", "42", "1395w%E2%80%93113"])
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      match: "exact",
      citation_path: `us/statute/42/1395w${EN}113`,
      resolved_citation_path: `us/statute/42/1395w${EN}113`,
      missing_tail: [],
      href: `/us/statute/42/1395w${EN}113`,
    });
  });

  it("returns 404 when no prefix of either spelling is ingested", async () => {
    const response = await GET(request(), context(["xx", "statute", "1-a"]));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      match: "none",
      citation_path: "xx/statute/1-a",
      resolved_citation_path: null,
      href: null,
    });
  });
});

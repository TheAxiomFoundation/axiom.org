import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ conflictsForCitationPaths: vi.fn() }));
vi.mock("@/lib/axiom/source-conflicts", () => ({ conflictsForCitationPaths: mocks.conflictsForCitationPaths }));

const request = (query: string) => new Request(`http://localhost/api/axiom/source-conflicts${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.conflictsForCitationPaths.mockResolvedValue({});
});

it("returns the conflicts per path with a public five-minute cache", async () => {
  const conflict = { globalId: "us:x", citationPaths: ["us/statute/42/403/f/1"] };
  mocks.conflictsForCitationPaths.mockResolvedValue({ "us/statute/42/403/f": [conflict] });
  const response = await GET(request("?paths=us/statute/42/403/f,us/statute/26/32"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(mocks.conflictsForCitationPaths).toHaveBeenCalledWith(["us/statute/42/403/f", "us/statute/26/32"]);
  expect(await response.json()).toEqual({ conflicts: { "us/statute/42/403/f": [conflict] } });
});

it("returns an empty map when nothing matches or the table is unavailable", async () => {
  const response = await GET(request("?paths=us/statute/26/32"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ conflicts: {} });
});

it("rejects bad input before reading", async () => {
  for (const query of [
    "",
    "?paths=",
    "?paths=us/statute/../x",
    `?paths=${Array.from({ length: 201 }, (_, i) => `us/statute/${i}`).join(",")}`,
    `?paths=us/statute/${"a".repeat(4001)}`,
  ]) {
    expect((await GET(request(query))).status).toBe(400);
  }
  expect(mocks.conflictsForCitationPaths).not.toHaveBeenCalled();
});

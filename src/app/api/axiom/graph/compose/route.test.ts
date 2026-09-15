import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { runtimeProxyGet } from "@/lib/axiom/runtime/api";
vi.mock("@/lib/axiom/runtime/api", () => ({ runtimeProxyGet: vi.fn() }));

describe("compose graph cache", () => {
  it.each([404, 502, 503])("does not cache a %s response", async (status) => {
    vi.mocked(runtimeProxyGet).mockResolvedValue({
      status,
      body: { status: "error" },
    });
    const response = await GET(
      new Request(
        "https://axiom.org/api/axiom/graph/compose?focus=de:statutes/bgb/126",
      ),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("retains caching for successful graphs", async () => {
    vi.mocked(runtimeProxyGet).mockResolvedValue({
      status: 200,
      body: { status: "ok" },
    });
    const response = await GET(
      new Request(
        "https://axiom.org/api/axiom/graph/compose?focus=us:statutes/26/24",
      ),
    );
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearComposeCache } from "@/lib/axiom/runtime/compose-cache";
import { GET } from "./route";
import { runtimeProxyGet } from "@/lib/axiom/runtime/api";
vi.mock("@/lib/axiom/runtime/api", () => ({ runtimeProxyGet: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); clearComposeCache(); });
const request = () => new Request("http://localhost/api/axiom/graph/compose?focus=us-co%3Aregulations%2F10-ccr-2506-1%2F4.207.2");
it("allows cold composition time and caches successful graphs", async () => {
  vi.mocked(runtimeProxyGet).mockResolvedValue({ status: 200, body: { status: "ok", data: { graph: {} } } });
  const response = await GET(request());
  expect(runtimeProxyGet).toHaveBeenCalledWith(expect.stringContaining("/graph/compose?focus="), { timeoutMs: 20000, fresh: true });
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
});
it("does not cache a transient failure and lets retry recover", async () => {
  vi.mocked(runtimeProxyGet).mockResolvedValueOnce({ status: 502, body: { status: "error" } }).mockResolvedValueOnce({ status: 200, body: { status: "ok" } });
  const failed = await GET(request());
  expect(failed.status).toBe(502);
  expect(failed.headers.get("cache-control")).toBe("no-store");
  expect((await GET(request())).status).toBe(200);
});

it("shares one upstream request across thumbnails and graph navigation", async () => {
  vi.mocked(runtimeProxyGet).mockResolvedValue({ status: 200, body: { data: { graph: {} } } });
  await Promise.all([GET(request()), GET(request())]);
  await GET(request());
  expect(runtimeProxyGet).toHaveBeenCalledTimes(1);
});

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

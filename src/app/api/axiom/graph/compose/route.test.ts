import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { runtimeProxyGet } from "@/lib/axiom/runtime/api";
vi.mock("@/lib/axiom/runtime/api", () => ({ runtimeProxyGet: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
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

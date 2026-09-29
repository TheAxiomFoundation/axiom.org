import { beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeProxyGet } from "@/lib/axiom/runtime/api";
import { GET } from "./route";

vi.mock("@/lib/axiom/runtime/api", () => ({ runtimeProxyGet: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runtimeProxyGet).mockResolvedValue({ status: 200, body: { status: "ok" } });
});

const call = (node: string[]) =>
  GET(new Request("http://localhost/api/axiom/nodes/x"), { params: Promise.resolve({ node }) });

describe("GET /api/axiom/nodes/[...node]", () => {
  it("forwards a legal id, encoding each segment", async () => {
    const response = await call(["us:statutes", "26", "24#child_tax_credit"]);
    expect(response.status).toBe(200);
    expect(runtimeProxyGet).toHaveBeenCalledWith("/nodes/us%3Astatutes/26/24%23child_tax_credit");
  });

  it.each([
    [[".."]],
    [["us:statutes", "..", "admin"]],
    [["."]],
    // Next decodes %2F inside a catch-all segment; a legal id never has one
    [["a/../../admin"]],
    [["us:statutes\\..\\admin"]],
  ])("refuses %j without asking the API", async (node) => {
    const response = await call(node);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "error", error: { code: "invalid_node" } });
    expect(runtimeProxyGet).not.toHaveBeenCalled();
  });
});

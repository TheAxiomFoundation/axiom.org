import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({ eq: vi.fn(), abort: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseEncodings: { from: mocks.from } }));
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: vi.fn().mockReturnThis(), eq: mocks.eq, limit: vi.fn().mockReturnThis(), abortSignal: mocks.abort };
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
});
it("returns the exact selected module rather than its cited source or a sibling file", async () => {
  mocks.abort.mockResolvedValue({ data: [{ file_path: "statutes/26/32.yaml", raw_yaml: "format: rulespec/v1\nrules: []" }], error: null });
  const response = await GET(new Request("http://localhost/api/axiom/rulespec?root=us%3Astatutes%2F26%2F32%23eitc"));
  expect(mocks.eq.mock.calls).toEqual([["jurisdiction", "us"], ["file_path", "statutes/26/32.yaml"]]);
  expect(await response.json()).toEqual({ root: "us:statutes/26/32", filePath: "statutes/26/32.yaml", content: "format: rulespec/v1\nrules: []" });
});
it("does not substitute another file when the selected module is missing", async () => {
  mocks.abort.mockResolvedValue({ data: [], error: null });
  expect((await GET(new Request("http://localhost/api/axiom/rulespec?root=us%3Astatutes%2F26%2F32"))).status).toBe(404);
});
it("rejects invalid module paths before querying", async () => {
  expect((await GET(new Request("http://localhost/api/axiom/rulespec?root=us%3A..%2F32"))).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
});

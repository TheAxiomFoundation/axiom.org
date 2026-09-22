import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getSectionPageData } from "@/lib/axiom/section-page";
vi.mock("@/lib/axiom/section-page", () => ({ getSectionPageData: vi.fn(), refsForChunk: () => [] }));
const context = { params: Promise.resolve({ path: ["us", "statute", "26", "32", "a"] }) };
beforeEach(() => vi.clearAllMocks());
describe("workspace source", () => {
  it("returns ordered source text and focus without encodings or duplicate page chrome", async () => {
    vi.mocked(getSectionPageData).mockResolvedValue({ citationPath: "us/statute/26/32", root: { heading: "Credit", body: "Whole body", source_url: "https://example.org/law" }, intro: "Introduction", bodyChunks: [{ anchor: "a", designator: "(a)", text: "Allowance" }], provisions: [{ anchor: "b", designator: "(b)", rule: { heading: "Limits", body: "Limit text" } }], rootRefs: [], focusAnchor: "a", truncated: true, encoding: { secret: "unused" } } as never);
    const response = await GET(new Request("http://localhost/api"), context);
    const source = await response.json();
    expect(source.blocks.map((block: { body: string }) => block.body)).toEqual(["Introduction", "Allowance", "Limit text"]);
    expect(source.focusAnchor).toBe("a");
    expect(source.truncated).toBe(true);
    expect(source).not.toHaveProperty("encoding");
  });
  it("distinguishes missing source and temporary failure", async () => {
    vi.mocked(getSectionPageData).mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api"), context)).status).toBe(404);
    vi.mocked(getSectionPageData).mockRejectedValue(new Error("backend"));
    expect((await GET(new Request("http://localhost/api"), context)).status).toBe(503);
  });
});

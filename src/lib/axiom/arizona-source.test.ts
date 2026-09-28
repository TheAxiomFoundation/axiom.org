import { afterEach, expect, it, vi } from "vitest";
import { arizonaSource, parseArizonaSource } from "./arizona-source";
afterEach(() => vi.unstubAllGlobals());
it("loads official text for Arizona sections and preserves provenance", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(`<body><p>43-1073. Family income tax credit</p><p>${'Source provision text. '.repeat(10)}</p><script>untrusted()</script></body>`));
  vi.stubGlobal("fetch", fetcher);
  const source = await arizonaSource(["us-az", "statute", "43-1073", "A", "1"]);
  expect(fetcher.mock.calls[0][0]).toBe("https://www.azleg.gov/ars/43/01073.htm");
  expect(source?.origin).toBe("official-live");
  expect(source?.blocks[0].body).not.toContain("untrusted");
  expect(source?.effectiveDate).toBeNull();
});
it("rejects unsupported paths and missing HTML bodies", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await arizonaSource(["us", "statute", "43-1073"])).toBeNull();
  expect(await arizonaSource(["us-az", "statute", "../evil"])).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  expect(parseArizonaSource("<html>Error</html>")).toBeNull();
});

// @vitest-environment node
import { describe, expect, it } from "vitest";

import OgImage, { alt, contentType, size } from "./opengraph-image";

describe("receipt share card", () => {
  it("renders a PNG of the refusal frame from the vendored fonts", async () => {
    const response = await OgImage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // PNG magic — the route produced a real image, so the font files
    // resolved and satori accepted the layout.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeGreaterThan(20_000);
  }, 30_000);

  it("declares the card's metadata for the router", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toContain("refusing a rewritten rule");
  });
});

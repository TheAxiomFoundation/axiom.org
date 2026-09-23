import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { DEFAULT_SHARE_IMAGE } from "./share";

describe("share defaults", () => {
  it("points the default share card at a file the site serves", () => {
    expect(existsSync(join(process.cwd(), "public", DEFAULT_SHARE_IMAGE))).toBe(
      true
    );
  });
});

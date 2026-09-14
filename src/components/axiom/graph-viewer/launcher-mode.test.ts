import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_LAUNCHER_MODE,
  LAUNCHER_MODE_KEY,
  parseLauncherMode,
  readLauncherMode,
  storeLauncherMode,
} from "./launcher-mode";

describe("launcher mode preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the corpus map", () => {
    expect(DEFAULT_LAUNCHER_MODE).toBe("field");
    expect(readLauncherMode()).toBe("field");
  });

  it("parses only known modes, everything else falls back to the map", () => {
    expect(parseLauncherMode("list")).toBe("list");
    expect(parseLauncherMode("field")).toBe("field");
    expect(parseLauncherMode("constellation")).toBe("field");
    expect(parseLauncherMode(null)).toBe("field");
    expect(parseLauncherMode(42)).toBe("field");
  });

  it("round-trips the stored preference", () => {
    storeLauncherMode("list");
    expect(window.localStorage.getItem(LAUNCHER_MODE_KEY)).toBe("list");
    expect(readLauncherMode()).toBe("list");
    storeLauncherMode("field");
    expect(readLauncherMode()).toBe("field");
  });

  it("survives a poisoned store", () => {
    window.localStorage.setItem(LAUNCHER_MODE_KEY, "garbage");
    expect(readLauncherMode()).toBe("field");
  });
});

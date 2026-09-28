import { beforeEach, describe, expect, it } from "vitest";
import {
  hasSeenTour,
  markTourSeen,
  tourSeenKey,
  TOUR_SEEN_KEY_PREFIX,
} from "./tour-state";

describe("tour-state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("builds prefixed keys", () => {
    expect(tourSeenKey("graph")).toBe(`${TOUR_SEEN_KEY_PREFIX}graph`);
    expect(tourSeenKey("reader")).toBe(`${TOUR_SEEN_KEY_PREFIX}reader`);
  });

  it("graph and reader flags persist per browser (localStorage)", () => {
    expect(hasSeenTour("graph")).toBe(false);
    markTourSeen("graph");
    expect(hasSeenTour("graph")).toBe(true);
    expect(window.localStorage.getItem(tourSeenKey("graph"))).toBe("1");
    expect(window.sessionStorage.getItem(tourSeenKey("graph"))).toBeNull();
  });

  it("the subgraph flag is session-scoped", () => {
    markTourSeen("subgraph");
    expect(hasSeenTour("subgraph")).toBe(true);
    expect(window.sessionStorage.getItem(tourSeenKey("subgraph"))).toBe("1");
    expect(window.localStorage.getItem(tourSeenKey("subgraph"))).toBeNull();
  });

  it("surfaces are independent", () => {
    markTourSeen("reader");
    expect(hasSeenTour("graph")).toBe(false);
    expect(hasSeenTour("subgraph")).toBe(false);
    expect(hasSeenTour("reader")).toBe(true);
  });

  it("treats unavailable storage as seen — the tour must never nag", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(hasSeenTour("graph")).toBe(true);
      // Marking silently no-ops rather than throwing.
      expect(() => markTourSeen("graph")).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});

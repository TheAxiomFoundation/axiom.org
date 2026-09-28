import { beforeEach, describe, expect, it } from "vitest";
import { arrive, EMPTY_TRAIL, loadTrail, locationHref, pushStep, replaceStep, saveTrail, trailUrl, type TrailEntry } from "./workspace-trail";

const BASE = "https://axiom.org/app?compose=us-ny%3Astatutes%2FNYC%2F11-1701";
const at = (id: string, view: TrailEntry["view"] = "map"): TrailEntry => ({
  id, view, trail: [], url: locationHref({ id, view, trail: [] }, BASE),
});
const open = { ...at("summit"), url: BASE };

describe("workspace trail", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("steps back and forward by URL, the way the browser does", () => {
    let trail = pushStep(pushStep({ ...EMPTY_TRAIL, current: open }, at("band")), at("band", "structure"));
    const back = arrive(trail, at("band").url);
    expect(back.entry?.view).toBe("map");
    expect(back.trail.past).toEqual([open]);
    expect(back.trail.future.map((entry) => entry.view)).toEqual(["structure"]);
    trail = back.trail;
    const forward = arrive(trail, at("band", "structure").url);
    expect(forward.entry?.view).toBe("structure");
    expect(forward.trail.past.map((entry) => entry.id)).toEqual(["summit", "band"]);
  });

  it("treats the current URL as a reload and an unknown one as a fresh trail", () => {
    const trail = pushStep({ ...EMPTY_TRAIL, current: open }, at("band"));
    expect(arrive(trail, at("band").url).trail).toBe(trail);
    expect(arrive(trail, at("elsewhere").url)).toEqual({ trail: EMPTY_TRAIL, entry: null });
  });

  it("drops what was ahead when a new step follows a back", () => {
    const trail = arrive(pushStep({ ...EMPTY_TRAIL, current: open }, at("band")), BASE).trail;
    expect(trail.future).toHaveLength(1);
    expect(pushStep(trail, at("other")).future).toEqual([]);
  });

  it("corrects the current step in place", () => {
    const trail = replaceStep(pushStep({ ...EMPTY_TRAIL, current: open }, at("band", "run")), at("band"));
    expect(trail.past).toEqual([open]);
    expect(trail.current?.view).toBe("map");
  });

  it("matches a source reader entry to the location it opened from", () => {
    const withSource = `${at("band", "read").url}&source=us-ny%2Fstatute%2FNYC%2F11-1701`;
    expect(trailUrl(withSource)).toBe(trailUrl(at("band", "read").url));
  });

  it("keeps one trail per graph across a reload, and survives unreadable storage", () => {
    const trail = pushStep({ ...EMPTY_TRAIL, current: open }, at("band"));
    saveTrail("us-ny:statutes/NYC/11-1701", trail);
    expect(loadTrail("us-ny:statutes/NYC/11-1701")).toEqual(trail);
    expect(loadTrail("us-co/co-snap")).toEqual(EMPTY_TRAIL);
    window.sessionStorage.setItem("axiom:workspace-trail:broken", "{not json");
    expect(loadTrail("broken")).toEqual(EMPTY_TRAIL);
  });
});

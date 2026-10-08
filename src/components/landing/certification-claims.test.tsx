import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FlatStrip } from "@/components/docs/flat-strip";
import { CorpusLibrary } from "./corpus-library";
import { CLUSTERS, registrySummary, SNAPSHOT_DATE, snapshotMonth } from "./registry-snapshot";

// The certified ledger is empty — api.axiom.org/v1/ready reports "empty
// ledger (ledger bootstrap-empty)" and axiom-api's
// data/certified-nodes.json has no entries — so no public surface may
// call a rule, program or seal certified, signed or sealed. The landing
// film and the /docs strip did until 2026-09-29. "uncertified" and an
// explicit "not a … certification count" negation stay allowed.
const CERTIFICATION_CLAIM = /\bcertified\b|\bsigned\b|\bsealed\b/i;

// Every word a visitor or a screen reader gets from a rendered surface.
function publicCopy(container: HTMLElement): string {
  const labels = [...container.querySelectorAll("[aria-label]")].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
  return [container.textContent ?? "", ...labels].join("\n");
}

function imgLabel(container: HTMLElement): string {
  return container.querySelector("svg[role='img']")?.getAttribute("aria-label") ?? "";
}

// Deterministic PRNG so the property checks replay identically.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseSummary(summary: string) {
  const m = /^(\d[\d,]*) runtime packages, (\d[\d,]*) package outputs$/.exec(summary);
  if (!m) throw new Error(`unparseable summary: ${summary}`);
  return { packages: Number(m[1].replace(/,/g, "")), outputs: Number(m[2].replace(/,/g, "")) };
}

describe("registry snapshot summary", () => {
  it("names the dated snapshot's real totals, not the retired 3,323", () => {
    const outputs = CLUSTERS.reduce((total, c) => total + c.count, 0);
    expect(registrySummary()).toBe(
      `${CLUSTERS.length} runtime packages, ${outputs.toLocaleString("en-US")} package outputs`,
    );
    expect(registrySummary()).toBe("16 runtime packages, 3,826 package outputs");
    expect(registrySummary()).not.toMatch(/3,323|certified/);
    expect(snapshotMonth()).toBe("July 2026");
  });

  // Invariants, for every cluster list: the package count is the list
  // length, the output count is the exact sum (so it is order-free and
  // additive over concatenation), and the words never claim more than
  // what was added up.
  it("holds its counting invariants for arbitrary cluster lists", () => {
    const rand = mulberry32(20260929);
    const draw = () =>
      Array.from({ length: Math.floor(rand() * 40) }, () => ({
        count: Math.floor(rand() * 5000),
      }));
    for (let trial = 0; trial < 500; trial++) {
      const a = draw();
      const b = draw();
      const sa = parseSummary(registrySummary(a));
      expect(sa.packages).toBe(a.length);
      expect(sa.outputs).toBe(a.reduce((t, c) => t + c.count, 0));
      expect(parseSummary(registrySummary([...a].reverse()))).toEqual(sa);
      const sb = parseSummary(registrySummary(b));
      expect(parseSummary(registrySummary([...a, ...b]))).toEqual({
        packages: sa.packages + sb.packages,
        outputs: sa.outputs + sb.outputs,
      });
      expect(registrySummary(a)).not.toMatch(CERTIFICATION_CLAIM);
    }
  });

  it("reads every month and refuses a malformed date", () => {
    const names = Array.from({ length: 12 }, (_, i) =>
      snapshotMonth(`2026-${String(i + 1).padStart(2, "0")}`),
    );
    expect(names[0]).toBe("January 2026");
    expect(names[11]).toBe("December 2026");
    expect(new Set(names).size).toBe(12);
    expect(SNAPSHOT_DATE).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    for (const bad of ["2026-13", "2026-00", "July", ""]) {
      expect(() => snapshotMonth(bad)).toThrow(/bad snapshot date/);
    }
  });
});

describe("public copy claims no certification the ledger lacks", () => {
  afterEach(() => {
    vi.doUnmock("./registry-snapshot");
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("the reduced-motion film says compiled, and dates its registry numbers", async () => {
    const { JourneyFilm } = await import("./journey-film");
    const { container } = render(<JourneyFilm />);
    expect(publicCopy(container)).not.toMatch(CERTIFICATION_CLAIM);
    // The still shows one provision, so its caption claims no more than that:
    // the corpus is not "the whole law" (live /coverage: selected sources).
    expect(container.textContent).toContain("one provision · segmented & encoded · graphed · compiled");
    expect(container.textContent).not.toMatch(/whole law captured|everywhere/);
    const label = imgLabel(container);
    expect(label).toContain(
      `the caption reads: ${snapshotMonth()} registry snapshot — ${registrySummary()}.`,
    );
    expect(label).toContain("predates the registry's 2026-07-28 production cutover");
    // The site never plays scene I (the scrolly starts at FILM_FROM), and
    // the $478 card is a fixed illustration, not a live answer.
    expect(label).not.toMatch(/live registry|compute live answers|lit green|1,742,391|cites the wrong section/);
    expect(label).toContain("show illustrative output cards");
  });

  it("the animated film's caption and label agree on one derived summary", async () => {
    // STATIC is decided at module load from prefers-reduced-motion; the
    // test setup stubs reduced motion on, so reload with it off.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.resetModules();
    const { JourneyFilm } = await import("./journey-film");
    const { container } = render(<JourneyFilm />);
    const copy = publicCopy(container);
    expect(copy).not.toMatch(CERTIFICATION_CLAIM);
    expect(copy).not.toMatch(/3,323|encoded & verified|1,742,391/);
    // Differential: the visible caption and the accessible description
    // render the same snapshot through the same functions.
    const stamp = `${snapshotMonth()} registry snapshot — ${registrySummary()}`;
    expect(container.textContent).toContain(stamp);
    expect(imgLabel(container)).toContain(`the caption reads: ${stamp}.`);
    expect(stamp).toBe("July 2026 registry snapshot — 16 runtime packages, 3,826 package outputs");
  });

  it("the film's numbers move when the snapshot moves", async () => {
    vi.doMock("./registry-snapshot", async (importOriginal) => {
      const real = await importOriginal<typeof import("./registry-snapshot")>();
      const clusters = real.CLUSTERS.slice(0, 2).map((c) => ({ ...c, count: c.count + 1 }));
      return {
        ...real,
        SNAPSHOT_DATE: "2031-01",
        CLUSTERS: clusters,
        snapshotMonth: (date = "2031-01") => real.snapshotMonth(date),
        registrySummary: (cs = clusters) => real.registrySummary(cs),
      };
    });
    vi.resetModules();
    const { JourneyFilm } = await import("./journey-film");
    const { container } = render(<JourneyFilm />);
    expect(imgLabel(container)).toContain(
      "the caption reads: January 2031 registry snapshot — 2 runtime packages, 1,497 package outputs.",
    );
  });

  it("the /docs strip's compile seal reads compiled · illustrative, with no certification label", () => {
    const { container } = render(<FlatStrip />);
    expect(publicCopy(container)).not.toMatch(CERTIFICATION_CLAIM);
    const words = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(words).toContain("SNAP · US · 2026");
    expect(words).toContain("compiled · illustrative");
    expect(imgLabel(container)).toContain("which compiles into a program artifact");
    expect(imgLabel(container)).not.toMatch(/1,742,391|7\.7M/);
  });

  it("the reading-room library claims no certification or unsourced count", () => {
    const { container } = render(<CorpusLibrary />);
    expect(publicCopy(container)).not.toMatch(CERTIFICATION_CLAIM);
    expect(imgLabel(container)).not.toMatch(/1,742,391/);
  });
});

// Unrendered branches (the digital-library plaques) and future edits
// still ship in the bundle, so the retired claims stay out of every
// non-test source file under src/.
describe("retired certification copy stays retired", () => {
  const RETIRED = [
    "3,323",
    "3,323 certified rules",
    "certified · signed",
    "certified and signed",
    "sealed SNAP",
    "encoded & verified",
    "1,742,391",
    "7.7M runs",
    "certification sweep",
    "certifies itself",
    "certification is automatic",
    "the whole law captured",
  ];

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it("appears in no source file", () => {
    const files = sources(resolve(process.cwd(), "src"));
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return RETIRED.filter((phrase) => text.includes(phrase)).map((phrase) => `${file}: ${phrase}`);
    });
    expect(hits).toEqual([]);
  });
});

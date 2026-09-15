import { describe, expect, it } from "vitest";
import type { EncodingStatusRun, LiveEncodingRun } from "@/lib/corpus-status";
import {
  classifyLiveRun,
  graphUrlForSection,
  groupRunsByDocument,
  mergeLiveRunsIntoHistory,
  relativeTime,
} from "./ops-dashboard";
import {
  corpusLookupPathsForCitation,
  corpusPathsForCitation,
  documentKeyFromCitation,
  parseCitation,
  sectionWithinDocument,
} from "@/lib/axiom/ops-citations";

function run(overrides: Partial<EncodingStatusRun>): EncodingStatusRun {
  return {
    id: "run",
    timestamp: "2026-07-01T00:00:00Z",
    citation: null,
    total_duration_ms: 0,
    agent_type: null,
    agent_model: null,
    data_source: null,
    has_issues: false,
    session_id: null,
    encoder_version: null,
    ...overrides,
  };
}

function liveRun(overrides: Partial<LiveEncodingRun>): LiveEncodingRun {
  return {
    id: "live",
    citation: "us-ma:regulations/106-cmr/704",
    status: "running",
    started_at: "2026-08-10T00:00:00Z",
    last_heartbeat_at: "2026-08-10T00:00:00Z",
    finished_at: null,
    phase: null,
    attempt: null,
    backend: null,
    model: null,
    encoder_version: null,
    run_id: null,
    runner: null,
    ...overrides,
  };
}

describe("parseCitation", () => {
  it("parses the current scope:path format, normalizing the class", () => {
    expect(parseCitation("us-ma:regulations/106-cmr/704/230")).toEqual({
      scope: "us-ma",
      segments: ["regulation", "106-cmr", "704", "230"],
      documentDepth: 2,
    });
  });

  it("folds the legacy nested-jurisdiction format into the scope", () => {
    expect(parseCitation("us:us-ma/regulations/106-cmr/704")).toEqual({
      scope: "us-ma",
      segments: ["regulation", "106-cmr", "704"],
      documentDepth: 2,
    });
  });

  it("parses human-readable federal statute citations", () => {
    expect(parseCitation("26 USC 1(j)(2)")).toEqual({
      scope: "us",
      segments: ["statute", "26", "1(j)(2)"],
      documentDepth: 2,
    });
  });

  it("names policy documents as agency/document", () => {
    expect(
      parseCitation("us-mn:policies/dhs/combined-manual/0011-06").documentDepth
    ).toBe(3);
  });
});

describe("documentKeyFromCitation", () => {
  it("groups every citation format into the same document", () => {
    expect(documentKeyFromCitation("us:us-ma/regulations/106-cmr/704/230")).toBe(
      "us-ma:regulation/106-cmr"
    );
    expect(documentKeyFromCitation("us-ma:regulations/106-cmr/704")).toBe(
      "us-ma:regulation/106-cmr"
    );
    expect(documentKeyFromCitation("us-ma/regulation/106-cmr/704")).toBe(
      "us-ma:regulation/106-cmr"
    );
  });

  it("groups federal statutes at title level across formats", () => {
    expect(documentKeyFromCitation("us:statutes/26/3121")).toBe(
      "us:statute/26"
    );
    expect(documentKeyFromCitation("26 USC 1(j)(2)")).toBe("us:statute/26");
  });

  it("passes through unparseable citations untouched", () => {
    expect(documentKeyFromCitation("Pub. L. 117-169")).toBe("Pub. L. 117-169");
  });
});

describe("corpusPathsForCitation", () => {
  it("maps citations to navigation paths, stripping subsections", () => {
    expect(corpusPathsForCitation("26 USC 1(j)(2)")).toEqual({
      document: "us/statute/26",
      section: "us/statute/26/1",
    });
    expect(corpusPathsForCitation("us-ma:regulations/106-cmr/704/230")).toEqual({
      document: "us-ma/regulation/106-cmr",
      section: "us-ma/regulation/106-cmr/704/230",
    });
  });

  it("returns nulls for unparseable citations", () => {
    expect(corpusPathsForCitation("Pub. L. 117-169")).toEqual({
      document: null,
      section: null,
    });
  });
});

describe("sectionWithinDocument", () => {
  it("returns the section path inside the document", () => {
    expect(
      sectionWithinDocument(
        "us:us-ma/regulations/106-cmr/704/230",
        "us-ma:regulation/106-cmr"
      )
    ).toBe("704/230");
    expect(sectionWithinDocument("26 USC 1(j)(2)", "us:statute/26")).toBe(
      "1(j)(2)"
    );
  });

  it("labels document-level runs and non-path citations", () => {
    expect(
      sectionWithinDocument(
        "us-ma:regulations/106-cmr",
        "us-ma:regulation/106-cmr"
      )
    ).toBe("(document)");
    expect(sectionWithinDocument("Pub. L. 117-169", "Pub. L. 117-169")).toBe(
      "(document)"
    );
    expect(sectionWithinDocument(null, "x")).toBe("—");
  });
});

describe("corpusLookupPathsForCitation", () => {
  it("returns document-to-section ancestor paths, deepest last", () => {
    expect(
      corpusLookupPathsForCitation("us-ky:statute/krs/141.020/document-1")
    ).toEqual([
      "us-ky/statute/krs",
      "us-ky/statute/krs/141.020",
      "us-ky/statute/krs/141.020/document-1",
    ]);
  });

  it("strips subsection parentheses before building paths", () => {
    expect(corpusLookupPathsForCitation("26 USC 1(j)(2)")).toEqual([
      "us/statute/26",
      "us/statute/26/1",
    ]);
  });
});

describe("groupRunsByDocument", () => {
  it("groups runs by document, newest first, counting sections and issues", () => {
    const groups = groupRunsByDocument([
      run({
        id: "a",
        citation: "us:statutes/26/3121",
        timestamp: "2026-07-01T00:00:00Z",
      }),
      run({
        id: "b",
        citation: "us:statutes/26/24",
        timestamp: "2026-07-02T00:00:00Z",
        has_issues: true,
      }),
      run({
        id: "c",
        citation: "us-ma:regulations/106-cmr/704",
        timestamp: "2026-07-03T00:00:00Z",
      }),
      run({ id: "d", citation: null }),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "us-ma:regulation/106-cmr",
      "us:statute/26",
    ]);
    expect(groups[1]).toMatchObject({
      lastAt: "2026-07-02T00:00:00Z",
      sectionCount: 2,
      inProgressSectionCount: 0,
      flaggedCount: 1,
    });
    expect(groups[1].runs).toHaveLength(2);
  });

  it("marks a section in progress only while its latest attempt failed", () => {
    const failing = (id: string, timestamp: string, hasIssues: boolean) =>
      run({
        id,
        citation: "dk:statute/lbk-603-2025/boerne-og-ungeydelsesloven",
        timestamp,
        has_issues: hasIssues,
        live: true,
      } as Partial<EncodingStatusRun>);

    const retrying = groupRunsByDocument([
      failing("a", "2026-08-11T00:00:00Z", true),
      failing("b", "2026-08-11T01:00:00Z", true),
      failing("c", "2026-08-11T02:00:00Z", true),
    ]);
    expect(retrying[0]).toMatchObject({
      inProgressSectionCount: 1,
      inProgressAttemptCount: 3,
    });

    const eventuallyPassed = groupRunsByDocument([
      failing("a", "2026-08-11T00:00:00Z", true),
      failing("b", "2026-08-11T01:00:00Z", true),
      failing("c", "2026-08-11T02:00:00Z", false),
    ]);
    expect(eventuallyPassed[0]).toMatchObject({
      inProgressSectionCount: 0,
      inProgressAttemptCount: 0,
    });
  });
});

describe("mergeLiveRunsIntoHistory", () => {
  it("appends closed live runs as live ledger rows", () => {
    const merged = mergeLiveRunsIntoHistory(
      [run({ id: "hist-1" })],
      [
        liveRun({
          id: "live-1",
          status: "failed",
          started_at: "2026-08-10T00:00:00Z",
          finished_at: "2026-08-10T00:02:00Z",
          runner: { reported_via: "public_ingest" },
        }),
        liveRun({ id: "live-2", status: "running" }),
      ]
    );

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      id: "live-1",
      timestamp: "2026-08-10T00:02:00Z",
      total_duration_ms: 120_000,
      has_issues: true,
      data_source: "live_board",
      live: true,
      selfReported: true,
    });
  });

  it("dedupes live rows already reconciled into history", () => {
    const merged = mergeLiveRunsIntoHistory(
      [run({ id: "manifest-run-1" })],
      [
        liveRun({
          id: "live-1",
          status: "completed",
          run_id: "manifest-run-1",
        }),
      ]
    );
    expect(merged).toHaveLength(1);
  });
});

describe("classifyLiveRun", () => {
  const now = Date.parse("2026-08-10T01:00:00Z");

  it("marks running rows with fresh heartbeats as running", () => {
    expect(
      classifyLiveRun(
        liveRun({ last_heartbeat_at: "2026-08-10T00:59:30Z" }),
        now
      )
    ).toBe("running");
  });

  it("marks running rows with dead heartbeats as stale", () => {
    expect(
      classifyLiveRun(
        liveRun({ last_heartbeat_at: "2026-08-10T00:57:00Z" }),
        now
      )
    ).toBe("stale");
  });

  it("drops a dead run off the docket after a day", () => {
    const dead = liveRun({ last_heartbeat_at: "2026-08-08T00:00:00Z" });
    expect(classifyLiveRun(dead, now)).toBe("expired");
    expect(
      classifyLiveRun(dead, Date.parse("2026-08-08T12:00:00Z"))
    ).toBe("stale");
  });

  it("keeps finished rows for an hour, then expires them", () => {
    const finished = liveRun({
      status: "completed",
      finished_at: "2026-08-10T00:30:00Z",
      last_heartbeat_at: "2026-08-10T00:30:00Z",
    });
    expect(classifyLiveRun(finished, now)).toBe("finished");
    expect(
      classifyLiveRun(finished, Date.parse("2026-08-10T02:00:00Z"))
    ).toBe("expired");
  });
});

describe("graphUrlForSection", () => {
  it("links recorded completions to the compose graph viewer", () => {
    expect(
      graphUrlForSection(
        "us:statutes/26/3121/b/8",
        run({ id: "a", has_issues: false })
      )
    ).toBe("/app?compose=us%3Astatutes%2F26%2F3121%2Fb%2F8");
  });

  it("maps human-readable citations through the corpus path", () => {
    expect(
      graphUrlForSection("26 USC 1(j)(2)", run({ id: "a" }))
    ).toBe("/app?compose=us%3Astatutes%2F26%2F1");
  });

  it("never links live-board completions, failures, or unparseable citations", () => {
    const live = run({ id: "a" }) as ReturnType<typeof run> & {
      live?: boolean;
    };
    live.live = true;
    expect(graphUrlForSection("us:statutes/26/24", live)).toBeNull();
    expect(
      graphUrlForSection("us:statutes/26/24", run({ id: "b", has_issues: true }))
    ).toBeNull();
    expect(graphUrlForSection("Pub. L. 117-169", run({ id: "c" }))).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-08-10T12:00:00Z");

  it("scales from minutes to days", () => {
    expect(relativeTime("2026-08-10T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-08-10T11:15:00Z", now)).toBe("45m ago");
    expect(relativeTime("2026-08-10T03:00:00Z", now)).toBe("9h ago");
    expect(relativeTime("2026-08-01T12:00:00Z", now)).toBe("9d ago");
    expect(relativeTime("2026-05-01T12:00:00Z", now)).toBe("May 1, 2026");
  });
});

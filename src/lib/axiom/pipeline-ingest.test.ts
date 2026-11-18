import { describe, expect, it } from "vitest";
import { commitPrNumber, ingestEvents, isReleaseCase, releaseRoot, type IngestInputs, type PublishRun } from "./pipeline-ingest";

const run = (overrides: Partial<PublishRun>): PublishRun => ({
  id: 1,
  url: "https://github.com/TheAxiomFoundation/axiom-corpus/actions/runs/1",
  headSha: "fd7e7510",
  commitAt: "2026-10-25T15:37:34Z",
  commitMessage: "Merge pull request #933 from TheAxiomFoundation/ingest/us-mt",
  createdAt: "2026-10-25T15:38:07Z",
  updatedAt: "2026-10-25T15:43:49Z",
  conclusion: "success",
  ...overrides,
});

/** Shaped on the live data of 2026-10: rulespec-us's pins and two of its releases. */
function inputs(overrides: Partial<IngestInputs> = {}): IngestInputs {
  return {
    releases: [
      { name: "us-rulespec-2026-08-09-cutover-surface-union", signedAt: "2026-08-10T21:47:28+00:00" },
      { name: "us-rulespec-2026-10-13-snap-fy2026-memo", signedAt: "2026-10-13T17:32:23+00:00" },
      { name: "us-rulespec-2026-10-25-mt-separate-filing", signedAt: "2026-10-25T15:37:34+00:00" },
      { name: "be-rulespec-2026-08-23", signedAt: "2026-08-23T21:37:27+00:00" },
    ],
    runs: [
      // Two failed publish runs of mt-separate-filing, then the one that uploaded it.
      run({ id: 11, conclusion: "failure", createdAt: "2026-10-25T15:38:07Z", updatedAt: "2026-10-25T15:43:49Z" }),
      run({ id: 12, conclusion: "cancelled", createdAt: "2026-10-25T16:06:31Z", updatedAt: "2026-10-25T16:13:25Z" }),
      run({ id: 13, conclusion: "success", createdAt: "2026-10-25T16:19:51Z", updatedAt: "2026-10-25T16:34:57Z" }),
      run({ id: 14, conclusion: "success", createdAt: "2026-10-26T09:00:00Z", updatedAt: "2026-10-26T09:10:00Z" }),
      // A run whose commit cut no release.
      run({ id: 15, commitAt: "2026-10-26T18:00:00Z", commitMessage: "Merge pull request #940 from x" }),
    ],
    prs: { 933: { number: 933, url: "https://github.com/TheAxiomFoundation/axiom-corpus/pull/933", createdAt: "2026-10-25T11:45:00Z", mergedAt: "2026-10-25T15:37:34Z" } },
    activations: [
      { release_name: "us-rulespec-2026-08-09-cutover-surface-union", activated_at: "2026-08-24T12:05:22+00:00" },
      { release_name: "us-rulespec-2026-08-09-cutover-surface-union", activated_at: "2026-08-23T12:05:22+00:00" },
      { release_name: "be-rulespec-2026-08-23", activated_at: "2026-08-23T21:44:51+00:00" },
    ],
    pins: [
      { repo: "rulespec-us", release: "us-rulespec-2026-10-13-snap-fy2026-memo", at: "2026-10-14T14:35:28Z", ref_url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/1759" },
      { repo: "rulespec-us", release: "us-rulespec-2026-10-25-mt-separate-filing", at: "2026-10-26T19:26:56Z", ref_url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/1914" },
      { repo: "rulespec-be", release: "be-rulespec-2026-07-10", at: "2026-07-12T00:00:00Z", ref_url: null },
    ],
    toActivate: [{ jurisdiction: "us", release: "us-rulespec-2026-10-25-mt-separate-filing" }],
    ...overrides,
  };
}

const at = (events: ReturnType<typeof ingestEvents>, release: string, station: string) =>
  events.filter((e) => e.case_id === `release:${release}` && e.station === station).map((e) => ({ kind: e.kind, at: e.at, ms: e.duration_ms, try_no: e.try_no, outcome: e.outcome, rule: e.rule_id }));

describe("releaseRoot / commitPrNumber / isReleaseCase", () => {
  it("reads a release's jurisdiction from its name", () => {
    expect(releaseRoot("us-rulespec-2026-10-29-ecfr-section-text")).toBe("us");
    expect(releaseRoot("tz-znz-rulespec-2026-07-16")).toBe("tz-znz");
    expect(releaseRoot("uk-legislation-pilot")).toBe("uk");
    expect(releaseRoot("us-sc-snap-2026-07-15")).toBe("us");
  });

  it("reads the PR a merge commit names", () => {
    expect(commitPrNumber("Merge pull request #945 from TheAxiomFoundation/release/x")).toBe(945);
    expect(commitPrNumber("Merge PR #647: signed DE Kindergeld dependency cap")).toBe(647);
    expect(commitPrNumber("Allow large corpus releases to finish publication (#574)")).toBe(574);
    expect(commitPrNumber("Direct push")).toBeNull();
    expect(commitPrNumber(null)).toBeNull();
  });

  it("tells release cases from encode cases", () => {
    expect(isReleaseCase("release:us-rulespec-1")).toBe(true);
    expect(isReleaseCase("41127692566")).toBe(false);
  });
});

describe("ingestEvents", () => {
  const events = ingestEvents(inputs());
  const mt = "us-rulespec-2026-10-25-mt-separate-filing";

  it("times corpus ingest by the PR the release's commit merged", () => {
    expect(at(events, mt, "corpus_ingest")).toEqual([
      expect.objectContaining({ kind: "enter", at: "2026-10-25T11:45:00Z" }),
      expect.objectContaining({ kind: "leave", at: "2026-10-25T15:37:34Z", ms: 3 * 3_600_000 + 52 * 60_000 + 34_000 }),
    ]);
    expect(events.find((e) => e.case_id === `release:${mt}`)).toMatchObject({ citation: mt, jurisdiction: "us", source: "corpus_release" });
  });

  it("makes each publish run up to the first success a try, a failed or cancelled run a failed one", () => {
    expect(at(events, mt, "release_publish")).toEqual([
      { kind: "enter", at: "2026-10-25T15:38:07Z", ms: null, try_no: 1, outcome: null, rule: null },
      { kind: "fail", at: "2026-10-25T15:43:49Z", ms: 342_000, try_no: 1, outcome: "fail", rule: "release:publish-failure" },
      { kind: "enter", at: "2026-10-25T16:06:31Z", ms: null, try_no: 2, outcome: null, rule: null },
      { kind: "fail", at: "2026-10-25T16:13:25Z", ms: 414_000, try_no: 2, outcome: "fail", rule: "release:publish-cancelled" },
      { kind: "enter", at: "2026-10-25T16:19:51Z", ms: null, try_no: 3, outcome: null, rule: null },
      { kind: "leave", at: "2026-10-25T16:34:57Z", ms: 906_000, try_no: 3, outcome: "ok", rule: null },
    ]);
  });

  it("measures the pin lag from the upload to the pin that names it", () => {
    expect(at(events, mt, "release_pin")).toEqual([
      expect.objectContaining({ kind: "enter", at: "2026-10-25T16:34:57Z" }),
      expect.objectContaining({ kind: "leave", at: "2026-10-26T19:26:56Z", outcome: "ok", ms: Date.parse("2026-10-26T19:26:56Z") - Date.parse("2026-10-25T16:34:57Z") }),
    ]);
  });

  it("waits at activation only for the release its jurisdiction should activate next", () => {
    expect(at(events, mt, "release_activate")).toEqual([
      expect.objectContaining({ kind: "enter", at: "2026-10-25T16:34:57Z" }),
      expect.objectContaining({ kind: "wait", rule: "release:not-activated" }),
    ]);
    // A pin-only release that is not next never visits activation.
    expect(at(events, "us-rulespec-2026-10-13-snap-fy2026-memo", "release_activate")).toEqual([]);
  });

  it("counts a served release as pinned when its repo pins a release signed after it", () => {
    const cutover = "us-rulespec-2026-08-09-cutover-surface-union";
    // No run read: the signed time stands for ingest and publish, untimed.
    expect(at(events, cutover, "corpus_ingest").map((e) => e.ms)).toEqual([null, null]);
    expect(events.filter((e) => e.case_id === `release:${cutover}` && e.kind === "leave").every((e) => e.station !== "release_publish" || e.attrs.untimed)).toBe(true);
    // The first activation, of two.
    expect(at(events, cutover, "release_activate")[1]).toMatchObject({ kind: "leave", at: "2026-08-23T12:05:22+00:00" });
    const pin = events.find((e) => e.case_id === `release:${cutover}` && e.station === "release_pin" && e.kind === "leave")!;
    expect(pin).toMatchObject({ at: "2026-10-14T14:35:28Z", outcome: "superseded", attrs: { repo: "rulespec-us", pinned: "us-rulespec-2026-10-13-snap-fy2026-memo" } });
    // 64 days and 17 hours behind.
    expect(Math.round(pin.duration_ms! / 3_600_000)).toBe(1553);
  });

  it("keeps a served release waiting while its repo pins an older one", () => {
    expect(at(events, "be-rulespec-2026-08-23", "release_pin")).toEqual([
      expect.objectContaining({ kind: "enter" }),
      expect.objectContaining({ kind: "wait", outcome: "not_pinned", rule: "release:not-pinned" }),
    ]);
    expect(events.find((e) => e.case_id === "release:be-rulespec-2026-08-23" && e.kind === "wait")?.ref_url).toBe(
      "https://github.com/TheAxiomFoundation/rulespec-be/blob/main/.axiom/toolchain.toml"
    );
  });

  it("leaves releases neither served nor pinned out of the pin station, and gives shared commits no runs", () => {
    const shared = ingestEvents(
      inputs({
        releases: [
          { name: "et-rulespec-2026-07-12", signedAt: "2026-10-25T15:37:34Z" },
          { name: "zm-rulespec-2026-07-12", signedAt: "2026-10-25T15:37:34Z" },
        ],
        activations: [],
        prs: {},
      })
    );
    expect(shared.some((e) => e.station === "release_pin" || e.station === "release_activate")).toBe(false);
    expect(shared.filter((e) => e.station === "release_publish" && e.kind === "leave").every((e) => e.attrs.untimed)).toBe(true);
    // The PR is named, but without its record the ingest is a point at the commit.
    expect(shared.find((e) => e.station === "corpus_ingest")?.ref_url).toBe("https://github.com/TheAxiomFoundation/axiom-corpus/pull/933");
  });

  it("gives every event a stable id", () => {
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ingestEvents(inputs()).map((e) => e.id)).toEqual(ids);
  });
});

/**
 * The corpus end of the encoding line as pipeline events: one case per
 * signed corpus release (`release:<name>`), through the four stations a
 * release passes before an encode can read it.
 *
 *   corpus_ingest     the axiom-corpus PR whose merge commit the release is
 *                     cut from (its documents and manifest), open to merge
 *   release_publish   axiom-corpus's publish workflow signs and uploads it;
 *                     one visit per run, a failed run is a failed try
 *   release_activate  its first activation: the site serves it
 *   release_pin       the jurisdiction's rulespec repo pins it in
 *                     `.axiom/toolchain.toml`, or pins a release signed after
 *                     it: from the upload to that pin is the pin lag
 *
 * A release visits release_activate only once activated, or while it is
 * the release its jurisdiction should activate next (the Program coverage
 * tab's "Newer release not activated"); a pin-only release is never meant
 * to serve. It visits release_pin when a repo pinned it or when it served,
 * and waits there until its repo pins it or a later release.
 *
 * Sources: corpus.release_objects (name, signed time),
 * corpus.scope_activation_history, axiom-corpus's publish.yml runs (a run
 * belongs to the release whose signed time is its head commit's time; the
 * signed time is that commit's), the PR that commit merged, and each rulespec
 * repo's toolchain history (pipeline-ingest-data.ts reads them).
 */

import type { PipelineEvent } from "./pipeline-events";

export const ORG_URL = "https://github.com/TheAxiomFoundation";
export const CORPUS_REPO_URL = `${ORG_URL}/axiom-corpus`;

/** A signed release: corpus.release_objects' name and signed time (its axiom-corpus commit's time). */
export interface IngestRelease {
  name: string;
  signedAt: string;
}

/** One run of axiom-corpus's publish workflow. */
export interface PublishRun {
  id: number;
  url: string;
  headSha: string;
  /** The head commit's time and first message line. */
  commitAt: string | null;
  commitMessage: string | null;
  createdAt: string;
  updatedAt: string;
  conclusion: string | null;
}

/** An axiom-corpus PR. */
export interface CorpusPr {
  number: number;
  url: string;
  createdAt: string;
  mergedAt: string | null;
}

/** When a repo's default branch first pinned a release. */
export interface PinRecord {
  repo: string;
  release: string;
  at: string;
  ref_url: string | null;
}

export interface IngestInputs {
  releases: IngestRelease[];
  runs: PublishRun[];
  /** axiom-corpus PRs by number. */
  prs: Record<number, CorpusPr>;
  /** corpus.scope_activation_history rows. */
  activations: Array<{ release_name: string; activated_at: string }>;
  pins: PinRecord[];
  /** Each jurisdiction's release to activate next. */
  toActivate: Array<{ jurisdiction: string; release: string }>;
}

/** The jurisdiction a release is cut for: its name before `-rulespec`, else its first segment. */
export function releaseRoot(name: string): string {
  const at = name.indexOf("-rulespec");
  return at > 0 ? name.slice(0, at) : name.split("-")[0];
}

/** The PR a merge commit names: "Merge pull request #945 from …", "Merge PR #647: …", "Title (#123)". */
export function commitPrNumber(message: string | null | undefined): number | null {
  if (!message) return null;
  const line = message.split("\n")[0];
  const match = /^Merge (?:pull request|PR) #(\d+)/i.exec(line) ?? /\(#(\d+)\)\s*$/.exec(line);
  return match ? Number(match[1]) : null;
}

/** An instant to the second, so a database time and a git time compare. */
const second = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

function spanMs(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

const earlier = (a: string, b: string) => (Date.parse(a) <= Date.parse(b) ? a : b);

/** Every release's ingest events, in line order. */
export function ingestEvents(inputs: IngestInputs): PipelineEvent[] {
  const signed = new Map(inputs.releases.map((r) => [r.name, Date.parse(r.signedAt)]));
  // A release and its publish runs share a commit: the runs whose head
  // commit has the release's signed time. Two releases cut from one commit
  // cannot be told apart, so neither gets runs.
  const releasesAt = new Map<number, number>();
  for (const r of inputs.releases) {
    const s = second(r.signedAt);
    if (s != null) releasesAt.set(s, (releasesAt.get(s) ?? 0) + 1);
  }
  const runsAt = new Map<number, PublishRun[]>();
  for (const run of inputs.runs) {
    const s = run.commitAt ? second(run.commitAt) : null;
    if (s == null) continue;
    runsAt.set(s, [...(runsAt.get(s) ?? []), run]);
  }
  const activated = new Map<string, string>();
  for (const a of inputs.activations) {
    const seen = activated.get(a.release_name);
    if (!seen || Date.parse(a.activated_at) < Date.parse(seen)) activated.set(a.release_name, a.activated_at);
  }
  const pinsByRepo = new Map<string, PinRecord[]>();
  for (const p of inputs.pins) pinsByRepo.set(p.repo, [...(pinsByRepo.get(p.repo) ?? []), p]);
  for (const list of pinsByRepo.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const toActivate = new Set(inputs.toActivate.map((t) => t.release));

  const events: PipelineEvent[] = [];
  for (const release of inputs.releases) {
    const caseId = `release:${release.name}`;
    const jurisdiction = releaseRoot(release.name);
    const seq = new Map<string, number>();
    const ev = (partial: Partial<PipelineEvent> & Pick<PipelineEvent, "station" | "kind" | "at">) => {
      const key = `${partial.station}/${partial.kind}`;
      const n = seq.get(key) ?? 0;
      seq.set(key, n + 1);
      events.push({
        id: `${caseId}/${key}/${partial.try_no ?? n}`,
        case_id: caseId,
        citation: release.name,
        jurisdiction,
        duration_ms: null,
        outcome: null,
        try_no: null,
        rule_id: null,
        message: null,
        actor: null,
        cost_usd: null,
        encoder_version: null,
        source: "corpus_release",
        ref_url: null,
        ...partial,
        attrs: { case_source: "release", ...(partial.attrs ?? {}) },
      });
    };

    const at = second(release.signedAt);
    // The commit's runs name its PR; they are the release's publish runs only when no other release shares the commit.
    const commitRuns = at != null ? [...(runsAt.get(at) ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)) : [];
    const runs = at != null && releasesAt.get(at) === 1 ? commitRuns : [];

    // Corpus ingest: the PR the release's commit merged, open to merge.
    const prNumber = commitPrNumber(commitRuns[0]?.commitMessage);
    const pr = prNumber != null ? inputs.prs[prNumber] : undefined;
    if (pr?.mergedAt) {
      ev({ station: "corpus_ingest", kind: "enter", at: earlier(pr.createdAt, release.signedAt), ref_url: pr.url });
      ev({ station: "corpus_ingest", kind: "leave", at: pr.mergedAt, outcome: "ok", duration_ms: spanMs(pr.createdAt, pr.mergedAt), ref_url: pr.url, attrs: { pr: pr.number } });
    } else {
      // Without the PR only the commit's time is known: a point, untimed.
      const ref = prNumber != null ? `${CORPUS_REPO_URL}/pull/${prNumber}` : commitRuns[0] ? `${CORPUS_REPO_URL}/commit/${commitRuns[0].headSha}` : null;
      ev({ station: "corpus_ingest", kind: "enter", at: release.signedAt, ref_url: ref });
      ev({ station: "corpus_ingest", kind: "leave", at: release.signedAt, outcome: "ok", ref_url: ref, attrs: { untimed: true } });
    }

    // Release publish: each publish run of the commit up to the first that succeeded.
    let publishedAt = release.signedAt;
    const success = runs.findIndex((r) => r.conclusion === "success");
    if (success >= 0) {
      runs.slice(0, success + 1).forEach((run, i) => {
        const tryNo = i + 1;
        ev({ station: "release_publish", kind: "enter", at: run.createdAt, try_no: tryNo, ref_url: run.url });
        const ms = spanMs(run.createdAt, run.updatedAt);
        if (run.conclusion === "success") {
          ev({ station: "release_publish", kind: "leave", at: run.updatedAt, try_no: tryNo, outcome: "ok", duration_ms: ms, ref_url: run.url });
        } else {
          ev({
            station: "release_publish",
            kind: "fail",
            at: run.updatedAt,
            try_no: tryNo,
            outcome: "fail",
            duration_ms: ms,
            rule_id: `release:publish-${run.conclusion ?? "failure"}`,
            ref_url: run.url,
          });
        }
      });
      publishedAt = runs[success].updatedAt;
    } else {
      // Registered by another path, or before the runs read: the signed time only.
      ev({ station: "release_publish", kind: "enter", at: release.signedAt });
      ev({ station: "release_publish", kind: "leave", at: release.signedAt, outcome: "ok", attrs: { untimed: true } });
    }

    // Release activate: the first activation; a person activates.
    const activatedAt = activated.get(release.name);
    if (activatedAt) {
      const from = earlier(publishedAt, activatedAt);
      ev({ station: "release_activate", kind: "enter", at: from });
      ev({ station: "release_activate", kind: "leave", at: activatedAt, outcome: "ok", duration_ms: spanMs(from, activatedAt) });
    } else if (toActivate.has(release.name)) {
      ev({ station: "release_activate", kind: "enter", at: publishedAt });
      ev({ station: "release_activate", kind: "wait", at: publishedAt, outcome: "not_activated", rule_id: "release:not-activated" });
    }

    // Release pin: the repo that pinned it, or the jurisdiction's repo once it served.
    const own = inputs.pins.filter((p) => p.release === release.name).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    const repo = own?.repo ?? `rulespec-${jurisdiction}`;
    const repoPins = pinsByRepo.get(repo);
    if (!own && !(activatedAt && repoPins?.length)) continue;
    const signedMs = signed.get(release.name)!;
    const cover = (repoPins ?? []).find(
      (p) => Date.parse(p.at) >= signedMs && (p.release === release.name || (signed.get(p.release) ?? -Infinity) > signedMs)
    );
    ev({ station: "release_pin", kind: "enter", at: publishedAt, attrs: { repo } });
    if (cover) {
      const pinnedItself = cover.release === release.name;
      ev({
        station: "release_pin",
        kind: "leave",
        at: cover.at,
        outcome: pinnedItself ? "ok" : "superseded",
        duration_ms: spanMs(publishedAt, cover.at),
        ref_url: cover.ref_url,
        message: pinnedItself ? null : `${repo} pinned ${cover.release}, signed after it`,
        attrs: { repo, pinned: cover.release },
      });
    } else {
      ev({
        station: "release_pin",
        kind: "wait",
        at: publishedAt,
        outcome: "not_pinned",
        rule_id: "release:not-pinned",
        ref_url: `${ORG_URL}/${repo}/blob/main/.axiom/toolchain.toml`,
        attrs: { repo },
      });
    }
  }
  return events;
}

/** Whether a case is a corpus release's (the ingest stations) rather than an encode's. */
export function isReleaseCase(caseId: string): boolean {
  return caseId.startsWith("release:");
}

/** The stations a release passes, in line order. */
export const INGEST_STATIONS = ["corpus_ingest", "release_publish", "release_activate", "release_pin"] as const;

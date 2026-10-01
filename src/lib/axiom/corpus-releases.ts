/**
 * Stage 0 of the /ops pipeline: the signed corpus releases each jurisdiction
 * is encoded from. A release is cut in axiom-corpus, signed by its publish
 * workflow, and activated by a person; activation is what the site serves,
 * and each rulespec repo separately pins the release its encodes and
 * validation read (`.axiom/toolchain.toml`). This module says, per
 * jurisdiction, whether those three agree.
 *
 * Sources: corpus.release_objects (every registered signed release),
 * corpus.active_scope_pointer (what serves, per jurisdiction and document
 * class), each rulespec repo's toolchain pin, and axiom-corpus's open PRs and
 * publish runs on GitHub. Everything is best-effort: a source that cannot be
 * read leaves its part of the view empty.
 */

import { unstable_cache } from "next/cache";
import { getSupabaseRestConfig, readSupabaseRows } from "@/lib/corpus-status";
import { EXTRA_JURISDICTION_LABELS, JURISDICTIONS_SEED } from "./jurisdictions-seed";

const REVALIDATE_SECONDS = 300;
const CORPUS_REPO = "TheAxiomFoundation/axiom-corpus";
const PIN_URL = (jurisdiction: string) =>
  `https://raw.githubusercontent.com/TheAxiomFoundation/rulespec-${jurisdiction}/main/.axiom/toolchain.toml`;

export interface SignedRelease {
  name: string;
  signedAt: string;
  /** Every jurisdiction the release has a scope in. */
  jurisdictions: string[];
  scopes: number;
}

export interface ServingPointer {
  jurisdiction: string;
  document_class: string;
  release_name: string;
  activated_at: string;
}

export type CorpusStatus =
  | "not_serving"
  | "newer_not_active"
  | "encoder_behind"
  | "encoder_off"
  | "current";

export const CORPUS_STATUS_LABELS: Record<CorpusStatus, string> = {
  not_serving: "Not serving: no release activated",
  newer_not_active: "Newer release not activated",
  encoder_behind: "Encoder reads an older release",
  encoder_off: "Encoder reads a release the site doesn't serve",
  current: "Up to date",
};

export interface CorpusJurisdiction {
  jurisdiction: string;
  name: string;
  status: CorpusStatus;
  /** The release serving most recently activated, with its scope count. */
  serving: { release: string; since: string; scopes: number } | null;
  newest: { release: string; signedAt: string; scopes: number };
  /** The release the jurisdiction's rulespec repo reads; null with no repo or pin. */
  encoder: { repo: string; release: string; registered: boolean } | null;
  /** When the mismatch began, for its age; null when up to date. */
  since: string | null;
}

export interface CorpusView {
  /** Out of sync first (longest first), then up to date, by name. */
  jurisdictions: CorpusJurisdiction[];
  outOfSync: number;
  openPrs: { count: number; oldestAt: string | null; url: string } | null;
  lastPublish: { conclusion: string; at: string; url: string } | null;
}

const NAMES: Record<string, string> = {
  ...Object.fromEntries(JURISDICTIONS_SEED.map((j) => [j.slug, j.label])),
  ...EXTRA_JURISDICTION_LABELS,
  // A release named for "us" carries the states too.
  us: "United States",
  am: "Armenia",
  bo: "Bolivia",
  co: "Colombia",
  de: "Germany",
  ec: "Ecuador",
  eg: "Egypt",
  et: "Ethiopia",
  gh: "Ghana",
  mz: "Mozambique",
  ng: "Nigeria",
  pe: "Peru",
  rw: "Rwanda",
  tz: "Tanzania",
  "tz-znz": "Zanzibar",
  ug: "Uganda",
  vn: "Vietnam",
  zm: "Zambia",
};

/**
 * The jurisdiction a release is for: the scope jurisdiction its name starts
 * with (a "us-rulespec-..." union also carries every state), else its
 * shortest one.
 */
export function releaseJurisdiction(release: Pick<SignedRelease, "name" | "jurisdictions">): string | null {
  const byLength = [...release.jurisdictions].sort((a, b) => a.length - b.length);
  return byLength.find((j) => release.name.startsWith(`${j}-`)) ?? byLength[0] ?? null;
}

/** The release a rulespec repo's `.axiom/toolchain.toml` pins, if any. */
export function parsePin(toml: string): string | null {
  return /^axiom_corpus_release\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
}

export function corpusView(
  releases: SignedRelease[],
  pointers: ServingPointer[],
  pins: Record<string, string>,
  extras: Pick<CorpusView, "openPrs" | "lastPublish"> = { openPrs: null, lastPublish: null }
): CorpusView {
  const byName = new Map(releases.map((r) => [r.name, r]));
  const owner = (name: string) => {
    const release = byName.get(name);
    return release ? releaseJurisdiction(release) : null;
  };

  const signed = new Map<string, SignedRelease[]>();
  for (const release of releases) {
    const jurisdiction = releaseJurisdiction(release);
    if (!jurisdiction) continue;
    signed.set(jurisdiction, [...(signed.get(jurisdiction) ?? []), release]);
  }
  // When each release a jurisdiction serves was last activated.
  const serving = new Map<string, Map<string, string>>();
  for (const pointer of pointers) {
    const jurisdiction = owner(pointer.release_name) ?? pointer.jurisdiction;
    const releasesServing = serving.get(jurisdiction) ?? new Map<string, string>();
    const seen = releasesServing.get(pointer.release_name);
    if (!seen || pointer.activated_at > seen) {
      releasesServing.set(pointer.release_name, pointer.activated_at);
    }
    serving.set(jurisdiction, releasesServing);
  }

  const rows: CorpusJurisdiction[] = [];
  for (const [jurisdiction, list] of signed) {
    const newest = [...list].sort((a, b) => a.signedAt.localeCompare(b.signedAt)).at(-1)!;
    const active = serving.get(jurisdiction) ?? new Map<string, string>();
    const [current] = [...active.entries()].sort((a, b) => b[1].localeCompare(a[1]));
    const pin = pins[jurisdiction];
    const pinned = pin ? byName.get(pin) : undefined;

    let status: CorpusStatus = "current";
    let since: string | null = null;
    if (!current) {
      status = "not_serving";
      since = list.map((r) => r.signedAt).sort()[0];
    } else if (!active.has(newest.name) && newest.signedAt > current[1]) {
      status = "newer_not_active";
      since = newest.signedAt;
    } else if (pin && !active.has(pin)) {
      const servingRelease = byName.get(current[0]);
      const older = pinned && servingRelease && pinned.signedAt < servingRelease.signedAt;
      status = older ? "encoder_behind" : "encoder_off";
      since = older ? current[1] : (pinned?.signedAt ?? null);
    }

    rows.push({
      jurisdiction,
      name: NAMES[jurisdiction] ?? jurisdiction,
      status,
      serving: current
        ? { release: current[0], since: current[1], scopes: byName.get(current[0])?.scopes ?? 0 }
        : null,
      newest: { release: newest.name, signedAt: newest.signedAt, scopes: newest.scopes },
      encoder: pin
        ? { repo: `rulespec-${jurisdiction}`, release: pin, registered: byName.has(pin) }
        : null,
      since,
    });
  }

  rows.sort((a, b) => {
    const aCurrent = a.status === "current";
    if (aCurrent !== (b.status === "current")) return aCurrent ? 1 : -1;
    if (!aCurrent && a.since !== b.since) return (a.since ?? "").localeCompare(b.since ?? "");
    return a.name.localeCompare(b.name);
  });
  return {
    jurisdictions: rows,
    outOfSync: rows.filter((row) => row.status !== "current").length,
    ...extras,
  };
}

interface ReleaseObjectRow {
  release_name: string;
  created_at: string;
  scopes: Array<{ jurisdiction?: string }> | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const token = (process.env.AXIOM_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim();
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token && url.startsWith("https://api.github.com/") ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  } as RequestInit);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json() as Promise<T>;
}

async function readPin(jurisdiction: string): Promise<string | null> {
  try {
    const response = await fetch(PIN_URL(jurisdiction), { cache: "no-store" } as RequestInit);
    return response.ok ? parsePin(await response.text()) : null;
  } catch {
    return null;
  }
}

async function readOpenPrs(): Promise<CorpusView["openPrs"]> {
  try {
    const result = await fetchJson<{ total_count: number; items: Array<{ created_at: string }> }>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${CORPUS_REPO} is:pr is:open`)}&sort=created&order=asc&per_page=1`
    );
    return {
      count: result.total_count,
      oldestAt: result.items[0]?.created_at ?? null,
      url: `https://github.com/${CORPUS_REPO}/pulls`,
    };
  } catch {
    return null;
  }
}

/** The newest publish run that finished either way (cancellations are routine). */
async function readLastPublish(): Promise<CorpusView["lastPublish"]> {
  try {
    const result = await fetchJson<{
      workflow_runs: Array<{ conclusion: string | null; created_at: string; html_url: string }>;
    }>(`https://api.github.com/repos/${CORPUS_REPO}/actions/workflows/publish.yml/runs?status=completed&per_page=10`);
    const run = result.workflow_runs.find((r) => r.conclusion === "success" || r.conclusion === "failure");
    return run ? { conclusion: run.conclusion!, at: run.created_at, url: run.html_url } : null;
  } catch {
    return null;
  }
}

/**
 * Exported for tests; production callers use getCorpusView. Throws when the
 * release tables cannot be read, so a failure is never cached.
 */
export async function readCorpusView(): Promise<CorpusView> {
  const config = getSupabaseRestConfig();
  if (!config) throw new Error("Supabase is not configured");
  const [objects, pointers, openPrs, lastPublish] = await Promise.all([
    readSupabaseRows<ReleaseObjectRow>(
      config,
      "corpus",
      "release_objects",
      { select: "release_name,created_at,scopes:release_object->content->scopes", limit: "1000" },
      { fresh: true }
    ),
    readSupabaseRows<ServingPointer>(
      config,
      "corpus",
      "active_scope_pointer",
      { select: "jurisdiction,document_class,release_name,activated_at", limit: "5000" },
      { fresh: true }
    ),
    readOpenPrs(),
    readLastPublish(),
  ]);
  const releases: SignedRelease[] = objects.map((row) => ({
    name: row.release_name,
    signedAt: row.created_at,
    jurisdictions: [
      ...new Set((row.scopes ?? []).map((s) => s.jurisdiction).filter((j): j is string => !!j)),
    ],
    scopes: row.scopes?.length ?? 0,
  }));
  const jurisdictions = [
    ...new Set(releases.map(releaseJurisdiction).filter((j): j is string => !!j)),
  ];
  const pins: Record<string, string> = {};
  await Promise.all(
    jurisdictions.map(async (jurisdiction) => {
      const pin = await readPin(jurisdiction);
      if (pin) pins[jurisdiction] = pin;
    })
  );
  return corpusView(releases, pointers, pins, { openPrs, lastPublish });
}

const cachedCorpusView = unstable_cache(readCorpusView, ["ops-corpus-releases-v1"], {
  revalidate: REVALIDATE_SECONDS,
});

/** The corpus view, recomputed at most every REVALIDATE_SECONDS; null when unreadable. */
export async function getCorpusView(): Promise<CorpusView | null> {
  try {
    return await cachedCorpusView();
  } catch {
    return null;
  }
}

/** The view for one top-level jurisdiction (a "us" release carries the states). */
export function scopeCorpus(view: CorpusView, root: string | null): CorpusView {
  if (!root) return view;
  const jurisdictions = view.jurisdictions.filter(
    (row) => row.jurisdiction === root || row.jurisdiction.startsWith(`${root}-`)
  );
  return {
    ...view,
    jurisdictions,
    outOfSync: jurisdictions.filter((row) => row.status !== "current").length,
  };
}

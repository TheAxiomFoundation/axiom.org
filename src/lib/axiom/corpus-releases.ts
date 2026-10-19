/**
 * Stage 0 of the /ops pipeline: the signed corpus releases each jurisdiction
 * is encoded from. A release is cut in axiom-corpus, signed by its publish
 * workflow, and activated by a person; activation is what the site serves,
 * and each rulespec repo separately pins the release its encodes and
 * validation read (`.axiom/toolchain.toml`). This module says, per
 * jurisdiction, whether those three agree.
 *
 * Releases are compared by the scope versions they hold, not by name: a
 * scope version (jurisdiction, document class, version) is immutable, so two
 * releases with the same scope versions hold the same text, and a release
 * that lacks a served scope version would drop its provisions if activated
 * or read by the encoder.
 *
 * Sources: corpus.release_objects (every registered signed release, with its
 * scopes), corpus.active_scope_pointer (what serves, per jurisdiction and
 * document class, and since when), corpus.current_release_scopes (the scope
 * versions that serve), each rulespec repo's toolchain pin, axiom-corpus's
 * release manifests, and axiom-corpus's open PRs and publish runs on GitHub.
 * The GitHub parts are best-effort: a source that cannot be read leaves its
 * part of the view empty.
 */

import { unstable_cache } from "next/cache";
import {
  getSupabaseRestConfig,
  readSupabaseRows,
  type SupabaseRestConfig,
} from "@/lib/corpus-status";
import { jurisdictionName } from "./jurisdiction-names";

const REVALIDATE_SECONDS = 300;
const ORG = "TheAxiomFoundation";
const CORPUS_REPO = `${ORG}/axiom-corpus`;
const PIN_URL = (jurisdiction: string) =>
  `https://raw.githubusercontent.com/${ORG}/rulespec-${jurisdiction}/main/.axiom/toolchain.toml`;
const MANIFEST_URL = (release: string) =>
  `https://raw.githubusercontent.com/${CORPUS_REPO}/main/manifests/releases/${encodeURIComponent(release)}.json`;
const REPO_SEARCH_URL = `https://api.github.com/search/repositories?q=${encodeURIComponent(
  `org:${ORG} rulespec- in:name archived:false`
)}&per_page=100`;
/** A jurisdiction's rulespec repo: `rulespec-us`, `rulespec-tz-znz`; not `rulespec-graph-viewer`. */
const RULESPEC_REPO_RE = /^rulespec-([a-z]{2}(?:-[a-z0-9]+)*)$/;
/**
 * Fallback when the repository search is unavailable: the jurisdictions with
 * a live (not archived) rulespec repo as of 2026-10-14.
 */
const KNOWN_RULESPEC_JURISDICTIONS = [
  "am", "be", "bo", "ca", "ch", "co", "de", "dk", "ec", "eg", "es", "et", "fr", "gh",
  "il", "mz", "ng", "no", "nz", "pe", "rw", "tz", "ug", "uk", "us", "vn", "zm",
];
/**
 * Release objects per read. A US union's scope list is ~600 KB, and a read
 * of every release at once runs past the database's statement timeout.
 */
const RELEASE_PAGE = 10;
/** Rows per read: the REST API returns at most 1,000. */
const ROW_PAGE = 1000;
const MAX_PAGES = 50;

export interface ReleaseScope {
  jurisdiction: string;
  document_class: string;
  version: string;
  /** Provisions the scope version projects (the release object's provision_rows). */
  provisions?: number;
}

export interface SignedRelease {
  name: string;
  signedAt: string;
  /** Every jurisdiction the release has a scope in. */
  jurisdictions: string[];
  scopes: ReleaseScope[];
}

export interface ServingPointer {
  jurisdiction: string;
  document_class: string;
  release_name: string;
  activated_at: string;
}

/** A scope version the site serves (a corpus.current_release_scopes row). */
export interface ServedScope {
  release_name: string;
  jurisdiction: string;
  document_class: string;
  version: string;
}

/** What a rulespec repo's `.axiom/toolchain.toml` pins. */
export interface EncoderPin {
  /** The pinned release; null for a placeholder file that names none. */
  release: string | null;
  /** The pinned release is not signed but has a release manifest in axiom-corpus. */
  manifest?: boolean;
}

/** Every way a jurisdiction can be out of sync, most actionable first. */
export const CORPUS_FLAGS = [
  "newer_not_active",
  "encoder_lacks",
  "encoder_off",
  "encoder_other",
  "not_serving",
  "pin_unsigned",
  "pin_unknown",
  "no_release",
] as const;

export type CorpusFlag = (typeof CORPUS_FLAGS)[number];

export const CORPUS_FLAG_LABELS: Record<CorpusFlag, string> = {
  newer_not_active: "Newer release not activated",
  encoder_lacks: "Encoder reads a release that lacks served scope versions",
  encoder_off: "Encoder reads scope versions the site doesn't serve",
  encoder_other: "Encoder pins another release with the same scopes",
  not_serving: "Not serving: no release activated",
  pin_unsigned: "Pin names an unsigned manifest",
  pin_unknown: "Pin names no known release",
  no_release: "No release cut yet",
};

export interface CorpusJurisdiction {
  jurisdiction: string;
  name: string;
  /** Every way it is out of sync, in CORPUS_FLAGS order; empty when up to date. */
  flags: CorpusFlag[];
  /**
   * What serves: the release most recently activated and when, how many
   * releases and scope versions serve, and their provisions.
   */
  serving: {
    release: string;
    since: string;
    releases: number;
    scopes: number;
    provisions: number | null;
  } | null;
  /** The newest signed release, whatever it holds; null with none. */
  newest: { release: string; signedAt: string; scopes: number } | null;
  /**
   * The release to activate next: the newest one signed after what serves
   * that keeps every served scope version (or a later ingest of it) and adds
   * at least one.
   */
  next: { release: string; signedAt: string; scopes: number; adds: number } | null;
  /**
   * The newest release signed after what serves (and after `next`) that
   * would drop served scope versions: a narrow or side release, listed only.
   */
  other: { release: string; signedAt: string; scopes: number; lacks: number } | null;
  /** The release the jurisdiction's rulespec repo pins; null with no repo or pin file. */
  encoder: {
    repo: string;
    release: string | null;
    /** signed: a registered release; manifest: an unsigned release manifest; unknown: neither; placeholder: names none. */
    state: "signed" | "manifest" | "unknown" | "placeholder";
    /** Served scope versions the pinned release lacks; null when not compared. */
    lacks: number | null;
    /** Scope versions the pinned release holds that the site doesn't serve; null when not compared. */
    extra: number | null;
  } | null;
  /** When its first flag's mismatch began, for its age; null when up to date or unknown. */
  since: string | null;
}

export interface CorpusView {
  /** Out of sync first (longest first), then up to date, by name. */
  jurisdictions: CorpusJurisdiction[];
  outOfSync: number;
  /** axiom-corpus's open PRs; `draft` is null when the draft count is unreadable. */
  openPrs: { count: number; draft: number | null; oldestAt: string | null; url: string } | null;
  lastPublish: { conclusion: string; at: string; url: string } | null;
}

export interface CorpusInputs {
  releases: SignedRelease[];
  pointers: ServingPointer[];
  served: ServedScope[];
  /** Toolchain pins by jurisdiction. */
  pins: Record<string, EncoderPin>;
  /** Jurisdictions with a rulespec repo, listed even before their first release. */
  repos?: string[];
}

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

const scopeKey = (scope: Omit<ReleaseScope, "provisions">) =>
  `${scope.jurisdiction}|${scope.document_class}|${scope.version}`;
const DATED_VERSION = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

/**
 * Served scope versions a release lacks. A later ingest of the same batch
 * (same jurisdiction, document class, and version name after its leading
 * date, with a later date) stands in for the served version: activating it
 * replaces that batch's text rather than dropping it.
 */
function servedLacking(release: SignedRelease, served: ReleaseScope[]): number {
  const keys = new Set(release.scopes.map(scopeKey));
  const latestIngest = new Map<string, string>();
  for (const scope of release.scopes) {
    const dated = DATED_VERSION.exec(scope.version);
    if (!dated) continue;
    const batch = `${scope.jurisdiction}|${scope.document_class}|${dated[2]}`;
    if ((latestIngest.get(batch) ?? "") < dated[1]) latestIngest.set(batch, dated[1]);
  }
  return served.filter((scope) => {
    if (keys.has(scopeKey(scope))) return false;
    const dated = DATED_VERSION.exec(scope.version);
    const later = dated && latestIngest.get(`${scope.jurisdiction}|${scope.document_class}|${dated[2]}`);
    return !(dated && later && later > dated[1]);
  }).length;
}

const newestFirst = (a: SignedRelease, b: SignedRelease) => b.signedAt.localeCompare(a.signedAt);

export function corpusView(
  { releases, pointers, served, pins, repos = [] }: CorpusInputs,
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
  const activations = new Map<string, Map<string, string>>();
  for (const pointer of pointers) {
    const jurisdiction = owner(pointer.release_name) ?? pointer.jurisdiction;
    const releasesServing = activations.get(jurisdiction) ?? new Map<string, string>();
    const seen = releasesServing.get(pointer.release_name);
    if (!seen || pointer.activated_at > seen) {
      releasesServing.set(pointer.release_name, pointer.activated_at);
    }
    activations.set(jurisdiction, releasesServing);
  }
  // The scope versions each jurisdiction serves, with their provisions.
  const scopeIndex = new Map<string, Map<string, ReleaseScope>>();
  const releaseScope = (name: string, key: string) => {
    let index = scopeIndex.get(name);
    if (!index) {
      index = new Map((byName.get(name)?.scopes ?? []).map((scope) => [scopeKey(scope), scope]));
      scopeIndex.set(name, index);
    }
    return index.get(key);
  };
  const servedBy = new Map<string, ReleaseScope[]>();
  for (const row of served) {
    const jurisdiction = owner(row.release_name) ?? row.jurisdiction;
    const scope = releaseScope(row.release_name, scopeKey(row)) ?? {
      jurisdiction: row.jurisdiction,
      document_class: row.document_class,
      version: row.version,
    };
    servedBy.set(jurisdiction, [...(servedBy.get(jurisdiction) ?? []), scope]);
  }

  const jurisdictions = new Set([...signed.keys(), ...repos, ...Object.keys(pins)]);
  const rows: CorpusJurisdiction[] = [];
  for (const jurisdiction of jurisdictions) {
    const list = [...(signed.get(jurisdiction) ?? [])].sort(newestFirst);
    const pin = pins[jurisdiction];
    const active = activations.get(jurisdiction) ?? new Map<string, string>();
    const [current] = [...active.entries()].sort((a, b) => b[1].localeCompare(a[1]));
    const servedScopes = servedBy.get(jurisdiction) ?? [];
    const servedKeys = new Set(servedScopes.map(scopeKey));
    // Successors are compared with what serves only when the served scope versions are known.
    const compared = current !== undefined && servedScopes.length > 0;
    // "Newer" means signed after the newest release that serves.
    const servingSignedAt =
      [...active.keys()]
        .map((name) => byName.get(name)?.signedAt)
        .filter((at): at is string => !!at)
        .sort()
        .at(-1) ?? current?.[1] ?? "";
    const newer = compared
      ? list.filter((release) => !active.has(release.name) && release.signedAt > servingSignedAt)
      : [];
    const adds = (release: SignedRelease) =>
      release.scopes.filter((scope) => !servedKeys.has(scopeKey(scope))).length;
    const next = newer.find((release) => servedLacking(release, servedScopes) === 0 && adds(release) > 0);
    const other = newer.find(
      (release) =>
        release !== next &&
        (!next || release.signedAt > next.signedAt) &&
        servedLacking(release, servedScopes) > 0
    );

    const pinned = pin?.release ? byName.get(pin.release) : undefined;
    let encoder: CorpusJurisdiction["encoder"] = null;
    if (pin) {
      const pinnedKeys = pinned ? new Set(pinned.scopes.map(scopeKey)) : null;
      encoder = {
        repo: `rulespec-${jurisdiction}`,
        release: pin.release,
        state: !pin.release ? "placeholder" : pinned ? "signed" : pin.manifest ? "manifest" : "unknown",
        lacks: pinnedKeys && compared ? servedScopes.filter((s) => !pinnedKeys.has(scopeKey(s))).length : null,
        extra: pinnedKeys && compared ? pinned!.scopes.filter((s) => !servedKeys.has(scopeKey(s))).length : null,
      };
    }

    const flags = new Map<CorpusFlag, string | null>();
    if (list.length === 0 && !encoder?.release) flags.set("no_release", null);
    if (list.length > 0 && !current) flags.set("not_serving", list.at(-1)!.signedAt);
    if (next) flags.set("newer_not_active", next.signedAt);
    if (encoder) {
      // A pin's mismatch began once both the pinned and the served release existed.
      const pinSince = [pinned?.signedAt ?? "", current?.[1] ?? ""].sort().at(-1) || null;
      if (encoder.lacks) flags.set("encoder_lacks", pinSince);
      else if (encoder.extra) flags.set("encoder_off", pinSince);
      else if (encoder.lacks === 0 && encoder.release && !active.has(encoder.release)) {
        flags.set("encoder_other", pinSince);
      }
      if (encoder.state === "manifest") flags.set("pin_unsigned", null);
      if (encoder.state === "unknown" || (encoder.state === "placeholder" && list.length > 0)) {
        flags.set("pin_unknown", null);
      }
    }
    const ordered = CORPUS_FLAGS.filter((flag) => flags.has(flag));

    rows.push({
      jurisdiction,
      name: jurisdictionName(jurisdiction),
      flags: ordered,
      serving: current
        ? {
            release: current[0],
            since: current[1],
            releases: active.size,
            scopes: servedScopes.length || (byName.get(current[0])?.scopes.length ?? 0),
            provisions: servedScopes.some((scope) => scope.provisions !== undefined)
              ? servedScopes.reduce((total, scope) => total + (scope.provisions ?? 0), 0)
              : null,
          }
        : null,
      newest: list[0] ? { release: list[0].name, signedAt: list[0].signedAt, scopes: list[0].scopes.length } : null,
      next: next
        ? { release: next.name, signedAt: next.signedAt, scopes: next.scopes.length, adds: adds(next) }
        : null,
      other: other
        ? {
            release: other.name,
            signedAt: other.signedAt,
            scopes: other.scopes.length,
            lacks: servedLacking(other, servedScopes),
          }
        : null,
      encoder,
      since: ordered.length > 0 ? (flags.get(ordered[0]) ?? null) : null,
    });
  }

  rows.sort((a, b) => {
    const aCurrent = a.flags.length === 0;
    if (aCurrent !== (b.flags.length === 0)) return aCurrent ? 1 : -1;
    if (!aCurrent && a.since !== b.since) {
      if (!a.since || !b.since) return a.since ? -1 : 1;
      return a.since.localeCompare(b.since);
    }
    return a.name.localeCompare(b.name);
  });
  return {
    jurisdictions: rows,
    outOfSync: rows.filter((row) => row.flags.length > 0).length,
    ...extras,
  };
}

interface ReleaseObjectRow {
  release_name: string;
  created_at: string;
  scopes: Array<{
    jurisdiction?: string;
    document_class?: string;
    version?: string;
    provision_rows?: number;
  }> | null;
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

/** Every row of a corpus table, a page at a time; throws rather than return a partial table. */
async function readAllRows<T>(
  config: SupabaseRestConfig,
  table: string,
  query: Record<string, string>,
  pageSize: number
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const chunk = await readSupabaseRows<T>(
      config,
      "corpus",
      table,
      { ...query, limit: String(pageSize), offset: String(page * pageSize) },
      { fresh: true }
    );
    rows.push(...chunk);
    if (chunk.length < pageSize) return rows;
  }
  throw new Error(`corpus.${table} has more than ${MAX_PAGES * pageSize} rows`);
}

/** A rulespec repo's toolchain pin; null when the file cannot be read. */
async function readPin(jurisdiction: string): Promise<EncoderPin | null> {
  try {
    const response = await fetch(PIN_URL(jurisdiction), { cache: "no-store" } as RequestInit);
    return response.ok ? { release: parsePin(await response.text()) } : null;
  } catch {
    return null;
  }
}

/** Whether axiom-corpus has a release manifest of this name (signed or not). */
async function hasManifest(release: string): Promise<boolean> {
  try {
    const response = await fetch(MANIFEST_URL(release), { cache: "no-store" } as RequestInit);
    return response.ok;
  } catch {
    return false;
  }
}

/** The jurisdictions with a live rulespec repo; the known list when the search is unavailable. */
async function readRulespecRepos(): Promise<string[]> {
  try {
    const result = await fetchJson<{ items?: Array<{ name?: string; archived?: boolean }> }>(REPO_SEARCH_URL);
    const found = (result.items ?? [])
      .filter((repo) => !repo.archived)
      .map((repo) => RULESPEC_REPO_RE.exec(repo.name ?? "")?.[1])
      .filter((jurisdiction): jurisdiction is string => !!jurisdiction);
    if (found.length > 0) return found;
  } catch {
    // Fall through to the known list.
  }
  return KNOWN_RULESPEC_JURISDICTIONS;
}

async function readOpenPrs(): Promise<CorpusView["openPrs"]> {
  const search = (extra: string) =>
    `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${CORPUS_REPO} is:pr is:open${extra}`)}&sort=created&order=asc&per_page=1`;
  try {
    const [all, drafts] = await Promise.all([
      fetchJson<{ total_count: number; items: Array<{ created_at: string }> }>(search("")),
      fetchJson<{ total_count: number }>(search(" draft:true")).catch(() => null),
    ]);
    return {
      count: all.total_count,
      draft: drafts?.total_count ?? null,
      oldestAt: all.items[0]?.created_at ?? null,
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
  const [objects, pointers, served, openPrs, lastPublish, repos] = await Promise.all([
    readAllRows<ReleaseObjectRow>(
      config,
      "release_objects",
      { select: "release_name,created_at,scopes:release_object->content->scopes", order: "release_name.asc" },
      RELEASE_PAGE
    ),
    readAllRows<ServingPointer>(
      config,
      "active_scope_pointer",
      { select: "jurisdiction,document_class,release_name,activated_at", order: "jurisdiction.asc,document_class.asc" },
      ROW_PAGE
    ),
    readAllRows<ServedScope>(
      config,
      "current_release_scopes",
      {
        select: "release_name,jurisdiction,document_class,version",
        order: "jurisdiction.asc,document_class.asc,version.asc",
      },
      ROW_PAGE
    ),
    readOpenPrs(),
    readLastPublish(),
    readRulespecRepos(),
  ]);
  const releases: SignedRelease[] = objects.map((row) => {
    const scopes = (row.scopes ?? []).flatMap((s): ReleaseScope[] =>
      s.jurisdiction && s.document_class && s.version
        ? [
            {
              jurisdiction: s.jurisdiction,
              document_class: s.document_class,
              version: s.version,
              ...(typeof s.provision_rows === "number" ? { provisions: s.provision_rows } : {}),
            },
          ]
        : []
    );
    return {
      name: row.release_name,
      signedAt: row.created_at,
      jurisdictions: [...new Set(scopes.map((s) => s.jurisdiction))],
      scopes,
    };
  });
  const registered = new Set(releases.map((release) => release.name));
  const jurisdictions = [
    ...new Set([...releases.map(releaseJurisdiction).filter((j): j is string => !!j), ...repos]),
  ];
  const pins: Record<string, EncoderPin> = {};
  await Promise.all(
    jurisdictions.map(async (jurisdiction) => {
      const pin = await readPin(jurisdiction);
      if (!pin) return;
      pins[jurisdiction] =
        pin.release && !registered.has(pin.release) ? { ...pin, manifest: await hasManifest(pin.release) } : pin;
    })
  );
  return corpusView({ releases, pointers, served, pins, repos }, { openPrs, lastPublish });
}

const cachedCorpusView = unstable_cache(readCorpusView, ["ops-corpus-releases-v2"], {
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
    outOfSync: jurisdictions.filter((row) => row.flags.length > 0).length,
  };
}

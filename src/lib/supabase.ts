import { createClient } from '@supabase/supabase-js'
import { getLandingJurisdictions } from '@/lib/axiom/landing-jurisdictions'
import {
  isAppReadableJurisdiction,
  ruleSpecRawFileUrlForLocation,
} from '@/lib/axiom/repo-map'
import {
  isGatedCitationPath,
  isGatedJurisdiction,
} from '@/lib/axiom/rulespec/index-visibility'
import { cachedRawFetch } from '@/lib/axiom/rulespec/raw-cache'
import { listEncodedFiles } from '@/lib/axiom/rulespec/repo-listing'
import { ruleSpecReadLocation } from '@/lib/axiom/rulespec/visibility'

// Supabase configuration
/* v8 ignore start -- env-dependent module initialization */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const isTestEnv = !supabaseUrl || process.env.NODE_ENV === 'test'
const baseAuthOptions = {
  autoRefreshToken: false,
  detectSessionInUrl: false,
  persistSession: false,
}

function createAxiomClient(storageKey: string, schema?: string) {
  const options = {
    auth: { ...baseAuthOptions, storageKey },
    ...(schema ? { db: { schema } } : {}),
  }

  return isTestEnv
    ? createClient('https://placeholder.supabase.co', 'placeholder-key', options)
    : createClient(supabaseUrl, supabaseAnonKey, options)
}

export const supabase = createAxiomClient('axiom-public-auth-token')

// Source corpus client for browsable provisions and citation graph RPCs.
export const supabaseCorpus = createAxiomClient('axiom-corpus-auth-token', 'corpus')

// Encoding metadata client for RuleSpec run summaries.
export const supabaseEncodings = createAxiomClient('axiom-encodings-auth-token', 'encodings')

// Telemetry client for encoder transcripts, SDK sessions, and event logs.
export const supabaseTelemetry = createAxiomClient(
  'axiom-telemetry-auth-token',
  'telemetry'
)
/* v8 ignore stop */

// Types for Encoder runs
export interface EncodingRunIteration {
  attempt: number
  success: boolean
  duration_ms: number
  errors: { type: string; message: string }[]
}

export interface EncodingRunScores {
  rulespec: number
  formula: number
  parameter: number
  integration: number
}

export type DataSource = 'reviewer_agent' | 'ci_only' | 'mock' | 'manual_estimate' | 'unknown'

export interface EncodingRun {
  id: string
  timestamp: string
  citation: string
  iterations: EncodingRunIteration[]
  scores: EncodingRunScores
  has_issues: boolean | null
  note: string | null
  total_duration_ms: number | null
  agent_type: string | null
  agent_model: string | null
  data_source: DataSource
  session_id: string | null
}

// Fetch encoding runs from Supabase
export async function getEncodingRuns(limit = 100, offset = 0): Promise<EncodingRun[]> {
  const { data, error } = await supabaseEncodings
    .rpc('get_encoding_runs', { limit_count: limit, offset_count: offset })

  if (error) {
    console.error('Error fetching encoding runs:', error)
    return []
  }

  return (data || []) as EncodingRun[]
}

// Types for agent transcripts from Encoder runs
export interface TranscriptMessage {
  type: string
  message?: {
    role: string
    content: Array<{ type: string; text?: string; thinking?: string }>
  }
  timestamp?: string
  agentId?: string
}

export interface AgentTranscript {
  id: number
  session_id: string
  agent_id: string | null
  tool_use_id: string
  subagent_type: string
  prompt: string | null
  description: string | null
  response_summary: string | null
  transcript: TranscriptMessage[] | null
  orchestrator_thinking: string | null
  message_count: number
  created_at: string
  uploaded_at: string | null
}

// Fetch agent transcripts from Supabase
export async function getAgentTranscripts(limit = 100, offset = 0): Promise<AgentTranscript[]> {
  const { data, error } = await supabaseTelemetry
    .from('agent_transcripts')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching agent transcripts:', error)
    return []
  }

  return (data || []) as AgentTranscript[]
}

// Fetch transcripts for a specific session (linked to an encoding run)
export async function getTranscriptsBySession(sessionId: string): Promise<AgentTranscript[]> {
  const { data, error } = await supabaseTelemetry
    .from('agent_transcripts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching transcripts by session:', error)
    return []
  }

  return (data || []) as AgentTranscript[]
}

// Types for SDK orchestrator sessions (full encoding pipeline runs)
export interface SDKSession {
  id: string
  started_at: string
  ended_at: string | null
  model: string | null
  cwd: string | null
  event_count: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  estimated_cost_usd: number
  encoder_version: string | null
}

export interface SDKSessionEvent {
  id: string
  session_id: string
  sequence: number
  timestamp: string
  event_type: string
  tool_name: string | null
  content: string | null
  metadata: Record<string, unknown> | null
}

// Fetch SDK orchestrator sessions from Supabase
export async function getSDKSessions(limit = 50): Promise<SDKSession[]> {
  const { data, error } = await supabaseTelemetry
    .from('sdk_sessions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching SDK sessions:', error)
    return []
  }

  return ((data || []) as SDKSession[]).map((row) => ({
    ...row,
    encoder_version: row.encoder_version ?? null,
  }))
}

// Fetch session metadata
export async function getSDKSessionMeta(
  sessionIds: string[]
): Promise<Record<string, { title: string; lastEventAt: string | null }>> {
  if (sessionIds.length === 0) return {}

  const { data: startEvents } = await supabaseTelemetry
    .from('sdk_session_events')
    .select('session_id, content')
    .in('session_id', sessionIds)
    .eq('event_type', 'agent_start')
    .order('sequence', { ascending: true })

  const { data: lastEvents } = await supabaseTelemetry
    .from('sdk_session_events')
    .select('session_id, timestamp')
    .in('session_id', sessionIds)
    .order('sequence', { ascending: false })

  const meta: Record<string, { title: string; lastEventAt: string | null }> = {}

  if (startEvents) {
    for (const row of startEvents) {
      if (!meta[row.session_id] && row.content) {
        const match = row.content.match(/(?:Analyze|Encode)\s+(.+?)(?:\s+subsection|\s*$)/i)
        meta[row.session_id] = {
          title: match ? match[1].trim() : row.content.slice(0, 60),
          lastEventAt: null,
        }
      }
    }
  }

  if (lastEvents) {
    const seen = new Set<string>()
    for (const row of lastEvents) {
      if (!seen.has(row.session_id)) {
        seen.add(row.session_id)
        if (meta[row.session_id]) {
          meta[row.session_id].lastEventAt = row.timestamp
        } else {
          meta[row.session_id] = { title: '', lastEventAt: row.timestamp }
        }
      }
    }
  }

  return meta
}

// Fetch events for a specific SDK session
export async function getSDKSessionEvents(sessionId: string, limit = 2000): Promise<SDKSessionEvent[]> {
  const { data, error } = await supabaseTelemetry
    .from('sdk_session_events')
    .select('*')
    .eq('session_id', sessionId)
    .order('sequence', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('Error fetching SDK session events:', error)
    return []
  }

  return (data || []) as SDKSessionEvent[]
}

// Source corpus provision rows. The UI still presents these as rules where
// that is the clearer user-facing term.
export interface Rule {
  id: string
  jurisdiction: string
  doc_type: string
  parent_id: string | null
  level: number
  ordinal: number | null
  heading: string | null
  body: string | null
  effective_date: string | null
  repeal_date: string | null
  source_url: string | null
  source_path: string | null
  citation_path: string | null
  rulespec_path: string | null
  has_rulespec: boolean
  created_at: string
  updated_at: string
}

// Encoding data linked to a source provision via citation_path
export interface RuleEncodingData {
  encoding_run_id: string
  citation: string
  session_id: string | null
  file_path: string
  rulespec_content: string | null
  final_scores: EncodingRunScores | null
  // Encoding-run metadata (only present for encoding_runs sources)
  iterations: EncodingRunIteration[] | null
  total_duration_ms: number | null
  agent_type: string | null
  agent_model: string | null
  data_source: DataSource | null
  has_issues: boolean | null
  note: string | null
  timestamp: string | null
  encoder_version: string | null
}

// Generate candidate file paths walking up the hierarchy
// e.g. "statute/26/32/b/1" → ["statute/26/32/b/1.yaml", "statute/26/32/b.yaml", "statute/26/32.yaml"]
function parentPaths(basePath: string): string[] {
  const paths: string[] = [basePath + '.yaml']
  const parts = basePath.split('/')
  for (let i = parts.length - 1; i >= 2; i--) {
    paths.push(parts.slice(0, i).join('/') + '.yaml')
  }
  return paths
}

function duplicateTerminalSectionPath(basePath: string): string | null {
  const parts = basePath.split('/')
  if (parts.length !== 3 || parts[0] !== 'statute') return null
  const section = parts[2]
  return `${basePath}/${section}.yaml`
}

// citation_path uses singular doc-type buckets ("statute", "regulation",
// "policy"); the rulespec-* repos store files under plural buckets
// ("statutes/", "regulations/", "policies/"). Translate at the repo
// boundary so the rest of the path machinery can keep speaking the
// citation_path dialect.
export const REPO_BUCKET_RENAMES: Readonly<Record<string, string>> =
  Object.freeze({
    statute: 'statutes',
    regulation: 'regulations',
    policy: 'policies',
  })

export function toRepoBucketPath(path: string): string {
  const slash = path.indexOf('/')
  if (slash === -1) return path
  const head = path.slice(0, slash)
  const renamed = REPO_BUCKET_RENAMES[head]
  return renamed ? renamed + path.slice(slash) : path
}

export function candidatePaths(
  basePath: string | null,
  rulespecPath: string | null,
): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []
  const push = (raw: string) => {
    const repoPath = toRepoBucketPath(raw)
    if (!seen.has(repoPath)) {
      seen.add(repoPath)
      candidates.push(repoPath)
    }
  }
  if (rulespecPath) {
    push(rulespecPath.endsWith('.yaml') ? rulespecPath : `${rulespecPath}.yaml`)
  }
  if (basePath) {
    const duplicateSectionPath = duplicateTerminalSectionPath(basePath)
    if (duplicateSectionPath) push(duplicateSectionPath)
    for (const path of parentPaths(basePath)) push(path)
  }
  return candidates
}

// Fetch RuleSpec content from GitHub rulespec-us repo (fallback for hand-written encodings)
async function fetchRuleSpecFromGitHub(
  candidates: string[],
  jurisdiction: string
): Promise<RuleEncodingData | null> {
  // The same visibility gate the encoded listing applies: a repo the
  // app maps but must not read (``app_visibility = "experimental"``)
  // serves nothing, even to a caller holding an exact citation path.
  const loc = await ruleSpecReadLocation(jurisdiction)
  if (!loc) return null
  /* v8 ignore start -- network fetch to GitHub, tested via integration */
  for (const filePath of candidates) {
    // ``filePath`` is bucket-rooted (``statutes/26/32.yaml``); the
    // helper injects the monorepo jurisdiction-dir prefix the layout
    // requires.
    const url = ruleSpecRawFileUrlForLocation(loc, filePath)
    const res = await cachedRawFetch(url, { next: { revalidate: 3600 } } as RequestInit)
    if (!res.ok) continue
    return {
      encoding_run_id: `github:${filePath}`,
      citation: filePath.replace('.yaml', ''),
      session_id: null,
      file_path: filePath,
      rulespec_content: res.body,
      final_scores: null,
      iterations: null,
      total_duration_ms: null,
      agent_type: null,
      agent_model: null,
      data_source: null,
      has_issues: null,
      note: null,
      timestamp: null,
      encoder_version: null,
    }
  }
  return null
}
/* v8 ignore stop */

// Fetch encoding data for a source provision by its ID
export async function getRuleEncoding(ruleId: string): Promise<RuleEncodingData | null> {
  // Synthesised IDs ("github:<citation_path>") are minted client-side
  // for citation paths that have a YAML in the rulespec-* repo but no
  // corpus row backing them. Skip the corpus lookup and resolve the
  // path directly so the standard rule-detail rail can render the
  // encoding without waiting on the DB backfill.
  let rule: {
    citation_path: string | null
    jurisdiction: string
    rulespec_path: string | null
    has_rulespec: boolean
  } | null = null

  if (ruleId.startsWith('github:')) {
    const citationPath = ruleId.slice('github:'.length)
    const jurisdiction = citationPath.split('/')[0] ?? ''
    if (!jurisdiction) return null
    rule = {
      citation_path: citationPath,
      jurisdiction,
      rulespec_path: null,
      has_rulespec: true,
    }
  } else {
    const { data, error } = await supabaseCorpus
      .from('current_provisions')
      .select('citation_path, jurisdiction, rulespec_path, has_rulespec')
      .eq('id', ruleId)
      .single()
    if (error || !data) return null
    rule = data
  }

  // Registered ``app_visibility`` gate, applied to the resolved rule
  // identity BEFORE any encoding lookup. ``fetchRuleSpecFromGitHub``
  // refuses a gated family, but that is the LAST step here: a
  // populated ``encoding_runs`` row — left behind by a run that
  // predates the gate, or written by an encoder pointed at the pilot
  // — returns before the fallback is ever reached, and both id forms
  // (a corpus provision id whose jurisdiction resolves to a gated
  // family, and ``github:il/…``) hit that path. ``getSectionEncoding``
  // already refuses the same provision, so the legacy rail
  // (``RuleDetailPanel`` → ``useEncoding`` → here) must refuse it too
  // or the v1 reader serves what the v2 reader will not.
  //
  // Both the row's ``jurisdiction`` column and its citation path are
  // checked: they normally agree, but the column is the corpus row's
  // own claim and the path is what every downstream candidate is built
  // from, so a disagreement must fail closed on either.
  if (
    isGatedJurisdiction(rule.jurisdiction) ||
    isGatedCitationPath(rule.citation_path)
  ) {
    return null
  }

  // Match citation_path to encoding_runs.file_path
  // citation_path: "us/statute/26/1/j/2" → file_path: "statute/26/1/j/2.yaml"
  let basePath = rule.citation_path
    ? rule.citation_path.replace(rule.jurisdiction + '/', '')
    : null
  // The rulespec-us repo prefixes federal-regulation titles with "-cfr"
  // (``regulations/7-cfr/...``) while corpus drops it. Add the suffix
  // back when assembling repo candidates so the GitHub fetch hits the
  // right file.
  /* v8 ignore start -- US-CFR title normalisation is exercised through getRuleEncoding integration paths */
  if (basePath && rule.jurisdiction === 'us' && basePath.startsWith('regulation/')) {
    const segs = basePath.split('/')
    if (segs[1] && !segs[1].endsWith('-cfr')) {
      segs[1] = `${segs[1]}-cfr`
      basePath = segs.join('/')
    }
  }
  /* v8 ignore stop */
  const candidates = candidatePaths(basePath, rule.rulespec_path)

  if (candidates.length === 0) return null

  // Single query: try all candidate paths at once, pick the most specific match
  const { data, error } = await supabaseEncodings
    .from('encoding_runs')
    .select('id, citation, session_id, file_path, rulespec_content, final_scores, iterations, total_duration_ms, agent_type, agent_model, data_source, has_issues, note, timestamp, encoder_version')
    .in('file_path', candidates)
    .order('timestamp', { ascending: false })

  // Some encoding_runs rows are telemetry-only (rulespec_content is
  // null); displaying them would render an empty encoding rail, so
  // treat them as misses and let the repo-file fallback fire.
  const withContent = (data ?? []).filter(
    (row) => row.rulespec_content && row.rulespec_content.trim().length > 0
  )
  if (!error && withContent.length > 0) {
    // Pick the most specific match (earliest in candidates list = most specific path)
    const pathPriority = new Map(candidates.map((p, i) => [p, i]))
    /* v8 ignore next 2 -- reduce comparator only exercises b-branch with multiple results */
    const best = withContent.reduce((a, b) =>
      (pathPriority.get(a.file_path) ?? Infinity) <= (pathPriority.get(b.file_path) ?? Infinity) ? a : b
    )
    return {
      encoding_run_id: best.id,
      citation: best.citation,
      session_id: best.session_id,
      file_path: best.file_path,
      rulespec_content: best.rulespec_content,
      final_scores: best.final_scores,
      iterations: best.iterations ?? null,
      total_duration_ms: best.total_duration_ms ?? null,
      agent_type: best.agent_type ?? null,
      agent_model: best.agent_model ?? null,
      data_source: best.data_source ?? null,
      has_issues: best.has_issues ?? null,
      note: best.note ?? null,
      timestamp: best.timestamp ?? null,
      encoder_version: best.encoder_version ?? null,
    }
  }

  // Fallback: fetch from the jurisdiction's rulespec-* repo. We used to
  // gate this on ``has_rulespec`` or an explicit ``rulespec_path``,
  // but the corpus flag is far behind the actual repo state during
  // the rolling migration — most YAMLs that exist on GitHub don't
  // have ``has_rulespec=true`` set yet. The ``cachedRawFetch`` layer
  // dedupes 404 probes per URL inside the TTL window, so the
  // "noisy ancestor probes" worry from the original guard is
  // already mitigated.
  return fetchRuleSpecFromGitHub(candidates, rule.jurisdiction)
}

// ---- Axiom full-text search ----

export interface SearchHit {
  id: string
  jurisdiction: string
  doc_type: string
  citation_path: string
  heading: string | null
  snippet: string
  has_rulespec: boolean
  rank: number
}

export interface SearchOptions {
  jurisdiction?: string
  docType?: string
  limit?: number
}

/**
 * Search current corpus provisions via the server-side `search_provisions` RPC.
 *
 * The RPC accepts websearch-style queries (quoted phrases, `OR`, `-`).
 * It returns hits ordered by ts_rank_cd with a <mark>-tagged body
 * snippet suitable for rendering as innerHTML.
 *
 * Callers must treat `snippet` as sanitized-by-construction: Postgres
 * ts_headline emits exactly the `StartSel`/`StopSel` markers we passed
 * and HTML-escapes everything else. Do not pass untrusted strings as
 * start/stop markers in the RPC definition.
 */
export async function searchRules(
  query: string,
  options: SearchOptions = {}
): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []

  const limit = Math.max(1, Math.min(options.limit ?? 30, 100))
  const { data, error } = await supabaseCorpus.rpc('search_provisions', {
    q,
    jurisdiction_in: options.jurisdiction ?? null,
    doc_type_in: options.docType ?? null,
    limit_in: limit,
  })

  if (!error) {
    return (data || []) as SearchHit[]
  }

  // The new corpus schema doesn't expose ``search_provisions`` yet
  // — fall back to a direct ILIKE on the heading column so the
  // search box still finds something obvious (program names,
  // section headings) instead of always returning empty. We don't
  // try to mimic ts_rank scoring here; results are ranked by
  // citation_path alphabetical for predictability.
  console.warn('search_provisions RPC unavailable; falling back to heading ILIKE')
  return await searchRulesFallback(q, options, limit)
}

async function searchRulesFallback(
  q: string,
  options: SearchOptions,
  limit: number
): Promise<SearchHit[]> {
  // Split on whitespace and AND the terms — PostgREST supports
  // multiple ``heading=ilike.*…*`` clauses on the same query string
  // by repeating the parameter, but the supabase-js builder collapses
  // duplicates, so stack them via ``.ilike()`` calls instead.
  const terms = q.split(/\s+/).filter(Boolean)
  /* v8 ignore next 1 -- caller already trims; defensive only */
  if (terms.length === 0) return []

  let builder = supabaseCorpus
    .from('current_provisions')
    .select(
      'id, jurisdiction, doc_type, citation_path, heading, body, has_rulespec'
    )
  if (options.jurisdiction) builder = builder.eq('jurisdiction', options.jurisdiction)
  if (options.docType) builder = builder.eq('doc_type', options.docType)
  for (const t of terms) {
    builder = builder.ilike('heading', `%${t}%`)
  }
  builder = builder.not('heading', 'is', null).order('citation_path').limit(limit)

  const { data, error } = await builder
  /* v8 ignore next 1 -- defensive: ilike+order+limit shouldn't error in practice */
  if (error || !data) return []

  return (data as Array<{
    id: string
    jurisdiction: string
    doc_type: string
    citation_path: string
    heading: string | null
    body: string | null
    has_rulespec: boolean
  }>).map((row) => ({
    id: row.id,
    jurisdiction: row.jurisdiction,
    doc_type: row.doc_type,
    citation_path: row.citation_path,
    heading: row.heading,
    /* v8 ignore next 1 -- the .not('heading', 'is', null) clause filters nulls server-side */
    snippet: highlightTerms((row.heading ?? '').slice(0, 200), terms),
    has_rulespec: row.has_rulespec,
    rank: 0,
  }))
}

function highlightTerms(text: string, terms: string[]): string {
  // Escape any HTML in the heading first so the renderer (which
  // treats snippet as innerHTML) doesn't reflect raw input.
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  let out = escaped
  for (const term of terms) {
    /* v8 ignore next 1 -- caller filters empties; defensive only */
    if (!term) continue
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>')
  }
  return out
}

// ---- Axiom cross-references (get_provision_references RPC) ----

export type RefDirection = 'outgoing' | 'incoming'

export interface RuleReference {
  direction: RefDirection
  citation_text: string
  pattern_kind: string
  confidence: number
  start_offset: number
  end_offset: number
  /** For outgoing: the cited provision. For incoming: the citing provision. */
  other_citation_path: string
  other_provision_id: string | null
  other_heading: string | null
  /** Outgoing only — whether the target is ingested in current corpus provisions. */
  target_resolved: boolean
}

/**
 * Fetch the citation graph around a single source provision.
 *
 * Returns one row per outgoing and incoming reference. Outgoing rows
 * carry `start_offset` / `end_offset` so the caller can splice `<a>`
 * tags at those positions when rendering the body. Incoming rows point
 * back to the citing provision for a "referenced by" panel.
 */
export async function getRuleReferences(
  citationPath: string
): Promise<RuleReference[]> {
  const { data, error } = await supabaseCorpus.rpc('get_provision_references', {
    citation_path_in: citationPath,
  })
  if (error) {
    console.error('get_provision_references RPC failed:', error)
    return []
  }
  return (data || []) as RuleReference[]
}

/**
 * High-level corpus + graph stats surfaced on the Axiom landing page.
 *
 * ``provisions_count`` / ``references_count`` are planner estimates from
 * ``pg_class.reltuples`` — fast and fresh enough for an at-a-glance
 * stat block. ``jurisdictions_count`` is an exact distinct count.
 */
export interface AxiomJurisdictionCount {
  jurisdiction: string
  count: number
}

export interface AxiomStats {
  provisions_count: number
  references_count: number
  jurisdictions_count: number
  /** Per-jurisdiction provision counts, sorted DESC. */
  jurisdictions: AxiomJurisdictionCount[]
}

/** Fetch landing-page stats via the corpus.get_corpus_stats RPC. */
export async function getAxiomStats(): Promise<AxiomStats | null> {
  const { data, error } = await supabaseCorpus.rpc('get_corpus_stats')
  if (error) {
    console.error('get_corpus_stats RPC failed:', error)
    return null
  }
  const stats = (data || null) as AxiomStats | null
  if (!stats) return null
  return enrichAxiomStatsWithNavigationCounts(stats)
}

async function enrichAxiomStatsWithNavigationCounts(
  stats: AxiomStats
): Promise<AxiomStats> {
  const existingJurisdictions = stats.jurisdictions ?? []
  const existingSlugs = new Set(
    existingJurisdictions.map((j) => j.jurisdiction)
  )
  const missingSlugs = getLandingJurisdictions()
    .map((j) => j.slug)
    .filter((slug) => !existingSlugs.has(slug))

  if (missingSlugs.length === 0) return stats

  const rulespecCounts = await withStatsTimeout(
    getRuleSpecJurisdictionCounts(missingSlugs),
    RULESPEC_JURISDICTION_COUNTS_TIMEOUT_MS,
    []
  )
  const rulespecSlugs = new Set(
    rulespecCounts.map((j) => j.jurisdiction)
  )
  const navigationMissingSlugs = missingSlugs.filter(
    (slug) => !rulespecSlugs.has(slug)
  )
  const navigationCounts = await withStatsTimeout(
    getNavigationJurisdictionCounts(navigationMissingSlugs),
    NAVIGATION_JURISDICTION_COUNTS_TIMEOUT_MS,
    []
  )

  const supplementalCounts = [...rulespecCounts, ...navigationCounts]

  if (supplementalCounts.length === 0) return stats

  const jurisdictions = [...existingJurisdictions, ...supplementalCounts].sort(
    (a, b) => b.count - a.count
  )

  return {
    ...stats,
    jurisdictions,
    jurisdictions_count: Math.max(
      stats.jurisdictions_count,
      new Set(jurisdictions.map((j) => j.jurisdiction)).size
    ),
  }
}

async function getRuleSpecJurisdictionCounts(
  jurisdictions: string[]
): Promise<AxiomJurisdictionCount[]> {
  const rows = await Promise.all(
    jurisdictions.map(async (jurisdiction) => {
      // A gated pilot family is never counted from the index. A leaked
      // or pre-gating row would otherwise light its landing tile with
      // a rule count and a live link to a page that serves nothing —
      // the GitHub fallback below has refused it since
      // isGitHubRuleSpecStatsFallbackJurisdiction.
      if (isGatedJurisdiction(jurisdiction)) return null

      const { count, error } = await supabaseEncodings
        .from('rulespec_files')
        .select('citation_path', { count: 'exact', head: true })
        .eq('jurisdiction', jurisdiction)

      if (error || !count) return null
      return { jurisdiction, count }
    })
  )

  const indexedCounts = rows.filter(
    (row): row is AxiomJurisdictionCount => row !== null
  )
  const indexedSlugs = new Set(indexedCounts.map((row) => row.jurisdiction))
  const fallbackSlugs = jurisdictions.filter((slug) => !indexedSlugs.has(slug))

  return [
    ...indexedCounts,
    ...(await getRuleSpecGitHubJurisdictionCounts(fallbackSlugs)),
  ]
}

async function getRuleSpecGitHubJurisdictionCounts(
  jurisdictions: string[]
): Promise<AxiomJurisdictionCount[]> {
  const fallbackJurisdictions = jurisdictions.filter(
    isGitHubRuleSpecStatsFallbackJurisdiction
  )
  const rows = await Promise.all(
    fallbackJurisdictions.map(async (jurisdiction) => {
      const files = await listEncodedFiles(jurisdiction)
      if (files.length === 0) return null
      return { jurisdiction, count: files.length }
    })
  )

  const liveRows = rows.filter(
    (row): row is AxiomJurisdictionCount => row !== null
  )
  const liveSlugs = new Set(liveRows.map((row) => row.jurisdiction))
  const bootstrapRows = fallbackJurisdictions
    .filter((jurisdiction) => !liveSlugs.has(jurisdiction))
    .map((jurisdiction) => {
      const count = BELGIUM_RULESPEC_BOOTSTRAP_COUNTS[jurisdiction]
      return count ? { jurisdiction, count } : null
    })
    .filter((row): row is AxiomJurisdictionCount => row !== null)

  return [...liveRows, ...bootstrapRows]
}

function isGitHubRuleSpecStatsFallbackJurisdiction(jurisdiction: string) {
  // Any jurisdiction the app may READ can have its tile count derived
  // from the repo listing when the corpus stats and the rulespec_files
  // index have no row for it. Derived from the repo map rather than a
  // per-country allowlist so new jurisdictions (Canada, and whatever
  // comes next) light up without editing this file — but a mapped
  // repo that is still gated must stay at a pending tile, not report
  // a count nothing else on the site can open.
  return isAppReadableJurisdiction(jurisdiction)
}

const BELGIUM_RULESPEC_BOOTSTRAP_COUNTS: Readonly<Record<string, number>> =
  Object.freeze({
    be: 58,
    'be-bru': 12,
    'be-vlg': 7,
    'be-wal': 6,
    'be-dg': 2,
  })

async function getNavigationJurisdictionCounts(
  jurisdictions: string[]
): Promise<AxiomJurisdictionCount[]> {
  const rows = await Promise.all(
    jurisdictions.map(async (jurisdiction) => {
      const { count, error } = await supabaseCorpus
        .from('navigation_nodes')
        .select('id', { count: 'exact', head: true })
        .eq('jurisdiction', jurisdiction)

      if (error || !count) return null
      return { jurisdiction, count }
    })
  )

  return rows.filter((row): row is AxiomJurisdictionCount => row !== null)
}

const RULESPEC_JURISDICTION_COUNTS_TIMEOUT_MS = 1200
const NAVIGATION_JURISDICTION_COUNTS_TIMEOUT_MS = 1200

function withStatsTimeout<T, F = T>(
  work: PromiseLike<T> | T,
  ms: number,
  fallback: F
): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

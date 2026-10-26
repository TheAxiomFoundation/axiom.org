import {
  DEFAULT_CONTROL,
  _resetControlCache,
  _resetMemoryStore,
  createMemoryStore,
  createSupabaseStore,
  getStore,
  readControl,
  safely,
  writeControl,
  RUN_PROMPT_SELECT,
  type AspenStore,
} from './store'
import fc from 'fast-check'
import { azSavingsStream } from '@/test/rules-az-savings'
import { summarizeRun } from './results'
import { parseDataStream, summarizeRules } from './rules'
import type { PromptRow } from './types'

const P = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const Q = '7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f'

describe('memory store', () => {
  it('keeps control, participants, prompts, events and pledges per run', async () => {
    const store = createMemoryStore()
    expect(await store.getControl()).toMatchObject({ runId: 'rehearsal', stage: 'welcome', live: true })
    expect(await store.setControl({ stage: 'try' })).toMatchObject({ stage: 'try', runId: 'rehearsal' })
    expect(await store.setControl({ runId: 'phoenix' })).toMatchObject({ stage: 'try', runId: 'phoenix' })

    await store.upsertParticipant({ id: P, run_id: 'phoenix', perspective: 'resident' })
    await store.upsertParticipant({ id: P, run_id: 'phoenix', state: 'Arizona', perspective: undefined })
    await store.insertPrompt({ id: Q, run_id: 'phoenix', participant_id: P, conversation_id: Q, turn: 0, prompt: 'Hi' })
    expect(await store.updatePrompt(Q, P, { verdict: 'wrong' })).toBe(true)
    expect(await store.updatePrompt(Q, Q, { verdict: 'right' })).toBe(false)
    expect(await store.updatePrompt(P, P, { verdict: 'right' })).toBe(false)
    await store.insertEvent({ run_id: 'phoenix', kind: 'discussion', payload: { note: 'x' } })
    await store.insertEvent({ run_id: 'phoenix', kind: 'stage_view', payload: {} })
    await store.insertEvent({ run_id: 'other', kind: 'breakout', payload: {} })
    await store.insertPledge({
      run_id: 'phoenix',
      email: 'a@b.org',
      name: 'Secret',
      state: 'Arizona',
      accurate_ai: true,
      state_systems: false,
      show_state: true,
    })
    await store.insertPledge({ run_id: 'phoenix', email: 'c@d.org', accurate_ai: false, state_systems: true, show_state: false })

    const run = await store.loadRun('phoenix')
    expect(run.participants).toEqual([
      expect.objectContaining({ id: P, perspective: 'resident', state: 'Arizona' }),
    ])
    expect(run.prompts[0]).toMatchObject({ verdict: 'wrong' })
    expect(run.events.map((e) => e.kind)).toEqual(['discussion'])
    expect(run.pledges[0]).not.toHaveProperty('email')
    expect(run.pledges[0]).not.toHaveProperty('name')
    expect(run.pledges[1].state).toBeNull()
  })

  it('applies a stamped rating only over an older one, so a slow save that lands late changes nothing', async () => {
    const store = createMemoryStore()
    await store.insertPrompt({ id: Q, run_id: 'r', participant_id: P, conversation_id: Q, turn: 0, prompt: 'Hi' })
    const at = (s: number) => new Date(Date.UTC(2026, 9, 26, 18, 0, s)).toISOString()
    const verdict = async () => (await store.loadRun('r')).prompts[0].verdict
    // The first rating has nothing to beat; a later one replaces it.
    expect(await store.updatePrompt(Q, P, { rated_at: at(1), verdict: 'right' }, at(1))).toBe(true)
    expect(await store.updatePrompt(Q, P, { rated_at: at(3), verdict: 'wrong' }, at(3))).toBe(true)
    // The tap between them, landing last, and a repeat of the same stamp, don't.
    expect(await store.updatePrompt(Q, P, { rated_at: at(2), verdict: 'unsure' }, at(2))).toBe(false)
    expect(await store.updatePrompt(Q, P, { rated_at: at(3), verdict: 'unsure' }, at(3))).toBe(false)
    expect(await verdict()).toBe('wrong')
    // Another participant's stamp never reaches the row.
    expect(await store.updatePrompt(Q, Q, { rated_at: at(9), verdict: 'unsure' }, at(9))).toBe(false)
    // Unstamped (a page from before stamps, or the rules check's verdict), it applies as it always did.
    expect(await store.updatePrompt(Q, P, { post_check_verdict: 'wrong' })).toBe(true)
    expect(await verdict()).toBe('wrong')
  })

  it('stamps each control write after the one before, even when the clock steps back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const store = createMemoryStore()
      vi.setSystemTime(new Date('2026-10-27T00:30:02.000Z'))
      const first = await store.setControl({ stage: 'try' })
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      expect(await store.setControl({ stage: 'scale' })).toMatchObject({ stage: 'scale', updatedAt: '2026-10-27T00:30:02.001Z' })
      expect(first.updatedAt).toBe('2026-10-27T00:30:02.000Z')
      // Once the clock is ahead again, the stamp is the clock's.
      vi.setSystemTime(new Date('2026-10-27T00:30:05.000Z'))
      expect(await store.setControl({ stage: 'groups' })).toMatchObject({ updatedAt: '2026-10-27T00:30:05.000Z' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stamps control writes in the order they come, whatever the clock does, and keeps each field from the last write that set it', async () => {
    const write = fc.record({
      // The clock's reading for this write, in milliseconds, free to go back or repeat.
      clock: fc.integer({ min: 0, max: 50 }),
      runId: fc.option(fc.constantFrom('r1', 'r2', 'r3'), { nil: undefined }),
      stage: fc.option(fc.constantFrom('try', 'scale', 'groups'), { nil: undefined }),
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await fc.assert(
        fc.asyncProperty(fc.array(write, { minLength: 1, maxLength: 12 }), async (writes) => {
          const start = Date.parse('2026-10-27T00:30:00.000Z')
          const store = createMemoryStore()
          let expected = await store.getControl()
          let last = -Infinity
          for (const w of writes) {
            vi.setSystemTime(start + w.clock)
            const row = await store.setControl({ runId: w.runId, stage: w.stage })
            const stamp = Date.parse(row.updatedAt!)
            expect(stamp).toBeGreaterThan(last)
            expect(stamp).toBeGreaterThanOrEqual(start + w.clock)
            last = stamp
            expected = { ...expected, ...(w.runId ? { runId: w.runId } : {}), ...(w.stage ? { stage: w.stage } : {}) }
            expect(row).toEqual({ ...expected, updatedAt: row.updatedAt })
            expect(await store.getControl()).toEqual(row)
          }
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const { status = 200, body } = handler(String(url), init)
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(status === 204 ? null : text, { status })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

describe('supabase store', () => {
  const config = { url: 'https://db.example', key: 'service' }

  it('reads and writes the control row', async () => {
    const { fn, calls } = fakeFetch((url, init) =>
      init.method === 'PATCH'
        ? { body: [{ run_id: 'phoenix', stage: 'reveal', updated_at: 't' }] }
        : { body: [{ run_id: 'rehearsal', stage: 'welcome', updated_at: null }] },
    )
    const store = createSupabaseStore(config, fn)
    expect(await store.getControl()).toEqual({ runId: 'rehearsal', stage: 'welcome', updatedAt: null, live: true })
    expect(await store.setControl({ runId: 'phoenix', stage: 'reveal' })).toMatchObject({ stage: 'reveal' })
    expect(calls[0].url).toBe('https://db.example/rest/v1/aspen_control?id=eq.live&select=run_id,stage,updated_at')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer service')
    const patch = JSON.parse(String(calls[1].init.body))
    expect(patch).toMatchObject({ run_id: 'phoenix', stage: 'reveal' })
    expect(patch.updated_at).toBeTruthy()
  })

  it('writes the control row only over an older one, so two moves landing out of order leave the later', async () => {
    // PostgREST's side of the stamp check: the PATCH changes the row only when the filter matches.
    let row = { run_id: 'r1', stage: 'welcome', updated_at: '2026-10-27T00:30:00.000Z' }
    const { fn, calls } = fakeFetch((url, init) => {
      if (init.method !== 'PATCH') return { body: [row] }
      const patch = JSON.parse(String(init.body))
      expect(new URL(url).searchParams.get('updated_at')).toBe(`lt.${patch.updated_at}`)
      if (!(row.updated_at < patch.updated_at)) return { body: [] }
      row = { ...row, ...patch }
      return { body: [row] }
    })
    const store = createSupabaseStore(config, fn)
    vi.useFakeTimers()
    try {
      // The later move's write lands first...
      vi.setSystemTime(new Date('2026-10-27T00:30:02.000Z'))
      expect(await store.setControl({ stage: 'scale' })).toMatchObject({ stage: 'scale', updatedAt: '2026-10-27T00:30:02.000Z' })
      // ...then the earlier one's, stamped before it: it changes nothing and answers with the row as it is.
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      expect(await store.setControl({ stage: 'try' })).toMatchObject({ stage: 'scale', updatedAt: '2026-10-27T00:30:02.000Z' })
      expect(row.stage).toBe('scale')
      expect(calls.map((c) => c.init.method ?? 'GET')).toEqual(['PATCH', 'PATCH', 'GET'])
      // And a write in the same millisecond as the row's is no newer, so it changes nothing either.
      vi.setSystemTime(new Date('2026-10-27T00:30:02.000Z'))
      expect(await store.setControl({ stage: 'groups' })).toMatchObject({ stage: 'scale' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the whole newest write: a run switch that a later stage-only write beat to the row keeps the old run', async () => {
    // The store's contract the presenter works with (presenter-app's move): it sends no write across a
    // run switch, because the store applies a write whole, or not at all.
    let row = { run_id: 'r1', stage: 'scale', updated_at: '2026-10-27T00:30:00.000Z' }
    const held: { body: Record<string, string>; resolve: (r: Response) => void }[] = []
    const fn = (async (_url: string | URL | Request, init: RequestInit = {}) => {
      if (init.method !== 'PATCH') return new Response(JSON.stringify([row]))
      return new Promise<Response>((resolve) => held.push({ body: JSON.parse(String(init.body)), resolve }))
    }) as unknown as typeof fetch
    const store = createSupabaseStore(config, fn)
    const land = (i: number) => {
      const { body, resolve } = held[i]
      const applies = row.updated_at < body.updated_at
      if (applies) row = { ...row, ...body }
      resolve(new Response(JSON.stringify(applies ? [row] : [])))
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      const startRun = store.setControl({ runId: 'r2', stage: 'welcome' })
      vi.setSystemTime(new Date('2026-10-27T00:30:02.000Z'))
      const next = store.setControl({ stage: 'try' })
      land(1)
      await next
      land(0)
      expect(await startRun).toMatchObject({ runId: 'r1', stage: 'try' })
      expect(row).toMatchObject({ run_id: 'r1', stage: 'try' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the newest write, and answers each with a row no older than it, in any order the writes land', async () => {
    const start = Date.parse('2026-10-27T00:30:00.000Z')
    // Each move's stamp in milliseconds after the row's (0 ties it, and moves can tie each other), and
    // the order their writes reach the store in.
    const moves = fc
      .array(fc.record({ ms: fc.integer({ min: 0, max: 20 }), stage: fc.constantFrom('try', 'scale', 'groups', 'next') }), {
        minLength: 1,
        maxLength: 6,
      })
      .chain((list) =>
        fc.tuple(fc.constant(list), fc.shuffledSubarray([...list.keys()], { minLength: list.length, maxLength: list.length })),
      )
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await fc.assert(
        fc.asyncProperty(moves, async ([list, order]) => {
          let row = { run_id: 'r1', stage: 'welcome', updated_at: new Date(start).toISOString() }
          const rows = [row]
          // PostgREST, holding each write until the test lands it, and applying it only when the filter matches.
          const held: { url: string; body: { stage: string; updated_at: string }; resolve: (r: Response) => void }[] = []
          const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
            if (init.method !== 'PATCH') return new Response(JSON.stringify([row]))
            return new Promise<Response>((resolve) => held.push({ url: String(url), body: JSON.parse(String(init.body)), resolve }))
          }) as unknown as typeof fetch
          const store = createSupabaseStore(config, fn)
          const stamps = list.map((move) => new Date(start + move.ms).toISOString())
          const answers = list.map((move, i) => {
            vi.setSystemTime(Date.parse(stamps[i]))
            return store.setControl({ stage: move.stage })
          })
          while (held.length < list.length) await new Promise((r) => setTimeout(r, 0))
          for (const i of order) {
            const { url, body, resolve } = held[i]
            expect(body.updated_at).toBe(stamps[i])
            expect(new URL(url).searchParams.get('updated_at')).toBe(`lt.${stamps[i]}`)
            const before = row.updated_at
            const applies = row.updated_at < body.updated_at
            if (applies) {
              row = { ...row, ...body }
              rows.push(row)
            }
            expect(row.updated_at >= before).toBe(true)
            resolve(new Response(JSON.stringify(applies ? [row] : [])))
            // Let a write that changed nothing read the row before the next write lands.
            await new Promise((r) => setTimeout(r, 0))
          }
          const newest = [rows[0].updated_at, ...stamps].reduce((a, b) => (b > a ? b : a))
          const winner = newest === rows[0].updated_at ? 'welcome' : list[order.find((i) => stamps[i] === newest)!].stage
          expect(row).toMatchObject({ stage: winner, updated_at: newest })
          const answered = await Promise.all(answers)
          answered.forEach((answer, i) => {
            expect(answer.updatedAt! >= stamps[i]).toBe(true)
            expect(rows).toContainEqual({ run_id: answer.runId, stage: answer.stage, updated_at: answer.updatedAt })
          })
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the default control when the row is missing', async () => {
    const { fn } = fakeFetch(() => ({ body: [] }))
    expect(await createSupabaseStore(config, fn).getControl()).toEqual(DEFAULT_CONTROL)
  })

  it('upserts participants and inserts rows', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: '' }))
    const store = createSupabaseStore(config, fn)
    await store.upsertParticipant({ id: P, run_id: 'r' })
    await store.insertPrompt({ id: Q, run_id: 'r', participant_id: P, conversation_id: Q, turn: 0, prompt: 'x' })
    await store.insertEvent({ run_id: 'r', kind: 'chip', payload: {} })
    await store.insertPledge({ run_id: 'r', email: 'a@b.org', accurate_ai: true, state_systems: false, show_state: true })
    expect(calls.map((c) => c.url.replace(config.url, ''))).toEqual([
      '/rest/v1/aspen_participants?on_conflict=id',
      '/rest/v1/aspen_prompts',
      '/rest/v1/aspen_events',
      '/rest/v1/aspen_pledges',
    ])
    expect((calls[0].init.headers as Record<string, string>).Prefer).toMatch(/merge-duplicates/)
    expect(JSON.parse(String(calls[0].init.body)).last_seen_at).toBeTruthy()
  })

  it('patches only the participant’s own prompt', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: [{ id: Q }] }))
    const store = createSupabaseStore(config, fn)
    expect(await store.updatePrompt(Q, P, { verdict: 'right' })).toBe(true)
    expect(calls[0].url).toContain(`id=eq.${Q}&participant_id=eq.${P}`)
    expect(calls[0].url).not.toContain('or=')
    const empty = createSupabaseStore(config, fakeFetch(() => ({ body: [] })).fn)
    expect(await empty.updatePrompt(Q, P, {})).toBe(false)
  })

  it('puts the stamp check in the same update, with the time quoted as or=() needs', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: [] }))
    const at = '2026-10-26T18:00:01.234Z'
    // No row matched: missing, someone else's, or already rated later.
    expect(await createSupabaseStore(config, fn).updatePrompt(Q, P, { rated_at: at, verdict: 'right' }, at)).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('PATCH')
    const query = new URL(calls[0].url).searchParams
    expect(query.get('or')).toBe(`(rated_at.is.null,rated_at.lt."${at}")`)
    expect(query.get('id')).toBe(`eq.${Q}`)
    expect(query.get('participant_id')).toBe(`eq.${P}`)
  })

  it('loads a run without emails or names', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: [] }))
    const run = await createSupabaseStore(config, fn).loadRun('phoenix')
    expect(run).toEqual({ participants: [], prompts: [], events: [], pledges: [] })
    const pledgeQuery = calls.find((c) => c.url.includes('aspen_pledges'))!.url
    expect(pledgeQuery).toContain('select=state,accurate_ai,state_systems,show_state,created_at')
    expect(pledgeQuery).not.toContain('email')
    const eventQuery = calls.find((c) => c.url.includes('aspen_events'))!.url
    expect(eventQuery).toContain('kind=in.(discussion,breakout,survey,vote)')
    // The participant id lets the summary keep each person's latest answer; it never leaves the server.
    expect(eventQuery).toContain('select=run_id,participant_id,kind,stage,payload,created_at')
    // Ties in time fall back to insert order, so each person's latest answer reads the same every time.
    expect(eventQuery).toContain('order=created_at.asc,id.asc')
  })

  it('raises on HTTP errors and tolerates 204', async () => {
    const failing = createSupabaseStore(config, fakeFetch(() => ({ status: 404, body: 'missing' })).fn)
    await expect(failing.getControl()).rejects.toThrow(/404 missing/)
    const noContent = createSupabaseStore(config, fakeFetch(() => ({ status: 204 })).fn)
    await expect(noContent.insertEvent({ run_id: 'r', kind: 'chip', payload: {} })).resolves.toBeUndefined()
  })
})

/**
 * What PostgREST returns for a select list, written apart from the store's
 * own projection: plain columns, and `alias:column->key->>key` JSON paths
 * (`->` keeps JSON, `->>` gives text, a digit indexes an array).
 */
function postgrestSelect(row: Record<string, unknown>, select: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const item of select.split(',')) {
    const match = item.match(/^(?:(\w+):)?(\w+)((?:->>?\w+)*)$/)
    if (!match) throw new Error(`PGRST100: failed to parse select item ${item}`)
    const [, alias, column, path] = match
    const steps = [...path.matchAll(/(->>?)(\w+)/g)]
    let value: unknown = row[column] ?? null
    let text = false
    for (const [, arrow, key] of steps) {
      if (value === null || typeof value !== 'object') {
        value = null
        break
      }
      value = Array.isArray(value) ? (/^\d+$/.test(key) ? value[Number(key)] : undefined) : (value as Record<string, unknown>)[key]
      value = value ?? null
      text = arrow === '->>'
    }
    if (text && value !== null && typeof value !== 'string') value = JSON.stringify(value)
    out[alias ?? (steps.length ? steps[steps.length - 1][2] : column)] = value
  }
  return out
}

describe('both stores load a run the same way', () => {
  const az = summarizeRules(parseDataStream(azSavingsStream())).computations
  const ny = [{ ...az[0], program: 'us-ny-snap', displayName: 'New York SNAP', disclosures: [], eligibilityTested: true }]
  // Saved before checks carried a verdict: its program decides.
  const older = az.map(({ eligibilityTested: _dropped, ...rest }) => rest)
  const prompt = (n: number, extra: Partial<PromptRow>): PromptRow => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    run_id: 'phoenix',
    participant_id: P,
    conversation_id: Q,
    turn: 0,
    created_at: `2026-10-26T18:0${n}:00.000Z`,
    prompt: `Question ${n}`,
    answer: 'You would get $0.',
    verdict: 'wrong',
    resident_action: 'not-apply',
    rules_answer: 'Long prose the results never read.',
    ...extra,
  })
  const ROWS: PromptRow[] = [
    prompt(1, { household_id: 'az-savings', rules_program: 'Arizona SNAP', rules_amount: 24, rules_outputs: az }),
    prompt(2, { household_id: 'ny-parent', rules_program: 'New York SNAP', rules_amount: 300, rules_outputs: ny }),
    prompt(3, { household_id: 'az-savings', rules_program: 'Arizona SNAP', rules_amount: 24, rules_outputs: older }),
    prompt(4, { rules_outputs: null }),
    prompt(5, { verdict: 'right', resident_action: 'apply' }),
  ]

  async function loadBoth() {
    const memory = createMemoryStore()
    for (const row of ROWS) await memory.insertPrompt(row)
    const { fn, calls } = fakeFetch((url) => {
      const parsed = new URL(url)
      if (!parsed.pathname.endsWith('/aspen_prompts')) return { body: [] }
      return { body: ROWS.map((row) => postgrestSelect(row as unknown as Record<string, unknown>, parsed.searchParams.get('select')!)) }
    })
    const supabase = createSupabaseStore({ url: 'https://db.example', key: 'service' }, fn)
    return { memory: await memory.loadRun('phoenix'), supabase: await supabase.loadRun('phoenix'), calls }
  }

  it('selects the rules check by JSON path, not the whole saved computation', async () => {
    const { calls } = await loadBoth()
    const select = new URL(calls.find((c) => c.url.includes('aspen_prompts'))!.url).searchParams.get('select')!
    expect(select).toBe(RUN_PROMPT_SELECT)
    expect(select.split(',')).toEqual(
      expect.arrayContaining([
        'rules_program_id:rules_outputs->0->>program',
        'rules_eligibility_tested:rules_outputs->0->eligibilityTested',
      ]),
    )
    expect(select.split(',')).not.toContain('rules_outputs')
    expect(select.split(',')).not.toContain('rules_answer')
  })

  it('returns the same prompts and the same room summary from memory and from Supabase', async () => {
    const { memory, supabase } = await loadBoth()
    expect(memory.prompts).toEqual(supabase.prompts)
    expect(memory.prompts[0]).toMatchObject({ rules_program_id: 'us-az-snap', rules_eligibility_tested: false })
    expect(memory.prompts[2]).toMatchObject({ rules_program_id: 'us-az-snap', rules_eligibility_tested: null })
    expect(memory.prompts[3]).toMatchObject({ rules_program_id: null, rules_eligibility_tested: null })
    expect(memory.prompts[0]).not.toHaveProperty('rules_outputs')
    const room = (run: typeof memory) => summarizeRun({ ...run, participants: [], events: [], pledges: [] })
    expect(room(memory)).toEqual(room(supabase))
    // The bug this guards: in production an Arizona $24 counted as a household that qualifies.
    expect(room(supabase).viability).toMatchObject({ wouldNotApply: 4, wouldNotApplyEligible: 1, wouldNotApplyIfEligible: 2 })
    expect(room(supabase).feed.filter((f) => f.rulesIfEligible).map((f) => f.prompt)).toEqual(['Question 3', 'Question 1'])
  })
})

describe('store selection and control cache', () => {
  beforeEach(() => {
    _resetMemoryStore()
    _resetControlCache()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('picks memory, supabase, or nothing from the environment', () => {
    vi.stubEnv('ASPEN_STORE', 'memory')
    const memory = getStore()
    expect(memory?.kind).toBe('memory')
    expect(getStore()).toBe(memory)
    vi.stubEnv('ASPEN_STORE', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example/')
    vi.stubEnv('AXIOM_OPS_SUPABASE_SERVICE_KEY', 'service')
    expect(getStore()?.kind).toBe('supabase')
    vi.stubEnv('AXIOM_OPS_SUPABASE_SERVICE_KEY', '')
    expect(getStore()).toBeNull()
  })

  it('caches the control row briefly and falls back on errors', async () => {
    expect(await readControl(null)).toEqual(DEFAULT_CONTROL)
    const store = createMemoryStore()
    const spy = vi.spyOn(store, 'getControl')
    await readControl(store)
    await readControl(store)
    expect(spy).toHaveBeenCalledTimes(1)
    await readControl(store, true)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(await writeControl(store, { stage: 'scale' })).toMatchObject({ stage: 'scale' })
    expect(await readControl(store)).toMatchObject({ stage: 'scale' })

    const broken = { getControl: () => Promise.reject(new Error('down')) } as unknown as AspenStore
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await readControl(broken, true)).toEqual(DEFAULT_CONTROL)
  })

  it('runs writes safely', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await safely('ok', async () => 3)).toBe(3)
    expect(await safely('fail', async () => Promise.reject(new Error('x')))).toBeNull()
  })
})

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

  it('takes a control write only while the room is still in the run it was made in', async () => {
    const store = createMemoryStore()
    await store.setControl({ runId: 'live', stage: 'welcome' })
    const before = await store.getControl()
    expect(await store.setControl({ stage: 'try', inRun: 'rehearsal' })).toEqual(before)
    expect(await store.setControl({ runId: 'other', inRun: 'rehearsal' })).toEqual(before)
    expect(await store.setControl({ stage: 'try', inRun: 'live' })).toMatchObject({ runId: 'live', stage: 'try' })
    expect(await store.setControl({ runId: 'next', stage: 'welcome', inRun: 'live' })).toMatchObject({ runId: 'next', stage: 'welcome' })
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
      // The run the write was made in, if it names one.
      inRun: fc.option(fc.constantFrom(DEFAULT_CONTROL.runId, 'r1', 'r2', 'r3'), { nil: undefined }),
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
            const held = await store.getControl()
            const row = await store.setControl({ runId: w.runId, stage: w.stage, inRun: w.inRun })
            // A write made in another run than the room's changes nothing, its stamp included.
            if (w.inRun !== undefined && w.inRun !== held.runId) {
              expect(row).toEqual(held)
              expect(await store.getControl()).toEqual(held)
              continue
            }
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

  it('takes a write only while the row is still in the run it was made in, checked in the same update', async () => {
    // PostgREST's side: the PATCH changes the row only when both filters match.
    let row = { run_id: 'live', stage: 'welcome', updated_at: '2026-10-27T00:30:00.000Z' }
    const { fn, calls } = fakeFetch((url, init) => {
      if (init.method !== 'PATCH') return { body: [row] }
      const patch = JSON.parse(String(init.body))
      const query = new URL(url).searchParams
      const run = query.get('run_id')
      if (!(row.updated_at < patch.updated_at) || (run !== null && run !== `eq.${row.run_id}`)) return { body: [] }
      row = { ...row, ...patch }
      return { body: [row] }
    })
    const store = createSupabaseStore(config, fn)
    vi.useFakeTimers()
    try {
      // A move the presenter made in the rehearsal reaches the store after Start run: it changes nothing.
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      expect(await store.setControl({ stage: 'try', inRun: 'rehearsal' })).toMatchObject({ runId: 'live', stage: 'welcome' })
      expect(new URL(calls[0].url).searchParams.get('run_id')).toBe('eq.rehearsal')
      expect(row.stage).toBe('welcome')
      // One made in the live run goes; one that names no run is checked by its stamp alone.
      vi.setSystemTime(new Date('2026-10-27T00:30:02.000Z'))
      expect(await store.setControl({ stage: 'reveal', inRun: 'live' })).toMatchObject({ runId: 'live', stage: 'reveal' })
      vi.setSystemTime(new Date('2026-10-27T00:30:03.000Z'))
      expect(await store.setControl({ stage: 'scale' })).toMatchObject({ stage: 'scale' })
      expect(new URL(calls.at(-1)!.url).searchParams.has('run_id')).toBe(false)
      // The run is not written from it: `inRun` only checks.
      expect(JSON.parse(String(calls.at(-1)!.init.body))).not.toHaveProperty('inRun')
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

  it('keeps the newest write in the run it names, and answers each with a row no older than it or in another run, in any order the writes land', async () => {
    const start = Date.parse('2026-10-27T00:30:00.000Z')
    // Each move's stamp in milliseconds after the row's (0 ties it, and moves can tie each other), maybe a
    // run switch, maybe the run it was made in, and the order their writes reach the store in.
    const moves = fc
      .array(
        fc.record({
          ms: fc.integer({ min: 0, max: 20 }),
          stage: fc.constantFrom('try', 'scale', 'groups', 'next'),
          runId: fc.option(fc.constantFrom('r1', 'r2'), { nil: undefined }),
          inRun: fc.option(fc.constantFrom('r1', 'r2'), { nil: undefined }),
        }),
        { minLength: 1, maxLength: 6 },
      )
      .chain((list) =>
        fc.tuple(fc.constant(list), fc.shuffledSubarray([...list.keys()], { minLength: list.length, maxLength: list.length })),
      )
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await fc.assert(
        fc.asyncProperty(moves, async ([list, order]) => {
          let row = { run_id: 'r1', stage: 'welcome', updated_at: new Date(start).toISOString() }
          const rows = [row]
          // PostgREST, holding each write until the test lands it, and applying it only when both filters match.
          const held: { url: string; body: { run_id?: string; stage: string; updated_at: string }; resolve: (r: Response) => void }[] = []
          const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
            if (init.method !== 'PATCH') return new Response(JSON.stringify([row]))
            return new Promise<Response>((resolve) => held.push({ url: String(url), body: JSON.parse(String(init.body)), resolve }))
          }) as unknown as typeof fetch
          const store = createSupabaseStore(config, fn)
          const stamps = list.map((move) => new Date(start + move.ms).toISOString())
          const answers = list.map((move, i) => {
            vi.setSystemTime(Date.parse(stamps[i]))
            return store.setControl({ runId: move.runId, stage: move.stage, inRun: move.inRun })
          })
          while (held.length < list.length) await new Promise((r) => setTimeout(r, 0))
          // The writes that changed the row, in the order they landed.
          const landed: number[] = []
          for (const i of order) {
            const { url, body, resolve } = held[i]
            const query = new URL(url).searchParams
            expect(body).toEqual({ ...(list[i].runId ? { run_id: list[i].runId } : {}), stage: list[i].stage, updated_at: stamps[i] })
            expect(query.get('updated_at')).toBe(`lt.${stamps[i]}`)
            // The run check is in the same update as the stamp check, and only when the move names a run.
            expect(query.get('run_id')).toBe(list[i].inRun ? `eq.${list[i].inRun}` : null)
            const before = row
            const applies = row.updated_at < body.updated_at && (!list[i].inRun || list[i].inRun === row.run_id)
            if (applies) {
              row = { ...row, ...body }
              rows.push(row)
              landed.push(i)
            }
            expect(row.updated_at >= before.updated_at).toBe(true)
            resolve(new Response(JSON.stringify(applies ? [row] : [])))
            // Let a write that changed nothing read the row before the next write lands.
            await new Promise((r) => setTimeout(r, 0))
          }
          // The row holds each field from the last write that changed it and set that field.
          expect(row).toEqual(landed.reduce((r, i) => ({ ...r, ...held[i].body }), rows[0]))
          if (list.every((move) => !move.inRun)) {
            const newest = [rows[0].updated_at, ...stamps].reduce((a, b) => (b > a ? b : a))
            expect(row.updated_at).toBe(newest)
          }
          const answered = await Promise.all(answers)
          answered.forEach((answer, i) => {
            // A move answered with an older row was refused for its run: the row was in another one.
            expect(answer.updatedAt! >= stamps[i] || (list[i].inRun !== undefined && answer.runId !== list[i].inRun)).toBe(true)
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

  /** PostgREST over one control row: each PATCH applies when it arrives, only over an older row; `hold` keeps answers back. */
  function heldDatabase(initial: { run_id: string; stage: string; updated_at: string }) {
    let row = { ...initial }
    const held: (() => void)[] = []
    const database = (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      let rows: unknown[] = [row]
      if (init.method === 'PATCH') {
        const patch = JSON.parse(String(init.body))
        const applies = row.updated_at < patch.updated_at
        if (applies) row = { ...row, ...patch }
        rows = applies ? [row] : []
      }
      const answer = new Response(JSON.stringify(rows))
      return db.hold ? new Promise<Response>((resolve) => held.push(() => resolve(answer))) : answer
    }) as unknown as typeof fetch
    const db = { hold: false, held, row: () => row, store: createSupabaseStore({ url: 'https://db.example', key: 'service' }, database) }
    return db
  }

  it('keeps the newest row in the cache when an older read or write answers after a newer one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      const db = heldDatabase({ run_id: 'rehearsal', stage: 'try', updated_at: '2026-10-27T00:30:00.000Z' })
      // A phone's read goes out before Start run and answers after it, with the row from before.
      db.hold = true
      const oldRead = readControl(db.store)
      db.hold = false
      expect(await writeControl(db.store, { runId: 'aspen', stage: 'welcome' })).toMatchObject({ runId: 'aspen' })
      vi.setSystemTime(new Date('2026-10-27T00:30:02.000Z'))
      db.held.shift()!()
      // That phone gets the newest row this instance knows, and so does every phone after it.
      expect(await oldRead).toMatchObject({ runId: 'aspen', stage: 'welcome' })
      expect(await readControl(db.store)).toMatchObject({ runId: 'aspen', stage: 'welcome' })

      // A move's answer comes back after a later move's: that move gets its own answer, and the cache keeps the later.
      vi.setSystemTime(new Date('2026-10-27T00:30:03.000Z'))
      db.hold = true
      const firstPost = writeControl(db.store, { stage: 'try' })
      db.hold = false
      vi.setSystemTime(new Date('2026-10-27T00:30:04.000Z'))
      expect(await writeControl(db.store, { stage: 'reveal' })).toMatchObject({ stage: 'reveal' })
      db.held.shift()!()
      expect(await firstPost).toMatchObject({ stage: 'try' })
      expect(await readControl(db.store)).toMatchObject({ stage: 'reveal' })
      expect(db.row()).toMatchObject({ run_id: 'aspen', stage: 'reveal' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('ages a cached row from when it was asked for, so a slow read is not served for two seconds after it answers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      const db = heldDatabase({ run_id: 'aspen', stage: 'try', updated_at: '2026-10-27T00:30:00.000Z' })
      const spy = vi.spyOn(db.store, 'getControl')
      db.hold = true
      const slow = readControl(db.store)
      db.hold = false
      vi.setSystemTime(new Date('2026-10-27T00:30:04.000Z'))
      db.held.shift()!()
      expect(await slow).toMatchObject({ stage: 'try' })
      // The row it read is from 00:30:01, past the cache's two seconds: the next read asks the store again.
      await readControl(db.store)
      expect(spy).toHaveBeenCalledTimes(2)
      await readControl(db.store)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers a read asked while another is in flight from that one, if it was asked for under two seconds before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      const db = heldDatabase({ run_id: 'aspen', stage: 'try', updated_at: '2026-10-27T00:30:00.000Z' })
      const spy = vi.spyOn(db.store, 'getControl')
      // The store is slow: each read takes seconds, longer than the cache keeps a row.
      db.hold = true
      const first = readControl(db.store)
      vi.setSystemTime(new Date('2026-10-27T00:30:02.999Z'))
      const joined = readControl(db.store)
      expect(spy).toHaveBeenCalledTimes(1)
      // Two seconds after the read in flight was asked for, a read goes to the store itself.
      vi.setSystemTime(new Date('2026-10-27T00:30:03.000Z'))
      const own = readControl(db.store)
      expect(spy).toHaveBeenCalledTimes(2)
      vi.setSystemTime(new Date('2026-10-27T00:30:05.000Z'))
      for (const answer of db.held.splice(0)) answer()
      expect(await first).toMatchObject({ stage: 'try' })
      expect(await joined).toMatchObject({ stage: 'try' })
      expect(await own).toMatchObject({ stage: 'try' })
      // With nothing in flight and the rows aged out, the next read goes to the store again.
      db.hold = false
      await readControl(db.store)
      expect(spy).toHaveBeenCalledTimes(3)
      // A fresh read skips the read in flight, as it skips the cache.
      vi.setSystemTime(new Date('2026-10-27T00:30:08.000Z'))
      db.hold = true
      const inFlight = readControl(db.store)
      const fresh = readControl(db.store, true)
      expect(spy).toHaveBeenCalledTimes(5)
      for (const answer of db.held.splice(0)) answer()
      await Promise.all([inFlight, fresh])
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers phones polling one instance with one read of a slow store, though each request builds its own store', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      vi.stubEnv('ASPEN_STORE', '')
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
      vi.stubEnv('AXIOM_OPS_SUPABASE_SERVICE_KEY', 'service')
      const held: (() => void)[] = []
      const database = vi.fn(
        () =>
          new Promise<Response>((resolve) =>
            held.push(() => resolve(new Response(JSON.stringify([{ run_id: 'aspen', stage: 'try', updated_at: '2026-10-27T00:30:00.000Z' }])))),
          ),
      )
      vi.stubGlobal('fetch', database)
      // The state route reads `readControl(getStore())`, and getStore builds a store for each request.
      expect(getStore()).not.toBe(getStore())
      const first = readControl(getStore())
      vi.setSystemTime(new Date('2026-10-27T00:30:02.500Z'))
      const second = readControl(getStore())
      expect(database).toHaveBeenCalledTimes(1)
      for (const answer of held.splice(0)) answer()
      expect(await first).toMatchObject({ runId: 'aspen', stage: 'try' })
      expect(await second).toMatchObject({ runId: 'aspen', stage: 'try' })
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('shares a failed read only with the reads asked while it was in flight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      vi.setSystemTime(new Date('2026-10-27T00:30:01.000Z'))
      let down = true
      const getControl = vi.fn(async () => {
        if (down) throw new Error('down')
        return { runId: 'aspen', stage: 'try', live: true, updatedAt: '2026-10-27T00:30:00.000Z' }
      })
      const store = { getControl } as unknown as AspenStore
      expect(await readControl(store)).toEqual(DEFAULT_CONTROL)
      // Once it has answered, a read under two seconds later asks the store again: an error is not kept.
      down = false
      vi.setSystemTime(new Date('2026-10-27T00:30:01.500Z'))
      expect(await readControl(store)).toMatchObject({ runId: 'aspen', live: true })
      expect(getControl).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers each read with the newest row this instance has had, whatever order the store answers in', async () => {
    const command = fc.oneof(
      { weight: 2, arbitrary: fc.constant({ kind: 'read' as const }) },
      { weight: 2, arbitrary: fc.record({ kind: fc.constant('write' as const), stage: fc.constantFrom('try', 'reveal', 'scale'), run: fc.boolean() }) },
      { weight: 3, arbitrary: fc.record({ kind: fc.constant('answer' as const), pick: fc.nat() }) },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant('wait' as const), ms: fc.integer({ min: 0, max: 1500 }) }) },
    )
    vi.useFakeTimers({ toFake: ['Date'] })
    // Lets every answer the test released reach the cache.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    try {
      await fc.assert(
        fc.asyncProperty(fc.array(command, { minLength: 1, maxLength: 20 }), fc.array(fc.nat(), { minLength: 20, maxLength: 20 }), async (commands, last) => {
          _resetControlCache()
          vi.setSystemTime(new Date('2026-10-27T00:30:00.000Z'))
          const db = heldDatabase({ run_id: 'r0', stage: 'welcome', updated_at: '2026-10-27T00:29:00.000Z' })
          db.hold = true
          const stamp = (c: { updatedAt: string | null }) => c.updatedAt ?? ''
          // The newest row the store has answered with so far, and each read's answer with the newest when it came.
          let newest = ''
          const got: { answer: string; newest: string }[] = []
          const database = db.store
          const getControl = database.getControl.bind(database)
          const setControl = database.setControl.bind(database)
          database.getControl = async () => {
            const row = await getControl()
            if (stamp(row) > newest) newest = stamp(row)
            return row
          }
          database.setControl = async (patch) => {
            const row = await setControl(patch)
            if (stamp(row) > newest) newest = stamp(row)
            return row
          }
          let writes = 0
          const release = async (pick: number) => {
            if (db.held.length === 0) return
            db.held.splice(pick % db.held.length, 1)[0]()
            await settle()
          }
          for (const c of commands) {
            if (c.kind === 'read') {
              void readControl(database).then((row) => got.push({ answer: stamp(row), newest }))
              await settle()
            } else if (c.kind === 'write') {
              writes += 1
              vi.setSystemTime(Date.now() + 1)
              void writeControl(database, { stage: c.stage, ...(c.run ? { runId: `r${writes}` } : {}) })
              await settle()
            } else if (c.kind === 'answer') await release(c.pick)
            else vi.setSystemTime(Date.now() + c.ms)
          }
          for (let i = 0; db.held.length > 0; i += 1) await release(last[i % last.length])
          for (const { answer, newest } of got) expect(answer).toBe(newest)
          // Once every answer is in, a read gets the store's row.
          db.hold = false
          expect(stamp(await readControl(database))).toBe(db.row().updated_at)
        }),
        { numRuns: 300 },
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs writes safely', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await safely('ok', async () => 3)).toBe(3)
    expect(await safely('fail', async () => Promise.reject(new Error('x')))).toBeNull()
  })
})

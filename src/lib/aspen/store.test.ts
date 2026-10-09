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
  type AspenStore,
} from './store'

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
    const empty = createSupabaseStore(config, fakeFetch(() => ({ body: [] })).fn)
    expect(await empty.updatePrompt(Q, P, {})).toBe(false)
  })

  it('loads a run without emails or names', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: [] }))
    const run = await createSupabaseStore(config, fn).loadRun('phoenix')
    expect(run).toEqual({ participants: [], prompts: [], events: [], pledges: [] })
    const pledgeQuery = calls.find((c) => c.url.includes('aspen_pledges'))!.url
    expect(pledgeQuery).toContain('select=state,accurate_ai,state_systems,show_state,created_at')
    expect(pledgeQuery).not.toContain('email')
    expect(calls.find((c) => c.url.includes('aspen_events'))!.url).toContain('kind=in.(discussion,breakout,survey,vote)')
  })

  it('raises on HTTP errors and tolerates 204', async () => {
    const failing = createSupabaseStore(config, fakeFetch(() => ({ status: 404, body: 'missing' })).fn)
    await expect(failing.getControl()).rejects.toThrow(/404 missing/)
    const noContent = createSupabaseStore(config, fakeFetch(() => ({ status: 204 })).fn)
    await expect(noContent.insertEvent({ run_id: 'r', kind: 'chip', payload: {} })).resolves.toBeUndefined()
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

// The Aspen API routes end to end on the in-process memory store: sign in,
// ask (streamed), rate, check against the rules, discuss, pledge, and read
// the room's results. External calls (OpenAI, the rules chatbot) are faked.

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}))

import { POST as signIn, DELETE as signOut } from './sign-in/route'
import { GET as getState, POST as setState } from './state/route'
import { POST as ask } from './ask/route'
import { POST as rate } from './rate/route'
import { POST as rules } from './rules/route'
import { POST as event } from './event/route'
import { POST as pledge } from './pledge/route'
import { GET as results } from './results/route'
import { _resetControlCache, _resetMemoryStore } from '@/lib/aspen/store'
import { _resetRateLimits } from '@/lib/aspen/limit'

const P = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const C = '7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f'

const post = (body: unknown) =>
  new Request('https://axiom.org/api/aspen/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify(body),
  })

const RULES_STREAM = [
  `9:${JSON.stringify({ toolCallId: 'c1', toolName: 'compute', args: {} })}`,
  `a:${JSON.stringify({
    toolCallId: 'c1',
    result: {
      program: 'us-az-snap',
      display_name: 'Arizona SNAP',
      period: '2026-10',
      primary_output: 'snap_benefit',
      outputs: [{ name: 'snap_benefit', label: 'Snap benefit', value: 24, unit: 'USD', legal_id: 'us:x#snap_benefit' }],
    },
  })}`,
  `0:${JSON.stringify('Estimated Arizona SNAP: $24/month.')}`,
].join('\n')

async function readLines(response: Response) {
  const text = await response.text()
  return text.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('aspen API routes', () => {
  beforeEach(() => {
    jar.clear()
    _resetMemoryStore()
    _resetControlCache()
    _resetRateLimits()
    vi.stubEnv('ASPEN_STORE', 'memory')
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    vi.stubEnv('ASPEN_PRESENTER_PASSWORD', 'stage')
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ASPEN_PLEDGE_WEBHOOK_URL', '')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/api/raw')) return Response.json({ text: 'You may not qualify: about $0.' })
        if (String(url).endsWith('/api/chat')) return new Response(RULES_STREAM)
        throw new Error(`unexpected fetch ${url}`)
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps everything behind the password', async () => {
    expect((await getState()).status).toBe(401)
    expect((await ask(post({}))).status).toBe(401)
    expect((await signIn(post({ password: 'wrong' }))).status).toBe(401)
    expect((await signIn(post({}))).status).toBe(401)
    const ok = await signIn(post({ password: 'room' }))
    expect(await ok.json()).toEqual({ ok: true, kind: 'participant' })
    expect((await getState()).status).toBe(200)
    expect((await setState(post({ stage: 'try' }))).status).toBe(403)
    await signOut()
    expect((await getState()).status).toBe(401)
  })

  it('closes the page without a password and limits sign-in tries', async () => {
    vi.stubEnv('ASPEN_PASSWORD', '')
    expect((await signIn(post({ password: 'room' }))).status).toBe(503)
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    for (let i = 0; i < 10; i += 1) await signIn(post({ password: 'wrong' }))
    expect((await signIn(post({ password: 'room' }))).status).toBe(429)
  })

  it('runs the evening: ask, rate, check, discuss, pledge, results', async () => {
    await signIn(post({ password: 'stage' }))
    expect(await (await setState(post({ runId: 'phoenix', stage: 'try' }))).json()).toMatchObject({
      runId: 'phoenix',
      stage: 'try',
      live: true,
    })
    expect((await setState(post({ stage: 'nowhere' }))).status).toBe(400)

    await event(post({ participantId: P, kind: 'profile', payload: { perspective: 'resident', state: 'Arizona', role: 'Other' } }))

    const asked = await ask(
      post({
        participantId: P,
        conversationId: C,
        turn: 0,
        messages: [{ role: 'user', content: 'Can I get SNAP?' }],
        meta: { stage: 'try', perspective: 'resident', householdId: 'az-savings', questionId: 'amount', twists: ['gig', 'bogus'], promptTemplate: 'Can I get SNAP?' },
      }),
    )
    expect(asked.headers.get('content-type')).toMatch(/ndjson/)
    const lines = await readLines(asked)
    expect(lines.map((l) => l.type)).toEqual(['meta', 'delta', 'done'])
    expect(lines[2]).toMatchObject({ backend: 'finbot-raw', webSearch: false })
    const promptId = String(lines[0].promptId)

    expect((await rate(post({ participantId: P, promptId }))).status).toBe(400)
    expect(
      await (
        await rate(post({ participantId: P, promptId, verdict: 'wrong', wouldAct: 'no', residentAction: 'not-apply', wentWrong: ['Wrong amount', 'bogus'] }))
      ).json(),
    ).toEqual({ ok: true, saved: true })
    expect(await (await rate(post({ participantId: C, promptId, verdict: 'right' }))).json()).toEqual({ ok: true, saved: false })

    const checked = await (
      await rules(post({ participantId: P, promptId, messages: [{ role: 'user', content: 'Can I get SNAP?' }] }))
    ).json()
    expect(checked).toMatchObject({ amount: 24, program: 'Arizona SNAP', period: '2026-10' })
    await rate(post({ participantId: P, promptId, postCheck: 'wrong' }))

    await event(post({ participantId: P, kind: 'discussion', payload: { question: 'misunderstood', topics: ['Asset tests'], note: 'BBCE' } }))
    await event(post({ participantId: P, kind: "discussion", payload: { question: "performance", ratings: { amount: 2, clarity: 9, bogus: 3 } } }))
    await event(post({ participantId: P, kind: "chip", payload: { householdId: "az-savings", twists: ["gig", "nope"] } }))
    await event(post({ participantId: P, kind: "discussion", stage: "rate", payload: { question: null, note: "Staff use it already" } }))
    await event(post({ participantId: P, kind: "survey", stage: "rate", payload: { question: "source-of-truth", answer: "no" } }))
    expect((await event(post({ participantId: P, kind: "survey", payload: { question: "source-of-truth", answer: "maybe" } }))).status).toBe(400)
    expect((await event(post({ participantId: P, kind: "survey", payload: { question: "other", answer: "no" } }))).status).toBe(400)
    await event(post({ participantId: P, kind: 'breakout', payload: { useCase: 'project', note: 'Model it' } }))
    expect((await event(post({ participantId: P, kind: 'discussion', payload: {} }))).status).toBe(400)
    expect((await event(post({ participantId: P, kind: 'hack', payload: {} }))).status).toBe(400)
    expect((await event(post({ participantId: P, kind: 'stage_view', payload: { stage: 'nope' } }))).status).toBe(400)

    expect((await pledge(post({ email: 'nope', accurateAi: true }))).status).toBe(400)
    expect((await pledge(post({ email: 'a@b.org' }))).status).toBe(400)
    expect(
      (await pledge(post({ participantId: P, name: 'Pat', state: 'Arizona', email: 'Pat@State.gov', accurateAi: true }))).status,
    ).toBe(200)

    const room = await (await results(new Request('https://axiom.org/api/aspen/results'))).json()
    expect(room.runId).toBe('phoenix')
    expect(room.summary).toMatchObject({ participants: 1, prompts: 1, rated: 1, checked: 1 })
    expect(room.summary.feed[0]).toMatchObject({ household: 'Disabled, with savings', verdict: 'wrong', rulesAmount: 24, postCheck: 'wrong' })
    expect(room.summary.discussion.notes).toEqual([{ question: 'misunderstood', text: 'BBCE' }])
    expect(room.summary.pledges).toEqual({ people: 1, states: ['Arizona'], accurateAi: 1, stateSystems: 0 })
    expect(room.summary.twists[0]).toMatchObject({ id: "gig", count: 1 })
    expect(room.summary.voices).toContainEqual({ text: "Staff use it already", verdict: null })
    expect(room.summary.sourceOfTruth.find((c: { id: string }) => c.id === "no").count).toBe(1)
    expect(room.summary.viability).toMatchObject({ wouldNotApply: 1, wouldNotApplyEligible: 1 })
    const performance = room.summary.discussion.scales.find((sc: { question: string }) => sc.question === "performance")
    expect(performance.categories.find((c: { id: string }) => c.id === "amount")).toMatchObject({ average: 2, count: 1 })
    expect(performance.categories.find((c: { id: string }) => c.id === "clarity")).toMatchObject({ average: null, count: 0 })
    expect(JSON.stringify(room)).not.toContain('State.gov')
    expect(JSON.stringify(room)).not.toContain('Pat')

    const other = await (await results(new Request('https://axiom.org/api/aspen/results?run=rehearsal'))).json()
    expect(other.summary.prompts).toBe(0)
  })

  it('rejects bad questions and records failed answers', async () => {
    await signIn(post({ password: 'room' }))
    expect((await ask(post({ participantId: P, conversationId: C, turn: 0, messages: [] }))).status).toBe(400)
    expect(
      (await ask(post({ participantId: P, conversationId: C, turn: 99, messages: [{ role: 'user', content: 'x' }] }))).status,
    ).toBe(400)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'down' }, { status: 500 })))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const lines = await readLines(
      await ask(post({ participantId: P, conversationId: C, turn: 0, messages: [{ role: 'user', content: 'x' }] })),
    )
    expect(lines.map((l) => l.type)).toEqual(['meta', 'error'])
    const failed = await rules(post({ participantId: P, promptId: C, messages: [{ role: 'user', content: 'x' }] }))
    expect(failed.status).toBe(502)
  })

  it('works without any store', async () => {
    vi.stubEnv('ASPEN_STORE', '')
    vi.stubEnv('AXIOM_OPS_SUPABASE_SERVICE_KEY', '')
    await signIn(post({ password: 'stage' }))
    expect(await (await getState()).json()).toMatchObject({ live: false })
    expect((await setState(post({ stage: 'try' }))).status).toBe(503)
    expect(await (await event(post({ participantId: P, kind: 'chip', payload: {} }))).json()).toEqual({ ok: true, saved: false })
    expect(await (await rate(post({ participantId: P, promptId: C, verdict: 'right' }))).json()).toEqual({ ok: true, saved: false })
    expect((await pledge(post({ email: 'a@b.org', stateSystems: true }))).status).toBe(502)
    expect(await (await results(new Request('https://axiom.org/api/aspen/results'))).json()).toMatchObject({ live: false })
  })
})

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
import { _resetControlCache, _resetMemoryStore, getStore } from '@/lib/aspen/store'
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
      outputs: [
        { name: 'snap_benefit', label: 'Snap benefit', value: 24, unit: 'USD', semantics: 'scalar', published_output: true, legal_id: 'us:x#snap_benefit' },
        { name: 'snap_eligible', label: 'Snap eligible', value: 'holds', unit: null, semantics: 'judgment', published_output: true },
        {
          name: 'snap_maximum_allotment',
          value: 298,
          unit: 'USD',
          published_output: false,
          legal_id: 'us:policies/usda/snap/fy-2026-cola/maximum-allotments#snap_maximum_allotment',
        },
      ],
      applied: {
        disclosures: [
          "Axiom's Arizona SNAP encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".",
          'SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet.',
        ],
      },
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
    // A move made in a run the room has since left changes nothing; one made in the room's run goes.
    expect(await (await setState(post({ stage: 'reveal', inRun: 'rehearsal' }))).json()).toMatchObject({ runId: 'phoenix', stage: 'try' })
    expect(await (await setState(post({ stage: 'reveal', inRun: 'phoenix' }))).json()).toMatchObject({ runId: 'phoenix', stage: 'reveal' })
    expect(await (await setState(post({ stage: 'try', inRun: 'phoenix' }))).json()).toMatchObject({ runId: 'phoenix', stage: 'try' })

    // Nobody is asked who they are any more: the profile event is gone.
    expect((await event(post({ participantId: P, kind: 'profile', payload: { state: 'Arizona' } }))).status).toBe(400)
    // The fifth choice, added on the day, is accepted like the other four; a changed vote replaces it.
    expect((await event(post({ participantId: P, kind: 'vote', stage: 'vote', payload: { useCase: 'test' } }))).status).toBe(200)
    await event(post({ participantId: P, kind: 'vote', stage: 'vote', payload: { useCase: 'project' } }))
    expect((await event(post({ participantId: P, kind: 'vote', payload: { useCase: 'bogus' } }))).status).toBe(400)

    const asked = await ask(
      post({
        participantId: P,
        conversationId: C,
        turn: 0,
        messages: [{ role: 'user', content: 'Can I get SNAP?' }],
        meta: { stage: 'try', perspective: 'resident', householdId: 'ct-couple', questionIds: ['eligible', 'bogus', 'amount'], twists: ['gig', 'bogus'], promptTemplate: 'Can I get SNAP?' },
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
    expect(checked.computations[0]).toMatchObject({ program: 'us-az-snap', standardsYears: [2026] })
    expect(checked.computations[0].disclosures).toHaveLength(2)
    await rate(post({ participantId: P, promptId, postCheck: 'wrong' }))

    await event(post({ participantId: P, kind: 'discussion', payload: { question: 'misunderstood', topics: ['Asset tests'], note: 'BBCE' } }))
    await event(post({ participantId: P, kind: "discussion", payload: { question: "performance", ratings: { amount: 2, clarity: 9, bogus: 3 } } }))
    await event(post({ participantId: P, kind: "chip", payload: { householdId: "ct-couple", questionIds: ["cliff", "x"], twists: ["gig", "nope"] } }))
    await event(post({ participantId: P, kind: "discussion", stage: "rate", payload: { question: null, note: "Staff use it already" } }))
    await event(post({ participantId: P, kind: "survey", stage: "rate", payload: { question: "source-of-truth", answer: "no" } }))
    expect((await event(post({ participantId: P, kind: "survey", payload: { question: "source-of-truth", answer: "maybe" } }))).status).toBe(400)
    expect((await event(post({ participantId: P, kind: "survey", payload: { question: "other", answer: "no" } }))).status).toBe(400)
    await event(post({ participantId: P, kind: 'breakout', payload: { useCase: 'project', note: 'Model it', who: ' Policy staff ', trust: 'Matches the manual', raised: '  Training time  ' } }))
    expect((await event(post({ participantId: P, kind: 'breakout', payload: { useCase: 'bogus', note: ' ', raised: '' } }))).status).toBe(400)
    expect((await event(post({ participantId: P, kind: 'discussion', payload: {} }))).status).toBe(400)
    expect((await event(post({ participantId: P, kind: 'discussion', payload: { question: 'nope', note: '' } }))).status).toBe(400)
    // An empty answer to a known question is someone taking back their comment: it saves.
    const cleared = await event(post({ participantId: P, kind: 'discussion', payload: { question: 'experience', ratings: {}, topics: [], note: '' } }))
    expect(await cleared.json()).toEqual({ ok: true, saved: true })
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
    expect(room.summary.feed[0]).toMatchObject({
      household: 'Couple, with savings',
      verdict: 'wrong',
      rulesAmount: 24,
      rulesIfEligible: true,
      postCheck: 'wrong',
    })
    expect(room.summary.discussion.notes).toContainEqual({ question: 'misunderstood', text: 'BBCE' })
    // Pledges give counts only: no states, names or emails reach the results.
    expect(room.summary.pledges).toEqual({ people: 1, accurateAi: 1, stateSystems: 0 })
    expect(room.summary.twists[0]).toMatchObject({ id: "gig", count: 1 })
    expect(room.summary.voices).toContainEqual({ text: "Staff use it already", verdict: null })
    expect(room.summary.sourceOfTruth.find((c: { id: string }) => c.id === "no").count).toBe(1)
    // Arizona's rules don't test eligibility, so the $24 is an amount if eligible, not a household that qualifies.
    expect(room.summary.viability).toMatchObject({ wouldNotApply: 1, wouldNotApplyEligible: 0, wouldNotApplyIfEligible: 1 })
    expect(room.summary.votes.find((c: { id: string }) => c.id === 'project').count).toBe(1)
    expect(room.summary.votes.find((c: { id: string }) => c.id === 'test').count).toBe(0)
    expect(room.summary.breakouts.notes).toContainEqual({
      useCase: 'project',
      text: 'Model it',
      who: 'Policy staff',
      trust: 'Matches the manual',
      raised: 'Training time',
    })
    const performance = room.summary.discussion.scales.find((sc: { question: string }) => sc.question === "performance")
    expect(performance.categories.find((c: { id: string }) => c.id === "amount")).toMatchObject({ average: 2, count: 1 })
    expect(performance.categories.find((c: { id: string }) => c.id === "clarity")).toMatchObject({ average: null, count: 0 })
    expect(JSON.stringify(room)).not.toContain('State.gov')
    expect(JSON.stringify(room)).not.toContain('Pat')

    const other = await (await results(new Request('https://axiom.org/api/aspen/results?run=rehearsal'))).json()
    expect(other.summary.prompts).toBe(0)
  })

  it('keeps agency comments off participants\' results until the presenter reads them', async () => {
    await signIn(post({ password: 'room' }))
    await event(post({ participantId: P, kind: 'discussion', payload: { question: 'experience', note: 'Our chatbot misread the asset test' } }))
    await event(post({ participantId: P, kind: 'discussion', payload: { question: 'misunderstood', topics: ['Asset tests'], note: 'BBCE' } }))

    const phone = await (await results(new Request('https://axiom.org/api/aspen/results'))).json()
    expect(phone.summary.discussion.notes).toEqual([{ question: 'misunderstood', text: 'BBCE' }])
    expect(JSON.stringify(phone)).not.toContain('chatbot misread')
    // The question still counts; only the comment text is held back.
    expect(phone.summary.discussion.questions.find((c: { id: string }) => c.id === 'experience').count).toBe(1)

    await signIn(post({ password: 'stage' }))
    const presenter = await (await results(new Request('https://axiom.org/api/aspen/results'))).json()
    expect(presenter.summary.discussion.notes).toContainEqual({ question: 'experience', text: 'Our chatbot misread the asset test' })
  })

  it('orders saves by their stamps, so a slow earlier save never replaces a later one', async () => {
    await signIn(post({ password: 'stage' }))
    const asked = await readLines(
      await ask(post({ participantId: P, conversationId: C, turn: 0, messages: [{ role: 'user', content: 'Can I get SNAP?' }] })),
    )
    const promptId = String(asked[0].promptId)
    const rateAt = async (rev: unknown, verdict: string) => (await rate(post({ participantId: P, promptId, verdict, rev }))).json()
    const room = async () => (await (await results(new Request('https://axiom.org/api/aspen/results'))).json()).summary

    expect(await rateAt(1_792_000_002_000, 'wrong')).toEqual({ ok: true, saved: true })
    // The tap before it, landing after: not saved, and the later rating stands.
    expect(await rateAt(1_792_000_001_000, 'right')).toEqual({ ok: true, saved: false })
    expect((await room()).feed[0].verdict).toBe('wrong')
    expect(await rateAt(1_792_000_003_000, 'unsure')).toEqual({ ok: true, saved: true })
    expect((await room()).feed[0].verdict).toBe('unsure')
    // A page that sends no stamp, or a bad one, saves as it always did, on arrival, at the server's time.
    expect(await rateAt(undefined, 'right')).toEqual({ ok: true, saved: true })
    const arrived = Date.now()
    expect(await rateAt('soon', 'wrong')).toEqual({ ok: true, saved: true })
    expect((await room()).feed[0].verdict).toBe('wrong')
    // A stamped tap from before that time doesn't replace it; the phone says so, and a tap after it saves.
    expect(await rateAt(arrived - 60_000, 'right')).toEqual({ ok: true, saved: false })
    expect(await rateAt(Date.now() + 1_000, 'unsure')).toEqual({ ok: true, saved: true })
    expect((await room()).feed[0].verdict).toBe('unsure')
    // Two tabs that stamped alike: the first to arrive stands, and the other's retry, stamped above it, saves.
    const tie = Date.now() + 2_000
    expect(await rateAt(tie, 'wrong')).toEqual({ ok: true, saved: true })
    expect(await rateAt(tie, 'right')).toEqual({ ok: true, saved: false })
    expect(await rateAt(tie + 1, 'right')).toEqual({ ok: true, saved: true })
    expect((await room()).feed[0].verdict).toBe('right')

    // The same for answers that save as events: the later stamp counts, whichever landed last.
    const comment = (note: unknown, rev: number, ratings: unknown = { residents: 2 }) =>
      event(post({ participantId: P, kind: 'discussion', payload: { question: 'experience', ratings, topics: [], note, rev } }))
    expect(await (await comment('Later comment', 1_792_000_002_000)).json()).toEqual({ ok: true, saved: true })
    expect(await (await comment('Earlier comment', 1_792_000_001_000)).json()).toEqual({ ok: true, saved: true })
    expect((await room()).discussion.notes).toContainEqual({ question: 'experience', text: 'Later comment' })
    expect(JSON.stringify(await room())).not.toContain('Earlier comment')

    // A malformed answer never clears it: a known question with nothing that survives cleaning is refused.
    expect((await comment(123, 1_792_000_003_000, { residents: 99 })).status).toBe(400)
    expect((await comment('', 1_792_000_003_000, { residents: 99 })).status).toBe(400)
    expect((await room()).discussion.notes).toContainEqual({ question: 'experience', text: 'Later comment' })
    // An explicit empty answer takes it back.
    expect(await (await comment('', 1_792_000_004_000, {})).json()).toEqual({ ok: true, saved: true })
    expect(JSON.stringify(await room())).not.toContain('Later comment')

    // A page too old to stamp counts by when its answer arrived, so its later answer counts over earlier taps,
    // and a tap stamped after that arrival counts over it.
    const unstamped = await event(post({ participantId: P, kind: 'discussion', payload: { question: 'experience', ratings: { residents: 3 }, topics: [], note: 'Old page comment' } }))
    expect(await unstamped.json()).toEqual({ ok: true, saved: true })
    expect((await room()).discussion.notes).toContainEqual({ question: 'experience', text: 'Old page comment' })
    expect(await (await comment('Newest comment', Date.now() + 1_000)).json()).toEqual({ ok: true, saved: true })
    expect((await room()).discussion.notes).toContainEqual({ question: 'experience', text: 'Newest comment' })
    expect(JSON.stringify(await room())).not.toContain('Old page comment')
  })

  it("counts a question asked again once, and a rating on a retry whose answer didn't save never takes it off the count", async () => {
    await signIn(post({ password: 'stage' }))
    const question = { participantId: P, conversationId: C, turn: 0, messages: [{ role: 'user', content: 'Can I get SNAP?' }] }
    const room = async () => (await (await results(new Request('https://axiom.org/api/aspen/results'))).json()).summary
    // The first attempt was cut off on the phone, but finished on the server.
    expect((await readLines(await ask(post(question)))).map((l) => l.type)).toEqual(['meta', 'delta', 'done'])
    // "Ask again": the answer reaches the phone, but saving it fails.
    const store = getStore()!
    vi.spyOn(store, 'updatePrompt').mockImplementationOnce(async () => {
      throw new Error('store down')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const again = await readLines(await ask(post(question)))
    expect(again.map((l) => l.type)).toEqual(['meta', 'delta', 'done'])
    expect(await room()).toMatchObject({ prompts: 1, rated: 0 })
    // The phone rates the retry it shows.
    const rated = await rate(post({ participantId: P, promptId: String(again[0].promptId), verdict: 'wrong', residentAction: 'apply', rev: Date.now() }))
    expect(await rated.json()).toEqual({ ok: true, saved: true })
    const after = await room()
    expect(after).toMatchObject({ prompts: 1, rated: 1 })
    expect(after.households.find((h: { id: string }) => h.id === 'own')?.count).toBe(1)
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

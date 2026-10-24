import fc from 'fast-check'
import {
  EXAMPLE_HOUSEHOLD,
  RATING_SCALES,
  TWISTS,
  TWIST_GROUPS,
  TWIST_IDS,
  WHAT_MODELS_MISS,
  twistsFor,
  HOUSEHOLDS,
  PERSPECTIVE_IDS,
  POLICYBENCH,
  STAGES,
  STAGE_IDS,
  composePrompt,
  findHousehold,
  orderedQuestions,
  questionsFrom,
  isPerspectiveId,
  isStageId,
  isUsState,
  percent,
  stageIndex,
  MINIMUM_BENEFIT,
  TOOL_PILOT,
  share,
  toolPilotMisses,
  LIVE_DEMO,
  liveDemoUrl,
  FREE_PLAN_PILOT,
  freePlanProblems,
  distinguishable,
  formatPoints,
  wholeShare,
  type FreePlanPilot,
} from './content'
import { federalFiscalYear } from './coverage'
import { MOCK_FREE_PLAN_PILOT } from '@/test/aspen-free-plan.mock'

describe('aspen content', () => {
  it('lists every stage once, in run-of-show order, without clock times', () => {
    expect(STAGES.map((s) => s.id)).toEqual([...STAGE_IDS])
    expect(STAGES.at(-1)?.label).toBe('Thank you')
    for (const stage of STAGES) {
      expect(stage).not.toHaveProperty('time')
      // The shared foundation's heading stands on its own.
      if (stage.id !== 'foundation') expect(stage.summary.length).toBeGreaterThan(20)
    }
  })

  it('finds stages, perspectives, states and households', () => {
    expect(stageIndex('try')).toBe(1)
    expect(stageIndex('nope')).toBe(-1)
    expect(stageIndex(null)).toBe(-1)
    expect(isStageId('foundation')).toBe(true)
    expect(isStageId(3)).toBe(false)
    expect(PERSPECTIVE_IDS).toEqual(['resident', 'caseworker'])
    expect(isPerspectiveId('caseworker')).toBe(true)
    expect(isPerspectiveId('leader')).toBe(false)
    expect(isUsState('Arizona')).toBe(true)
    expect(isUsState('Atlantis')).toBe(false)
    expect(findHousehold('ct-couple')?.state).toBe('Connecticut')
    expect(findHousehold('own')).toBeUndefined()
    expect(findHousehold(null)).toBeUndefined()
  })

  it('composes a resident question in the first person', () => {
    const retiree = findHousehold('az-retiree')!
    expect(composePrompt('resident', retiree, 'amount')).toBe(
      `${retiree.firstPerson} How much SNAP (food stamps) can I get each month?`,
    )
    expect(composePrompt('resident', retiree, 'eligible')).toMatch(/Do I qualify for SNAP/)
    expect(composePrompt('resident', retiree, 'more')).toMatch(/What benefits can I get/)
  })

  it('speaks as "we" for plural households and asks yearly about tax credits', () => {
    const couple = findHousehold('ga-ctc')!
    expect(composePrompt('resident', couple, 'amount')).toMatch(
      /How much will we get from the Child Tax Credit for 2026\?$/,
    )
    expect(composePrompt('resident', couple, 'eligible')).toMatch(/Do we qualify/)
    expect(composePrompt('caseworker', couple, 'amount')).toMatch(/should they get for 2026\?$/)
  })

  it('composes a caseworker question about a client', () => {
    const parent = findHousehold('md-tca')!
    const text = composePrompt('caseworker', parent, 'amount')
    expect(text.startsWith("I'm a caseworker in Maryland. My client is a single parent")).toBe(true)
    expect(text).toMatch(/How much cash assistance \(TCA\) should they get each month\?$/)
    expect(composePrompt('caseworker', parent, 'eligible')).toMatch(/Does this household qualify/)
    expect(composePrompt('caseworker', parent, 'more')).toMatch(/What benefits should I screen them for/)
  })

  it('asks several questions one after another, in display order', () => {
    const retiree = findHousehold('az-retiree')!
    const both = composePrompt('resident', retiree, ['eligible', 'amount'])
    expect(both).toMatch(/How much SNAP \(food stamps\) can I get each month\? Do I qualify for SNAP \(food stamps\)\?$/)
    // A single id still works, and a duplicate asks once.
    expect(composePrompt('resident', retiree, ['amount', 'amount'])).toBe(composePrompt('resident', retiree, 'amount'))
    expect(composePrompt('caseworker', retiree, ['apply', 'more'])).toMatch(
      /What benefits should I screen them for, and how much would each one be\? How should they apply/,
    )
  })

  it('orders questions and reads them from a request, old or new', () => {
    expect(orderedQuestions(['apply', 'amount', 'apply'])).toEqual(['amount', 'apply'])
    expect(orderedQuestions('cliff')).toEqual(['cliff'])
    expect(questionsFrom(['eligible', 'bogus', 'amount', 7])).toEqual(['amount', 'eligible'])
    // Older pages sent one id.
    expect(questionsFrom(undefined, 'more')).toEqual(['more'])
    expect(questionsFrom(undefined, 'bogus')).toEqual([])
    expect(questionsFrom(undefined, null)).toEqual([])
    expect(questionsFrom('amount')).toEqual([])
  })

  it('puts every detail in one of the two detail rows', () => {
    const groups = TWIST_GROUPS.map((g) => g.id) as string[]
    for (const t of TWISTS) expect(groups).toContain(t.group)
    for (const g of TWIST_GROUPS) expect(TWISTS.some((t) => t.group === g.id)).toBe(true)
  })

  it('every household names a program and why it is on the list', () => {
    for (const h of HOUSEHOLDS) {
      expect(h.program).toBeTruthy()
      expect(h.why).toBeTruthy()
      expect(h.firstPerson).toMatch(h.state)
    }
  })

  it('asks about the cliff and how to apply', () => {
    const parent = findHousehold('ny-parent')!
    const couple = findHousehold('ga-ctc')!
    expect(composePrompt('resident', parent, 'cliff')).toMatch(/If I earn \$200 more a month, how much SNAP \(food stamps\) would I lose\?$/)
    expect(composePrompt('caseworker', parent, 'cliff')).toMatch(/If they earn \$200 more a month, how much SNAP \(food stamps\) would they lose\?$/)
    expect(composePrompt('resident', couple, 'cliff')).toMatch(/If we earn \$10,000 more next year, how does the Child Tax Credit change\?$/)
    expect(composePrompt('caseworker', couple, 'cliff')).toMatch(/If they earn \$10,000 more next year/)
    expect(composePrompt('resident', parent, 'apply')).toMatch(/How do I apply for SNAP \(food stamps\), and what documents do I need\?$/)
    expect(composePrompt('caseworker', parent, 'apply')).toMatch(/How should they apply for SNAP \(food stamps\), and what documents will they need\?$/)
  })

  it('adds details in the voice of the speaker, in display order', () => {
    const retiree = findHousehold('az-retiree')!
    const couple = findHousehold('ga-ctc')!
    expect(composePrompt('resident', retiree, 'amount', ['medical', 'gig'])).toBe(
      `${retiree.firstPerson} ${TWISTS[0].i} ${TWISTS.find((t) => t.id === 'medical')!.i} How much SNAP (food stamps) can I get each month?`,
    )
    expect(composePrompt('resident', couple, 'eligible', ['gig'])).toContain('We also make about $400 a month')
    expect(composePrompt('caseworker', retiree, 'amount', ['gig'])).toContain('in rent. They also make about $400 a month')
    // A detail that does not fit the household is ignored.
    expect(composePrompt('resident', retiree, 'amount', ['student'])).toBe(composePrompt('resident', retiree, 'amount'))
  })

  it('offers only the details that fit a household', () => {
    expect(TWIST_IDS).toHaveLength(TWISTS.length)
    expect(twistsFor(undefined)).toEqual([])
    expect(twistsFor(findHousehold('az-retiree')).map((t) => t.id)).not.toContain('student')
    expect(twistsFor(findHousehold('ct-couple')).map((t) => t.id)).not.toContain('savings')
    expect(twistsFor(findHousehold('ny-parent')).map((t) => t.id)).not.toContain('utilities')
    expect(twistsFor(findHousehold('md-tca')).map((t) => t.id)).toEqual(TWIST_IDS)
  })

  it('rates two discussion questions on scales', () => {
    expect(Object.keys(RATING_SCALES)).toEqual(['performance', 'experience'])
    expect(RATING_SCALES.performance?.categories).toHaveLength(5)
  })

  it('keeps the PolicyBench figures consistent', () => {
    expect(percent(POLICYBENCH.saidZero, POLICYBENCH.eligibleAnswers)).toBe(42)
    expect(percent(POLICYBENCH.saidZeroBbce, POLICYBENCH.saidZero)).toBe(74)
    expect(percent(1, 0)).toBe(0)
  })

  it('labels the example amount with the standards year it comes from', () => {
    const ex = POLICYBENCH.example
    // The sourced figures (content.ts comments): PolicyBench's FY2026 reference, and
    // USDA's FY2027 minimum for households of one or two in the 48 states and DC.
    expect(ex.reference).toEqual({ monthly: 24, annual: 288, standards: 'FY2026' })
    expect(ex.fromOctober).toEqual({ monthly: 25, standards: 'FY2027', effective: 'October 1, 2026' })
    // October 2026 is the first month of FY2027.
    expect(federalFiscalYear('2026-10')).toBe(2027)
    expect(federalFiscalYear('2026-09')).toBe(2026)
    const why = findHousehold('ct-couple')!.why
    expect(why).toContain('$24 a month under FY2026 standards')
    expect(why).toContain("PolicyBench's reference")
    expect(why).toContain('$25 from October 1, 2026')
    // The rules check is gone from the chat, so no copy promises one.
    expect(why).not.toContain('rules check')
    // Twelve months at the benchmark's FY2026 minimum, on both At scale slides.
    expect(ex.reference.annual).toBe(12 * ex.reference.monthly)
    expect(EXAMPLE_HOUSEHOLD.reference).toBe(ex.reference.annual)
    expect(WHAT_MODELS_MISS.amount).toBe(ex.reference.annual)
    expect(ex.modelsAsked).toBe(POLICYBENCH.models)
  })

  it("keeps USDA's minimum benefit in one place, matching the example's reference", () => {
    expect(MINIMUM_BENEFIT).toEqual({ fy2026: 24, fy2027: 25, effective: 'October 1, 2026' })
    expect(POLICYBENCH.example.reference.monthly).toBe(MINIMUM_BENEFIT.fy2026)
    expect(POLICYBENCH.example.fromOctober.monthly).toBe(MINIMUM_BENEFIT.fy2027)
    // PolicyBench's $288 is twelve months at FY2026's minimum; current law is nine at $24, then three at $25.
    expect(POLICYBENCH.example.reference.annual).toBe(12 * MINIMUM_BENEFIT.fy2026)
    expect(POLICYBENCH.example.currentLaw.annual).toBe(9 * MINIMUM_BENEFIT.fy2026 + 3 * MINIMUM_BENEFIT.fy2027)
  })

  it("keeps the example's tiles in step with its counts (PolicyBench scenario_027)", () => {
    const ex = POLICYBENCH.example
    const answers = EXAMPLE_HOUSEHOLD.answers
    expect(answers).toHaveLength(ex.modelsAsked)
    expect(answers.filter((a) => a !== null)).toHaveLength(ex.modelsAnswered)
    expect(answers.filter((a) => a === 0)).toHaveLength(ex.modelsSaidZero)
    expect(answers.filter((a) => a === EXAMPLE_HOUSEHOLD.reference)).toHaveLength(ex.modelsExact)
    // The tiles read $0 first, then other amounts, the right answer, and the one that didn't parse.
    expect(answers.at(-1)).toBeNull()
    expect(answers.at(-2)).toBe(EXAMPLE_HOUSEHOLD.reference)
    expect(findHousehold('ct-couple')?.plural).toBe(true)
    expect(findHousehold('ct-couple')?.firstPerson).not.toContain('disability. My')
  })

  it("gives every tool-pilot model a count for every arm, as the October 20 note's data gives them", () => {
    for (const row of TOOL_PILOT.rows) {
      for (const arm of TOOL_PILOT.arms) {
        const hits = row.hits[arm.id]
        expect(Number.isInteger(hits)).toBe(true)
        expect(hits).toBeGreaterThanOrEqual(0)
        expect(hits).toBeLessThanOrEqual(TOOL_PILOT.amounts)
      }
    }
    // Recomputed Oct 23 with the note's own functions: hits of 187 amounts, and the shares the slide prints.
    expect(TOOL_PILOT.amounts).toBe(187)
    expect(TOOL_PILOT.rows.map((r) => [r.model, r.hits.alone, r.hits.tool])).toEqual([
      ['GPT-6 Sol', 126, 181],
      ['Claude Opus 5.5', 131, 185],
      ['Gemini 4 Argon', 87, 186],
    ])
    expect(TOOL_PILOT.rows.map((r) => [share(r.hits.alone!, 187), share(r.hits.tool!, 187)])).toEqual([
      [67.4, 96.8],
      [70.1, 98.9],
      [46.5, 99.5],
    ])
    // The miss count comes from the same rows as the bars: 6 + 2 + 1 of 3 × 187.
    expect(toolPilotMisses(TOOL_PILOT)).toEqual({ misses: 9, scored: 561 })
    // The note line's numbers add up: 171 taxes and tax credits and 16 benefits make 187.
    const b = TOOL_PILOT.benefits!
    expect(TOOL_PILOT.note).toContain('187 per model across 100 US households, 171 of them taxes and tax credits and 16 benefits')
    expect(171 + b.amounts).toBe(TOOL_PILOT.amounts)
    expect(b.title).toBe('The 16 benefit amounts: 13 SNAP, 2 SSI, 1 TANF')
    expect(13 + 2 + 1).toBe(b.amounts)
    // Same models, same order; the tool never does worse, and never more than every amount.
    expect(b.rows.map((r) => r.model)).toEqual(TOOL_PILOT.rows.map((r) => r.model))
    expect(b.rows.map((r) => [r.alone, r.tool])).toEqual([
      [6, 16],
      [7, 16],
      [0, 16],
    ])
    for (const r of b.rows) expect(r.alone).toBeLessThanOrEqual(r.tool)
    // The headline ("above 99%") is a different, weighted score; the slide doesn't quote it.
    expect(TOOL_PILOT.source).not.toMatch(/99%/)
    // The note's own caveat travels with the numbers.
    expect(TOOL_PILOT.measures).toMatch(/not whether the engine is right/)
  })

  it('turns a count into a one-decimal share that never leaves 0 to 100 and grows with the count', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: 5000 }), (of, k) => {
        const hits = k % (of + 1)
        const value = share(hits, of)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(100)
        expect(Math.round(value * 10) / 10).toBe(value)
        expect(Math.abs(value - (100 * hits) / of)).toBeLessThanOrEqual(0.05 + 1e-9)
        if (hits < of) expect(share(hits + 1, of)).toBeGreaterThanOrEqual(value)
      }),
    )
    expect(share(0, 187)).toBe(0)
    expect(share(187, 187)).toBe(100)
  })

  it('opens the live demo in compare mode with its question intact', () => {
    const url = new URL(liveDemoUrl())
    expect(url.origin + url.pathname).toBe(LIVE_DEMO.base)
    expect(url.searchParams.get('compare')).toBe('1')
    // Round trip: the frame asks exactly the question the run-of-show scripts.
    expect(url.searchParams.get('q')).toBe(LIVE_DEMO.question)
    // The frame never sends on its own; the presenter presses Send.
    expect(url.searchParams.has('go')).toBe(false)
  })
})

describe('the free-plan pilot', () => {
  it('passes every check, if it is set', () => {
    if (FREE_PLAN_PILOT) expect(freePlanProblems(FREE_PLAN_PILOT)).toEqual([])
    // Until it's cleared to show, the slide is off and no numbers are in this public repo.
    else expect(FREE_PLAN_PILOT).toBeNull()
  })

  it('checks the mock the same way, and catches what would put a wrong number on the screen', () => {
    expect(freePlanProblems(MOCK_FREE_PLAN_PILOT)).toEqual([])
    const m = MOCK_FREE_PLAN_PILOT
    const withRow = (i: number, row: Partial<FreePlanPilot['rows'][number]>): FreePlanPilot => ({
      ...m,
      rows: m.rows.map((r, j) => (j === i ? { ...r, ...row } : r)),
    })
    expect(freePlanProblems({ ...m, label: ' ' })).toEqual(['no label: the room has to read these as preliminary'])
    expect(freePlanProblems({ ...m, arms: m.arms.filter((a) => a.id !== 'alone') })).toContain(
      'the change needs both no tools and the tool',
    )
    expect(freePlanProblems({ ...m, arms: [...m.arms, m.arms[0]] })).toContain('an arm is listed twice')
    expect(freePlanProblems({ ...m, rows: [m.rows[3], ...m.rows.slice(0, 3), ...m.rows.slice(4)] })).toContain(
      'a free-plan model comes after a comparison model',
    )
    expect(freePlanProblems({ ...m, rows: [...m.rows, m.rows[0]] })).toEqual(
      expect.arrayContaining(['a model is listed twice', '7 rows; the slide fits 1 to 6']),
    )
    expect(freePlanProblems(withRow(0, { counts: { ...m.rows[0].counts, web: undefined } }))).toEqual([
      'Mock model A: no count for web',
    ])
    expect(freePlanProblems(withRow(0, { counts: { ...m.rows[0].counts, web: { k: 49, n: 48 } } }))).toEqual([
      "Mock model A web: 49 of 48 isn't a count",
    ])
    expect(freePlanProblems(withRow(0, { counts: { ...m.rows[0].counts, both: { k: 41, n: 47 } } }))).toEqual([
      'Mock model A: settings score different numbers of amounts (48, 47)',
    ])
    expect(freePlanProblems(withRow(1, { toolVsAlone: { points: 50, lo: 9, hi: 44 } }))).toEqual([
      'Mock model B: 50 is outside its interval 9 to 44',
      'Mock model B: change 50 but the counts give 27.1',
    ])
    // The counts give 27.08: the export's one decimal, 27.1, passes; 27.2 would show the same whole number but isn't the counts'.
    expect(freePlanProblems(withRow(1, { toolVsAlone: { points: 27.1, lo: 9, hi: 44 } }))).toEqual([])
    expect(freePlanProblems(withRow(1, { toolVsAlone: { points: 27.2, lo: 9, hi: 44 } }))).toEqual([
      'Mock model B: change 27.2 but the counts give 27.1',
    ])
    // The interval's ends are the export's one decimal: the exact change may sit just past one, but not a tenth past.
    const exact = (100 * 13) / 48
    expect(freePlanProblems(withRow(1, { toolVsAlone: { points: exact, lo: 27.1, hi: 27.1 } }))).toEqual([])
    expect(freePlanProblems(withRow(1, { toolVsAlone: { points: exact, lo: 27.2, hi: 30 } }))).toEqual([
      `Mock model B: ${exact} is outside its interval 27.2 to 30`,
    ])
    expect(freePlanProblems(withRow(1, { toolVsAlone: { points: exact, lo: 27.1, hi: 27 } }))).toEqual([
      'Mock model B: its interval 27.1 to 27 runs backward',
      `Mock model B: ${exact} is outside its interval 27.1 to 27`,
    ])
    // Ends finer than one decimal get no allowance, so no change shows as leaving out zero when it is zero.
    const noChange = { ...m.rows[1].counts, tool: m.rows[1].counts.alone }
    expect(freePlanProblems(withRow(1, { counts: noChange, toolVsAlone: { points: 0, lo: 0.04, hi: 1 } }))).toEqual([
      'Mock model B: 0 is outside its interval 0.04 to 1',
    ])
    expect(freePlanProblems(withRow(1, { counts: noChange, toolVsAlone: { points: 0, lo: 0.1, hi: 1 } }))).toEqual([
      'Mock model B: 0 is outside its interval 0.1 to 1',
    ])
    expect(freePlanProblems(withRow(1, { counts: noChange, toolVsAlone: { points: 0, lo: -Infinity, hi: Infinity } }))).toEqual([
      "Mock model B: change 0 with interval -Infinity to Infinity isn't finite",
    ])
    expect(freePlanProblems(withRow(1, { counts: noChange, toolVsAlone: { points: 0, lo: -1e308, hi: 1 } }))).toEqual([
      'Mock model B: its interval -1e+308 to 1 goes past 100 points',
    ])
    const huge = { k: 1e308, n: 1e308 }
    expect(freePlanProblems(withRow(1, { counts: { alone: huge, web: huge, tool: huge, both: huge }, toolVsAlone: { points: 0, lo: 0, hi: 0 } }))).toEqual(
      ["alone", "web", "tool", "both"].map((id) => `Mock model B ${id}: 1e+308 of 1e+308 isn't a count`),
    )
  })

  it('passes only rows the slide can print: whole shares from 0 to 100, and finite changes and intervals', () => {
    const m = MOCK_FREE_PLAN_PILOT
    const size = fc.oneof(fc.integer({ min: 1, max: 2000 }), fc.constantFrom(2 ** 53 - 1, 2 ** 53, 1e308, Infinity, NaN))
    const share = fc.double({ min: 0, max: 1, noNaN: true })
    const odd = fc.option(fc.constantFrom(Infinity, -Infinity, NaN, 1e308, -1e308))
    fc.assert(
      fc.property(size, share, share, fc.double({ min: 0, max: 30, noNaN: true }), odd, odd, (n, fa, ft, gap, oddLo, oddHi) => {
        const [alone, tool] = [Math.floor(fa * n), Math.floor(ft * n)]
        const points = (100 * (tool - alone)) / n
        const toolVsAlone = { points, lo: oddLo ?? points - gap, hi: oddHi ?? points + gap }
        const c = (k: number) => ({ k, n })
        const row = { ...m.rows[1], counts: { alone: c(alone), web: c(alone), tool: c(tool), both: c(tool) }, toolVsAlone }
        if (freePlanProblems({ ...m, rows: m.rows.map((r, j) => (j === 1 ? row : r)) }).length) return
        for (const k of [alone, tool]) {
          const s = wholeShare({ k, n })
          expect(Number.isInteger(s) && s >= 0 && s <= 100).toBe(true)
        }
        for (const x of [points, toolVsAlone.lo, toolVsAlone.hi]) expect(formatPoints(x)).toMatch(/^(0|[+\u2212][0-9.e-]+)$/)
      }),
      { numRuns: 1000 },
    )
  })

  it('never passes a change the slide would show as leaving out zero unless the change itself is on that side of zero', () => {
    const m = MOCK_FREE_PLAN_PILOT
    const tenth = (x: number) => Math.round(x * 10) / 10
    const gap = fc.oneof(fc.double({ min: -0.2, max: 0.2, noNaN: true }), fc.double({ min: -0.2, max: 30, noNaN: true }))
    const counts = fc
      .integer({ min: 1, max: 2000 })
      .chain((n) => fc.tuple(fc.constant(n), fc.integer({ min: 0, max: n }), fc.integer({ min: -2, max: 2 }), fc.integer({ min: 0, max: n })))
    fc.assert(
      fc.property(counts, fc.boolean(), gap, gap, fc.boolean(), fc.boolean(), ([n, alone, step, far], near, below, above, roundLo, roundHi) => {
        // The tool's count is often within two of no tools', so the change is often 0 or nearly.
        const tool = near ? Math.min(n, Math.max(0, alone + step)) : far
        const points = (100 * (tool - alone)) / n
        const toolVsAlone = { points, lo: roundLo ? tenth(points - below) : points - below, hi: roundHi ? tenth(points + above) : points + above }
        const c = (k: number) => ({ k, n })
        const row = { ...m.rows[1], counts: { alone: c(alone), web: c(alone), tool: c(tool), both: c(tool) }, toolVsAlone }
        if (freePlanProblems({ ...m, rows: m.rows.map((r, j) => (j === 1 ? row : r)) }).length) return
        if (!distinguishable(toolVsAlone)) return
        expect(points).not.toBe(0)
        expect(Math.sign(points)).toBe(toolVsAlone.lo > 0 ? 1 : -1)
      }),
      { numRuns: 2000 },
    )
  })

  it('shows a count as a whole percent within 0 to 100 that never falls as the count grows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), fc.integer({ min: 0, max: 2000 }), (n, raw) => {
        const k = raw % (n + 1)
        const value = wholeShare({ k, n })
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(100)
        expect(Math.abs(value - (100 * k) / n)).toBeLessThanOrEqual(0.5)
        if (k < n) expect(wholeShare({ k: k + 1, n })).toBeGreaterThanOrEqual(value)
      }),
    )
  })

  it('writes points whole with their sign, "0" only for no change, and one significant digit where whole would read as 0', () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100, noNaN: true }), (x) => {
        const text = formatPoints(x)
        if (x === 0) {
          expect(text).toBe('0')
          return
        }
        expect(text.startsWith(x > 0 ? '+' : '\u2212')).toBe(true)
        const back = Number(text.replace('\u2212', '-'))
        if (Math.round(x) !== 0) expect(back).toBe(Math.round(x))
        else {
          // One significant digit: never zero, and off by at most half the value.
          expect(back).not.toBe(0)
          expect(Math.abs(back - x)).toBeLessThanOrEqual(Math.abs(x) / 2)
        }
      }),
    )
    expect(formatPoints(5e-324)).toBe('+5e-324')
    expect(formatPoints(0.099)).toBe('+0.1')
    expect(formatPoints(7.8)).toBe('+8')
    expect(formatPoints(-0.4)).toBe('\u22120.4')
    expect(formatPoints(0.1)).toBe('+0.1')
    expect(formatPoints(0.04)).toBe('+0.04')
    expect(formatPoints(-0.5)).toBe('\u22120.5')
    expect(formatPoints(0)).toBe('0')
  })

  it('calls a change distinguishable exactly when its interval leaves out zero', () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), (lo, width) => {
        const hi = lo + width
        expect(distinguishable({ points: (lo + hi) / 2, lo, hi })).toBe(!(lo <= 0 && 0 <= hi))
      }),
    )
  })
})

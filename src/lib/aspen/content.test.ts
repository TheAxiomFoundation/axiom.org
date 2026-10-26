import fc from 'fast-check'
import {
  EXAMPLE_HOUSEHOLD,
  RATING_SCALES,
  TWISTS,
  TWIST_GROUPS,
  TWIST_IDS,
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
} from './content'
import { federalFiscalYear } from './coverage'

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
    // Twelve months at the benchmark's FY2026 minimum.
    expect(ex.reference.annual).toBe(12 * ex.reference.monthly)
    expect(EXAMPLE_HOUSEHOLD.reference).toBe(ex.reference.annual)
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

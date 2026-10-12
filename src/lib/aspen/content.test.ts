import {
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
} from './content'
import { federalFiscalYear } from './coverage'

describe('aspen content', () => {
  it('lists every stage once, in run-of-show order, without clock times', () => {
    expect(STAGES.map((s) => s.id)).toEqual([...STAGE_IDS])
    expect(STAGES.at(-1)?.label).toBe('Thank you')
    for (const stage of STAGES) {
      expect(stage).not.toHaveProperty('time')
      expect(stage.summary.length).toBeGreaterThan(20)
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
    expect(findHousehold('az-savings')?.state).toBe('Arizona')
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
    expect(twistsFor(findHousehold('az-savings')).map((t) => t.id)).not.toContain('savings')
    expect(twistsFor(findHousehold('ny-parent')).map((t) => t.id)).not.toContain('utilities')
    expect(twistsFor(findHousehold('md-tca')).map((t) => t.id)).toEqual(TWIST_IDS)
  })

  it('rates two discussion questions on scales', () => {
    expect(Object.keys(RATING_SCALES)).toEqual(['performance', 'experience'])
    expect(RATING_SCALES.performance?.categories).toHaveLength(5)
  })

  it('keeps the PolicyBench figures consistent', () => {
    expect(percent(POLICYBENCH.saidZero, POLICYBENCH.eligibleAnswers)).toBe(41)
    expect(percent(POLICYBENCH.saidZeroBbce, POLICYBENCH.saidZero)).toBe(78)
    expect(percent(1, 0)).toBe(0)
  })

  it('labels the Arizona amount with the standards year it comes from', () => {
    const { reference, fromOctober, answer } = POLICYBENCH.azCase
    // The sourced figures (content.ts comments): PolicyBench's FY2026 reference, and
    // USDA's FY2027 minimum for households of one or two in the 48 states and DC.
    expect(reference).toEqual({ monthly: 24, standards: 'FY2026' })
    expect(fromOctober).toEqual({ monthly: 25, standards: 'FY2027', effective: 'October 1, 2026' })
    // October 2026 is the first month of FY2027.
    expect(federalFiscalYear('2026-10')).toBe(2027)
    expect(federalFiscalYear('2026-09')).toBe(2026)
    for (const text of [answer, findHousehold('az-savings')!.why]) {
      expect(text).toContain('$24 a month under FY2026 standards')
      expect(text).toContain('The minimum benefit rose to $25 on October 1, 2026.')
    }
    expect(findHousehold('az-savings')!.why).toContain("Axiom's Arizona SNAP rules don't test eligibility yet")
  })
})

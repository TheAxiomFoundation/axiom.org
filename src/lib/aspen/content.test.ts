import {
  RATING_SCALES,
  TWISTS,
  TWIST_IDS,
  twistsFor,
  HOUSEHOLDS,
  PERSPECTIVE_IDS,
  POLICYBENCH,
  STAGES,
  STAGE_IDS,
  composePrompt,
  findHousehold,
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
    const fy = (label: string) => Number(label.replace(/^FY/, ''))
    // FY2027 standards follow FY2026's and start on October 1 of the year before.
    expect(fy(fromOctober.standards)).toBe(fy(reference.standards) + 1)
    expect(federalFiscalYear('2026-10')).toBe(fy(fromOctober.standards))
    expect(fromOctober.effective).toBe(`October 1, ${fy(fromOctober.standards) - 1}`)
    // A minimum benefit doesn't fall with a cost-of-living adjustment.
    expect(fromOctober.monthly).toBeGreaterThanOrEqual(reference.monthly)
    for (const text of [answer, findHousehold('az-savings')!.why]) {
      expect(text).toContain(`$${reference.monthly} a month under ${reference.standards} standards`)
      expect(text).toContain(`$${fromOctober.monthly} from ${fromOctober.effective}`)
    }
    expect(findHousehold('az-savings')!.why).toContain("Axiom's Arizona SNAP rules don't test eligibility yet")
  })
})

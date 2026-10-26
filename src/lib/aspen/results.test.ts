import fc from 'fast-check'
import {
  EMPTY_SUMMARY,
  actedOn,
  answersGiven,
  breakdownOf,
  latestPerParticipant,
  countBy,
  plainText,
  questionsAsked,
  ifEligibleSentence,
  rank,
  rulesIfEligible,
  rulesProgramId,
  summarizeRun,
  summarizeScales,
  viabilityOf,
} from './results'
import { ELIGIBILITY_NOT_TESTED } from './coverage'
import type { PromptRow, RunData } from './types'

const base = { run_id: 'r', conversation_id: 'c', participant_id: 'p' }

const DATA: RunData = {
  participants: [
    { id: 'p1', run_id: 'r', perspective: 'resident', state: 'Arizona' },
    { id: 'p2', run_id: 'r', perspective: 'caseworker', state: 'Arizona' },
    { id: 'p3', run_id: 'r', perspective: 'mystery', state: null },
  ],
  prompts: [
    {
      ...base,
      id: 'a',
      turn: 0,
      created_at: '2026-10-26T18:00:00Z',
      perspective: 'resident',
      household_id: 'ct-couple',
      prompt: 'Can I get SNAP?\n  with   savings',
      answer: 'You may not qualify. '.repeat(30),
      verdict: 'wrong',
      would_act: 'no',
      went_well: ['Plain and clear'],
      went_wrong: ['Said I don’t qualify', 'Wrong amount'],
      rules_program: 'Arizona SNAP',
      rules_amount: 24,
      post_check_verdict: 'wrong',
    },
    {
      ...base,
      id: 'b',
      turn: 1,
      created_at: '2026-10-26T18:01:00Z',
      perspective: 'resident',
      household_id: 'ct-couple',
      prompt: 'Follow-up',
      answer: 'Short.',
      verdict: 'unsure',
      would_act: 'maybe',
    },
    {
      ...base,
      conversation_id: 'c-c',
      id: 'c',
      turn: 0,
      created_at: '2026-10-26T18:02:00Z',
      perspective: 'caseworker',
      household_id: null,
      prompt: 'Own question',
      answer: null,
      error: 'timeout',
    },
    {
      ...base,
      conversation_id: 'c-d',
      id: 'd',
      turn: 0,
      perspective: 'stranger',
      household_id: 'retired-id',
      prompt: 'Old household',
      answer: 'An answer',
    },
  ],
  events: [
    { run_id: 'r', kind: 'discussion', payload: { question: 'misunderstood', topics: ['Asset tests', 'Odd'], note: '  BBCE  ' } },
    { run_id: 'r', kind: 'discussion', payload: { question: 'experience', topics: 'nope', note: null } },
    { run_id: 'r', kind: 'breakout', payload: { useCase: 'project', note: 'Model the change' } },
    { run_id: 'r', kind: 'breakout', payload: { useCase: 'flows' } },
  ],
  pledges: [
    { state: 'Arizona', accurate_ai: true, state_systems: true, show_state: true },
    { state: 'Arizona', accurate_ai: false, state_systems: true, show_state: true },
    { state: 'Colorado', accurate_ai: true, state_systems: false, show_state: false },
    { state: null, accurate_ai: true, state_systems: false, show_state: true },
  ],
}

describe('aspen results', () => {
  it('counts known options in order, then unknown values', () => {
    expect(countBy(['a', 'z', null, 'a'], [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }])).toEqual([
      { id: 'a', label: 'A', count: 2 },
      { id: 'b', label: 'B', count: 0 },
      { id: 'z', label: 'z', count: 1 },
    ])
    expect(rank(['x', 'y', 'y', undefined, 'w'])).toEqual([
      { id: 'y', label: 'y', count: 2 },
      { id: 'w', label: 'w', count: 1 },
      { id: 'x', label: 'x', count: 1 },
    ])
  })

  it('summarizes a run for the reveal', () => {
    const s = summarizeRun(DATA)
    expect(s).toMatchObject({ participants: 3, prompts: 3, rated: 2, checked: 1 })
    // What people asked as comes from their first questions, not the optional welcome pick.
    expect(s.perspectives.map((c) => [c.id, c.count])).toEqual([
      ['resident', 1],
      ['caseworker', 1],
      ['stranger', 1],
    ])
    expect(s.households.find((h) => h.id === 'ct-couple')?.count).toBe(1)
    expect(s.households.find((h) => h.id === 'own')?.count).toBe(1)
    expect(s.states).toEqual([{ id: 'Arizona', label: 'Arizona', count: 2 }])
    expect(s.verdicts.map((c) => c.count)).toEqual([0, 1, 1])
    expect(s.wentWrong[0].count).toBe(1)
    expect(s.postCheck.find((c) => c.id === 'wrong')?.count).toBe(1)
  })

  it('builds an anonymous feed, newest first', () => {
    const { feed } = summarizeRun(DATA)
    expect(feed.map((f) => f.id)).toEqual(['b', 'a', 'd'])
    const first = feed.find((f) => f.id === 'a')!
    expect(first).not.toHaveProperty('participant_id')
    expect(first.prompt).toBe('Can I get SNAP? with savings')
    expect(first.answer?.endsWith('…')).toBe(true)
    expect(first.answer!.length).toBeLessThanOrEqual(360)
    expect(first).toMatchObject({ perspective: 'A resident', household: 'Couple, with savings', rulesAmount: 24 })
    const unknown = feed.find((f) => f.id === 'd')!
    expect(unknown).toMatchObject({ perspective: 'stranger', household: null, createdAt: null })
  })

  it('collects discussion and small-group notes', () => {
    const { discussion, breakouts } = summarizeRun(DATA)
    expect(discussion.questions.find((q) => q.id === 'misunderstood')?.count).toBe(1)
    expect(discussion.topics[0]).toMatchObject({ id: 'Asset tests', count: 1 })
    expect(discussion.notes).toEqual([{ question: 'misunderstood', text: 'BBCE' }])
    expect(breakouts.useCases.find((u) => u.id === 'project')?.count).toBe(1)
    expect(breakouts.notes).toEqual([{ useCase: 'project', text: 'Model the change', who: null, trust: null, raised: null }])
  })

  it('shows pledged states only when allowed, never names', () => {
    expect(summarizeRun(DATA).pledges).toEqual({ people: 4, accurateAi: 3, stateSystems: 2 })
  })

  it('turns Markdown answers into plain excerpts', () => {
    const flat = (t: string) => t.replace(/\s+/g, ' ').trim()
    expect(
      flat(plainText('### Estimate\n- **$24** a month\n1. Apply at [Health-e-Arizona](https://x.gov)\n| a | b |\n|---|---|\nUse `code`')),
    ).toBe('Estimate $24 a month Apply at Health-e-Arizona a b Use code')
    const { feed } = summarizeRun({
      ...DATA,
      prompts: [{ ...DATA.prompts[1], id: 'md', answer: '## Rough estimate\n- **$219**/month' }],
    })
    expect(feed[0].answer).toBe('Rough estimate $219/month')
  })

  it('counts the details people added on their first questions', () => {
    const { twists } = summarizeRun({
      ...DATA,
      prompts: [
        { ...DATA.prompts[0], twists: ['gig', 'savings'] },
        { ...DATA.prompts[1], twists: ['gig'] },
        { ...DATA.prompts[2], twists: ['gig'] },
      ],
    })
    expect(twists[0]).toEqual({ id: 'gig', label: 'Gig income', count: 2 })
    expect(twists.find((t) => t.id === 'savings')?.count).toBe(1)
  })

  it('averages each rated category, ignoring other questions and bad scores', () => {
    const scales = summarizeScales([
      { payload: { question: 'performance', ratings: { amount: 2, clarity: 4 } } },
      { payload: { question: 'performance', ratings: { amount: 3, clarity: 'five' } } },
      { payload: { question: 'performance' } },
      { payload: { question: 'experience', ratings: { staff: 5 } } },
      { payload: { question: 'misunderstood', ratings: { amount: 1 } } },
    ])
    expect(scales.map((s) => s.question)).toEqual(['performance', 'experience'])
    const perf = scales[0]
    expect(perf).toMatchObject({ low: 'Not at all', high: 'Fully' })
    expect(perf.categories.find((c) => c.id === 'amount')).toEqual({ id: 'amount', label: 'Got the amount right', average: 2.5, count: 2 })
    expect(perf.categories.find((c) => c.id === 'clarity')).toMatchObject({ average: 4, count: 1 })
    expect(perf.categories.find((c) => c.id === 'sources')).toMatchObject({ average: null, count: 0 })
    expect(scales[1].categories.find((c) => c.id === 'staff')).toMatchObject({ average: 5, count: 1 })
    expect(summarizeRun(DATA).discussion.scales).toHaveLength(2)
  })

  it('measures whether people could act on the answers', () => {
    const p = (verdict: string, would_act: string | null) => ({ ...base, id: verdict + would_act, turn: 0, prompt: 'q', verdict, would_act })
    expect(
      viabilityOf([p('right', 'yes'), p('wrong', 'yes'), p('unsure', 'maybe'), p('wrong', 'no'), p('unsure', null)]),
    ).toMatchObject({ rated: 5, right: 1, unsure: 2, wrong: 2, wouldAct: 2, maybe: 1, wouldNot: 1, convincing: 2, wouldNotApply: 0 })
  })

  it('counts what a resident would do, and the eligible ones the answer would stop', () => {
    const p = (id: string, resident_action: string, rules_amount?: number) => ({ ...base, id, turn: 0, prompt: 'q', verdict: 'wrong', resident_action, rules_amount })
    const v = viabilityOf([p('a', 'not-apply', 24), p('b', 'not-apply', 0), p('c', 'not-apply'), p('d', 'apply', 300), p('e', 'call')])
    expect(v.wouldNotApply).toBe(3)
    expect(v.wouldNotApplyEligible).toBe(1)
    expect(v.residentActions.map((c) => [c.id, c.count])).toEqual([
      ['apply', 1],
      ['not-apply', 3],
      ['call', 1],
      ['unsure', 0],
    ])
  })

  it('reads the program a saved rules check ran on', () => {
    // The run select's alias first (store.ts RUN_PROMPT_SELECT), whole saved computations second.
    expect(rulesProgramId({ rules_program_id: 'us-az-snap', rules_outputs: [{ program: 'us-ny-snap' }] })).toBe('us-az-snap')
    expect(rulesProgramId({ rules_outputs: [{ program: 'us-az-snap' }, { program: 'us-ny-snap' }] })).toBe('us-az-snap')
    for (const rules_outputs of [undefined, null, [], ['junk'], [null], [{ program: 7 }], [{}], { program: 'us-az-snap' }]) {
      expect(rulesProgramId({ rules_outputs })).toBeNull()
    }
  })

  it('reads a saved check the way the panel showed it', () => {
    // The verdict saved with the check wins over today's list.
    expect(rulesIfEligible({ rules_eligibility_tested: false, rules_program_id: 'us-ny-snap' })).toBe(true)
    expect(rulesIfEligible({ rules_eligibility_tested: true, rules_program_id: 'us-az-snap' })).toBe(false)
    expect(rulesIfEligible({ rules_outputs: [{ program: 'us-az-snap', eligibilityTested: true }] })).toBe(false)
    // A check saved before the verdict was: its program decides.
    expect(rulesIfEligible({ rules_eligibility_tested: null, rules_program_id: 'us-az-snap' })).toBe(true)
    expect(rulesIfEligible({ rules_outputs: [{ program: 'us-az-snap' }] })).toBe(true)
    expect(rulesIfEligible({ rules_program_id: 'us-ny-snap' })).toBe(false)
    // Nothing known about the check: no known limit.
    expect(rulesIfEligible({ rules_outputs: null })).toBe(false)
  })

  it('does not count an amount from rules that skip eligibility as a household that qualifies', () => {
    const p = (id: string, program: string | null, rules_amount: number) => ({
      ...base,
      id,
      conversation_id: id,
      turn: 0,
      prompt: 'q',
      verdict: 'wrong',
      resident_action: 'not-apply',
      rules_amount,
      rules_program_id: program,
      rules_eligibility_tested: program === null ? null : !ELIGIBILITY_NOT_TESTED.includes(program),
    })
    const v = viabilityOf([p('az', 'us-az-snap', 24), p('ny', 'us-ny-snap', 300), p('old', null, 50), p('az0', 'us-az-snap', 0)])
    expect(v).toMatchObject({ wouldNotApply: 4, wouldNotApplyEligible: 2, wouldNotApplyIfEligible: 1 })
    const feed = summarizeRun({ ...DATA, prompts: [{ ...p('az', 'us-az-snap', 24), answer: 'No.' }, { ...p('ny', 'us-ny-snap', 300), answer: 'No.' }] }).feed
    expect(feed.map((f) => [f.id, f.rulesAmount, f.rulesIfEligible])).toEqual(
      expect.arrayContaining([
        ['az', 24, true],
        ['ny', 300, false],
      ]),
    )
  })

  it('splits every not-apply answer with a rules amount into qualifies or if-eligible, never both', () => {
    const row = fc.record({
      resident_action: fc.constantFrom('not-apply', 'apply', 'call', null),
      rules_amount: fc.option(fc.integer({ min: -5, max: 500 }), { nil: undefined }),
      rules_program_id: fc.constantFrom(null, ...ELIGIBILITY_NOT_TESTED, 'us-ny-snap', 'us-co-snap'),
      rules_eligibility_tested: fc.constantFrom(null, true, false),
    })
    fc.assert(
      fc.property(fc.array(row, { maxLength: 12 }), (rows) => {
        const prompts = rows.map((r, i) => ({ ...base, id: String(i), turn: 0, prompt: 'q', verdict: 'wrong', ...r }) as PromptRow)
        const v = viabilityOf(prompts)
        const withAmount = prompts.filter(
          (p) => p.resident_action === 'not-apply' && typeof p.rules_amount === 'number' && p.rules_amount > 0,
        )
        const ifEligible = (p: PromptRow) =>
          typeof p.rules_eligibility_tested === 'boolean'
            ? !p.rules_eligibility_tested
            : ELIGIBILITY_NOT_TESTED.includes(p.rules_program_id ?? '')
        expect(v.wouldNotApplyEligible + v.wouldNotApplyIfEligible).toBe(withAmount.length)
        expect(v.wouldNotApplyIfEligible).toBe(withAmount.filter(ifEligible).length)
        expect(v.wouldNotApplyEligible + v.wouldNotApplyIfEligible).toBeLessThanOrEqual(v.wouldNotApply)
      }),
    )
  })

  it('says how many more got an amount from rules that skip eligibility', () => {
    expect(ifEligibleSentence({ wouldNotApplyEligible: 0, wouldNotApplyIfEligible: 0 }, 'of those')).toBeNull()
    expect(ifEligibleSentence({ wouldNotApplyEligible: 0, wouldNotApplyIfEligible: 1 }, 'of those')).toBe(
      "For 1 of those, the rules give an amount but don't test eligibility yet.",
    )
    expect(ifEligibleSentence({ wouldNotApplyEligible: 2, wouldNotApplyIfEligible: 3 }, 'of them')).toBe(
      "For 3 more, the rules give an amount but don't test eligibility yet.",
    )
  })

  it('keeps what else each group raised, also from a group that shared no idea', () => {
    const { breakouts } = summarizeRun({
      ...DATA,
      events: [
        { run_id: 'r', kind: 'breakout', payload: { useCase: 'flows', note: 'Pilot in one county', raised: 'Training time' } },
        { run_id: 'r', kind: 'breakout', payload: { useCase: null, note: '', raised: 'Union rules' } },
        { run_id: 'r', kind: 'breakout', payload: { useCase: 'apply', note: '', raised: '' } },
      ],
    })
    expect(breakouts.notes).toEqual([
      { useCase: '', text: '', who: null, trust: null, raised: 'Union rules' },
      { useCase: 'flows', text: 'Pilot in one county', who: null, trust: null, raised: 'Training time' },
    ])
  })

  it('keeps who would use each idea and what would earn trust', () => {
    const { breakouts } = summarizeRun({
      ...DATA,
      events: [{ run_id: 'r', kind: 'breakout', payload: { useCase: 'flows', note: '', who: 'Intake workers', trust: 'Matches our manual' } }],
    })
    expect(breakouts.notes).toEqual([{ useCase: 'flows', text: '', who: 'Intake workers', trust: 'Matches our manual', raised: null }])
  })

  it('counts the votes on what to build first, in the order of the choices', () => {
    const { votes, breakouts } = summarizeRun({
      ...DATA,
      events: [
        { run_id: 'r', kind: 'vote', payload: { useCase: 'project' } },
        { run_id: 'r', kind: 'vote', payload: { useCase: 'project' } },
        { run_id: 'r', kind: 'vote', payload: { useCase: 'apply' } },
        { run_id: 'r', kind: 'vote', payload: { useCase: 'test' } },
      ],
    })
    expect(votes.map((c) => [c.id, c.count])).toEqual([
      ['see-edit', 0],
      ['project', 2],
      ['flows', 0],
      ['apply', 1],
      ['test', 1],
    ])
    // Votes are not group ideas.
    expect(breakouts.useCases.every((c) => c.count === 0)).toBe(true)
  })

  it('counts the source-of-truth answers from Rate it', () => {
    const { sourceOfTruth } = summarizeRun({
      ...DATA,
      events: [
        { run_id: 'r', kind: 'survey', payload: { question: 'source-of-truth', answer: 'no' } },
        { run_id: 'r', kind: 'survey', payload: { question: 'source-of-truth', answer: 'no' } },
        { run_id: 'r', kind: 'survey', payload: { question: 'source-of-truth', answer: 'partly' } },
        { run_id: 'r', kind: 'survey', payload: { question: 'other', answer: 'yes' } },
      ],
    })
    expect(sourceOfTruth.map((c) => [c.id, c.count])).toEqual([
      ['yes', 0],
      ['partly', 1],
      ['no', 2],
    ])
  })

  it('breaks first questions down by household, detail and perspective, worst first', () => {
    const rows = breakdownOf([
      { ...base, id: '1', turn: 0, prompt: 'q', household_id: 'ct-couple', perspective: 'resident', twists: ['gig'], verdict: 'wrong' },
      { ...base, id: '2', turn: 0, prompt: 'q', household_id: 'ct-couple', perspective: 'caseworker', verdict: 'right' },
      { ...base, id: '3', turn: 0, prompt: 'q', household_id: null, perspective: 'resident', verdict: 'unsure' },
      { ...base, id: '4', turn: 0, prompt: 'q', household_id: 'ny-parent', perspective: 'resident' },
    ])
    expect(rows[0]).toMatchObject({ kind: 'detail', id: 'gig', label: '+ Gig income', asked: 1, rated: 1, wrong: 1 })
    expect(rows.find((r) => r.id === 'ct-couple')).toMatchObject({ asked: 2, rated: 2, wrong: 1 })
    expect(rows.find((r) => r.id === 'own')).toMatchObject({ label: 'Their own question', unsure: 1, wrong: 0 })
    expect(rows.find((r) => r.id === 'resident')).toMatchObject({ label: 'Asked as a resident', asked: 3, rated: 2, wrong: 1 })
    // Unrated rows sort last.
    expect(rows.at(-1)).toMatchObject({ id: 'ny-parent', rated: 0 })
    expect(rows.find((r) => r.id === 'md-tca')).toBeUndefined()
  })

  it('spotlights wrong-but-convincing answers first, then the rest by risk', () => {
    const { spotlight, voices } = summarizeRun({
      ...DATA,
      prompts: [
        { ...base, id: 'w', conversation_id: 'w', turn: 0, created_at: '1', prompt: 'q', answer: 'a', verdict: 'wrong', would_act: 'no' },
        { ...base, id: 'c', conversation_id: 'c', turn: 0, created_at: '2', prompt: 'q', answer: 'a', verdict: 'wrong', would_act: 'yes', rating_note: 'Scary', twists: ['gig', 'mystery'] },
        { ...base, id: 'k', conversation_id: 'k', turn: 0, created_at: '3', prompt: 'q', answer: 'a', verdict: 'right', would_act: 'yes', post_check_verdict: 'wrong' },
        { ...base, id: 'u', conversation_id: 'u', turn: 0, created_at: '4', prompt: 'q', answer: 'a', verdict: 'unsure', would_act: 'no' },
        { ...base, id: 'r', conversation_id: 'r', turn: 0, created_at: '5', prompt: 'q', answer: 'a', verdict: 'right', would_act: 'yes', rating_note: 'Spot on' },
        { ...base, id: 'w2', conversation_id: 'w2', turn: 0, created_at: '6', prompt: 'q', answer: 'a', verdict: 'wrong', would_act: 'no' },
      ],
    })
    expect(spotlight.map((s) => [s.id, s.reason])).toEqual([
      ['c', 'convincing'],
      ['k', 'checked-wrong'],
      ['w2', 'wrong'],
      ['w', 'wrong'],
    ])
    expect(spotlight[0]).toMatchObject({ note: 'Scary', wouldAct: 'yes', details: ['Gig income', 'mystery'] })
    // Notes on rated answers, newest first (the fixture's overall notes come with no verdict).
    expect(voices.filter((v) => v.verdict)).toEqual([
      { text: 'Spot on', verdict: 'right' },
      { text: 'Scary', verdict: 'wrong' },
    ])
  })

  it('adds every overall note to the room\'s own words, newest first', () => {
    const { voices, discussion } = summarizeRun({
      ...DATA,
      prompts: [{ ...base, id: 'a', turn: 0, created_at: '2026-10-26T18:00:00Z', prompt: 'q', answer: 'a', verdict: 'wrong', rating_note: 'Wrong amount' }],
      events: [
        { run_id: 'r', kind: 'discussion', stage: 'try', created_at: '2026-10-26T18:10:00Z', payload: { question: null, note: 'Staff use it already' } },
        { run_id: 'r', kind: 'discussion', stage: 'try', created_at: '2026-10-26T18:20:00Z', payload: { question: 'performance', note: 'Too confident' } },
        { run_id: 'r', kind: 'discussion', stage: 'try', created_at: '2026-10-26T18:30:00Z', payload: { question: 'performance', ratings: { amount: 2 } } },
      ],
    })
    expect(voices).toEqual([
      { text: 'Too confident', verdict: null },
      { text: 'Staff use it already', verdict: null },
      { text: 'Wrong amount', verdict: 'wrong' },
    ])
    // The same notes by question, for the data export; a ratings-only event adds none.
    expect(discussion.notes).toEqual([
      { question: 'performance', text: 'Too confident' },
      { question: '', text: 'Staff use it already' },
    ])
  })

  it('has an empty summary', () => {
    expect(EMPTY_SUMMARY).toMatchObject({ participants: 0, prompts: 0, feed: [] })
  })

  it('keeps agency comments out of the voices the phones show, but in the notes', () => {
    const s = summarizeRun({
      participants: [],
      prompts: [],
      events: [
        { run_id: 'r', kind: 'discussion', payload: { question: 'experience', ratings: {}, note: 'Our chatbot struggles with SNAP' } },
        { run_id: 'r', kind: 'discussion', payload: { question: null, ratings: {}, note: 'Great session' } },
      ],
      pledges: [],
    })
    expect(s.voices.map((v) => v.text)).toEqual(['Great session'])
    expect(s.discussion.notes.find((n) => n.question === 'experience')?.text).toBe('Our chatbot struggles with SNAP')
  })
})

describe('latestPerParticipant', () => {
  type E = { id: number; participant_id: string | null; q: string; created_at: string }
  const event = fc.record({
    participant_id: fc.option(fc.constantFrom('p1', 'p2', 'p3'), { nil: null }),
    q: fc.constantFrom('experience', 'source-of-truth'),
    // Same-format ISO times, ties included, as the database writes them.
    created_at: fc.integer({ min: 0, max: 20 }).map((m) => `2026-10-26T18:${String(m).padStart(2, '0')}:00Z`),
  })
  const events = fc.array(event, { maxLength: 30 }).map((es) => es.map((e, id) => ({ ...e, id }) as E))
  const byQ = (e: E) => e.q

  it('keeps one event per person and key, the latest, and every event without a person', () => {
    fc.assert(
      fc.property(events, (es) => {
        const out = latestPerParticipant(es, byQ)
        // Only input events, each at most once.
        expect(new Set(out.map((e) => e.id)).size).toBe(out.length)
        expect(out.every((e) => es.includes(e))).toBe(true)
        // Every loose event stays.
        expect(out.filter((e) => !e.participant_id).map((e) => e.id).sort()).toEqual(
          es.filter((e) => !e.participant_id).map((e) => e.id).sort(),
        )
        // Exactly one per (person, key), with the group's latest time.
        const groups = new Map<string, E[]>()
        for (const e of es.filter((e) => e.participant_id)) {
          const k = `${e.participant_id}|${e.q}`
          groups.set(k, [...(groups.get(k) ?? []), e])
        }
        const kept = out.filter((e) => e.participant_id)
        expect(kept).toHaveLength(groups.size)
        for (const e of kept) {
          const group = groups.get(`${e.participant_id}|${e.q}`)!
          expect(e.created_at).toBe(group.map((g) => g.created_at).sort().at(-1))
        }
        // Oldest first, as the rest of the summary expects.
        const times = out.map((e) => e.created_at)
        expect(times).toEqual([...times].sort())
      }),
    )
  })

  // Which of two events tied in time wins does depend on order; the next test pins that down.
  it('is idempotent, and keeps the same person, key and time whatever order the events arrive in', () => {
    fc.assert(
      fc.property(events, fc.integer(), (es, seed) => {
        const once = latestPerParticipant(es, byQ)
        expect(latestPerParticipant(once, byQ).map((e) => e.id).sort()).toEqual(once.map((e) => e.id).sort())
        const shuffled = [...es].sort((a, b) => ((a.id * 7919 + seed) % 31) - ((b.id * 7919 + seed) % 31))
        const sig = (xs: E[]) => xs.map((e) => `${e.participant_id}|${e.q}|${e.created_at}`).sort()
        expect(sig(latestPerParticipant(shuffled, byQ))).toEqual(sig(once))
      }),
    )
  })

  it('breaks a tie in time with the later event', () => {
    const at = '2026-10-26T18:00:00Z'
    const out = latestPerParticipant(
      [
        { id: 1, participant_id: 'p1', q: 'experience', created_at: at },
        { id: 2, participant_id: 'p1', q: 'experience', created_at: at },
      ],
      byQ,
    )
    expect(out.map((e) => e.id)).toEqual([2])
  })

  type S = E & { payload: { rev?: number } }
  const T0 = Date.parse('2026-10-26T18:00:00Z')
  // Stamps from the phone's clock, in the same minutes as the server's times: ties included, as two tabs can stamp alike.
  const stamped = fc
    .array(fc.record({ participant_id: fc.constantFrom('p1', 'p2'), q: fc.constantFrom('experience', 'source-of-truth'), stamp: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }), created_at: event.map((e) => e.created_at) }), { maxLength: 30 })
    .map((es) => es.map(({ stamp, ...e }, id) => ({ ...e, id, payload: stamp === null ? {} : { rev: T0 + stamp * 30_000 } }) as S))
  // When each answer was given, written out apart from the code: its stamp, else when it reached the server.
  const given = (e: S) => e.payload.rev ?? Date.parse(e.created_at)
  const later = (a: S, b: S) => given(a) - given(b) || a.created_at.localeCompare(b.created_at)

  it("counts the answer each person gave last, by its stamp or, sent without one, by the server's time", () => {
    fc.assert(
      fc.property(stamped, fc.integer(), (es, seed) => {
        const out = latestPerParticipant(es, byQ)
        const groups = new Map<string, S[]>()
        for (const e of es) groups.set(`${e.participant_id}|${e.q}`, [...(groups.get(`${e.participant_id}|${e.q}`) ?? []), e])
        expect(out).toHaveLength(groups.size)
        for (const e of out) {
          const last = [...groups.get(`${e.participant_id}|${e.q}`)!].sort(later).at(-1)!
          // The one given last, or one exactly tied with it.
          expect(later(e, last)).toBe(0)
        }
        // So the order the events come in changes nothing, but which of two exact ties counts.
        const shuffled = [...es].sort((a, b) => ((a.id * 7919 + seed) % 31) - ((b.id * 7919 + seed) % 31))
        for (const e of latestPerParticipant(shuffled, byQ)) {
          expect(later(e, out.find((o) => o.participant_id === e.participant_id && o.q === e.q)!)).toBe(0)
        }
      }),
    )
  })

  it('keeps an earlier tap that landed last from counting over a later one, and counts a later answer sent without a stamp', () => {
    const at = (s: string) => `2026-10-26T18:00:${s}Z`
    const tapped = (s: string) => Date.parse(at(s))
    const answers = [
      { id: 1, participant_id: 'p1', q: 'experience', created_at: at('06'), payload: { rev: tapped('05') } },
      // The slow first save, written after the second.
      { id: 2, participant_id: 'p1', q: 'experience', created_at: at('10'), payload: { rev: tapped('01') } },
      // From a page too old to stamp, reaching the server before the tap that counts.
      { id: 3, participant_id: 'p1', q: 'experience', created_at: at('03'), payload: {} },
    ]
    expect(latestPerParticipant(answers, byQ).map((e) => e.id)).toEqual([1])
    // The same old page answering after it: that answer counts.
    const oldPageAgain = { id: 4, participant_id: 'p1', q: 'experience', created_at: at('20'), payload: {} }
    expect(latestPerParticipant([...answers, oldPageAgain], byQ).map((e) => e.id)).toEqual([4])
    // Two tabs that stamped alike: the one that reached the server last.
    const twin = { id: 5, participant_id: 'p1', q: 'experience', created_at: at('07'), payload: { rev: tapped('05') } }
    expect(latestPerParticipant([...answers, twin], byQ).map((e) => e.id)).toEqual([5])
  })
})

describe('questionsAsked and answersGiven', () => {
  const row = (id: string, conversation_id: string, turn: number, created_at?: string, prompt = 'q'): PromptRow =>
    ({ ...base, id, conversation_id, turn, prompt, ...(created_at ? { created_at } : {}) })

  it('counts a question asked again once, with the attempt that was answered and rated', () => {
    const failed = { ...row('failed', 'x', 0, '2026-10-26T18:00:00Z'), household_id: 'ct-couple', error: 'timeout' }
    const again = { ...row('again', 'x', 0, '2026-10-26T18:00:09Z'), household_id: 'ct-couple', answer: 'An answer', verdict: 'wrong' }
    const followUp = row('follow', 'x', 1, '2026-10-26T18:01:00Z')
    expect(questionsAsked([failed, again, followUp]).map((p) => p.id)).toEqual(['again', 'follow'])
    const summary = summarizeRun({ ...DATA, prompts: [failed, again, followUp] })
    expect(summary.households.find((h) => h.id === 'ct-couple')?.count).toBe(1)
    expect(summary.breakdown.find((r) => r.id === 'ct-couple')).toMatchObject({ asked: 1, rated: 1, wrong: 1 })
  })

  it('counts an answer cut off on one tab that still finished once, with the rating from the retry, even when it was saved after', () => {
    // The first attempt stalled before it was saved, so the retry's row is the older one.
    const retry = { ...row('retry', 'x', 0, '2026-10-26T18:00:09Z'), household_id: 'ct-couple', answer: 'Retry', verdict: 'wrong' }
    const original = { ...row('original', 'x', 0, '2026-10-26T18:00:20Z'), household_id: 'ct-couple', answer: 'Original' }
    const summary = summarizeRun({ ...DATA, prompts: [retry, original] })
    expect(summary.prompts).toBe(1)
    expect(summary.rated).toBe(1)
    expect(summary.feed.map((f) => f.id)).toEqual(['retry'])
    expect(summary.households.find((h) => h.id === 'ct-couple')?.count).toBe(1)
    expect(summary.breakdown.find((r) => r.id === 'ct-couple')).toMatchObject({ asked: 1, rated: 1, wrong: 1 })
  })

  it("never takes a question off the count when a retry whose answer didn't save is rated", () => {
    // The cut-off first attempt finished on the server; the retry's answer reached the phone but not the store.
    const original = { ...row('original', 'x', 0, '2026-10-26T18:00:00Z'), household_id: 'ct-couple', answer: 'Original' }
    const retry = { ...row('retry', 'x', 0, '2026-10-26T18:00:09Z'), household_id: 'ct-couple' }
    const before = summarizeRun({ ...DATA, prompts: [original, retry] })
    const after = summarizeRun({ ...DATA, prompts: [original, { ...retry, verdict: 'wrong', resident_action: 'apply' }] })
    expect([before.prompts, before.rated, before.feed.length]).toEqual([1, 0, 1])
    expect([after.prompts, after.rated, after.feed.length]).toEqual([1, 1, 1])
    // The feed shows the answer that saved, without a rating that was given to another one.
    expect(after.feed[0]).toMatchObject({ id: 'original', verdict: null })
    expect(after.breakdown.find((r) => r.id === 'ct-couple')).toMatchObject({ asked: 1, rated: 1, wrong: 1 })
  })

  it('keeps the rated attempt that was also checked against the rules over a later one that was only rated', () => {
    const checked = {
      ...row('checked', 'x', 0, '2026-10-26T18:00:00Z'),
      answer: 'A',
      verdict: 'right',
      rules_program: 'Arizona SNAP',
      rules_amount: 24,
      post_check_verdict: 'wrong',
    }
    const later = { ...row('later', 'x', 0, '2026-10-26T18:00:30Z'), answer: 'B', verdict: 'right' }
    expect(questionsAsked([checked, later]).map((p) => p.id)).toEqual(['checked'])
    const summary = summarizeRun({ ...DATA, prompts: [checked, later] })
    expect(summary.checked).toBe(1)
    expect(summary.postCheck.find((c) => c.id === 'wrong')?.count).toBe(1)
  })

  it('keeps different questions at the same turn apart', () => {
    const one = { ...row('one', 'x', 1, '2026-10-26T18:00:00Z', 'How much?'), answer: 'A' }
    const other = { ...row('other', 'x', 1, '2026-10-26T18:00:05Z', 'Who qualifies?'), answer: 'B' }
    expect(questionsAsked([one, other]).map((p) => p.id)).toEqual(['one', 'other'])
    expect(summarizeRun({ ...DATA, prompts: [one, other] }).prompts).toBe(2)
  })

  it('keeps one attempt per question, counts every question answered or rated and every one rated, and a rating never lowers a count', () => {
    const times = ['2026-10-26T18:00:00Z', '2026-10-26T18:00:05Z', '2026-10-26T18:01:00Z', undefined]
    const rows = fc.array(
      fc.record({
        conversation: fc.constantFrom('x', 'y'),
        turn: fc.constantFrom(0, 1),
        prompt: fc.constantFrom('q', 'r'),
        at: fc.constantFrom(...times),
        answer: fc.boolean(),
        // A rating can sit on an attempt whose answer didn't save.
        verdict: fc.constantFrom(undefined, 'wrong', 'right'),
        // Checks only through the fields the run's select returns (store.ts RUN_PROMPT_COLUMNS).
        check: fc.constantFrom(undefined, 'program', 'amount', 'post'),
      }),
      { maxLength: 14 },
    )
    const key = (p: PromptRow) => JSON.stringify([p.conversation_id, p.turn, p.prompt])
    // What an attempt shows, in order of preference: a rating, a verdict after the rules check, the check, an answer.
    const shows = (p: PromptRow) => [
      Boolean(p.verdict),
      Boolean(p.post_check_verdict),
      Boolean(p.rules_program || typeof p.rules_amount === 'number'),
      Boolean(p.answer),
    ]
    const before = (a: PromptRow, b: PromptRow) => {
      const [x, y] = [shows(a), shows(b)]
      const i = x.findIndex((v, j) => v !== y[j])
      return i >= 0 && !x[i] && y[i]
    }
    fc.assert(
      fc.property(rows, fc.nat(), (specs, pick) => {
        const prompts: PromptRow[] = specs.map((r, i) => ({
          ...row(String(i), r.conversation, r.turn, r.at, r.prompt),
          ...(r.answer ? { answer: 'a' } : {}),
          ...(r.verdict ? { verdict: r.verdict } : {}),
          ...(r.check === 'program' ? { rules_program: 'Arizona SNAP' } : {}),
          ...(r.check === 'amount' ? { rules_amount: 0 } : {}),
          ...(r.check === 'post' ? { post_check_verdict: 'wrong' } : {}),
        }))
        const kept = questionsAsked(prompts)
        expect(new Set(kept.map(key)).size).toBe(kept.length)
        expect(new Set(kept.map(key))).toEqual(new Set(prompts.map(key)))
        for (const p of kept) {
          expect(prompts).toContain(p)
          const group = prompts.filter((q) => key(q) === key(p))
          // Nothing in its question shows more, and of those that show as much it is the latest.
          expect(group.some((q) => before(p, q))).toBe(false)
          const latest = group
            .filter((q) => !before(q, p))
            .reduce((m, q) => ((q.created_at ?? '') > m ? (q.created_at ?? '') : m), '')
          expect(p.created_at ?? '').toBe(latest)
        }
        expect(questionsAsked(kept)).toEqual(kept)
        const answers = answersGiven(prompts)
        expect(answers.every((p) => p.answer && prompts.includes(p))).toBe(true)
        expect(new Set(answers.map(key))).toEqual(new Set(prompts.filter((p) => p.answer).map(key)))

        const summary = summarizeRun({ ...DATA, prompts })
        // Asked: every question whose answer saved or that was rated (the phone had its answer). Rated never exceeds it.
        expect(summary.prompts).toBe(new Set(prompts.filter((p) => p.answer || p.verdict).map(key)).size)
        expect(summary.rated).toBe(new Set(prompts.filter((p) => p.verdict).map(key)).size)
        expect(summary.rated).toBeLessThanOrEqual(summary.prompts)
        // The spotlight only shows attempts the totals count.
        for (const item of summary.spotlight) expect(kept.map((p) => p.id)).toContain(item.id)
        // Rating any one attempt never lowers either count.
        if (prompts.length) {
          const i = pick % prompts.length
          const rerated = prompts.map((p, j) => (j === i ? { ...p, verdict: 'wrong' } : p))
          const next = summarizeRun({ ...DATA, prompts: rerated })
          expect(next.prompts).toBeGreaterThanOrEqual(summary.prompts)
          expect(next.rated).toBeGreaterThanOrEqual(summary.rated)
        }
      }),
    )
  })

  it('keeps the attempt with a verdict after the rules check over a later one only checked', () => {
    const shared = { answer: 'A', verdict: 'right', rules_program: 'Arizona SNAP', rules_amount: 24 }
    const postChecked = { ...row('post', 'x', 0, '2026-10-26T18:00:00Z'), ...shared, post_check_verdict: 'wrong' }
    const later = { ...row('later', 'x', 0, '2026-10-26T18:00:30Z'), ...shared }
    expect(questionsAsked([postChecked, later]).map((p) => p.id)).toEqual(['post'])
    expect(summarizeRun({ ...DATA, prompts: [postChecked, later] }).postCheck.find((c) => c.id === 'wrong')?.count).toBe(1)
  })

  it('keeps a rated attempt over one that shows everything but a rating', () => {
    const rated = { ...row('rated', 'x', 0, '2026-10-26T18:00:00Z'), answer: 'A', verdict: 'wrong' }
    const unrated = {
      ...row('unrated', 'x', 0, '2026-10-26T18:00:30Z'),
      answer: 'B',
      rules_program: 'Arizona SNAP',
      rules_amount: 24,
      post_check_verdict: 'wrong',
    }
    expect(questionsAsked([rated, unrated]).map((p) => p.id)).toEqual(['rated'])
  })

  it('spotlights only the attempt the totals count, and leaves the question out when that attempt has no saved answer', () => {
    // An older answer rated wrong, then a retry whose answer didn't save, rated right and checked.
    const older = { ...row('older', 'x', 0, '2026-10-26T18:00:00Z'), answer: 'Wrong amount', verdict: 'wrong', resident_action: 'apply' }
    const retry = { ...row('retry', 'x', 0, '2026-10-26T18:00:30Z'), verdict: 'right', rules_amount: 24 }
    const summary = summarizeRun({ ...DATA, prompts: [older, retry] })
    expect(summary.verdicts.filter((v) => v.count > 0).map((v) => [v.id, v.count])).toEqual([['right', 1]])
    expect(summary.spotlight).toEqual([])
  })

  it("counts a rated question as asked even when its answer didn't save, so ratings never outnumber questions", () => {
    const unsaved = { ...row('unsaved', 'x', 0, '2026-10-26T18:00:00Z'), verdict: 'wrong' }
    const summary = summarizeRun({ ...DATA, prompts: [unsaved] })
    expect(summary).toMatchObject({ prompts: 1, rated: 1 })
    // With no answer to show, it isn't spotlighted.
    expect(summary.spotlight).toEqual([])
  })

  it('breaks a tie with the later row', () => {
    const at = '2026-10-26T18:00:00Z'
    expect(questionsAsked([row('1', 'x', 0, at), row('2', 'x', 0, at)]).map((p) => p.id)).toEqual(['2'])
  })
})

describe('actedOn', () => {
  const action = fc.constantFrom(null, undefined, 'apply', 'not-apply', 'call', 'unsure')
  const wouldAct = fc.constantFrom(null, undefined, 'yes', 'maybe', 'no')

  it('reads an older rating by "Would you act on it?" alone, and a new one by what a resident would do', () => {
    // Every combination, written out by hand rather than from the rule.
    const actions = [null, undefined, 'apply', 'not-apply', 'call', 'unsure'] as const
    const expected: [string | null | undefined, boolean[]][] = [
      ['yes', [true, true, true, true, true, true]],
      ['maybe', [true, true, true, true, true, true]],
      // As before this change: an older "no" stays not acted on, whatever the resident would do.
      ['no', [false, false, false, false, false, false]],
      [null, [false, false, true, true, false, false]],
      [undefined, [false, false, true, true, false, false]],
    ]
    for (const [would_act, row] of expected) {
      actions.forEach((resident_action, i) =>
        expect(actedOn({ resident_action, would_act } as Pick<PromptRow, 'would_act' | 'resident_action'>), `${would_act}/${resident_action}`).toBe(row[i]),
      )
    }
  })

  it('counts convincing answers as the wrong or unsure ones acted on, never more than those', () => {
    const verdict = fc.constantFrom('right', 'unsure', 'wrong')
    const row = fc.record({ verdict, resident_action: action, would_act: wouldAct })
    fc.assert(
      fc.property(fc.array(row, { maxLength: 25 }), (rows) => {
        const rated = rows.map((r, i) => ({ ...base, id: `x${i}`, turn: 0, ...r }) as PromptRow)
        const v = viabilityOf(rated)
        expect(v.convincing).toBe(rated.filter((p) => p.verdict !== 'right' && actedOn(p)).length)
        expect(v.convincing).toBeLessThanOrEqual(v.unsure + v.wrong)
      }),
    )
  })

  it('reads a call to check, or not sure, as not acted on', () => {
    expect(actedOn({ resident_action: 'call', would_act: null })).toBe(false)
    expect(actedOn({ resident_action: 'unsure', would_act: 'no' })).toBe(false)
    expect(actedOn({ resident_action: null, would_act: 'maybe' })).toBe(true)
    expect(actedOn({ resident_action: 'apply', would_act: 'no' })).toBe(false)
  })
})

describe('summarizeRun with answers saved as they are tapped', () => {
  const ev = (participant_id: string, minute: number, kind: string, payload: Record<string, unknown>) => ({
    run_id: 'r',
    participant_id,
    kind,
    payload,
    created_at: `2026-10-26T18:${String(minute).padStart(2, '0')}:00Z`,
  })

  it('counts each person once, with their last tap, for the agency rating, the source of truth and the vote', () => {
    const agency = (ratings: Record<string, number>, note = '') => ({ question: 'experience', ratings, topics: [], note })
    const s = summarizeRun({
      ...DATA,
      events: [
        ev('p1', 1, 'discussion', agency({ residents: 1 })),
        ev('p1', 2, 'discussion', agency({ residents: 1, staff: 2 })),
        ev('p1', 3, 'discussion', agency({ residents: 5, staff: 2 }, 'Helps staff')),
        ev('p2', 2, 'discussion', agency({ residents: 3 })),
        ev('p1', 1, 'survey', { question: 'source-of-truth', answer: 'yes' }),
        ev('p1', 4, 'survey', { question: 'source-of-truth', answer: 'no' }),
        ev('p2', 4, 'survey', { question: 'source-of-truth', answer: 'partly' }),
        ev('p1', 5, 'vote', { useCase: 'project' }),
        ev('p1', 6, 'vote', { useCase: 'flows' }),
      ],
    })
    const experience = s.discussion.scales.find((sc) => sc.question === 'experience')!
    const cat = (id: string) => experience.categories.find((c) => c.id === id)!
    expect(cat('residents')).toMatchObject({ count: 2, average: 4 })
    expect(cat('staff')).toMatchObject({ count: 1, average: 2 })
    expect(s.discussion.notes.filter((n) => n.question === 'experience').map((n) => n.text)).toEqual(['Helps staff'])
    expect(s.sourceOfTruth.map((c) => [c.id, c.count])).toEqual([
      ['yes', 0],
      ['partly', 1],
      ['no', 1],
    ])
    expect(s.votes.filter((c) => c.count > 0).map((c) => [c.id, c.count])).toEqual([['flows', 1]])
  })

  it('drops a comment someone took back, and stops counting them on the question', () => {
    const agency = (ratings: Record<string, number>, note: string | null) => ({ question: 'experience', ratings, topics: [], note })
    const s = summarizeRun({
      ...DATA,
      events: [
        ev('p1', 1, 'discussion', agency({}, 'Residents get wrong amounts')),
        // The route stores a cleared note as null.
        ev('p1', 2, 'discussion', agency({}, null)),
        ev('p2', 1, 'discussion', agency({ you: 4 }, 'Staff like it')),
        ev('p2', 2, 'discussion', agency({ you: 4 }, null)),
      ],
    })
    expect(s.discussion.notes.filter((n) => n.question === 'experience')).toEqual([])
    // p2 still rated, so still counts; p1 said nothing in the end.
    expect(s.discussion.questions.find((q) => q.id === 'experience')!.count).toBe(1)
    const you = s.discussion.scales.find((sc) => sc.question === 'experience')!.categories.find((c) => c.id === 'you')!
    expect(you).toMatchObject({ count: 1, average: 4 })
  })

  it('puts an answer that looked wrong ahead of one nobody was sure of, when a resident would act on both', () => {
    const at = (m: number) => `2026-10-26T18:0${m}:00Z`
    const row = (id: string, m: number, verdict: string, extra: Partial<PromptRow> = {}) =>
      ({ ...base, id, conversation_id: id, turn: 0, created_at: at(m), prompt: 'q', answer: 'a', verdict, resident_action: 'apply', ...extra }) as PromptRow
    const s = summarizeRun({
      ...DATA,
      prompts: [
        // Newer and with a note, but only "Not sure".
        row('u', 3, 'unsure', { rating_note: 'Not sure about the asset test' }),
        row('w', 1, 'wrong'),
      ],
    })
    expect(s.spotlight.map((x) => [x.id, x.reason])).toEqual([
      ['w', 'convincing'],
      ['u', 'convincing'],
    ])
  })
})

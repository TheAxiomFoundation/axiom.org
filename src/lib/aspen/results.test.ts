import { EMPTY_SUMMARY, breakdownOf, countBy, plainText, rank, summarizeRun, summarizeScales, viabilityOf } from './results'
import type { RunData } from './types'

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
      household_id: 'az-savings',
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
      household_id: 'az-savings',
      prompt: 'Follow-up',
      answer: 'Short.',
      verdict: 'unsure',
      would_act: 'maybe',
    },
    {
      ...base,
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
    expect(s.households.find((h) => h.id === 'az-savings')?.count).toBe(1)
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
    expect(first).toMatchObject({ perspective: 'A resident', household: 'Disabled, with savings', rulesAmount: 24 })
    const unknown = feed.find((f) => f.id === 'd')!
    expect(unknown).toMatchObject({ perspective: 'stranger', household: null, createdAt: null })
  })

  it('collects discussion and small-group notes', () => {
    const { discussion, breakouts } = summarizeRun(DATA)
    expect(discussion.questions.find((q) => q.id === 'misunderstood')?.count).toBe(1)
    expect(discussion.topics[0]).toMatchObject({ id: 'Asset tests', count: 1 })
    expect(discussion.notes).toEqual([{ question: 'misunderstood', text: 'BBCE' }])
    expect(breakouts.useCases.find((u) => u.id === 'project')?.count).toBe(1)
    expect(breakouts.notes).toEqual([{ useCase: 'project', text: 'Model the change' }])
  })

  it('shows pledged states only when allowed, never names', () => {
    expect(summarizeRun(DATA).pledges).toEqual({ people: 4, states: ['Arizona'], accurateAi: 3, stateSystems: 2 })
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
      { ...base, id: '1', turn: 0, prompt: 'q', household_id: 'az-savings', perspective: 'resident', twists: ['gig'], verdict: 'wrong' },
      { ...base, id: '2', turn: 0, prompt: 'q', household_id: 'az-savings', perspective: 'caseworker', verdict: 'right' },
      { ...base, id: '3', turn: 0, prompt: 'q', household_id: null, perspective: 'resident', verdict: 'unsure' },
      { ...base, id: '4', turn: 0, prompt: 'q', household_id: 'ny-parent', perspective: 'resident' },
    ])
    expect(rows[0]).toMatchObject({ kind: 'detail', id: 'gig', label: '+ Gig income', asked: 1, rated: 1, wrong: 1 })
    expect(rows.find((r) => r.id === 'az-savings')).toMatchObject({ asked: 2, rated: 2, wrong: 1 })
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
        { ...base, id: 'w', turn: 0, created_at: '1', prompt: 'q', answer: 'a', verdict: 'wrong', would_act: 'no' },
        { ...base, id: 'c', turn: 0, created_at: '2', prompt: 'q', answer: 'a', verdict: 'wrong', would_act: 'yes', rating_note: 'Scary', twists: ['gig', 'mystery'] },
        { ...base, id: 'k', turn: 0, created_at: '3', prompt: 'q', answer: 'a', verdict: 'right', would_act: 'yes', post_check_verdict: 'wrong' },
        { ...base, id: 'u', turn: 0, created_at: '4', prompt: 'q', answer: 'a', verdict: 'unsure', would_act: 'no' },
        { ...base, id: 'r', turn: 0, created_at: '5', prompt: 'q', answer: 'a', verdict: 'right', would_act: 'yes', rating_note: 'Spot on' },
        { ...base, id: 'w2', turn: 0, created_at: '6', prompt: 'q', answer: 'a', verdict: 'wrong', would_act: 'no' },
      ],
    })
    expect(spotlight.map((s) => [s.id, s.reason])).toEqual([
      ['c', 'convincing'],
      ['k', 'checked-wrong'],
      ['w2', 'wrong'],
      ['w', 'wrong'],
    ])
    expect(spotlight[0]).toMatchObject({ note: 'Scary', wouldAct: 'yes', details: ['Gig income', 'mystery'] })
    expect(voices).toEqual([
      { text: 'Spot on', verdict: 'right' },
      { text: 'Scary', verdict: 'wrong' },
    ])
  })

  it('adds the notes from Rate it to the room\'s own words', () => {
    const { voices, discussion } = summarizeRun({
      ...DATA,
      prompts: [{ ...base, id: 'a', turn: 0, created_at: '2026-10-26T18:00:00Z', prompt: 'q', answer: 'a', verdict: 'wrong', rating_note: 'Wrong amount' }],
      events: [
        { run_id: 'r', kind: 'discussion', stage: 'rate', created_at: '2026-10-26T18:10:00Z', payload: { question: null, note: 'Staff use it already' } },
        { run_id: 'r', kind: 'discussion', stage: 'reveal', created_at: '2026-10-26T18:20:00Z', payload: { question: 'performance', note: 'Discussion note' } },
        { run_id: 'r', kind: 'discussion', stage: 'rate', created_at: '2026-10-26T18:30:00Z', payload: { question: 'performance', ratings: { amount: 2 } } },
      ],
    })
    expect(voices).toEqual([
      { text: 'Staff use it already', verdict: null },
      { text: 'Wrong amount', verdict: 'wrong' },
    ])
    // A Rate it note shows once, in the room's own words, not again among the discussion notes.
    expect(discussion.notes).toEqual([{ question: 'performance', text: 'Discussion note' }])
  })

  it('has an empty summary', () => {
    expect(EMPTY_SUMMARY).toMatchObject({ participants: 0, prompts: 0, feed: [] })
  })
})

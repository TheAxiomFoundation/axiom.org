import { AZ_SAVINGS_TEXT, azSavingsStream } from '@/test/rules-az-savings'
import { askRules, parseDataStream, summarizeRules } from './rules'

const line = (code: string, value: unknown) => `${code}:${JSON.stringify(value)}`

const COMPUTE = {
  program: 'us-az-snap',
  display_name: 'Arizona SNAP',
  period: '2026-10',
  primary_output: 'snap_benefit',
  outputs: [
    { name: 'snap_eligible', label: 'Snap eligible', value: 'holds', unit: null, acknowledged_incomplete: false, legal_id: 'us-az:policies/x#snap_eligible' },
    { name: 'snap_benefit', label: 'Snap benefit', value: 24, unit: 'USD', acknowledged_incomplete: false, legal_id: 'us:policies/y#snap_benefit' },
    { name: 'snap_other', value: 1, acknowledged_incomplete: true },
    'garbage',
  ],
}

const STREAM = [
  line('f', { messageId: 'm1' }),
  line('9', { toolCallId: 'c1', toolName: 'compute', args: { program: 'us-az-snap' } }),
  line('a', { toolCallId: 'c1', result: COMPUTE }),
  line('9', { toolCallId: 'c2', toolName: 'compute', args: {} }),
  line('a', { toolCallId: 'c2', result: { error: 'unknown fact' } }),
  line('9', { toolCallId: 'c3', toolName: 'describe_program', args: {} }),
  line('a', { toolCallId: 'c3', result: { program: 'x' } }),
  line('a', { toolCallId: 'orphan', result: 1 }),
  line('0', '**Estimated Arizona SNAP: '),
  line('0', '$24/month.**'),
  line('3', 'late warning'),
  'not a line',
  '0:{broken',
  line('9', { toolName: 'compute' }),
  '',
].join('\n')

describe('rules chatbot stream', () => {
  it('parses text, tool calls, results and errors', () => {
    const parsed = parseDataStream(STREAM)
    expect(parsed.text).toBe('**Estimated Arizona SNAP: $24/month.**')
    expect(parsed.toolCalls.map((c) => c.toolName)).toEqual(['compute', 'compute', 'describe_program'])
    expect(parsed.toolResults.map((r) => r.toolName)).toEqual(['compute', 'compute', 'describe_program', 'unknown'])
    expect(parsed.errors).toEqual(['late warning'])
  })

  it('summarizes the computation the answer used', () => {
    const rules = summarizeRules(parseDataStream(STREAM))
    expect(rules.amount).toBe(24)
    expect(rules.program).toBe('Arizona SNAP')
    expect(rules.period).toBe('2026-10')
    expect(rules.computations[0].primary?.name).toBe('snap_benefit')
    expect(rules.computations[0].outputs).toHaveLength(3)
    expect(rules.incomplete).toEqual(['snap_other'])
    expect(rules.citations).toEqual(['us-az:policies/x#snap_eligible', 'us:policies/y#snap_benefit'])
    expect(rules.errors).toEqual(['late warning', 'unknown fact'])
  })

  it('handles answers without a calculation or a dollar output', () => {
    expect(summarizeRules(parseDataStream(line('0', 'Not encoded yet.')))).toMatchObject({
      text: 'Not encoded yet.',
      computations: [],
      amount: null,
      program: null,
      period: null,
    })
    const judgment = summarizeRules({
      text: '',
      toolCalls: [],
      toolResults: [
        {
          toolCallId: 'x',
          toolName: 'compute',
          result: { program: 'p', outputs: [{ name: 'eligible', value: 'holds' }] },
        },
        { toolCallId: 'y', toolName: 'compute', result: null },
        { toolCallId: 'z', toolName: 'compute', result: { program: 'p' } },
      ],
      errors: [],
    })
    expect(judgment.amount).toBeNull()
    expect(judgment.program).toBe('p')
    expect(judgment.computations[0].primary?.name).toBe('eligible')
    expect(judgment.period).toBeNull()
  })

  it('keeps what each output is, and the limits the chatbot attached', () => {
    const rules = summarizeRules({
      text: '',
      toolCalls: [],
      toolResults: [
        {
          toolCallId: 'x',
          toolName: 'compute',
          result: {
            program: 'us-ny-snap',
            period: '2026-03',
            outputs: [
              { name: 'snap_benefit', value: 100, unit: 'USD', semantics: 'scalar', published_output: true },
              { name: 'snap_net_income_test', value: 'holds', semantics: 'judgment', published_output: false },
              { name: 'snap_eligible', value: 'holds' },
            ],
            applied: { disclosures: ['Note A', 'Note A', 7, null, 'SNAP figures use FY2026 standards; later ones are not encoded yet.'] },
            citations: [{ id: 'us:policies/usda/snap/fy-2026-cola/deductions' }, { id: 3 }, null, 'junk'],
          },
        },
        {
          toolCallId: 'y',
          toolName: 'compute',
          result: { program: 'p', outputs: [], applied: 'junk', citations: 'junk' },
        },
      ],
      errors: [],
    })
    const [ny, p] = rules.computations
    expect(ny.outputs.map((o) => [o.name, o.semantics, o.published])).toEqual([
      ['snap_benefit', 'scalar', true],
      ['snap_net_income_test', 'judgment', false],
      ['snap_eligible', null, true],
    ])
    expect(ny.disclosures).toEqual(['Note A', 'SNAP figures use FY2026 standards; later ones are not encoded yet.'])
    expect(ny.standardsYears).toEqual([2026])
    expect(p.disclosures).toEqual([])
    expect(p.standardsYears).toEqual([])
  })

  it('summarizes the recorded Arizona answer: $24, eligibility untested, FY2026 standards', () => {
    const rules = summarizeRules(parseDataStream(azSavingsStream()))
    expect(rules.text).toBe(AZ_SAVINGS_TEXT)
    expect(rules).toMatchObject({ amount: 24, program: 'Arizona SNAP', period: '2026-10', incomplete: [], errors: [] })
    const [az] = rules.computations
    expect(az.program).toBe('us-az-snap')
    expect(az.outputs.find((o) => o.name === 'snap_eligible')).toMatchObject({
      value: 'holds',
      semantics: 'judgment',
      published: true,
      incomplete: false,
    })
    expect(az.outputs.find((o) => o.name === 'snap_maximum_allotment')).toMatchObject({ value: 298, published: false })
    expect(az.disclosures).toEqual([
      "Axiom's Arizona SNAP encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".",
      'SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet.',
    ])
    expect(az.standardsYears).toEqual([2026])
  })

  it('asks the gallery chatbot with only the participant’s turns', async () => {
    const fetchImpl = vi.fn(async () => new Response(STREAM)) as unknown as typeof fetch
    const rules = await askRules(
      [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
      ],
      { fetchImpl },
    )
    expect(rules.amount).toBe(24)
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toMatch(/\/api\/chat$/)
    expect(JSON.parse(init.body).messages).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'user', content: 'Q2' },
    ])
    const failing = vi.fn(async () => new Response('down', { status: 500 })) as unknown as typeof fetch
    await expect(askRules([{ role: 'user', content: 'Q' }], { fetchImpl: failing })).rejects.toThrow('rules chatbot 500: down')
  })
})

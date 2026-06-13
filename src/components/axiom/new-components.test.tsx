import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock useEncoding
const { mockUseEncoding } = vi.hoisted(() => ({
  mockUseEncoding: vi.fn().mockReturnValue({
    encoding: null,
    sessionEvents: [],
    agentTranscripts: [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/use-encoding', () => ({
  useEncoding: mockUseEncoding,
}))

// RuleDetailPanel now renders a SiblingStrip that uses useRouter and
// a Supabase-backed getSiblings call; stub both so the panel renders
// in isolation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/axiom/resolver', () => ({
  getSiblings: vi.fn().mockResolvedValue([]),
}))

import { SourceTab } from './source-tab'
import { RuleSpecTab } from './rulespec-tab'
import { AgentLogsTab } from './agent-logs-tab'
import { RuleDetailPanel } from './rule-detail-panel'
import type { ViewerDocument } from '@/lib/axiom-utils'
import type { Rule, RuleEncodingData, SDKSessionEvent, AgentTranscript } from '@/lib/supabase'

function makeDoc(overrides: Partial<ViewerDocument> = {}): ViewerDocument {
  return {
    citation: '26 USC 1',
    title: 'Tax imposed',
    subsections: [
      { id: 'a', text: 'There is hereby imposed a tax.' },
      { id: 'b', text: 'The amount of tax shall be determined.' },
    ],
    hasRuleSpec: true,
    jurisdiction: 'us',
    sourcePath: 'statute/26/1.json',
    ...overrides,
  }
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    jurisdiction: 'us',
    doc_type: 'statute',
    parent_id: null,
    level: 0,
    ordinal: 1,
    heading: 'Tax imposed',
    body: null,
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: 'statute/26/1',
    citation_path: 'us/statute/26/1',
    rulespec_path: null,
    has_rulespec: true,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  }
}

function makeEncoding(overrides: Partial<RuleEncodingData> = {}): RuleEncodingData {
  return {
    encoding_run_id: 'enc-1',
    citation: '26 USC 1',
    session_id: 'sess-1',
    file_path: 'statute/26/1.yaml',
    rulespec_content: 'rule tax_imposed { ... }',
    final_scores: { rulespec: 90, formula: 85, parameter: 80, integration: 75 },
    iterations: null,
    total_duration_ms: null,
    agent_type: null,
    agent_model: null,
    data_source: null,
    has_issues: null,
    note: null,
    timestamp: null,
    encoder_version: null,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<SDKSessionEvent> = {}): SDKSessionEvent {
  return {
    id: 'evt-1',
    session_id: 'sess-1',
    sequence: 1,
    timestamp: '2025-01-01T10:00:00Z',
    event_type: 'agent_start',
    tool_name: null,
    content: 'Start encoding',
    metadata: null,
    ...overrides,
  }
}

function makeTranscript(overrides: Partial<AgentTranscript> = {}): AgentTranscript {
  return {
    id: 1,
    session_id: 'sess-1',
    agent_id: 'agent-1',
    tool_use_id: 'tu-1',
    subagent_type: 'rules-engineer',
    prompt: 'Encode 26 USC 32(b)',
    description: 'Encoding subsection b',
    response_summary: 'Successfully encoded the subsection',
    transcript: null,
    orchestrator_thinking: 'Need to handle the credit percentages',
    message_count: 12,
    created_at: '2025-01-01T10:00:00Z',
    uploaded_at: null,
    ...overrides,
  }
}

describe('SourceTab', () => {
  it('renders subsections with IDs', () => {
    render(<SourceTab document={makeDoc()} />)
    expect(screen.getByText('(a)')).toBeInTheDocument()
    expect(screen.getByText('(b)')).toBeInTheDocument()
    expect(screen.getByText('There is hereby imposed a tax.')).toBeInTheDocument()
  })

  it('renders sourcePath when present', () => {
    render(<SourceTab document={makeDoc()} />)
    expect(screen.getByText('statute/26/1.json')).toBeInTheDocument()
  })

  it('does not render source section when sourcePath is null', () => {
    render(<SourceTab document={makeDoc({ sourcePath: null })} />)
    expect(screen.queryByText('Source:')).not.toBeInTheDocument()
  })

  it('lights up the subsection label on hover', () => {
    // In the reader layout the hover affordance is a subtle colour shift
    // on the ``(a)`` label, not a background fill on the whole block —
    // background tints disrupt long-form reading.
    render(<SourceTab document={makeDoc()} />)
    const subsection = screen
      .getByText('There is hereby imposed a tax.')
      .closest('[data-subsection-id]') as HTMLElement
    const label = subsection.querySelector('span[aria-hidden="true"]')!
    expect(label).toHaveClass('text-[var(--color-ink-muted)]')
    fireEvent.mouseEnter(subsection)
    expect(label).toHaveClass('text-[var(--color-accent)]')
    fireEvent.mouseLeave(subsection)
    expect(label).toHaveClass('text-[var(--color-ink-muted)]')
  })
})

describe('RuleSpecTab', () => {
  it('shows loading state', () => {
    render(<RuleSpecTab encoding={null} loading={true} jurisdiction="us" />)
    expect(screen.getByText('Loading encoding data...')).toBeInTheDocument()
  })

  it('shows empty state when no encoding', () => {
    render(<RuleSpecTab encoding={null} loading={false} jurisdiction="us" />)
    expect(screen.getByText('Not yet encoded')).toBeInTheDocument()
    expect(screen.getByText('This rule has not been encoded into RuleSpec format yet.')).toBeInTheDocument()
  })

  it('falls back to raw YAML when content does not parse as RuleSpec', () => {
    render(
      <RuleSpecTab
        encoding={makeEncoding()}
        loading={false}
        jurisdiction="us"
      />
    )
    // The fixture's rulespec_content is not valid RuleSpec, so the raw
    // block renders instead of structured cards.
    expect(screen.getByText('RuleSpec encoding')).toBeInTheDocument()
    expect(screen.getByText(/Encoded in/)).toBeInTheDocument()
  })

  it('renders module summary plus one card per rule with the YAML and source link', () => {
    const content = `format: rulespec/v1
module:
  summary: |-
    Internal Revenue Code §3101(a) imposes a payroll tax.
rules:
  - name: oasdi_wage_tax_rate
    kind: parameter
    dtype: Rate
    versions:
      - effective_from: '1990-01-01'
        formula: '0.062'
  - name: oasdi_wage_tax
    kind: derived
    entity: TaxUnit
    dtype: Money
    period: Year
    unit: USD
    source: 26 USC 3101(a)
    source_url: https://www.law.cornell.edu/uscode/text/26/3101
    versions:
      - effective_from: '1990-01-01'
        formula: wages * oasdi_wage_tax_rate
`
    const { container } = render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: content, final_scores: null })}
        loading={false}
        jurisdiction="us"
      />
    )
    // The per-rule raw YAML sits behind a small toggle — open them.
    container
      .querySelectorAll<HTMLButtonElement>(
        'article[id^="rule-"] button[aria-expanded="false"]'
      )
      .forEach((btn) => {
        if (btn.textContent?.includes('YAML')) fireEvent.click(btn)
      })
    expect(
      screen.getByText(/imposes a payroll tax/i)
    ).toBeInTheDocument()
    // Both rule names are present as headings.
    expect(screen.getByRole('heading', { name: 'oasdi_wage_tax_rate' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'oasdi_wage_tax' })).toBeInTheDocument()
    // The full YAML round-trips through dump and lands in the rendered code.
    expect(container.textContent).toContain('wages * oasdi_wage_tax_rate')
    expect(container.textContent).toContain("formula: '0.062'")
    // Source citation renders as a link when source_url is present.
    expect(screen.getByText('26 USC 3101(a)').closest('a')).toHaveAttribute(
      'href',
      'https://www.law.cornell.edu/uscode/text/26/3101'
    )
  })

  it('shows GitHub link and hides scores for GitHub-sourced encoding', () => {
    render(
      <RuleSpecTab
        encoding={makeEncoding({
          encoding_run_id: 'github:us/statute/26/32/b.yaml',
          file_path: 'statutes/26/32/b.yaml',
          final_scores: { rulespec: 90, formula: 85, parameter: 80, integration: 75 },
        })}
        loading={false}
        jurisdiction="us"
      />
    )
    expect(screen.getByText('view on GitHub')).toBeInTheDocument()
    expect(screen.queryByText('90')).not.toBeInTheDocument()
  })

  it('shows scores for non-GitHub encoding', () => {
    render(
      <RuleSpecTab
        encoding={makeEncoding({
          encoding_run_id: 'enc-1',
          final_scores: { rulespec: 90, formula: 85, parameter: 80, integration: 75 },
        })}
        loading={false}
        jurisdiction="us"
      />
    )
    expect(screen.queryByText('View on GitHub')).not.toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument()
  })

  it('renders the canonical repo link for UK encodings', () => {
    render(
      <RuleSpecTab
        encoding={makeEncoding({
          file_path: 'legislation/uksi/2013/376/regulation/36/3/single-under-25.yaml',
        })}
        loading={false}
        jurisdiction="uk"
      />
    )
    const link = screen.getByText('view canonical repo file').closest('a')
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/TheAxiomFoundation/rulespec-uk/blob/main/legislation/uksi/2013/376/regulation/36/3/single-under-25.yaml'
    )
  })
})

describe('AgentLogsTab', () => {
  it('shows loading state', () => {
    render(<AgentLogsTab sessionEvents={[]} loading={true} sessionId="sess-1" />)
    expect(screen.getByText('Loading agent logs...')).toBeInTheDocument()
  })

  it('shows empty state when no sessionId', () => {
    render(<AgentLogsTab sessionEvents={[]} loading={false} sessionId={null} />)
    expect(screen.getByText('No sessions')).toBeInTheDocument()
    expect(screen.getByText('No agent sessions are linked to this rule.')).toBeInTheDocument()
  })

  it('shows empty state when sessionEvents is empty', () => {
    render(<AgentLogsTab sessionEvents={[]} loading={false} sessionId="sess-1" />)
    expect(screen.getByText('No sessions')).toBeInTheDocument()
  })

  it('renders agent phases and event timeline section headers', () => {
    const events = [
      makeEvent({ id: 'e1', sequence: 1, event_type: 'agent_start' }),
      makeEvent({ id: 'e2', sequence: 2, event_type: 'tool_use', tool_name: 'Read' }),
      makeEvent({ id: 'e3', sequence: 3, event_type: 'agent_end' }),
    ]
    render(<AgentLogsTab sessionEvents={events} loading={false} sessionId="sess-1" />)
    expect(screen.getByText('Agent phases (1)')).toBeInTheDocument()
    expect(screen.getByText('Event timeline (3)')).toBeInTheDocument()
  })

  it('shows "No agent phases found" when expanding phases with no agent_start', () => {
    const events = [
      makeEvent({ id: 'e1', sequence: 1, event_type: 'tool_use' }),
    ]
    render(<AgentLogsTab sessionEvents={events} loading={false} sessionId="sess-1" />)
    // Expand the agent phases section
    fireEvent.click(screen.getByText('Agent phases (0)').closest('button')!)
    expect(screen.getByText(/No agent phases found/)).toBeInTheDocument()
  })

  it('shows "Show more" when expanding event timeline with many events', () => {
    const events = Array.from({ length: 60 }, (_, i) =>
      makeEvent({ id: `e${i}`, sequence: i + 1, event_type: 'tool_use' })
    )
    render(<AgentLogsTab sessionEvents={events} loading={false} sessionId="sess-1" />)
    // Expand event timeline
    fireEvent.click(screen.getByText('Event timeline (60)').closest('button')!)
    expect(screen.getByText(/Show more/)).toBeInTheDocument()
    expect(screen.getByText(/10 remaining/)).toBeInTheDocument()
  })

  it('loads more events when "Show more" is clicked', () => {
    const events = Array.from({ length: 60 }, (_, i) =>
      makeEvent({ id: `e${i}`, sequence: i + 1, event_type: 'tool_use' })
    )
    render(<AgentLogsTab sessionEvents={events} loading={false} sessionId="sess-1" />)
    // Expand event timeline
    fireEvent.click(screen.getByText('Event timeline (60)').closest('button')!)
    fireEvent.click(screen.getByText(/Show more/))
    expect(screen.queryByText(/remaining/)).not.toBeInTheDocument()
  })

  it('shows encoding run summary when encoding has encoding-run metadata', () => {
    const encoding = makeEncoding({
      agent_type: 'encoder-v2',
      agent_model: 'claude-sonnet-4',
      total_duration_ms: 125000,
      data_source: 'reviewer_agent',
      has_issues: false,
      timestamp: '2025-06-15T12:00:00Z',
    })
    render(<AgentLogsTab sessionEvents={[]} encoding={encoding} loading={false} sessionId={null} />)
    // Encoding run section is open by default
    expect(screen.getByText('encoder-v2')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument()
    expect(screen.getByText('2m 5s')).toBeInTheDocument()
    expect(screen.getByText('reviewer agent')).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('shows encoding run note when present', () => {
    const encoding = makeEncoding({
      agent_type: 'encoder-v2',
      note: 'Manual review needed for edge cases',
    })
    render(<AgentLogsTab sessionEvents={[]} encoding={encoding} loading={false} sessionId={null} />)
    expect(screen.getByText('Manual review needed for edge cases')).toBeInTheDocument()
  })

  it('shows iterations when expanding the section', () => {
    const encoding = makeEncoding({
      agent_type: 'encoder-v2',
      iterations: [
        { attempt: 1, success: false, duration_ms: 30000, errors: [{ type: 'ValidationError', message: 'Missing parameter' }] },
        { attempt: 2, success: true, duration_ms: 45000, errors: [] },
      ],
    })
    render(<AgentLogsTab sessionEvents={[]} encoding={encoding} loading={false} sessionId={null} />)
    // Expand iterations section
    fireEvent.click(screen.getByText('Iterations (2)').closest('button')!)
    expect(screen.getByText('Attempt 1')).toBeInTheDocument()
    expect(screen.getByText('Fail')).toBeInTheDocument()
    expect(screen.getByText('ValidationError:')).toBeInTheDocument()
    expect(screen.getByText(/Missing parameter/)).toBeInTheDocument()
    expect(screen.getByText('Attempt 2')).toBeInTheDocument()
    expect(screen.getByText('Pass')).toBeInTheDocument()
  })

  it('shows agent transcripts when expanding the section', () => {
    const transcripts = [makeTranscript()]
    render(<AgentLogsTab sessionEvents={[makeEvent()]} agentTranscripts={transcripts} loading={false} sessionId="sess-1" />)
    // Expand transcripts section
    fireEvent.click(screen.getByText('Agent transcripts (1)').closest('button')!)
    expect(screen.getByText('rules-engineer')).toBeInTheDocument()
    expect(screen.getByText('12 messages')).toBeInTheDocument()
    expect(screen.getByText('Successfully encoded the subsection')).toBeInTheDocument()
  })

  it('expands transcript card to show prompt and response', () => {
    const transcripts = [makeTranscript()]
    render(<AgentLogsTab sessionEvents={[makeEvent()]} agentTranscripts={transcripts} loading={false} sessionId="sess-1" />)
    // Expand transcripts section
    fireEvent.click(screen.getByText('Agent transcripts (1)').closest('button')!)
    // Expand the transcript card
    fireEvent.click(screen.getByText('rules-engineer').closest('[class*="cursor-pointer"]')!)
    expect(screen.getByText('Encode 26 USC 32(b)')).toBeInTheDocument()
    expect(screen.getByText('Need to handle the credit percentages')).toBeInTheDocument()
  })

  it('renders provenance events in a dedicated section', () => {
    const events = [
      makeEvent({ id: 'e1', sequence: 1, event_type: 'agent_start', content: 'Start encoding' }),
      makeEvent({
        id: 'e2',
        sequence: 2,
        event_type: 'provenance_reasoning',
        content: 'Need to reconcile subsection (a) with section 151 usage.',
        metadata: { phase: 'encoding', provider: 'openai' },
      }),
      makeEvent({
        id: 'e3',
        sequence: 3,
        event_type: 'provenance_artifact',
        content: 'Artifact provenance for us/statute/26/24/a.yaml',
        metadata: { phase: 'encoding' },
      }),
      makeEvent({
        id: 'e4',
        sequence: 4,
        event_type: 'provenance_sidecar',
        content: 'Provider sidecar trace for encoder',
        metadata: { backend: 'cli' },
      }),
    ]

    render(<AgentLogsTab sessionEvents={events} loading={false} sessionId="sess-1" />)

    expect(screen.getByText('Provenance (3)')).toBeInTheDocument()
    expect(screen.getByText('reasoning')).toBeInTheDocument()
    expect(screen.getByText('artifact')).toBeInTheDocument()
    expect(screen.getByText('sidecar')).toBeInTheDocument()
    expect(screen.getByText('Need to reconcile subsection (a) with section 151 usage.')).toBeInTheDocument()
    expect(screen.getByText('Artifact provenance for us/statute/26/24/a.yaml')).toBeInTheDocument()
    expect(screen.getByText('Provider sidecar trace for encoder')).toBeInTheDocument()
  })

  it('shows "No sessions" for GitHub-sourced encoding with no events', () => {
    const encoding = makeEncoding({ encoding_run_id: 'github:us/statute/26/32/b.yaml' })
    render(<AgentLogsTab sessionEvents={[]} encoding={encoding} loading={false} sessionId={null} />)
    expect(screen.getByText('No sessions')).toBeInTheDocument()
  })

  it('toggles event expansion in timeline', () => {
    const events = [
      makeEvent({ id: 'e1', sequence: 1, event_type: 'agent_start', content: 'Hello world content' }),
    ]
    render(<AgentLogsTab sessionEvents={events} loading={false} sessionId="sess-1" />)
    // Expand event timeline section
    fireEvent.click(screen.getByText('Event timeline (1)').closest('button')!)
    const eventRows = screen.getAllByText('#1')
    const timelineRow = eventRows[eventRows.length - 1].closest('[class*="cursor-pointer"]')!
    fireEvent.click(timelineRow)
    expect(screen.getAllByText('Hello world content').length).toBeGreaterThanOrEqual(1)
  })
})

describe('RuleDetailPanel', () => {
  beforeEach(() => {
    mockUseEncoding.mockReturnValue({
      encoding: null,
      sessionEvents: [],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
  })

  it('renders citation and jurisdiction', () => {
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText('US')).toBeInTheDocument()
  })

  it('renders UK jurisdiction', () => {
    render(
      <RuleDetailPanel
        document={makeDoc({ jurisdiction: 'uk' })}
        rule={makeRule({ jurisdiction: 'uk' })}
      />
    )
    expect(screen.getByText('UK')).toBeInTheDocument()
  })

  it('renders Canada jurisdiction', () => {
    render(
      <RuleDetailPanel
        document={makeDoc({ jurisdiction: 'canada' })}
        rule={makeRule({ jurisdiction: 'canada' })}
      />
    )
    expect(screen.getByText('CA')).toBeInTheDocument()
  })

  it('renders state jurisdiction from us- prefix', () => {
    render(
      <RuleDetailPanel
        document={makeDoc({ jurisdiction: 'us-ny' })}
        rule={makeRule({ jurisdiction: 'us-ny' })}
      />
    )
    expect(screen.getByText('NY')).toBeInTheDocument()
  })

  it('humanises slug citations and suppresses the redundant subtitle', () => {
    const path = 'uk/policy/govuk/disability-living-allowance'
    render(
      <RuleDetailPanel
        document={makeDoc({
          citation: path,
          citationPath: path,
          jurisdiction: 'uk',
          title: 'Disability living allowance for children…',
          body: 'Disability living allowance for children as described by GOV.UK guidance.',
          subsections: [],
        })}
        rule={makeRule({
          jurisdiction: 'uk',
          doc_type: 'policy',
          citation_path: path,
          body: 'Disability living allowance for children as described by GOV.UK guidance.',
        })}
      />
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Disability living allowance'
    )
    expect(screen.getByText(path)).toBeInTheDocument()
    expect(screen.getByText('Policy')).toBeInTheDocument()
    expect(
      screen.queryByText('Disability living allowance for children…')
    ).not.toBeInTheDocument()
  })

  it('shows source and encoding side by side', () => {
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText('Encoding')).toBeInTheDocument()
    expect(screen.getByText('There is hereby imposed a tax.')).toBeInTheDocument()
    expect(screen.getByText('Not yet encoded')).toBeInTheDocument()
  })

  it('shows encoding content when available', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding(),
      sessionEvents: [],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText((_content, el) => el?.tagName === 'CODE' && el.textContent === 'rule tax_imposed { ... }')).toBeInTheDocument()
  })

  it('shows back button when onBack is provided', () => {
    const onBack = vi.fn()
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} onBack={onBack} />)
    const backBtn = screen.getByLabelText('Back to browser')
    fireEvent.click(backBtn)
    expect(onBack).toHaveBeenCalled()
  })

  it('does not show back button when onBack is not provided', () => {
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.queryByLabelText('Back to browser')).not.toBeInTheDocument()
  })

  it('shows agent logs drawer when session events exist', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding(),
      sessionEvents: [makeEvent()],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText('Agent logs')).toBeInTheDocument()
    expect(screen.getByText('(1 events)')).toBeInTheDocument()
  })

  it('shows encoder version in agent logs drawer', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding({ encoder_version: '0.4.2' }),
      sessionEvents: [makeEvent()],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText('encoder 0.4.2')).toBeInTheDocument()
  })

  it('does not show encoder version when not present', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding({ encoder_version: null }),
      sessionEvents: [makeEvent()],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.queryByText(/encoder /)).not.toBeInTheDocument()
  })

  it('toggles agent logs drawer open and closed', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding(),
      sessionEvents: [makeEvent()],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)

    // Initially closed — collapsed arrow on the drawer button
    const drawerBtn = screen.getByText('Agent logs').closest('button')!
    expect(drawerBtn.textContent).toContain('\u25B6')

    // Open drawer
    fireEvent.click(drawerBtn)
    expect(drawerBtn.textContent).toContain('\u25BC')

    // Close drawer
    fireEvent.click(drawerBtn)
    expect(drawerBtn.textContent).toContain('\u25B6')
  })

  it('shows agent logs drawer when encoding has encoding-run data but no session events', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding({ agent_type: 'encoder-v2', session_id: null }),
      sessionEvents: [],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText('Agent logs')).toBeInTheDocument()
  })

  it('does not show agent logs drawer when no events and not loading', () => {
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.queryByText('Agent logs')).not.toBeInTheDocument()
  })

  it('shows agent logs drawer when encoding is from DB (hasEncodingRunData) even with no events', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding({ session_id: 'sdk-123' }),
      sessionEvents: [],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText('Agent logs')).toBeInTheDocument()
  })

  it('does not show agent logs drawer when encoding is from GitHub fallback', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding({ encoding_run_id: 'github:statute/26/1.yaml', session_id: null }),
      sessionEvents: [],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.queryByText('Agent logs')).not.toBeInTheDocument()
  })

  it('shows agent logs drawer when loading', () => {
    mockUseEncoding.mockReturnValue({
      encoding: null,
      sessionEvents: [],
      agentTranscripts: [],
      loading: true,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText('Agent logs')).toBeInTheDocument()
  })

  it('shows meta strip with subsection count', () => {
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText(/2 subsections/)).toBeInTheDocument()
  })

  it('marks repealed provisions without source text as repealed', () => {
    render(
      <RuleDetailPanel
        document={makeDoc({
          body: undefined,
          hasRuleSpec: false,
          isRepealed: true,
          subsections: [],
        })}
        rule={makeRule({ has_rulespec: false, repeal_date: '2010-01-01' })}
      />
    )
    expect(screen.getAllByText('Repealed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Repealed provision').length).toBeGreaterThan(0)
    expect(screen.getByText(/No current source text/i)).toBeInTheDocument()
  })

  it('shows RuleSpec available in status bar when encoding exists', () => {
    mockUseEncoding.mockReturnValue({
      encoding: makeEncoding(),
      sessionEvents: [],
      agentTranscripts: [],
      loading: false,
      error: null,
    })
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(screen.getByText('2 subsections | RuleSpec available')).toBeInTheDocument()
  })

  it('fetches encoding data immediately', () => {
    render(<RuleDetailPanel document={makeDoc()} rule={makeRule()} />)
    expect(mockUseEncoding).toHaveBeenCalledWith('rule-1')
  })
})

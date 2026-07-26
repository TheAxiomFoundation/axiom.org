import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

import { Hero } from '@/components/landing/hero'
import { TheGapSection } from '@/components/landing/the-gap-section'
import { EncodedLawSection } from '@/components/landing/encoded-law-section'
import { EncoderSection } from '@/components/landing/encoder-section'
import { ApplicationsSection } from '@/components/landing/applications-section'
import { FoundationSection } from '@/components/landing/foundation-section'

describe('Landing sections', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the hero with the tagline', () => {
    render(<Hero />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /computable law for all/i,
    )
  })

  it('renders the gap section with problem framing', () => {
    render(<TheGapSection />)
    expect(
      screen.getByRole('heading', { name: /law for the digital era/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/each system reimplements the law/i)).toBeInTheDocument()
    expect(screen.getByText(/AI needs ground truth/i)).toBeInTheDocument()
  })

  it('renders both layers and the worked example', () => {
    render(<EncodedLawSection />)
    expect(
      screen.getByRole('heading', { name: /two layers, both in the open/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /the primary text, gathered/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /encoded so anyone can compute them/i }),
    ).toBeInTheDocument()
    // Round 1 pull-back: the PTC worked example is hidden until the
    // Jul 28 reveal (SHOW_WORKED_EXAMPLE in encoded-law-section).
    expect(
      screen.queryByRole('heading', { name: /aca premium tax credit, three eras/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the encoder section with terminal + steps', () => {
    render(<EncoderSection />)
    expect(
      screen.getByRole('heading', { name: /encoded automatically/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/axiom-encode encode "26 USC 32\(c\)\(2\)" --apply/i),
    ).toBeInTheDocument()
    for (const step of ['Read', 'Encode', 'Verify']) {
      expect(screen.getByRole('heading', { name: step })).toBeInTheDocument()
    }
  })

  // The encoding pipeline has no human review gate. Its gates are
  // deterministic checks, independent oracle cross-checks, and AI judges.
  // Claiming a human approver is comfort language for a step that does not
  // exist, and it has reached copy twice now — so it fails the build.
  it('claims no human review gate in the encoder section', () => {
    const { container } = render(<EncoderSection />)
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/signs? off/i)
    expect(text).not.toMatch(/human (sign|review|oversight|approv)/i)
    expect(text).not.toMatch(/human-in-the-loop/i)
    expect(text).not.toMatch(/experts? (verify|review|check)/i)
  })

  // Regression guard for issue #137. The transcript previously asserted a run
  // that never happened: a fabricated `axiom` binary, dependency "waves" the
  // pipeline has no notion of, and 14/14 oracle results against a path holding
  // two rule files. Anything on this list is a claim we cannot substantiate,
  // so failing loudly beats shipping it again.
  it('makes no unsubstantiated claims in the encoder transcript', () => {
    render(<EncoderSection />)
    // Scoped to the transcript: the surrounding prose may legitimately name
    // TAXSIM as an oracle Axiom compares against. What it may not do is
    // report TAXSIM results for a statute no committed suite covers.
    const text = screen.getByTestId('encoder-terminal').textContent ?? ''

    // The binary is `axiom-encode`; `axiom encode` does not exist.
    expect(text).not.toMatch(/(?<!-)\baxiom encode\b/i)
    // `encode` takes one citation. There is no wave orchestration.
    expect(text).not.toMatch(/wave/i)
    // 26 USC 32 has two encoded rule files on rulespec-us main, not fourteen.
    expect(text).not.toMatch(/14\/14|14 subsections|14 RuleSpec/i)
    // No committed TAXSIM conformance artifact covers 26 USC 32.
    expect(text).not.toMatch(/TAXSIM/i)
  })

  it('attributes the oracle record to its suite, not to this encode run', () => {
    render(<EncoderSection />)
    const text = screen.getByTestId('encoder-terminal').textContent ?? ''

    // The figure is the fiit-ecps suite total, shared across the 12 policies
    // that suite covers. Presenting it as an EITC-only or run-specific
    // measurement would misstate what was compared.
    expect(text).toMatch(/3,881,635/)
    expect(text).toMatch(/standing oracle record/i)
    expect(text).toMatch(/fiit-ecps/i)
    expect(text).toMatch(/12 policies/i)
  })

  it('renders the applications section with four use cases', () => {
    render(<ApplicationsSection />)
    expect(
      screen.getByRole('heading', { name: /one encoding\. many places/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /calculators that audit themselves/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /ground truth for AI/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /reform without rewriting/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /government in plain sight/i }),
    ).toBeInTheDocument()
  })

  it('renders the foundation coda with public-interest framing', () => {
    render(<FoundationSection />)
    expect(screen.getByRole('heading', { name: /doing the public-interest work/i })).toBeInTheDocument()
    expect(screen.getByText(/everything we publish/i)).toBeInTheDocument()
    // The fiscal-sponsorship line was removed (Jul 14).
    expect(screen.queryByText(/fiscally sponsored/i)).not.toBeInTheDocument()
    // Contributor/GitHub asks are pulled back in Round 1 — only hello@ + internal links remain.
    expect(screen.getByText(/get in touch/i)).toBeInTheDocument()
    expect(screen.getByText(/meet the team/i)).toBeInTheDocument()
  })
})


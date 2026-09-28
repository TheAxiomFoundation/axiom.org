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

  it('renders both layers (worked example removed)', () => {
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
    expect(
      screen.queryByRole('heading', { name: /aca premium tax credit/i }),
    ).toBeNull()
  })

  it('renders the encoder section with the journey film', () => {
    render(<EncoderSection />)
    expect(
      screen.getByRole('heading', { name: /statutes encoded and verified/i }),
    ).toBeInTheDocument()
    // The terminal animation gave way to the journey film (scroll-
    // scrubbed on wide viewports, self-running elsewhere).
    expect(screen.queryByText(/axiom encode/i)).not.toBeInTheDocument()
    // The journey opens on the reading-room act (the film crossfades
    // in after it).
    expect(
      screen.getByRole('img', { name: /a law library: five bays/i }),
    ).toBeInTheDocument()
    // The Read / Encode / Verify step cards stay removed.
    for (const step of ['Read', 'Encode', 'Verify']) {
      expect(
        screen.queryByRole('heading', { name: step }),
      ).not.toBeInTheDocument()
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

  it('serves the four demo previews as posters, not live iframes, off desktop', () => {
    // Regression for the mobile-Safari crash guard: with the default
    // non-desktop media environment, no card may mount a live app
    // iframe — each renders its static poster instead.
    const { container } = render(<ApplicationsSection />)
    expect(container.querySelectorAll('iframe')).toHaveLength(0)
    const posters = [...container.querySelectorAll('.landing-demo-thumb img')].map(
      (img) => img.getAttribute('src'),
    )
    expect(posters).toEqual([
      '/demo-posters/workflow.png',
      '/demo-posters/chatbot.png',
      '/demo-posters/snap.png',
      '/demo-posters/app.png',
    ])
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
    // The Contribute / Verify / Fund cards gave way to two CTAs (Jul 24).
    expect(screen.queryByText(/encode your jurisdiction/i)).not.toBeInTheDocument()
    expect(screen.getByText(/get in touch/i).closest('a')).toHaveAttribute(
      'href',
      'mailto:hello@axiom.org',
    )
    expect(screen.getByText(/stay updated/i).closest('a')).toHaveAttribute(
      'href',
      expect.stringContaining('list-manage.com/subscribe'),
    )
    // The quick-links row (Live demos / Meet the team / …) was
    // removed — the footer carries those destinations.
    expect(screen.queryByText(/live demos/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/meet the team/i)).not.toBeInTheDocument()
  })
})


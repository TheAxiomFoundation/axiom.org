import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PrivacyPage from '@/app/privacy/page'

describe('PrivacyPage', () => {
  it('renders the page title', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: /privacy policy/i })).toBeInTheDocument()
  })

  it('renders last updated date', () => {
    render(<PrivacyPage />)
    expect(screen.getByText(/last updated/i)).toBeInTheDocument()
  })

  it('renders information we collect section', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: /information we collect/i })).toBeInTheDocument()
    expect(screen.getByText(/PostHog and Google Analytics for usage analytics/)).toBeInTheDocument()
  })

  it('renders how we use information section', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: /how we use information/i })).toBeInTheDocument()
  })

  it('renders third-party services section', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: /third-party services/i })).toBeInTheDocument()
    expect(screen.getByText(/PostHog and Google Analytics \(usage analytics\)/)).toBeInTheDocument()
  })

  it('renders open source section with GitHub link', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: /open source/i })).toBeInTheDocument()
    // axiom-api, the hosted runtime, is private, so the page can't say all
    // our code is open source.
    expect(screen.getByText(/our open-source code is at/i)).toBeInTheDocument()
    expect(screen.queryByText(/all our code is open source/i)).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'github.com/TheAxiomFoundation' })
    expect(link).toHaveAttribute('href', 'https://github.com/TheAxiomFoundation')
  })

  // The rulespec-* repos moved from CC BY 4.0 to CC0 1.0 on 2026-11-25.
  it('states the CC0 1.0 dedication for encodings and MIT for software', () => {
    const { container } = render(<PrivacyPage />)
    const text = (container.textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toMatch(
      /the rules engine, the encoder, the oracle harness, and this site under the MIT License/,
    )
    expect(text).toMatch(/keep its copyright and permission notices/)
    expect(text).toMatch(/to the public domain under CC0 1\.0/)
    expect(text).toMatch(/CC0 grants an unconditional licence instead/)
    expect(text).toMatch(/We ask for a citation but don.t require one/)
    expect(text).toMatch(
      /\(CI harnesses, runners, and conversion utilities\) stays under the Apache License 2\.0/,
    )
    expect(text).not.toMatch(/cc by|attribution 4\.0/i)
    expect(text).not.toMatch(/attribution (is )?required|requires? attribution|with attribution/i)
    expect(text).not.toMatch(/release our software/i)
  })

  it('renders contact section with email', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { name: /contact/i })).toBeInTheDocument()
    expect(screen.getByText('hello@axiom.org')).toBeInTheDocument()
  })
})

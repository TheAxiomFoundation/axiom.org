import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

import AboutPage from '@/app/about/page'

describe('AboutPage', () => {
  it('renders the page title and descriptor', () => {
    render(<AboutPage />)
    expect(screen.getByRole('heading', { name: /about axiom/i })).toBeInTheDocument()
    expect(screen.getByText(/machine-readable encodings of the/i)).toBeInTheDocument()
  })

  it('renders the Why section', () => {
    render(<AboutPage />)
    expect(screen.getByRole('heading', { name: /^why$/i })).toBeInTheDocument()
    expect(screen.getByText(/written in prose/i)).toBeInTheDocument()
  })

  it('renders the what-we-build cards', () => {
    render(<AboutPage />)
    expect(screen.getByRole('heading', { name: /what we build/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The Axiom App' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'RuleSpec' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The Encoder' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Validation' })).toBeInTheDocument()
  })

  it('serves the demos highlight as a static poster, not a live iframe', () => {
    // Regression: the live gallery iframe (7 nested app documents)
    // crash-looped mobile Safari — DemoThumb must default to the
    // poster and only upgrade on desktop-class devices.
    const { container } = render(<AboutPage />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('img[src="/demo-posters/gallery.png"]')).toBeInTheDocument()
  })

  it('renders how-we-verify and the founding-team band', () => {
    render(<AboutPage />)
    expect(screen.getByRole('heading', { name: /how we verify/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /founding team/i })).toBeInTheDocument()
    expect(screen.getByText(/founding team is Max Ghenis/i)).toBeInTheDocument()
  })

  it('links to the team page', () => {
    render(<AboutPage />)
    expect(screen.getByText(/meet the team/i).closest('a')).toHaveAttribute('href', '/team')
  })

  it('renders the get-in-touch section with the contact address', () => {
    render(<AboutPage />)
    expect(screen.getByRole('heading', { name: /get in touch/i })).toBeInTheDocument()
    expect(screen.getByText('hello@axiom.org')).toBeInTheDocument()
  })

  it('links out to the GitHub org', () => {
    render(<AboutPage />)
    const link = screen.getByRole('link', { name: /browse the code on github/i })
    expect(link).toHaveAttribute('href', 'https://github.com/TheAxiomFoundation')
    expect(link).toHaveAttribute('target', '_blank')
  })
})

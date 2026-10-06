import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Mock next/image
vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} />,
}))

import TeamPage from '@/app/team/page'

describe('TeamPage', () => {
  it('renders the page title', () => {
    render(<TeamPage />)
    expect(screen.getByRole('heading', { name: /^founding team$/i })).toBeInTheDocument()
  })

  it('renders all three team members with titles', () => {
    render(<TeamPage />)
    expect(screen.getByRole('heading', { name: 'Max Ghenis' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ariel Kennan' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pavel Makarchuk' })).toBeInTheDocument()
    expect(screen.getByText(/chief executive officer/i)).toBeInTheDocument()
    expect(screen.getByText(/^president$/i)).toBeInTheDocument()
    expect(screen.getByText(/product lead/i)).toBeInTheDocument()
  })

  it('renders a headshot for each member', () => {
    render(<TeamPage />)
    expect(screen.getByAltText('Max Ghenis')).toBeInTheDocument()
    expect(screen.getByAltText('Ariel Kennan')).toBeInTheDocument()
    expect(screen.getByAltText('Pavel Makarchuk')).toBeInTheDocument()
  })

  // Max 2026-10-05: describe him as a leader through his organizations'
  // missions, never as the builder of a format, pipeline or benchmark.
  it("describes Max through the organizations he leads, with no builder lines", () => {
    render(<TeamPage />)
    const section = screen.getByRole('heading', { name: 'Max Ghenis' }).closest('section')!
    const bio = Array.from(section.querySelectorAll('p'), (p) => p.textContent).join(' ')
    expect(bio).toMatch(/Axiom Foundation/)
    expect(bio).toMatch(/PolicyEngine/)
    expect(bio).not.toMatch(/\bhe (also )?(builds|built|creates|created)\b/i)
    expect(bio).not.toMatch(/encoder pipeline|RuleSpec format|PolicyBench/i)
  })

  it('renders LinkedIn links but no GitHub link-outs', () => {
    render(<TeamPage />)
    const linkedin = screen.getAllByText('LinkedIn')
    expect(linkedin.length).toBe(3)
    expect(screen.queryByText(/github/i)).not.toBeInTheDocument()
  })
})

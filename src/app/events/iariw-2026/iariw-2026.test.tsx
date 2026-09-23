import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import IariwWorkshopPage, { metadata } from './page'

describe('IariwWorkshopPage', () => {
  it('renders the header, register link, and facts', () => {
    render(<IariwWorkshopPage />)
    expect(
      screen.getByRole('heading', {
        name: /new technologies for evidence-based policy making/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /register/i }),
    ).toHaveAttribute('href', expect.stringContaining('docs.google.com/forms'))
    expect(
      screen.getByText(/thursday 27 august 2026, 13:00–17:00/i),
    ).toBeInTheDocument()
  })

  it('lists the program with the current roundtable roster', () => {
    render(<IariwWorkshopPage />)
    expect(
      screen.getByText(/from open models to executable law/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/hélène latzer — uclouvain saint-louis \(moderator\)/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/koen algoed — secretary general/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/jean-baptiste traversa — head of microsimulation/i),
    ).toBeInTheDocument()
  })

  it('links the co-organizers', () => {
    render(<IariwWorkshopPage />)
    expect(
      screen.getByRole('link', { name: /policyengine/i }),
    ).toHaveAttribute('href', 'https://policyengine.org')
    expect(screen.getByRole('link', { name: 'CAPE' })).toHaveAttribute(
      'href',
      'https://cape-saintlouis.be',
    )
    expect(screen.getByRole('link', { name: 'BEAMM' })).toHaveAttribute(
      'href',
      'https://beamm.brussels',
    )
  })

  it('is indexable with a descriptive title', () => {
    expect(metadata.title).toMatch(/workshop/i)
    expect(metadata.robots).toBeUndefined()
  })

  // A page-level openGraph or twitter block replaces the root layout's
  // wholesale: the event card restates type, url and site name, and
  // leaves twitter to the layout so twitter:site survives.
  it('sets a complete share card with the event image', () => {
    expect(metadata.openGraph).toEqual({
      type: 'website',
      url: './',
      siteName: 'Axiom Foundation',
      images: [
        {
          url: 'https://axiom.org/events/iariw-2026-og2.png',
          width: 2400,
          height: 1350,
        },
      ],
    })
    expect(metadata).not.toHaveProperty('twitter')
  })

  it('ships the share image it points at', () => {
    expect(
      existsSync(join(process.cwd(), 'public/events/iariw-2026-og2.png')),
    ).toBe(true)
  })
})

import { render, screen } from '@testing-library/react'
import ValidationPage, { metadata } from './page'

describe('ValidationPage', () => {
  it('renders the header and method steps', () => {
    render(<ValidationPage />)
    expect(
      screen.getByRole('heading', { name: /cross-checks in the open/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /same case, side by side/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /disagreements classified/i }),
    ).toBeInTheDocument()
  })

  it('lists the oracles with link-outs', () => {
    render(<ValidationPage />)
    for (const oracle of [
      'PolicyEngine',
      'TAXSIM',
      'UKMOD / EUROMOD',
      'SPSD/M',
      'SOUTHMOD',
      'SNAP quality-control data',
    ]) {
      expect(screen.getByRole('heading', { name: oracle })).toBeInTheDocument()
    }
    const outs = screen.getAllByRole('link', { name: /visit the oracle/i })
    expect(outs).toHaveLength(6)
    for (const link of outs) {
      expect(link).toHaveAttribute('target', '_blank')
    }
    // Adapters with no published comparison are named as not connected,
    // never listed as oracles. On axiom-oracles main (2026-10-05) the only
    // Tax-Calculator run is comparisons/taxcalc-fiit-ecps.yaml, Tax-Calculator
    // against PolicyEngine ("Neither side is Axiom"), and ACCESS NYC has
    // adapters under axiom_oracles/adapters/accessnyc but no comparison
    // config or report.
    for (const unconnected of ['PSL Tax-Calculator', 'ACCESS NYC']) {
      expect(screen.queryByRole('heading', { name: unconnected })).not.toBeInTheDocument()
    }
    expect(
      screen.getByText(/^Two more are not connected yet: PSL Tax-Calculator and ACCESS NYC have no published comparison/),
    ).toBeInTheDocument()
  })

  // SOUTHMOD has 40 published suites (axiom-oracles #205-#260), so it is a
  // compared oracle, and its card carries the three caveats Max's d945
  // ruling requires.
  it('describes SOUTHMOD as compared, with its three caveats', () => {
    render(<ValidationPage />)
    const card = screen.getByRole('heading', { name: 'SOUTHMOD' }).closest('div')
    const text = card?.textContent ?? ''
    expect(text).toContain(
      '40 suites compare our rules for Ghana, Uganda, Zambia, Ethiopia, and Rwanda: 242 of 245 comparisons match, and we attribute the other three to gaps in the models, with the arithmetic published.',
    )
    expect(text).toContain('we run these suites by hand on our licensed machine')
    expect(text).toContain('Every household is synthetic, and the SOUTHMOD bundle has no Rwandan microdata at all.')
    expect(text).toContain("None of the Axiom rules these suites compare went through our encoder's apply step")
    expect(text).not.toMatch(/no published comparison/)
    expect(screen.queryByText(/SOUTHMOD[^.]*not connected|not connected[^.]*SOUTHMOD/)).not.toBeInTheDocument()
  })

  // Clause 2 and Annex 1.2 of the SOUTHMOD_A4.0 Adhesion Agreement: any
  // output that uses the models names the EUROMOD version, the SOUTHMOD
  // version and the country models.
  it('carries the SOUTHMOD acknowledgement the licence requires', () => {
    render(<ValidationPage />)
    const ack = screen.getByTestId('southmod-acknowledgement').textContent ?? ''
    expect(ack).toContain('in SOUTHMOD_A4.0')
    expect(ack).toContain('EUROMOD version EM_Executable 1.0.0')
    for (const model of ['Ghana (GHAMOD)', 'Uganda (UGAMOD)', 'Zambia (MicroZAMOD)', 'Ethiopia (ETMOD)', 'Rwanda (RWAMOD)']) {
      expect(ack).toContain(model)
    }
    expect(ack).toContain("solely the Axiom Foundation's responsibility")
  })

  it('derives the SNAP QC and coverage counts from the evidence rows', () => {
    render(<ValidationPage />)
    expect(screen.getByText(/For 5,175 reviewed FY 2024 households in six states/)).toBeInTheDocument()
    expect(screen.getByText(/In September 2026, our coverage map tied 14,030 of our 34,810 US rules to a program that a live comparison exercises, though a comparison of a program does not check each of its rules; a/)).toBeInTheDocument()
  })

  it('embeds the live validation dashboard', () => {
    render(<ValidationPage />)
    expect(screen.getByTitle('Validation dashboard')).toHaveAttribute(
      'src',
      'https://axiom-oracles.vercel.app',
    )
    expect(
      screen.getByRole('link', { name: /open full size/i }),
    ).toHaveAttribute('href', 'https://axiom-oracles.vercel.app')
  })

  it('invites ecosystem contributions in the closing band', () => {
    render(<ValidationPage />)
    expect(
      screen.getByRole('link', { name: /contribute an oracle/i }),
    ).toHaveAttribute(
      'href',
      'https://github.com/TheAxiomFoundation/axiom-oracles',
    )
    expect(
      screen.getByRole('link', { name: /report a discrepancy/i }),
    ).toHaveAttribute(
      'href',
      'https://github.com/TheAxiomFoundation/axiom-rules-engine/issues',
    )
  })

  it('is indexable with a descriptive title', () => {
    expect(metadata.title).toMatch(/validation/i)
    expect(metadata.robots).toBeUndefined()
  })
})

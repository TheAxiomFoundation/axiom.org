import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

import AboutPage from '@/app/about/page'
import ValidationPage, { metadata as validationMetadata } from '@/app/validation/page'
import { EncodedLawSection } from '@/components/landing/encoded-law-section'
import VerifyPage from '@/app/verify/page'
import ReceiptsPage from '@/app/receipts/page'

// The verification copy must describe what the oracle harness actually does.
// - Coverage is partial. rulespec-us/oracle-coverage-pending.yaml declares the
//   outputs no oracle maps yet, and the pipeline page shows "No oracle report
//   covers it" per encoding. "Every encoding" and "every published rule"
//   claims are false.
// - PolicyEngine is not independent of Axiom. Max Ghenis is CEO of both, and
//   PSL Foundation fiscally sponsors both. Any page that names PolicyEngine
//   as an oracle discloses that.
// - The SNAP QC replay checks benefit arithmetic only. The public-use file
//   keeps only eligible households and the replay feeds the eligibility gates
//   passing values (axiom-oracles snap_qc_compare.py). A page that names SNAP
//   QC says eligibility is untested.
const SURFACES = [
  ['/about', () => render(<AboutPage />)],
  ['/validation', () => render(<ValidationPage />)],
  ['/ (encoded law section)', () => render(<EncodedLawSection />)],
  ['/verify', () => render(<VerifyPage />)],
  ['/receipts', () => render(<ReceiptsPage />)],
] as const

function textOf(renderSurface: () => ReturnType<typeof render>) {
  const { container, unmount } = renderSurface()
  const text = (container.textContent ?? '').replace(/\s+/g, ' ')
  unmount()
  return text
}

describe('verification claims', () => {
  for (const [route, renderSurface] of SURFACES) {
    it(`${route} claims no universal or independent cross-check`, () => {
      const text = textOf(renderSurface)

      // A universal subject next to a checking verb, either order, within
      // one sentence. "The primary text every encoding points back to" is
      // fine; "every encoding, cross-checked" is not.
      expect(text).not.toMatch(
        /\b(every|each|all) (encoding|published rule|rule)s?\b[^.]{0,80}\b(cross-check|check|verif|validat|compar|run[s]? against)/i,
      )
      expect(text).not.toMatch(
        /\b(cross-check|check|verif|validat|compar|run)\w*\b[^.]{0,20}\b(every|each|all) (encoding|published rule|rule)s?\b/i,
      )
      expect(text).not.toMatch(/independent (engines?|oracles?|calculators?)/i)
      expect(text).not.toMatch(/engines we don.t control/i)
      expect(text).not.toMatch(/adjudicated/i)
    })

    it(`${route} discloses the PolicyEngine tie wherever it names PolicyEngine`, () => {
      const text = textOf(renderSurface)
      if (!/PolicyEngine/.test(text)) return

      expect(text).toMatch(/co-founded PolicyEngine,?( the reference calculator below,)? and is also its CEO/)
    })

    it(`${route} scopes the SNAP QC replay to benefit arithmetic`, () => {
      const text = textOf(renderSurface)
      if (!/SNAP quality-control/i.test(text)) return

      expect(text).toMatch(/eligibility untested/i)
    })
  }

  // TAXSIM is not independent of PolicyEngine either: PolicyEngine is
  // building its successor with NBER, and the axiom-oracles TAXSIM adapter
  // runs the binary bundled in policyengine-taxsim (adapters/taxsim/pins.py).
  it('/validation discloses where the TAXSIM binary comes from', () => {
    const text = textOf(() => render(<ValidationPage />))

    expect(text).toMatch(/TAXSIM binary bundled in PolicyEngine's policyengine-taxsim package/)
  })

  it('keeps the validation metadata free of independence claims', () => {
    expect(validationMetadata.description).not.toMatch(/independent/i)
    expect(validationMetadata.description).not.toMatch(/every/i)
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

import AboutPage from '@/app/about/page'
import ValidationPage, { metadata as validationMetadata } from '@/app/validation/page'
import VerifyPage from '@/app/verify/page'
import ReceiptsPage from '@/app/receipts/page'
import { EncodedLawSection } from '@/components/landing/encoded-law-section'
import { EncoderSection } from '@/components/landing/encoder-section'
import { SOUTHMOD_CAVEATS } from '@/lib/verification-evidence'

// The verification copy must describe what the oracle harness does.
// - Coverage is partial. axiom-oracles dashboard/public/data/
//   rule_verification_summary.json (2026-09-28) puts 20,780 of 34,810
//   rulespec-us rules on no surface a live comparison exercises, and
//   rulespec-us oracle-coverage-pending.yaml declares 14,952 outputs the
//   shared CI gate admits without a comparison. "Every encoding" claims are
//   false.
// - PolicyEngine is not independent of Axiom: Max Ghenis is CEO of both and
//   PSL Foundation fiscally sponsors both. TAXSIM is not independent of
//   PolicyEngine: the axiom-oracles TAXSIM adapter runs the executable
//   bundled in policyengine-taxsim (adapters/taxsim/pins.py). A page that
//   names either discloses the tie.
// - The SNAP QC replay checks benefit arithmetic only. The public-use file
//   keeps only eligible households and the replay feeds the eligibility gates
//   passing values (axiom-oracles bridges/snap_qc_compare.py). A page that
//   names SNAP QC says eligibility is untested.
// - SOUTHMOD is compared (40 suites on axiom-oracles main since 2026-10-04),
//   with three caveats a page that names it states: the runs are manual on
//   the licensed machine (SOUTHMOD_A4.0 Adhesion Agreement clause 4; every
//   config declares `ci: manual`), the compared rulespec-gh/ug/zm/et/rw
//   modules carry no encoder apply manifest, and every household is
//   synthetic, with no Rwandan microdata at all. The evidence for each is in
//   src/lib/verification-evidence.ts.
const SURFACES = [
  ['/about', () => render(<AboutPage />)],
  ['/validation', () => render(<ValidationPage />)],
  ['/verify', () => render(<VerifyPage />)],
  ['/receipts', () => render(<ReceiptsPage />)],
  ['/ (encoded law section)', () => render(<EncodedLawSection />)],
  ['/ (encoder section)', () => render(<EncoderSection />)],
] as const

// Join text nodes with spaces: textContent glues adjacent elements together
// ("independent evidence" + "Verified" reads "evidenceVerified"), which hides
// a claim from any pattern that ends on a word boundary.
function textOf(renderSurface: () => ReturnType<typeof render>) {
  const { container, unmount } = renderSurface()
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
  unmount()
  return parts.join(' ').replace(/\s+/g, ' ')
}

const CHECK_VERB = String.raw`(cross-check|check|verif|validat|compar|run[s]? against|mapped to an oracle)`
const UNIVERSAL_SUBJECT = String.raw`(every|each|all) (encoding|published rule|rule|executable output|output)s?`

describe('verification claims', () => {
  for (const [route, renderSurface] of SURFACES) {
    it(`${route} claims no universal or independent cross-check`, () => {
      const text = textOf(renderSurface)

      // A universal subject next to a checking verb, either order, within one
      // sentence. "The primary text every encoding points back to" is fine;
      // "every encoding, cross-checked" is not.
      expect(text).not.toMatch(new RegExp(String.raw`\b${UNIVERSAL_SUBJECT}\b[^.]{0,80}\b${CHECK_VERB}`, 'i'))
      expect(text).not.toMatch(new RegExp(String.raw`\b${CHECK_VERB}\w*\b[^.]{0,20}\b${UNIVERSAL_SUBJECT}\b`, 'i'))
      expect(text).not.toMatch(
        /\bindependent(ly)? (of Axiom|engines?|oracles?|calculators?|calculations?|implementations?|evidence|checks?)\b/i,
      )
      expect(text).not.toMatch(/\bcompared? independently\b/i)
      expect(text).not.toMatch(/\bexternal (engines?|oracles?|calculators?)\b/i)
      expect(text).not.toMatch(/engines we don.t control/i)
      expect(text).not.toMatch(/never grades its own work/i)
      expect(text).not.toMatch(/adjudicated cases/i)
    })

    it(`${route} discloses the PolicyEngine tie wherever it names PolicyEngine`, () => {
      const text = textOf(renderSurface)
      if (!/PolicyEngine/.test(text)) return

      expect(text).toMatch(/Max Ghenis is CEO of both Axiom and PolicyEngine/)
    })

    it(`${route} discloses where TAXSIM runs come from wherever it names TAXSIM`, () => {
      const text = textOf(renderSurface)
      if (!/TAXSIM/.test(text)) return

      expect(text).toMatch(/TAXSIM executable that PolicyEngine packages/)
    })

    it(`${route} states the SOUTHMOD caveats wherever it names SOUTHMOD`, () => {
      const text = textOf(renderSurface)
      if (!/SOUTHMOD/.test(text)) return

      for (const caveat of Object.values(SOUTHMOD_CAVEATS)) {
        expect(text).toContain(caveat.marker)
      }
      // It has published comparisons, so no page lists it as unconnected.
      expect(text).not.toMatch(/SOUTHMOD[^.]{0,120}(not connected|no published comparison)/)
    })

    it(`${route} scopes the SNAP QC replay to benefit arithmetic`, () => {
      const text = textOf(renderSurface)
      if (!/SNAP (quality-control|QC)/i.test(text)) return

      expect(text).toMatch(/eligibility (is )?untested/i)
    })
  }

  // jsdom does not render the home journey film's captions or its
  // aria-label, so read them from source.
  it('keeps the home journey film free of independence claims', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/landing/journey-film.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/independent calc(ulator)?s?/i)
  })

  it('keeps the validation metadata free of independence and coverage claims', () => {
    expect(validationMetadata.description).not.toMatch(/independent/i)
    expect(validationMetadata.description).not.toMatch(/\bevery\b/i)
  })
})

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
import OverviewPage, { metadata as overviewMetadata } from '@/app/overview/page'
import { EncodedLawSection } from '@/components/landing/encoded-law-section'
import { EncoderSection } from '@/components/landing/encoder-section'

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
// - Drafts must compile and pass their tests to merge, except modules on the
//   waiver list, and the encoder writes those tests in the same model
//   response as the rules (axiom-encode src/axiom_encode/harness/evals.py),
//   so nothing here may say the model never grades its own work.
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

// The downloadable overview PDF is rendered from this HTML (pdf/overview/
// README.md), and overview.test.tsx checks the published PDF carries this
// file's hash, so guarding the source guards the PDF. Comments and the style
// block never reach the page.
function printSourceText(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;|&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

const SURFACES: ReadonlyArray<readonly [string, () => string]> = [
  ['/about', () => textOf(() => render(<AboutPage />))],
  ['/validation', () => textOf(() => render(<ValidationPage />))],
  ['/verify', () => textOf(() => render(<VerifyPage />))],
  ['/receipts', () => textOf(() => render(<ReceiptsPage />))],
  ['/ (encoded law section)', () => textOf(() => render(<EncodedLawSection />))],
  ['/ (encoder section)', () => textOf(() => render(<EncoderSection />))],
  // Every audience panel stays mounted (hidden, not unmounted), so the
  // rendered text includes the tabs a reader has not opened.
  ['/overview', () => textOf(() => render(<OverviewPage />))],
  ['/Axiom-Foundation-Overview.pdf (print source)', () => printSourceText('pdf/overview/axiom-overview.html')],
]

const CHECK_VERB = String.raw`(cross-check|check|verif|validat|compar|run[s]? against|mapped to an oracle)`
const UNIVERSAL_SUBJECT = String.raw`(every|each|all) (encoding|published rule|rule|executable output|output)s?`

describe('verification claims', () => {
  for (const [route, surfaceText] of SURFACES) {
    it(`${route} claims no universal or independent cross-check`, () => {
      const text = surfaceText()

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
      // Waivers and model-written tests decide what merges too.
      expect(text).not.toMatch(/deterministic gauntlet/i)
      // SNAP's is the only quality-control file any comparison reads.
      expect(text).not.toMatch(/program quality-control data/i)
    })

    // The shared validate workflow skips validation, companion tests and
    // proof checks for every module with an active waiver in rulespec-us
    // known-validation-gaps.yaml: 1,940 modules on 2026-10-02, holding
    // 23,735 of 34,810 rules. Every sentence that states the gate names the
    // waivers.
    it(`${route} names the waivers in every sentence that says drafts pass their tests`, () => {
      const passesTests = /\bpass(es|ing)? (its |their |the |all )?(companion )?(test suite|tests)\b/i
      const gateSentences = surfaceText()
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => passesTests.test(sentence))

      for (const sentence of gateSentences) expect(sentence).toMatch(/\bwaive/i)
    })

    it(`${route} discloses the PolicyEngine tie wherever it names PolicyEngine`, () => {
      const text = surfaceText()
      if (!/PolicyEngine/.test(text)) return

      expect(text).toMatch(/Max Ghenis is CEO of both Axiom and PolicyEngine/)
    })

    it(`${route} discloses where TAXSIM runs come from wherever it names TAXSIM`, () => {
      const text = surfaceText()
      if (!/TAXSIM/.test(text)) return

      expect(text).toMatch(/TAXSIM executable that PolicyEngine packages/)
    })

    it(`${route} scopes the SNAP QC replay to benefit arithmetic`, () => {
      const text = surfaceText()
      if (!/SNAP (quality[- ]control|QC)/i.test(text)) return

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

  it('keeps the overview metadata free of independence and coverage claims', () => {
    for (const description of [overviewMetadata.description, overviewMetadata.openGraph?.description]) {
      expect(description).toBeTruthy()
      expect(description).not.toMatch(/independent|external|cross-check/i)
      expect(description).not.toMatch(/\bevery\b/i)
    }
  })
})

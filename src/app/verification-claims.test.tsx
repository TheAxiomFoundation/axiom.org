import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { render } from '@testing-library/react'
import fc from 'fast-check'
import { describe, it, expect, vi } from 'vitest'
import { encoderRecordClaims, markdownClaims } from '@/test/encoder-record-guard'
import { copyFiles, fileCopy, htmlCopy, pageText, publicHtmlFiles, sourceCopy, stringsIn } from '@/test/claim-copy'
import { sweepPublicHtmlClaims } from '@/test/public-html-claims'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

import AboutPage from '@/app/about/page'
import ValidationPage, { metadata as validationMetadata } from '@/app/validation/page'
import VerifyPage from '@/app/verify/page'
import ReceiptsPage from '@/app/receipts/page'
import { EncodedLawSection } from '@/components/landing/encoded-law-section'
import { EncoderSection } from '@/components/landing/encoder-section'
import OverviewPage, { metadata as overviewMetadata } from '@/app/overview/page'
import * as overviewContent from '@/components/overview/overview-content'
import { SOUTHMOD_CAVEATS } from '@/lib/verification-evidence'

// The verification copy must describe what the oracle harness does.
// - Coverage is partial. axiom-oracles dashboard/public/data/
//   rule_verification_summary.json (2026-10-12) ties 14,030 rules to a
//   program surface a live comparison exercises; the source census on
//   2026-10-18 counts 34,832 named rulespec-us rules. Meanwhile,
//   rulespec-us oracle-coverage-pending.yaml declares 14,952 outputs the
//   shared CI gate admits without a comparison. "Every encoding" claims are
//   false. The summary does not count rules without a comparison: some
//   rules it maps to no surface at all are compared
//   directly (the US tariff duty, the NJ pilot income tax), so no page
//   turns the difference into "N rules had no comparison".
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
// - SOUTHMOD is compared (40 suites on axiom-oracles main since 2026-10-04),
//   with three caveats a page that names it states: the runs are manual on
//   the licensed machine (SOUTHMOD_A4.0 Adhesion Agreement clause 4; every
//   config declares `ci: manual`), the compared rulespec-gh/ug/zm/et/rw
//   modules carry no encoder apply manifest, and every household is
//   synthetic, with no Rwandan microdata at all. The evidence for each is in
//   src/lib/verification-evidence.ts.
// - The adapters do not keep engine quirks out of the comparison. axiom-oracles
//   dispositions/README.md defines `bridge_artifact` as a mismatch where "the
//   comparison harness fed the engines different inputs", and
//   conformance/scoreboard.json (main 8826215d) counts 3,938 of them for the
//   PolicyEngine US suites.
const SURFACES = [
  ['/about', () => render(<AboutPage />)],
  ['/validation', () => render(<ValidationPage />)],
  ['/verify', () => render(<VerifyPage />)],
  ['/receipts', () => render(<ReceiptsPage />)],
  ['/ (encoded law section)', () => render(<EncodedLawSection />)],
  ['/ (encoder section)', () => render(<EncoderSection />)],
  // Every audience panel stays mounted (hidden, not unmounted), so the
  // rendered text includes the tabs a reader has not opened.
  ['/overview', () => render(<OverviewPage />)],
] as const

// The downloadable overview PDF is rendered from this HTML (pdf/overview/
// README.md), and overview.test.tsx checks the published PDF carries this
// file's hash. Use the same DOM-aware extraction as the encoder-record guard
// to keep visible copy, accessible names and entity decoding in scope.
const COPY_SURFACES: ReadonlyArray<readonly [string, () => string]> = [
  ...SURFACES.map(([route, renderSurface]) => [route, () => pageText(renderSurface)] as const),
  ['/Axiom-Foundation-Overview.pdf (print source)', () =>
    htmlCopy(readFileSync(join(process.cwd(), 'pdf/overview/axiom-overview.html'), 'utf8'))],
]

const CHECK_VERB = String.raw`(cross-check|check|verif|validat|compar|run[s]? against|mapped to an oracle)`
const UNIVERSAL_SUBJECT = String.raw`(every|each|all) (encoding|published rule|rule|executable output|output)s?`

function unwaivedTestGateSentences(text: string): string[] {
  const passesTests = /\bpass(es|ing)? (its |their |the |all )?(companion )?(test suite|tests)\b/i
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .filter((sentence) => passesTests.test(sentence) && !/\bwaive/i.test(sentence))
}

describe('verification claims', () => {
  it('rejects an unwaived first card sentence even when its heading names waivers', () => {
    const text = htmlCopy('<article><h3>Tests and waivers</h3><p>Drafts pass their tests before merging.</p></article>')

    expect(unwaivedTestGateSentences(text)).toEqual(['Drafts pass their tests before merging.'])
  })

  for (const [route, surfaceText] of COPY_SURFACES) {
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
      expect(text).not.toMatch(/no engine.?s quirks leak/i)
      expect(text).not.toMatch(/US rules (had|have) no comparison/i)
      // The adapters are not thin: axiom_oracles/adapters/axiom/ holds about
      // 7,500 lines of Python (tax_projection.py alone is 4,310).
      expect(text).not.toMatch(/thin adapter/i)
      expect(text).not.toMatch(/every engine/i)
      // Published reports carry unexplained mismatches (summary.dispositioned.
      // unexplained_count; the dashboard's countUnexplained), so no surface
      // says every disagreement gets explained.
      expect(text).not.toMatch(/disagreements get explained/i)
    })

    // The shared validate workflow skips validation, companion tests and
    // proof checks for every module with an active waiver in rulespec-us
    // known-validation-gaps.yaml. Every sentence that states the gate names
    // the waivers; numerical coverage is measured separately from that ledger.
    it(`${route} names the waivers in every sentence that says drafts pass their tests`, () => {
      expect(unwaivedTestGateSentences(surfaceText())).toEqual([])
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

    it(`${route} states the SOUTHMOD caveats wherever it names SOUTHMOD`, () => {
      const text = surfaceText()
      if (!/SOUTHMOD/.test(text)) return

      for (const caveat of Object.values(SOUTHMOD_CAVEATS)) {
        expect(text).toContain(caveat.marker)
      }
      // It has published comparisons, so no page lists it as unconnected.
      expect(text).not.toMatch(/SOUTHMOD[^.]{0,120}(not connected|no published comparison)/)
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

// The encoder's record is its signed apply manifest. A failed re-encode's
// 90-day diagnostics artifact can contain a trace. Read from code on 2026-10-11:
// - An apply manifest (axiom-encode cli.py _MODEL_APPLY_MANIFEST_FIELDS) names
//   the citation, the runner, backend and model, and the path and SHA-256 of
//   each file written, and is signed before it is written. It holds a trace's
//   path and hash, never the trace, which stays on the machine that ran the
//   encoder.
// - No rules repo holds a trace, and the signed CI workflows put none in the
//   artifacts that land. A failed targeted re-encode's diagnostics artifact
//   can keep its trace for 90 days.
// - The run telemetry in Supabase (encodings.encoding_runs,
//   telemetry.sdk_session_events) records a run's request, result, outcome
//   and validation issues: about four events a run, none a decision.
//
// The executable guard lives in src/test/encoder-record-guard.ts. Ops owns
// the canonical labels and publishes their byte-level digest. These are local
// artifact pins: neither repository's offline CI observes a later one-sided
// update in the other. encoder-record-reference.test.ts also checks exact
// Python outputs recorded at the immutable ops snapshot named in that artifact.
// scripts/check-encoder-record-reference.py --ops <checkout> rechecks that
// snapshot against local git objects and runs Python without network access.
const FIXTURES_PATH = join(process.cwd(), 'src/test/encoder-record-fixtures.json')
const FIXTURES_SHA256 = 'f266b1add1d0239662823f10aa8ba4f5a94345f9d3dd82ec4e88efda762b8cf3'
const FIXTURES: { text: string; banned: boolean; markdown?: boolean }[] = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')).cases

describe('encoder record claims', () => {
  it('reads the fixtures it shares with ops comms/check_claims.py', () => {
    const digest = createHash('sha256').update(readFileSync(FIXTURES_PATH)).digest('hex')
    expect(
      digest,
      'the canonical fixture bytes changed: verify the ops sidecar and refresh the recorded reference outputs',
    ).toBe(FIXTURES_SHA256)
  })

  it('reproduces every fixture label', () => {
    const wrong = FIXTURES.filter((c) => (c.markdown ? markdownClaims(c.text) : encoderRecordClaims(c.text)).length > 0 !== c.banned)
    expect(wrong).toEqual([])
  })

  const plainClaims = FIXTURES.filter((c) => !c.markdown && c.banned && c.text.split('.').length === 2 && !c.text.includes('\n')).map((c) => c.text)
  const plainAllowed = FIXTURES.filter((c) => !c.markdown && !c.banned && c.text.split('.').length === 2 && !c.text.includes('\n')).map((c) => c.text)
  it('finds a claim whatever sentence comes before it', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9 ,'()-]{0,80}$/), fc.constantFrom(...plainClaims), (prefix, claim) => {
        expect(encoderRecordClaims(`${prefix}. ${claim}`)).not.toEqual([])
      }),
    )
  })

  it('reads a block break as a clause break', () => {
    fc.assert(
      fc.property(fc.constantFrom(...plainAllowed), fc.constantFrom(...plainClaims), (allowed, claim) => {
        expect(encoderRecordClaims(`${allowed}\n${claim}`)).not.toEqual([])
        expect(encoderRecordClaims(`${allowed}\n${allowed}`)).toEqual([])
      }),
    )
  })

  for (const [route, renderSurface] of SURFACES) {
    it(`${route} makes no claim about the encoder's record`, () => {
      expect(encoderRecordClaims(pageText(renderSurface))).toEqual([])
    })
  }

  it('the overview copy, every audience panel included, makes no such claim', () => {
    expect(stringsIn(overviewContent).flatMap(encoderRecordClaims)).toEqual([])
  })

  // The downloadable PDF is rendered from this file (pdf/overview/README.md).
  it('the overview PDF print source makes no such claim', () => {
    const html = readFileSync(join(process.cwd(), 'pdf/overview/axiom-overview.html'), 'utf8')
    expect(encoderRecordClaims(htmlCopy(html))).toEqual([])
  })

  it('the source extraction keeps copy and drops comments', () => {
    const read = (source: string) => sourceCopy('probe.tsx', source).flatMap(encoderRecordClaims)
    expect(read('const a = <p>Every encoding decision is {/* note */} recorded.</p>')).not.toEqual([])
    expect(read('const a = <p>We do not {/* note */} publish its traces, the encoder says.</p>')).toEqual([])
    expect(read('const a = <p aria-label="The encoder logs every decision.">Hi</p>')).not.toEqual([])
    expect(read('const a = "The encoder logs every " + "decision."')).not.toEqual([])
    expect(read('// The encoder logs every decision.\nconst a = 1')).toEqual([])
    // An inline element joins its neighbours' words; a block element breaks the clause.
    expect(read('const a = <div><span>Decision</span> <span>logs are kept.</span></div>')).not.toEqual([])
    expect(read('const a = <div><h2>Decision</h2> <p>logs are kept.</p></div>')).toEqual([])
  })

  it('sweeps website-owned public HTML, including the embedded tariff paper', () => {
    const root = join(process.cwd(), 'public')
    const files = publicHtmlFiles(root)
    expect(files).toContain(join(root, 'tariff/paper/web/index.html'))
    const result = sweepPublicHtmlClaims(files.map((path) => ({
      path: relative(process.cwd(), path).split('\\').join('/'),
      html: readFileSync(path, 'utf8'),
    })))
    expect(result).toEqual({ hits: [], unusedExceptions: [] })
  }, 60_000)

  // A backstop for pages no test renders: every file under src/ that can
  // carry copy.
  it('no source file makes such a claim', () => {
    const root = join(process.cwd(), 'src')
    const hits = copyFiles(root).flatMap((path) =>
      fileCopy(path).flatMap(encoderRecordClaims).map((claim) => `${relative(root, path)}: ${claim}`),
    )
    expect(hits).toEqual([])
  }, 60_000)
})

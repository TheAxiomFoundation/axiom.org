import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
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
import OverviewPage from '@/app/overview/page'
import * as overviewContent from '@/components/overview/overview-content'
import { SOUTHMOD_CAVEATS } from '@/lib/verification-evidence'

// The verification copy must describe what the oracle harness does.
// - Coverage is partial. axiom-oracles dashboard/public/data/
//   rule_verification_summary.json (2026-09-28) ties 14,030 of 34,810
//   rulespec-us rules to a program surface a live comparison exercises, and
//   rulespec-us oracle-coverage-pending.yaml declares 14,952 outputs the
//   shared CI gate admits without a comparison. "Every encoding" claims are
//   false. The summary does not count rules without a comparison: it maps
//   16,716 rules to no surface at all, and some of those are compared
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

// The encoder's record is its signed apply manifest, and nothing records its
// decisions. Read from code on 2026-10-10:
// - An apply manifest (axiom-encode cli.py _MODEL_APPLY_MANIFEST_FIELDS) names
//   the citation, the runner, backend and model, and the path and SHA-256 of
//   each file written, and is signed before it is written. It holds a trace's
//   path and hash, never the trace.
// - Nothing keeps the trace of an encoding that lands. On rulespec-us main
//   (16a66771) all 686 manual-attestation manifests have trace_file null, as
//   do 9 of the 368 `encode --apply` manifests, and 387 of the 390 trace
//   paths recorded are local temp directories. The signed CI workflows stage
//   no trace into the artifacts that land; only a failed targeted re-encode
//   keeps its work files in a 90-day artifact.
// - The run telemetry in Supabase (encodings.encoding_runs,
//   telemetry.sdk_session_events) records a run's request, result, outcome
//   and validation issues: about four events a run, none a decision.
const NOT = String.raw`(?<!\bnot )(?<!n['’]t )(?<!\bnever )`
// "Not every encoding decision is logged" negates the quantifier, not the
// noun a pattern starts on.
const NOT_QUANTIFIED =
  NOT +
  ['every', 'each', 'all']
    .flatMap((q) => [String.raw`(?<!\bnot ${q} )`, String.raw`(?<!n['’]t ${q} )`])
    .join('')
// The same patterns as TheAxiomFoundation/ops comms/check_claims.py, which
// guards the Message House and FAQ.
const DECISION_LOG = [
  new RegExp(String.raw`${NOT}\b(every|each|all)( \w+)? decisions? (is |are |was |were |gets? )?(logged|recorded|traced)\b`, 'i'),
  new RegExp(String.raw`${NOT}\b(logs?|logged|logging|records?|recorded|recording|traces?|traced|tracing)\b[^.]{0,20}\b(every|each|all)( \w+)? decisions?\b`, 'i'),
  /\bdecision[- ](trail|log)s?\b/i,
  new RegExp(
    String.raw`${NOT_QUANTIFIED}\b(encoding|encoder['’]?s?|model['’]?s?|agent['’]?s?) decisions? (is|are) (all )?(public|published|open|logged|recorded|traceable|auditable)\b`,
    'i',
  ),
  new RegExp(String.raw`${NOT}\bpublish(es|ed|ing)? (its|our|every|each|all|the (encoder|model|agent)['’]s)( \w+)? decisions?\b`, 'i'),
  new RegExp(
    String.raw`${NOT}\b(publish(es|ed|ing)?|keeps?|kept|retains?|retained|archives?|archived|stores?|stored|logs?|logged|records?|recorded|saves?|saved) (every|each|all|its|their|full|complete|the full|the complete|the (encoder|model|agent)['’]s)( [\w'’-]+){0,2} (traces?|transcripts?|reasoning)\b`,
    'i',
  ),
  new RegExp(
    String.raw`${NOT}\b(every|each|all|its|their|the (encoder|model|agent)['’]s)( [\w'’-]+){0,2} (traces?|transcripts?|reasoning) (is|are|gets?) (published|public|kept|retained|archived|stored|logged|recorded|saved|available)\b`,
    'i',
  ),
]

function decisionLogClaims(text: string) {
  return DECISION_LOG.flatMap((re) => {
    const m = text.match(re)
    return m ? [m[0]] : []
  })
}

// Every string an exported overview constant holds, nested ones included, so
// the audience panels the page renders one at a time are read too.
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn)
  return []
}

// Page copy as one line of words: comments dropped, JSX tags and entities
// stripped, `{" "}` and line breaks read as spaces. Dropping text can only
// hide a claim from this backstop, never invent one.
function copyOf(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/\{" "\}/g, ' ')
    .replace(/<\/?[A-Za-z][^<>]*>/g, ' ')
    .replace(/&apos;|&rsquo;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sourceFiles(path)
    return /\.(tsx?|mdx?)$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name) ? [path] : []
  })
}

describe('encoder record claims', () => {
  it('the matcher catches the retired copy and passes the manifest wording', () => {
    const retired = [
      'The encoder logs every decision.',
      'An AI-assisted pipeline that reads source law, drafts encodings subsection by subsection, and logs every decision with its provenance.',
      'Our code, our data, and our encoding decisions are public.',
      'Every value cites its authority, every clause carries its effective dates, and the pipeline records each encoding decision alongside the source text it came from.',
      'Every value cites its authority, every clause carries its effective dates, and each decision is recorded alongside the source text.',
      'Every encoding decision logged and explainable.',
      'It logs every decision, conflict, and retry.',
      'A draft is logged with an explainable decision trail.',
      'The encoder keeps a decision log for every encoding.',
      'The model’s decisions are recorded.',
      'We publish the encoder’s decisions.',
      'We publish every encoder trace.',
      'The encoder keeps its full reasoning.',
      'Every run’s trace is published.',
      'Its traces are public.',
    ]
    for (const claim of retired) expect(decisionLogClaims(claim), claim).not.toEqual([])

    const allowed = [
      'Each time the encoder applies an encoding, it leaves a signed manifest naming the source citation and the model.',
      'An AI-assisted pipeline that reads source law, drafts encodings subsection by subsection, and leaves a signed manifest naming the source citation and the model for each encoding it applies.',
      'Our code, our data, and our encodings are public.',
      'Every value cites its authority, every clause carries its effective dates, and each encoding the encoder applies has a signed manifest naming its source citation and model.',
      'An apply manifest records the trace’s path and hash, never its contents.',
      'The engine returns a determination with its citation trace.',
      'Not every encoding decision is logged.',
      'No encoder trace is published.',
      'We do not publish the encoder’s traces.',
    ]
    for (const line of allowed) expect(decisionLogClaims(line), line).toEqual([])
  })

  const RENDERED = [
    ...SURFACES,
    ['/overview', () => render(<OverviewPage />)],
  ] as const
  for (const [route, renderSurface] of RENDERED) {
    it(`${route} claims no decision log`, () => {
      expect(decisionLogClaims(textOf(renderSurface))).toEqual([])
    })
  }

  it('the overview copy, every audience panel included, claims no decision log', () => {
    const hits = stringsIn(overviewContent).flatMap(decisionLogClaims)
    expect(hits).toEqual([])
  })

  // The downloadable PDF is rendered from this file (pdf/overview/README.md).
  it('the overview PDF print source claims no decision log', () => {
    const html = readFileSync(join(process.cwd(), 'pdf/overview/axiom-overview.html'), 'utf8')
    expect(decisionLogClaims(copyOf(html))).toEqual([])
  })

  // A backstop for pages no test renders: every non-test source file.
  it('no source file claims a decision log', () => {
    const root = join(process.cwd(), 'src')
    const hits = sourceFiles(root).flatMap((path) =>
      decisionLogClaims(copyOf(readFileSync(path, 'utf8'))).map((m) => `${relative(root, path)}: ${m}`),
    )
    expect(hits).toEqual([])
  })
})

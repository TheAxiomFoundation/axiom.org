import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { render } from '@testing-library/react'
import fc from 'fast-check'
import ts from 'typescript'
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

// The encoder's record is its signed apply manifest, and no encoder trace is
// published. Read from code on 2026-10-11:
// - An apply manifest (axiom-encode cli.py _MODEL_APPLY_MANIFEST_FIELDS) names
//   the citation, the runner, backend and model, and the path and SHA-256 of
//   each file written, and is signed before it is written. It holds a trace's
//   path and hash, never the trace, which stays on the machine that ran the
//   encoder.
// - No repo holds a trace, and the signed CI workflows put none in the
//   artifacts that land. A failed targeted re-encode's diagnostics artifact
//   can keep its trace for 90 days.
// - The run telemetry in Supabase (encodings.encoding_runs,
//   telemetry.sdk_session_events) records a run's request, result, outcome
//   and validation issues: about four events a run, none a decision.
//
// This matcher mirrors encoder_record_claims in TheAxiomFoundation/ops
// comms/check_claims.py, which guards the Message House and FAQ. Both must
// reproduce the labels in src/test/encoder-record-fixtures.json, a
// byte-identical copy of ops comms/encoder-record-fixtures.json; both tests
// pin its SHA-256. ASCII word classes keep \b the same as Python's re.ASCII.
const WORD = String.raw`[A-Za-z0-9_'’-]+`
const NEGATION = /\b(no|not|never|without|none|nothing|neither|nor|cannot)\b|n['’]t\b/i
const CLAUSE_BREAK = /[.!?;:—\n]|--|, (?:and|but|so|yet|while) /gi
const DECISION_CLAIMS = [
  // "Every encoding decision is logged", "every decision public", "each
  // decision the encoder makes is recorded".
  String.raw`\b(every|each|all)( ${WORD})? decisions?(\b[^.;:!?\n]{0,30}\b(is|are|was|were|gets?|get))? (logged|recorded|traced|kept|saved|published|public)\b`,
  // "logs every decision", "records each encoding decision", "logs its decisions".
  String.raw`\b(logs?|logged|logging|records?|recorded|recording|traces?|traced|tracing|captures?|captured|keeps?|kept|saves?|saved|publish(es|ed|ing)?|documents?|documented)\b[^.;:!?\n]{0,20}\b(every|each|all|its|their|our|the (encoder|model|agent)['’]s)( ${WORD})? decisions?\b`,
  // "Every encoding decision has a public record".
  String.raw`\b(every|each|all|its|their|our)( ${WORD})? decisions? (has|have|gets?|comes? with|carry|carries) (an? |its |their )?(${WORD} )?(record|log|trail|trace|history|explanation)s?\b`,
  String.raw`\bdecision[- ](trail|log)s?\b`,
  // "our encoding decisions are public".
  String.raw`\b(encoding|encoder['’]?s?|model['’]?s?|agent['’]?s?|interpretive|our|its|their) decisions? (is|are|was|were|gets?) (all |fully |publicly |openly )?(public|published|open|logged|recorded|traceable|auditable|visible|available|accessible)\b`,
  // "We publish encoding decisions", "publishes its decisions".
  String.raw`\bpublish(es|ed|ing)? ((its|our|every|each|all|the (encoder|model|agent)['’]s) )?(encoding|encoder|model|agent|interpretive) decisions?\b|\bpublish(es|ed|ing)? (its|our|every|each|all|the (encoder|model|agent)['’]s) decisions?\b`,
].map((source) => new RegExp(source, 'gi'))
const DECISION_LOG_NOUN = DECISION_CLAIMS[3]
const TRACE_NOUN = String.raw`(?<noun>traces?|transcripts?|reasoning|chains? of thought|thought process(es)?)`
// "publishes every encoder trace", "keeps its full reasoning". A possessive
// noun ("the trace's path") describes something else.
const TRACE_ACTIVE = new RegExp(
  String.raw`\b(publish(es|ed|ing)?|keeps?|kept|keeping|retains?|retained|archives?|archived|stores?|stored|saves?|saved|logs?|logged|records?|recorded|shares?|shared|exposes?|exposed|releases?|released)(?<middle>( ${WORD}){0,4}?) ${TRACE_NOUN}\b(?!['’]s\b)`,
  'gi',
)
// "Every run's trace is published", "the model's reasoning is publicly accessible".
const TRACE_PASSIVE = new RegExp(
  String.raw`\b(?<middle>(${WORD} ){0,3}?)${TRACE_NOUN} (is|are|was|were|gets?) (publicly |openly |fully |permanently )?(published|public|kept|retained|archived|stored|logged|recorded|saved|available|accessible|visible|open|shared)\b`,
  'gi',
)
// A trace sentence counts only when it is about the encoder's runs: the
// clause names the encoder, the pipeline, a model, an agent or a run, or the
// noun is reasoning. It passes when the noun is another kind of trace, when
// the words before it name a reference to the trace rather than the trace,
// and when the clause is about a failed run, whose diagnostics can keep the
// trace.
const ENCODER_SCOPE = /\b(encoder|encoders|encoding|encodings|pipeline|pipelines|model|models|agent|agents|llm|llms|ai|run|runs|session|sessions)\b/i
const OTHER_TRACE = /\b(calculation|citation|evaluation|computation|engine|replay|execution|stack|error|audit|request|network|span|rule|graph)$/i
const REFERENCE = /\b(path|paths|hash|hashes|reference|references|pointer|pointers|location|locations|name|names|sha|checksum|checksums|id|ids)\b/i
const FAILED_RUN = /\bfail(s|ed|ing|ure|ures)?\b/i
const DETERMINER = /\b(every|each|all|its|their)\b/i

function traceClaim(clause: string, m: RegExpMatchArray, passive: boolean) {
  const middle = (m.groups?.middle ?? '').trim()
  if (REFERENCE.test(middle) || OTHER_TRACE.test(middle) || FAILED_RUN.test(clause)) return false
  if (m.groups?.noun.toLowerCase() === 'reasoning' || ENCODER_SCOPE.test(clause)) return true
  // A passive sentence may scope the trace with a determiner alone: "Its
  // traces are public".
  return passive && DETERMINER.test(middle)
}

function* clauses(text: string): Generator<[number, string]> {
  let start = 0
  for (const brk of text.matchAll(CLAUSE_BREAK)) {
    yield [start, text.slice(start, brk.index)]
    start = brk.index + brk[0].length
  }
  yield [start, text.slice(start)]
}

/** Each claim about the encoder's record in `text`, read one clause at a
 *  time. A match passes when a negation sits between the start of its clause
 *  and the end of the match ("We do not keep a decision log"); a bare
 *  "decision log" or "decision trail" passes with a negation anywhere in its
 *  clause ("Decision logs are not kept"). */
function encoderRecordClaims(raw: string): string[] {
  // Runs of spaces (a removed comment, a double space) read as one.
  const text = raw.replace(/[^\S\n]+/g, ' ')
  const hits: [number, string][] = []
  for (const [start, clause] of clauses(text)) {
    const found: [RegExpMatchArray, RegExp][] = DECISION_CLAIMS.flatMap((re) =>
      [...clause.matchAll(re)].map((m): [RegExpMatchArray, RegExp] => [m, re]),
    )
    for (const [re, passive] of [[TRACE_ACTIVE, false], [TRACE_PASSIVE, true]] as const) {
      for (const m of clause.matchAll(re)) if (traceClaim(clause, m, passive)) found.push([m, re])
    }
    for (const [m, re] of found) {
      const end = re === DECISION_LOG_NOUN ? clause.length : m.index! + m[0].length
      if (!NEGATION.test(clause.slice(0, end))) hits.push([start + m.index!, m[0]])
    }
  }
  return hits.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)).map(([, claim]) => claim)
}

const FIXTURES_PATH = join(process.cwd(), 'src/test/encoder-record-fixtures.json')
const FIXTURES_SHA256 = '2e6ea4f345cd40ba48ba588da9a1d31f02aa65f7b5081803d721b50a80a8128a'
const FIXTURES: { text: string; banned: boolean }[] = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')).cases

// Rendered text with a line break at each block element, so a heading never
// runs into the paragraph under it, followed by the accessible names and
// titles the page carries in attributes.
const BLOCK_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'TD', 'TH', 'DD', 'DT', 'BUTTON', 'CAPTION', 'FIGCAPTION', 'PRE', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'HEADER', 'FOOTER', 'FIGURE', 'SUMMARY', 'LABEL', 'NAV', 'MAIN', 'ASIDE', 'UL', 'OL', 'TABLE', 'TR'])
const TEXT_ATTRIBUTES = ['aria-label', 'aria-description', 'alt', 'title', 'placeholder']
function pageText(renderSurface: () => ReturnType<typeof render>) {
  const { container, unmount } = renderSurface()
  const parts: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '')
    else if (node instanceof Element) {
      const block = BLOCK_TAGS.has(node.tagName)
      if (block) parts.push('\n')
      node.childNodes.forEach(walk)
      if (block) parts.push('\n')
    }
  }
  walk(container)
  const attributes = [...container.querySelectorAll('*')].flatMap((el) =>
    TEXT_ATTRIBUTES.map((name) => el.getAttribute(name)).filter((v): v is string => !!v),
  )
  unmount()
  return [parts.join(''), ...attributes].join('\n').replace(/[^\S\n]+/g, ' ')
}

// Every string an exported overview constant holds, nested ones included, so
// the audience panels the page renders one at a time are read too.
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn)
  return []
}

const ENTITIES: Record<string, string> = {
  '&apos;': "'", '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&quot;': '"',
  '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&nbsp;': ' ', '&amp;': '&', '&middot;': '·', '&sect;': '§',
}
const decodeEntities = (text: string) => text.replace(/&[a-z]+;/g, (e) => ENTITIES[e] ?? e)

// The copy a TypeScript or TSX file can put on a page, read with the
// TypeScript parser so comments never count: every string literal and
// template text, each top-level JSX element's text with its children in
// order (a line break at each block tag), and the accessible names and
// titles in JSX attributes.
const BLOCK_JSX = /^(p|li|h[1-6]|div|td|th|dd|dt|button|caption|figcaption|pre|section|article|blockquote|header|footer|figure|summary|label|nav|main|aside|ul|ol|table|tr)$/
function sourceCopy(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const copy: string[] = []
  const literal = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => ' ' + span.literal.text)].join('')
    if (ts.isParenthesizedExpression(node)) return literal(node.expression)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left)
      const right = literal(node.right)
      return left === null && right === null ? null : (left ?? ' ') + (right ?? ' ')
    }
    return null
  }
  const tagName = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
    (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText(file)
  const jsxText = (node: ts.JsxChild | ts.JsxElement | ts.JsxFragment): string => {
    if (ts.isJsxText(node)) return decodeEntities(node.text.replace(/\s+/g, ' '))
    if (ts.isJsxExpression(node)) return node.expression ? (literal(node.expression) ?? ' ') : ''
    if (ts.isJsxSelfClosingElement(node)) return ' '
    const inner = node.children.map(jsxText).join('')
    if (ts.isJsxFragment(node)) return inner
    return BLOCK_JSX.test(tagName(node)) ? `\n${inner}\n` : inner
  }
  const visit = (node: ts.Node, inJsx: boolean) => {
    if (!inJsx && (ts.isJsxElement(node) || ts.isJsxFragment(node))) copy.push(jsxText(node))
    if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.includes(node.name.getText(file)) && node.initializer) {
      const value = ts.isStringLiteral(node.initializer) ? node.initializer.text : node.initializer.expression && literal(node.initializer.expression)
      if (value) copy.push(decodeEntities(value))
    }
    const text = literal(node)
    if (text !== null) {
      copy.push(text)
      return
    }
    node.forEachChild((child) => visit(child, inJsx || ts.isJsxElement(node) || ts.isJsxFragment(node)))
  }
  visit(file, false)
  return copy
}

// Every file under src/ that can carry page copy: TypeScript and TSX through
// the parser, Markdown as text, and JSON through its string values (the
// planning page draws visible notes from src/data/planning). Tests, type
// declarations and src/test/ (which holds these fixtures) are skipped.
function copyFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : copyFiles(path)
    return /\.(tsx?|mdx?|json)$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name) ? [path] : []
  })
}
function fileCopy(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  if (path.endsWith('.json')) return stringsIn(JSON.parse(source))
  if (/\.mdx?$/.test(path)) return [source]
  return sourceCopy(path, source)
}

// The PDF print source: text with styles, scripts and comments dropped, a
// line break at each block tag, and alt and title attributes kept.
function htmlCopy(html: string) {
  const attributes = [...html.matchAll(/\b(?:alt|title|aria-label)="([^"]*)"/g)].map((m) => m[1])
  const text = html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|li|h[1-6]|div|td|th|tr|table|ul|ol|section|header|footer)\b[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities([text, ...attributes].join('\n')).replace(/[^\S\n]+/g, ' ')
}

describe('encoder record claims', () => {
  it('reads the fixtures it shares with ops comms/check_claims.py', () => {
    const digest = createHash('sha256').update(readFileSync(FIXTURES_PATH)).digest('hex')
    expect(
      digest,
      'the fixtures changed: copy ops comms/encoder-record-fixtures.json here and update FIXTURES_SHA256 in both repos',
    ).toBe(FIXTURES_SHA256)
  })

  it('reproduces every fixture label', () => {
    const wrong = FIXTURES.filter((c) => encoderRecordClaims(c.text).length > 0 !== c.banned)
    expect(wrong).toEqual([])
  })

  const plainClaims = FIXTURES.filter((c) => c.banned && c.text.split('.').length === 2).map((c) => c.text)
  const plainAllowed = FIXTURES.filter((c) => !c.banned && c.text.split('.').length === 2).map((c) => c.text)
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

  const RENDERED = [...SURFACES, ['/overview', () => render(<OverviewPage />)]] as const
  for (const [route, renderSurface] of RENDERED) {
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

  // A backstop for pages no test renders: every file under src/ that can
  // carry copy.
  it('no source file makes such a claim', () => {
    const root = join(process.cwd(), 'src')
    const hits = copyFiles(root).flatMap((path) =>
      fileCopy(path).flatMap(encoderRecordClaims).map((claim) => `${relative(root, path)}: ${claim}`),
    )
    expect(hits).toEqual([])
  })
})

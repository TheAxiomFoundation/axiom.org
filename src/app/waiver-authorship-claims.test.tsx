import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import fc from 'fast-check'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

import AboutPage from '@/app/about/page'
import ValidationPage from '@/app/validation/page'
import VerifyPage from '@/app/verify/page'
import ReceiptsPage from '@/app/receipts/page'
import { EncodedLawSection } from '@/components/landing/encoded-law-section'
import { EncoderSection } from '@/components/landing/encoder-section'
import { PlanningModelPage } from '@/components/ops/planning-model-page'

// Two facts the copy must not contradict, both read from code on 2026-10-03.
// - CI skips the tests of waived modules. rulespec-us known-validation-gaps.yaml
//   (2066cef61, 2026-10-02) lists 1,940 modules with an active waiver, and
//   the shared workflow rulespec-us pins (TheAxiomFoundation/.github
//   validate-rulespec.yml@df2dfb53) skips them in "Validate RuleSpec YAML",
//   "Execute RuleSpec companion tests" and "Validate RuleSpec proofs and
//   claims". Joined to axiom-oracles dashboard/public/data/
//   rule_verification.json (rulespec 54d90a72, 2026-09-28), they hold 23,735
//   of 34,810 US rules.
// - The encoder did not write every rule. Of those 34,810 rules, 16,280 match
//   only a manifest whose tool begins `axiom-encode encode`: 15,412 with the
//   exact `--apply` string, 822 from sandbox-recovered manifests, 27 from
//   three other `--apply (…)` variants, and 19 from one manifest whose tool is
//   bare `axiom-encode encode`. 15,279 match only one written by
//   `axiom-encode sign-applied-files` (backend manual, runner
//   manual-attestation, no model); 11,201 of those are the generated US
//   tariff schedule.
const RENDERED = [
  ['/about', () => render(<AboutPage />)],
  ['/validation', () => render(<ValidationPage />)],
  ['/verify', () => render(<VerifyPage />)],
  ['/receipts', () => render(<ReceiptsPage />)],
  ['/ (encoded law section)', () => render(<EncodedLawSection />)],
  ['/ (encoder section)', () => render(<EncoderSection />)],
  ['/ops/planning', () => render(<PlanningModelPage />)],
] as const

// /stack and /encoder render one selected stage at a time, so most of their
// copy never reaches the DOM in a test. Read those strings from source.
const SOURCES = [
  ['/stack', 'src/components/stack/stack-system-page.tsx'],
  ['/stack (trust overlay)', 'src/lib/stack-trust.ts'],
  ['/encoder', 'src/components/encoder/encoder-system-page.tsx'],
] as const

// Join text nodes with spaces so adjacent elements don't glue words together,
// and start a new line at each block element and <br> so a heading with no
// closing period never runs into the paragraph under it.
const BLOCK = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'TD', 'TH', 'DD', 'DT', 'BUTTON', 'CAPTION', 'FIGCAPTION', 'PRE', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'HEADER', 'FOOTER', 'FIGURE', 'SUMMARY', 'LABEL'])
function blockOf(node: Node) {
  let el = node.parentElement
  while (el && !BLOCK.has(el.tagName)) el = el.parentElement
  return el
}
function renderedText(renderSurface: () => ReturnType<typeof render>) {
  const { container, unmount } = renderSurface()
  container.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  let block: Element | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode
    const nodeBlock = blockOf(node)
    parts.push(nodeBlock === block ? ' ' : '\n', node.textContent ?? '')
    block = nodeBlock
  }
  unmount()
  return parts.join('').replace(/[^\S\n]+/g, ' ')
}

// Strip JSX tags and entities so `every <Link>rule</Link> is tested` reads
// as one phrase. Each string literal, closing block tag and <br> ends a line,
// so one array item or object field never borrows the next one's waiver
// clause.
function sourceTextOf(source: string) {
  return source
    .replace(/\{" "\}/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/(["`])\s*(?=[,;)\]}])/g, '$1\n')
    .replace(/<\/(?:p|li|h[1-6]|div|td|th|dd|dt|button|section|article|blockquote|header|footer|figure)>|<br\s*\/?>/g, '\n')
    .replace(/<\/?[A-Za-z][^<>\n]*>/g, ' ')
}
function sourceText(path: string) {
  return sourceTextOf(readFileSync(join(process.cwd(), path), 'utf8'))
}

// A line break, or a period followed by a space and a capital, quote or
// bracket, ends a sentence; "U.S.C. is" and "0.30" do not.
function sentences(text: string) {
  return text.split(/\n+|(?<=[.!?])\s+(?=[A-Z"“(\[])/).map((sentence) => sentence.trim()).filter(Boolean)
}

// "every rule", "every US rule", "all 34,810 rules", "each RuleSpec module",
// "every single rule".
const QUALIFIER = String.raw`(?:(?:of )?(?:our|the|its|US|U\.S\.|RuleSpec|encoded|published|federal|state|single|one|last|\d[\d,]*) )*`
const NOUN = String.raw`(?:draft encoding|draft|encoding|published rule|rule module|rule|module|provision|statute)s?`
const UNIVERSAL = String.raw`(?<!\bnot )\b(?:every|each|all) ${QUALIFIER}${NOUN}\b`
const TESTED = String.raw`(?:tested|validated|verified|test suite|must compile|compiles? and pass|pass(?:es|ed)? (?:its|their|the) (?:companion )?tests?|pass(?:es|ed)? CI|passing tests|(?:has|have) been tested|(?:covered|backed) by tests|(?:ships|lands|comes) with (?:a |its )?(?:companion )?tests?|clears? (?:the |every |all |\w+ )?gates?)`
const AUTHOR = String.raw`(?:AI|agentic|agents?|models?|encoder|pipeline|Codex|GPT[\w.-]*|Claude|LLMs?)`

const UNIVERSAL_TESTING = [
  new RegExp(String.raw`${UNIVERSAL}.{0,80}\b${TESTED}`, 'i'),
  new RegExp(String.raw`\b${TESTED}.{0,30}${UNIVERSAL}`, 'i'),
  new RegExp(String.raw`\btests? ${UNIVERSAL}`, 'i'),
  /\b(?:rules|encodings|modules) (?:are|were) all (?:tested|validated|verified)\b/i,
  /\b(?:nothing|no (?:rule|encoding|module|draft)) (?:ships|merges|reaches the corpus|is published) without\b/i,
  /\bencoded,? (?:and |& )?(?:tested|verified|validated)\b/i,
]
const UNIVERSAL_AUTHORSHIP = [
  new RegExp(String.raw`${UNIVERSAL}(?: [^.]{0,40})? (?:is |are |was |were )?(?:produced|written|drafted|generated|encoded|came out of|comes out of) (?:by |of )?(?:an |the |our )?(?:AI )?${AUTHOR}`, 'i'),
  new RegExp(String.raw`\b${AUTHOR}s? (?:wrote|writes|encoded|encodes|drafted|drafts|generated|generates|produced|produces) (?:every|each|all)\b`, 'i'),
  new RegExp(String.raw`\b(?:every|each|all) ${QUALIFIER}${NOUN} (?:has|have|comes with) (?:an |its )?agent logs?\b`, 'i'),
  /\bagent logs? (?:behind|for|from) (?:every|each|all)\b/i,
  /\bper-(?:encoding|rule) agent logs?\b/i,
  /\bpipeline output\b/i,
]

// A negation covers its own clause and nothing past it. A clause ends at
// sentence or clause punctuation (not the comma in "34,810"), a spaced hyphen,
// slash, bar or ampersand, a conjunction or subordinator, or the next
// universal subject. So "Every rule is not documented, but each rule is
// tested", "Not every rule is documented and each rule is tested" and "We do
// not merge until every rule passes CI" are still universal claims. The cost
// is that "Every rule is not tested and verified" is flagged too; "Not every
// rule is tested or verified" passes. Double negation ("not true that not
// every…") is not resolved.
const QUANTIFIER = /\b(?:every|each|all)\b/gi
const CLAUSE_BREAK = String.raw`,(?!\d)|(?<!\d),|[;:!?…—–―()[\]|]|\.(?=\.|\s+[^\sa-z]|[A-Z][a-z])|\s(?:--?|/|&)\s|\b(?:and|but|yet|so|then|while|whilst|whereas|although|though|because|since|until|unless|without|before|after|when|whenever|once|if|which|where)\b|\b(?:every|each|all) (?=${QUALIFIER}${NOUN}\b)`
const CLAUSE_END = new RegExp(CLAUSE_BREAK, 'i')
function clauseEnd(sentence: string, from: number) {
  const next = CLAUSE_END.exec(sentence.slice(from))
  return next ? from + next.index : sentence.length
}

// "not", "never" or "nor" as a word of its own ("not-for-profit" is not one),
// except "not only" and "not just", which add to a claim rather than deny it.
const NOT = String.raw`(?<![-\w])(?:not|never|nor)(?![-\w])(?! (?:only|just|merely|simply|solely)\b)`

// A negation or fraction that scopes a quantifier passes: "Not every rule is
// tested", "We do not claim that every rule…", "Fewer than half of all
// rules…", "40% of all rules…". "Not" scopes only the next quantifier in its
// own clause; "fewer than", "less than" and a fraction scope only the one
// right after them. A "no" or "not" elsewhere does not: "No exceptions: every
// rule is tested" is still a universal claim, and so is "100% of all rules".
const SCOPED = new RegExp(String.raw`(?:${NOT}(?:(?!${CLAUSE_BREAK}).){0,30}|\b(?:fewer|less) than |\b(?:(?!100(?:\.0+)?%)\d[\d.,]*%|half|most|some|none|few|many) of (?:our |the )?|^of )$`, 'i')
// "Every rule is not tested" and "…, nor is it tested" negate a predicate, up
// to the end of its clause. The subject stays readable, so it still pairs
// with a predicate in a later clause: "Every rule is not hand-written and is
// tested in CI" is a claim.
const NEGATED_PREDICATE = new RegExp(String.raw`${UNIVERSAL} (?:is|are|was|were) ${NOT}|(?<![-\w])nor(?![-\w])`, 'gi')

// Blank what each negation covers, keeping every index and period in place:
// a scoped quantifier with the rest of its clause, and a negated predicate.
// The claim patterns then run on what is left, so one negated clause can't
// hide a claim in another, and blanking can only remove a match, never make
// one.
function withoutNegations(sentence: string) {
  const spans: [number, number][] = []
  for (const m of sentence.matchAll(QUANTIFIER)) {
    if (SCOPED.test(sentence.slice(0, m.index))) spans.push([m.index, clauseEnd(sentence, m.index + m[0].length)])
  }
  for (const m of sentence.matchAll(NEGATED_PREDICATE)) {
    const from = m.index + m[0].length
    spans.push([from, clauseEnd(sentence, from)])
  }
  return spans.reduce((text, [start, end]) => text.slice(0, start) + text.slice(start, end).replace(/[^.]/g, '·') + text.slice(end), sentence)
}

// A testing claim passes when its own sentence carves out the waiver list,
// the way the approved wording does ("…before it merges, unless its module
// sits on a public waiver list"). A bare mention of the list does not.
const WAIVER_EXCEPTION = /\b(?:unless|except|outside|other than|not on)\b[^.]{0,80}\bwaiver list\b/i

// Sentences that make a universal testing or authorship claim.
function universalClaims(text: string) {
  return sentences(text).filter((sentence) => {
    const claims = withoutNegations(sentence)
    if (UNIVERSAL_TESTING.some((re) => re.test(claims)) && !WAIVER_EXCEPTION.test(sentence)) return true
    return UNIVERSAL_AUTHORSHIP.some((re) => re.test(claims))
  })
}

function expectNoUniversalClaims(text: string) {
  expect(universalClaims(text)).toEqual([])
}

// A backstop: a page that says merging requires passing tests, or that CI
// runs the companion tests, names the public waiver list somewhere.
function expectWaiverDisclosure(text: string) {
  const claimsGate =
    /must compile and pass/i.test(text) ||
    /\bwe validate compil/i.test(text) ||
    /\bCI (runs|executes)\b[^.]{0,60}\btests?\b/i.test(text) ||
    /\bcompanion tests?\b[^.]{0,40}\b(run|pass)\b[^.]{0,20}\bin CI\b/i.test(text)
  if (claimsGate) expect(text).toMatch(/public waiver list/i)
}

describe('universal claim matcher', () => {
  const BANNED = [
    'Every encoding is tested in CI.',
    'Every US rule is tested.',
    'Each RuleSpec module passes its tests before it merges.',
    'Every rule in 26 U.S.C. is tested.',
    'Every encoding passes CI.',
    'Each draft encoding must compile and pass its test suite before it merges.',
    'Our rules are all tested.',
    'Statutes encoded & verified',
    'All 34,810 rules were written by the encoder.',
    'Each rule module is produced by an agentic encoder loop.',
    'The encoder wrote every rule.',
    'Our agents encoded each module.',
    'We publish the agent logs behind every encoding.',
    'Statutes encoded and tested',
    'Encoded, tested, and verified statutes',
    'CI tests every rule.',
    'We test every rule.',
    'Every rule ships with a companion test.',
    'Every module is covered by tests.',
    'No encoding merges without passing its tests.',
    'Every single rule is tested.',
    'Every rule clears four gates.',
    'Every rule in rulespec-us was written by an AI agent.',
    'Every rule was written by Codex.',
    'Every rule has an agent log.',
    'Every rule is tested, and the waiver list is empty.',
    'No exceptions: every rule is tested.',
    'Every rule passes CI with no exceptions at all.',
    'No rule merges without all of its tests passing.',
    'Not only is every rule tested, each one is verified against an oracle.',
    // A negation covers only its own clause or quantifier.
    'Every rule is not documented, but each rule is tested.',
    'Each rule is tested, but every rule is not documented.',
    'Every rule is not documented and each rule is tested.',
    'Every rule is not hand-written and is tested in CI.',
    'Not every rule is documented and each rule is tested.',
    'The encoder is not run by hand and every rule is tested.',
    'Each rule is tested, and every module is not verified.',
    'Every rule is not documented, and all 34,810 rules were written by the encoder.',
    'Not every rule is documented, but the encoder wrote every module.',
    'Not final. 1940 rules are all tested.',
    'Not sampled – every rule verified',
    'Not sampled - every rule verified',
    'We do not merge until every rule passes CI.',
    'It takes less than an hour to test every rule.',
    'Every rule is not just tested but proven.',
    'Not just every rule is tested — every statute is too.',
    'Our not-for-profit team tested every rule.',
    '100% of all rules are tested.',
    'Every rule is not documented – each rule is tested.',
    'Rules are not merged by hand so every rule is tested.',
    'Every US rule has an agent log.',
  ]
  const ALLOWED = [
    'A draft encoding must compile and pass its test suite before it merges, unless its module sits on a public waiver list (1,940 rulespec-us modules carried an active validation waiver on October 2, 2026, and they hold 23,735 of our 34,810 US rules; each waiver names an owner, an issue and an expiry date).',
    "In September 2026, about 16,300 of our 34,810 US rules matched a signed manifest that names the encoder's apply step, and about 15,300 more (mostly the generated US tariff schedule) were signed in by manual attestation.",
    'Not every rule is tested in CI.',
    'When the encoder writes a module, the agent runs deterministic checks.',
    'The primary text every encoding points back to.',
    'Every rule cites the provision of law it encodes, and modules carry companion tests.',
    'We do not claim that every rule is tested.',
    'Fewer than half of all rules are verified against an oracle.',
    'Not all rules are tested.',
    'Of all rules, 40% sit on a surface an oracle has verified.',
    'No, every rule is not tested.',
    'Every rule is not tested, and each rule is not verified.',
    'Not every rule is tested, and not every module is verified.',
    'Not every rule is tested or verified.',
    'Not every statute is encoded and tested.',
    'We do not test every rule.',
    'We do not claim that all 34,810 rules are encoded and tested.',
    'Not all 1,940 modules are pipeline output.',
    'Every rule is not documented, nor is it tested.',
    'Every rule is not reviewed by a domain expert at all or tested.',
    'Not every U.S. rule is tested.',
  ]

  it('keeps a heading from borrowing the next paragraph\'s waiver clause', () => {
    const text = renderedText(() =>
      render(
        <div>
          <h2>Every rule tested</h2>
          <p>A draft must pass its tests to merge unless its module sits on a public waiver list.</p>
        </div>,
      ),
    )
    expect(universalClaims(text)).toEqual(['Every rule tested'])
  })

  it('keeps a line before a <br> from scoping the line after it', () => {
    const rendered = renderedText(() => render(<h2>Never hand-edited<br />Every rule tested</h2>))
    expect(universalClaims(rendered)).toEqual(['Every rule tested'])
    expect(universalClaims(sourceTextOf('<h2>Never hand-edited<br />Every rule tested</h2>'))).toEqual(['Every rule tested'])
  })

  it('keeps one string literal from borrowing the next one\'s waiver clause', () => {
    const text = sourceTextOf(' ["Every encoding is tested in CI", "CI skips modules unless they are off the public waiver list"] ')
    expect(universalClaims(text)).toHaveLength(1)
  })

  it('keeps one object field from borrowing the next object\'s waiver clause', () => {
    const text = sourceTextOf(`[
      { id: "check", detail: "CI runs companion tests, except for modules on the public waiver list." },
      { id: "run", detail: "Every rule is tested." },
    ]`)
    const claims = universalClaims(text)
    expect(claims).toHaveLength(1)
    expect(claims[0]).toContain('Every rule is tested.')
  })

  for (const sentence of BANNED) {
    it(`flags: ${sentence}`, () => {
      expect(universalClaims(sentence)).toEqual([sentence])
    })
  }
  for (const sentence of ALLOWED) {
    it(`allows: ${sentence.slice(0, 60)}`, () => {
      expect(universalClaims(sentence)).toEqual([])
    })
  }
})

// A negated clause beside a universal claim, joined by punctuation, a
// conjunction or a dash in either order, is flagged; two clauses in the
// negated forms the guard reads are not.
describe('negation scope', () => {
  const noun = fc.constantFrom('rule', 'module', 'encoding', 'provision', 'statute', 'US rule', 'RuleSpec module', 'draft encoding', '34,810 rule')
  const predicate = fc.constantFrom('documented', 'tested', 'verified', 'tested in CI', 'covered by tests', 'hand-written', 'written by the encoder', 'reviewed by a person')
  const negation = fc
    .tuple(
      fc.constantFrom(
        (n: string, p: string) => `every ${n} is not ${p}`,
        (n: string, p: string) => `not every ${n} is ${p}`,
        (n: string, p: string) => `not all ${n}s are ${p}`,
        (n: string, p: string) => `fewer than half of all ${n}s are ${p}`,
        (n: string, p: string) => `we do not claim that every ${n} is ${p}`,
      ),
      noun,
      predicate,
    )
    .map(([clause, n, p]) => clause(n, p))
  // A negated clause with no universal subject, which the guard leaves alone,
  // still must not excuse its neighbor.
  const negatedClause = fc.oneof(
    negation,
    fc.tuple(fc.constantFrom('the encoder', 'CI', 'the waiver list'), predicate).map(([subject, p]) => `${subject} is not ${p}`),
  )
  const claim = fc
    .tuple(
      fc.constantFrom(
        (n: string) => `every ${n} is tested`,
        (n: string) => `each ${n} passes its tests`,
        (n: string) => `all ${n}s are verified`,
        (n: string) => `every ${n} passes CI`,
        (n: string) => `every ${n} ships with a companion test`,
        (n: string) => `every ${n} is covered by tests`,
        (n: string) => `CI tests every ${n}`,
        (n: string) => `we test every ${n}`,
        (n: string) => `the encoder wrote every ${n}`,
        (n: string) => `every ${n} was written by the encoder`,
        (n: string) => `all ${n}s were produced by an AI agent`,
        (n: string) => `every ${n} has an agent log`,
      ),
      noun,
    )
    .map(([clause, n]) => clause(n))
  const joiner = fc.constantFrom(', but ', ', and ', ' and ', ' but ', '; ', ': ', ' — ', ' – ', ' - ', ', while ', ' while ', ', yet ', ' whereas ', ', although ', ' because ', ' so ', ' since ', ', then ')
  const sentence = (first: string, join: string, second: string) => `${first[0].toUpperCase()}${first.slice(1)}${join}${second}.`

  it('flags a universal claim beside a negated clause', () => {
    fc.assert(
      fc.property(negatedClause, claim, joiner, fc.boolean(), (negated, universal, join, claimFirst) => {
        const text = claimFirst ? sentence(universal, join, negated) : sentence(negated, join, universal)
        expect(universalClaims(text)).toEqual([text])
      }),
      { numRuns: 2000 },
    )
  })

  it('passes two negated clauses', () => {
    fc.assert(
      fc.property(negation, negation, joiner, (first, second, join) => {
        expect(universalClaims(sentence(first, join, second))).toEqual([])
      }),
      { numRuns: 2000 },
    )
  })

  it('never lets blanking make a claim pattern match', () => {
    const word = fc.constantFrom('every', 'each', 'all', 'not', 'never', 'nor', 'not only', 'fewer than', 'half of', '100% of', 'of', 'rule', 'rules', 'US', 'U.S.', '34,810', 'is', 'are', 'tested', 'verified', 'encoded', 'written by', 'the encoder', 'wrote', 'has an agent log', 'pipeline output', 'and', 'but', 'until', 'or', ',', '.', ';', '—', '–', '-', '(', ')', 'at all', 'not-for-profit', 'CI', 'passes', 'its tests')
    fc.assert(
      fc.property(fc.array(word, { minLength: 2, maxLength: 14 }), (words) => {
        const text = words.join(' ')
        const masked = withoutNegations(text)
        expect(masked).toHaveLength(text.length)
        for (const re of [...UNIVERSAL_TESTING, ...UNIVERSAL_AUTHORSHIP]) if (re.test(masked)) expect(re.test(text)).toBe(true)
      }),
      { numRuns: 5000 },
    )
  })
})

describe('waiver and encoder-authorship claims', () => {
  for (const [route, renderSurface] of RENDERED) {
    it(`${route} claims no universal testing or encoder authorship`, () => {
      const text = renderedText(renderSurface)
      expectNoUniversalClaims(text)
      expectWaiverDisclosure(text)
    })
  }

  for (const [route, path] of SOURCES) {
    it(`${route} claims no universal testing or encoder authorship`, () => {
      const text = sourceText(path)
      expectNoUniversalClaims(text)
      expectWaiverDisclosure(text)
    })
  }

  it('/verify lists the validation waivers as an open issue with their count', () => {
    const text = renderedText(() => render(<VerifyPage />))

    expect(text).toMatch(/1,940 US modules on a public waiver list/)
    expect(text).toMatch(/they hold 23,735 of our 34,810 US rules/)
    expect(text).toMatch(/Each waiver names an owner, an issue, and an expiry date/)
    expect(text).toMatch(/all 1,940 expire on December 21, 2026/)
  })

  it('/receipts says how many US rules the encoder wrote', () => {
    const text = renderedText(() => render(<ReceiptsPage />))

    expect(text).toMatch(/about 16,300 of our 34,810 US rules matched a signed manifest that names the encoder's apply step/)
    expect(text).toMatch(/signed in by manual attestation/)
  })
})

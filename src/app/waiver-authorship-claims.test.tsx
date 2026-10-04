import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
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
//   only a manifest written by `axiom-encode encode --apply`, and 15,279 match
//   only one written by `axiom-encode sign-applied-files` (backend manual,
//   runner manual-attestation, no model); 11,201 of those are the generated
//   US tariff schedule.
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

// Join text nodes with spaces so adjacent elements don't glue words together.
function renderedText(renderSurface: () => ReturnType<typeof render>) {
  const { container, unmount } = renderSurface()
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
  unmount()
  return parts.join(' ').replace(/\s+/g, ' ')
}

// Strip JSX tags and entities so `every <Link>rule</Link> is tested` reads
// as one phrase.
function sourceText(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\{" "\}/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<\/?[A-Za-z][^<>]*>/g, ' ')
    .replace(/\s+/g, ' ')
}

// A period followed by a space and a capital, quote or bracket ends a
// sentence; "U.S.C. is" and "0.30" do not.
function sentences(text: string) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z"“(\[])/)
}

// "every rule", "every US rule", "all 34,810 rules", "each RuleSpec module".
// "Not every rule is tested" is an honest negation and passes.
const QUALIFIER = String.raw`(?:(?:of )?(?:our|the|its|US|U\.S\.|RuleSpec|encoded|published|federal|state|\d[\d,]*) )*`
const NOUN = String.raw`(?:draft encoding|draft|encoding|published rule|rule module|rule|module|provision)s?`
const UNIVERSAL = String.raw`(?<!\bnot )\b(?:every|each|all) ${QUALIFIER}${NOUN}\b`
const TESTED = String.raw`(?:tested|validated|verified|test suite|must compile|compiles? and pass|pass(?:es|ed)? (?:its|their|the) (?:companion )?tests?|pass(?:es|ed)? CI|passing tests|(?:has|have) been tested|clears? (?:the|every|all) gates?)`
const AUTHOR = String.raw`(?:AI|agentic|agents?|models?|encoder|pipeline)`

const UNIVERSAL_TESTING = [
  new RegExp(String.raw`${UNIVERSAL}.{0,80}\b${TESTED}`, 'i'),
  new RegExp(String.raw`\b${TESTED}.{0,30}${UNIVERSAL}`, 'i'),
  /\b(?:rules|encodings|modules) (?:are|were) all (?:tested|validated|verified)\b/i,
  /\bencoded (?:and|&) verified\b/i,
]
const UNIVERSAL_AUTHORSHIP = [
  new RegExp(String.raw`${UNIVERSAL} (?:is |are |was |were )?(?:produced|written|drafted|generated|encoded|came out of|comes out of) (?:by |of )?(?:an |the |our )?${AUTHOR}`, 'i'),
  new RegExp(String.raw`\b${AUTHOR}s? (?:wrote|writes|encoded|encodes|drafted|drafts|generated|generates|produced|produces) (?:every|each|all)\b`, 'i'),
  /\bagent logs? (?:behind|for|from) (?:every|each|all)\b/i,
  /\bper-(?:encoding|rule) agent logs?\b/i,
  /\bpipeline output\b/i,
]

// Sentences that make a universal testing or authorship claim. A testing
// claim passes when its own sentence names the waiver list, the way the
// approved wording does ("…before it merges, unless its module sits on a
// public waiver list").
function universalClaims(text: string) {
  return sentences(text).filter(
    (sentence) =>
      (UNIVERSAL_TESTING.some((re) => re.test(sentence)) && !/waiver list/i.test(sentence)) ||
      UNIVERSAL_AUTHORSHIP.some((re) => re.test(sentence)),
  )
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
  ]
  const ALLOWED = [
    'A draft encoding must compile and pass its test suite before it merges, unless its module sits on a public waiver list (1,940 rulespec-us modules carried an active validation waiver on October 2, 2026, and they hold 23,735 of our 34,810 US rules; each waiver names an owner, an issue and an expiry date).',
    "In September 2026, about 16,300 of our 34,810 US rules matched a manifest written by the encoder's apply step, and about 15,300 more (mostly the generated US tariff schedule) were signed in by manual attestation.",
    'Not every rule is tested in CI.',
    'When the encoder writes a module, the agent runs deterministic checks.',
    'The primary text every encoding points back to.',
    'Every rule cites the provision of law it encodes, and modules carry companion tests.',
  ]

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

    expect(text).toMatch(/about 16,300 of our 34,810 US rules matched a manifest written by the encoder's apply step/)
    expect(text).toMatch(/signed in by manual attestation/)
  })
})

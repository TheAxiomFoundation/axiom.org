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

function sourceText(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\{" "\}/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
}

const UNIVERSAL = String.raw`(every|each|all) (draft|encoding|published rule|rule module|rule|module)s?`
const TESTED = String.raw`(tested|test suite|must compile|compiles? and pass|pass(es|ed)? (its|their|the) (companion )?tests?|clears? (the|every|all) gates?)`
const AUTHORED = String.raw`(produced|written|drafted|generated|encoded|came out of|comes out of) (by |of )?(an |the |our )?(AI|agentic|agents?|models?|encoder|pipeline)`

function expectNoUniversalClaims(text: string) {
  // "Every draft must compile and pass its test suite" and "every encoding is
  // tested" are false while waived modules skip CI.
  expect(text).not.toMatch(new RegExp(String.raw`\b${UNIVERSAL}\b[^.]{0,80}\b${TESTED}`, 'i'))
  expect(text).not.toMatch(new RegExp(String.raw`\b${TESTED}[^.]{0,30}\b${UNIVERSAL}\b`, 'i'))

  // "Each rule module is produced by an agentic encoder loop" is false when
  // about 15,300 US rules were signed in by manual attestation.
  expect(text).not.toMatch(new RegExp(String.raw`\b${UNIVERSAL}\b (is |are |was |were )?${AUTHORED}`, 'i'))
  expect(text).not.toMatch(/\bagent logs? (behind|for|from) (every|each|all)\b/i)
  expect(text).not.toMatch(/\bper-(encoding|rule) agent logs?\b/i)
  expect(text).not.toMatch(/\bpipeline output\b/i)
}

function expectWaiverDisclosure(text: string) {
  // A page that says merging requires passing tests, or that CI runs the
  // companion tests, says that waived modules skip them.
  const claimsGate =
    /must compile and pass/i.test(text) ||
    /\bwe validate compil/i.test(text) ||
    /\bCI (runs|executes)\b[^.]{0,60}\btests?\b/i.test(text) ||
    /\bcompanion tests?\b[^.]{0,40}\b(run|pass)\b[^.]{0,20}\bin CI\b/i.test(text)
  if (claimsGate) expect(text).toMatch(/public waiver list/i)
}

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
  })

  it('/receipts says how many US rules the encoder wrote', () => {
    const text = renderedText(() => render(<ReceiptsPage />))

    expect(text).toMatch(/about 16,300 of our 34,810 US rules matched a manifest written by the encoder's apply step/)
    expect(text).toMatch(/signed in by manual attestation/)
  })
})

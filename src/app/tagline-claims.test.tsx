import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// The root layout loads its fonts at import time; only its metadata is
// under test here.
vi.mock('next/font/google', () => ({
  JetBrains_Mono: () => ({ variable: '--font-mono' }),
  Newsreader: () => ({ variable: '--font-serif' }),
}))
vi.mock('geist/font/sans', () => ({ GeistSans: { variable: '--font-sans' } }))
vi.mock('@/app/globals.css', () => ({}))

import { metadata as rootMetadata } from '@/app/layout'
import OverviewPage, { metadata as overviewMetadata } from '@/app/overview/page'
import { AUDIENCES, HERO } from '@/components/overview/overview-content'

// The site tagline said the encodings are "cited, computable, and
// verified". The code does not support "verified" as a property of the
// encodings: axiom-oracles' rule_verification_summary.json (generated
// 2026-09-28) puts 20,780 of 34,810 rulespec-us rules on no program
// surface that a live comparison exercises, and the one declared API
// parity case against PolicyEngine, first run on 2026-10-03, disagreed:
// $547.48 against Axiom's $478 (axiom-api#253). The root metadata is
// every page's fallback description and the share card's text, so it
// never says "verified"; nor does /overview or the print source of its
// PDF, which repeat the tagline.
const VERIFIED = /\bverified\b/i

// Join text nodes with spaces: textContent glues adjacent elements
// together ("2" + "Verified" + "A deterministic…" reads "2VerifiedA"),
// which hides the word from a pattern that ends on a word boundary.
function textOf(root: Node) {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

// The PDF is rendered from this HTML (pdf/overview/README.md). Parsing it
// drops comments and decodes every entity; the style block never reaches
// the page.
function printSource() {
  const html = readFileSync(join(process.cwd(), 'pdf/overview/axiom-overview.html'), 'utf8')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('style, script').forEach((node) => node.remove())
  return doc
}

function lastSentence(text: string) {
  return text.split(/(?<=\.)\s+/).pop()
}

describe('site tagline claims', () => {
  it('root metadata, which every page inherits, never says verified', () => {
    expect(rootMetadata.description).not.toMatch(VERIFIED)
    expect(rootMetadata.openGraph?.description).not.toMatch(VERIFIED)
    // Next fills twitter:description from openGraph; a twitter block of
    // its own would carry a description too.
    expect(JSON.stringify(rootMetadata)).not.toMatch(VERIFIED)
  })

  it('root share text fits the 200 characters X shows in a card', () => {
    // Next copies openGraph.description into twitter:description, whose
    // documented maximum is 200 characters; past that the card cuts the
    // sentence off.
    expect(rootMetadata.openGraph?.description?.length).toBeLessThanOrEqual(200)
  })

  it('root share text ends on the /overview lede\'s last sentence', () => {
    const share = rootMetadata.openGraph?.description
    expect(typeof share).toBe('string')
    expect(lastSentence(share as string)).toBe(
      lastSentence(HERO.lede)?.replace('those rules', 'them'),
    )
  })

  it('/overview metadata never says verified', () => {
    expect(JSON.stringify(overviewMetadata)).not.toMatch(VERIFIED)
  })

  it('/overview never says verified, including audience tabs not yet opened', () => {
    // Every audience panel stays mounted (hidden), so its text is here.
    const { container } = render(<OverviewPage />)
    const text = textOf(container)
    expect(text).toContain(HERO.lede)
    for (const audience of AUDIENCES) expect(text).toContain(audience.body)
    expect(text).not.toMatch(VERIFIED)
  })

  it('the overview PDF print source never says verified', () => {
    const doc = printSource()
    const text = textOf(doc.body)
    expect(text).toContain('Computable law for all')
    expect(text).not.toMatch(VERIFIED)
  })

  it('the PDF lead says what the /overview lede says', () => {
    const lead = printSource().querySelector('p.lead')
    expect(lead).not.toBeNull()
    expect((lead!.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(HERO.lede)
  })
})

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import OverviewPage, { metadata } from '@/app/overview/page'
import { WhatWeEnable } from '@/components/overview/what-we-enable'
import { SubscribeLink } from '@/components/overview/subscribe-link'
import * as overviewContent from '@/components/overview/overview-content'
import {
  formatCount,
  RULE_COVERAGE,
  US_CITATIONS,
  VALIDATION_WAIVERS,
} from '@/lib/verification-evidence'
import { htmlCopy, pageText, renderedText, stringsIn } from '@/test/claim-copy'
import {
  AUDIENCES,
  LICENSE_LINKS,
  OVERVIEW_PDF_PATH,
  SUBSCRIBE_URL,
  WHAT_WE_DO,
} from '@/components/overview/overview-content'

const printSource = () =>
  readFileSync(join(process.cwd(), 'pdf/overview/axiom-overview.html'), 'utf8')

// PR #301's mechanism audit marks these claims Removed. Keep this scoped to
// the refreshed overview surfaces: other pages need their own evidence audit.
const REMOVED_CLAIMS = [
  ['public decision logs', /\b(?:every|each|all) (?:encoding )?decisions?\b[^.!?\n]{0,80}\b(?:logged|public|recorded)\b|\b(?:logs?|records?|publish(?:es)?)\b[^.!?\n]{0,80}\b(?:every|each|all) (?:encoding )?decisions?\b/i],
  ['source text beside every decision', /\bsource (?:text )?[^.!?\n]{0,40}\b(?:beside|alongside|next to)\b[^.!?\n]{0,40}\b(?:every|each) decision\b/i],
  ['every value cites its authority', /\b(?:every|each|all) (?:numeric )?values?\b[^.!?\n]{0,30}\bcit(?:e[sd]?|ing)\b/i],
  ['only required status check', /\bonly required (?:status )?check\b/i],
  ['administrator exemption', /\badmin(?:istrator)?s?\b[^.!?\n]{0,60}\b(?:exempt\w*|bypass\w*)\b|\b(?:exempt\w*|bypass\w*)\b[^.!?\n]{0,60}\badmin(?:istrator)?s?\b/i],
  ['model never grades its own work', /\bnever grades? (?:its|their) own work\b/i],
  ['20,780 rules without comparisons', /\b20,?780\b/],
  ['encoder or manual authorship totals', /\b(?:16,?(?:280|300)|15,?(?:300|400))\b/],
  ['independent or external TAXSIM', /\b(?:independent|external)\b[^.!?\n]{0,60}\bTAXSIM\b|\bTAXSIM\b[^.!?\n]{0,60}\b(?:independent|external)\b/i],
  ['deterministic gauntlet', /\bdeterministic gauntlet\b/i],
  ['four universal shipping gates', /\bfour (?:universal )?gates\b/i],
] as const

const OVERVIEW_CLAIM_SURFACES = [
  ['overview content', () => stringsIn(overviewContent).join('\n'), () => stringsIn(overviewContent.HERO).join('\n')],
  ['PDF source', () => htmlCopy(printSource()), () => {
    const source = new DOMParser().parseFromString(printSource(), 'text/html')
    return [...source.querySelectorAll('h1, .lead')].map(renderedText).join('\n')
  }],
  ['rendered overview', () => pageText(() => render(<OverviewPage />)), () => {
    const { container, unmount } = render(<OverviewPage />)
    try {
      return renderedText(container.querySelector('header')!)
    } finally {
      unmount()
    }
  }],
] as const

describe('Overview removed claims', () => {
  for (const [surface, copy, hero] of OVERVIEW_CLAIM_SURFACES) {
    it(`${surface} keeps blanket verified positioning out of the hero`, () => {
      expect(hero()).not.toMatch(/\bverified\b/i)
    })

    for (const [claim, pattern] of REMOVED_CLAIMS) {
      it(`${surface} does not restore ${claim}`, () => {
        expect(copy()).not.toMatch(pattern)
      })
    }
  }
})

describe('Overview page', () => {
  it('titles the page for the organization and keeps the tagline underneath', () => {
    render(<OverviewPage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /the axiom foundation overview/i,
    )
    expect(screen.getByText(/computable law for all/i)).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /open the axiom app/i }).length,
    ).toBeGreaterThan(0)
    expect(screen.getByTestId('overview-pdf-link')).toHaveAttribute(
      'href',
      OVERVIEW_PDF_PATH,
    )
  })

  it('labels the three what-we-do cards Encode, Verify, and Publish', () => {
    render(<OverviewPage />)
    expect(WHAT_WE_DO.map((card) => card.label)).toEqual([
      'Encode',
      'Verify',
      'Publish',
    ])
    for (const card of WHAT_WE_DO) {
      expect(screen.getByText(card.label)).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: card.title }),
      ).toBeInTheDocument()
    }
  })

  it('reprises the download button instead of a trailing download sentence', () => {
    render(<OverviewPage />)
    const pdfLinks = screen
      .getAllByRole('link', { name: /download 1-page pdf/i })
      .map((link) => link.getAttribute('href'))
    expect(pdfLinks).toEqual([OVERVIEW_PDF_PATH, OVERVIEW_PDF_PATH])
    expect(
      screen.queryByRole('link', { name: /download this overview as a pdf/i }),
    ).not.toBeInTheDocument()
  })

  it('points at the team rather than citing years of experience', () => {
    render(<OverviewPage />)
    expect(screen.getByRole('link', { name: /meet the team/i })).toHaveAttribute(
      'href',
      '/team',
    )
    expect(screen.queryByText(/six years/i)).not.toBeInTheDocument()
  })

  it('states both licences under what we do, linked rather than asserted', () => {
    render(<OverviewPage />)
    // The split is the point: encodings and code carry different licences,
    // and the PDF makes the same claim — they must not drift apart.
    expect(screen.getByRole('link', { name: /cc by 4\.0/i })).toHaveAttribute(
      'href',
      LICENSE_LINKS.encodings,
    )
    expect(screen.getByRole('link', { name: /^mit$/i })).toHaveAttribute(
      'href',
      LICENSE_LINKS.code,
    )
  })

  it('anchors the sections the PDF links back to', () => {
    const { container } = render(<OverviewPage />)
    expect(container.querySelector('#what-we-do')).toBeInTheDocument()
    expect(container.querySelector('#what-we-enable')).toBeInTheDocument()
    expect(container.querySelector('#get-involved')).toBeInTheDocument()
  })

  it('shows one audience at a time and switches on click', () => {
    render(<WhatWeEnable />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(AUDIENCES.length)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')

    // Panels are queried by id rather than by role: `getAllByRole('tabpanel')`
    // skips the hidden ones, and the point of this test is that exactly one is
    // shown while the rest stay mounted for in-page search.
    const panelFor = (id: string) =>
      document.querySelector(`[role="tabpanel"][id$="-panel-${id}"]`)

    expect(panelFor('government')).not.toHaveAttribute('hidden')
    expect(panelFor('ai-labs')).toHaveAttribute('hidden')

    fireEvent.click(screen.getByRole('tab', { name: /ai labs/i }))

    expect(screen.getByRole('tab', { name: /ai labs/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(panelFor('ai-labs')).not.toHaveAttribute('hidden')
    expect(panelFor('government')).toHaveAttribute('hidden')
    // Still mounted, just hidden — the copy stays findable and printable.
    expect(panelFor('government')).toHaveTextContent(/stop paying to re-implement/i)
  })

  it('moves between audiences with the arrow keys and wraps at the ends', () => {
    render(<WhatWeEnable />)
    const tablist = screen.getByRole('tablist')

    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    expect(screen.getAllByRole('tab')[AUDIENCES.length - 1]).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(tablist, { key: 'End' })
    expect(screen.getAllByRole('tab')[AUDIENCES.length - 1]).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('sends the subscribe CTA to the Mailchimp list the axiom.org nav uses', () => {
    render(<SubscribeLink />)
    const link = screen.getByTestId('subscribe-link')
    expect(link).toHaveAttribute('href', SUBSCRIBE_URL)
    expect(SUBSCRIBE_URL).toContain('list-manage.com/subscribe')
    // Opens off-site, so it needs the tab-nabbing guard.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})

describe('Overview share card', () => {
  // A page-level openGraph replaces the root layout's wholesale, so the
  // block restates type, url, site name and the brand card.
  it('sets a complete openGraph and leaves twitter to the layout', () => {
    expect(metadata.openGraph).toEqual({
      type: 'website',
      url: './',
      siteName: 'Axiom Foundation',
      title: 'The Axiom Foundation — overview',
      description:
        "Open, cited, executable encodings of the world's rules, starting with tax and benefit policy.",
      images: ['/og-image.png'],
    })
    expect(metadata).not.toHaveProperty('twitter')
  })
})

describe('Overview PDF', () => {
  const pdf = () =>
    readFileSync(join(process.cwd(), 'public', OVERVIEW_PDF_PATH.replace(/^\//, '')), 'latin1')

  // pdf/overview/render.sh stamps the SHA-256 of the HTML it rendered into
  // the PDF's metadata. Editing the print source without re-rendering would
  // leave the downloadable PDF making claims the HTML no longer makes.
  // .gitattributes keeps the HTML's line endings as committed, so the hash
  // matches on any checkout.
  it('was rendered from the print source in the repo', () => {
    const source = readFileSync(join(process.cwd(), 'pdf/overview/axiom-overview.html'))
    const sha = createHash('sha256').update(source).digest('hex')

    expect(pdf().startsWith('%PDF-')).toBe(true)
    expect(pdf()).toContain(`/AxiomSourceSHA256 (${sha})`)
  })

  // The download button says "1-Page PDF". The stamp step rewrites the file
  // with pypdf, which leaves page objects uncompressed, so they can be
  // counted directly.
  it('is one page', () => {
    expect(pdf().match(/\/Type\s*\/Page\b/g) ?? []).toHaveLength(1)
  })
})

describe('Overview PDF evidence figures', () => {
  const sourceDocument = () => new DOMParser().parseFromString(printSource(), 'text/html')
  const step = (index: number) => renderedText(sourceDocument().querySelectorAll('ol.steps > li')[index])
  // The print source gives the citation measurement's month, rather than its
  // exact day. Derive that shorter label from the same measured date.
  const citationMonth = new Date(US_CITATIONS.dateLabel).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const citationFigures = `${formatCount(US_CITATIONS.citedRules)} of ${formatCount(US_CITATIONS.totalRules)} US rules cite a source`
  const waiverFigures = `${formatCount(VALIDATION_WAIVERS.activeWaivers)} entries, ${formatCount(VALIDATION_WAIVERS.waivedRules)} of ${formatCount(VALIDATION_WAIVERS.totalRules)} US rules; ${VALIDATION_WAIVERS.dateLabel}`
  const coverageFigures = `${formatCount(RULE_COVERAGE.rulesOnComparedSurface)} rules to compared programs`

  it('dates the print source to the shared coverage evidence month', () => {
    expect(renderedText(sourceDocument().querySelector('.kicker')!)).toContain(RULE_COVERAGE.month)
  })

  it('pins the citation numerator, denominator and month to the shared evidence', () => {
    expect(step(0)).toContain(`${citationFigures} (${citationMonth})`)
  })

  it('pins every waiver figure and its measured date to the shared evidence', () => {
    expect(step(1)).toContain(`(${waiverFigures})`)
  })

  it('pins the compared-surface figure and month to the shared evidence', () => {
    expect(step(1)).toContain(`${RULE_COVERAGE.month.split(' ')[0]}’s coverage map ties ${coverageFigures}`)
  })

  it('accounts for every printed number using evidence or the licence version', () => {
    const numbersIn = (copy: string) => (copy.match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? []).sort()
    const evidencedCopy = [
      RULE_COVERAGE.month,
      `${citationFigures} (${citationMonth})`,
      waiverFigures,
      coverageFigures,
      'CC BY 4.0',
    ].join('\n')

    // This inventory makes any new hand-typed figure require an evidence
    // entry, while the sentence-level checks above keep equal counts from
    // concealing a swap between different claims.
    expect(numbersIn(htmlCopy(printSource()))).toEqual(numbersIn(evidencedCopy))
  })
})

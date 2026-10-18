import { describe, expect, it } from 'vitest'
import { htmlCopy } from './claim-copy'
import { encoderRecordClaims } from './encoder-record-guard'
import reviewedExceptions from './public-html-claim-exceptions.json'
import { sweepPublicHtmlClaims } from './public-html-claims'

const TARIFF_SENTENCE = 'Reference datasets have handled this churn the way the trade-war literature’s datasets handled 2018–19: expert judgment applied by hand, encoded in scripts, and published as numbers whose reasoning lives in commit messages if it lives anywhere.'
const phrase = 'published as numbers whose reasoning'
const path = 'public/tariff/paper/web/index.html'
const clean = { hits: [], unusedExceptions: [] }
const asset = (sentence: string, file = path) => ({ path: file, html: `<p>${sentence}</p>` })

describe('reviewed exceptions for embedded public HTML', () => {
  it('allows the reviewed tariff sentence while the shared matcher still flags it', () => {
    expect(reviewedExceptions).toHaveLength(1)
    expect(encoderRecordClaims(htmlCopy(asset(TARIFF_SENTENCE).html))).toEqual([phrase])
    expect(sweepPublicHtmlClaims([asset(TARIFF_SENTENCE)])).toEqual(clean)
  })

  it('fails an edited tariff sentence claiming Axiom publishes reasoning, with the same matched phrase', () => {
    const edited = TARIFF_SENTENCE
      .replace(/^Reference datasets.*?published as/u, 'Axiom’s encoder results are published as')
      .replace('lives in commit messages if it lives anywhere', 'Axiom publishes in full')
    expect(encoderRecordClaims(htmlCopy(asset(edited).html))).toContain(phrase)
    const result = sweepPublicHtmlClaims([asset(edited)])
    expect(result).not.toEqual(clean)
    expect(result.hits).toEqual(expect.arrayContaining([expect.objectContaining({ path, phrase })]))
    expect(result.unusedExceptions).toEqual(reviewedExceptions)
  })

  it('fails the identical sentence and phrase in another public HTML file', () => {
    const other = 'public/other-paper/index.html'
    const result = sweepPublicHtmlClaims([asset(TARIFF_SENTENCE, other)])
    expect(result.hits).toEqual([expect.objectContaining({ path: other, phrase })])
    expect(result.unusedExceptions).toEqual(reviewedExceptions)
  })

  it('fails a stale exception even when there are no remaining claims', () => {
    const result = sweepPublicHtmlClaims([asset('Only the signed manifest is public.')])
    expect(result.hits).toEqual([])
    expect(result).not.toEqual(clean)
    expect(result.unusedExceptions).toEqual(reviewedExceptions)
    expect(sweepPublicHtmlClaims([]).unusedExceptions).toEqual(reviewedExceptions)
  })

  it('normalizes rendered whitespace and entities without losing sentence boundaries or code-point offsets', () => {
    const wrapped = TARIFF_SENTENCE.replace('published as', '<span>published</span>\n as').replace('whose reasoning', 'whose&#32;reasoning')
    const html = `<p>😀 A preceding sentence.</p><p>${wrapped} A following sentence.</p>`
    expect(sweepPublicHtmlClaims([{ path, html }])).toEqual(clean)
  })

  it('does not allow any additional claims in the reviewed asset', () => {
    const result = sweepPublicHtmlClaims([asset(`${TARIFF_SENTENCE} The encoder logs every decision.`)])
    expect(result.hits).toEqual([expect.objectContaining({ path, phrase: 'logs every decision' })])
    expect(result.unusedExceptions).toEqual([])
  })

  it('requires the exact matched phrase even when path and sentence digest match', () => {
    const changed = reviewedExceptions.map(entry => ({ ...entry, phrase: 'published reasoning' }))
    const result = sweepPublicHtmlClaims([asset(TARIFF_SENTENCE)], changed)
    expect(result.hits).toEqual([expect.objectContaining({ path, phrase })])
    expect(result.unusedExceptions).toEqual(changed)
  })

  it('rejects duplicate exceptions and paths outside embedded public HTML', () => {
    expect(() => sweepPublicHtmlClaims([], [...reviewedExceptions, ...reviewedExceptions])).toThrow('Duplicate')
    for (const other of ['src/app/page.tsx', 'pdf/overview/axiom-overview.html', 'public/../pdf/paper.html']) {
      expect(() => sweepPublicHtmlClaims([asset(TARIFF_SENTENCE, other)])).toThrow('public HTML path')
      expect(() => sweepPublicHtmlClaims([], reviewedExceptions.map(entry => ({ ...entry, path: other })))).toThrow('public HTML path')
    }
  })
})

import { createHash } from 'node:crypto'
import { htmlCopy } from './claim-copy'
import { encoderRecordHits } from './encoder-record-guard'
import reviewedExceptions from './public-html-claim-exceptions.json'

export type PublicHtmlClaimException = {
  path: string
  phrase: string
  sentenceSha256: string
  reason: string
}

type PublicHtmlAsset = { path: string; html: string }
type PublicHtmlHit = { path: string; offset: number; phrase: string; sentenceSha256: string }

// This allowance belongs only to this repository's public-HTML sweep. The
// shared matcher, rendered React surfaces, source and PDF checks never use it.
function requirePublicHtml(path: string): void {
  if (!path.startsWith('public/') || !/\.html?$/i.test(path) || path.includes('\\') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Expected a repository-relative public HTML path: ${path}`)
  }
}

function exceptionKey(entry: Pick<PublicHtmlClaimException, 'path' | 'phrase' | 'sentenceSha256'>): string {
  return JSON.stringify([entry.path, entry.phrase, entry.sentenceSha256])
}

function sentenceHash(text: string, offset: number): string {
  // Matcher offsets refer to original Unicode code points, not UTF-16 units.
  const points = Array.from(text)
  const boundary = (char: string) => /[.!?\n]/u.test(char)
  let start = offset, end = offset
  while (start > 0 && !boundary(points[start - 1])) start--
  while (end < points.length && !boundary(points[end])) end++
  if (end < points.length && points[end] !== '\n') end++
  // Include the full sentence (even across colons/semicolons), punctuation
  // and case. Only rendered whitespace is normalized: White_Space plus FEFF.
  const sentence = points.slice(start, end).join('').replace(/[\p{White_Space}\ufeff]+/gu, ' ').trim()
  return createHash('sha256').update(sentence).digest('hex')
}

/** A reviewed exception must be consumed by an actual hit in this complete
 * sweep. Missing files, changed sentences/phrases and removed claims leave an
 * unused entry, which fails alongside any unreviewed claim. */
export function sweepPublicHtmlClaims(
  assets: readonly PublicHtmlAsset[],
  exceptions: readonly PublicHtmlClaimException[] = reviewedExceptions,
): { hits: PublicHtmlHit[]; unusedExceptions: PublicHtmlClaimException[] } {
  const remaining = new Map<string, PublicHtmlClaimException>()
  for (const entry of exceptions) {
    requirePublicHtml(entry.path)
    if (!entry.phrase || !/^[a-f0-9]{64}$/.test(entry.sentenceSha256) ||
        !entry.reason.trim() || /[\r\n\u0085\u2028\u2029]/u.test(entry.reason)) {
      throw new Error(`Invalid reviewed public HTML exception: ${entry.path}`)
    }
    const key = exceptionKey(entry)
    if (remaining.has(key)) throw new Error(`Duplicate reviewed public HTML exception: ${entry.path}`)
    remaining.set(key, entry)
  }
  const allowed = new Set(remaining.keys())
  const hits: PublicHtmlHit[] = []
  for (const asset of assets) {
    requirePublicHtml(asset.path)
    const text = htmlCopy(asset.html)
    for (const [offset, phrase] of encoderRecordHits(text)) {
      const hit = { path: asset.path, offset, phrase, sentenceSha256: sentenceHash(text, offset) }
      const key = exceptionKey(hit)
      if (allowed.has(key)) remaining.delete(key)
      else hits.push(hit)
    }
  }
  return { hits, unusedExceptions: [...remaining.values()] }
}

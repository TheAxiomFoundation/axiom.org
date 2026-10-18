import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encoderRecordClaims, encoderRecordHits, markdownClaims } from './encoder-record-guard'

// Ops owns the canonical fixture generator, JSON, digest, and labels. This
// snapshot was evaluated by its Python guard at the immutable commit below.
// scripts/check-encoder-record-reference.py --ops ../ops verifies local git
// objects, fixture bytes/digest, working Python source and freshly run outputs
// without network access. CI here needs only these committed artifacts.
//
// Both repositories enforce LOCAL pins: ops CI checks its own generator,
// bytes, digest and labels; this CI checks this snapshot's bytes and exact
// TypeScript outputs. Ops CI does not call our script. Neither test requires
// the peer to adopt a later one-sided update or enforces synchronized merges.
const OPS_COMMIT = 'e213e806bc3bc2a084f1da89bf0f02a1f78d160d'
const FIXTURE_SHA256 = 'f266b1add1d0239662823f10aa8ba4f5a94345f9d3dd82ec4e88efda762b8cf3'
const REFERENCE_SHA256 = '0f8250d7f6daa05c75f6aa27334592fdfa910d3375613d314e274d9761e22531'
const fixturePath = join(process.cwd(), 'src/test/encoder-record-fixtures.json')
const referencePath = join(process.cwd(), 'src/test/encoder-record-reference.json')
const fixtures: { text: string; banned: boolean; markdown?: boolean }[] = JSON.parse(readFileSync(fixturePath, 'utf8')).cases
type Hits = [number, string][]
type Output = { hits: Hits; markdown?: Hits }
const reference: {
  opsCommit: string
  fixtureSha256: string
  guardSha256: string
  cases: Output[]
  reviewProbes: (Output & { family: string; text: string })[]
} = JSON.parse(readFileSync(referencePath, 'utf8'))

function actualOutputs(text: string, markdown = false): Output {
  return {
    hits: encoderRecordHits(text),
    ...(markdown ? { markdown: markdownClaims(text) } : {}),
  }
}

describe('pinned Python encoder-record differential', () => {
  it('pins canonical fixture/digest bytes and exact Python outputs to an immutable ops snapshot', () => {
    expect(createHash('sha256').update(readFileSync(fixturePath)).digest('hex')).toBe(FIXTURE_SHA256)
    expect(readFileSync(fixturePath.replace(/\.json$/, '.sha256'), 'utf8')).toBe(`${FIXTURE_SHA256}  encoder-record-fixtures.json\n`)
    expect(createHash('sha256').update(readFileSync(referencePath)).digest('hex')).toBe(REFERENCE_SHA256)
    expect(reference.opsCommit).toBe(OPS_COMMIT)
    expect(reference.fixtureSha256).toBe(FIXTURE_SHA256)
    expect(reference.guardSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(fixtures).toHaveLength(1609)
    expect(reference.cases).toHaveLength(fixtures.length)
  })

  it('reproduces all 1,609 canonical labels, including complete Markdown blocks', () => {
    const disagreements = fixtures.flatMap((fixture, index) => {
      const claims = fixture.markdown ? markdownClaims(fixture.text) : encoderRecordClaims(fixture.text)
      return (claims.length > 0) === fixture.banned ? [] : [{ index, ...fixture, claims }]
    })
    expect(disagreements).toEqual([])
  })

  it('matches the exact Python hit lists, code-point offsets and Markdown diagnostic lines for every fixture', () => {
    const disagreements = fixtures.flatMap((fixture, index) => {
      const actual = actualOutputs(fixture.text, fixture.markdown)
      const expected = reference.cases[index]
      return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [{ index, text: fixture.text, expected, actual }]
    })
    expect(disagreements).toEqual([])
    // The public string-only entry point must retain duplicate and sorted hits.
    for (const fixture of fixtures) {
      expect(encoderRecordClaims(fixture.text)).toEqual(encoderRecordHits(fixture.text).map(([, claim]) => claim))
    }
  })

  it('agrees on 35 additional NEL, FEFF and astral-gap probes from all three printed review disagreement families', () => {
    expect(reference.reviewProbes).toHaveLength(35)
    expect([...new Set(reference.reviewProbes.map((probe) => probe.family))]).toEqual([
      'review-nel', 'review-feff', 'review-astral-gap',
    ])
    const disagreements = reference.reviewProbes.flatMap(({ family, text, hits }) => {
      const actual = encoderRecordHits(text)
      return JSON.stringify(actual) === JSON.stringify(hits) ? [] : [{ family, text, expected: hits, actual }]
    })
    expect(disagreements).toEqual([])
  })
})

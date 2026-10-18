import { describe, expect, it } from 'vitest'
import {
  blankAllowedClaims,
  encoderRecordClaims,
  encoderRecordHits,
  markdownClaims,
  markdownParagraphs,
  normalizeClaimSpaces,
} from './encoder-record-guard'

describe('reference encoder-record predicate and noun scope', () => {
  const affirmative: [string, string][] = [
    ['No setup is required and the encoder logs every decision.', 'logs every decision'],
    ['The encoder not only applies an encoding but logs every decision.', 'logs every decision'],
    ['The encoder not only logs every decision.', 'logs every decision'],
    ['No matter what happens, the encoder logs every decision.', 'logs every decision'],
    ['We keep a decision log without requiring a subscription.', 'decision log'],
    ['The encoder publishes traces whether a run succeeds or fails.', 'publishes traces'],
    ['The encoder publishes every successful trace and retains failed diagnostics.', 'publishes every successful trace'],
    ['The encoder publishes a hash and its reasoning.', 'publishes a hash and its reasoning'],
    ['The encoder publishes a hash of its trace and its reasoning.', 'publishes a hash of its trace and its reasoning'],
    ['The encoder publishes a hash of its trace, and its reasoning.', 'publishes a hash of its trace, and its reasoning'],
    ['The encoder publishes a trace of a successful run and retains failed diagnostics.', 'publishes a trace'],
    ['The encoder publishes its successful trace of a failed run.', 'publishes its successful trace'],
    ['The encoder publishes its reasoning and no trace.', 'publishes its reasoning'],
  ]
  it.each(affirmative)('keeps the affirmative predicate in %s', (text, claim) => {
    expect(encoderRecordClaims(text)).toEqual([claim])
  })

  const denials = [
    'The encoder does not log every decision.',
    'The encoder never publishes its reasoning.',
    'The encoder publishes no trace.',
    'The encoder does not keep a decision log.',
    'The encoder has no decision log.',
    'A decision log is not kept.',
    'Not every decision is logged.',
    'No encoder trace is published.',
  ]
  it.each(denials)('honors predicate/noun-bound denial: %s', text => {
    expect(encoderRecordClaims(text)).toEqual([])
  })

  const exemptions = [
    'The encoder saves a trace on the local machine.',
    'The encoder stores its trace locally.',
    'The encoder keeps its traces on the machine that ran it.',
    'Failed encoder runs retain their trace.',
    'The encoder retains the failed run trace.',
    'The encoder publishes a trace of a failed run.',
    'The encoder publishes the path to its trace.',
    'The encoder publishes its trace\'s path.',
    'The encoder publishes calculation traces.',
  ]
  it.each(exemptions)('permits only the scoped diagnostic/reference: %s', text => {
    expect(encoderRecordClaims(text)).toEqual([])
  })

  const localClaims: [string, string][] = [
    ['The encoder publishes its trace locally.', 'publishes its trace'],
    ['The encoder stores its transcript locally.', 'stores its transcript'],
    ['The encoder keeps its reasoning locally.', 'keeps its reasoning'],
    ['The encoder keeps a decision log locally.', 'decision log'],
  ]
  it.each(localClaims)('keeps unsupported local claims: %s', (text, claim) => {
    expect(encoderRecordClaims(text)).toEqual([claim])
  })

  it('does not treat a new passive predicate as an earlier verb object', () => {
    expect(encoderRecordClaims('The encoder publishes a trace and its reasoning is kept locally.')).toEqual([
      'publishes a trace', 'trace and its reasoning is kept',
    ])
  })
  it('preserves duplicate matches, original case, and Python order', () => {
    expect(encoderRecordHits('The encoder PUBLISHES its decisions.')).toEqual([
      [12, 'PUBLISHES its decisions'], [12, 'PUBLISHES its decisions'],
    ])
  })
})

describe('reference normalization and code-point offsets', () => {
  const spaces = [
    '\t', '\v', '\f', '\r', ' ', '\u0085', '\u00a0', '\u1680',
    ...Array.from({ length: 11 }, (_, index) => String.fromCodePoint(0x2000 + index)),
    '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
  ]
  it.each(spaces)('normalizes specified whitespace %j', space => {
    expect(encoderRecordClaims(`The encoder logs every${space}${space}decision.`)).toEqual(['logs every decision'])
  })
  it.each(['\u001c', '\u001d', '\u001e', '\u001f', '\u200b'])('preserves excluded whitespace %j', space => {
    expect(encoderRecordClaims(`Every${space}decision is logged.`)).toEqual([])
  })
  it.each(['.', '!', '?', ';', ':', '—', '\n', '--', ', and ', ', BUT ', ', so ', ', yet ', ', while '])('treats %j as a hard clause boundary', separator => {
    expect(encoderRecordClaims(`The encoder logs every${separator}decision.`)).toEqual([])
  })
  it('counts astral wildcard gaps as Unicode code points', () => {
    const emoji = '😀'.repeat(10)
    expect(encoderRecordClaims(`The encoder logs ${emoji} every decision.`)).toEqual([`logs ${emoji} every decision`])
    expect(encoderRecordClaims(`The encoder logs ${'😀'.repeat(20)} every decision.`)).toEqual([])
  })
  it('maps offsets back through astral text and collapsed whitespace', () => {
    expect(encoderRecordHits('😀\u0085\ufeffThe encoder logs every decision.')).toEqual([[15, 'logs every decision']])
    expect(normalizeClaimSpaces('😀\t\tX')).toEqual({ text: '😀 X', offsets: [0, 0, 1, 3] })
  })
  it.each(['The encoder Keeps its decisions.', 'The encoder ſaves its decisions.', 'Every naïve decision is logged.'])('keeps ASCII word/case semantics: %s', text => {
    expect(encoderRecordClaims(text)).toEqual([])
  })
})

describe('reference Markdown boundaries and line diagnostics', () => {
  it('joins wrapped blockquotes at the same quote depth', () => {
    expect(markdownClaims('> The encoder logs every\n> decision.')).toEqual([[1, 'logs every decision']])
    expect(markdownClaims('> Every rule is\n> validated.')).toEqual([[1, 'Every rule is validat']])
    expect(markdownClaims('> The encoder does not log every\n> decision.')).toEqual([])
  })
  it('separates quote depths, new list items and standalone headings', () => {
    for (const text of [
      '> The encoder logs every\n>> decision.',
      '- The encoder logs every\n- decision.',
      '# The encoder logs every\ndecision.',
      'The encoder logs every\n*Internal note describing internal evidence*\ndecision.',
    ]) expect(markdownClaims(text)).toEqual([])
    expect(markdownClaims('- The encoder logs every\n  decision.')).toEqual([[1, 'logs every decision']])
  })
  it('checks table cells independently, including pipes in code spans', () => {
    expect(markdownClaims('| No overhead | The encoder logs every decision. |')).toEqual([[1, 'logs every decision']])
    expect(markdownClaims('| No decision log | The encoder logs every decision. |')).toEqual([[1, 'logs every decision']])
    expect(markdownClaims('| The encoder logs every | decision. |')).toEqual([])
    expect(markdownClaims('| `The encoder logs every | decision.` |')).toEqual([])
    expect(markdownParagraphs('No overhead \\| The encoder logs every decision.')).toHaveLength(1)
  })
  it('preserves the physical start line after blanking an allowance', () => {
    const text = 'There is no human sign-off step. <!-- claims-check: allow --> Intro\nThe encoder logs every decision.'
    expect(markdownClaims(text)).toEqual([[2, 'logs every decision']])
    expect(markdownClaims('😀 denied. <!-- claims-check: allow --> Intro\nThe encoder logs every decision.')).toEqual([[2, 'logs every decision']])
    expect(markdownClaims('| The encoder logs every decision. <!-- claims-check: allow --> | The encoder logs every decision. |')).toEqual([[1, 'logs every decision']])
  })
  it('blanks only the allowed clause without shortening code-point offsets', () => {
    const text = '😀 denied. <!-- claims-check: allow --> The encoder logs every decision.'
    expect(Array.from(blankAllowedClaims(text))).toHaveLength(Array.from(text).length)
    expect(markdownClaims(text)).toEqual([[1, 'logs every decision']])
  })
})

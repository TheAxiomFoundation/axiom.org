import { describe, expect, it } from 'vitest'
import {
  blankAllowedClaims,
  encoderRecordClaims,
  encoderRecordHits,
  markdownClaims,
  markdownInline,
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

describe('joint review round-1 encoder-record regressions', () => {
  it.each([
    [String.raw`\<!-- The encoder publishes its traces. -->`, 'publishes its traces'],
    [String.raw`\<!-- The encoder logs **every** decision. -->`, 'logs every decision'],
    [String.raw`\<!-- The encoder logs every&nbsp;decision. -->`, 'logs every decision'],
    [String.raw`\\\<!-- The encoder publishes its traces. -->`, 'publishes its traces'],
    ['`<!-- The encoder logs every decision. -->`', 'logs every decision'],
    ['``<!-- The encoder publishes its traces. -->``', 'publishes its traces'],
    ['``prefix ` <!-- The encoder logs every decision. -->``', 'logs every decision'],
  ])('keeps escaped and code-span comments visible at their source offset: %s', (text, claim) => {
    const visible = markdownInline(text)
    const hits = encoderRecordHits(visible.text)
    expect(hits).toHaveLength(1)
    expect(hits[0][1]).toBe(claim)
    expect(visible.offsets[hits[0][0]]).toBe(Array.from(text.slice(0, text.indexOf(claim.split(' ')[0]))).length)
    expect(markdownClaims(text)).toEqual([[1, claim]])
  })

  it.each([
    String.raw`\\<!-- The encoder publishes its traces. -->`,
    '<!-- The encoder publishes its traces. -->',
    '`<!-- The encoder logs every decision. -->',
    '`The encoder logs every&nbsp;decision.`',
    '``The encoder logs every&#32;decision.``',
    '`<!-- The encoder logs **every** decision. -->`',
    '``The encoder logs _every decision_.``',
    'The encoder logs `every&nbsp;decision`.',
    String.raw`The encoder logs every\&nbsp;decision.`,
    String.raw`The encoder logs every\&#32;decision.`,
    '`<!-- literal -->` <!-- The encoder publishes its traces. -->',
  ])('protects literal escapes and code spans through every inline pass: %s', text => {
    expect(markdownClaims(text)).toEqual([])
  })

  it.each([
    ['\\`The encoder logs every&nbsp;decision.', 'logs every decision'],
    ['`&nbsp; <!-- hidden? -->` The encoder logs **every** decision.', 'logs every decision'],
    ['<!-- hidden --> `<!-- The encoder publishes its traces. -->`', 'publishes its traces'],
  ])('preserves surrounding markup outside protected ranges: %s', (text, claim) => {
    expect(markdownClaims(text)).toEqual([[1, claim]])
  })

  it('keeps the physical source line after a visible code-span comment', () => {
    expect(markdownClaims('Intro `<!-- literal comment -->`\nThe encoder logs **every** decision.')).toEqual([[2, 'logs every decision']])
  })

  it('uses code-point ranges across astral protected and removed text', () => {
    const text = '😀 `😀 <!-- literal -->` <!-- 😀 hidden --> The encoder logs **every** decision.'
    const visible = markdownInline(text)
    expect(visible.text).toBe('😀 `😀 <!-- literal -->`  The encoder logs every decision.')
    const [[offset, claim]] = encoderRecordHits(visible.text)
    expect(claim).toBe('logs every decision')
    expect(visible.offsets[offset]).toBe(Array.from(text.slice(0, text.indexOf('logs'))).length)
    expect(markdownClaims(text)).toEqual([[1, claim]])
  })

  it.each([
    ['The failed encoder run publishes the successful-run trace.', 'publishes the successful-run trace'],
    ['The failed encoder run publishes successful diagnostic traces.', 'publishes successful diagnostic traces'],
    ['The failed encoder run publishes a successful encoding trace.', 'publishes a successful encoding trace'],
    ['The failed encoder run stores the full successful-run trace in an artifact.', 'stores the full successful-run trace'],
    ['The failed encoder run keeps every successful diagnostic trace.', 'keeps every successful diagnostic trace'],
  ])('never exempts a trace modified as successful: %s', (text, claim) => {
    expect(encoderRecordHits(text)).toEqual([[text.indexOf(claim), claim]])
    expect(markdownClaims(text)).toEqual([[1, claim]])
  })

  it.each([
    'The encoder stores its trace locally, but never on a public server.',
    'The encoder stores its trace locally, but not on a public server.',
    'The encoder stores its trace locally and never on a public server.',
    'The encoder stores its trace on the local machine, and never uploads it to a public server.',
    'The encoder publishes traces of failed runs, but not successful runs.',
    'The encoder publishes traces of failed runs but never successful runs.',
    'The encoder publishes traces of failed runs, and not successful diagnostic traces.',
    'The encoder publishes traces of failed runs; successful runs keep only their manifests.',
    'The encoder stores its trace locally; the documentation is hosted on a public server.',
    'The encoder stores its trace locally; the reviewer publishes its transcripts on a public server.',
    'The encoder publishes traces of failed runs, but not successful runs or successful sessions.',
    'The encoder stores its trace locally, but never on a public server or publicly.',
  ])('keeps an exemption for a denied or unrelated conjunct: %s', text => {
    expect(encoderRecordClaims(text)).toEqual([])
    expect(markdownClaims(text)).toEqual([])
  })

  it.each([
    'The encoder stores its trace locally, but also on a public server.',
    'The encoder stores its trace locally, but also uploads it to a public server.',
    'The encoder publishes traces of failed runs, but also successful runs.',
    'The encoder publishes traces of failed runs, and successful diagnostic traces.',
    'The encoder stores its trace locally, but also on a public server without a login.',
    'The encoder publishes traces of failed runs, and successful runs without requiring a subscription.',
  ])('revokes an exemption for an affirmative relevant conjunct: %s', text => {
    expect(encoderRecordClaims(text).length).toBeGreaterThan(0)
    expect(markdownClaims(text).length).toBeGreaterThan(0)
  })

  it.each([
    "The encoder's author runs a podcast, and publishes its transcripts.",
    'The encoder’s author runs a podcast, and publishes its transcripts.',
    "Our pipeline's maintainer runs a podcast, and publishes its transcripts.",
    "The encoding agent's maintainer runs a podcast, and publishes its transcripts.",
    "The encoder project's author runs a podcast, and publishes its transcripts.",
    "The model's designer hosts a meeting, and publicly publishes its transcripts.",
    "The encoder's author runs a podcast, and publishes its transcripts, and saves its traces.",
  ])('does not inherit an encoder from a possessive subject prefix: %s', text => {
    expect(encoderRecordClaims(text)).toEqual([])
    expect(markdownClaims(text)).toEqual([])
  })

  it('keeps a later explicit encoder subject after a possessive subject', () => {
    const text = "The encoder's author runs a podcast, and the encoder publishes its transcripts."
    expect(encoderRecordHits(text)).toEqual([[text.indexOf('publishes'), 'publishes its transcripts']])
    expect(markdownClaims(text)).toEqual([[1, 'publishes its transcripts']])
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

describe('round-3 encoder-record regression gaps', () => {
  it.each([
    '> The encoder logs every\ndecision.',
    '>> The encoder logs every\n> decision.',
    '> > The encoder logs every\ndecision.',
  ])('joins lazy quote continuations: %s', text => {
    expect(markdownClaims(text)).toEqual([[1, 'logs every decision']])
  })

  it.each(['\n', '>\n> ', '# ', '- ', '>> '])('bounds lazy quote continuation at %j', boundary => {
    expect(markdownClaims(`> The encoder logs every\n${boundary}decision.`)).toEqual([])
  })

  const inlineClaims: [string, string][] = [
    ['The encoder logs **every** decision.', 'logs every decision'],
    ['Every encoding decision is **logged**.', 'Every encoding decision is logged'],
    ['The encoder logs _every decision_.', 'logs every decision'],
    ['The encoder logs __every__ decision.', 'logs every decision'],
    ['The encoder logs *every* decision.', 'logs every decision'],
    ['The encoder logs every&nbsp;decision.', 'logs every decision'],
    ['The encoder logs every&#32;decision.', 'logs every decision'],
    ['The encoder logs every&#x20;decision.', 'logs every decision'],
    ['The encoder logs every&Tab;decision.', 'logs every decision'],
    ['The encoder logs every&NewLine;decision.', 'logs every decision'],
    ['The encoder logs every&#10;decision.', 'logs every decision'],
    ['The encoder logs every&#xA;decision.', 'logs every decision'],
    ['The encoder logs every <!-- x --> decision.', 'logs every decision'],
    ['The encoder logs every<!-- x --> decision.', 'logs every decision'],
    ['The encoder logs e<!-- x -->very decision.', 'logs every decision'],
  ]
  it.each(inlineClaims)('renders inline Markdown only in its adapter: %s', (text, claim) => {
    expect(markdownClaims(text)).toContainEqual([1, claim])
    expect(encoderRecordClaims(text)).toEqual([])
  })

  it.each([
    'Intro <!-- ' + 'a long invisible comment '.repeat(40) + '--> without a stop',
    'Intro ' + '&nbsp;'.repeat(100) + ' without a stop',
    'Intro ' + '*emphasis* '.repeat(30) + 'without a stop',
  ])('maps the following claim through inline edits: %s', prefix => {
    expect(markdownClaims(`${prefix}\nThe encoder logs **every** decision.`)).toEqual([[2, 'logs every decision']])
  })

  it.each([
    'The encoder logs every <!-- x -->\ndecision.',
    'The encoder logs every <!-- x\ncontinues --> decision.',
    'The encoder logs every <!-- x\ncontinues -->\ndecision.',
    'The encoder logs every <!-- x. -->\ndecision.',
  ])('keeps a visibly unfinished paragraph open across comments: %s', text => {
    expect(markdownClaims(text)).toEqual([[1, 'logs every decision']])
  })

  it.each([
    'The encoder logs every. <!-- x -->\ndecision.',
    'The encoder logs every <!-- x -->\n- decision.',
    'The encoder logs every\n<!-- x -->\ndecision.',
    'The encoder logs every_decision.',
    'The encoder logs __every_decision__.',
    'The encoder logs `**every**` decision.',
    String.raw`The encoder logs every\*decision\*.`,
    String.raw`The encoder logs every\_decision\_.`,
    'The encoder logs every<!-- unclosed comment decision.',
  ])('preserves visible block boundaries and literal delimiters: %s', text => {
    expect(markdownClaims(text)).toEqual([])
  })

  it.each([
    '**The encoder logs every decision.**',
    'The encoder logs every&#32;decision.',
    'The encoder logs every<!-- x --> decision.',
  ])('keeps allowances through inline rendering: %s', text => {
    expect(markdownClaims(`${text} <!-- claims-check: allow -->`)).toEqual([])
  })

  it.each([
    'The encoder does not merely log every decision; it publishes them.',
    "The encoder doesn't simply log every decision.",
    'The encoder does not simply log every decision; it publishes them.',
    'The encoder publishes traces of failed runs and successful runs.',
    'The encoder publishes traces of failed runs and of every successful run.',
    'The encoder publishes traces of failed runs, and successful runs.',
    'The encoder publishes traces of failed runs; successful runs too.',
    'The encoder stores its trace locally and on a public server.',
    'The encoder stores its trace on the local machine and on a public server.',
    'The encoder stores its trace locally, and on a public server.',
    'The encoder stores its trace locally, and uploads it to a public server.',
    'The encoder stores its trace locally; it is also stored on a public server.',
    'The encoder keeps its traces locally, and publishes its transcripts.',
    'The encoder runs nightly, and publishes its transcripts.',
    'The encoder keeps its traces locally, and publicly publishes its transcripts.',
  ])('keeps affirmative predicates outside scoped exemptions: %s', text => {
    expect(encoderRecordClaims(text).length).toBeGreaterThan(0)
    expect(markdownClaims(text).length).toBeGreaterThan(0)
  })

  it.each([
    "The decision log isn't kept.",
    'The decision log isn’t kept.',
    'The encoder doesn‘t log every decision.',
    "The encoder can't publicly publish its traces.",
    'The encoder does not openly publish its reasoning.',
    'The encoder does not automatically keep a decision log.',
    'The encoder does not ever log every decision.',
    'The encoder stores its trace locally. A public server stores documentation.',
    'The encoder publishes traces of failed runs. Successful runs keep their manifests.',
    'The encoder runs nightly, and the engine publishes its traces.',
    'The encoder runs nightly, and the reviewer publishes its transcripts.',
  ])('honors denials and scope boundaries: %s', text => {
    expect(encoderRecordClaims(text)).toEqual([])
    expect(markdownClaims(text)).toEqual([])
  })

  it('maps an inherited subject to the second predicate source offset', () => {
    const direct = 'The encoder keeps its traces locally, and publishes its transcripts.'
    expect(encoderRecordHits(direct)).toEqual([[direct.indexOf('publishes'), 'publishes its transcripts']])
    expect(markdownClaims('The encoder keeps its traces locally, and\npublishes its transcripts.')).toEqual([[2, 'publishes its transcripts']])
  })

  it.each([
    'Every rule is valİdated.',
    'Every rule is valıdated.',
    'Every rule is checKed.',
    'Every rule iſ validated.',
  ])('keeps the legacy Unicode fold separately from encoder ASCII semantics: %s', text => {
    expect(markdownClaims(text).length).toBeGreaterThan(0)
    expect(encoderRecordClaims(text)).toEqual([])
  })

  it('keeps code-point offsets after 400 astral characters', () => {
    expect(encoderRecordHits(`${'😀'.repeat(400)} The encoder logs every decision.`)).toEqual([[413, 'logs every decision']])
  })
})

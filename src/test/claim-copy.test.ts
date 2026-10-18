import { afterEach, describe, expect, it } from 'vitest'
import { htmlCopy, renderedText, sourceCopy, stringsIn } from './claim-copy'

const source = (text: string) => sourceCopy('probe.tsx', text)

afterEach(() => { document.body.replaceChildren() })

describe('claim copy extraction', () => {
  it('evaluates static template interpolation in JSX and ordinary strings', () => {
    expect(source('const a = <p>{`The encoder logs every ${"decision"}.`}</p>')).toEqual(['The encoder logs every decision.'])
    expect(source('const a = `The encoder logs every ${"de" + "cision"}.`')).toEqual(['The encoder logs every decision.'])
  })

  it('decodes the complete HTML entity set in JSX and HTML', () => {
    expect(source('const a = <p>Every encoding &#100;ecision is recorded.</p>')).toEqual(['Every encoding decision is recorded.'])
    expect(source('const a = <p>Every encoding &#x64;ecision is recorded&period;</p>')).toEqual(['Every encoding decision is recorded.'])
    expect(htmlCopy('<p>Every encoding &#100;ecision is recorded&period;</p>')).toBe('Every encoding decision is recorded.')
  })

  it('keeps child expressions with the JSX negation that governs them', () => {
    expect(source('const a = <p>We do not {"publish the encoder trace"}.</p>')).toEqual(['We do not publish the encoder trace.'])
    expect(source('const a = <p>We do not {/* note */}{`publish the encoder ${"trace"}`}.</p>')).toEqual(['We do not publish the encoder trace.'])
  })

  it('keeps dynamic callback and conditional copy within its JSX context', () => {
    expect(source('const a = <p>{items.map(() => "The encoder logs every decision.")}</p>')).toEqual(['The encoder logs every decision.'])
    expect(source('const a = <p>We do not {items.map(() => "publish the encoder trace")}.</p>')).toEqual(['We do not publish the encoder trace.'])
    expect(source('const a = <p>We do not {choice ? "publish the encoder trace" : "retain a decision log"}.</p>')).toEqual(['We do not publish the encoder trace.', 'We do not retain a decision log.'])
  })

  it('normalizes text-node whitespace without turning it into clause boundaries', () => {
    expect(source('const a = <p>{"The encoder logs every"}{"\\n"}{"decision."}</p>')).toEqual(['The encoder logs every decision.'])
    const paragraph = document.createElement('p')
    paragraph.append('The encoder logs every', '\n', 'decision.')
    expect(renderedText(paragraph)).toBe('The encoder logs every decision.')
    expect(htmlCopy('<p>The encoder logs every\ndecision.</p>')).toBe('The encoder logs every decision.')
  })

  it('inserts structural boundaries between blocks and independent table cells', () => {
    const markup = '<div><h2>No trace</h2><p>The encoder publishes its traces.</p><table><tr><td>No overhead</td><td>The encoder logs every decision.</td></tr></table></div>'
    const expected = 'No trace\nThe encoder publishes its traces.\nNo overhead\nThe encoder logs every decision.'
    expect(htmlCopy(markup)).toBe(expected)
    expect(source(`const a = ${markup}`)).toEqual([expected])
  })

  it('keeps existing comment, concatenation, attribute, JSON and inline coverage', () => {
    expect(source('const a = <p>Every encoding decision is {/* note */} recorded.</p>')).toEqual(['Every encoding decision is recorded.'])
    expect(source('// The encoder logs every decision.\nconst a = 1')).toEqual([])
    expect(source('const a = "The encoder logs every " + "decision."')).toEqual(['The encoder logs every decision.'])
    expect(source('const a = <p aria-label="The encoder logs every decision.">Hi</p>')).toEqual(['Hi', 'The encoder logs every decision.'])
    expect(source('const a = <div><span>Decision</span> <span>logs are kept.</span></div>')).toEqual(['Decision logs are kept.'])
    expect(stringsIn({ a: ['The encoder logs every decision.'] })).toEqual(['The encoder logs every decision.'])
  })

  it('reads public HTML accessibility attributes and omits scripts, styles and comments', () => {
    expect(htmlCopy(`<style>The encoder logs every decision.</style><script>The encoder logs every decision.</script><!-- The encoder logs every decision. --><p aria-label='Every encoding &#100;ecision is recorded.'>Public paper</p>`)).toBe('Public paper\nEvery encoding decision is recorded.')
  })
})

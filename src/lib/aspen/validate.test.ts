import {
  MAX_PROMPT_CHARS,
  MAX_TURNS,
  cleanChoice,
  cleanChoices,
  cleanMessages,
  cleanText,
  clipText,
  isEmail,
  isRunId,
  isUuid,
} from './validate'

describe('aspen input checks', () => {
  it('recognizes ids and emails', () => {
    expect(isUuid('6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(42)).toBe(false)
    expect(isRunId('phoenix')).toBe(true)
    expect(isRunId('rehearsal-2')).toBe(true)
    expect(isRunId('Phoenix')).toBe(false)
    expect(isRunId('-x')).toBe(false)
    expect(isEmail('a@b.org')).toBe(true)
    expect(isEmail('nope')).toBe(false)
    expect(isEmail(`${'a'.repeat(250)}@b.org`)).toBe(false)
  })

  it('cleans and clips text', () => {
    expect(cleanText('  hi  ', 10)).toBe('hi')
    expect(cleanText('   ', 10)).toBeNull()
    expect(cleanText('too long', 3)).toBeNull()
    expect(cleanText(5, 3)).toBeNull()
    expect(clipText('  abcdef ', 3)).toBe('abc')
    expect(clipText('ab', 3)).toBe('ab')
    expect(clipText('', 3)).toBeNull()
    expect(clipText(null, 3)).toBeNull()
  })

  it('keeps only allowed choices', () => {
    expect(cleanChoices(['a', 'b', 'a', 'z', 3], ['a', 'b'])).toEqual(['a', 'b'])
    expect(cleanChoices('a', ['a'])).toEqual([])
    expect(cleanChoice('b', ['a', 'b'])).toBe('b')
    expect(cleanChoice('z', ['a', 'b'])).toBeNull()
  })

  it('accepts a conversation that ends on the user', () => {
    expect(
      cleanMessages([
        { role: 'user', content: ' Hi ' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'More?' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'More?' },
    ])
  })

  it('clips long user turns and rejects malformed conversations', () => {
    const long = cleanMessages([{ role: 'user', content: 'x'.repeat(MAX_PROMPT_CHARS + 50) }])
    expect(long?.[0].content).toHaveLength(MAX_PROMPT_CHARS)
    expect(cleanMessages([])).toBeNull()
    expect(cleanMessages('hi')).toBeNull()
    expect(cleanMessages([null])).toBeNull()
    expect(cleanMessages([{ role: 'system', content: 'x' }])).toBeNull()
    expect(cleanMessages([{ role: 'user', content: '  ' }])).toBeNull()
    expect(cleanMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])).toBeNull()
    const tooMany = Array.from({ length: MAX_TURNS * 2 + 1 }, () => ({ role: 'user', content: 'x' }))
    expect(cleanMessages(tooMany)).toBeNull()
  })
})

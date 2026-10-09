import {
  DEFAULT_CHAT_MODEL,
  applyOpenAIEvent,
  askChatbot,
  askFinbotRaw,
  chatConfig,
  dateInstruction,
  finbotBase,
  parseSse,
  sourcesFromResponse,
  streamOpenAI,
} from './openai'

const messages = [{ role: 'user' as const, content: 'How much SNAP?' }]

function sseResponse(events: unknown[], { split = false, status = 200 } = {}) {
  const text = events.map((e) => `event: x\ndata: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
  const encoder = new TextEncoder()
  const chunks = split ? [text.slice(0, 37), text.slice(37)] : [text]
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status })
}

describe('aspen chatbot config', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to the ChatGPT-like setup', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ASPEN_CHAT_MODEL', '')
    vi.stubEnv('ASPEN_CHAT_REASONING', '')
    vi.stubEnv('ASPEN_CHAT_WEB_SEARCH', '')
    expect(chatConfig()).toEqual({ apiKey: null, model: DEFAULT_CHAT_MODEL, reasoning: 'low', webSearch: true })
    vi.stubEnv('ASPEN_CHAT_REASONING', 'none')
    vi.stubEnv('ASPEN_CHAT_WEB_SEARCH', 'off')
    expect(chatConfig()).toMatchObject({ reasoning: null, webSearch: false })
  })

  it('points at the gallery chatbot unless overridden', () => {
    vi.stubEnv('ASPEN_FINBOT_URL', '')
    expect(finbotBase()).toBe('https://finbot-snap-demo.vercel.app/gallery/chatbot')
    vi.stubEnv('ASPEN_FINBOT_URL', 'http://localhost:3005/gallery/chatbot/')
    expect(finbotBase()).toBe('http://localhost:3005/gallery/chatbot')
  })

  it('states the date in Phoenix time', () => {
    expect(dateInstruction(new Date('2026-10-27T03:00:00Z'))).toBe('Current date: Monday, October 26, 2026.')
  })
})

describe('OpenAI stream parsing', () => {
  it('splits SSE blocks and keeps the tail', () => {
    const { events, rest } = parseSse('data: {"a":1}\n\ndata: [DONE]\n\ndata: nope\n\ndata: {"b"')
    expect(events).toEqual([{ a: 1 }])
    expect(rest).toBe('data: {"b"')
    expect(parseSse('event: x\r\ndata: {"c":2}\r\n\r\n').events).toEqual([{ c: 2 }])
    expect(parseSse('event: ping\n\n').events).toEqual([])
  })

  it('applies deltas, search status, citations and completion', () => {
    const state = { text: '', sources: [] as { url: string; title?: string }[], model: undefined as string | undefined }
    const onDelta = vi.fn()
    const onStatus = vi.fn()
    expect(applyOpenAIEvent({ type: 'response.output_text.delta', delta: 'Hi' }, state, { onDelta, onStatus })).toBeNull()
    applyOpenAIEvent({ type: 'response.web_search_call.searching' }, state, { onDelta, onStatus })
    applyOpenAIEvent(
      { type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', url: 'https://a', title: 'A' } },
      state,
      { onDelta },
    )
    applyOpenAIEvent({ type: 'response.output_text.annotation.added', annotation: { type: 'file_citation' } }, state, { onDelta })
    applyOpenAIEvent({ type: 'response.output_text.annotation.added', annotation: null }, state, { onDelta })
    applyOpenAIEvent(
      {
        type: 'response.completed',
        response: {
          model: 'gpt-5.5-2026',
          output: [
            { type: 'web_search_call' },
            { content: [{ annotations: [{ type: 'url_citation', url: 'https://a' }, { type: 'url_citation', url: 'https://b' }] }] },
            { content: [{ text: 'no annotations' }] },
          ],
        },
      },
      state,
      { onDelta },
    )
    expect(onDelta).toHaveBeenCalledWith('Hi')
    expect(onStatus).toHaveBeenCalledWith('Searching the web')
    expect(state).toEqual({
      text: 'Hi',
      model: 'gpt-5.5-2026',
      sources: [{ url: 'https://a', title: 'A' }, { url: 'https://b' }],
    })
  })

  it('reports failures', () => {
    const state = { text: '', sources: [] }
    const handlers = { onDelta: vi.fn() }
    expect(applyOpenAIEvent({ type: 'response.failed', response: { error: { message: 'boom' } } }, state, handlers)).toBe('boom')
    expect(
      applyOpenAIEvent({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_tokens' } } }, state, handlers),
    ).toBe('max_tokens')
    expect(applyOpenAIEvent({ type: 'response.failed' }, state, handlers)).toBe('response.failed')
    expect(applyOpenAIEvent({ type: 'error', message: 'bad' }, state, handlers)).toBe('bad')
    expect(applyOpenAIEvent({ type: 'error' }, state, handlers)).toBe('OpenAI stream error')
    expect(sourcesFromResponse(undefined)).toEqual([])
  })
})

describe('asking the chatbot', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('streams an OpenAI answer with web search on', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    vi.stubEnv('ASPEN_CHAT_MODEL', 'gpt-test')
    vi.stubEnv('ASPEN_CHAT_REASONING', '')
    vi.stubEnv('ASPEN_CHAT_WEB_SEARCH', '')
    const fetchImpl = vi.fn(async () =>
      sseResponse(
        [
          { type: 'response.output_text.delta', delta: 'About ' },
          { type: 'response.output_text.delta', delta: '$24.' },
          { type: 'response.completed', response: { model: 'gpt-test-1', output: [] } },
        ],
        { split: true },
      ),
    ) as unknown as typeof fetch
    const deltas: string[] = []
    const result = await askChatbot(messages, { onDelta: (t) => deltas.push(t) }, { fetchImpl })
    expect(result).toEqual({ text: 'About $24.', sources: [], backend: 'openai', model: 'gpt-test-1', webSearch: true })
    expect(deltas.join('')).toBe('About $24.')
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ model: 'gpt-test', stream: true, store: false, tools: [{ type: 'web_search' }], reasoning: { effort: 'low' } })
    expect(body.instructions).toMatch(/^Current date: /)
  })

  it('omits tools and reasoning when turned off, and handles an unterminated last event', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    vi.stubEnv('ASPEN_CHAT_REASONING', 'none')
    vi.stubEnv('ASPEN_CHAT_WEB_SEARCH', 'off')
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"ok"}'))
        c.close()
      },
    })
    const fetchImpl = vi.fn(async () => new Response(body)) as unknown as typeof fetch
    const result = await streamOpenAI(messages, { onDelta: vi.fn() }, { fetchImpl })
    expect(result).toMatchObject({ text: 'ok', webSearch: false })
    const sent = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(sent.tools).toBeUndefined()
    expect(sent.reasoning).toBeUndefined()
  })

  it('throws on HTTP errors, failed responses, and a missing key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const bad = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    await expect(streamOpenAI(messages, { onDelta: vi.fn() }, { fetchImpl: bad })).rejects.toThrow(/OpenAI 401: nope/)
    const failed = vi.fn(async () => sseResponse([{ type: 'response.failed', response: { error: { message: 'quota' } } }])) as unknown as typeof fetch
    await expect(streamOpenAI(messages, { onDelta: vi.fn() }, { fetchImpl: failed })).rejects.toThrow('quota')
    const encoder = new TextEncoder()
    const tailFailure = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(encoder.encode('data: {"type":"error","message":"late"}'))
              c.close()
            },
          }),
        ),
    ) as unknown as typeof fetch
    await expect(streamOpenAI(messages, { onDelta: vi.fn() }, { fetchImpl: tailFailure })).rejects.toThrow('late')
    vi.stubEnv('OPENAI_API_KEY', '')
    await expect(streamOpenAI(messages, { onDelta: vi.fn() })).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it('falls back to the gallery chatbot without a key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ASPEN_FINBOT_URL', 'https://bot.example/gallery/chatbot')
    vi.stubEnv('ASPEN_CHAT_MODEL', '')
    const fetchImpl = vi.fn(async () => Response.json({ text: 'Maybe $120.' })) as unknown as typeof fetch
    const onDelta = vi.fn()
    const result = await askChatbot(messages, { onDelta }, { fetchImpl })
    expect(result).toEqual({
      text: 'Maybe $120.',
      sources: [],
      backend: 'finbot-raw',
      model: 'gpt-5.5 (gallery chatbot, plain)',
      webSearch: false,
    })
    expect(onDelta).toHaveBeenCalledWith('Maybe $120.')
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://bot.example/gallery/chatbot/api/raw')
  })

  it('surfaces gallery chatbot errors', async () => {
    const withError = vi.fn(async () => Response.json({ error: 'no key' }, { status: 500 })) as unknown as typeof fetch
    await expect(askFinbotRaw(messages, { onDelta: vi.fn() }, { fetchImpl: withError })).rejects.toThrow('no key')
    const notJson = vi.fn(async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch
    await expect(askFinbotRaw(messages, { onDelta: vi.fn() }, { fetchImpl: notJson })).rejects.toThrow('chatbot 502')
  })
})

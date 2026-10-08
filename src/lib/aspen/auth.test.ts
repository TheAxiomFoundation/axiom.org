import {
  ACCESS_COOKIE,
  PRESENTER_COOKIE,
  accessFromCookies,
  accessToken,
  kindForPassword,
  participantPassword,
  presenterPassword,
  safeEqual,
  safeNext,
} from './auth'

describe('aspen password gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads the passwords from the environment', () => {
    vi.stubEnv('ASPEN_PASSWORD', ' room ')
    vi.stubEnv('ASPEN_PRESENTER_PASSWORD', '')
    expect(participantPassword()).toBe('room')
    expect(presenterPassword()).toBeNull()
  })

  it('signs a stable token per kind and password', async () => {
    const a = await accessToken('participant', 'room')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await accessToken('participant', 'room')).toBe(a)
    expect(await accessToken('presenter', 'room')).not.toBe(a)
    expect(await accessToken('participant', 'other')).not.toBe(a)
  })

  it('compares strings in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'ab')).toBe(false)
  })

  it('maps a typed password to its kind', () => {
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    vi.stubEnv('ASPEN_PRESENTER_PASSWORD', 'stage')
    expect(kindForPassword('stage')).toBe('presenter')
    expect(kindForPassword('room')).toBe('participant')
    expect(kindForPassword('wrong')).toBeNull()
    vi.stubEnv('ASPEN_PASSWORD', '')
    expect(kindForPassword('stage')).toBeNull()
  })

  it('grants access from cookies', async () => {
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    vi.stubEnv('ASPEN_PRESENTER_PASSWORD', 'stage')
    const room = await accessToken('participant', 'room')
    const stage = await accessToken('presenter', 'stage')
    const jar = (values: Record<string, string>) => (name: string) => values[name]

    expect(await accessFromCookies(jar({}))).toEqual({ open: true, participant: false, presenter: false })
    expect(await accessFromCookies(jar({ [ACCESS_COOKIE]: room }))).toEqual({
      open: true,
      participant: true,
      presenter: false,
    })
    expect(await accessFromCookies(jar({ [PRESENTER_COOKIE]: stage }))).toEqual({
      open: true,
      participant: true,
      presenter: true,
    })
    expect(await accessFromCookies(jar({ [ACCESS_COOKIE]: 'forged' }))).toMatchObject({ participant: false })
  })

  it('closes the page when no participant password is set', async () => {
    vi.stubEnv('ASPEN_PASSWORD', '')
    vi.stubEnv('ASPEN_PRESENTER_PASSWORD', 'stage')
    const stage = await accessToken('presenter', 'stage')
    expect(await accessFromCookies((n) => (n === PRESENTER_COOKIE ? stage : undefined))).toEqual({
      open: false,
      participant: false,
      presenter: true,
    })
  })

  it('keeps the next path inside /aspen', () => {
    expect(safeNext('/aspen/present')).toBe('/aspen/present')
    expect(safeNext('/aspen')).toBe('/aspen')
    expect(safeNext('/aspen?x=1')).toBe('/aspen?x=1')
    expect(safeNext('/aspenevil')).toBe('/aspen')
    expect(safeNext('https://evil.example')).toBe('/aspen')
    expect(safeNext(null)).toBe('/aspen')
    expect(safeNext(undefined, '/x')).toBe('/x')
  })
})

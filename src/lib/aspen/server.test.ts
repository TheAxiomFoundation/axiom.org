const jar = new Map<string, string>()
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`)
})

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined) }),
}))
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))

import { ACCESS_COOKIE, PRESENTER_COOKIE, accessToken } from './auth'
import { apiAccess, json, readBody } from './http'
import { getAccess, requireAccess } from './server'

describe('aspen page and API gates', () => {
  beforeEach(() => {
    jar.clear()
    redirect.mockClear()
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    vi.stubEnv('ASPEN_PRESENTER_PASSWORD', 'stage')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('sends visitors without a cookie to sign in', async () => {
    await expect(requireAccess('participant', '/aspen')).rejects.toThrow('REDIRECT /aspen/sign-in?next=%2Faspen')
    await expect(requireAccess('presenter', '/aspen/present')).rejects.toThrow(
      'REDIRECT /aspen/sign-in?next=%2Faspen%2Fpresent&as=presenter',
    )
  })

  it('lets signed-in participants and presenters through', async () => {
    jar.set(ACCESS_COOKIE, await accessToken('participant', 'room'))
    await expect(requireAccess('participant', '/aspen')).resolves.toMatchObject({ participant: true })
    await expect(requireAccess('presenter', '/aspen/present')).rejects.toThrow(/as=presenter/)
    jar.set(PRESENTER_COOKIE, await accessToken('presenter', 'stage'))
    await expect(requireAccess('presenter', '/aspen/present')).resolves.toMatchObject({ presenter: true })
    expect(await getAccess()).toEqual({ open: true, participant: true, presenter: true })
  })

  it('answers API calls with 401 or 403', async () => {
    const anonymous = await apiAccess('participant')
    expect(anonymous.denied?.status).toBe(401)
    jar.set(ACCESS_COOKIE, await accessToken('participant', 'room'))
    expect((await apiAccess('participant')).denied).toBeNull()
    const notPresenter = await apiAccess('presenter')
    expect(notPresenter.denied?.status).toBe(403)
    expect(await notPresenter.denied?.json()).toEqual({ error: 'Sign in at /aspen first.' })
  })

  it('sends uncached JSON and reads object bodies only', async () => {
    const response = json({ ok: true }, 201)
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const req = (body: string) => new Request('https://x', { method: 'POST', body })
    expect(await readBody(req('{"a":1}'))).toEqual({ a: 1 })
    expect(await readBody(req('[1]'))).toBeNull()
    expect(await readBody(req('null'))).toBeNull()
    expect(await readBody(req('{'))).toBeNull()
  })
})

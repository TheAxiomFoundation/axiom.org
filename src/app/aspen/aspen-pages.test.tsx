import { render, screen } from '@testing-library/react'

const requireAccess = vi.fn(async () => ({ open: true, participant: true, presenter: true }))
const getAccess = vi.fn(async () => ({ open: true, participant: false, presenter: false }))
vi.mock('@/lib/aspen/server', () => ({
  requireAccess: (...args: unknown[]) => requireAccess(...(args as [])),
  getAccess: () => getAccess(),
}))
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect ${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))
vi.mock('@/components/aspen/aspen-app', () => ({ AspenApp: () => <p>participant app</p> }))
vi.mock('@/components/aspen/presenter-app', () => ({
  PresenterApp: ({ joinPassword }: { joinPassword: string | null }) => <p>presenter app {joinPassword}</p>,
}))
vi.mock('@/components/aspen/sign-in-form', () => ({
  SignInForm: (props: { open: boolean; next: string; presenter: boolean }) => <p>sign-in {JSON.stringify(props)}</p>,
}))

import AspenLayout, { metadata } from './layout'
import AspenPage from './page'
import AspenPresenterPage from './present/page'
import AspenSignInPage from './sign-in/page'

describe('/aspen pages', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    requireAccess.mockClear()
    getAccess.mockReset()
    getAccess.mockResolvedValue({ open: true, participant: false, presenter: false })
    redirect.mockClear()
  })

  it('keeps the event page out of search', () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
    expect(metadata).not.toHaveProperty('openGraph')
    render(<AspenLayout>child</AspenLayout>)
    expect(screen.getByText('child')).toBeInTheDocument()
  })

  it('gates the participant page', async () => {
    render(await AspenPage())
    expect(requireAccess).toHaveBeenCalledWith('participant', '/aspen')
    expect(screen.getByText('participant app')).toBeInTheDocument()
  })

  it('gates the presenter page and shows the room password there', async () => {
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    render(await AspenPresenterPage())
    expect(requireAccess).toHaveBeenCalledWith('presenter', '/aspen/present')
    expect(screen.getByText('presenter app room')).toBeInTheDocument()
  })

  it('passes a safe next path to the sign-in form', async () => {
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    render(await AspenSignInPage({ searchParams: Promise.resolve({ next: '/aspen/present', as: 'presenter' }) }))
    expect(screen.getByText('sign-in {"open":true,"next":"/aspen/present","presenter":true}')).toBeInTheDocument()
  })

  it('reports a closed page and ignores outside next paths', async () => {
    vi.stubEnv('ASPEN_PASSWORD', '')
    render(await AspenSignInPage({ searchParams: Promise.resolve({ next: 'https://evil.example' }) }))
    expect(screen.getByText('sign-in {"open":false,"next":"/aspen","presenter":false}')).toBeInTheDocument()
  })

  it('sends someone already signed in straight on, so Back never shows the form again', async () => {
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    getAccess.mockResolvedValue({ open: true, participant: true, presenter: false })
    await expect(AspenSignInPage({ searchParams: Promise.resolve({ next: '/aspen' }) })).rejects.toThrow('redirect /aspen')
  })

  it('still asks a participant for the presenter password', async () => {
    vi.stubEnv('ASPEN_PASSWORD', 'room')
    getAccess.mockResolvedValue({ open: true, participant: true, presenter: false })
    render(await AspenSignInPage({ searchParams: Promise.resolve({ next: '/aspen/present', as: 'presenter' }) }))
    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByText('sign-in {"open":true,"next":"/aspen/present","presenter":true}')).toBeInTheDocument()
  })

  it('sends a signed-in presenter on to the presenter view', async () => {
    getAccess.mockResolvedValue({ open: true, participant: true, presenter: true })
    await expect(
      AspenSignInPage({ searchParams: Promise.resolve({ next: '/aspen/present', as: 'presenter' }) }),
    ).rejects.toThrow('redirect /aspen/present')
  })
})

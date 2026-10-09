import { notifyPledge, pledgeMessage } from './notify'

const row = {
  run_id: 'phoenix',
  name: 'Pat',
  title: 'Deputy',
  state: 'Arizona',
  email: 'pat@example.gov',
  accurate_ai: true,
  state_systems: true,
  show_state: true,
  note: 'Call me',
}

describe('pledge notifications', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('writes one plain line', () => {
    expect(pledgeMessage(row)).toBe(
      'Aspen pledge (phoenix): Pat, Deputy, Arizona <pat@example.gov> wants to talk about accurate AI and state systems. Note: "Call me"',
    )
    expect(pledgeMessage({ ...row, name: null, title: null, state: null, accurate_ai: false, note: null })).toBe(
      'Aspen pledge (phoenix): Someone <pat@example.gov> wants to talk about state systems.',
    )
  })

  it('posts to the webhook only when one is set', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok')) as unknown as typeof fetch
    vi.stubEnv('ASPEN_PLEDGE_WEBHOOK_URL', '')
    expect(await notifyPledge(row, fetchImpl)).toBe(false)
    vi.stubEnv('ASPEN_PLEDGE_WEBHOOK_URL', 'https://hooks.example/x')
    expect(await notifyPledge(row, fetchImpl)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith('https://hooks.example/x', expect.objectContaining({ method: 'POST' }))
  })

  it('logs and returns false when the webhook fails', async () => {
    vi.stubEnv('ASPEN_PLEDGE_WEBHOOK_URL', 'https://hooks.example/x')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const throwing = vi.fn(async () => Promise.reject(new Error('down'))) as unknown as typeof fetch
    expect(await notifyPledge(row, throwing)).toBe(false)
    const rejecting = vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch
    expect(await notifyPledge(row, rejecting)).toBe(false)
  })
})

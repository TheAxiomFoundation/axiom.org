import { _resetRateLimits, clientIp, isRateLimited } from './limit'

describe('aspen rate limits', () => {
  beforeEach(() => _resetRateLimits())

  it('allows up to the limit within the window', () => {
    expect(isRateLimited('k', 2, 1000)).toBe(false)
    expect(isRateLimited('k', 2, 1000)).toBe(false)
    expect(isRateLimited('k', 2, 1000)).toBe(true)
    expect(isRateLimited('other', 2, 1000)).toBe(false)
  })

  it('forgets requests outside the window', () => {
    vi.useFakeTimers()
    try {
      expect(isRateLimited('k', 1, 1000)).toBe(false)
      expect(isRateLimited('k', 1, 1000)).toBe(true)
      vi.advanceTimersByTime(1001)
      expect(isRateLimited('k', 1, 1000)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the client ip', () => {
    expect(clientIp(new Request('https://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))).toBe('1.2.3.4')
    expect(clientIp(new Request('https://x'))).toBe('unknown')
  })

  it('clears the table when it grows too large', () => {
    for (let i = 0; i < 4100; i += 1) isRateLimited(`k${i}`, 1, 1000)
    expect(isRateLimited('k0', 1, 1000)).toBe(false)
  })
})

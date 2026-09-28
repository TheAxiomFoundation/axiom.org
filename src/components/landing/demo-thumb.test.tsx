import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { act } from 'react'
import { describe, it, expect, afterEach } from 'vitest'

import { DemoThumb } from './demo-thumb'

const PROPS = {
  src: 'https://axiom-demo-shell.vercel.app/demos/',
  poster: '/demo-posters/gallery.png',
  title: 'Demo gallery — preview',
}

/** Simulated input environment. The fake matchMedia evaluates the
 *  component's actual query strings against it, so a weakened
 *  predicate (e.g. width-only) fails these tests instead of being
 *  hidden by a constant-returning mock. */
interface Env {
  hover: boolean
  finePointer: boolean
  wide: boolean
  anyPointerCoarse: boolean
  maxTouchPoints: number
}

const PHONE: Env = { hover: false, finePointer: false, wide: false, anyPointerCoarse: true, maxTouchPoints: 5 }
const DESKTOP: Env = { hover: true, finePointer: true, wide: true, anyPointerCoarse: false, maxTouchPoints: 0 }

function installEnv(initial: Env) {
  const env = { ...initial }
  // One listener registry PER query string, so a test can prove the
  // component subscribed to a specific MediaQueryList: change() only
  // dispatches the listeners of queries whose result actually
  // flipped, the way real MQL change events behave.
  const registries = new Map<string, Set<() => void>>()
  const evaluate = (query: string): boolean => {
    let ok = true
    if (query.includes('(hover: hover)')) ok &&= env.hover
    if (query.includes('(pointer: fine)')) ok &&= env.finePointer
    if (query.includes('(min-width: 1024px)')) ok &&= env.wide
    if (query.includes('(any-pointer: coarse)')) ok &&= env.anyPointerCoarse
    return ok
  }

  const originalMatchMedia = window.matchMedia
  const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    'maxTouchPoints',
  )
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const listeners = registries.get(query) ?? new Set<() => void>()
      registries.set(query, listeners)
      return {
        get matches() {
          return evaluate(query)
        },
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
        dispatchEvent: () => false,
      }
    },
  })
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    get: () => env.maxTouchPoints,
  })

  return {
    change(next: Env) {
      const before = new Map(
        [...registries.keys()].map((q) => [q, evaluate(q)]),
      )
      Object.assign(env, next)
      act(() => {
        for (const [query, listeners] of registries) {
          if (before.get(query) !== evaluate(query)) {
            listeners.forEach((cb) => cb())
          }
        }
      })
    },
    totalListeners: () =>
      [...registries.values()].reduce((n, s) => n + s.size, 0),
    queriesSubscribed: () =>
      [...registries.entries()].filter(([, s]) => s.size > 0).length,
    restore() {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      })
      delete (navigator as any).maxTouchPoints
      if (originalMaxTouchPoints) {
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', originalMaxTouchPoints)
      }
    },
  }
}

describe('DemoThumb', () => {
  const restores: Array<() => void> = []
  afterEach(() => restores.splice(0).forEach((r) => r()))

  const withEnv = (env: Env) => {
    const handle = installEnv(env)
    restores.push(handle.restore)
    return handle
  }

  const expectPosterOnly = (env: Env) => {
    withEnv(env)
    const { container } = render(<DemoThumb {...PROPS} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', PROPS.poster)
  }

  it('server-renders the poster and never the iframe', () => {
    // No effects run here, so this pins the pre-hydration default —
    // the markup a crashed or scriptless client is left with.
    const html = renderToString(<DemoThumb {...PROPS} />)
    expect(html).toContain(PROPS.poster)
    expect(html).not.toContain('<iframe')
  })

  it('serves only the poster on a phone', () => {
    expectPosterOnly(PHONE)
  })

  // Each condition of the desktop query is individually load-bearing:
  // an env failing exactly one of them must stay on the poster, so a
  // predicate weakened to any subset of the conditions fails a test.
  it('serves only the poster without hover capability', () => {
    expectPosterOnly({ ...DESKTOP, hover: false })
  })

  it('serves only the poster without a fine primary pointer', () => {
    expectPosterOnly({ ...DESKTOP, finePointer: false })
  })

  it('serves only the poster on a narrow desktop window', () => {
    expectPosterOnly({ ...DESKTOP, wide: false })
  })

  // The two touch safeguards are also individually load-bearing: a
  // hybrid can report touch through either channel alone.
  it('serves only the poster when any pointer is coarse, even with zero touch points', () => {
    expectPosterOnly({ ...DESKTOP, anyPointerCoarse: true })
  })

  it('serves only the poster with touch points, even with no coarse pointer', () => {
    expectPosterOnly({ ...DESKTOP, maxTouchPoints: 10 })
  })

  it('upgrades to the live iframe on a pure desktop, keeping the poster underneath', () => {
    withEnv(DESKTOP)
    const { container } = render(<DemoThumb {...PROPS} />)
    const iframe = container.querySelector('iframe')
    expect(iframe).toHaveAttribute('src', PROPS.src)
    expect(iframe).toHaveAttribute('loading', 'lazy')
    // The poster stays mounted under the iframe so the upgrade never
    // flashes a blank frame while the embed loads.
    expect(container.querySelector('img')).toHaveAttribute('src', PROPS.poster)
  })

  it('drops the iframe when only the coarse-pointer query flips', () => {
    // Dispatches only the (any-pointer: coarse) listeners — the test
    // fails unless the component subscribed to that query too.
    const handle = withEnv(DESKTOP)
    const { container } = render(<DemoThumb {...PROPS} />)
    expect(container.querySelector('iframe')).not.toBeNull()
    handle.change({ ...DESKTOP, anyPointerCoarse: true })
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('drops the iframe when only the desktop query flips', () => {
    const handle = withEnv(DESKTOP)
    const { container } = render(<DemoThumb {...PROPS} />)
    expect(container.querySelector('iframe')).not.toBeNull()
    handle.change({ ...DESKTOP, wide: false })
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('subscribes to both queries and removes both subscriptions on unmount', () => {
    const handle = withEnv(DESKTOP)
    const { unmount } = render(<DemoThumb {...PROPS} />)
    expect(handle.queriesSubscribed()).toBe(2)
    expect(handle.totalListeners()).toBe(2)
    unmount()
    expect(handle.totalListeners()).toBe(0)
  })

  it('keeps the thumb decorative', () => {
    withEnv(PHONE)
    const { container } = render(<DemoThumb {...PROPS} />)
    expect(container.querySelector('span.landing-demo-thumb')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })
})

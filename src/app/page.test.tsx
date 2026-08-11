import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

import Home from './page'

describe('Home page', () => {
  it('renders all landing sections', () => {
    render(<Home />)
    // Hero
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    // The gap
    expect(screen.getByRole('heading', { name: /we didn.t write the law for computers/i })).toBeInTheDocument()
    // What we publish
    expect(screen.getByRole('heading', { name: /two layers, both in the open/i })).toBeInTheDocument()
    // Encoder
    expect(screen.getByRole('heading', { name: /statutes encoded and verified/i })).toBeInTheDocument()
    // Applications
    expect(screen.getByRole('heading', { name: /one encoding\. many places/i })).toBeInTheDocument()
    // Foundation
    expect(screen.getByRole('heading', { name: /doing the public-interest work/i })).toBeInTheDocument()
  })
})

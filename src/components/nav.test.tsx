import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

import { NavClient } from '@/components/nav-client'
import { appHrefForHost, marketingOriginForHost } from '@/components/nav-wrapper'

describe('Nav', () => {
  it('maps app hosts back to the matching marketing origin', () => {
    expect(marketingOriginForHost('app.axiom-foundation.org')).toBe(
      'https://axiom.org',
    )
    expect(
      marketingOriginForHost(
        'app-axiom-foundation-git-fix-app-header-redirects-policy-engine.vercel.app',
      ),
    ).toBeUndefined()
    expect(marketingOriginForHost('axiom-foundation.org')).toBeUndefined()
    expect(marketingOriginForHost('app-example.vercel.app')).toBeUndefined()
  })

  it('maps marketing hosts to the matching app href', () => {
    expect(appHrefForHost('axiom-foundation.org')).toBe(
      'https://axiom.org/app',
    )
    expect(appHrefForHost('www.axiom-foundation.org')).toBe(
      'https://axiom.org/app',
    )
    expect(appHrefForHost('app.axiom-foundation.org')).toBe(
      'https://axiom.org/app',
    )
    expect(
      appHrefForHost(
        'axiom-foundation-git-fix-app-header-redirects-policy-engine.vercel.app',
      ),
    ).toBe('/axiom')
    expect(appHrefForHost('app-axiom-foundation-git-fix-app-header-redirects-policy-engine.vercel.app')).toBeUndefined()
    expect(appHrefForHost('app-axiom-foundation-preview.vercel.app')).toBeUndefined()
    expect(appHrefForHost('axiom-foundation-preview.vercel.app')).toBeUndefined()
    expect(appHrefForHost('preview-policy-engine.vercel.app')).toBeUndefined()
  })

  it('renders the logo linking to home', () => {
    mockUsePathname.mockReturnValue('/')
    render(<NavClient />)
    const logo = screen.getByAltText('Axiom Foundation')
    expect(logo.closest('a')).toHaveAttribute('href', '/')
  })

  it('renders the full launch navigation links (pages only, no scroll anchors)', () => {
    mockUsePathname.mockReturnValue('/')
    render(<NavClient />)
    expect(screen.getAllByText('Get started').length).toBeGreaterThan(0)
    expect(screen.getAllByText("What's possible").length).toBeGreaterThan(0)
    expect(screen.getAllByText('Coverage').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Validation').length).toBeGreaterThan(0)
    expect(screen.getAllByText('About').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Team').length).toBeGreaterThan(0)
    // Landing scroll anchors live on the page, not in the header;
    // Docs is footer-only (contributor audience).
    expect(screen.queryByText('Why')).not.toBeInTheDocument()
    expect(screen.queryByText('Encoding')).not.toBeInTheDocument()
    expect(screen.queryByText('Docs')).not.toBeInTheDocument()
  })

  it('renders demos dropdown items by segment', () => {
    mockUsePathname.mockReturnValue('/')
    render(<NavClient />)
    expect(screen.getAllByText('Build a form').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ask about benefits and taxes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Explore benefits cliffs').length).toBeGreaterThan(0)
    expect(screen.getAllByText('All demos').length).toBeGreaterThan(0)
  })

  it('highlights active link on /about', () => {
    mockUsePathname.mockReturnValue('/about')
    render(<NavClient />)
    const aboutLink = screen.getAllByText('About')[0]
    expect(aboutLink.closest('a')).toHaveClass('is-active')
  })

  it('renders a GitHub icon link', () => {
    mockUsePathname.mockReturnValue('/')
    render(<NavClient />)
    const links = screen.getAllByRole('link')
    const githubLink = links.find(
      (l) => l.getAttribute('href') === 'https://github.com/TheAxiomFoundation',
    )
    expect(githubLink).toBeDefined()
  })

  it('renders hamburger button for mobile', () => {
    mockUsePathname.mockReturnValue('/')
    render(<NavClient />)
    const button = screen.getByLabelText('Open menu')
    expect(button).toBeInTheDocument()
  })

  it('opens mobile drawer on hamburger click', () => {
    mockUsePathname.mockReturnValue('/')
    render(<NavClient />)
    const button = screen.getByLabelText('Open menu')
    fireEvent.click(button)
    // About appears in both the desktop nav and the mobile drawer.
    expect(screen.getAllByText('About').length).toBe(2)
    expect(screen.getByLabelText('Close menu')).toBeInTheDocument()
  })

  it('closes mobile drawer on link click', () => {
    mockUsePathname.mockReturnValue('/')
    render(<NavClient />)
    fireEvent.click(screen.getByLabelText('Open menu'))
    const aboutLinks = screen.getAllByText('About')
    fireEvent.click(aboutLinks[1])
    expect(screen.getAllByText('About').length).toBe(1)
  })

  it('renders marketing links as absolute URLs from the first render', () => {
    mockUsePathname.mockReturnValue('/axiom/us')
    render(
      <NavClient
        baseUrl="https://axiom-foundation.org"
        appUrl="https://app.axiom-foundation.org"
      />,
    )

    expect(screen.getAllByText('About')[0].closest('a')).toHaveAttribute(
      'href',
      'https://axiom-foundation.org/about',
    )
    expect(screen.getByAltText('Axiom Foundation').closest('a')).toHaveAttribute(
      'href',
      'https://axiom-foundation.org',
    )
  })
})

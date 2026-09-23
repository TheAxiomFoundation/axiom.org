import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('next/navigation', () => ({ notFound }))

vi.mock('@/lib/ghost', () => ({
  getBlogPost: vi.fn(),
}))

import { getBlogPost } from '@/lib/ghost'
import BlogPostPage, { generateMetadata } from './page'

const POST = {
  slug: 'first-post',
  title: 'Encoding Title 7, end to end',
  excerpt: 'How the encoder walked chapter 51.',
  publishedAt: '2026-07-20T12:00:00.000+00:00',
  featureImage: 'https://example.com/cover.png',
  featureImageAlt:
    'Sepia illustration of an auditor at a desk holding a signed, stamped record up to the light, with a torn copy on the desk stamped REFUSED.',
  featureImageCaption:
    '<span style="white-space: pre-wrap;">Photo by Martin Romero</span>',
  readingTime: 4,
  html: '<p>The encoder starts from the statute text.</p>',
  updatedAt: '2026-07-21T09:30:00.000+00:00',
  authors: ['Ariel Kennan'],
  status: null,
}

const params = Promise.resolve({ slug: 'first-post' })

describe('Blog post page', () => {
  it('renders the post title, byline, and body HTML', async () => {
    vi.mocked(getBlogPost).mockResolvedValue(POST)
    render(await BlogPostPage({ params }))
    expect(
      screen.getByRole('heading', { name: /encoding title 7, end to end/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/ariel kennan · july 20, 2026/i)).toBeInTheDocument()
    expect(
      screen.getByText(/the encoder starts from the statute text/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /blog/i })).toHaveAttribute(
      'href',
      '/blog'
    )
  })

  it('renders the cover image with its Ghost alt text and caption', async () => {
    vi.mocked(getBlogPost).mockResolvedValue(POST)
    render(await BlogPostPage({ params }))
    const cover = screen.getByRole('img', { name: POST.featureImageAlt })
    expect(cover).toHaveAttribute('src', 'https://example.com/cover.png')
    const figure = cover.closest('figure')
    expect(figure).not.toBeNull()
    expect(figure?.querySelector('figcaption')?.innerHTML).toBe(
      POST.featureImageCaption
    )
    expect(screen.getByText('Photo by Martin Romero')).toBeInTheDocument()
  })

  it('marks a cover without alt text decorative and omits the caption', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({
      ...POST,
      featureImageAlt: null,
      featureImageCaption: null,
    })
    const { container } = render(await BlogPostPage({ params }))
    const cover = container.querySelector('img')
    expect(cover).toHaveAttribute('src', 'https://example.com/cover.png')
    expect(cover).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('figcaption')).toBeNull()
  })

  it('renders no cover figure for a post without a feature image', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({
      ...POST,
      featureImage: null,
      featureImageAlt: null,
      featureImageCaption: null,
    })
    const { container } = render(await BlogPostPage({ params }))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('figure')).toBeNull()
  })

  it('calls notFound for a missing slug', async () => {
    vi.mocked(getBlogPost).mockResolvedValue(null)
    await expect(BlogPostPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('builds metadata from the post', async () => {
    vi.mocked(getBlogPost).mockResolvedValue(POST)
    const meta = await generateMetadata({ params })
    expect(meta.title).toBe('Encoding Title 7, end to end — Axiom Foundation')
    expect(meta.description).toBe('How the encoder walked chapter 51.')
  })

  // Next replaces the root layout's openGraph wholesale when a page sets
  // its own, so the post's block restates the url, site name, and brand
  // card instead of inheriting them.
  it('builds a complete article openGraph from the post', async () => {
    vi.mocked(getBlogPost).mockResolvedValue(POST)
    const meta = await generateMetadata({ params })
    expect(meta.openGraph).toEqual({
      type: 'article',
      url: './',
      siteName: 'Axiom Foundation',
      title: 'Encoding Title 7, end to end',
      description: 'How the encoder walked chapter 51.',
      publishedTime: '2026-07-20T12:00:00.000+00:00',
      modifiedTime: '2026-07-21T09:30:00.000+00:00',
      authors: ['Ariel Kennan'],
      images: [{ url: 'https://example.com/cover.png', alt: POST.featureImageAlt }],
    })
  })

  it('omits the share-image alt when the cover has none', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({ ...POST, featureImageAlt: null })
    const meta = await generateMetadata({ params })
    expect(meta.openGraph?.images).toEqual([
      { url: 'https://example.com/cover.png' },
    ])
  })

  it('falls back to the brand share card when the post has no cover', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({
      ...POST,
      featureImage: null,
      featureImageAlt: null,
      featureImageCaption: null,
    })
    const meta = await generateMetadata({ params })
    expect(meta.openGraph).toEqual({
      type: 'article',
      url: './',
      siteName: 'Axiom Foundation',
      title: 'Encoding Title 7, end to end',
      description: 'How the encoder walked chapter 51.',
      publishedTime: '2026-07-20T12:00:00.000+00:00',
      modifiedTime: '2026-07-21T09:30:00.000+00:00',
      authors: ['Ariel Kennan'],
      images: ['/og-image.png'],
    })
  })

  it('leaves out article fields Ghost did not supply', async () => {
    vi.mocked(getBlogPost).mockResolvedValue({
      ...POST,
      excerpt: null,
      publishedAt: null,
      updatedAt: null,
      authors: [],
    })
    const meta = await generateMetadata({ params })
    expect(meta.description).toBeUndefined()
    // toEqual ignores undefined-valued keys, and Next skips them too.
    expect(meta.openGraph).toEqual({
      type: 'article',
      url: './',
      siteName: 'Axiom Foundation',
      title: 'Encoding Title 7, end to end',
      images: [{ url: 'https://example.com/cover.png', alt: POST.featureImageAlt }],
    })
  })

  it('titles a missing post as the blog', async () => {
    vi.mocked(getBlogPost).mockResolvedValue(null)
    expect(await generateMetadata({ params })).toEqual({
      title: 'Blog — Axiom Foundation',
    })
  })
})

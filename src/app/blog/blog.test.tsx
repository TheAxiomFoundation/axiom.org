import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('@/lib/ghost', () => ({
  getBlogPosts: vi.fn(),
}))

import { getBlogPosts } from '@/lib/ghost'
import BlogPage from './page'

const POSTS = [
  {
    slug: 'first-post',
    title: 'Encoding Title 7, end to end',
    excerpt: 'How the encoder walked chapter 51.',
    publishedAt: '2026-07-20T12:00:00.000+00:00',
    featureImage: null,
    featureImageAlt: null,
    featureImageCaption: null,
    readingTime: 4,
  },
  {
    slug: 'second-post',
    title: 'Validation against the oracles',
    excerpt: null,
    publishedAt: null,
    featureImage: null,
    featureImageAlt: null,
    featureImageCaption: null,
    readingTime: null,
  },
]

describe('Blog page', () => {
  it('lists posts with dates and links to each post', async () => {
    vi.mocked(getBlogPosts).mockResolvedValue(POSTS)
    render(await BlogPage())
    expect(screen.getByRole('heading', { name: /blog/i })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /encoding title 7, end to end/i })
    ).toHaveAttribute('href', '/blog/first-post')
    expect(screen.getByText(/july 20, 2026/i)).toBeInTheDocument()
    expect(screen.getByText(/how the encoder walked chapter 51/i)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /validation against the oracles/i })
    ).toHaveAttribute('href', '/blog/second-post')
  })

  it('renders an empty state when there are no posts', async () => {
    vi.mocked(getBlogPosts).mockResolvedValue([])
    render(await BlogPage())
    expect(screen.getByText(/no posts yet/i)).toBeInTheDocument()
  })
})

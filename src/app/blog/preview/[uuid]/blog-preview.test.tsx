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
  getDraftPreview: vi.fn(),
}))

import { getDraftPreview } from '@/lib/ghost'
import BlogPreviewPage from './page'

const DRAFT = {
  slug: 'coming-soon',
  title: 'Test post',
  excerpt: null,
  publishedAt: null,
  featureImage: null,
  featureImageAlt: null,
  featureImageCaption: null,
  readingTime: 1,
  html: '<p>Still being written.</p>',
  authors: [],
  status: 'draft',
}

const params = Promise.resolve({ uuid: '8add9475-e561-43fe-923c-c20f93e0f54b' })

describe('Blog preview page', () => {
  it('renders the draft with a preview banner', async () => {
    vi.mocked(getDraftPreview).mockResolvedValue(DRAFT)
    render(await BlogPreviewPage({ params }))
    expect(screen.getByText(/draft preview — not published/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /test post/i })).toBeInTheDocument()
    expect(screen.getByText(/still being written/i)).toBeInTheDocument()
  })

  it('renders the draft cover with its Ghost alt text', async () => {
    vi.mocked(getDraftPreview).mockResolvedValue({
      ...DRAFT,
      featureImage: 'https://example.com/draft-cover.png',
      featureImageAlt: 'Sepia illustration of a caseworker reading a letter.',
    })
    render(await BlogPreviewPage({ params }))
    expect(
      screen.getByRole('img', {
        name: 'Sepia illustration of a caseworker reading a letter.',
      })
    ).toHaveAttribute('src', 'https://example.com/draft-cover.png')
  })

  it('calls notFound for an unknown uuid', async () => {
    vi.mocked(getDraftPreview).mockResolvedValue(null)
    await expect(BlogPreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })
})

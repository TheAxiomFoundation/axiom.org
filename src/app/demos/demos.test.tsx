import { render, screen } from '@testing-library/react'
import DemosPage, { metadata } from './page'

const props = (params: Record<string, string> = {}) => ({
  searchParams: Promise.resolve(params),
})

describe('DemosPage', () => {
  it('renders the header and embeds the demo-shell gallery', async () => {
    render(await DemosPage(props()))
    expect(
      screen.getByRole('heading', { name: /built on the open layer/i }),
    ).toBeInTheDocument()
    expect(screen.getByTitle('Axiom demo gallery')).toHaveAttribute(
      'src',
      'https://axiom-demo-shell.vercel.app/demos/',
    )
    // Closing CTA still points into the app.
    expect(screen.getByText(/the axiom app/i).closest('a')).toHaveAttribute(
      'href',
      'https://axiom.org/app',
    )
    // Axiom local link rides below the gallery.
    expect(
      screen.getByRole('link', { name: /axiom local/i }),
    ).toHaveAttribute('href', 'https://axiom.org/local')
  })

  it('passes valid ?d= deep links through to the shell', async () => {
    render(await DemosPage(props({ d: 'chatbot' })))
    expect(screen.getByTitle('Axiom demo gallery')).toHaveAttribute(
      'src',
      'https://axiom-demo-shell.vercel.app/demos/?d=chatbot',
    )
  })

  it('maps legacy renamed ids onto their new demo', async () => {
    render(await DemosPage(props({ d: 'finbot' })))
    expect(screen.getByTitle('Axiom demo gallery')).toHaveAttribute(
      'src',
      'https://axiom-demo-shell.vercel.app/demos/?d=chatbot',
    )
  })

  it('strips unknown ?d= values instead of forwarding them', async () => {
    render(await DemosPage(props({ d: 'not-a-demo"><script>' })))
    expect(screen.getByTitle('Axiom demo gallery')).toHaveAttribute(
      'src',
      'https://axiom-demo-shell.vercel.app/demos/',
    )
  })

  it('keeps the page metadata', () => {
    expect(metadata.title).toMatch(/live demos/i)
  })

  // The search snippet and intro describe the chatbot too. It is an OpenAI
  // model with tool access to the rules engine, and most of its headline
  // outputs carry no legal id (finbot-snap-demo catalog), so neither may say
  // the assistants are grounded in cited rules or that every demo shares
  // one encoding.
  it('describes the demos without overstating the chatbot', async () => {
    const { container } = render(await DemosPage(props()))
    const text = `${String(metadata.description)} ${container.textContent ?? ''}`
    expect(text).not.toMatch(/grounded in cited rules/i)
    expect(text).not.toMatch(/every demo runs on the same/i)
    expect(text).not.toMatch(/\b(certified|verified|accurate|official)\b/i)
    expect(String(metadata.description)).toMatch(/tool access to the rules engine/i)
  })
})

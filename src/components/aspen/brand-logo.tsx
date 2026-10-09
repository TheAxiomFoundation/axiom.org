/**
 * The Axiom Foundation full lockup from the brand kit (axiom-brand,
 * svg/wordmark/full/axiom-full-w350-gradient.svg, shipped as
 * /logos/axiom-foundation.svg): the w350 wordmark with FOUNDATION under
 * it, in the amber gradient on paper. The kit asks outward-facing pages to
 * use this full lockup and never to redraw it; the file carries its own
 * clear space.
 */
export function BrandLogo({ className = "" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- a static SVG, like the site nav's logo
  return <img src="/logos/axiom-foundation.svg" alt="Axiom Foundation" className={`w-auto shrink-0 ${className}`} />;
}

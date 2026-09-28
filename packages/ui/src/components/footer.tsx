import { BlueskyIcon, GitHubIcon, LinkedInIcon, XIcon } from "./icons";
import { resolveHref, type RenderLinkComponent } from "./link-utils";

export interface FooterProps {
  /** Base URL for generating absolute links (e.g. "https://axiom-foundation.org") */
  baseUrl?: string;
  /** URL for the Axiom app link. Defaults to the production app subdomain. */
  appUrl?: string;
  /** Custom link renderer for framework integration (e.g. Next.js Link) */
  renderLink?: RenderLinkComponent;
  /** Logo image src. Defaults to "/logos/axiom-foundation.svg". */
  logoSrc?: string;
  /** Newsletter signup URL for the "Get updates" link. The site passes
   *  UPDATES_URL from src/lib/launch.ts so signup CTAs stay in sync. */
  updatesUrl?: string;
}

const LINK_CLASS =
  "link-quiet text-[0.9rem] text-[var(--color-ink-secondary)] inline-block";

const DEFAULT_LOGO = "/logos/axiom-foundation.svg";

const SOCIALS = [
  {
    href: "https://github.com/TheAxiomFoundation",
    label: "GitHub",
    Icon: GitHubIcon,
  },
  {
    href: "https://www.linkedin.com/company/axiomfoundation",
    label: "LinkedIn",
    Icon: LinkedInIcon,
  },
  {
    href: "https://x.com/AxiomFdn",
    label: "X",
    Icon: XIcon,
  },
  {
    href: "https://bsky.app/profile/axiom.org",
    label: "Bluesky",
    Icon: BlueskyIcon,
  },
];

export function Footer({
  baseUrl = "",
  appUrl = "https://axiom.org/app",
  renderLink: LinkComponent,
  logoSrc,
  updatesUrl = "mailto:hello@axiom.org?subject=Axiom%20updates",
}: FooterProps = {}) {
  const resolvedLogoSrc = logoSrc
    ? logoSrc
    : baseUrl
      ? `${baseUrl}${DEFAULT_LOGO}`
      : DEFAULT_LOGO;

  function renderFooterLink(href: string, label: string) {
    const resolved = resolveHref(href, baseUrl);
    const isExternal = href.startsWith("http") || href.startsWith("mailto:");

    if (baseUrl || !LinkComponent || isExternal) {
      return (
        <a
          key={href}
          href={resolved}
          className={LINK_CLASS}
          {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {label}
        </a>
      );
    }

    return (
      <LinkComponent key={href} href={href} className={LINK_CLASS}>
        {label}
      </LinkComponent>
    );
  }

  function renderColumn(
    title: string,
    links: { href: string; label: string }[],
  ) {
    return (
      <div>
        <h3 className="font-mono text-[0.65rem] tracking-[0.22em] uppercase text-[var(--color-ink-muted)] mb-4">
          {title}
        </h3>
        <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
          {links.map((link) => (
            <li key={link.href}>{renderFooterLink(link.href, link.label)}</li>
          ))}
        </ul>
      </div>
    );
  }

  const year = new Date().getFullYear();

  return (
    <footer className="relative z-10 px-8 border-t border-[var(--color-rule)]">
      <div className="max-w-[1280px] mx-auto py-16">
        <div className="grid gap-12 md:grid-cols-[1.6fr_1fr_1fr_1fr] md:gap-14 mb-14">
          <div>
            <img
              src={resolvedLogoSrc}
              alt="Axiom Foundation"
              className="h-9 w-auto mb-5"
            />
            <p
              className="text-[0.95rem] text-[var(--color-ink-secondary)] leading-relaxed max-w-[280px]"
              style={{ fontFamily: "var(--f-serif)", fontStyle: "italic" }}
            >
              Computable law for all.
            </p>
            <p className="text-[0.8rem] text-[var(--color-ink-muted)] mt-4 leading-relaxed max-w-[280px]">
              Open, machine-readable encodings of the world&apos;s rules
              &mdash; starting with tax and benefit policy.
            </p>
            <div className="mt-6 flex items-center gap-4">
              {SOCIALS.map(({ href, label, Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] transition-colors duration-150"
                >
                  <Icon className="w-5 h-5" />
                </a>
              ))}
            </div>
          </div>

          {renderColumn("Product", [
            { href: appUrl, label: "Axiom platform" },
            { href: "/demos", label: "Demos" },
            { href: "/coverage", label: "Coverage" },
            { href: "/validation", label: "Validation" },
            { href: "/citations", label: "Citations" },
            { href: "/docs", label: "Documentation" },
          ])}

          {renderColumn("Foundation", [
            { href: "/about", label: "About" },
            { href: "/team", label: "Team" },
            { href: "/blog", label: "Blog" },
            { href: "/privacy", label: "Privacy" },
          ])}

          {renderColumn("Connect", [
            { href: "/contact", label: "Contact" },
            { href: updatesUrl, label: "Get updates" },
            {
              href: "mailto:hello@axiom.org",
              label: "hello@axiom.org",
            },
          ])}
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pt-6 border-t border-[var(--color-rule-subtle)]">
          <p className="font-mono text-[0.7rem] tracking-[0.08em] text-[var(--color-ink-muted)] m-0">
            &copy; {year} Axiom Foundation &middot; Doing the public-interest work
          </p>
          <p className="font-mono text-[0.7rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] m-0">
            <span className="glyph-axiom text-[var(--color-accent)]" aria-hidden="true">∀</span>{" "}
            Open infrastructure for encoded law
          </p>
        </div>
      </div>
    </footer>
  );
}

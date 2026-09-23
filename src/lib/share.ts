/**
 * Site-wide share-card defaults. Next merges metadata per top-level
 * key, so a page that sets its own `openGraph` replaces the root
 * layout's block wholesale; pages that still want the brand defaults
 * import them from here instead of copying the literals.
 */

/** og:site_name for pages that set their own openGraph. */
export const SITE_NAME = "Axiom Foundation";

/** Official brand share card (axiom-brand png/social/og-paper-full.png,
 *  1200×630, w350 lockup on paper). Relative to metadataBase. */
export const DEFAULT_SHARE_IMAGE = "/og-image.png";

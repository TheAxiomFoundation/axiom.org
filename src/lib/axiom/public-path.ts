/**
 * The request header that carries the path a browser asked for across the
 * proxy's rewrite (src/proxy.ts), so a page served under the /axiom/v2
 * mount can name that same path again. The proxy sets it on every rewrite,
 * over any copy the request brought.
 */
export const PUBLIC_PATH_HEADER = "x-axiom-public-path";

// Any origin serves: the check only asks whether a path keeps it.
const ORIGIN = "https://same-origin.invalid";

/**
 * True when `path` can stand as a redirect target that stays on this site
 * and names the same path again: one leading "/", no empty segment,
 * printable ASCII with no backslash, "?" or "#", and nothing a URL parser
 * would resolve (a dot segment) or read as a scheme or host.
 */
export function isSameOriginPath(path: string): boolean {
  if (!/^\/[!-~]*$/.test(path) || /[\\?#]/.test(path) || path.includes("//")) {
    return false;
  }
  const url = new URL(path, ORIGIN);
  return url.origin === ORIGIN && url.pathname === path;
}

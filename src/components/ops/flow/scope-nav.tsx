import styles from "./flow.module.css";

/**
 * A jurisdiction switch: All, then the busiest roots. `href` builds each
 * choice's address, so the switch keeps the rest of the page's state.
 */
export function ScopeNav({ current, options, href }: { current: string | null; options: string[]; href: (j: string | null) => string }) {
  // A scope from the address that is not among the busiest still shows, last.
  const ordered = [null, ...options, ...(current && !options.includes(current) ? [current] : [])];
  return (
    <nav className={styles.seg} aria-label="Jurisdiction">
      {ordered.map((j) =>
        j === current ? (
          <span key={j ?? "all"} aria-current="page">
            {j ?? "All"}
          </span>
        ) : (
          <a key={j ?? "all"} href={href(j)}>
            {j ?? "All"}
          </a>
        )
      )}
    </nav>
  );
}

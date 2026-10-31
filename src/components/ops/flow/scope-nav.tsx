import styles from "./flow.module.css";

/**
 * A jurisdiction switch: All, then the busiest roots. `href` builds each
 * choice's address, so the switch keeps the rest of the page's state.
 */
export function ScopeNav({
  current,
  options,
  href,
  onSelect,
}: {
  current: string | null;
  options: string[];
  href: (j: string | null) => string;
  /** Switch in place: a plain click calls this instead of loading the address (a new tab still opens it). */
  onSelect?: (j: string | null) => void;
}) {
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
          <a
            key={j ?? "all"}
            href={href(j)}
            // Only a client caller passes onSelect; on the server the switch stays plain links.
            onClick={
              onSelect
                ? (event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                    event.preventDefault();
                    onSelect(j);
                  }
                : undefined
            }
          >
            {j ?? "All"}
          </a>
        )
      )}
    </nav>
  );
}

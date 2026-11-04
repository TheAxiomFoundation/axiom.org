import styles from "./flow.module.css";

/**
 * A jurisdiction switch: All, then the busiest roots, shown as codes in
 * capitals (US, DK). Once a root with subdivisions is chosen, a second row
 * offers them (All US, AZ, CO). `href` builds each choice's address, so the
 * switch keeps the rest of the page's state.
 */
export function ScopeNav({
  current,
  options,
  subdivisions = {},
  href,
  onSelect,
}: {
  current: string | null;
  options: string[];
  /** The jurisdictions under each root (`us` → `us-az`), for the second row. */
  subdivisions?: Record<string, string[]>;
  href: (j: string | null) => string;
  /** Switch in place: a plain click calls this instead of loading the address (a new tab still opens it). */
  onSelect?: (j: string | null) => void;
}) {
  const root = current ? current.split("-")[0] : null;
  // A scope from the address that is not among the busiest still shows, last.
  const roots = [null, ...options, ...(root && !options.includes(root) ? [root] : [])];
  const under = root ? subdivisions[root] ?? [] : [];
  const subs = root && (under.length || current !== root) ? [root, ...under, ...(current !== root && !under.includes(current!) ? [current] : [])] : [];

  const choice = (j: string | null, label: string, selected: boolean) =>
    j === current ? (
      <span key={j ?? "all"} aria-current="page">
        {label}
      </span>
    ) : (
      <a
        key={j ?? "all"}
        href={href(j)}
        // A root whose subdivision is chosen stays marked, and links back to the whole root.
        aria-current={selected ? "true" : undefined}
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
        {label}
      </a>
    );

  return (
    <div className={styles.scopeRows}>
      <nav className={styles.seg} aria-label="Jurisdiction">
        {roots.map((j) => choice(j, j ? j.toUpperCase() : "All", j !== null && j === root))}
      </nav>
      {subs.length > 0 && (
        <nav className={styles.seg} aria-label={`Within ${root!.toUpperCase()}`}>
          {subs.map((j) => choice(j, j === root ? `All ${root!.toUpperCase()}` : j!.slice(root!.length + 1).toUpperCase(), false))}
        </nav>
      )}
    </div>
  );
}

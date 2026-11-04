import styles from "./flow.module.css";
import { ScopeSelect } from "./scope-select";

/**
 * A jurisdiction switch: a dropdown of All and the busiest roots, as codes
 * in capitals (US, DK). Once a root with subdivisions is chosen, a second
 * dropdown beside it offers the whole root, the root alone (Federal for the
 * US), and each subdivision (AZ, CO). `href` builds each choice's address,
 * so the switch keeps the rest of the page's state.
 */
export function ScopeNav({
  current,
  only = false,
  options,
  subdivisions = {},
  href,
  onSelect,
}: {
  current: string | null;
  /** The scope is `current` alone, without the jurisdictions under it. */
  only?: boolean;
  options: string[];
  /** The jurisdictions under each root (`us` → `us-az`), for the second dropdown. */
  subdivisions?: Record<string, string[]>;
  href: (j: string | null, only?: boolean) => string;
  /** Switch in place instead of loading the address. */
  onSelect?: (j: string | null, only?: boolean) => void;
}) {
  const root = current ? current.split("-")[0] : null;
  // A scope from the address that is not among the busiest still shows, last.
  const roots = [...options, ...(root && !options.includes(root) ? [root] : [])];
  const under = root ? subdivisions[root] ?? [] : [];
  const subs = root && (under.length || current !== root) ? [...under, ...(current !== root && !under.includes(current!) ? [current!] : [])] : [];
  const ROOT = root?.toUpperCase() ?? "";

  // A choice's key: "" for All, the jurisdiction, or "us|only" for the root alone.
  const key = (j: string | null, alone = false) => (j ? `${j}${alone ? "|only" : ""}` : "");
  const choose = onSelect
    ? (value: string) => {
        const [j, alone] = value.split("|");
        onSelect(j || null, alone === "only");
      }
    : undefined;

  return (
    <div className={styles.scopeRows}>
      <ScopeSelect
        label="Jurisdiction"
        current={key(root)}
        choices={[null, ...roots].map((j) => ({ value: key(j), label: j ? j.toUpperCase() : "All", href: href(j) }))}
        onSelect={choose}
      />
      {subs.length > 0 && (
        <ScopeSelect
          label={`Within ${ROOT}`}
          current={key(current, only && current === root)}
          choices={[
            { value: key(root), label: `All ${ROOT}`, href: href(root) },
            { value: key(root, true), label: root === "us" ? "Federal" : `${ROOT} only`, href: href(root, true) },
            ...subs.map((j) => ({ value: key(j), label: j.slice(root!.length + 1).toUpperCase(), href: href(j) })),
          ]}
          onSelect={choose}
        />
      )}
    </div>
  );
}

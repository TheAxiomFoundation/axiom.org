import { FileText } from "lucide-react";

/**
 * The tier palettes and the foil "A" from the core deck (axiom-audiences
 * shells/base.html, `.tier.silver` and `.tier.gold`): a shaded disc, a ring
 * in the tier color, and the Axiom A in a metallic gradient.
 */
export const TIERS = {
  silver: {
    ring: "#8d969f",
    tint: "#eef0f2",
    ink: "#5b636c",
    disc: "radial-gradient(circle at 34% 28%, #ffffff 0%, #e7eaed 55%, #c4cad0 100%)",
    foil: ["#c9cfd5", "#838c96", "#4c545d"],
  },
  gold: {
    ring: "#b7862b",
    tint: "#f6eed8",
    ink: "#8b6415",
    disc: "radial-gradient(circle at 34% 28%, #fffaf0 0%, #f1e2b9 55%, #dcc086 100%)",
    foil: ["#e9bf5c", "#c1902f", "#94681a"],
  },
} as const;

export type Medal = keyof typeof TIERS;

/** A tier's medallion, or a document icon for the step before the tiers. */
export function TierMedal({ medal, size }: { medal: Medal | null; size: number }) {
  if (!medal) {
    return (
      <span
        aria-hidden
        className="flex shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]"
        style={{ width: size, height: size, boxShadow: "inset 0 0 0 1.5px var(--color-accent)" }}
      >
        <FileText size={Math.round(size * 0.5)} strokeWidth={1.75} />
      </span>
    );
  }
  const t = TIERS[medal];
  const id = `tier-foil-${medal}`;
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: t.disc, boxShadow: `inset 0 0 0 1.5px ${t.ring}, 0 1px 2px rgba(0,0,0,.14)` }}
    >
      <svg viewBox="-40 -40 739 790" style={{ width: size * 0.52, height: size * 0.52 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={t.foil[0]} />
            <stop offset=".55" stopColor={t.foil[1]} />
            <stop offset="1" stopColor={t.foil[2]} />
          </linearGradient>
        </defs>
        <path fill={`url(#${id})`} d="M21 0L278 710L381 710L638 0L554 0L481 207L178 207L105 0ZM204 283L455 283L329 642Z" />
      </svg>
    </span>
  );
}

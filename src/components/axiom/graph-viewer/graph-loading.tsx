export function GraphLoading({ label = "Loading graph…" }: { label?: string }) {
  return <div className="graph-loading-visual" role="status">
    <svg viewBox="0 0 200 104" width="200" height="104" fill="none" aria-hidden="true">
      <path d="M44 24H76Q84 24 84 32V72Q84 80 76 80H44M84 52H112M144 52H160Q168 52 168 44V24H180M168 52V80H180" />
      <rect x="8" y="12" width="36" height="24" rx="6" />
      <rect x="8" y="68" width="36" height="24" rx="6" />
      <rect className="graph-loading-center" x="108" y="36" width="36" height="32" rx="7" />
      <circle cx="184" cy="24" r="6" />
      <circle cx="184" cy="80" r="6" />
    </svg>
    <span>{label}</span>
  </div>;
}

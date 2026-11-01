type Props = { className?: string; markOnly?: boolean; size?: number };

/** NORDEVA brand mark — a prism of light: an aperture ring with a refracted beam. */
export function VELORAMark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={className}
    >
      <defs>
        <linearGradient id="lume-g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="oklch(0.72 0.19 300)" />
          <stop offset="1" stopColor="oklch(0.8 0.14 322)" />
        </linearGradient>
        <radialGradient id="lume-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="oklch(0.98 0.03 310)" />
          <stop offset="1" stopColor="oklch(0.68 0.22 303)" />
        </radialGradient>
      </defs>
      {/* aperture blades */}
      <path
        d="M16 3.2 L27.4 9.6 L27.4 22.4 L16 28.8 L4.6 22.4 L4.6 9.6 Z"
        stroke="url(#lume-g)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        opacity="0.85"
      />
      {/* refracted beam */}
      <path d="M16 8.6 L22.6 20.4 H9.4 Z" fill="url(#lume-g)" opacity="0.28" />
      <path
        d="M16 8.6 L22.6 20.4 H9.4 Z"
        stroke="url(#lume-g)"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16.6" r="2.4" fill="url(#lume-core)" />
    </svg>
  );
}

export function VELORALogo({ className = "", markOnly = false, size = 22 }: Props) {
  return (
    <span className={`group inline-flex items-center gap-2.5 ${className}`}>
      <VELORAMark
        size={size}
        className="transition-transform duration-500 group-hover:rotate-[30deg]"
      />
      {!markOnly && (
        <span className="flex items-baseline gap-1.5">
          <span className="font-display text-[1.05em] font-semibold tracking-[-0.02em]">
            NORDEVA
          </span>
          <span className="hidden text-[0.6em] font-medium uppercase tracking-[0.28em] text-muted-foreground sm:inline">
            Marketplace
          </span>
        </span>
      )}
    </span>
  );
}

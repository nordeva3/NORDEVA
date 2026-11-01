type Props = { className?: string; markOnly?: boolean; size?: number };

/** NORDEVA brand mark — a silver "N" on a graphite tile (TITANIUM identity).
 *  Self-contained tile, so it stays crisp and on-brand on any background. */
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
        <linearGradient id="nordeva-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2027" />
          <stop offset="1" stopColor="#0b0d10" />
        </linearGradient>
        <linearGradient id="nordeva-n" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f7fa" />
          <stop offset="0.55" stopColor="#b9c2ce" />
          <stop offset="1" stopColor="#7f8894" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="url(#nordeva-tile)" />
      <rect
        x="1.6"
        y="1.6"
        width="28.8"
        height="28.8"
        rx="7.9"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.14"
      />
      <rect x="6" y="3" width="20" height="1.1" rx="0.55" fill="#ffffff" opacity="0.1" />
      <path
        d="M11.2 21.8 V10.2 L20.8 21.8 V10.2"
        stroke="url(#nordeva-n)"
        strokeWidth="3.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VELORALogo({ className = "", markOnly = false, size = 22 }: Props) {
  return (
    <span className={`group inline-flex items-center gap-2.5 ${className}`}>
      <VELORAMark
        size={size}
        className="transition-transform duration-300 group-hover:scale-[1.07]"
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

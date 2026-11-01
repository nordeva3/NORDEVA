import { motion, useReducedMotion, type HTMLMotionProps, type Transition } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const EASE_OUT: Transition = { duration: 0.6, ease: [0.16, 1, 0.3, 1] };
export const SPRING: Transition = { type: "spring", stiffness: 320, damping: 26, mass: 0.7 };

/**
 * Reports whether the device can comfortably run the heavier depth / 3D layers.
 * Low core count, low memory, small screens, or reduced-motion → light mode.
 */
export function useCapableDevice() {
  const [capable, setCapable] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const nav = navigator as Navigator & { hardwareConcurrency?: number; deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const memory = nav.deviceMemory ?? 4;
    setCapable(!reduced && !coarse && cores >= 4 && memory >= 4 && window.innerWidth >= 1024);
  }, []);
  return capable;
}

/** Normalised (-1..1) pointer position, updated on a rAF budget. */
export function usePointer(enabled = true) {
  const [p, setP] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setP({
          x: (e.clientX / window.innerWidth) * 2 - 1,
          y: (e.clientY / window.innerHeight) * 2 - 1,
        });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return p;
}

/** Scroll / mount reveal. */
export function FadeIn({
  children,
  delay = 0,
  y = 22,
  className = "",
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount: 0.15 }}
      transition={{ ...EASE_OUT, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({
  children,
  className = "",
  gap = 0.06,
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.1 }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      variants={{
        hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.985 },
        show: { opacity: 1, y: 0, scale: 1, transition: EASE_OUT },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Pointer-tracked 3D tilt with soft glare. Disabled on low-capability devices. */
export function Tilt({
  children,
  className = "",
  strength = 7,
  glare = true,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
  glare?: boolean;
}) {
  const capable = useCapableDevice();
  const ref = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState({ rx: 0, ry: 0, gx: 50, gy: 50, active: false });

  if (!capable) return <div className={className}>{children}</div>;

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        setT({
          rx: (0.5 - py) * strength * 2,
          ry: (px - 0.5) * strength * 2,
          gx: px * 100,
          gy: py * 100,
          active: true,
        });
      }}
      onPointerLeave={() => setT((s) => ({ ...s, rx: 0, ry: 0, active: false }))}
      style={{ perspective: 1100 }}
      className={className}
    >
      <div
        className="relative size-full transition-transform duration-300 [transform-style:preserve-3d] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]"
        style={{ transform: `rotateX(${t.rx}deg) rotateY(${t.ry}deg) translateZ(0)` }}
      >
        {children}
        {glare && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
            style={{
              opacity: t.active ? 0.55 : 0,
              background: `radial-gradient(320px circle at ${t.gx}% ${t.gy}%, oklch(1 0 0 / 0.09), transparent 65%)`,
            }}
          />
        )}
      </div>
    </div>
  );
}

type RippleProps = HTMLMotionProps<"button"> & { children: ReactNode };

/** Magnetic press + material ripple. */
export function RippleButton({ children, className = "", onClick, ...rest }: RippleProps) {
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.975 }}
      transition={SPRING}
      className={`relative overflow-hidden ${className}`}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const id = Date.now();
        setRipples((rs) => [...rs, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
        setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 620);
        onClick?.(e);
      }}
      {...rest}
    >
      {ripples.map((r) => (
        <motion.span
          key={r.id}
          initial={{ opacity: 0.4, scale: 0 }}
          animate={{ opacity: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          aria-hidden
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{ left: r.x, top: r.y, width: 340, height: 340 }}
        />
      ))}
      <span className="relative z-[1] inline-flex items-center justify-center gap-2">
        {children}
      </span>
    </motion.button>
  );
}

/** Number that counts up to a real value once in view. */
export function CountUp({
  value,
  format = (n: number) => Math.round(n).toLocaleString(),
  duration = 1100,
  className = "",
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      setShown(value);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        setShown(value * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration, reduced]);

  return (
    <span ref={ref} className={className}>
      {format(shown)}
    </span>
  );
}

export { motion, useReducedMotion };

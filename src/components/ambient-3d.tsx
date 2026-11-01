import { useCapableDevice, usePointer } from "./motion";

type Orb = {
  size: number;
  top: string;
  left: string;
  depth: number;
  hue: string;
  delay: number;
};

const ORBS: Orb[] = [
  { size: 340, top: "-6%", left: "62%", depth: 26, hue: "oklch(0.66 0.225 302 / 0.30)", delay: 0 },
  { size: 210, top: "24%", left: "6%", depth: 16, hue: "oklch(0.79 0.145 320 / 0.24)", delay: 1.4 },
  { size: 150, top: "68%", left: "78%", depth: 34, hue: "oklch(0.7 0.18 268 / 0.22)", delay: 2.6 },
  {
    size: 110,
    top: "78%",
    left: "22%",
    depth: 12,
    hue: "oklch(0.79 0.145 320 / 0.18)",
    delay: 3.4,
  },
];

/**
 * GPU-only ambient depth layer: blurred glow spheres plus a wireframe
 * geometric shape, moved with mouse parallax. Renders a static, cheap
 * version on low-capability devices so nothing ever janks.
 */
export function Ambient3D({ intensity = 1 }: { intensity?: number }) {
  const capable = useCapableDevice();
  const p = usePointer(capable);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="starfield absolute inset-0 opacity-[0.35]" />
      {ORBS.map((o, i) => (
        <div
          key={i}
          className="absolute rounded-full will-change-transform"
          style={{
            width: o.size,
            height: o.size,
            top: o.top,
            left: o.left,
            background: `radial-gradient(circle at 32% 30%, ${o.hue}, transparent 68%)`,
            filter: `blur(${Math.round(o.size / 7)}px)`,
            transform: capable
              ? `translate3d(${(-p.x * o.depth * intensity).toFixed(2)}px, ${(-p.y * o.depth * intensity).toFixed(2)}px, 0)`
              : "translate3d(0,0,0)",
            transition: "transform 700ms cubic-bezier(0.16,1,0.3,1)",
            animation: capable
              ? `float ${8 + i * 1.7}s ease-in-out ${o.delay}s infinite`
              : undefined,
          }}
        />
      ))}

      {capable && (
        <div
          className="absolute right-[8%] top-[38%] size-40 will-change-transform"
          style={{
            perspective: 700,
            transform: `translate3d(${(-p.x * 40).toFixed(2)}px, ${(-p.y * 40).toFixed(2)}px, 0)`,
            transition: "transform 700ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div className="spin-slow size-full [transform-style:preserve-3d]">
            {[
              "rotateY(0deg) translateZ(80px)",
              "rotateY(90deg) translateZ(80px)",
              "rotateY(180deg) translateZ(80px)",
              "rotateY(270deg) translateZ(80px)",
              "rotateX(90deg) translateZ(80px)",
              "rotateX(-90deg) translateZ(80px)",
            ].map((t, i) => (
              <span
                key={i}
                className="absolute inset-0 rounded-2xl border border-lume/25"
                style={{ transform: t, background: "oklch(0.66 0.225 302 / 0.035)" }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

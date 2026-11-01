import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function Prism() {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock, pointer }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.getElapsedTime();
    m.rotation.y = t * 0.28 + pointer.x * 0.4;
    m.rotation.x = Math.sin(t * 0.4) * 0.16 + pointer.y * -0.25;
    m.position.y = Math.sin(t * 0.7) * 0.12;
  });
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.25, 0]} />
      <meshStandardMaterial
        color="#a855f7"
        roughness={0.18}
        metalness={0.65}
        emissive="#7c3aed"
        emissiveIntensity={0.35}
        flatShading
      />
    </mesh>
  );
}

function Ring({ radius, tilt, speed }: { radius: number; tilt: number; speed: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.getElapsedTime() * speed;
  });
  return (
    <mesh ref={ref} rotation={[tilt, 0.3, 0]}>
      <torusGeometry args={[radius, 0.012, 8, 128]} />
      <meshBasicMaterial color="#c4b5fd" transparent opacity={0.4} />
    </mesh>
  );
}

function Motes({ count = 90 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2.2 + Math.random() * 2.6;
      const a = Math.random() * Math.PI * 2;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 3.4;
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    return arr;
  }, [count]);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.06;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.035} color="#ddd6fe" transparent opacity={0.75} sizeAttenuation />
    </points>
  );
}

/** Lightweight WebGL hero scene: floating brand prism, orbit rings, drifting motes. */
export default function HeroScene() {
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ position: [0, 0, 5], fov: 45 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 4, 5]} intensity={2.1} color="#e9d5ff" />
      <pointLight position={[-4, -2, 2]} intensity={3} color="#c026d3" />
      <Prism />
      <Ring radius={2.05} tilt={1.35} speed={0.22} />
      <Ring radius={2.6} tilt={1.05} speed={-0.14} />
      <Motes />
    </Canvas>
  );
}

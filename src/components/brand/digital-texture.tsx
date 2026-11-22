import { cn } from "@/lib/utils";

/**
 * Trama digitale blu: onde luminose, tracce e particelle su fondo scuro. Decorativa (aria-hidden), puramente visiva.
 * `intensity`: low (dashboard/moduli), medium (Copilot), high (login). Le particelle sono deterministiche (nessun layout shift).
 */
const PARTICLES = Array.from({ length: 34 }, (_, i) => ({ x: (i * 97 + 31) % 1000, y: (i * 61 + 17) % 400, r: 0.8 + ((i * 7) % 5) * 0.35, d: (i % 9) * 0.55 }));

export function DigitalTexture({ intensity = "low", className }: { intensity?: "low" | "medium" | "high"; className?: string }) {
  const o = intensity === "high" ? 1 : intensity === "medium" ? 0.7 : 0.4;
  const dots = intensity === "high" ? PARTICLES : PARTICLES.slice(0, intensity === "medium" ? 20 : 10);
  return (
    <svg aria-hidden viewBox="0 0 1000 400" preserveAspectRatio="xMidYMid slice" className={cn("pointer-events-none absolute inset-0 size-full", className)} style={{ opacity: o }}>
      <defs>
        <linearGradient id="nx-wave" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#1747e8" stopOpacity="0" />
          <stop offset="0.45" stopColor="#2f6bff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#00a8ff" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="nx-wave2" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#00a8ff" stopOpacity="0" />
          <stop offset="0.6" stopColor="#00a8ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#1747e8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="nx-drift" fill="none" strokeLinecap="round">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M-40 ${250 - i * 14} C 180 ${110 + i * 12}, 360 ${380 - i * 22}, 560 ${230 - i * 8} S 880 ${70 + i * 18}, 1060 ${190 - i * 10}`} stroke="url(#nx-wave)" strokeWidth={i === 2 ? 1.6 : 0.8} opacity={0.35 + i * 0.1} />
        ))}
        {[0, 1, 2].map((i) => (
          <path key={`b${i}`} d={`M-40 ${300 - i * 20} C 220 ${330 - i * 30}, 420 ${150 + i * 25}, 640 ${260 - i * 12} S 900 ${330 - i * 15}, 1060 ${240 - i * 20}`} stroke="url(#nx-wave2)" strokeWidth="0.9" opacity="0.6" />
        ))}
      </g>
      <g fill="#7fc8ff">
        {dots.map((p, i) => <circle key={i} className="nx-twinkle" cx={p.x} cy={p.y} r={p.r} style={{ animationDelay: `${p.d}s` }} />)}
      </g>
    </svg>
  );
}

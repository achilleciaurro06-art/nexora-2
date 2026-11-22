import Image from "next/image";
import { cn } from "@/lib/utils";
import { SYMBOL_PATH, SYMBOL_VIEWBOX } from "./symbol-path";

/**
 * Identità NEXORA (approvata): un unico nastro continuo, triangolare e arrotondato, in argento satinato con riflessi bianchi
 * e faccia interna blu elettrico. I master PNG trasparenti stanno in `brand/`; per il web si usano le versioni WebP in
 * `public/brand/` (640 px per le dimensioni grandi, 192 px per le piccole). La sagoma vettoriale serve alle versioni
 * monocromatiche e alla favicon.
 */

// il simbolo occupa 141×122 unità nel riquadro del master (178×158): il box del componente coincide con il simbolo
const BOX_W = 141, BOX_H = 122, IMG_W = 178, IMG_H = 158;

type MarkProps = {
  /** altezza visiva del simbolo, in px */
  size?: number;
  /** «chrome» = render 3D; «mono» = sagoma piena (currentColor); «auto» = mono sotto i 22 px, dove il 3D non si legge */
  variant?: "auto" | "chrome" | "mono";
  /** fondo su cui poggia: scuro (alone blu) o chiaro (ombra neutra) */
  surface?: "dark" | "light";
  /** scia luminosa unica all'apertura (solo dove richiesto; rispetta prefers-reduced-motion) */
  sheen?: boolean;
  priority?: boolean;
  className?: string;
  title?: string;
};

export function LogoMark({ size = 28, variant = "auto", surface = "dark", sheen = false, priority = false, className, title }: MarkProps) {
  const mono = variant === "mono" || (variant === "auto" && size < 22);
  const w = Math.round((size * BOX_W) / BOX_H);
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };
  if (mono) {
    return (
      <svg width={w} height={size} viewBox={SYMBOL_VIEWBOX} fill="currentColor" fillRule="evenodd" className={cn("shrink-0", className)} {...a11y}>
        <path d={SYMBOL_PATH} />
      </svg>
    );
  }
  // risoluzione adatta alla dimensione di visualizzazione (retina inclusa)
  const px = size > 56 ? 640 : 192;
  const iw = Math.round((size * IMG_W) / BOX_H), ih = Math.round((size * IMG_H) / BOX_H);
  const src = `/brand/symbol-${surface}-${px}.webp`;
  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: w, height: size }} {...a11y}>
      <span className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2" style={{ width: iw, height: ih }}>
        <Image src={src} alt="" width={iw} height={ih} priority={priority} unoptimized draggable={false} className="block select-none" />
        {sheen && <span aria-hidden className="nx-sheen" style={{ WebkitMaskImage: `url(/brand/symbol-core-${px}.webp)`, maskImage: `url(/brand/symbol-core-${px}.webp)` }} />}
      </span>
    </span>
  );
}

/** Wordmark NEXORA: maiuscolo geometrico a tratto, con i dettagli su N, X e A. Altezza del riquadro in px. */
export function Wordmark({ height = 22, className }: { height?: number; className?: string }) {
  return (
    <svg viewBox="-6 -10 596 120" height={height} width={Math.round((height * 596) / 120)} fill="none" stroke="currentColor" strokeWidth={height < 26 ? 9.5 : 8} strokeMiterlimit={10} aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <clipPath id="nxwm-n"><path d="M-2 0H62L76 9V100H-2Z" /></clipPath>
        <clipPath id="nxwm-b"><rect x="-6" y="0" width="200" height="100" /></clipPath>
      </defs>
      <g clipPath="url(#nxwm-n)"><path d="M4 -2V102M4 -5L70 105M70 102V-2" /></g>
      <g transform="translate(100 0)" clipPath="url(#nxwm-b)"><path d="M4 -2V102M0 4H54M0 50H44M0 96H54" /></g>
      <g transform="translate(182 0)" clipPath="url(#nxwm-b)"><path d="M0 -4L76 104" /><path d="M76 -4L47.1 37" /><path d="M28.9 63L0 104" /></g>
      <g transform="translate(284 0)"><circle cx="50" cy="50" r="46" /></g>
      <g transform="translate(410 0)" clipPath="url(#nxwm-b)"><path d="M4 -2V102M0 4H36A22.5 22.5 0 0 1 36 49H4M30 49L60 104" /></g>
      <g transform="translate(500 0)" clipPath="url(#nxwm-b)"><path d="M0 104L41 -5L82 104" /><path d="M18 70H54" /></g>
    </svg>
  );
}

/** Lockup orizzontale: simbolo + wordmark. `size` = altezza visiva del simbolo. */
export function Logo({ size = 30, tone = "light", className, collapsed = false, sheen = false, priority = false }: { size?: number; tone?: "light" | "dark"; className?: string; collapsed?: boolean; sheen?: boolean; priority?: boolean }) {
  return (
    <span className={cn("inline-flex items-center", className)} style={{ gap: Math.round(size * 0.42) }}>
      <LogoMark size={size} surface={tone === "light" ? "dark" : "light"} sheen={sheen} priority={priority} />
      {!collapsed && (
        <>
          <Wordmark height={Math.round(size * 0.74)} className={tone === "light" ? "text-white" : "text-foreground"} />
          <span className="sr-only">NEXORA</span>
        </>
      )}
    </span>
  );
}

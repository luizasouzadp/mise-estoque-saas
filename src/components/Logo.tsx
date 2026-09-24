import { cn } from "@/lib/utils";

/**
 * Logotipo do Mise: cloche (cúpula de prato) com base dourada.
 * tone="light" para fundos claros, tone="dark" para fundos escuros ou azuis.
 */
export function LogoMark({ tone = "dark", size = 32, className }: { tone?: "light" | "dark"; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="12.5" r="3.4" className="fill-tape" />
      <path
        d="M9 45C9 28 19.5 18.5 32 18.5S55 28 55 45Z"
        className={tone === "light" ? "fill-primary" : "fill-white"}
      />
      <path
        d="M16.5 41C17.2 32.5 22 26.5 28.5 23.8"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        className={tone === "light" ? "stroke-white/50" : "stroke-[#274a78]/35"}
      />
      <rect x="5" y="48" width="54" height="3.6" rx="1.8" className="fill-tape" />
    </svg>
  );
}

export function Logo({
  tone = "dark",
  size = 32,
  className,
  nameClassName,
}: {
  tone?: "light" | "dark";
  size?: number;
  className?: string;
  nameClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark tone={tone} size={size} />
      <span className={cn("wordmark", nameClassName)} style={{ fontSize: size * 0.72 }}>
        Mise
      </span>
    </span>
  );
}

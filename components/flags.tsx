import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

// Inline SVG flags for the language selector (specs/i18n.md §4) — emoji
// flags render as letter pairs on Windows, so they can't be the only
// rendering. Shapes are simplified; no ids/defs so the same flag can render
// twice on a page (trigger + menu item).

// Pentagram polygon: the five outer vertices connected every-other; the
// default nonzero fill rule renders the classic five-pointed star.
function starPoints(cx: number, cy: number, r: number): string {
  return [0, 2, 4, 1, 3]
    .map((k) => {
      const a = ((-90 + 72 * k) * Math.PI) / 180;
      return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    })
    .join(" ");
}

function BrazilFlag() {
  return (
    <svg viewBox="0 0 30 20" aria-hidden="true" className="h-full w-full">
      <rect width="30" height="20" fill="#009b3a" />
      <path d="M15 2.5 27 10 15 17.5 3 10z" fill="#fedf00" />
      <circle cx="15" cy="10" r="5" fill="#002776" />
    </svg>
  );
}

function UKFlag() {
  return (
    <svg viewBox="0 0 30 20" aria-hidden="true" className="h-full w-full">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0l30 20m0-20L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0l30 20m0-20L0 20" stroke="#c8102e" strokeWidth="2" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6.5" />
      <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="4" />
    </svg>
  );
}

function ChinaFlag() {
  return (
    <svg viewBox="0 0 30 20" aria-hidden="true" className="h-full w-full">
      <rect width="30" height="20" fill="#ee1c25" />
      <g fill="#ffff00">
        <polygon points={starPoints(5, 5, 3)} />
        <polygon points={starPoints(10, 2, 1)} />
        <polygon points={starPoints(12, 4.5, 1)} />
        <polygon points={starPoints(12, 7.5, 1)} />
        <polygon points={starPoints(10, 10, 1)} />
      </g>
    </svg>
  );
}

function BosniaFlag() {
  return (
    <svg viewBox="0 0 30 20" aria-hidden="true" className="h-full w-full">
      <rect width="30" height="20" fill="#001489" />
      <path d="M11 0h15v15z" fill="#ffcd00" />
      <g fill="#fff">
        {Array.from({ length: 7 }, (_, k) => (
          <polygon
            key={k}
            points={starPoints(9 + 2.6 * k, 1.4 + 2.6 * k, 1.3)}
          />
        ))}
      </g>
    </svg>
  );
}

const FLAGS: Record<Locale, () => React.JSX.Element> = {
  "pt-BR": BrazilFlag,
  en: UKFlag,
  "zh-CN": ChinaFlag,
  bs: BosniaFlag,
};

export function Flag({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  const FlagSvg = FLAGS[locale];
  return (
    <span
      className={cn(
        "inline-flex h-3 w-[18px] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-foreground/10",
        className
      )}
    >
      <FlagSvg />
    </span>
  );
}

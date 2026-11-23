import { fmtNum } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

/** Characters used of a field's `maxLength`: a ring that fills as you type (amber from 90%, red at the limit) and n/max. */
export function CharCount({ n, max, className }: { n: number; max: number; className?: string }) {
  const r = Math.min(1, n / max);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs tabular-nums transition-colors duration-(--dur-short)", n >= max ? "text-error" : r >= 0.9 ? "text-warn" : "text-ink-3", className)}>
      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth="2" />
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" pathLength={100}
          strokeDasharray="100" strokeDashoffset={100 - r * 100} className={cn("transition-[stroke-dashoffset] duration-(--dur-short) ease-(--ease-out)", !n && "opacity-0")} />
      </svg>
      {fmtNum(n)}/{fmtNum(max)}
    </span>
  );
}

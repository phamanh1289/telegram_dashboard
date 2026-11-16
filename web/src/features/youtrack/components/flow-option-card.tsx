"use client";

import { type LucideIcon, Star } from "lucide-react";
import { Hint } from "@/shared/components/ui/hint";
import { cn } from "@/shared/lib/utils";

/** One way to do a thing: a radio card. The tooltip says when to use it and what it costs (its trade-off); `badge`
 *  (the suggested one) is a star on the card, its word in the tooltip title. */
export function OptionCard<V extends string>({ value, picked, disabled, badge, icon: Icon, title, when, cost, tip, onPick }: {
  value: V; picked: V; disabled?: boolean; badge?: string; icon: LucideIcon; title: string; when: string; cost: string; tip: string; onPick: (v: V) => void;
}) {
  const on = picked === value;
  return (
    <Hint side="bottom" title={badge ? `${title} · ${badge}` : title} text={tip}>
      <button type="button" role="radio" aria-checked={on} aria-disabled={disabled || undefined}
        onClick={() => { if (!disabled) onPick(value); }}
        className={cn("relative flex min-h-full flex-col gap-1.5 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] duration-(--dur-short)",
          on ? "border-hl bg-hl-wash shadow-stock" : "border-rule bg-cotton hover:border-ink-3", disabled && "cursor-not-allowed opacity-50")}>
        {badge && <span role="img" aria-label={badge} className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-hl text-hl-ink"><Star className="size-3 fill-current" aria-hidden /></span>}
        <span className={cn("flex items-center gap-1.5 text-sm font-bold text-ink", badge && "pr-6")}><Icon className="size-3.5 shrink-0" aria-hidden />{title}</span>
        <span className="text-xs text-ink-2">{when}</span>
        <span className="mt-auto pt-1 font-mono text-2xs text-ink-3">{cost}</span>
      </button>
    </Hint>
  );
}

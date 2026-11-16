"use client";

import type { LucideIcon } from "lucide-react";
import { Hint } from "@/shared/components/ui/hint";
import { cn } from "@/shared/lib/utils";

/** One way to do a thing: a radio card. The tooltip says when to use it and what it costs (its trade-off). */
export function OptionCard<V extends string>({ value, picked, disabled, badge, icon: Icon, title, when, cost, tip, onPick }: {
  value: V; picked: V; disabled?: boolean; badge?: string; icon: LucideIcon; title: string; when: string; cost: string; tip: string; onPick: (v: V) => void;
}) {
  const on = picked === value;
  return (
    <Hint side="bottom" title={title} text={tip}>
      <button type="button" role="radio" aria-checked={on} aria-disabled={disabled || undefined}
        onClick={() => { if (!disabled) onPick(value); }}
        className={cn("relative flex min-h-full flex-col gap-1.5 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] duration-(--dur-short)",
          on ? "border-hl bg-hl-wash shadow-stock" : "border-rule bg-cotton hover:border-ink-3", disabled && "cursor-not-allowed opacity-50")}>
        {badge && <span className="absolute top-2.5 right-2.5 rounded-full bg-hl px-2 py-px text-2xs font-bold text-hl-ink">{badge}</span>}
        <span className="flex items-center gap-1.5 pr-14 text-sm font-bold text-ink"><Icon className="size-3.5 shrink-0" aria-hidden />{title}</span>
        <span className="text-xs text-ink-2">{when}</span>
        <span className="mt-auto pt-1 font-mono text-2xs text-ink-3">{cost}</span>
      </button>
    </Hint>
  );
}

"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Hint } from "@/shared/components/ui/hint";
import { cn } from "@/shared/lib/utils";

/** The one sliding-highlight animation: every tab group, filter toggle and nav uses it, so change it here only. */
export const PILL_SPRING = { type: "spring", stiffness: 500, damping: 38 } as const;

/**
 * Sliding highlight behind the active item. `id` is unique per group (items of one group share it, so it slides between them).
 * `className` replaces the default look (filled pill), e.g. a nav's wash or a tab's underline; the motion stays the same.
 */
export function Pill({ id, className }: { id: string; className?: string }) {
  return <motion.span aria-hidden layoutId={id} className={cn("absolute", className ?? "inset-0 rounded-[5px] bg-hl")} transition={PILL_SPRING} />;
}

/** `title`: what the option does, shown as a Hint on hover / focus. */
export type SegmentedItem<T> = { value: T; label: ReactNode; title?: string };

/** One-of-many toggle (view, filter, period): the active one gets the sliding Pill. Toggle buttons (aria-pressed), not
 *  tabs: most groups filter a list in place, with no tab panel. `variant="card"`: full width, equal segments, a raised
 *  cotton pill (settings forms). */
export function Segmented<T extends string | number>({ id, label, value, onChange, items, className, variant = "fill" }: {
  id: string; label: string; value: T | null; onChange: (v: T) => void; items: SegmentedItem<T>[]; className?: string; variant?: "fill" | "card";
}) {
  const card = variant === "card";
  return (
    <div role="group" aria-label={label} className={cn("flex shrink-0 rounded-md bg-paper-2 p-0.5 text-xs shadow-groove", card && "grid w-full auto-cols-fr grid-flow-col", className)}>
      {items.map((it) => {
        const on = it.value === value;
        const b = (
          <button key={it.value} type="button" aria-pressed={on} onClick={() => onChange(it.value)}
            className={cn("relative h-[26px] whitespace-nowrap rounded-[5px] px-3 transition-colors duration-(--dur-micro)", card && "flex h-7 items-center justify-center gap-1.5 px-2",
              on ? cn("font-medium", card ? "text-ink" : "text-hl-ink") : "text-ink-3 hover:text-ink")}>
            {on && <Pill id={id} className={card ? "inset-0 rounded-[5px] bg-cotton shadow-stock" : undefined} />}
            <span className={cn("relative", card && "flex items-center gap-1.5")}>{it.label}</span>
          </button>
        );
        return it.title ? <Hint key={it.value} side="bottom" text={it.title}>{b}</Hint> : b;
      })}
    </div>
  );
}

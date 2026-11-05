"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The one sliding-highlight animation: every tab group, filter toggle and nav uses it, so change it here only. */
export const PILL_SPRING = { type: "spring", stiffness: 500, damping: 38 } as const;

/**
 * Sliding highlight behind the active item. `id` is unique per group (items of one group share it, so it slides between them).
 * `className` replaces the default look (filled pill), e.g. a nav's wash or a tab's underline; the motion stays the same.
 */
export function Pill({ id, className }: { id: string; className?: string }) {
  return <motion.span aria-hidden layoutId={id} className={cn("absolute", className ?? "inset-0 rounded-[5px] bg-hl")} transition={PILL_SPRING} />;
}

export type SegmentedItem<T> = { value: T; label: ReactNode; title?: string };

/** One-of-many tabs (view, filter, period): the active one gets the sliding Pill. */
export function Segmented<T extends string | number>({ id, label, value, onChange, items, className }: {
  id: string; label: string; value: T | null; onChange: (v: T) => void; items: SegmentedItem<T>[]; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex shrink-0 rounded-md bg-paper-2 p-0.5 text-xs shadow-groove", className)}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button key={it.value} type="button" role="tab" aria-selected={on} title={it.title} onClick={() => onChange(it.value)}
            className={cn("relative h-[26px] whitespace-nowrap rounded-[5px] px-3 transition-colors duration-(--dur-micro)", on ? "font-medium text-hl-ink" : "text-ink-3 hover:text-ink")}>
            {on && <Pill id={id} />}
            <span className="relative">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

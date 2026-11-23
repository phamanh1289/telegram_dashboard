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

const GROOVE = "rounded-md bg-paper-2 p-0.5 shadow-groove";
const BOX = { fill: cn("flex", GROOVE), card: "flex flex-wrap gap-1.5", bar: cn("grid w-full auto-cols-fr grid-flow-col", GROOVE) } as const;
const ITEM = {
  fill: (on: boolean) => cn("h-[26px] rounded-[5px] px-3", on ? "font-medium text-hl-ink" : "text-ink-3 hover:text-ink"),
  bar: (on: boolean) => cn("flex h-7 items-center justify-center gap-1.5 rounded-[5px] px-2", on ? "font-medium text-hl-ink" : "text-ink-3 hover:text-ink"),
  card: (on: boolean) => cn("flex h-8 items-center gap-1.5 rounded-full border px-3",
    on ? "border-transparent font-medium text-hl-ink" : "border-rule text-ink-2 hover:border-rule-2 hover:bg-paper-2 hover:text-ink"),
} as const;

/** `title`: what the option does, shown as a Hint on hover / focus. */
export type SegmentedItem<T> = { value: T; label: ReactNode; title?: string };

/** One-of-many toggle (view, filter, period): the active one gets the sliding Pill. Toggle buttons (aria-pressed), not
 *  tabs: most groups filter a list in place, with no tab panel. `variant="card"`: separate chips as wide as their
 *  content, wrapping when the row is full (settings forms; label = icon + text); `"bar"`: joined segments stretched full
 *  width (a narrow screen's pane switcher). Same sliding highlight everywhere, so the slide reads in both themes. */
export function Segmented<T extends string | number>({ id, label, value, onChange, items, className, variant = "fill" }: {
  id: string; label: string; value: T | null; onChange: (v: T) => void; items: SegmentedItem<T>[]; className?: string; variant?: "fill" | "card" | "bar";
}) {
  return (
    <div role="group" aria-label={label} className={cn("shrink-0 text-xs", BOX[variant], className)}>
      {items.map((it) => {
        const on = it.value === value;
        const b = (
          <button key={it.value} type="button" aria-pressed={on} onClick={() => onChange(it.value)}
            className={cn("relative whitespace-nowrap transition-colors duration-(--dur-micro)", ITEM[variant](on))}>
            {on && <Pill id={id} className={variant === "card" ? "-inset-px rounded-full bg-hl" : undefined} />}
            <span className={cn("relative", variant !== "fill" && "flex items-center gap-1.5")}>{it.label}</span>
          </button>
        );
        return it.title ? <Hint key={it.value} side="bottom" text={it.title}>{b}</Hint> : b;
      })}
    </div>
  );
}

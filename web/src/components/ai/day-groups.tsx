"use client";

import { ChevronRight, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { type Key, useT } from "@/lib/i18n";
import { smooth } from "@/lib/inbox";
import { cn } from "@/lib/utils";

/** Rail heading of a time: today, yesterday, this week, older. */
export function dayOf(at: number): Key {
  const d = Math.floor((new Date().setHours(24, 0, 0, 0) - at) / 86_400_000);
  return d < 1 ? "Hôm nay" : d < 2 ? "Hôm qua" : d < 7 ? "7 ngày qua" : "Cũ hơn";
}

/**
 * Fold state of a list grouped by time (sticky day bars): every group folded but those `dflt` opens (today, else the
 * nearest day that has items); a click overrides it for this visit. Returns `[isOpen, toggle]`.
 */
export function useDayFold(dflt: (key: string) => boolean) {
  const [set, setSet] = useState<Record<string, boolean>>({});
  return [
    (k: string) => set[k] ?? dflt(k),
    (k: string) => setSet((s) => ({ ...s, [k]: !(s[k] ?? dflt(k)) })),
  ] as const;
}

/** Inset for a full-width section's rows under its `GroupBar`, so parent and child read apart. */
export const GROUP_NEST = "ml-6 @xl:ml-8";

/**
 * A list's sticky section bar: a solid header chip (chevron, icon, label, count badge, note, `actions`) on a blurred band
 * of the list's ground (`className`: that ground, e.g. `bg-cotton`, plus any side padding); rows scroll beneath.
 * `onToggle`: click folds / unfolds (`open`, chevron); `late`: the urgent bar (signal colours); `tone`: the icon's colour;
 * `actions`: extra buttons at the end (hover shows them via `group/day`); `id`: for the section's aria-labelledby.
 */
export function GroupBar({ id, label, icon, count, note, open, onToggle, late, tone, actions, className }: {
  id?: string; label: ReactNode; icon?: ReactNode; count: number; note?: ReactNode; open?: boolean; onToggle?: () => void; late?: boolean;
  tone?: string; actions?: ReactNode; className?: string;
}) {
  const body = <>
    {onToggle && <ChevronRight className={cn("size-4 shrink-0 transition-transform duration-(--dur-short)", late ? "text-signal-2" : "text-ink-2", open && "rotate-90")} aria-hidden />}
    {icon && <span className={cn("grid shrink-0 place-items-center [&_svg]:size-4", late ? "text-signal-2" : tone ?? "text-ink-2")}>{icon}</span>}
    <span id={id} className={cn("min-w-0 truncate text-sm font-bold", late ? "text-signal-2" : "text-ink")}>{label}</span>
    <span className={cn("shrink-0 rounded-full px-1.5 font-mono text-2xs font-medium leading-5 tabular-nums",
      late ? "bg-signal text-signal-ink" : "bg-cotton text-ink-2 ring-1 ring-rule ring-inset")}>{count}</span>
    {note && <span className="min-w-0 truncate text-xs text-ink-3">{note}</span>}
  </>;
  const cls = "flex h-8 min-w-0 flex-1 items-center gap-2 pl-2.5 text-left";
  return (
    <div className={cn("group/day sticky top-0 z-10 py-1.5 backdrop-blur-md", className)}>
      <div className={cn("flex items-center gap-1 rounded-lg pr-1 shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-inset transition-colors duration-(--dur-micro)",
        late ? "bg-signal-wash ring-signal/30" : "bg-paper-2 ring-rule", onToggle && (late ? "hover:bg-signal-wash/80" : "hover:bg-paper-3"))}>
        {onToggle ? (
          <button type="button" aria-expanded={open} onClick={onToggle} className={cn(cls, "rounded-lg focus-visible:outline-2 focus-visible:outline-hl")}>{body}</button>
        ) : <div className={cls}>{body}</div>}
        {actions}
      </div>
    </div>
  );
}

/**
 * A row of a session rail (AI Agent, Q&A): the `<li>` card on the guide line, its main button (`RAIL_BTN` + the
 * caller's grid) and a right column (`RAIL_SIDE`) of row actions. `on`: the open / picked row; `late`: the urgent tint.
 */
export const railRow = (on: boolean, late?: boolean) =>
  cn("group/row relative flex rounded-lg transition-[background-color,box-shadow] duration-(--dur-micro)",
    on ? "bg-hl-wash shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-hl)_35%,transparent)]" : late ? "bg-signal-wash/60 hover:bg-signal-wash" : "hover:bg-paper-2");
export const RAIL_BTN = "min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left";
export const RAIL_SIDE = "flex shrink-0 flex-col items-center justify-center gap-1 pr-1";
/** Shown on the row's / bar's hover or focus, always on touch screens. */
const REVEAL = "opacity-0 transition-opacity duration-(--dur-micro) hover:bg-error-wash hover:text-error focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

/** A rail row's trash (in its `RAIL_SIDE`). */
export function RowTrash({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <Hint side="bottom" text={hint}>
      <Button size="icon-xs" variant="ghost" aria-label={label} onClick={onClick} className={cn("text-ink-3 group-hover/row:opacity-100", REVEAL)}><Trash2 /></Button>
    </Hint>
  );
}

/** Delete a bar's rows (`GroupBar` actions). `ask`: a second click confirms, showing this (removals an undo toast brings
 *  back); without it one click calls `onRemove`, which asks in a dialog. */
export function DayTrash({ label, hint, ask, onRemove }: { label: string; hint?: string; ask?: string; onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  const btn = (
    <Button size={sure ? "xs" : "icon-xs"} variant={sure ? "destructive" : "ghost"} aria-label={label} onBlur={() => setSure(false)}
      onClick={() => { if (ask && !sure) return setSure(true); setSure(false); onRemove(); }}
      className={cn(!sure && cn("text-ink-3 group-hover/day:opacity-100", REVEAL))}>
      <Trash2 />{sure && ask}
    </Button>
  );
  return hint ? <Hint side="bottom" text={hint}>{btn}</Hint> : btn;
}

/** One section of a rail: a sticky `GroupBar` and its rows (`<li>`s) on a guide line; `onToggle` folds it (animated). */
export function RailSection({ name, label, icon, count, open = true, onToggle, late, actions, children }: {
  name: string; label: ReactNode; icon?: ReactNode; count: number; open?: boolean; onToggle?: () => void; late?: boolean;
  actions?: ReactNode; children: ReactNode;
}) {
  const calm = useReducedMotion();
  return (
    <section aria-label={name}>
      <GroupBar className="bg-cotton/85 px-2" label={label} icon={icon} count={count} late={late} open={open} onToggle={onToggle} actions={actions} />
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: calm ? 0 : 0.2, ease: [0.2, 0, 0, 1] }} className="zebra ml-3 grid grid-cols-1 gap-0.5 overflow-hidden border-l border-rule pl-1.5">
            {children}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Bring a rail row opened from elsewhere into view (its day already unfolded) and flash it once. */
export function revealRow(el: HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    el?.scrollIntoView({ block: "center", behavior: smooth() });
    el?.animate([{ boxShadow: "inset 0 0 0 2px var(--color-hl)" }, { boxShadow: "inset 0 0 0 0 transparent" }], { duration: 1800, easing: "ease-out" });
  });
}

/** Newest day of a rail (`dayOf`), the one `DayGroups` opens first. */
export const newestDay = <T,>(items: T[], at: (x: T) => number) => (items.length ? dayOf(Math.max(...items.map(at))) : undefined);

/**
 * A session rail by day, newest first (`at`: the session's last activity): a `RailSection` per day (click: fold / unfold;
 * only the newest day starts open, `useDayFold`; `fold`: the caller's, when it needs to know, e.g. j / k).
 * Goes inside the rail's scroll box on `bg-cotton`. `open`: every day unfolded (a search); `actions`: extra buttons on a day's bar;
 * `focus`: a row opened from elsewhere, its day starts open too (the row scrolls itself in: `revealRow`).
 */
export function DayGroups<T>({ items, at, open, actions, row, fold, focus }: {
  items: T[]; at: (x: T) => number; open?: boolean; focus?: T;
  actions?: (day: Key, items: T[]) => ReactNode;
  row: (x: T) => ReactNode;
  fold?: ReturnType<typeof useDayFold>;
}) {
  const t = useT();
  const groups: [Key, T[]][] = [];
  for (const x of [...items].sort((a, b) => at(b) - at(a))) {
    const d = dayOf(at(x)), last = groups.at(-1);
    if (last?.[0] === d) last[1].push(x); else groups.push([d, [x]]);
  }
  const own = useDayFold((d) => d === groups[0]?.[0] || (focus !== undefined && d === dayOf(at(focus)))); // newest first: today, else the nearest day
  const [isOpen, toggle] = fold ?? own;
  return groups.map(([day, xs]) => (
    <RailSection key={day} name={t(day)} label={t(day)} count={xs.length} open={open || isOpen(day)} onToggle={() => toggle(day)} actions={actions?.(day, xs)}>
      {xs.map(row)}
    </RailSection>
  ));
}

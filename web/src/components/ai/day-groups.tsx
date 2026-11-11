"use client";

import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";
import { type Key, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Rail heading of a time: today, yesterday, this week, older. */
export function dayOf(at: number): Key {
  const d = Math.floor((new Date().setHours(24, 0, 0, 0) - at) / 86_400_000);
  return d < 1 ? "Hôm nay" : d < 2 ? "Hôm qua" : d < 7 ? "7 ngày qua" : "Cũ hơn";
}

/**
 * A rail's sticky section bar: a rounded chip with a colour edge and a count, inset on the rail's ground (`className`:
 * that ground, e.g. `bg-cotton`) so it never reads as one of the rows under it. `onToggle`: click folds / unfolds
 * (`open`); `late`: the "nobody answered" bar (signal colours); `actions`: extra buttons (hover shows them via `group/day`).
 */
export function GroupBar({ label, icon, count, open, onToggle, late, actions, className }: {
  label: ReactNode; icon?: ReactNode; count: number; open?: boolean; onToggle?: () => void; late?: boolean;
  actions?: ReactNode; className?: string;
}) {
  const body = <>
    {onToggle && <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-(--dur-short)", open && "rotate-90")} aria-hidden />}
    {icon}
    <span className="min-w-0 truncate">{label}</span>
    <span className="ml-auto shrink-0 rounded-full bg-cotton px-1.5 font-mono text-2xs font-medium text-ink-3 tabular-nums">{count}</span>
  </>;
  const cls = "flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-xs font-bold [&_svg]:size-3.5 [&_svg]:shrink-0";
  return (
    <div className={cn("group/day sticky top-0 z-10 pt-1.5 pb-1", className)}>
      <div className={cn("flex items-center gap-1 rounded-md bg-paper-3 pr-1",
        late ? "text-signal-2 shadow-[inset_2px_0_0_var(--color-signal)]" : "text-ink-2 shadow-[inset_2px_0_0_var(--color-hl)]")}>
        {onToggle ? (
          <button type="button" aria-expanded={open} onClick={onToggle} className={cn(cls, "transition-colors duration-(--dur-micro) hover:text-ink")}>{body}</button>
        ) : <div className={cls}>{body}</div>}
        {actions}
      </div>
    </div>
  );
}

/**
 * A session rail by day, newest first (`at`: the session's last activity): a sticky `GroupBar` per day (click: fold / unfold,
 * animated), its rows (`row` returns the `<li>`) under it on a guide line. Goes inside the rail's scroll box on
 * `bg-cotton`. `open`: every day unfolded (a search); `actions`: extra buttons on a day's bar.
 */
export function DayGroups<T>({ items, at, open, actions, row }: {
  items: T[]; at: (x: T) => number; open?: boolean;
  actions?: (day: Key, items: T[]) => ReactNode;
  row: (x: T) => ReactNode;
}) {
  const t = useT();
  const calm = useReducedMotion();
  const [shut, setShut] = useState<Key[]>([]);
  const groups: [Key, T[]][] = [];
  for (const x of [...items].sort((a, b) => at(b) - at(a))) {
    const d = dayOf(at(x)), last = groups.at(-1);
    if (last?.[0] === d) last[1].push(x); else groups.push([d, [x]]);
  }
  return groups.map(([day, xs]) => {
    const off = !open && shut.includes(day);
    return (
      <section key={day} aria-label={t(day)}>
        <GroupBar className="bg-cotton" label={t(day)} count={xs.length} open={!off} actions={actions?.(day, xs)}
          onToggle={() => setShut((s) => (off ? s.filter((d) => d !== day) : [...s, day]))} />
        <AnimatePresence initial={false}>
          {!off && (
            <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: calm ? 0 : 0.2, ease: [0.2, 0, 0, 1] }} className="ml-3 grid gap-0.5 overflow-hidden border-l border-rule pl-1.5">
              {xs.map(row)}
            </motion.ul>
          )}
        </AnimatePresence>
      </section>
    );
  });
}

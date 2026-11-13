"use client";

import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { type Key, t, useT } from "@/lib/i18n";
import { dm, ymd } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Inclusive day range as local "YYYY-MM-DD" strings; empty = open end. */
export type DayRange = { from: string; to: string };

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};

/** API query string for a day range: since = start of `from`, until = start of the day after `to`. */
export function rangeQuery({ from, to }: DayRange) {
  const p = new URLSearchParams();
  if (from) p.set("since", new Date(`${from}T00:00:00`).toISOString());
  if (to) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    p.set("until", end.toISOString());
  }
  return p.toString();
}

/** Default range of the tag lists: the last 7 days, open-ended so tags arriving after midnight still show. */
export const lastWeek = (): DayRange => ({ from: daysAgo(6), to: "" });

function presets(): { label: Key; range: DayRange }[] {
  const today = ymd();
  const first = new Date();
  first.setDate(1);
  return [
    { label: "Hôm nay", range: { from: today, to: today } },
    { label: "Hôm qua", range: { from: daysAgo(1), to: daysAgo(1) } },
    { label: "7 ngày qua", range: lastWeek() },
    { label: "30 ngày qua", range: { from: daysAgo(29), to: "" } },
    { label: "Tháng này", range: { from: ymd(first), to: "" } },
    { label: "Tất cả", range: { from: "", to: "" } },
  ];
}

/** Rendered label (plain `t`: callers render it from a component that re-renders on a language change). */
export function rangeLabel({ from, to }: DayRange) {
  if (!from && !to) return t("Tất cả thời gian");
  const p = presets().find((x) => x.range.from === from && x.range.to === to);
  if (p) return t(p.label);
  if (from && from === to) return from === ymd() ? t("Hôm nay") : dm(from);
  if (from && !to) return t("Từ {d}", { d: dm(from) });
  if (!from && to) return t("Đến {d}", { d: dm(to) });
  return `${dm(from)} – ${dm(to)}`;
}

export function DateRangePicker({ value, onChange, emptyLabel }: { value: DayRange; onChange: (r: DayRange) => void; emptyLabel?: string }) {
  const tt = useT();
  const [open, setOpen] = useState(false);
  const active = !!(value.from || value.to);
  const label = !active && emptyLabel ? emptyLabel : rangeLabel(value);
  const today = ymd();

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Hover lives on the button, not the pill: the pill only carries the active fill. */}
      <div className={cn("flex h-9 items-center rounded-md text-sm", active ? "bg-ink-2 text-paper" : "text-ink-2")}>
        <Hint side="bottom" text={tt("Chọn khoảng ngày của tin tag")}>
          <Popover.Trigger aria-label={tt("Khoảng ngày: {label}", { label })}
            className={cn("flex h-full items-center gap-1.5 rounded-md px-2.5 transition-[background-color,color] duration-(--dur-micro)", !active && "hover:bg-paper-3 hover:text-ink data-popup-open:bg-paper-3 data-popup-open:text-ink")}>
            <CalendarDays className="size-4 shrink-0" aria-hidden />
            <span className={cn("whitespace-nowrap", !active && "hidden lg:inline", active && "font-medium")}>{label}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-(--dur-short)", open && "rotate-180")} aria-hidden />
          </Popover.Trigger>
        </Hint>
        {active && (
          <button type="button" aria-label={tt("Bỏ lọc ngày")} className="grid h-full place-items-center rounded-r-md border-l border-paper/25 px-2 opacity-80 hover:opacity-100"
            onClick={() => onChange({ from: "", to: "" })}>
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-40 outline-none">
          <Popover.Popup aria-label={tt("Chọn khoảng ngày")}
            className="grid w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) gap-3 rounded-lg bg-cotton p-3 text-sm shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={tt("Khoảng có sẵn")}>
              {presets().map((p) => {
                const on = p.range.from === value.from && p.range.to === value.to;
                return (
                  <button key={p.label} type="button" aria-pressed={on}
                    className={cn("h-7 whitespace-nowrap rounded-md border px-2 text-xs transition-[background-color,border-color,color] duration-(--dur-micro)", on ? "border-hl bg-hl font-medium text-hl-ink" : "border-rule text-ink-2 hover:border-rule-2 hover:bg-paper-2 hover:text-ink")}
                    onClick={() => {
                      onChange(p.range);
                      setOpen(false);
                    }}>
                    {tt(p.label)}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-rule pt-3">
              {(["from", "to"] as const).map((k) => (
                <label key={k} className="grid gap-1 text-xs font-medium text-ink-3">
                  {k === "from" ? tt("Từ ngày") : tt("Đến ngày")}
                  <input
                    type="date"
                    value={value[k]}
                    max={k === "from" ? value.to || today : today}
                    min={k === "to" ? value.from || undefined : undefined}
                    onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                    onClick={(e) => {
                      try { e.currentTarget.showPicker(); } catch {}
                    }}
                    className="h-9 rounded-md border border-rule-2 bg-cotton px-2 font-mono text-sm font-normal text-ink hover:border-ink-3 focus-visible:-outline-offset-1"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Popover.Close render={<Button size="sm" />}>{tt("Xong")}</Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

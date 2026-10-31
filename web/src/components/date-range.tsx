"use client";

import { CalendarDays, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Inclusive day range as local "YYYY-MM-DD" strings; empty = open end. */
export type DayRange = { from: string; to: string };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};
const dm = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
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

function presets() {
  const today = ymd(new Date());
  const first = new Date();
  first.setDate(1);
  return [
    { label: "Hôm nay", range: { from: today, to: today } },
    { label: "Hôm qua", range: { from: daysAgo(1), to: daysAgo(1) } },
    { label: "7 ngày qua", range: { from: daysAgo(6), to: today } },
    { label: "30 ngày qua", range: { from: daysAgo(29), to: today } },
    { label: "Tháng này", range: { from: ymd(first), to: today } },
    { label: "Tất cả", range: { from: "", to: "" } },
  ];
}

export function rangeLabel({ from, to }: DayRange) {
  if (!from && !to) return "Tất cả thời gian";
  if (from && from === to) return from === ymd(new Date()) ? "Hôm nay" : dm(from);
  if (from && !to) return `Từ ${dm(from)}`;
  if (!from && to) return `Đến ${dm(to)}`;
  return `${dm(from)} – ${dm(to)}`;
}

export function DateRangePicker({ value, onChange, emptyLabel }: { value: DayRange; onChange: (r: DayRange) => void; emptyLabel?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const active = !!(value.from || value.to);
  const label = !active && emptyLabel ? emptyLabel : rangeLabel(value);
  const today = ymd(new Date());

  return (
    <div ref={box} className="relative">
      <div className={cn("flex h-9 items-center rounded-md text-[0.8125rem] transition-[background-color,color] duration-(--dur-micro)", active ? "bg-ink-2 text-paper" : "text-ink-2 hover:bg-paper-3 hover:text-ink")}>
        <button type="button" className="flex h-full items-center gap-1.5 rounded-md px-2.5" aria-expanded={open} aria-haspopup="dialog"
          aria-label={`Khoảng ngày: ${label}`}
          onClick={() => setOpen((v) => !v)} title="Chọn khoảng ngày của tin tag">
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          <span className={cn("whitespace-nowrap", !active && "hidden md:inline", active && "font-medium")}>{label}</span>
          <ChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-(--dur-short)", open && "rotate-180")} aria-hidden />
        </button>
        {active && (
          <button type="button" aria-label="Bỏ lọc ngày" title="Bỏ lọc ngày" className="grid h-full place-items-center rounded-r-md border-l border-paper/25 px-2 opacity-80 hover:opacity-100"
            onClick={() => onChange({ from: "", to: "" })}>
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <div role="dialog" aria-label="Chọn khoảng ngày"
          className="absolute right-0 top-11 z-40 grid w-80 gap-3 rounded-lg bg-cotton p-3 text-sm shadow-pop animate-in fade-in-0 zoom-in-[0.98] duration-(--dur-short)">
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Khoảng có sẵn">
            {presets().map((p) => {
              const on = p.range.from === value.from && p.range.to === value.to;
              return (
                <button key={p.label} type="button" aria-pressed={on}
                  className={cn("h-7 whitespace-nowrap rounded-md border px-2 text-xs transition-[background-color,border-color,color] duration-(--dur-micro)", on ? "border-hl bg-hl font-medium text-hl-ink" : "border-rule text-ink-2 hover:border-rule-2 hover:bg-paper-2 hover:text-ink")}
                  onClick={() => {
                    onChange(p.range);
                    setOpen(false);
                  }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-rule pt-3">
            {(["from", "to"] as const).map((k) => (
              <label key={k} className="grid gap-1 text-xs font-medium text-ink-3">
                {k === "from" ? "Từ ngày" : "Đến ngày"}
                <input
                  type="date"
                  value={value[k]}
                  max={k === "from" ? value.to || today : today}
                  min={k === "to" ? value.from || undefined : undefined}
                  onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                  onClick={(e) => {
                    try { e.currentTarget.showPicker(); } catch {}
                  }}
                  className="h-9 rounded-md border border-rule-2 bg-cotton px-2 font-mono text-[0.8125rem] font-normal text-ink hover:border-ink-3 focus-visible:-outline-offset-1"
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setOpen(false)}>Xong</Button>
          </div>
        </div>
      )}
    </div>
  );
}

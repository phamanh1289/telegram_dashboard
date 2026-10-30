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

export function DateRangePicker({ value, onChange }: { value: DayRange; onChange: (r: DayRange) => void }) {
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
  const today = ymd(new Date());

  return (
    <div ref={box} className="relative">
      <div className={cn("flex h-8 items-center rounded-md border text-xs transition-colors", active ? "border-primary/50 bg-primary/10 text-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>
        <button type="button" className="flex h-full items-center gap-1.5 px-2.5" aria-expanded={open} aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)} title="Chọn khoảng ngày của tin tag">
          <CalendarDays className="size-3.5" />
          <span className="font-medium">{rangeLabel(value)}</span>
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
        {active && (
          <button type="button" aria-label="Bỏ lọc ngày" title="Bỏ lọc ngày" className="grid h-full place-items-center border-l px-1.5 hover:text-destructive"
            onClick={() => onChange({ from: "", to: "" })}>
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div role="dialog" aria-label="Chọn khoảng ngày"
          className="absolute right-0 top-10 z-40 grid w-80 gap-3 rounded-xl border bg-popover p-3 text-sm shadow-xl animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="grid grid-cols-3 gap-1.5">
            {presets().map((p) => {
              const on = p.range.from === value.from && p.range.to === value.to;
              return (
                <button key={p.label} type="button"
                  className={cn("whitespace-nowrap rounded-md border px-2 py-1.5 text-xs transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                  onClick={() => {
                    onChange(p.range);
                    setOpen(false);
                  }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t pt-3">
            {(["from", "to"] as const).map((k) => (
              <label key={k} className="grid gap-1 text-xs text-muted-foreground">
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
                  className="h-8 rounded-md border bg-background px-2 text-foreground [color-scheme:light] dark:[color-scheme:dark]"
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="xs" onClick={() => setOpen(false)}>Xong</Button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { motion } from "motion/react";
import { fmtDay } from "@/shared/lib/i18n";

// The YouTrack pages' charts (Dashboard, Release, Thành viên): bars per day, horizontal bars, stacked bars.

/** Bars per day; each bar opens its tickets (click, or Enter / Space: Tab reaches the first bar, ← → move along them). */
export function Columns({ days, series }: { days: number[]; series: { name: string; v: number[]; c: string; on: (k: number) => void }[] }) {
  const W = 600, H = 170, L = 6, B = 22, T = 16, max = Math.max(1, ...series.flatMap((s) => s.v)), gw = (W - L * 2) / days.length, bw = gw * 0.7 / series.length;
  const first = days.findIndex((_, k) => series.some((s) => s.v[k])); // the one Tab stop: the first day with a bar
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="group" className="w-full text-xs" onKeyDown={(e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, bars = [...e.currentTarget.querySelectorAll<SVGGElement>("[role=button]")];
      if (step) bars[bars.indexOf(e.target as SVGGElement) + step]?.focus();
    }}>
      <line x1={L} x2={W - L} y1={H - B} y2={H - B} stroke="var(--color-rule)" />
      {days.map((t, k) => (
        <g key={t}>
          {series.map((s, si) => {
            const v = s.v[k], h = (H - B - T) * v / max, xx = L + k * gw + gw * 0.15 + si * bw;
            return v ? (
              <g key={si} role="button" tabIndex={k === first ? 0 : -1} aria-label={`${fmtDay(t)} · ${s.name}: ${v}`} className="cursor-pointer" onClick={() => s.on(k)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); s.on(k); } }}>
                <motion.rect x={xx} width={bw - 1} rx={2} fill={s.c} initial={{ y: H - B, height: 0 }} animate={{ y: H - B - h, height: h }} transition={{ duration: 0.4, delay: k * 0.01 }} className="hover:opacity-80" />
                <text x={xx + bw / 2} y={H - B - h - 3} textAnchor="middle" fill="var(--color-ink-2)">{v}</text>
              </g>
            ) : null;
          })}
          <text x={L + k * gw + gw / 2} y={H - 6} textAnchor="middle" fill="var(--color-ink-3)">{new Date(t).getDate()}</text>
        </g>
      ))}
    </svg>
  );
}

export type Bar = { label: React.ReactNode; v: number; c: string; on: () => void };
export function HBars({ rows, empty, max, label }: { rows: Bar[]; empty: string; max?: number; label?: string }) {
  const m = max ?? Math.max(0, ...rows.map((r) => r.v));
  return <Stack rows={rows.map((r) => ({ label: r.label, parts: [[r.v, r.c]], text: String(r.v), on: r.on }))} max={m} empty={empty} label={label} />;
}
/** `label`: the label column's widest (9rem). */
export function Stack({ rows, empty, max, label = "9rem" }: { rows: { label: React.ReactNode; parts: [number, string][]; text: string; on: () => void }[]; empty: string; max?: number; label?: string }) {
  const m = Math.max(1, max ?? Math.max(0, ...rows.map((r) => r.parts.reduce((s, [n]) => s + n, 0))));
  if (!rows.length) return empty ? <p className="text-sm text-ink-3">{empty}</p> : null;
  return (
    <div className="grid gap-1">
      {rows.map((r, k) => (
        <button key={k} type="button" onClick={r.on} style={{ gridTemplateColumns: `minmax(0,${label}) minmax(0,1fr) 2.5rem` }} className="grid items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-paper-2">
          <span className="min-w-0 truncate">{r.label}</span>
          <span className="flex h-2 overflow-hidden rounded-full bg-paper-3">
            {r.parts.map(([n, c], j) => <motion.i key={j} className="h-full" style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${n / m * 100}%` }} transition={{ duration: 0.45 }} />)}
          </span>
          <em className="text-right font-mono text-xs text-ink-2 not-italic tabular-nums">{r.text}</em>
        </button>
      ))}
    </div>
  );
}

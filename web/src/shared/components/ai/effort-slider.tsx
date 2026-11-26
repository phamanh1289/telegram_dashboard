"use client";

import { animate, AnimatePresence, motion, type MotionStyle, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { type Effort, effortLabel } from "@/shared/components/ai/prefs";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

const THUMB = 20; // px, the drawn thumb (.effort --t)
const FOLLOW = { type: "spring", stiffness: 900, damping: 55, mass: 0.5 } as const; // under the finger: quick, no overshoot
const SETTLE = { type: "spring", stiffness: 420, damping: 24 } as const; // into a notch: a small bounce

/** Soft notches: near a step the thumb leans onto it, halfway between two it moves freely (r in steps; f(±0.5) = ±0.5). */
const detent = (r: number) => {
  const n = Math.round(r), d = r - n;
  return n + Math.sign(d) * 0.5 * (2 * Math.abs(d)) ** 1.6;
};

/** How an effort pick shows: "full" = slider + the level's name (settings, the AI page); "short" = the name only, a click
 *  lists the levels (inside prompt boxes, where room is tight). */
export type EffortVariant = "full" | "short";

/** Stepped slider in the accent. Dragging moves a motion value (no re-render per move): the thumb springs after the finger,
 *  leans into each step's notch with a ripple and a bubble naming the level, and bounces into the nearest step on release
 *  (only then saved). Drawn by `.effort` (globals.css) on --pct; a native range underneath keeps the keyboard and a11y.
 *  `short`: the level chip alone. */
export function EffortSlider({ label, steps, value, onChange, className, inherit, bare, variant = "full" }: {
  label: string; steps: Effort[]; value: Effort; onChange: (v: Effort) => void; className?: string; inherit?: string; bare?: boolean;
  variant?: EffortVariant;
}) {
  const t = useT();
  const still = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const ripple = useRef<HTMLSpanElement>(null);
  const aim = useRef<number | null>(null); // where the finger points (0…1) while it holds the thumb
  const i = Math.max(0, steps.indexOf(value)); // a step this CLI doesn't take reads as its default
  const last = Math.max(1, steps.length - 1);
  const pct = useMotionValue(i / last);
  const [drag, setDrag] = useState(false);
  const [near, setNear] = useState(i); // the step under the thumb, live while it moves
  useMotionValueEvent(pct, "change", (v) => setNear(Math.round(v * last)));
  const go = (to: number, how: typeof FOLLOW | typeof SETTLE) => (still ? pct.jump(to) : void animate(pct, to, how));
  // Saved elsewhere (arrows, the chip, a failed save rolling back): glide there, unless the finger holds it.
  useEffect(() => { if (aim.current == null) go(i / last, SETTLE); }, [i, last]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each notch the finger passes ripples under the thumb.
  useEffect(() => {
    if (aim.current != null && !still && ripple.current) animate(ripple.current, { scale: [0.6, 2.2], opacity: [0.45, 0] }, { duration: 0.45, ease: "easeOut" });
  }, [near, still]);
  const shown = drag ? near : i; // the chip names the level being dragged to, else the saved one (no flicker while gliding)
  const name = (v: Effort) => (v === "" && inherit ? inherit : effortLabel(v));
  const at = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return detent(Math.min(1, Math.max(0, (e.clientX - r.left - THUMB / 2) / (r.width - THUMB))) * last) / last;
  };
  const hold = (to: number) => { aim.current = to; go(to, FOLLOW); };
  const drop = (keep: boolean) => {
    if (aim.current == null) return;
    const n = Math.round(aim.current * last);
    aim.current = null;
    setDrag(false);
    go((keep ? n : i) / last, SETTLE);
    if (keep && steps[n] !== value) onChange(steps[n]);
  };
  // The level's name, deepening with it like the fill; a click lists every level to pick one without sliding.
  const chip = (
    <Dropdown label={t("{label}: chọn mức", { label })} value={steps[shown]} onChange={(v) => onChange(v as Effort)}
      options={steps.map((v) => ({ value: v, label: name(v) }))}
      trigger={cn("flex h-7 shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-full pr-1.5 pl-2 text-xs font-medium whitespace-nowrap text-ink transition-[background-color,box-shadow] duration-(--dur-short) hover:shadow-groove data-popup-open:shadow-groove",
        variant === "short" ? "min-w-[4.5rem]" : "w-[6.5rem]", steps[shown] === "" && "bg-paper-3")}
      style={steps[shown] !== "" ? { background: `color-mix(in oklch, var(--color-hl) ${Math.round((shown / last) * 30)}%, var(--color-hl-wash))` } : undefined} />
  );
  if (variant === "short") return chip;
  return (
    <span className="flex min-w-0 items-center gap-2.5 text-xs text-ink-3">
      {!bare && <span aria-hidden>Effort</span>}
      <motion.span className={cn("effort", className)} data-drag={drag || undefined} style={{ "--pct": pct } as MotionStyle}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          input.current?.focus({ preventScroll: true });
          setDrag(true);
          hold(at(e));
        }}
        onPointerMove={(e) => aim.current != null && hold(at(e))} onPointerUp={() => drop(true)} onPointerCancel={() => drop(false)}>
        {/* Notches on the inner steps only: the track's ends already mark the first and last. */}
        {steps.map((v, k) => k > 0 && k < last && <span key={v} aria-hidden className="effort-tick" data-on={k <= near || undefined} style={{ "--k": k / last } as React.CSSProperties} />)}
        <span aria-hidden className="effort-thumb"><span ref={ripple} className="effort-ripple" /></span>
        <AnimatePresence>
          {drag && (
            <motion.span key="bubble" aria-hidden className="effort-bubble" initial={{ opacity: 0, scale: 0.6, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.6, y: 6 }} transition={{ type: "spring", stiffness: 520, damping: 30 }}>
              {/* The new name slides up into the bubble (clipped), always fully opaque: no two half-faded names overlapping. */}
              <motion.span key={near} className="block" initial={{ y: "100%" }} animate={{ y: 0 }}
                transition={{ type: "spring", stiffness: 600, damping: 34 }}>{name(steps[near])}</motion.span>
            </motion.span>
          )}
        </AnimatePresence>
        <input ref={input} type="range" min={0} max={steps.length - 1} step={1} value={i} aria-label={label} aria-valuetext={name(steps[i])}
          onChange={(ev) => onChange(steps[Number(ev.target.value)])} />
      </motion.span>
      {chip}
    </span>
  );
}

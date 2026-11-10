"use client";

import { AnimatePresence, motion } from "motion/react";
import { cloneElement, type FocusEvent, type PointerEvent, type ReactElement, type SyntheticEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** How long the pointer rests on a menu / icon before the first hint pops up. */
export const HINT_DELAY = 500;
/** Warm: while a hint shows, or within HINT_WARM_FOR of the last one closing, the next one (a neighbour) waits only this. */
export const HINT_WARM_DELAY = 100;
export const HINT_WARM_FOR = 300;

/** The guide: a little light bulb that blinks and glows (the AI chip has the robot). */
export const GuideBulb = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 32 32" aria-hidden className={className}>
    <path d="M16 1.5v2.5M5.5 6l1.8 1.8M26.5 6l-1.8 1.8M2 16h2.5M27.5 16H30" stroke="var(--color-info)" strokeWidth="1.6" strokeLinecap="round" className="hint-rays" />
    <circle cx="16" cy="15" r="9.5" fill="var(--color-info)" />
    <ellipse cx="16" cy="15.5" rx="6.5" ry="5" fill="var(--color-cotton)" />
    <g className="ai-blink"><circle cx="13.5" cy="15" r="1.4" fill="var(--color-info)" /><circle cx="18.5" cy="15" r="1.4" fill="var(--color-info)" /></g>
    <path d="M14.4 17.6q1.6 1 3.2 0" stroke="var(--color-info)" strokeWidth="1" fill="none" strokeLinecap="round" />
    <rect x="12" y="24" width="8" height="3" rx="1" fill="var(--color-ink-3)" />
    <rect x="13" y="27.5" width="6" height="2.5" rx="1.25" fill="var(--color-ink-3)" />
  </svg>
);

type Side = "right" | "bottom";

// One pointer, one pending hint: module state shared by every Hint (not refs, so the handlers stay plain functions).
let timer: ReturnType<typeof setTimeout> | undefined;
let shown = 0; // hints on screen
let closedAt = 0; // when the last one went away
const cancel = () => clearTimeout(timer);
const warm = () => shown > 0 || Date.now() - closedAt < HINT_WARM_FOR;
const schedule = (fn: () => void) => { cancel(); timer = setTimeout(fn, warm() ? HINT_WARM_DELAY : HINT_DELAY); };
const opened = () => { shown++; };
const closed = () => { shown = Math.max(0, shown - 1); closedAt = Date.now(); };

/**
 * Hover (or keyboard focus) for HINT_DELAY: the bulb pops up beside `children` with a quick note on what it does.
 * The one hint for menus and icons; drawn in a portal so a clipped sidebar never cuts it. `children`: one element taking pointer / focus handlers.
 */
export function Hint({ title, text, side = "right", children }: { title?: string; text: string; side?: Side; children: ReactElement<Record<string, unknown>> }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  // The portal exists only while the note shows or animates out: a long list has thousands of closed Hints.
  const [mounted, setMounted] = useState(false);
  const id = useId();
  useEffect(() => cancel, []);
  useEffect(() => { if (!at) return; opened(); return closed; }, [at]); // also on unmount, so "warm" never sticks
  const later = (el: Element) => schedule(() => { setMounted(true); setAt(el.getBoundingClientRect()); });
  const hide = () => { cancel(); setAt(null); };
  const right = side === "right";
  // Measure the note, then flip to the other side / slide along the edge so it never runs off-screen or gets squeezed.
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, flip: false });
  useLayoutEffect(() => {
    const el = box.current;
    if (!at || !el) return;
    const w = el.offsetWidth, h = el.offsetHeight, m = 8;
    const fit = (v: number, room: number) => Math.max(m, Math.min(v, room - m));
    if (right) {
      const flip = at.right + 8 + w > innerWidth - m;
      setPos({ left: fit(flip ? at.left - 8 - w : at.right + 8, innerWidth - w), top: fit(at.top + at.height / 2 - 16, innerHeight - h), flip });
    } else {
      const flip = at.bottom + 6 + h > innerHeight - m;
      setPos({ left: fit(at.left + at.width / 2 - 16, innerWidth - w), top: flip ? at.top - 6 - h : at.bottom + 6, flip });
    }
  }, [at, right]);
  const off = (pos.flip ? 1 : -1) * 10;
  const own = children.props as Partial<Record<"onPointerEnter" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur", (e: SyntheticEvent) => void>>;
  return (
    <>
      {cloneElement(children, {
        // The child's own handlers still run (cloneElement would replace them).
        onPointerEnter: (e: PointerEvent) => { own.onPointerEnter?.(e); if (e.pointerType === "mouse") later(e.currentTarget); },
        onPointerLeave: (e: PointerEvent) => { own.onPointerLeave?.(e); hide(); },
        onPointerDown: (e: PointerEvent) => { own.onPointerDown?.(e); hide(); }, // clicked: it did its job
        onFocus: (e: FocusEvent) => { own.onFocus?.(e); if (e.currentTarget.matches(":focus-visible")) later(e.currentTarget); },
        onBlur: (e: FocusEvent) => { own.onBlur?.(e); hide(); },
        "aria-describedby": at ? id : undefined, // screen readers hear the note with the control
      })}
      {(mounted || at) && createPortal(
        <AnimatePresence onExitComplete={() => setMounted(false)}>
          {at && (
            <motion.div ref={box} key="hint" id={id} role="tooltip" initial={{ opacity: 0, scale: 0.5, ...(right ? { x: off } : { y: off }) }} animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.6, ...(right ? { x: off * 0.8 } : { y: off * 0.8 }) }} transition={{ type: "spring", stiffness: 520, damping: 22 }}
              style={{ left: pos.left, top: pos.top }}
              className={cn("pointer-events-none fixed z-50 flex w-max max-w-72 items-start gap-1",
                right ? (pos.flip ? "origin-right flex-row-reverse" : "origin-left") : (pos.flip ? "origin-bottom-left" : "origin-top-left"))}>
              <GuideBulb className="size-8 shrink-0 drop-shadow-sm" />
              <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 }}
                className={cn("mt-4 grid min-w-0 gap-0.5 rounded-lg bg-cotton px-2.5 py-1.5 text-xs text-ink-2 shadow-pop", right && pos.flip ? "rounded-tr-none" : "rounded-tl-none")}>
                {title && <b className="font-bold text-ink">{title}</b>}
                {text}
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { cloneElement, type FocusEvent, type PointerEvent, type ReactElement, useEffect, useState } from "react";
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
  useEffect(() => cancel, []);
  useEffect(() => { if (!at) return; opened(); return closed; }, [at]); // also on unmount, so "warm" never sticks
  const later = (el: Element) => schedule(() => setAt(el.getBoundingClientRect()));
  const hide = () => { cancel(); setAt(null); };
  const right = side === "right";
  return (
    <>
      {cloneElement(children, {
        onPointerEnter: (e: PointerEvent) => { if (e.pointerType === "mouse") later(e.currentTarget); },
        onPointerLeave: hide,
        onPointerDown: hide, // clicked: it did its job
        onFocus: (e: FocusEvent) => { if (e.currentTarget.matches(":focus-visible")) later(e.currentTarget); },
        onBlur: hide,
      })}
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {at && (
            <motion.div key="hint" role="tooltip" initial={{ opacity: 0, scale: 0.5, ...(right ? { x: -10 } : { y: -10 }) }} animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.6, ...(right ? { x: -8 } : { y: -8 }) }} transition={{ type: "spring", stiffness: 520, damping: 22 }}
              style={right ? { left: at.right + 8, top: at.top + at.height / 2 - 16 } : { left: at.left + at.width / 2 - 16, top: at.bottom + 6 }}
              className={cn("pointer-events-none fixed z-50 flex max-w-72 gap-1", right ? "origin-left items-start" : "origin-top-left items-start")}>
              <GuideBulb className="size-8 shrink-0 drop-shadow-sm" />
              <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 }}
                className="mt-4 grid gap-0.5 rounded-lg rounded-tl-none bg-cotton px-2.5 py-1.5 text-xs text-ink-2 shadow-pop">
                {title && <b className="font-semibold text-ink">{title}</b>}
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

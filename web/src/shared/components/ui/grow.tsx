"use client";

import { createContext, type PointerEvent, type ReactNode, use, useId, useState } from "react";
import { cn } from "@/shared/lib/utils";

// An icon button whose label slides out under the pointer or on keyboard focus (a ticket's features in YouTrack,
// Tài liệu's toolbar). The buttons sit in a GrowRow; each carries `group/grow`, useGrow().enter and a GrowLabel.

const Row = createContext<{ out: string[]; show: (id: string) => void } | null>(null);

/** The row of such buttons. A label that is out stays out until the pointer leaves the row (or a button is pressed):
 *  one closing behind the pointer would pull the next icon away from under it. So an icon never moves while the
 *  pointer is on it, and its neighbours only ever move one way. */
export function GrowRow({ className, children }: { className?: string; children: ReactNode }) {
  const [out, setOut] = useState<string[]>([]);
  const shut = () => setOut((o) => (o.length ? [] : o));
  return (
    <Row value={{ out, show: (id) => setOut((o) => (o.includes(id) ? o : [...o, id])) }}>
      <div className={className} onPointerLeave={shut} onClick={shut}>{children}</div>
    </Row>
  );
}

/** One button of a GrowRow: `open` for its GrowLabel, `enter` for its onPointerEnter (a tap opens nothing). */
export function useGrow() {
  const id = useId(), row = use(Row);
  return { open: !!row?.out.includes(id), enter: (e: PointerEvent) => { if (e.pointerType !== "touch") row?.show(id); } };
}

/** The label: grid column 0fr → 1fr, so it grows to its own width with no measuring; always in the DOM (the button's name). */
export function GrowLabel({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <span className={cn("grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-(--dur-short) ease-(--ease-out) group-focus-visible/grow:grid-cols-[1fr] group-focus-visible/grow:opacity-100",
      open && "grid-cols-[1fr] opacity-100")}>
      <span className="min-w-0 overflow-hidden whitespace-nowrap"><span className="pl-1.5">{children}</span></span>
    </span>
  );
}

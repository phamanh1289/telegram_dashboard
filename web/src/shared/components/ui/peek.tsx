"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactElement, type ReactNode, useRef } from "react";

/** Shared look of the floating cards on inline chips: Peek (hover) and the Tài liệu chips' popover (click). */
export const CHIP_POPUP = "w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) rounded-lg bg-cotton text-xs leading-snug text-ink-2 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

/** A card under an inline chip (a ticket) while the pointer or focus is on it. Drawn in a portal, so opening it never
 *  moves the text or grows the list it sits in; mounted only while open. `open` is held by the caller, so it reads the
 *  card's data only then; a click on the chip does its own thing (the card does not toggle). `trigger`: the chip, an
 *  element taking ref and props (an <a>). */
export function Peek({ open, onOpenChange, card, trigger, label }: {
  open: boolean; onOpenChange: (open: boolean) => void; card: ReactNode; trigger: ReactElement; label: string;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Popover.Root open={open} onOpenChange={(o, d) => { if (d.reason !== "trigger-press") onOpenChange(o); }}>
      <Popover.Trigger openOnHover delay={250} closeDelay={120} nativeButton={false} render={trigger}
        onFocus={() => onOpenChange(true)}
        onBlur={(e) => { if (!popup.current?.contains(e.relatedTarget)) onOpenChange(false); }} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-40 outline-none">
          <Popover.Popup ref={popup} aria-label={label} initialFocus={false} className={`${CHIP_POPUP} grid gap-2 p-3`}>
            {card}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

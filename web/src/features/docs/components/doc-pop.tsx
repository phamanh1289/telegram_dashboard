"use client";

import { Popover } from "@base-ui/react/popover";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { CHIP_POPUP } from "@/shared/components/ui/peek";
import { cn } from "@/shared/lib/utils";

// The popover of Telegram's Tài liệu chips (a KB article named in a message, a file attached to one): what it is, one
// status line, then the actions: secondary ones (icons) on the left, the one thing to do on the right. Hover shows it
// and leaving closes it; a click pins it (leaving no longer closes it; a click outside, Esc or the chip again does),
// unless `onPress` is given (a document the library has): then the click does that (DocSheet) instead. Its state comes
// from the library list already loaded (no request to open it); drawn in a portal and mounted only while open, so the
// message text never moves.

export type Tone = "ok" | "warn" | "none";
const DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", none: "bg-ink-3" };

export function DocPop({ trigger, onPress, label, icon, title, sub, tone, status, note, error, secondary, primary }: {
  trigger: ReactElement; // the chip (a <button>)
  onPress?: () => void; // the chip's click, in place of pinning the popover
  label: string; // the popover's accessible name
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  tone: Tone;
  status: ReactNode;
  note?: ReactNode; // a quiet line under the status (what the action does)
  error?: ReactNode;
  secondary?: ReactNode;
  primary?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const change = (o: boolean, reason: string) => {
    if (reason === "trigger-press") {
      if (onPress) return; // the chip's onClick below
      pinned.current = !(open && pinned.current); // a click pins it; a click on the pinned one closes it
      setOpen(pinned.current);
      return;
    }
    if (!o && pinned.current && reason === "trigger-hover") return; // pinned: the pointer leaving keeps it
    if (!o) pinned.current = false;
    setOpen(o);
  };
  return (
    <Popover.Root open={open} onOpenChange={(o, d) => change(o, d.reason)}>
      <Popover.Trigger openOnHover delay={250} closeDelay={150} render={trigger}
        onClick={onPress && (() => { pinned.current = false; setOpen(false); onPress(); })} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="z-40 outline-none">
          <Popover.Popup aria-label={label} className={cn(CHIP_POPUP, "overflow-hidden")}>
            <div className="flex gap-2.5 px-3.5 pt-3.5">
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-paper-2 text-ink-3 [&_svg]:size-4">{icon}</span>
              <div className="grid min-w-0 flex-1 content-center gap-0.5">
                <Popover.Title className="line-clamp-2 text-sm font-medium break-words text-ink">{title}</Popover.Title>
                {sub && <p className="truncate text-ink-3">{sub}</p>}
              </div>
            </div>
            <div className="grid gap-1 px-3.5 pt-2.5 pb-3.5">
              <p className="flex items-start gap-2 text-ink-2"><span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT[tone])} />{status}</p>
              {note && <p className="pl-3.5 text-ink-3">{note}</p>}
              {error && <p role="alert" className="pl-3.5 text-error">{error}</p>}
            </div>
            {(secondary || primary) && (
              <div className="flex items-center gap-1 border-t border-rule bg-paper-2 px-2 py-2">
                {secondary}
                {primary && <span className="ml-auto">{primary}</span>}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

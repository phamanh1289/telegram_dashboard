"use client";

import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/shared/lib/utils";

/** Expand / collapse on `.fold` (globals.css: grid rows 0fr → 1fr, CSS only, no height measuring, so content that loads
 *  while it opens just grows with it). `children` (one element) mount on the first open and stay, so shutting animates too. */
export function Fold({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div className={cn("fold", className)} data-open={open || undefined}>
      <div>{seen && children}</div>
    </div>
  );
}

/** A section shut under its label until asked for (the chevron turns): what `<details>` did, animated both ways.
 *  `children`: one element (see `Fold`). */
export function FoldMore({ label, className, labelClassName, children }: { label: ReactNode; className?: string; labelClassName?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={cn("flex w-full items-center gap-1.5 rounded-sm text-left font-medium text-ink-2 transition-colors duration-(--dur-micro) hover:text-ink", labelClassName)}>
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-(--dur-short) ease-(--ease-out)", open && "rotate-90")} aria-hidden />{label}
      </button>
      <Fold open={open}>{children}</Fold>
    </div>
  );
}

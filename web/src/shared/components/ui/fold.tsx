"use client";

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

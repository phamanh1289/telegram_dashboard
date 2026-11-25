"use client";

import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { Fold } from "@/shared/components/ui/fold";

/** A connection warning strip (what is down, then one action) that folds open / shut: the shell's "dashboard down" on
 *  every page and the Telegram inbox's own (Telegram / update stream). */
export function WarnBar({ open, action, className, children }: { open: boolean; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Fold open={open} className={className}>
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warn-wash px-3 py-1.5 text-xs text-warn sm:px-6">
        <WifiOff className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{children}</span>
        {action}
      </div>
    </Fold>
  );
}

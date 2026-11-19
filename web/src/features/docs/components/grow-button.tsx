"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

/** Tài liệu's toolbar buttons (Cập nhật, Thêm): a highlighted icon whose label slides open on hover / keyboard focus
 *  (grid column 0fr → 1fr, so the width animates without measuring) and folds back after. */
export function GrowButton({ icon, label, extra, className, ...props }: ComponentProps<typeof Button> & { icon: ReactNode; label: ReactNode; extra?: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" {...props}
      className={cn("group/grow gap-0 bg-hl-wash/70 px-2 text-hl-2 hover:bg-hl-wash hover:text-hl-2", className)}>
      {icon}
      <span className="grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity,margin] duration-(--dur-short) ease-(--ease-out) group-hover/grow:ml-1.5 group-hover/grow:grid-cols-[1fr] group-hover/grow:opacity-100 group-focus-visible/grow:ml-1.5 group-focus-visible/grow:grid-cols-[1fr] group-focus-visible/grow:opacity-100">
        <span className="overflow-hidden">{label}</span>
      </span>
      {extra}
    </Button>
  );
}

"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/shared/components/ui/button";
import { GrowLabel, useGrow } from "@/shared/components/ui/grow";
import { cn } from "@/shared/lib/utils";

/** Tài liệu's toolbar buttons (Cập nhật, Thêm), in a GrowRow: a highlighted icon whose label slides out. */
export function GrowButton({ icon, label, extra, className, onPointerEnter, ...props }: ComponentProps<typeof Button> & { icon: ReactNode; label: ReactNode; extra?: ReactNode }) {
  const g = useGrow();
  return (
    <Button size="sm" variant="ghost" {...props} onPointerEnter={(e) => { onPointerEnter?.(e); g.enter(e); }}
      className={cn("group/grow gap-0 bg-hl-wash/70 px-2 text-hl-2 hover:bg-hl-wash hover:text-hl-2", className)}>
      {icon}
      <GrowLabel open={g.open}>{label}</GrowLabel>
      {extra}
    </Button>
  );
}

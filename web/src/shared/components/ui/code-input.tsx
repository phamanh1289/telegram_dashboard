"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";

/** A one-time code as `length` boxes: one real input over them, so paste, autofill and the keyboard work as usual; it
 *  keeps digits only and calls `onComplete` once every box is filled. Length unknown: up to 8 digits (the server's
 *  rule), the boxes grow as you type and nothing sends by itself. */
export function CodeInput({ value, onChange, length, onComplete, label, autoFocus }: {
  value: string; onChange: (v: string) => void; length?: number | null; onComplete?: (v: string) => void; label: string; autoFocus?: boolean;
}) {
  const n = length || 8; // most digits the code takes
  const cells = length || Math.max(5, Math.min(n, value.length + 1));
  const [focus, setFocus] = useState(!!autoFocus);
  const at = Math.min(value.length, cells - 1);
  return (
    <span className="relative flex gap-2">
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} data-slot="code-cell" aria-hidden
          className={cn("grid h-11 w-10 place-items-center rounded-md border bg-cotton font-mono text-lg font-bold text-ink transition-[border-color,box-shadow] duration-(--dur-micro)",
            focus && i === at ? "border-hl ring-2 ring-hl/25" : "border-rule-2")}>
          {value[i] ?? ""}
        </span>
      ))}
      <input aria-label={label} inputMode="numeric" autoComplete="one-time-code" autoFocus={autoFocus} value={value}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        // the text is invisible: keep the caret at the end, so a click on a box never slips a digit into the middle
        onSelect={(e) => { const el = e.currentTarget, end = el.value.length; if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end); }}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, "");
          // typed or pasted into a full code: start over with the new digits, not the old ones plus a stray one
          const v = (d.length > n && value.length === n ? d.slice(n) : d).slice(0, n);
          onChange(v);
          if (length && v.length === n && v !== value) onComplete?.(v);
        }}
        className="absolute inset-0 size-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent" />
    </span>
  );
}

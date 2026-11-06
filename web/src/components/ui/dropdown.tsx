"use client";

import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT = "\u0000default"; // Select reads "" as nothing chosen; "" (e.g. a CLI default) is a real choice here

export type DropdownOption = { value: string; label: string; hint?: string };

/** Compact select: the popup scales in from the trigger, the chosen item carries a check.
 *  `trigger`: replaces the field look of the trigger (e.g. a chip), keeping its focus ring; `style` goes on the trigger;
 *  `prefix`: shown before the value inside the trigger (a quiet field name). */
export function Dropdown({ label, value, onChange, options, className, trigger, style, prefix }: {
  label: string; value: string; onChange: (v: string) => void; options: DropdownOption[]; className?: string;
  trigger?: string; style?: React.CSSProperties; prefix?: React.ReactNode;
}) {
  const enc = (v: string) => (v === "" ? DEFAULT : v);
  const items = options.map((o) => ({ ...o, value: enc(o.value) }));
  return (
    <Select.Root items={items} value={enc(value)} onValueChange={(v) => v != null && onChange(v === DEFAULT ? "" : v)}>
      <Select.Trigger aria-label={label} style={style}
        className={cn("group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus)",
          trigger ?? "flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-[var(--radius-input)] border border-rule-2 bg-cotton pr-2 pl-2.5 text-xs font-medium text-ink transition-[background-color,border-color] duration-(--dur-micro) hover:bg-paper-2 data-popup-open:border-hl", className)}>
        {prefix
          ? <span className="flex min-w-0 items-center gap-1.5">{prefix}<Select.Value className="truncate" placeholder="Chọn" /></span>
          : <Select.Value className="truncate" placeholder="Chọn" />}
        <Select.Icon><ChevronDown aria-hidden className="size-3.5 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) group-data-popup-open:rotate-180" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} align="start" alignItemWithTrigger={false} className="z-50 outline-none">
          <Select.Popup className="max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {items.map((o) => (
              <Select.Item key={o.value} value={o.value}
                className="grid cursor-default grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 rounded-md py-1.5 pr-2 pl-2.5 text-sm text-ink outline-none select-none data-highlighted:bg-paper-2">
                <span className="grid">
                  <Select.ItemText className="font-medium">{o.label}</Select.ItemText>
                  {o.hint && <span className="text-xs whitespace-nowrap text-ink-3">{o.hint}</span>}
                </span>
                <Select.ItemIndicator><Check aria-hidden className="size-4 text-hl" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

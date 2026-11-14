"use client";

import { Dialog } from "@base-ui/react/dialog";
import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Kbd } from "@/shared/components/ui/kbd";
import { useT } from "@/shared/lib/i18n";
import { fold } from "@/shared/lib/utils";
import { cn } from "@/shared/lib/utils";

// The ⌘K shell shared by the Telegram inbox and YouTrack: a base-ui dialog (focus trap, Esc, focus back to the opener)
// with one combobox input over a grouped list of commands: ↑/↓ to move, Enter to run. Each module builds its items.

export type PaletteItem = { key: string; group: string; label: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; run: () => void };

/** Every search term appears in `s` (accents and case ignored). */
export const matches = (terms: string[], s: unknown) => { const h = fold(s); return terms.every((x) => h.includes(x)); };

export function PaletteDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim fixed inset-0 z-50 bg-(--scrim)" />
        <Dialog.Popup aria-label={t("Lệnh nhanh")}
          className="fixed top-[12vh] left-1/2 z-50 grid w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card)] bg-cotton shadow-pop outline-none pop pop-top">
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The input and the list; `items` is built by the caller from `q` (its runs close the palette themselves). */
export function PaletteList({ q, onQuery, items, label, placeholder }: {
  q: string;
  onQuery: (q: string) => void;
  items: PaletteItem[];
  label: string;
  placeholder: string;
}) {
  const t = useT();
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => input.current?.focus(), []);
  const cur = Math.min(at, Math.max(0, items.length - 1));
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-k="${cur}"]`)?.scrollIntoView({ block: "nearest" }); }, [cur]);
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((cur + 1) % Math.max(1, items.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((cur - 1 + items.length) % Math.max(1, items.length)); }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); items[cur]?.run(); }
  }
  // Consecutive items of one group form a labelled group (the listbox owns only groups and options).
  const groups: { name: string; rows: [PaletteItem, number][] }[] = [];
  items.forEach((x, k) => {
    if (groups.at(-1)?.name !== x.group) groups.push({ name: x.group, rows: [] });
    groups.at(-1)!.rows.push([x, k]);
  });
  return (
    <>
      <label className="flex items-center gap-2 border-b border-rule px-3">
        <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input ref={input} value={q} onChange={(e) => { onQuery(e.target.value); setAt(0); }} onKeyDown={onKey} maxLength={500} aria-label={label}
          role="combobox" aria-expanded={items.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={items.length ? `${id}-${cur}` : undefined}
          placeholder={placeholder} className="h-12 flex-1 bg-transparent text-md outline-none" />
        <Kbd>Esc</Kbd>
      </label>
      <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} className="grid max-h-[60vh] overflow-y-auto p-1.5">
        {groups.map((g, n) => (
          <div key={`${n}:${g.name}`} role="group" aria-labelledby={`${id}-g${n}`} className="grid">
            <div id={`${id}-g${n}`} className="px-2 pt-2 pb-1 text-xs font-medium text-ink-3">{g.name}</div>
            {g.rows.map(([x, k]) => (
              <div key={x.key} id={`${id}-${k}`} role="option" aria-selected={k === cur} data-k={k} onMouseMove={() => setAt(k)} onClick={x.run}
                className={cn("flex min-h-10 cursor-default items-center gap-2.5 rounded-[var(--radius-input)] px-2.5 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-3", k === cur && "bg-hl-wash")}>
                {x.icon}
                <span className="grid min-w-0 flex-1"><span className="truncate">{x.label}</span>{typeof x.hint === "string" && <span className="truncate text-xs text-ink-3">{x.hint}</span>}</span>
                {typeof x.hint !== "string" && x.hint}
                {k === cur && <CornerDownLeft className="ml-1" aria-hidden />}
              </div>
            ))}
          </div>
        ))}
        {!items.length && <p className="px-3 py-6 text-center text-sm text-ink-3">{t("Không có kết quả.")}</p>}
      </div>
    </>
  );
}

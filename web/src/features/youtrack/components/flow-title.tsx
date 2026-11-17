"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { DialogTitle } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { useT } from "@/shared/lib/i18n";

const MAX = 120; // = Flow.title / CAP_TITLE in the engine

/** The UI flow dialog's heading: the flow's own name, else "UI flow <ticket>". `onRename` (a flow on screen): a press
 *  opens it in a box; Enter or leaving it keeps the text ("" goes back to the default name), Esc drops it. */
export function FlowTitle({ name, fallback, onRename }: { name: string; fallback: string; onRename?: (v: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const cls = "truncate pr-0 text-sm font-bold text-ink";
  if (draft !== null && onRename) {
    const done = () => { setDraft(null); if (draft.trim() !== name) onRename(draft); };
    return (
      <>
        <DialogTitle className="sr-only">{name || fallback}</DialogTitle>
        <Input autoFocus aria-label={t("Tên UI flow")} value={draft} maxLength={MAX} placeholder={fallback} className="h-7 px-2 text-sm font-bold"
          onChange={(e) => setDraft(e.target.value)} onBlur={done} onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(null); }
          }} />
      </>
    );
  }
  if (!onRename) return <DialogTitle className={cls}>{name || fallback}</DialogTitle>;
  return (
    <Hint side="bottom" text={t("Đổi tên UI flow. Tên mới lên ticket khi bấm Cập nhật.")}>
      <button type="button" aria-label={t("Đổi tên UI flow")} className="group flex min-w-0 items-center gap-1.5 self-start rounded text-left" onClick={() => setDraft(name || "")}>
        <DialogTitle className={cls}>{name || fallback}</DialogTitle>
        <Pencil aria-hidden className="size-3.5 shrink-0 text-ink-3 transition-colors group-hover:text-ink group-focus-visible:text-ink" />
      </button>
    </Hint>
  );
}

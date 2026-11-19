"use client";

import { History } from "lucide-react";
import { useState } from "react";
import { fmtClock, fmtDay, fmtNum, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import type { DocDetail } from "@/features/docs/lib/docs";

// "cập nhật dd/mm/yyyy" in the reader's header: hover / focus shows what each recorded update changed, line by line
// (the backend diffs the stored copy against the new one when a sync or an AI session sees the document change;
// YouTrack has no article history to read). Same peek card as the ticket chip.

type Rev = DocDetail["revs"][number];

export function Updated({ at, revs }: { at: string; revs: Rev[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" aria-describedby={open ? "doc-revs" : undefined}
        className={cn("inline-flex items-center gap-1 rounded-sm hover:text-ink-2", revs.length > 0 && "underline decoration-dotted underline-offset-4")}>
        {revs.length > 0 && <History className="size-3" aria-hidden />}
        {t("cập nhật {d}", { d: fmtDay(at) })}
      </button>
      {open && (
        // pt, not mt: the pointer crosses into the card without leaving the date's box.
        <span className="absolute top-full left-0 z-30 pt-1">
          <span id="doc-revs" role="tooltip" className="grid max-h-96 w-md max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto rounded-md bg-cotton p-3 text-xs leading-snug whitespace-normal text-ink-2 shadow-pop animate-in fade-in-0 duration-(--dur-micro)">
            {revs.length ? revs.map((r, i) => <RevItem key={i} r={r} />)
              : <span>{t("Chưa ghi nhận lần cập nhật nào. App ghi lại các dòng đổi từ lần tài liệu đổi tiếp theo (khi đồng bộ hoặc khi phiên AI đọc bài).")}</span>}
          </span>
        </span>
      )}
    </span>
  );
}

function RevItem({ r }: { r: Rev }) {
  const t = useT();
  return (
    <span className="grid gap-1.5 border-b border-rule pb-2.5 last:border-0 last:pb-0">
      <span className="font-medium text-ink-2">
        {fmtDay(r.at)} {fmtClock(r.at)}{r.by && <span className="font-normal text-ink-3"> · {r.by}</span>}
      </span>
      {r.blocks.map((b, i) => (
        <span key={i} className="grid gap-0.5">
          {b.heading && <span className="truncate text-ink-3">{b.heading.replace(/^#+\s*/, "")}</span>}
          {b.removed.map((l, k) => <Line key={`r${k}`} sign="−" text={l} cls="bg-error-wash text-ink line-through decoration-error/60" />)}
          {b.added.map((l, k) => <Line key={`a${k}`} sign="+" text={l} cls="bg-ok-wash text-ink" />)}
        </span>
      ))}
      {r.more > 0 && <span className="text-ink-3">{t("… và {n} dòng đổi khác", { n: fmtNum(r.more) })}</span>}
    </span>
  );
}

const Line = ({ sign, text, cls }: { sign: string; text: string; cls: string }) => (
  <span className={cn("flex gap-1.5 rounded-sm px-1.5 py-0.5 break-words", cls)}>
    <span aria-hidden className="shrink-0 font-mono text-ink-3">{sign}</span><span className="min-w-0">{text}</span>
  </span>
);

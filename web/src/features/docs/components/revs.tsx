"use client";

import { ChevronDown, CornerDownRight, History } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { Empty } from "@/shared/components/ui/empty";
import { Fold } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { fmtClock, fmtDay, fmtNum, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import type { DocDetail } from "@/features/docs/lib/docs";
import { headingText } from "./results";

// "cập nhật dd/mm/yyyy" in the reader's header. Hover / focus: the last updates, line by line (a peek, like the ticket
// chip). Click: "Lịch sử thay đổi", a page sliding in from the right with every update since the document came into the
// library (DocDetail.added_at), newest first. The backend diffs the stored copy against the new one when a sync or an
// AI session sees the document change (YouTrack has no article history to read): edits between two syncs show as one.

type Rev = DocDetail["revs"][number];
type Block = Rev["blocks"][number];
export type OnLine = (rev: Rev, block: Block, line: string | null) => void;
const PEEK = 3; // updates in the hover card

const tally = (r: Rev) => r.blocks.reduce((n, b) => ({ add: n.add + b.added.length, del: n.del + b.removed.length }), { add: 0, del: 0 });

export function Updated({ at, revs, onOpen, onLine }: {
  at: string; revs: Rev[]; onOpen: () => void;
  onLine: OnLine; // a line in the card, clicked: shown in the reader, as from the sheet
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const last = revs[0] && tally(revs[0]); // the update the date is of
  return (
    <span className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      // keyboard focus only: the sheet hands focus back to the date when it closes, which must not reopen the card
      onFocus={(e) => { if (e.target.matches(":focus-visible")) setOpen(true); }} onBlur={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" aria-describedby={open ? "doc-revs" : undefined} aria-haspopup="dialog"
        onClick={() => { setOpen(false); onOpen(); }}
        className={cn("inline-flex items-center gap-1 rounded-sm hover:text-ink-2", last && "font-bold text-ink-2 underline decoration-dotted underline-offset-4")}>
        {last && <History className="size-3" aria-hidden />}
        {t("cập nhật {d}", { d: fmtDay(at) })}
        {last && (
          <span className="font-mono">
            (<span className="text-ok">+{fmtNum(last.add)}</span>, <span className="text-error">−{fmtNum(last.del)}</span>)
          </span>
        )}
      </button>
      {open && (
        // pt, not mt: the pointer crosses into the card without leaving the date's box.
        <span className="absolute top-full left-0 z-30 pt-1">
          <span id="doc-revs" role="tooltip" className="grid max-h-96 w-md max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto rounded-md bg-cotton p-3 text-xs leading-snug whitespace-normal text-ink-2 shadow-pop animate-in fade-in-0 duration-(--dur-micro)">
            {revs.length ? revs.slice(0, PEEK).map((r, i) => (
              <span key={i} className="grid gap-1.5 border-b border-rule pb-2.5 last:border-0 last:pb-0">
                <RevHead r={r} />
                <Blocks r={r} onLine={(...a) => { setOpen(false); onLine(...a); }} />
              </span>
            )) : <span>{t("Chưa ghi nhận lần cập nhật nào. App ghi lại các dòng đổi từ lần tài liệu đổi tiếp theo (khi đồng bộ hoặc khi phiên AI đọc bài).")}</span>}
            <span className="sticky -bottom-3 -mx-3 -mb-3 bg-cotton px-3 py-2 text-ink-3">{t("Bấm một dòng để xem trong tài liệu, bấm ngày cập nhật để xem toàn bộ thay đổi từ lúc nhập")}</span>
          </span>
        </span>
      )}
    </span>
  );
}

/** "Lịch sử thay đổi": facts on top, then a timeline from the newest update down to the day the document came in. */
export function RevsSheet({ open, onClose, data, onLine }: {
  open: boolean; onClose: () => void; data: DocDetail;
  onLine: OnLine; // a changed line or its section's name, clicked: shown in the reader (diff-mark.tsx)
}) {
  const t = useT();
  const revs = data.revs ?? [];
  const sum = revs.map(tally).reduce((a, b) => ({ add: a.add + b.add, del: a.del + b.del }), { add: 0, del: 0 });
  const people = [...new Set(revs.map((r) => r.by).filter(Boolean))];
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn(DIALOG_SHEET, "sm:max-w-2xl")}>
        <DialogHeader className="shrink-0 border-b bg-paper-2 px-5 py-4">
          <DialogTitle className="flex items-center gap-2"><History aria-hidden className="size-4 text-hl-2" />{t("Lịch sử thay đổi")}</DialogTitle>
          <DialogDescription className="truncate">{data.doc.title || data.doc.ref}</DialogDescription>
          <dl className="@container mt-2 grid grid-cols-2 gap-2 @lg:grid-cols-4">
            <Fact k={t("Nhập vào app")} v={data.added_at ? fmtDay(data.added_at) : t("Chưa rõ")} />
            <Fact k={t("Lần cập nhật")} v={fmtNum(revs.length)} />
            <Fact k={t("Dòng thêm / bỏ")} v={<><span className="text-ok">+{fmtNum(sum.add)}</span> <span className="text-error">−{fmtNum(sum.del)}</span></>} />
            <Fact k={t("Người sửa")} v={people.join(", ") || "—"} />
          </dl>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {revs.length ? (
            <ol className="relative grid gap-3 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-rule">
              {revs.map((r, i) => <RevRow key={i} r={r} first={i === 0} onLine={(...a) => { onClose(); onLine(...a); }} />)}
              <li className="relative flex items-center gap-3 pl-6 text-xs text-ink-3">
                <Dot className="bg-paper-3" />
                {data.added_at ? t("Nhập vào app {d}", { d: `${fmtDay(data.added_at)} ${fmtClock(data.added_at)}` })
                  : t("Bản đầu tiên app lưu (nhập trước khi app ghi ngày nhập)")}
              </li>
            </ol>
          ) : (
            <Empty icon={<History />} title={t("Chưa có thay đổi nào từ lúc nhập")}>
              {t("App so bản đang lưu với bản mới mỗi khi đồng bộ hoặc phiên AI đọc bài; nhiều lần sửa giữa hai lần đồng bộ hiện thành một.")}
            </Empty>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const Fact = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="grid min-w-0 gap-0.5 rounded-md bg-paper px-2.5 py-1.5">
    <dt className="text-2xs text-ink-3">{k}</dt>
    <dd className="truncate text-sm font-medium text-ink">{v}</dd>
  </div>
);

const Dot = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn("absolute top-1/2 left-0 size-[11px] -translate-y-1/2 rounded-full ring-4 ring-cotton", className)} />
);

function RevRow({ r, first, onLine }: { r: Rev; first: boolean; onLine: OnLine }) {
  const t = useT();
  const [open, setOpen] = useState(first);
  const heads = [...new Set(r.blocks.map((b) => headingText(b.heading) || t("(đầu tài liệu)")))];
  return (
    <li className="relative pl-6">
      <span className="absolute top-0 left-0 flex h-9 items-center"><span className="relative block size-[11px]"><Dot className={first ? "bg-hl" : "bg-ink-3"} /></span></span>
      <div className="rounded-md border border-rule bg-cotton">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-paper-2">
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-ink">{fmtDay(r.at)} {fmtClock(r.at)}</span>
              {r.by && <span className="truncate text-xs text-ink-3">{r.by}</span>}
            </span>
            <span className="truncate text-xs text-ink-3">{heads.join(" · ")}</span>
          </span>
          <Counts r={r} />
          <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        <Fold open={open}>
          <div className="grid gap-3 border-t border-rule px-3 py-3 text-sm">
            <Blocks r={r} onLine={onLine} />
          </div>
        </Fold>
      </div>
    </li>
  );
}

function Counts({ r }: { r: Rev }) {
  const { add, del } = tally(r);
  return (
    <span className="flex shrink-0 gap-1 font-mono text-2xs">
      {add > 0 && <span className="rounded-sm bg-ok-wash px-1.5 py-0.5 text-ok">+{fmtNum(add)}</span>}
      {del > 0 && <span className="rounded-sm bg-error-wash px-1.5 py-0.5 text-error">−{fmtNum(del)}</span>}
    </span>
  );
}

function RevHead({ r }: { r: Rev }) {
  return (
    <span className="flex items-center gap-2 font-medium text-ink-2">
      <span className="min-w-0 flex-1">{fmtDay(r.at)} {fmtClock(r.at)}{r.by && <span className="font-normal text-ink-3"> · {r.by}</span>}</span>
      <Counts r={r} />
    </span>
  );
}

/** One update's changed lines under their sections; in the page, each line and section name opens it in the text. */
function Blocks({ r, onLine }: { r: Rev; onLine?: OnLine }) {
  const t = useT();
  return (
    <>
      {r.blocks.map((b, i) => {
        const name = headingText(b.heading) || (onLine ? t("(đầu tài liệu)") : "");
        const go = onLine && ((line: string | null) => () => onLine(r, b, line));
        return (
          <span key={i} className="grid gap-0.5">
            {go ? (
              <Hint text={t("Tới mục này trong tài liệu")} side="bottom">
                <button type="button" onClick={go(null)} className="flex min-w-0 items-center gap-1 justify-self-start text-xs text-ink-3 hover:text-hl-2">
                  <CornerDownRight aria-hidden className="size-3 shrink-0" /><span className="truncate">{name}</span>
                </button>
              </Hint>
            ) : name && <span className="truncate text-xs text-ink-3">{name}</span>}
            {b.removed.map((l, k) => <Line key={`r${k}`} sign="−" text={l} cls={DEL} onClick={go?.(l)} />)}
            {b.added.map((l, k) => <Line key={`a${k}`} sign="+" text={l} cls={ADD} onClick={go?.(l)} />)}
          </span>
        );
      })}
      {r.more > 0 && <span className="text-xs text-ink-3">{t("… và {n} dòng đổi khác", { n: fmtNum(r.more) })}</span>}
    </>
  );
}

export const DEL = "bg-error-wash text-ink line-through decoration-error/60";
export const ADD = "bg-ok-wash text-ink";

/** A − / + line, code style; with `onClick` a button showing that change in the document. */
export function Line({ sign, text, cls, onClick }: { sign: string; text: string; cls: string; onClick?: () => void }) {
  const t = useT();
  const body = <><span aria-hidden className="shrink-0 font-mono text-ink-3">{sign}</span><span className="min-w-0">{text}</span></>;
  const base = cn("flex gap-1.5 rounded-sm px-1.5 py-0.5 text-left break-words", cls);
  if (!onClick) return <span className={base}>{body}</span>;
  return (
    <Hint text={t("Xem chỗ đổi này trong tài liệu")} side="bottom">
      <button type="button" onClick={onClick} className={cn(base, "w-full hover:ring-1 hover:ring-rule-2 focus-visible:ring-2")}>{body}</button>
    </Hint>
  );
}

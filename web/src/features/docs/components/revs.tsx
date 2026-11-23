"use client";

import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { Empty } from "@/shared/components/ui/empty";
import { Fold } from "@/shared/components/ui/fold";
import { fmtClock, fmtDay, fmtNum, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import type { DocDetail } from "@/features/docs/lib/docs";
import { DiffRows } from "./diff-rows";
import { headingText, same } from "./results";

// "cập nhật dd/mm/yyyy" in the reader's header. Hover / focus: the latest update, line by line (a peek, like the ticket
// chip). Click: "Lịch sử thay đổi", a page sliding in from the right with every update since the document came into the
// library (DocDetail.added_at), newest first. The backend diffs the stored copy against the new one when a sync or an
// AI session sees the document change (YouTrack has no article history to read): edits between two syncs show as one.

type Rev = DocDetail["revs"][number];
type Block = Rev["blocks"][number];
export type OnLine = (rev: Rev, block: Block, line: string | null) => void;

const tally = (r: Rev) => r.blocks.reduce((n, b) => ({ add: n.add + b.added.length, del: n.del + b.removed.length }), { add: 0, del: 0 });

export function Updated({ at, title, revs, onOpen, onLine }: {
  at: string; title: string; revs: Rev[]; onOpen: () => void;
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
            {revs[0] ? (
              <span className="grid gap-1.5">
                <RevHead r={revs[0]} />
                <Blocks r={revs[0]} title={title} onLine={(...a) => { setOpen(false); onLine(...a); }} />
              </span>
            ) : <span>{t("Chưa ghi nhận lần cập nhật nào. App ghi lại các dòng đổi từ lần tài liệu đổi tiếp theo (khi đồng bộ hoặc khi phiên AI đọc bài).")}</span>}
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
          <DialogDescription className="line-clamp-1 max-w-none">{data.doc.title || data.doc.ref}</DialogDescription>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3 *:not-first:before:mr-2 *:not-first:before:content-['·']">
            <span>{data.added_at ? t("Nhập vào app {d}", { d: fmtDay(data.added_at) }) : `${t("Nhập vào app")}: ${t("Chưa rõ")}`}</span>
            <span>{t("{n} lần cập nhật", { n: fmtNum(revs.length) })}</span>
            {revs.length > 0 && <span className="font-mono"><span className="text-ok">+{fmtNum(sum.add)}</span> <span className="text-error">−{fmtNum(sum.del)}</span></span>}
            {people.length > 0 && <span className="min-w-0 truncate text-ink-2">{people.join(", ")}</span>}
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {revs.length ? (
            <ol className="relative grid gap-3 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-rule">
              {revs.map((r, i) => <RevRow key={i} r={r} title={data.doc.title} first={i === 0} onLine={(...a) => { onClose(); onLine(...a); }} />)}
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

const Dot = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn("absolute top-1/2 left-0 size-[11px] -translate-y-1/2 rounded-full ring-4 ring-cotton", className)} />
);

function RevRow({ r, title, first, onLine }: { r: Rev; title: string; first: boolean; onLine: OnLine }) {
  const t = useT();
  const [open, setOpen] = useState(first);
  const heads = [...new Set(r.blocks.map((b) => secName(b.heading, title) || t("(đầu tài liệu)")))];
  return (
    <li className="relative pl-6">
      <span className="absolute top-0 left-0 flex h-9 items-center"><span className="relative block size-[11px]"><Dot className={first ? "bg-hl" : "bg-ink-3"} /></span></span>
      <div className="rounded-md border border-rule bg-cotton">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-paper-2">
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-bold text-ink">{fmtDay(r.at)} {fmtClock(r.at)}</span>
              {r.by && <span className="truncate text-xs text-ink-2">{r.by}</span>}
            </span>
            <span className="truncate text-xs text-ink-3">{heads.join(" · ")}</span>
          </span>
          <Counts {...tally(r)} />
          <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        <Fold open={open}>
          <div className="grid grid-cols-1 gap-4 border-t border-rule px-3 py-3 text-sm">
            <Blocks r={r} title={title} onLine={onLine} fold />
          </div>
        </Fold>
      </div>
    </li>
  );
}

function Counts({ add, del }: { add: number; del: number }) {
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
      <Counts {...tally(r)} />
    </span>
  );
}

/** One update's changed lines under their sections; each line clicked opens it in the text.
 *  `fold`: each section starts shut, its name toggles it (the sheet; the hover card shows them open). */
function Blocks({ r, title, onLine, fold }: { r: Rev; title: string; onLine?: OnLine; fold?: boolean }) {
  const t = useT();
  return (
    <>
      {r.blocks.map((b, i) => <Section key={i} b={b} title={title} fold={fold} max={fold ? 8 : 4} onLine={onLine && ((line) => onLine(r, b, line))} />)}
      {r.more > 0 && <span className="text-xs text-ink-3">{t("… và {n} dòng đổi khác", { n: fmtNum(r.more) })}</span>}
    </>
  );
}

function Section({ b, title, fold, max, onLine }: { b: Block; title: string; fold?: boolean; max: number; onLine?: (line: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(!fold);
  const name = secName(b.heading, title) || t("(đầu tài liệu)");
  const [, num, rest] = name.match(/^(\d+(?:\.\d+)*)\.?\s+(.+)$/) ?? [, "", name];
  const head = (
    <>
      {num && <span className="shrink-0 rounded-sm bg-hl-wash px-1.5 font-mono text-2xs leading-5 font-bold text-hl-2">{num}</span>}
      <span className="truncate">{rest}</span>
    </>
  );
  const rows = <DiffRows removed={b.removed} added={b.added} max={max} onLine={onLine} />;
  return (
    <span className="grid min-w-0 gap-1.5">
      {fold ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="-mx-1 flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 text-left font-medium text-ink hover:bg-paper-2">
          {head}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <Counts add={b.added.length} del={b.removed.length} />
            <ChevronDown aria-hidden className={cn("size-4 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none", open && "rotate-180")} />
          </span>
        </button>
      ) : <span className="flex min-w-0 items-center gap-2 font-medium text-ink">{head}</span>}
      {fold ? <Fold open={open}>{rows}</Fold> : rows}
    </span>
  );
}

/** A section's name, or "" for the top of the document and a heading that only repeats the document's name. */
const secName = (heading: string, title: string) => (heading && !same(heading, title) ? headingText(heading) : "");

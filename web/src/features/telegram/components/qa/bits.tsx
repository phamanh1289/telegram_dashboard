"use client";

import { BellOff, BellRing, Check, CheckCheck, CircleCheck, Clock3, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { RAIL_BTN, RAIL_SIDE, railRow, RowTrash } from "@/shared/components/ai/day-groups";
import { AiBotIcon } from "@/shared/components/ai/chat";
import { Button } from "@/shared/components/ui/button";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Hint } from "@/shared/components/ui/hint";
import { type QaItem } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { waitLabel } from "@/features/telegram/lib/inbox";
import { clockLabel, timeLabel } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { accepted, answered, gist, latest, QA_DAYS, type QaDays, type Sent, sendable, sentCount, who } from "@/features/telegram/lib/qa";

export const PILL = "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium [&_svg]:size-3";

/** Settled ("Chốt"), answered, or how long the question has waited (`late`: yours, past the nudge threshold): text +
 *  icon, not colour alone. */
export function State({ i, now, late }: { i: QaItem; now: number; late?: boolean }) {
  const tx = useT();
  if (i.done) return <span className={cn(PILL, "bg-paper-3 text-ink-2")}><CircleCheck aria-hidden />{tx("Xong")}</span>;
  if (accepted(i)) return <span className={cn(PILL, "bg-ok-wash text-ok")}><CheckCheck aria-hidden />{tx("Đã chốt")}</span>;
  if (answered(i)) return <span className={cn(PILL, "bg-ok-wash text-ok")}><Check aria-hidden />{tx("Đã trả lời")}</span>;
  const w = waitLabel(i.question.date, now);
  return (
    <span className={cn(PILL, late ? "bg-signal-wash text-signal-2" : "bg-warn-wash text-warn")}>
<Clock3 aria-hidden />{late ? tx("Quá hạn") : tx("Chờ")} <span className="font-mono tabular-nums">{w.n}</span> {w.unit}
    </span>
  );
}

/** One question in the list: its text, then its state and the latest reply (or who asked), new replies at the end.
 *  `late`: signal mark, and the nudge / mute buttons in their own column on the right (siblings of the row button,
 *  never inside it, never over its text). */
export function Row({ i, now, on, news, late, sent, onOpen, onNudge, onMute, onDelete }: {
  i: QaItem; now: number; on: boolean; news: number; late: boolean; sent?: Sent; onOpen: () => void; onNudge: () => void; onMute: () => void; onDelete?: () => void;
}) {
  const tx = useT();
  const total = sendable(i).length, got = sent ? sentCount(i, sent) : 0;
  const end = accepted(i) ?? i.answers.at(-1); // a settled thread previews its answer
  const at = latest(i).date;
  return (
    <li className={railRow(on, late)}>
      <button type="button" data-qa={i.code} aria-current={on || undefined} onClick={onOpen} className={cn(RAIL_BTN, "grid grid-cols-1 gap-1")}>
        <span className="flex items-start gap-3">
          <span className={cn("line-clamp-2 min-w-0 flex-1 text-sm leading-snug text-ink", news ? "font-bold" : "font-medium")}>{gist(i.question)}</span>
          <time dateTime={at} title={timeLabel(at, true)} className="shrink-0 pt-px font-mono text-xs text-ink-3 tabular-nums">{clockLabel(at)}</time>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
          <State i={i} now={now} late={late} />
          <span className="min-w-0 flex-1 truncate">
            {end ? <><b className="font-medium text-ink-2">{who(end)}:</b> {gist(end)}</> : tx("{who} hỏi", { who: who(i.question) })}
          </span>
          {got > 0 && <span className={cn(PILL, got < total ? "bg-paper-3 text-ink-2" : "bg-hl-wash text-hl-2")}>
            <AiBotIcon aria-hidden />{got < total ? tx("Gửi AI {n}/{total}", { n: got, total }) : tx("Đã gửi AI")}
          </span>}
          {news > 0 && <span className={cn(PILL, "bg-hl text-hl-ink")}>{tx("{n} mới", { n: news })}</span>}
        </span>
      </button>
      {(late || onDelete) && (
        <span className={RAIL_SIDE}>
          {late && <>
            <Hint side="bottom" text={tx("Nhắc lại trong nhóm: soạn sẵn tin trả lời vào câu hỏi này (tag lại người được hỏi), Enter để gửi")}>
              <Button size="icon-xs" variant="ghost" className="text-signal-2 hover:bg-signal-wash" aria-label={tx("Nhắc lại {code}", { code: i.code })} onClick={onNudge}><BellRing /></Button>
            </Hint>
            <Hint side="bottom" text={tx("Bỏ qua: không nhắc câu này nữa")}>
              <Button size="icon-xs" variant="ghost" className="text-ink-3" aria-label={tx("Bỏ qua nhắc {code}", { code: i.code })} onClick={onMute}><BellOff /></Button>
            </Hint>
          </>}
          {onDelete && <RowTrash label={tx("Xóa {code} khỏi Q&A", { code: i.code })} hint={tx("Xóa khỏi Q&A trên dashboard (tin trên Telegram vẫn còn); hoàn tác ở thông báo")} onClick={onDelete} />}
        </span>
      )}
    </li>
  );
}

/** A failed read in a Q&A list: what went wrong, and a retry. */
export function LoadError({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  const tx = useT();
  return (
    <div role="alert" className="grid justify-items-start gap-2 p-4 text-sm text-error">
      {children}
      <Button size="xs" variant="outline" onClick={onRetry}><RotateCw /> {tx("Thử lại")}</Button>
    </div>
  );
}

/** How far back the Q&A lists read. */
export function DaysPicker({ days, onDays }: { days: QaDays; onDays: (d: QaDays) => void }) {
  const tx = useT();
  return (
    <Dropdown label={tx("Khoảng thời gian")} value={String(days)} onChange={(v) => onDays(Number(v) as QaDays)} className="w-[5.5rem]"
      options={QA_DAYS.map(([v, l]) => ({ value: String(v), label: tx(l) }))} />
  );
}

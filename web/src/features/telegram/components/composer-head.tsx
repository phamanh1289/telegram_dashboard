"use client";

import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useCallback } from "react";
import { Avatar } from "@/shared/components/avatar";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { DeepBadge, DeepPick } from "@/features/telegram/components/deep-think";
import { richText } from "@/features/telegram/components/message/rich-text";
import { MessageActions } from "@/features/telegram/components/message/row-actions";
import { telegramLink } from "@/features/telegram/lib/inbox";
import type { Message } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { timeLabel } from "@/shared/lib/time";

const nameOf = (m: Message) => m.sender_name ?? `#${m.message_id}`;

/** The reply panel's top row (composer.tsx): back, the next / previous open tag, who you answer, the actions on that
 *  tag, Mở Telegram. `held`: a send is in flight or its result is not known yet, so leaving waits for it. */
export function ReplyHead({ m, groupTitle, held, onBack, onStep, position, showContext, onToggleContext, onDone }: {
  m: Message; groupTitle?: string; held: boolean; onBack: () => void; onStep?: (dir: 1 | -1) => void; position?: [number, number];
  showContext: boolean; onToggleContext: () => void; onDone?: () => void;
}) {
  const t = useT();
  const link = telegramLink(m);
  const name = nameOf(m);
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 sm:px-5">
      <Hint side="bottom" text={t("Quay lại danh sách (Esc)")}>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onBack} disabled={held} aria-label={t("Quay lại danh sách (Esc)")}>
          <ArrowLeft />
        </Button>
      </Hint>
      {onStep && (
        <span className="flex items-center">
          <Hint side="bottom" text={t("Tag trước (k, Alt+↑)")}>
            <Button type="button" size="icon-sm" variant="ghost" disabled={held} onClick={() => onStep(-1)} aria-label={t("Tag trước")}><ChevronUp /></Button>
          </Hint>
          {position && <span className="px-0.5 font-mono text-xs text-ink-3 tabular-nums" aria-label={t("Tag {i} trên {n} đang chờ", { i: position[0], n: position[1] })}>{position[0]}/{position[1]}</span>}
          <Hint side="bottom" text={t("Tag tiếp theo (j, Alt+↓)")}>
            <Button type="button" size="icon-sm" variant="ghost" disabled={held} onClick={() => onStep(1)} aria-label={t("Tag tiếp theo")}><ChevronDown /></Button>
          </Hint>
        </span>
      )}
      <Avatar name={name} className="size-9 text-sm" />
      <div className="grid min-w-0 flex-1 leading-tight">
        <h2 className="truncate text-base font-bold">{name}</h2>
        <span className="flex min-w-0 gap-2 text-xs text-ink-3">
          {groupTitle && <span className="truncate">{groupTitle}</span>}
          <time dateTime={m.date} className="shrink-0 font-mono tabular-nums">{timeLabel(m.date)}</time>
        </span>
      </div>
      {/* Narrow: Mở Telegram stays on the name row, the actions take the next row whole. */}
      {!m.outgoing && (
        <div className="order-last flex w-full flex-wrap items-center gap-0.5 sm:order-none sm:w-auto">
          <MessageActions m={m} showContext={showContext} onDone={onDone} onToggleContext={onToggleContext} />
        </div>
      )}
      <Hint side="bottom" title={t("Mở Telegram")} text={link.exact ? t("Mở tin này trong app Telegram") : t("Mở nhóm trên Telegram Web (nhóm thường không có link tới từng tin)")}>
        <a href={link.app} {...(!link.exact && { target: "_blank", rel: "noreferrer" })} aria-label={t("Mở Telegram")}
          className="grid size-[30px] shrink-0 place-items-center rounded-[var(--radius-input)] text-ink-2 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
          <ExternalLink className="size-4" aria-hidden />
        </a>
      </Hint>
    </div>
  );
}

/** The tagged message as it reads in the group, highlighted; brought into view whenever it mounts (first paint, then
 *  again once the thread loads around it). */
export function TagCard({ m }: { m: Message }) {
  const t = useT();
  const toTag = useCallback((el: HTMLElement | null) => el?.scrollIntoView({ block: "start" }), []);
  const name = nameOf(m);
  return (
    <article ref={toTag} aria-label={t("Tin được tag")} className="my-1 grid scroll-mt-16 gap-1 rounded-[var(--radius-input)] border-l-[3px] border-hl bg-hl-wash py-2.5 pr-3 pl-3">
      <span className="flex min-h-6 items-center gap-2 text-xs font-medium text-hl-2">
        <span>{m.outgoing ? t("Bạn") : name}</span><span className="font-normal">{t("tag bạn")}</span>
        <DeepBadge m={m} />
        <DeepPick m={m} className="ml-auto" />
      </span>
      <p className="whitespace-pre-wrap break-words text-md leading-[1.6] text-ink">
        {m.text ? richText(m) : <i className="text-ink-3">{t("Tin không có chữ")}</i>}
      </p>
    </article>
  );
}

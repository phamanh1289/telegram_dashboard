"use client";

import { AlarmClock, Check, CheckCheck, CornerDownRight, PenLine, Pin, RotateCcw, Star, Users } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/shared/components/avatar";
import { Feat, FEATS } from "@/shared/components/ui/feat";
import { Hint } from "@/shared/components/ui/hint";
import { type Message, type Task } from "@/shared/lib/api";
import { msgKey, settled, useHasDraft, waitLabel } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { smooth } from "@/shared/lib/utils";
import { clockLabel, timeLabel } from "@/shared/lib/time";
import { readOverdueHours, useRole } from "@/shared/lib/prefs";
import { useRetest } from "@/features/youtrack/lib/yt";
import { cn } from "@/shared/lib/utils";
import { type Key, t, useT } from "@/shared/lib/i18n";
import { MEDIA, nameColor, richText } from "@/features/telegram/components/message/rich-text";
import { RowActions } from "@/features/telegram/components/message/row-actions";
import { snoozeHint } from "@/features/telegram/components/message/snooze-menu";
import { AnswersFor, byState, DeepFeat, SentBadge, TaskFeat } from "@/features/telegram/components/message/badges";
import { ContextPanel } from "@/features/telegram/components/message/context-panel";

export type MessageItemProps = {
  m: Message;
  head: boolean;
  clock?: boolean; // a day separator above already says the day: show just "16:12"
  now: number;
  focused?: boolean;
  groupTitle?: string; // shown in the cross-group inbox
  isReplyTarget: boolean;
  tasks?: Task[];
  onReply: (m: Message) => void;
  live?: boolean; // read live from Telegram, not stored: no tag actions, no reply panel
  liveReply?: boolean; // live, yet a click still picks it to reply to (Q&A threads)
  fresh?: boolean; // arrived since you last looked (Q&A threads): a "Mới" pill
  bare?: boolean; // Q&A thread: no ID, "trả lời #…" or #QA badge (the order is the chain, the thread names its code)
  extra?: React.ReactNode; // a page's own control before the row actions (Q&A: "Chốt" this answer)
  picked?: boolean; // in the to-do list's multi-selection
  onPick?: (m: Message) => void; // Shift+click: add to / drop from the selection
};

/** Memoised: lists re-render on every count / SSE change, a row only when its own props change. */
export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { m } = props;
  const t = useT();
  if (m.deleted) {
    return (
      <li data-testid="message" data-id={m.message_id} data-key={msgKey(m)} className="py-2 pr-4 pl-[calc(1rem+2.75rem)] text-xs text-ink-3 @xl:pl-[calc(1.25rem+2.75rem)]">
        {t("Tin #{id} đã bị xóa.", { id: m.message_id })}
      </li>
    );
  }
  return <MessageRow {...props} />;
});

function MessageRow({
  m, head, clock, now, focused, groupTitle, isReplyTarget, tasks, onReply, live, liveReply, fresh, bare, extra, picked, onPick,
}: MessageItemProps) {
  const t = useT();
  const [showContext, setShowContext] = useState(false);
  const name = m.outgoing ? t("Bạn") : (m.sender_name ?? t("Không rõ"));
  const done = m.handled;
  const snoozed = !done && !!m.snoozed_until && new Date(m.snoozed_until).getTime() > now;
  const selected = !!focused || isReplyTarget;
  const quiet = !m.outgoing && (done || snoozed);
  const opens = !live || !!liveReply; // a click / Enter opens the reply panel
  const shown = head || !!groupTitle; // the sender's avatar and name open a run of their messages
  const row = useRef<HTMLLIElement>(null);
  useRowFocus(row, !!focused, opens);
  const open = rowOpen(m, opens, onReply, onPick);

  return (
    <li
      ref={row}
      data-testid="message"
      data-id={m.message_id}
      data-key={msgKey(m)}
      data-selected={selected}
      tabIndex={opens ? 0 : undefined}
      aria-current={isReplyTarget ? "true" : undefined}
      className={cn(
        "group/row relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 px-4 py-3 animate-in fade-in-0 transition-colors duration-(--dur-short) hover:bg-paper-2 focus-visible:-outline-offset-2 @xl:px-5",
        selected && "bg-linear-to-r from-hl-wash to-hl-wash/35 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-hl",
        picked && "bg-hl-wash/60 ring-2 ring-inset ring-hl",
        !head && !groupTitle && "pt-1.5",
        opens && "cursor-pointer",
      )}
      onKeyDown={open.onKeyDown}
      onClick={open.onClick}
    >
      {/* Gutter: the sender's avatar opens a run of their messages. */}
      <div className="pt-0.5">
        {picked ? <span className="grid size-8 place-items-center rounded-full bg-hl text-hl-ink"><Check className="size-4" role="img" aria-label={t("Đã chọn")} /></span>
          : shown && <Avatar name={name} className="size-8 text-xs" />}
      </div>

      <div className="min-w-0">
        {/* Header, beside the avatar. Line 1: who, in which group, the tag's state. Line 2: when, and the message it
            answers. How long it has waited sits right after the group; the right strip holds the hover actions. Badges
            (retest, draft, sessions, #QA) sit right after the time; the strip's # button copies the ID. */}
        {/* Wraps: on a narrow row (phone, Q&A card, the split list) the strip drops below the header instead of squeezing the name. */}
        <div className="mb-1 flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <div className="grid min-w-0 flex-1 basis-44 gap-0.5">
            <RowWho m={m} name={name} shown={shown} groupTitle={groupTitle} fresh={fresh} now={now} live={live} snoozed={snoozed} />
            <RowWhen m={m} clock={clock} tasks={tasks} live={live} bare={bare} />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs leading-5">
            {extra}
            <RowActions m={m} tag={!m.outgoing && !live} liveSnooze={!!live && !liveReply && !m.outgoing} showContext={showContext} onToggleContext={() => setShowContext((v) => !v)} />
          </div>
        </div>
        <RowMedia m={m} />
        {m.text && <MessageText m={m} dim={quiet || m.outgoing} />}
        {/* portalled, but React events still bubble to the row: a click in the dialog must not open the reply panel */}
        {showContext && <ContextPanel m={m} reveal />}
      </div>
    </li>
  );
}

/** The j/k cursor is real focus (screen readers follow it), unless you are typing or in a menu / dialog. */
function useRowFocus(row: React.RefObject<HTMLLIElement | null>, focused: boolean, opens: boolean) {
  useEffect(() => {
    if (focused && opens && !document.activeElement?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]")) row.current?.focus({ preventScroll: true });
  }, [row, focused, opens]);
}

/** A row opens the reply panel on click / Enter; Shift+click picks it. */
function rowOpen(m: Message, opens: boolean, onReply: (m: Message) => void, onPick?: (m: Message) => void) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLLIElement>) => {
    // Enter on the row itself (Tab or j/k focus); preventDefault keeps the list's own Enter from replying twice.
    if (e.key !== "Enter" || e.target !== e.currentTarget || !opens) return;
    e.preventDefault();
    onReply(m);
  };
  const onClick = (e: React.MouseEvent<HTMLLIElement>) => {
    // Click anywhere on the row opens the reply panel (not on links/buttons or while selecting text).
    if ((e.target as HTMLElement).closest("a,button,select,input,label")) return; // a control's own click
    const sel = window.getSelection();
    if (e.shiftKey && onPick) {
      sel?.removeAllRanges(); // Shift+click also extends a text selection
      return onPick(m);
    }
    const selecting = !!sel?.toString() && !!sel.anchorNode && e.currentTarget.contains(sel.anchorNode);
    if (!opens || selecting) return;
    onReply(m);
  };
  return { onKeyDown, onClick };
}

/** Header line 1: who, in which group, how long it has waited, the tag's state. */
function RowWho({ m, name, shown, groupTitle, fresh, now, live, snoozed }: {
  m: Message; name: string; shown: boolean; groupTitle?: string; fresh?: boolean; now: number; live?: boolean; snoozed: boolean;
}) {
  const t = useT();
  const done = m.handled;
  const priority = !!m.priority && !m.outgoing && !done; // a sender you put first (Cài đặt › Telegram)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
      {shown && (
        <span className={cn("min-w-0 truncate text-sm font-bold", m.outgoing && "text-ink-2")}
          style={m.outgoing ? undefined : { color: nameColor(name) }}>{name}</span>
      )}
      {fresh && <span className={cn(PILL, "bg-hl text-hl-ink")}>{t("Mới")}</span>}
      {priority && (
        <Hint side="bottom" text={t("Người gửi bạn đặt ưu tiên: tag của họ lên đầu danh sách và quá hạn sớm hơn.")}>
          <span className={cn(PILL, "bg-signal-wash text-signal-2")}><Star className="size-3 fill-current" aria-hidden />{t("Ưu tiên")}</span>
        </Hint>
      )}
      {m.pinned && shown && <Pin className="size-3.5 shrink-0 fill-current text-ink-2" role="img" aria-label={t("Đã ghim")} />}
      {groupTitle && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-ink-3">
          <Users className="size-3 shrink-0" aria-hidden /><span className="truncate">{groupTitle}</span>
        </span>
      )}
      {!live && !m.outgoing && !done && !snoozed && <WaitPill m={m} now={now} />}
      {!m.outgoing && (done ? <DonePill m={m} /> : snoozed && <SnoozedPill m={m} />)}
    </div>
  );
}

/** Beside the group: how long it has waited; overdue reads as a signal pill (shape + colour, not colour alone). */
function WaitPill({ m, now }: { m: Message; now: number }) {
  const t = useT();
  const wait = waitLabel(m.date, now, !!m.priority);
  return (
    <Hint side="bottom" text={wait.overdue ? t("Quá hạn: đã chờ hơn {n} giờ, chưa xử lý", { n: readOverdueHours() }) : t("Đã chờ {span}, chưa xử lý", { span: `${wait.n} ${wait.unit}` })}>
      <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-xs", wait.overdue ? "bg-signal-wash font-medium text-signal-2" : "text-ink-3")}>
        <span className="sr-only">{wait.overdue ? t("Quá hạn, đã chờ") : t("Đã chờ")} </span>
        <span className="font-mono tabular-nums">{wait.n}</span>{wait.unit}
      </span>
    </Hint>
  );
}

function DonePill({ m }: { m: Message }) {
  const t = useT();
  return (
    <Hint side="bottom" title={m.handled_at ? t("Xong lúc {time}", { time: timeLabel(m.handled_at, true) }) : t("Đã xử lý")} text={t(DONE_BY[m.handled_by])}>
      <span className={cn(PILL, "bg-ok-wash text-ok")}><CheckCheck className="size-3" aria-hidden />{t("Đã xử lý")}</span>
    </Hint>
  );
}

/** An event snooze (a reply, a ticket done) shows what it waits for, not its backstop time. */
function SnoozedPill({ m }: { m: Message }) {
  const t = useT();
  return (
    <Hint side="bottom" text={m.snooze_on ? snoozeHint(m) : t("Đang hoãn: nhắc lại lúc {time}", { time: timeLabel(m.snoozed_until!, true) })}>
      <span className={cn(PILL, "bg-info-wash text-info")}>
        <AlarmClock className="size-3" aria-hidden />
        {m.snooze_on === "reply" ? t("Tới khi có người trả lời") : m.snooze_on ? t("Tới khi {id} xong", { id: m.snooze_on.slice(7) })
          : <>{t("Nhắc")} <span className="font-mono tabular-nums">{timeLabel(m.snoozed_until!)}</span></>}
      </span>
    </Hint>
  );
}

/** Header line 2: when, the message it answers, then what has happened to it (sessions, Đối chiếu BE, sent, Q&A, draft,
 *  retest), most pressing first (your turn > AI working > links), each spelled out; AI Agent sessions one mark per state. */
function RowWhen({ m, clock, tasks, live, bare }: { m: Message; clock?: boolean; tasks?: Task[]; live?: boolean; bare?: boolean }) {
  const t = useT();
  const hasDraft = useHasDraft(m);
  const retest = useRetest(m.text, useRole() === "qa" && !m.outgoing && !m.handled);
  const agent = tasks?.filter((tk) => tk.kind !== "deep") ?? []; // Đối chiếu BE: DeepFeat (rows without `tasks` too)
  return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-ink-3">
        <time dateTime={m.date} title={timeLabel(m.date, true)} className="whitespace-nowrap font-mono tabular-nums">
          {clock ? clockLabel(m.date) : timeLabel(m.date)}
        </time>
        {m.edit_date && <span>{t("đã sửa")}</span>}
        {m.reply_to_id && !bare && (
          <Hint side="bottom" text={t("Tới tin gốc trong danh sách")}>
            <button type="button" aria-label={t("Tới tin gốc #{id}", { id: m.reply_to_id })} onClick={(e) => jumpTo(e.currentTarget, m.reply_to_id!)}
              className="inline-flex items-center gap-1 rounded-sm hover:text-hl-2">
              <CornerDownRight className="size-3" aria-hidden />{t("tin gốc")}
            </button>
          </Hint>
        )}
        <span className={FEATS}>
          {byState(agent.filter(settled)).map((g) => <TaskFeat key={g[0].id} tk={g[0]} more={g.length - 1} />)}
          <DeepFeat m={m} settled />
          {retest.length > 0 && <Feat icon={<RotateCcw />} label={t("Cần retest")} tone="bg-warn-wash text-warn"
            hint={t("Bạn là QC của {ids} và tin này báo đã fix / có build: cần test lại", { ids: retest.join(", ") })} />}
          {byState(agent.filter((tk) => !settled(tk))).map((g) => <TaskFeat key={g[0].id} tk={g[0]} more={g.length - 1} />)}
          <DeepFeat m={m} settled={false} />
          <SentBadge m={m} shown={tasks} />
          <AnswersFor m={m} qa={!bare} />
          {hasDraft && !live && <Feat icon={<PenLine />} label={t("Nháp")} tone="bg-hl-wash text-hl-2" hint={t("Có nháp trả lời chưa gửi (lưu trên máy này)")} />}
        </span>
      </div>
  );
}

/** A photo (falls back to its label when it can't load), or what kind of media it is. */
function RowMedia({ m }: { m: Message }) {
  const t = useT();
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = `/api/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/photo`;
  return m.media_kind === "photo" && !photoFailed ? (
    <a href={photo} target="_blank" rel="noreferrer" className="my-1.5 block w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element -- local API image, static export */}
      <img src={photo} alt={t("Ảnh trong tin")} loading="lazy" onError={() => setPhotoFailed(true)}
        className="max-h-64 rounded-md border border-rule object-contain" />
    </a>
  ) : (
    m.media_kind && <p className="text-xs text-ink-3">{t("[{kind}, chưa tải]", { kind: t(MEDIA[m.media_kind] ?? "Tệp đính kèm") })}</p>
  );
}

/** Why a tag is done (the "Đã xử lý" pill's hint); only "me" left a reaction on Telegram. */
const DONE_BY: Record<Message["handled_by"], Key> = {
  me: "Bạn bấm Xong, đã thả reaction trên Telegram.",
  quiet: "Bạn bấm Xong không thả reaction (Shift+Xong / Shift+x).",
  reply: "Bạn đã trả lời tin này trên Telegram (từ máy nào cũng tính): tự xong, không thả reaction.",
  dashboard: "Bạn gửi trả lời từ dashboard: tự xong, không thả reaction.",
  all: "Đánh dấu bằng \"Xong tất cả\" của nhóm: không thả reaction để tránh spam Telegram.",
  rule: "Rule tự bỏ qua (người gửi / từ khoá trong Cài đặt Telegram): không thả reaction.",
  "": "Đánh dấu trước khi app bắt đầu ghi lại cách xong.",
};

/** Status / badge pill in the row header. */
const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs leading-5 font-medium";

/** Like Telegram's reply header: scroll to the quoted message when it is in this list and flash it. */
function jumpTo(from: Element, id: string) {
  if (!revealMessage(from.closest("ol"), id)) toast({ text: t("Tin #{id} không có trong danh sách (chỉ lưu tin tag/reply bạn)", { id }) });
}

/** Center message `id` under `root` (a long one from its top) and flash it; false when it is not rendered there. */
export function revealMessage(root: ParentNode | null | undefined, id: string) {
  const el = root?.querySelector<HTMLElement>(`[data-testid="message"][data-id="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: el.offsetHeight > innerHeight / 2 ? "start" : "center", behavior: smooth() });
  el.animate([{ backgroundColor: "var(--color-hl-wash)" }, { backgroundColor: "transparent" }], { duration: 1600, easing: "ease-out" });
  return true;
}

function MessageText({ m, dim }: { m: Message; dim: boolean }) {
  const body = useMemo(() => richText(m), [m]);
  return (
    <p className={cn("whitespace-pre-wrap break-words text-md leading-[1.55]", dim ? "text-ink-2" : "text-ink")}>
      {body}
    </p>
  );
}

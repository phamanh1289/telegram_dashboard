"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, CheckCheck, ClipboardList, ExternalLink, MessagesSquare, Pin, Reply, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/chat-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, type Message, type RuleAdded, type Task } from "@/lib/api";
import { markHandled, pin, telegramLink, waitLabel } from "@/lib/inbox";
import { cn } from "@/lib/utils";

const MEDIA: Record<string, string> = {
  photo: "Ảnh", video: "Video", voice: "Tin thoại", audio: "Âm thanh", sticker: "Sticker",
  gif: "GIF", video_note: "Video tròn", document: "Tệp",
};

function timeLabel(date: string) {
  const d = new Date(date);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${time}`;
}

// Telegram hides URLs behind text (text_url entities); offsets are UTF-16, like JS strings.
function withLinks({ text, links = [] }: Message) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const l of [...links].sort((a, b) => a.offset - b.offset)) {
    if (l.offset < at) continue;
    out.push(text.slice(at, l.offset));
    out.push(
      <a key={l.offset} href={l.url} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
        {text.slice(l.offset, l.offset + l.length)}
      </a>,
    );
    at = l.offset + l.length;
  }
  out.push(text.slice(at));
  return out;
}

export type MessageItemProps = {
  m: Message;
  head: boolean;
  now: number;
  focused?: boolean;
  groupTitle?: string; // shown in the cross-group inbox
  isReplyTarget: boolean;
  checked?: boolean;
  selectMode?: boolean;
  canCheck?: boolean;
  tasks?: Task[];
  onReply: (m: Message) => void;
  onToggle?: (m: Message) => void;
  onUseText: (m: Message, text: string) => void; // put a task result into the composer
};

export function MessageItem(props: MessageItemProps) {
  const { m } = props;
  if (m.deleted) {
    return (
      <li data-testid="message" data-id={m.message_id} className="text-center text-xs italic text-muted-foreground">
        Tin #{m.message_id} đã bị xóa.
      </li>
    );
  }
  return <MessageRow {...props} />;
}

function MessageRow({
  m, head, now, focused, groupTitle, isReplyTarget, checked, selectMode, canCheck, tasks, onReply, onToggle, onUseText,
}: MessageItemProps) {
  const [showContext, setShowContext] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = m.outgoing ? "Bạn" : (m.sender_name ?? "Không rõ");
  const done = m.handled;
  const snoozed = !done && m.snoozed_until && new Date(m.snoozed_until).getTime() > now;
  const wait = !m.outgoing && !done && !snoozed ? waitLabel(m.date, now) : null;
  const link = telegramLink(m);
  const photo = `/api/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/photo`;

  return (
    <li
      data-testid="message"
      data-id={m.message_id}
      className={cn(
        "group flex items-end gap-2 rounded-xl animate-in fade-in-0 slide-in-from-bottom-1 duration-200",
        m.outgoing && "flex-row-reverse",
        focused && "bg-primary/5 ring-1 ring-primary/30",
      )}
    >
      {selectMode && onToggle && (
        <Checkbox
          aria-label={`Chọn tin #${m.message_id} cho AI`}
          checked={!!checked}
          disabled={!checked && !canCheck}
          onCheckedChange={() => onToggle(m)}
          className="mb-2"
        />
      )}
      {!m.outgoing && (head ? <Avatar name={name} className="size-8 text-xs" /> : <span className="size-8 shrink-0" />)}
      <div
        className={cn(
          "max-w-[min(32rem,80%)] rounded-2xl px-3 py-2 text-sm shadow-xs",
          m.outgoing ? "rounded-br-sm bg-primary/15" : "rounded-bl-sm bg-card",
          !m.outgoing && !done && !snoozed && "border-l-2 border-amber-500",
          m.pinned && "ring-1 ring-amber-500/60",
          !m.outgoing && (done || snoozed) && "opacity-60",
          isReplyTarget && "ring-2 ring-primary/50",
          !selectMode && "cursor-pointer",
        )}
        onClick={(e) => {
          // Click anywhere on the bubble opens the reply panel (not on links/buttons or while selecting text).
          const sel = window.getSelection();
          const selecting = !!sel?.toString() && !!sel.anchorNode && e.currentTarget.contains(sel.anchorNode);
          if (selectMode || selecting || (e.target as HTMLElement).closest("a,button,select,input,label")) return;
          onReply(m);
        }}
      >
        {groupTitle && <p className="mb-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">{groupTitle}</p>}
        {!m.outgoing && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-primary">
            {name}
            {m.pinned && <Pin className="size-3 fill-amber-500 text-amber-500" aria-label="Đã ghim" />}
            {done ? (
              <span className="rounded-full bg-emerald-500/15 px-1.5 font-medium text-emerald-600 dark:text-emerald-400">✓ Đã xử lý</span>
            ) : snoozed ? (
              <span className="rounded-full bg-sky-500/15 px-1.5 font-medium text-sky-600 dark:text-sky-400">
                ⏰ nhắc lúc {timeLabel(m.snoozed_until!)}
              </span>
            ) : (
              <span className={cn("rounded-full px-1.5 font-medium", wait?.overdue ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400")}>
                Chưa xử lý · {wait?.text}
              </span>
            )}
          </p>
        )}
        {m.reply_to_id && <p className="text-xs text-muted-foreground">↪ trả lời #{m.reply_to_id}</p>}
        {m.media_kind === "photo" && !photoFailed ? (
          <a href={photo} target="_blank" rel="noreferrer" className="my-1 block">
            {/* eslint-disable-next-line @next/next/no-img-element -- local API image, static export */}
            <img src={photo} alt="Ảnh trong tin" loading="lazy" onError={() => setPhotoFailed(true)}
              className="max-h-64 rounded-lg border object-contain" />
          </a>
        ) : (
          m.media_kind && <p className="text-xs italic text-muted-foreground">[{MEDIA[m.media_kind] ?? "Tệp đính kèm"} — chưa tải]</p>
        )}
        {m.text && <p className="whitespace-pre-wrap break-words">{withLinks(m)}</p>}
        {tasks?.map((t) => (
          <div key={t.id} className="mt-1.5 rounded-md border border-dashed p-1.5 text-xs">
            <p className="flex items-center gap-1 font-medium">
              <ClipboardList className="size-3.5" /> Task {t.result ? "đã có kết quả" : "đang làm…"}
              <span className="font-normal text-muted-foreground">· {t.project.split("/").pop()}</span>
            </p>
            {t.result && (
              <>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-muted-foreground">{t.result}</p>
                <Button size="xs" variant="link" className="h-auto px-0" onClick={() => onUseText(m, t.result!)}>
                  Dùng kết quả làm nháp trả lời
                </Button>
              </>
            )}
          </div>
        ))}
        {showContext && <ContextPanel m={m} />}
        <p className="mt-0.5 flex items-center justify-end gap-2 text-[0.7rem] text-muted-foreground">
          {link && (
            <a href={link.app} title="Mở tin này trong app Telegram (Alt+bấm: mở bản web)"
              onClick={(e) => {
                if (e.altKey) {
                  e.preventDefault();
                  window.open(link.web, "_blank", "noreferrer");
                }
              }}
              className="inline-flex items-center gap-0.5 hover:text-foreground">
              <ExternalLink className="size-3" /> Mở Telegram
            </a>
          )}
          <span>
            {m.edit_date && "đã sửa · "}
            <time dateTime={m.date} title={new Date(m.date).toLocaleString()}>{timeLabel(m.date)}</time>
          </span>
        </p>
      </div>
      <span className="mb-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => onReply(m)} title="Trả lời (r)">
          <Reply /> Trả lời
        </Button>
        {!m.outgoing && <MessageActions m={m} showContext={showContext} onToggleContext={() => setShowContext((v) => !v)} />}
      </span>
    </li>
  );
}

/** Xong / ghim / ngữ cảnh / bỏ qua người gửi: shared by the hover row and the reply panel. */
export function MessageActions({
  m, showContext, onToggleContext,
}: { m: Message; showContext: boolean; onToggleContext: () => void }) {
  // Local overrides keep the buttons right when `m` is a stale snapshot (reply panel).
  const [over, setOver] = useState<{ handled?: boolean; pinned?: boolean }>({});
  const done = over.handled ?? m.handled;
  const pinned = over.pinned ?? m.pinned;
  // Other changes come back through SSE, which refreshes lists and counts.
  const mark = useMutation({
    mutationFn: (handled: boolean) => markHandled(m, handled),
    onSuccess: (_, handled) => setOver((o) => ({ ...o, handled })),
  });
  const togglePin = useMutation({
    mutationFn: () => pin(m, !pinned),
    onSuccess: () => setOver((o) => ({ ...o, pinned: !pinned })),
  });
  const ignore = useMutation({
    mutationFn: () =>
      api<RuleAdded>("/rules", { method: "POST", json: { kind: "sender", value: m.sender_id, label: m.sender_name ?? "" } }),
  });
  return (
    <>
      <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground" disabled={mark.isPending}
        aria-label={done ? "Mở lại" : "Xong"}
        title={done ? "Mở lại: đánh dấu chưa xử lý (x)" : "Xong: không cần trả lời / đã xử lý nơi khác (x)"}
        onClick={() => mark.mutate(!done)}>
        {done ? <RotateCcw /> : <CheckCheck />}
      </Button>
      {(!done || pinned) && (
        <Button type="button" size="icon-xs" variant="ghost" className={cn("text-muted-foreground", pinned && "text-amber-500")}
          disabled={togglePin.isPending} aria-label={pinned ? "Bỏ ghim" : "Ghim"} aria-pressed={pinned}
          title={pinned ? "Bỏ ghim" : "Ghim lên đầu danh sách"} onClick={() => togglePin.mutate()}>
          <Pin className={cn(pinned && "fill-current")} />
        </Button>
      )}
      <Button type="button" size="icon-xs" variant="ghost" className={cn("text-muted-foreground", showContext && "bg-muted text-foreground")}
        aria-label="Ngữ cảnh" aria-expanded={showContext} title="Xem các tin trước/sau trong nhóm" onClick={onToggleContext}>
        <MessagesSquare />
      </Button>
      {m.sender_id && (
        <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground" disabled={ignore.isPending || ignore.isSuccess}
          aria-label="Luôn bỏ qua người gửi" title={`Luôn bỏ qua tin từ ${m.sender_name ?? "người này"}`}
          onClick={() => confirm(`Luôn bỏ qua tin từ ${m.sender_name ?? "người này"}?`) && ignore.mutate()}>
          <Ban />
        </Button>
      )}
    </>
  );
}

/** Messages around a tag, read live from Telegram (not stored). */
export function ContextPanel({ m }: { m: Message }) {
  const q = useQuery({
    queryKey: ["context", m.chat_id, m.message_id],
    queryFn: ({ signal }) =>
      api<Message[]>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/context`, { signal }),
    staleTime: 60_000,
  });
  return (
    <div className="mt-2 grid max-h-72 gap-1 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs">
      {q.isPending && <p className="animate-pulse text-muted-foreground">Đang lấy tin xung quanh từ Telegram…</p>}
      {q.isError && <p className="text-destructive">Không lấy được (cần đang kết nối Telegram).</p>}
      {q.data?.map((c) => (
        <p key={c.message_id} className={cn("whitespace-pre-wrap break-words", c.message_id === m.message_id ? "rounded bg-amber-500/15 px-1 font-medium" : "text-muted-foreground")}>
          <span className="font-semibold text-foreground">{c.outgoing ? "Bạn" : (c.sender_name ?? "?")}:</span>{" "}
          {c.text || (c.media_kind ? `[${MEDIA[c.media_kind] ?? "tệp"}]` : "")}
        </p>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatMessages } from "@/hooks/use-chat-messages";
import { ApiError, type Message } from "@/lib/api";
import { cn } from "@/lib/utils";

const MEDIA: Record<string, string> = {
  photo: "Ảnh", video: "Video", voice: "Tin thoại", audio: "Âm thanh", sticker: "Sticker",
  gif: "GIF", video_note: "Video tròn", document: "Tệp",
};

export const MAX_AI_MESSAGES = 30;

export function MessageList({
  chatId,
  replyTo,
  onReply,
  selected,
  onToggle,
}: {
  chatId: string;
  replyTo: string | null;
  onReply: (m: Message) => void;
  selected: Map<string, Message>;
  onToggle: (m: Message) => void;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useChatMessages(chatId, q);
  const items = useMemo(
    () => (query.data ? [...query.data.pages].reverse().flatMap((p) => p.items) : []),
    [query.data],
  );

  // Scroll: stick to bottom only when already there; keep position when older pages load.
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const anchor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
    } else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const loadOlder = () => {
    if (box.current) anchor.current = box.current.scrollHeight - box.current.scrollTop;
    void query.fetchNextPage();
  };

  const error = query.error instanceof ApiError ? query.error.code : query.error ? "error" : null;

  return (
    <section aria-label="Tin nhắn" className="flex min-h-0 flex-col">
      <div className="border-b p-2">
        <Input
          type="search"
          aria-label="Tìm trong nhóm"
          placeholder="Tìm trong tin đã lưu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={200}
        />
      </div>
      <div
        ref={box}
        data-testid="timeline"
        className="min-h-0 flex-1 overflow-y-auto p-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {query.hasNextPage && (
          <div className="mb-2 text-center">
            <Button size="xs" variant="outline" onClick={loadOlder} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Đang tải…" : "Tải tin cũ hơn"}
            </Button>
          </div>
        )}
        {!q && !query.hasNextPage && query.isSuccess && (
          <p className="mb-2 text-center text-xs text-muted-foreground">
            Lịch sử khởi tạo giới hạn 50 tin; không phải archive đầy đủ.
          </p>
        )}
        {query.isPending && <Skeleton className="h-16 w-full" />}
        {error === "not_tracking" && <p className="text-sm text-muted-foreground">Nhóm không còn được theo dõi.</p>}
        {error && error !== "not_tracking" && <p className="text-sm text-destructive">Không tải được tin nhắn.</p>}
        {query.isSuccess && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{q ? "Không có kết quả." : "Chưa có tin nào."}</p>
        )}
        <ol className="grid gap-2">
          {items.map((m) => (
            <MessageItem
              key={m.message_id}
              m={m}
              isReplyTarget={replyTo === m.message_id}
              checked={selected.has(m.message_id)}
              canCheck={selected.size < MAX_AI_MESSAGES}
              onReply={onReply}
              onToggle={onToggle}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

function MessageItem({
  m, isReplyTarget, checked, canCheck, onReply, onToggle,
}: {
  m: Message;
  isReplyTarget: boolean;
  checked: boolean;
  canCheck: boolean;
  onReply: (m: Message) => void;
  onToggle: (m: Message) => void;
}) {
  if (m.deleted) {
    return (
      <li data-testid="message" data-id={m.message_id} className="text-xs italic text-muted-foreground">
        Tin #{m.message_id} đã bị xóa.
      </li>
    );
  }
  return (
    <li
      data-testid="message"
      data-id={m.message_id}
      className={cn(
        "group rounded-lg border p-2 text-sm transition-colors hover:bg-muted/40",
        m.outgoing && "ml-8 bg-muted/30",
        isReplyTarget && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          aria-label={`Chọn tin #${m.message_id} cho AI`}
          checked={checked}
          disabled={!checked && !canCheck}
          onCheckedChange={() => onToggle(m)}
        />
        <span className="font-medium text-foreground">{m.outgoing ? "Bạn" : (m.sender_name ?? "Không rõ")}</span>
        <time dateTime={m.date}>{new Date(m.date).toLocaleString()}</time>
        {m.edit_date && <span>(đã sửa)</span>}
        {m.reply_to_id && <span>↪ #{m.reply_to_id}</span>}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onReply(m)}>
          Trả lời
        </Button>
      </div>
      {m.media_kind && (
        <p className="mt-1 text-xs text-muted-foreground">[{MEDIA[m.media_kind] ?? "Tệp đính kèm"} — chưa tải]</p>
      )}
      {m.text && <p className="mt-1 whitespace-pre-wrap break-words">{m.text}</p>}
    </li>
  );
}

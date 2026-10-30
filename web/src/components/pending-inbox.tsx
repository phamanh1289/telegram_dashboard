"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Inbox, Pin } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { MessageItem } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Message, type PendingItem } from "@/lib/api";
import { fold, useListShortcuts, useNow, useTasks } from "@/lib/inbox";

/** Every pending tag across groups, pinned first then oldest; or (pinned) the pinned archive. */
export function PendingInbox({
  pinned = false,
  range,
  search,
  replyTo,
  onReply,
  onBack,
  onUseText,
}: {
  pinned?: boolean;
  range: string;
  search: string;
  replyTo: string | null;
  onReply: (m: Message) => void;
  onBack: () => void;
  onUseText: (m: Message, text: string) => void;
}) {
  const q = useQuery({
    queryKey: pinned ? ["pending", "pinned"] : ["pending", range],
    queryFn: ({ signal }) =>
      api<PendingItem[]>(pinned ? "/pinned" : `/pending${range ? `?${range}` : ""}`, { signal }),
    refetchInterval: 60_000, // snoozed tags come back on their own
  });
  const now = useNow();
  // Oldest first, so open at the bottom (newest tags) once; later refreshes keep the scroll position.
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (pinned || !q.isSuccess || scrolled.current) return;
    scrolled.current = true;
    const down = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    down();
    const t = setTimeout(down, 500); // photos load late and grow the list
    return () => clearTimeout(t);
  }, [pinned, q.isSuccess]);
  const tasks = useTasks();
  // Name search: sender, group or text, ignoring case and Vietnamese accents.
  const rows = useMemo(() => {
    const needle = fold(search.trim());
    const all = q.data ?? [];
    return needle
      ? all.filter((p) => fold(`${p.message.sender_name ?? ""} ${p.chat_title} ${p.message.text}`).includes(needle))
      : all;
  }, [q.data, search]);
  const items = useMemo(() => rows.map((p) => p.message), [rows]);
  const focused = useListShortcuts(items, onReply);

  return (
    <section aria-label="Việc cần xử lý" className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại">
          <ArrowLeft />
        </Button>
        {pinned ? <Pin className="size-4 text-primary" aria-hidden /> : <Inbox className="size-4 text-primary" aria-hidden />}
        <span className="truncate text-sm font-medium">{pinned ? "Tag đã ghim" : "Việc cần xử lý · mọi nhóm"}{q.data && <span className="ml-1 font-normal text-muted-foreground">({items.length})</span>}</span>
        <span className="ml-auto hidden truncate text-xs text-muted-foreground xl:inline">
          Phím tắt: j/k chọn · r trả lời · x xong · a nhờ AI · Esc thoát
        </span>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {q.isPending && <Skeleton className="h-16 w-full" />}
        {q.isError && <p className="text-sm text-destructive">Không tải được danh sách.</p>}
        {q.isSuccess && items.length === 0 && (
          <p className="grid place-items-center py-16 text-sm text-muted-foreground">
            {search.trim() ? `Không có tin chờ nào khớp “${search.trim()}”.` : pinned ? "Chưa ghim tag nào." : "🎉 Không còn tin tag nào cần xử lý."}
          </p>
        )}
        <ol className="grid gap-2">
          {rows.map(({ chat_title, message: m }) => (
            <MessageItem
              key={`${m.chat_id}:${m.message_id}`}
              m={m}
              head
              now={now}
              groupTitle={chat_title}
              focused={focused === m.message_id}
              isReplyTarget={replyTo === m.message_id}
              tasks={tasks.get(`${m.chat_id}:${m.message_id}`)}
              onReply={onReply}
              onUseText={onUseText}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

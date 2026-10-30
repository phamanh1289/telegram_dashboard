"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, Pin, RotateCw } from "lucide-react";
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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-paper px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại">
          <ArrowLeft />
        </Button>
        <p className="min-w-0 truncate text-[0.8125rem] text-ink-2">
          {pinned ? "Tag đã ghim" : "Việc cần xử lý trong mọi nhóm"}
          {q.data && <span className="ml-2 font-mono text-ink-3 tabular-nums">{items.length}</span>}
        </p>
        <p aria-label="Phím tắt" className="ml-auto hidden shrink-0 items-center gap-3 text-xs text-ink-3 xl:flex">
          <span><Kbd>j</Kbd>/<Kbd>k</Kbd> chọn</span>
          <span><Kbd>r</Kbd> trả lời</span>
          <span><Kbd>x</Kbd> xong</span>
          <span><Kbd>a</Kbd> nhờ AI</span>
          <span><Kbd>Esc</Kbd> thoát</span>
        </p>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-cotton">
        {q.isPending && <RowsSkeleton />}
        {q.isError && (
          <div role="alert" className="grid justify-items-start gap-2 px-5 py-6 text-sm">
            <p className="text-error">Không tải được danh sách.</p>
            <Button size="sm" variant="outline" aria-busy={q.isFetching} disabled={q.isFetching} onClick={() => void q.refetch()}>
              <RotateCw /> Thử lại
            </Button>
          </div>
        )}
        {q.isSuccess && items.length === 0 && (
          <div className="grid justify-items-center gap-2 px-6 py-20 text-center text-sm text-ink-2">
            {search.trim() ? (
              <p>Không có tin chờ nào khớp “{search.trim()}”.</p>
            ) : pinned ? (
              <>
                <Pin className="size-5 text-ink-3" aria-hidden />
                <p>Chưa ghim tag nào.</p>
                <p className="text-xs text-ink-3">Bấm biểu tượng ghim trên một tin để giữ nó ở đây.</p>
              </>
            ) : (
              <>
                <CheckCheck className="size-5 text-ok" aria-hidden />
                <p>Không còn tin tag nào cần xử lý.</p>
              </>
            )}
          </div>
        )}
        <ol className="@container divide-y divide-rule">
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

/** A key in a shortcut hint. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-sm border border-rule bg-cotton px-1 py-px text-[0.6875rem] text-ink-2">{children}</kbd>;
}

/** Loading rows in the shape of the queue: the wait, the sender, two lines of message. */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul aria-label="Đang tải…" className="@container divide-y divide-rule">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="grid gap-x-4 gap-y-2 px-4 py-4 @xl:grid-cols-[6.5rem_minmax(0,1fr)] @xl:px-5">
          <div className="flex gap-3 @xl:grid @xl:content-start @xl:gap-2"><Skeleton className="h-3.5 w-14" /><Skeleton className="h-3 w-10" /></div>
          <div className="grid content-start gap-2">
            <Skeleton className="h-3.5 w-48 max-w-full" />
            <Skeleton className="h-3.5 w-full max-w-xl" />
            <Skeleton className="h-3.5 max-w-md" style={{ width: `${70 - i * 10}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

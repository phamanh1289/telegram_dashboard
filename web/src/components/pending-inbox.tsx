"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, ListChecks, Pin, RotateCw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { MessageItem } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Message } from "@/lib/api";
import { fold, pendingQuery, type Selection, setHandled, useListShortcuts, useNow, useSelection, useTasks } from "@/lib/inbox";

/** Every pending tag across groups, pinned first then oldest; or (pinned) the pinned archive. */
export function PendingInbox({
  pinned = false,
  range,
  search,
  replyTo,
  onReply,
  onBack,
  onUseText,
  itemsRef,
  jump,
}: {
  pinned?: boolean;
  range: string;
  search: string;
  replyTo: string | null;
  onReply: (m: Message) => void;
  onBack: () => void;
  onUseText: (m: Message, text: string) => void;
  itemsRef?: React.RefObject<Message[]>; // what is on screen, for "open the next tag"
  jump?: number; // bumps on every sidebar click, to scroll back to the newest tag
}) {
  const q = useQuery({
    ...pendingQuery(range, pinned),
    refetchInterval: 60_000, // snoozed tags come back on their own
  });
  const now = useNow();
  // Pinned, then oldest to newest: opens at the bottom, on the newest tag. Not on refetch, which would yank the reader.
  // Photos load late and the frame settles, so stay pinned to the bottom until the reader scrolls away.
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(false);
  const lastTop = useRef(0);
  useLayoutEffect(() => {
    if (q.isSuccess && box.current) { stick.current = true; box.current.scrollTop = box.current.scrollHeight; }
  }, [q.isSuccess, jump]);
  useEffect(() => {
    const ro = new ResizeObserver(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight; });
    for (const el of [box.current, list.current]) if (el) ro.observe(el); // the list grows, or the box shrinks
    return () => ro.disconnect();
  }, []);
  const tasks = useTasks();
  // Search tag text only, ignoring case and Vietnamese accents.
  const rows = useMemo(() => {
    const needle = fold(search.trim());
    const all = q.data ?? [];
    return needle
      ? all.filter((p) => fold(p.message.text).includes(needle))
      : all;
  }, [q.data, search]);
  const items = useMemo(() => rows.map((p) => p.message), [rows]);
  const focused = useListShortcuts(items, onReply);
  useEffect(() => { if (itemsRef) itemsRef.current = items; }, [items, itemsRef]);
  const sel = useSelection();

  return (
    <section aria-label="Việc cần xử lý" className="flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại">
          <ArrowLeft />
        </Button>
        <p className="min-w-0 truncate text-[0.8125rem] text-ink-2">
          {pinned ? "Tag đã ghim" : "Việc cần xử lý trong mọi nhóm"}
          {q.data && <span className="ml-2 font-mono text-ink-3 tabular-nums">{items.length}</span>}
        </p>
        {!pinned && <div className="ml-auto shrink-0"><BulkBar sel={sel} items={items} /></div>}
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto bg-cotton"
        onScroll={(e) => {
          // Growth never lowers scrollTop, so only a scroll up unpins; reaching the bottom pins again.
          const el = e.currentTarget;
          if (el.scrollTop < lastTop.current) stick.current = false;
          else if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) stick.current = true;
          lastTop.current = el.scrollTop;
        }}>
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
        <ol ref={list} className="@container divide-y divide-rule">
          {rows.map(({ chat_title, message: m }) => (
            <MessageItem
              key={`${m.chat_id}:${m.message_id}`}
              m={m}
              head
              now={now}
              groupTitle={chat_title}
              focused={focused === m.message_id}
              isReplyTarget={replyTo === m.message_id}
              selectMode={sel.on}
              checked={sel.has(m)}
              onToggle={sel.toggle}
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

/** Multi-select in a list toolbar: "Chọn" until on, then the count, select all, bulk "Xong" and exit. */
export function BulkBar({ sel, items }: { sel: Selection; items: Message[] }) {
  const open = items.filter((m) => !m.outgoing && !m.deleted && !m.handled);
  const picked = sel.picked.filter((m) => !m.outgoing && !m.handled);
  const done = useMutation({ mutationFn: () => setHandled(picked, true), onSuccess: sel.stop });
  if (!sel.on) {
    return (
      <Button size="xs" variant="ghost" onClick={sel.start} disabled={!open.length} title="Chọn nhiều tin để đánh dấu xong cùng lúc">
        <ListChecks /> Chọn
      </Button>
    );
  }
  const all = open.length > 0 && picked.length === open.length;
  return (
    <div role="toolbar" aria-label="Đang chọn nhiều tin" className="flex items-center gap-1 animate-in fade-in-0 slide-in-from-right-2 duration-(--dur-short) ease-(--ease-out)">
      <span role="status" className="mr-1 whitespace-nowrap text-xs text-ink-2">
        <span className="font-mono tabular-nums">{picked.length}</span> đã chọn
      </span>
      <Button size="xs" variant="ghost" onClick={() => sel.setAll(all ? [] : open)}>{all ? "Bỏ chọn" : "Chọn tất cả"}</Button>
      <Button size="xs" disabled={!picked.length || done.isPending} aria-busy={done.isPending} onClick={() => done.mutate()}>
        <CheckCheck /> Xong
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Thoát chế độ chọn (Esc)" title="Thoát chế độ chọn (Esc)" onClick={sel.stop}>
        <X />
      </Button>
    </div>
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

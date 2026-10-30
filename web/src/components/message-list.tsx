"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageItem } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatMessages } from "@/hooks/use-chat-messages";
import { api, ApiError, type Message } from "@/lib/api";
import { useListShortcuts, useNow, useTasks } from "@/lib/inbox";
import { cn } from "@/lib/utils";

export const MAX_AI_MESSAGES = 30;

export function MessageList({
  chatId,
  onBack,
  replyTo,
  onReply,
  selectMode,
  selected,
  onToggle,
  range,
  onUseText,
}: {
  onUseText: (m: Message, text: string) => void;
  range: string;
  chatId: string;
  onBack: () => void;
  selectMode: boolean;
  replyTo: string | null;
  onReply: (m: Message) => void;
  selected: Map<string, Message>;
  onToggle: (m: Message) => void;
}) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const markAll = useMutation({
    mutationFn: () =>
      api<{ count: number }>(
        `/chats/${encodeURIComponent(chatId)}/handled-all${range ? `?${range}` : ""}`,
        { method: "POST" },
      ),
    onSuccess: () => setConfirmAll(false),
  });
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useChatMessages(chatId, q, range, pendingOnly && !q);
  const items = useMemo(
    () => (query.data ? [...query.data.pages].reverse().flatMap((p) => p.items) : []),
    [query.data],
  );
  const now = useNow();
  const tasks = useTasks();
  const focused = useListShortcuts(items, onReply);

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
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại">
          <ArrowLeft />
        </Button>
        {searching ? (
          <Input
            type="search"
            autoFocus
            aria-label="Tìm trong nhóm"
            placeholder="Tìm trong tin đã lưu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={200}
          />
        ) : (
          <div role="tablist" aria-label="Lọc tin" className="flex gap-0.5 rounded-lg bg-muted p-0.5 text-xs">
            {([[true, "Chưa xử lý"], [false, "Tất cả"]] as const).map(([v, label]) => (
              <button key={label} type="button" role="tab" aria-selected={pendingOnly === v} onClick={() => setPendingOnly(v)}
                className={cn("rounded-md px-2.5 py-1 transition-colors", pendingOnly === v ? "bg-card font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
          </div>
        )}
        {!searching && pendingOnly && items.length > 0 && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setConfirmAll(true)}
            title="Đánh dấu mọi tin chưa xử lý trong nhóm này là đã xử lý">
            <CheckCheck /> Xong tất cả
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className={cn(!(!searching && pendingOnly && items.length > 0) && "ml-auto")}
          aria-label={searching ? "Đóng tìm kiếm" : "Tìm kiếm"}
          onClick={() => {
            setSearching((v) => !v);
            setSearch("");
          }}
        >
          {searching ? <X /> : <Search />}
        </Button>
      </div>
      <div
        ref={box}
        data-testid="timeline"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
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
            Chỉ lưu tin tag/reply bạn (nạp lại 14 ngày gần nhất mỗi lần kết nối).
          </p>
        )}
        {query.isPending && <Skeleton className="h-16 w-full" />}
        {error === "not_tracking" && <p className="text-sm text-muted-foreground">Nhóm không còn được theo dõi.</p>}
        {error && error !== "not_tracking" && <p className="text-sm text-destructive">Không tải được tin nhắn.</p>}
        {query.isSuccess && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {q ? "Không có kết quả." : pendingOnly ? "🎉 Đã xử lý hết tin tag trong nhóm này." : "Chưa có tin nào."}
          </p>
        )}
        <ol className="grid gap-1.5">
          {items.map((m, i) => (
            <MessageItem
              key={m.message_id}
              head={items[i - 1]?.deleted || items[i - 1]?.sender_id !== m.sender_id || items[i - 1]?.outgoing !== m.outgoing}
              m={m}
              isReplyTarget={replyTo === m.message_id}
              checked={selected.has(m.message_id)}
              selectMode={selectMode}
              canCheck={selected.size < MAX_AI_MESSAGES}
              now={now}
              focused={focused === m.message_id}
              tasks={tasks.get(`${m.chat_id}:${m.message_id}`)}
              onReply={onReply}
              onToggle={onToggle}
              onUseText={onUseText}
            />
          ))}
        </ol>
      </div>
      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent>
          <DialogTitle>Đánh dấu tất cả là đã xử lý?</DialogTitle>
          <DialogDescription>
            {query.hasNextPage ? "Mọi" : `${items.length}`} tin chưa xử lý trong nhóm này
            {range ? " (trong khoảng ngày đang lọc)" : ""} sẽ chuyển sang “Đã xử lý”. Có thể mở lại từng tin ở tab Tất cả.
          </DialogDescription>
          {markAll.isError && <p role="alert" className="text-xs text-destructive">Không cập nhật được.</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Hủy</DialogClose>
            <Button disabled={markAll.isPending} onClick={() => markAll.mutate()}>
              <CheckCheck /> Xong tất cả
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

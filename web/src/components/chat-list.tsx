"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Chat, type ChatsResponse } from "@/lib/api";
import { fold } from "@/lib/inbox";
import { cn } from "@/lib/utils";

export function Avatar({ name, className }: { name: string; className?: string }) {
  const hue = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);
  return (
    <span
      aria-hidden
      style={{ background: `oklch(0.6 0.1 ${hue} / 0.22)`, color: `oklch(var(--av-l) 0.12 ${hue})` }}
      className={cn("grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold uppercase", className)}
    >
      {[...(name.trim().split(/\s+/).pop() ?? "?")][0]}
    </span>
  );
}

/** Count on the avatar while the list is a narrow rail. */
function RailBadge({ n }: { n: number }) {
  return (
    <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[0.6rem] font-semibold leading-4 text-white tabular-nums md:group-hover/side:hidden">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function ChatList({
  selected,
  onSelect,
  range,
  search,
  collapsed,
}: {
  range: string;
  search: string;
  collapsed: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const [purging, setPurging] = useState<Chat | null>(null);
  const chats = useQuery({
    queryKey: ["chats", range],
    refetchInterval: 60_000, // snoozed tags come back on their own
    queryFn: ({ signal }) =>
      api<ChatsResponse>(`/chats${range ? `?${range}` : ""}`, { signal }),
  });
  const purge = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/chats/${encodeURIComponent(id)}/data`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: ["messages", id] });
      if (selected === id) onSelect(null);
      setPurging(null);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["chats"] }),
  });
  const allItems = chats.data?.items ?? [];
  const pendingTotal = allItems.reduce((n, c) => n + c.pending_count, 0);
  const needle = fold(search.trim());
  const items = needle ? allItems.filter((c) => fold(c.title).includes(needle)) : allItems;
  useEffect(() => {
    document.title = pendingTotal ? `(${pendingTotal}) Telegram Dashboard` : "Telegram Dashboard";
  }, [pendingTotal]);

  return (
    <nav aria-label="Nhóm có tag" className="flex h-full min-h-0 flex-col gap-2 p-2">
      <h2 className="flex items-center gap-2 whitespace-nowrap px-1 py-1 text-xs font-medium uppercase text-muted-foreground">
        Bạn được tag
        {pendingTotal > 0 && <span className="ml-auto pr-1 normal-case text-amber-600 dark:text-amber-400">{pendingTotal} chưa xử lý</span>}
      </h2>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {chats.isPending && <Skeleton className="h-12 w-full" />}
        {chats.isError && <p className="px-2 text-sm text-destructive">Không tải được danh sách nhóm.</p>}
        {chats.isSuccess && allItems.length === 0 && (
          <p className="px-2 text-sm text-muted-foreground">Chưa có tin nào tag bạn. Tin mới sẽ hiện ở đây ngay khi có người tag.</p>
        )}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {items.map((c) => (
            <li key={c.chat_id} className="group relative animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
              <button
                type="button"
                onClick={() => onSelect(c.chat_id)}
                aria-current={selected === c.chat_id}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 pr-10 text-left text-sm transition-colors hover:bg-primary/10",
                  selected === c.chat_id && "bg-primary/15 font-medium",
                )}
              >
                <span className="relative shrink-0">
                  <Avatar name={c.title} />
                  {collapsed && c.pending_count > 0 && <RailBadge n={c.pending_count} />}
                </span>
                <span className={cn("block min-w-0 flex-1 truncate", c.pending_count > 0 && "font-semibold")}>{c.title}</span>
                {c.pending_count > 0 && (
                  <span title={`${c.pending_count} tin chưa xử lý`}
                    className="shrink-0 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white tabular-nums">
                    {c.pending_count}
                  </span>
                )}
              </button>
              <Button size="icon-xs" variant="ghost" aria-label="Xóa dữ liệu" title="Xóa dữ liệu"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-destructive opacity-40 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => setPurging(c)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <Dialog open={purging !== null} onOpenChange={(o) => !o && setPurging(null)}>
        <DialogContent>
          <DialogTitle>Xóa dữ liệu nhóm?</DialogTitle>
          <DialogDescription>
            Xóa tin đã lưu của “{purging?.title}” và nội dung chưa gửi trên máy này. Nhóm sẽ hiện lại khi có người tag bạn.
            Tin đang gửi có thể đã tới Telegram và không thu hồi được.
          </DialogDescription>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Hủy</DialogClose>
            <Button variant="destructive" disabled={purge.isPending}
              onClick={() => purging && purge.mutate(purging.chat_id)}>
              Xóa dữ liệu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

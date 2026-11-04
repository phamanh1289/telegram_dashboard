"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { NavPill } from "@/components/shell";
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
import { cn } from "@/lib/utils";

/** 24px initial on a wash of one of the six categorical hues, picked from the name (fixed L/C via tokens). */
/** One of the six categorical hues (1-6), fixed per name: the avatar wash and the sender's name share it. */
export const hueOf = (name: string) => ([...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0) % 6) + 1;

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ background: `color-mix(in oklch, var(--cat-${hueOf(name)}) 24%, var(--color-cotton))` }}
      className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold text-ink-2", className)}
    >
      {([...(name.trim().split(/\s+/).pop() ?? "?")][0] ?? "?").toLocaleUpperCase("vi")}
    </span>
  );
}

/** While collapsed to a rail, text beyond the avatars waits for the rail to open (hover or focus). */
const railHide = "transition-opacity duration-(--dur-short) md:opacity-0 md:group-hover/side:opacity-100 md:group-focus-within/side:opacity-100";

/** Count on the avatar while the list is a narrow rail. */
function RailBadge({ n }: { n: number }) {
  return (
    <span className="absolute -right-1.5 -top-1.5 hidden min-w-4 rounded-full bg-signal px-1 text-center font-mono text-[0.625rem] leading-4 text-signal-ink tabular-nums md:block md:group-hover/side:opacity-0 md:group-focus-within/side:opacity-0">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Groups with tags for the active day range (shared by the rail and the tab counts). */
export function useChats(range: string) {
  return useQuery({
    queryKey: ["chats", range],
    refetchInterval: 60_000, // snoozed tags come back on their own
    queryFn: ({ signal }) =>
      api<ChatsResponse>(`/chats${range ? `?${range}` : ""}`, { signal }),
  });
}

export function ChatList({
  selected,
  onSelect,
  range,
  collapsed,
}: {
  range: string;
  collapsed: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const [purging, setPurging] = useState<Chat | null>(null);
  const chats = useChats(range);
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
  const items = chats.data?.items ?? [];
  const pendingTotal = items.reduce((n, c) => n + c.pending_count, 0);
  useEffect(() => {
    document.title = pendingTotal ? `(${pendingTotal}) Telegram Dashboard` : "Telegram Dashboard";
  }, [pendingTotal]);

  return (
    <nav aria-label="Nhóm có tag" className="flex h-full min-h-0 flex-col">
      <h2 className={cn("flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-5 text-[0.8125rem] font-semibold tracking-normal text-ink-2", collapsed && railHide)}>
        Nhóm có tag
        {pendingTotal > 0 && (
          <span className="ml-auto font-normal text-ink-3">
            <span className="font-mono text-ink-2 tabular-nums">{pendingTotal}</span> chưa xử lý
          </span>
        )}
      </h2>
      <motion.div layoutScroll className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats.isPending && (
          <ul aria-label="Đang tải nhóm" className="grid gap-1 px-3 pt-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex h-10 items-center gap-3">
                <Skeleton className="size-6 rounded-full" />
                <Skeleton className="h-3 flex-1" style={{ maxWidth: `${70 - i * 8}%` }} />
              </li>
            ))}
          </ul>
        )}
        {chats.isError && (
          <div role="alert" className="grid justify-items-start gap-2 px-3 py-2 text-sm">
            <p className="text-error">Không tải được danh sách nhóm.</p>
            <Button size="sm" variant="outline" onClick={() => void chats.refetch()}>
              <RotateCw /> Thử lại
            </Button>
          </div>
        )}
        {chats.isSuccess && items.length === 0 && (
          <p className="px-3 py-2 text-sm leading-relaxed text-ink-3">Chưa có tin nào tag bạn. Tin mới sẽ hiện ở đây ngay khi có người tag.</p>
        )}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
          {items.map((c) => (
            <li key={c.chat_id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(c.chat_id)}
                aria-current={selected === c.chat_id}
                className={cn(
                  "relative flex h-10 w-full items-center gap-3 rounded-md px-3 pr-10 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
                  selected === c.chat_id && "font-medium text-hl-2 hover:bg-transparent",
                )}
              >
                {selected === c.chat_id && <NavPill />}
                <span className="relative shrink-0">
                  <Avatar name={c.title} />
                  {collapsed && c.pending_count > 0 && <RailBadge n={c.pending_count} />}
                </span>
                <span className={cn("relative block min-w-0 flex-1 truncate", c.pending_count > 0 && "font-medium text-ink", collapsed && railHide)}>{c.title}</span>
                {c.pending_count > 0 && (
                  <span title={`${c.pending_count} tin chưa xử lý`}
                    className={cn("relative shrink-0 rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums group-hover:bg-cotton", collapsed && railHide)}>
                    {c.pending_count}
                  </span>
                )}
              </button>
              <Button size="icon-xs" variant="ghost" aria-label="Xóa dữ liệu" title="Xóa dữ liệu"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-3 opacity-0 transition-opacity hover:bg-error-wash hover:text-error focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 active:-translate-y-1/2"
                onClick={() => setPurging(c)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </motion.div>
      <Dialog open={purging !== null} onOpenChange={(o) => !o && setPurging(null)}>
        <DialogContent>
          <DialogTitle>Xóa dữ liệu nhóm?</DialogTitle>
          <DialogDescription>
            Xóa tin đã lưu của “{purging?.title}” và nội dung chưa gửi trên máy này. Nhóm sẽ hiện lại khi có người tag bạn.
            Tin đang gửi có thể đã tới Telegram và không thu hồi được.
          </DialogDescription>
          {purge.isError && <p role="alert" className="text-sm text-error">Không xóa được dữ liệu nhóm. Thử lại.</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Hủy</DialogClose>
            <Button variant="destructive" className="bg-error-wash hover:bg-error-wash" aria-busy={purge.isPending} disabled={purge.isPending}
              onClick={() => purging && purge.mutate(purging.chat_id)}>
              Xóa dữ liệu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

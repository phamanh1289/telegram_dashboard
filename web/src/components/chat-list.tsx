"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

export function ChatList({
  selected,
  onSelect,
  connected,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  connected: boolean;
}) {
  const qc = useQueryClient();
  const [manage, setManage] = useState(false);
  const [purging, setPurging] = useState<Chat | null>(null);
  const chats = useQuery({
    queryKey: ["chats"],
    queryFn: ({ signal }) => api<ChatsResponse>("/chats", { signal }),
  });
  const done = () => qc.invalidateQueries({ queryKey: ["chats"] });
  const track = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      api<Chat>(`/chats/${encodeURIComponent(v.id)}/tracking`, {
        method: "PUT",
        json: { enabled: v.enabled },
      }),
    onSettled: done,
  });
  const purge = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/chats/${encodeURIComponent(id)}/data`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: ["messages", id] });
      if (selected === id) onSelect(null);
      setPurging(null);
    },
    onSettled: done,
  });

  const items = chats.data?.items ?? [];
  const tracked = items.filter((c) => c.tracking);
  const others = items.filter((c) => !c.tracking);

  return (
    <nav aria-label="Nhóm theo dõi" className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Nhóm theo dõi</h2>
        <Button size="xs" variant="ghost" onClick={() => setManage((m) => !m)} aria-expanded={manage}>
          {manage ? "Xong" : "Quản lý"}
        </Button>
      </div>
      {chats.isPending && <Skeleton className="h-8 w-full" />}
      {chats.isError && <p className="text-sm text-destructive">Không tải được danh sách nhóm.</p>}
      {!chats.isPending && tracked.length === 0 && (
        <p className="text-sm text-muted-foreground">Chưa theo dõi nhóm nào. Bấm “Quản lý”.</p>
      )}
      <ul className="grid gap-1">
        {tracked.map((c) => (
          <li key={c.chat_id}>
            <button
              type="button"
              onClick={() => onSelect(c.chat_id)}
              aria-current={selected === c.chat_id}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                selected === c.chat_id && "bg-muted font-medium",
              )}
            >
              <span className="block truncate">{c.title}</span>
              {c.sync_state !== "idle" && (
                <span className="text-xs text-muted-foreground">
                  {c.sync_state === "syncing" ? "Đang đồng bộ…" : "Đồng bộ lỗi, đang thử lại"}
                </span>
              )}
              {!c.available && <span className="text-xs text-muted-foreground"> · không truy cập được</span>}
            </button>
            {manage && (
              <div className="flex gap-1 px-2 pb-1">
                <Button size="xs" variant="outline" disabled={track.isPending}
                  onClick={() => track.mutate({ id: c.chat_id, enabled: false })}>
                  Bỏ theo dõi
                </Button>
                <Button size="xs" variant="destructive" onClick={() => setPurging(c)}>
                  Xóa dữ liệu
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {manage && (
        <section className="grid gap-1 border-t pt-2">
          <h3 className="text-xs font-semibold text-muted-foreground">Nhóm khác</h3>
          {!connected && <p className="text-xs text-muted-foreground">Cần kết nối Telegram để thấy nhóm.</p>}
          {others.map((c) => (
            <div key={c.chat_id} className="flex items-center justify-between gap-2 px-2 text-sm">
              <span className="truncate">
                {c.title}
                {c.migrated && <span className="text-xs text-muted-foreground"> (đã nâng cấp, chọn nhóm mới)</span>}
              </span>
              <span className="flex shrink-0 gap-1">
                {!c.migrated && c.available && (
                  <Button size="xs" disabled={track.isPending}
                    onClick={() => track.mutate({ id: c.chat_id, enabled: true })}>
                    Theo dõi
                  </Button>
                )}
                <Button size="xs" variant="ghost" onClick={() => setPurging(c)}>Xóa dữ liệu</Button>
              </span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Khi theo dõi, chỉ nạp tối đa 50 tin gần nhất; không phải toàn bộ lịch sử.
          </p>
        </section>
      )}
      <Dialog open={purging !== null} onOpenChange={(o) => !o && setPurging(null)}>
        <DialogContent>
          <DialogTitle>Xóa dữ liệu nhóm?</DialogTitle>
          <DialogDescription>
            Dừng theo dõi “{purging?.title}”, xóa tin đã lưu và nội dung chưa gửi trên máy này.
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

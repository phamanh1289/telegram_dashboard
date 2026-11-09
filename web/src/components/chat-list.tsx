"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { NavPill } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ChatsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

/** One of the six categorical hues (1-6), fixed per name: the avatar wash and the sender's name share it. */
export const hueOf = (name: string) => ([...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0) % 6) + 1;

/** 24px initial on a wash of the name's categorical hue (fixed L/C via tokens). */
/** First letter of the last word that starts with one ("Thảo Lê (PO)" → L, "C-Bank (Valuation)" → C), else any letter. */
const initial = (name: string) =>
  ([...(name.split(/\s+/).findLast((w) => /^[\p{L}\p{N}]/u.test(w)) ?? name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?")][0]).toLocaleUpperCase("vi");

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ background: `color-mix(in oklch, var(--cat-${hueOf(name)}) 24%, var(--color-cotton))` }}
      className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold text-ink-2", className)}
    >
      {initial(name)}
    </span>
  );
}

/** While collapsed to a rail, text beyond the avatars waits for the rail to open (hover or focus). */
export const railHide = "transition-opacity duration-(--dur-short) md:opacity-0 md:group-hover/side:opacity-100 md:group-focus-within/side:opacity-100";

/** Count on the avatar while the list is a narrow rail: a plain count (neutral), not the amber "needs you" signal. */
function RailBadge({ n }: { n: number }) {
  return (
    <span className="absolute -right-1.5 -top-1.5 hidden min-w-4 rounded-full bg-ink-2 px-1 text-center font-mono text-[0.625rem] leading-4 text-cotton tabular-nums ring-2 ring-paper-2 md:block md:group-hover/side:opacity-0 md:group-focus-within/side:opacity-0">
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
  bare,
}: {
  range: string;
  /** No "Nhóm có tag" heading: the caller titles the list (the sidebar's tabs). */
  bare?: boolean;
  collapsed: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const chats = useChats(range);
  const items = chats.data?.items ?? [];
  const pendingTotal = items.reduce((n, c) => n + c.pending_count, 0);
  // The tab title always counts every open tag, whatever the day range (same query when no range is set).
  const allTotal = (useChats("").data?.items ?? []).reduce((n, c) => n + c.pending_count, 0);
  useEffect(() => {
    document.title = allTotal ? `(${allTotal}) Radar` : "Radar";
  }, [allTotal]);

  return (
    <nav aria-label="Nhóm có tag" className="flex h-full min-h-0 flex-col">
      {!bare && <h2 className={cn("flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-5 text-[0.8125rem] font-semibold tracking-normal text-ink-2", collapsed && railHide)}>
        Nhóm có tag
        {pendingTotal > 0 && (
          <span className="ml-auto font-normal text-ink-3">
            <span className="font-mono text-ink-2 tabular-nums">{pendingTotal}</span> chưa xử lý
          </span>
        )}
      </h2>}
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
                  "relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
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
                  <span className={cn("relative shrink-0 rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums group-hover:bg-cotton", collapsed && railHide)}>
                    {c.pending_count}<span className="sr-only"> tin chưa xử lý</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </motion.div>
    </nav>
  );
}

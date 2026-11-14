"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { motion } from "motion/react";
import { use, useEffect, useMemo } from "react";
import { NavPill } from "@/app/_components/shell";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { api, type ChatsResponse } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { inQaPage, pendingQuery, QaCodes } from "@/features/telegram/lib/inbox";
import { cn } from "@/shared/lib/utils";

import { Avatar } from "@/shared/components/avatar";

/** While collapsed to a rail, text beyond the avatars waits for the rail to open (hover or focus). */
export const railHide = "transition-opacity duration-(--dur-short) md:opacity-0 md:group-hover/side:opacity-100 md:group-focus-within/side:opacity-100";

/** A group row of a sidebar list (tag groups, Briefing, Q&A); `on`: the picked one (its NavPill). */
export const navRowCls = (on: boolean) => cn(
  "relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
  on && "font-medium text-hl-2 hover:bg-transparent",
);

/** A sidebar list still loading (Briefing, Q&A). */
export const NavSkeleton = () => <div className="grid gap-2 px-3 pt-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-4" style={{ width: `${70 - k * 12}%` }} />)}</div>;

/** Count on the avatar while the list is a narrow rail: a plain count (neutral), not the amber "needs you" signal. */
function RailBadge({ n }: { n: number }) {
  return (
    <span className="absolute -right-1.5 -top-1.5 hidden min-w-4 rounded-full bg-ink-2 px-1 text-center font-mono text-2xs leading-4 text-cotton tabular-nums ring-2 ring-paper-2 md:block md:group-hover/side:opacity-0 md:group-focus-within/side:opacity-0">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Groups with tags for the active day range (shared by the rail and the tab counts). */
/** Tracked groups; `pending_count` leaves out the open tags the Q&A page shows (`inQaPage`), as the tag lists do, and
 *  `qaHidden` lists them by group ("Xong tất cả" skips them). `codes`: the Q&A threads read (default: QaCodes; the
 *  inbox shell, above its provider, passes its own). */
export function useChats(range: string, codes?: ReadonlyMap<string, string>) {
  const ctx = use(QaCodes);
  const q = useQuery({
    queryKey: ["chats", range],
    refetchInterval: 60_000, // snoozed tags come back on their own
    queryFn: ({ signal }) =>
      api<ChatsResponse>(`/chats${range ? `?${range}` : ""}`, { signal }),
  });
  const pending = useQuery({ ...pendingQuery(range), refetchInterval: 60_000 }).data;
  const qa = codes ?? ctx;
  const [data, qaHidden] = useMemo(() => {
    const off = new Map<string, string[]>();
    for (const { message: m } of pending ?? []) if (inQaPage(qa, m)) off.set(m.chat_id, [...(off.get(m.chat_id) ?? []), m.message_id]);
    return [q.data && off.size
      ? { ...q.data, items: q.data.items.map((c) => ({ ...c, pending_count: Math.max(0, c.pending_count - (off.get(c.chat_id)?.length ?? 0)) })) }
      : q.data, off] as const;
  }, [q.data, pending, qa]);
  return { ...q, data, qaHidden };
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
  const t = useT();
  const chats = useChats(range);
  const items = chats.data?.items ?? [];
  const pendingTotal = items.reduce((n, c) => n + c.pending_count, 0);
  // The tab title always counts every open tag, whatever the day range (same query when no range is set).
  const allTotal = (useChats("").data?.items ?? []).reduce((n, c) => n + c.pending_count, 0);
  useEffect(() => {
    document.title = allTotal ? `(${allTotal}) Radar` : "Radar";
  }, [allTotal]);

  return (
    <nav aria-label={t("Nhóm có tag")} className="flex h-full min-h-0 flex-col">
      {!bare && <h2 className={cn("flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-5 text-xs font-bold tracking-normal text-ink-2", collapsed && railHide)}>
        {t("Nhóm có tag")}
        {pendingTotal > 0 && (
          <span className="ml-auto font-normal text-ink-3">
            {t.n("{n} chưa xử lý", { n: <span className="font-mono text-ink-2 tabular-nums">{pendingTotal}</span> })}
          </span>
        )}
      </h2>}
      <motion.div layoutScroll className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats.isPending && (
          <ul aria-label={t("Đang tải nhóm")} className="grid gap-1 px-3 pt-1">
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
            <p className="text-error">{t("Không tải được danh sách nhóm.")}</p>
            <Button size="sm" variant="outline" onClick={() => void chats.refetch()}>
              <RotateCw /> {t("Thử lại")}
            </Button>
          </div>
        )}
        {chats.isSuccess && items.length === 0 && (
          <p className="px-3 py-2 text-sm leading-relaxed text-ink-3">{t("Chưa có tin nào tag bạn. Tin mới sẽ hiện ở đây ngay khi có người tag.")}</p>
        )}
        <ul className="zebra grid grid-cols-[minmax(0,1fr)] gap-1">
          {items.map((c) => (
            <li key={c.chat_id} className="group relative rounded-md">
              <button
                type="button"
                onClick={() => onSelect(c.chat_id)}
                aria-current={selected === c.chat_id}
                className={navRowCls(selected === c.chat_id)}
              >
                {selected === c.chat_id && <NavPill />}
                <span className="relative shrink-0">
                  <Avatar name={c.title} />
                  {collapsed && c.pending_count > 0 && <RailBadge n={c.pending_count} />}
                </span>
                <span className={cn("relative block min-w-0 flex-1 truncate", c.pending_count > 0 && "font-medium text-ink", collapsed && railHide)}>{c.title}</span>
                {c.pending_count > 0 && (
                  <span className={cn("relative shrink-0 rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums group-hover:bg-cotton", collapsed && railHide)}>
                    {c.pending_count}<span className="sr-only"> {t("tin chưa xử lý")}</span>
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

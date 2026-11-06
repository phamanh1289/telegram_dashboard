"use client";

import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, type MessagesPage } from "@/lib/api";

/** "pending" / "done": stored tags; "live": every message of the group, live from Telegram (search and dates ignored). */
export type View = "pending" | "done" | "live";

type Pages = InfiniteData<MessagesPage, string | null>;
const PAGE = 50;
const livePath = (chatId: string, before?: string | null) =>
  `/chats/${encodeURIComponent(chatId)}/live?limit=${PAGE}${before ? `&before=${before}` : ""}`;

/** Pages newest-first; each page's items are ascending. `range`: query string from rangeQuery() ("" = all time). */
export function useChatMessages(chatId: string | null, q: string, range: string, view: View) {
  const live = view === "live" && !q;
  const qc = useQueryClient();
  // Plain group messages are not stored, so no SSE change reaches them: while shown, poll the newest page only and merge
  // it into the first loaded page (older pages don't change often). Paused while the tab is hidden.
  useEffect(() => {
    if (!live || chatId === null) return;
    const key = ["live", chatId];
    const t = setInterval(async () => {
      if (document.hidden || qc.isFetching({ queryKey: key })) return;
      const head = await api<MessagesPage>(livePath(chatId)).catch(() => null);
      if (!head) return;
      const cur = qc.getQueryData<Pages>(key)?.pages[0];
      const lastSeen = cur?.items.at(-1)?.message_id;
      // More new messages than one page: the merge would leave a hole, so reload the whole view.
      if (cur && lastSeen && !head.items.some((m) => +m.message_id <= +lastSeen)) return void qc.resetQueries({ queryKey: key });
      qc.setQueryData<Pages>(key, (d) => {
        if (!d?.pages.length) return d;
        const [first, ...rest] = d.pages;
        const byId = new Map(first.items.map((m) => [m.message_id, m]));
        for (const m of head.items) byId.set(m.message_id, m); // new ones, and fresh copies of edited ones
        const items = [...byId.values()].sort((a, b) => +a.message_id - +b.message_id);
        return { ...d, pages: [{ ...first, items, snapshot_cursor: head.snapshot_cursor }, ...rest] };
      });
    }, 10_000);
    return () => clearInterval(t);
  }, [live, chatId, qc]);
  return useInfiniteQuery({
    // "live" root: SSE changes refetch ["messages", chat] only, never the whole live history
    queryKey: live ? ["live", chatId] : ["messages", chatId, q, range, q ? "" : view],
    enabled: chatId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      if (live) return api<MessagesPage>(livePath(chatId!, pageParam), { signal });
      const p = new URLSearchParams(range);
      p.set("limit", String(PAGE));
      if (pageParam) p.set("before", pageParam);
      if (q) p.set("q", q);
      else if (view === "pending") p.set("pending", "true");
      else if (view === "done") p.set("handled", "true");
      return api<MessagesPage>(`/chats/${encodeURIComponent(chatId!)}/messages?${p}`, { signal });
    },
    getNextPageParam: (last) => (last.has_more && last.items[0] ? last.items[0].message_id : null),
  });
}

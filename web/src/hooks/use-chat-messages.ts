"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { api, type MessagesPage } from "@/lib/api";

/** "pending" / "done": stored tags; "live": every message of the group, live from Telegram (search and dates ignored). */
export type View = "pending" | "done" | "live";

/** Pages newest-first; each page's items are ascending. `range`: query string from rangeQuery() ("" = all time). */
export function useChatMessages(chatId: string | null, q: string, range: string, view: View) {
  const live = view === "live" && !q;
  return useInfiniteQuery({
    // "live" root: SSE changes refetch ["messages", chat] only, never the whole live history
    queryKey: live ? ["live", chatId] : ["messages", chatId, q, range, q ? "" : view],
    enabled: chatId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams(live ? "" : range);
      p.set("limit", "50");
      if (pageParam) p.set("before", pageParam);
      if (q) p.set("q", q);
      else if (view === "pending") p.set("pending", "true");
      else if (view === "done") p.set("handled", "true");
      return api<MessagesPage>(`/chats/${encodeURIComponent(chatId!)}/${live ? "live" : "messages"}?${p}`, { signal });
    },
    getNextPageParam: (last) => (last.has_more && last.items[0] ? last.items[0].message_id : null),
    // Plain group messages are not stored, so no SSE change reaches them: poll while shown (paused when the tab is hidden).
    // ponytail: refetches every loaded page; push a per-chat "activity" SSE event if deep scrollback makes this heavy.
    refetchInterval: live ? 10_000 : false,
  });
}

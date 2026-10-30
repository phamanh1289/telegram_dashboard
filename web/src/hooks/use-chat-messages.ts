"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { api, type MessagesPage } from "@/lib/api";

/** Pages newest-first; each page's items are ascending. Search uses its own key. */
/** `range`: query string from rangeQuery() ("" = all time). */
export function useChatMessages(chatId: string | null, q: string, range: string, pending: boolean) {
  return useInfiniteQuery({
    queryKey: ["messages", chatId, q, range, pending],
    enabled: chatId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams(range);
      p.set("limit", "50");
      if (pageParam) p.set("before", pageParam);
      if (q) p.set("q", q);
      if (pending) p.set("pending", "true");
      return api<MessagesPage>(`/chats/${encodeURIComponent(chatId!)}/messages?${p}`, { signal });
    },
    getNextPageParam: (last) => (last.has_more && last.items[0] ? last.items[0].message_id : null),
  });
}

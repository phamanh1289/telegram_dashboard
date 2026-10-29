"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { api, type MessagesPage } from "@/lib/api";

/** Pages newest-first; each page's items are ascending. Search uses its own key. */
export function useChatMessages(chatId: string | null, q: string) {
  return useInfiniteQuery({
    queryKey: ["messages", chatId, q],
    enabled: chatId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: "50" });
      if (pageParam) p.set("before", pageParam);
      if (q) p.set("q", q);
      return api<MessagesPage>(`/chats/${encodeURIComponent(chatId!)}/messages?${p}`, { signal });
    },
    getNextPageParam: (last) => (last.has_more && last.items[0] ? last.items[0].message_id : null),
  });
}

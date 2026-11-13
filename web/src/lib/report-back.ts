"use client";

import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText, type LoopBack, type LoopItem } from "@/lib/api";
import { t } from "@/lib/i18n";
import { toast } from "@/lib/inbox";
import { put, readList } from "@/lib/prefs";

// "Báo lại": a ticket of mine just reached Fixed / Done, and someone on Telegram asked about it. The server's YouTrack
// watch queues one item per message to answer, page open or not (yt_dashboard.watch); my reply to it (from any device)
// closes it there. The SSE status says when the list changed (use-events.ts).

export type { LoopItem };
export const loopKey = (l: Pick<LoopItem, "ticket" | "chat_id" | "message_id">) => `${l.ticket}:${l.chat_id}:${l.message_id}`;

// ponytail: one-time move of the old per-browser queue (localStorage) to the server; drop after a few releases.
const OLD = ["loopBack", "loopDone", "ytWatchSeen"];
let moved = false;
async function moveOld() {
  if (moved) return;
  const isItem = (x: unknown): x is LoopItem => {
    const l = x as LoopItem | null;
    return !!l && [l.ticket, l.state, l.chat_id, l.message_id].every((v) => typeof v === "string");
  };
  const items = readList(OLD[0], [], isItem).slice(0, 30).map(({ ticket, state, chat_id, message_id }) => ({ ticket, state, chat_id, message_id }));
  if (items.length) await api("/loopback/import", { method: "POST", json: { items } }); // kept for the next try when it fails
  OLD.forEach((k) => put(k, null));
  moved = true;
}

export const loopQuery = queryOptions({
  queryKey: ["loopback"],
  queryFn: async ({ signal }) => {
    await moveOld().catch((e) => console.warn("Báo lại: old queue not moved", e));
    return api<LoopBack>("/loopback", { signal });
  },
});

const EMPTY: LoopItem[] = [];
export const useLoopBack = () => useQuery(loopQuery);
export const useLoopItems = () => useLoopBack().data?.items ?? EMPTY;

/** "Bỏ qua": off the list for good (a later watch round never queues it again). */
export function useDoneLoop() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (l: LoopItem) => api<void>("/loopback/done", { method: "POST", json: { chat_id: l.chat_id, message_id: l.message_id, ticket: l.ticket } }),
    onError: (e) => toast({ text: errorText(e, {}, t("Chưa bỏ qua được mục Báo lại, thử lại.")) }),
    onSettled: () => qc.invalidateQueries({ queryKey: loopQuery.queryKey }),
  });
  return m.mutate;
}

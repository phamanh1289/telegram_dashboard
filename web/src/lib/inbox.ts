"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type Message, type Task } from "@/lib/api";

/** Lowercase without accents ("Luận" -> "luan") for forgiving name search. */
export function fold(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/** Message text plus the URLs hidden behind its words, so an agent can open them. */
export function textWithLinks({ text, links = [] }: Message) {
  if (!links.length) return text;
  return `${text}\n\nLiên kết trong tin:\n${links.map((l) => `- "${text.slice(l.offset, l.offset + l.length)}": ${l.url}`).join("\n")}`;
}

/** Pseudo chat id for the cross-group "to do" inbox. */
export const ALL = "__all__";
/** Pseudo chat id for the pinned-tags page. */
export const PINNED = "__pinned__";
/** Pseudo chat id for the AI sessions page. */
export const TASKS = "__tasks__";

/** A tag still waiting longer than this is shown in red. */
export const OVERDUE_HOURS = 4;

/** Current time, refreshed every minute (keeps render pure). */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function waitLabel(date: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(date).getTime()) / 60_000));
  const text = mins < 60 ? `${mins} phút` : mins < 1440 ? `${Math.floor(mins / 60)} giờ` : `${Math.floor(mins / 1440)} ngày`;
  return { text: `chờ ${text}`, overdue: mins >= OVERDUE_HOURS * 60 };
}

/**
 * Deep link that opens the message straight in the Telegram app (tg://), with the t.me
 * web link as fallback. Only supergroups have message links; basic groups return null.
 */
export function telegramLink(m: Message) {
  if (!m.chat_id.startsWith("-100")) return null;
  const channel = m.chat_id.slice(4);
  return {
    app: `tg://privatepost?channel=${channel}&post=${m.message_id}`,
    web: `https://t.me/c/${channel}/${m.message_id}`,
  };
}

export const markHandled = (m: Message, handled: boolean) =>
  api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/handled`, {
    method: "PUT",
    json: { handled },
  });

export const snooze = (m: Message, until: Date | null) =>
  api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/snooze`, {
    method: "PUT",
    json: { until: until?.toISOString() ?? null },
  });

export const pin = (m: Message, pinned: boolean) =>
  api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/pin`, {
    method: "PUT",
    json: { pinned },
  });

/** Every task handed to the AI. Polls while some task has no result yet. */
export function useTaskList() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: ({ signal }) => api<Task[]>("/tasks", { signal }),
    refetchInterval: (query) => (query.state.data?.some((t) => t.running) ? 10_000 : false),
  });
}

/** Tasks created from tags, keyed "chat:message". */
export function useTasks() {
  const q = useTaskList();
  const byMessage = new Map<string, Task[]>();
  for (const t of q.data ?? []) {
    if (!t.chat_id || !t.message_id) continue;
    const k = `${t.chat_id}:${t.message_id}`;
    byMessage.set(k, [...(byMessage.get(k) ?? []), t]);
  }
  return byMessage;
}

/** j/k move, r reply, x done/undo, a focus the AI prompt. Ignored while typing. */
export function useListShortcuts(
  items: Message[],
  onReply: (m: Message) => void,
) {
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const actionable = items.filter((m) => !m.deleted);
      const i = actionable.findIndex((m) => m.message_id === focused);
      const cur = actionable[i];
      if (e.key === "j" || e.key === "k") {
        const next = actionable[e.key === "j" ? Math.min(actionable.length - 1, i + 1) : Math.max(0, i < 0 ? actionable.length - 1 : i - 1)];
        if (next) {
          setFocused(next.message_id);
          document.querySelector(`[data-id="${next.message_id}"]`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "r" && cur) onReply(cur);
      else if (e.key === "x" && cur && !cur.outgoing) void markHandled(cur, !cur.handled);
      else if (e.key === "a") (document.getElementById("ai-prompt") as HTMLTextAreaElement | null)?.focus();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [items, focused, onReply]);
  return focused;
}

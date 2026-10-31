"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type Message, type PendingItem, type Task } from "@/lib/api";
import { readOverdueHours } from "@/lib/prefs";

/** Pending tags across groups (or the pinned archive); one cache shared by the inbox and the sidebar. */
export function pendingQuery(range: string, pinned = false) {
  return {
    queryKey: pinned ? ["pending", "pinned"] : ["pending", range],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<PendingItem[]>(pinned ? "/pinned" : `/pending${range ? `?${range}` : ""}`, { signal }),
  };
}

const VN_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh", hourCycle: "h23", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit",
});
const vnParts = (d: Date) => Object.fromEntries(VN_PARTS.formatToParts(d).map((p) => [p.type, p.value]));

/** Vietnam time, 12h with buổi: "9:05 sáng", "31/10 2:40 chiều"; `full` adds the year ("2:40 chiều, 31/10/2026"). */
export function timeLabel(date: string, full = false) {
  const p = vnParts(new Date(date));
  const h = Number(p.hour);
  const time = `${h % 12 || 12}:${p.minute} ${h < 12 ? "sáng" : h < 18 ? "chiều" : "tối"}`;
  if (full) return `${time}, ${p.day}/${p.month}/${p.year}`;
  const t = vnParts(new Date());
  return p.day === t.day && p.month === t.month && p.year === t.year ? time : `${p.day}/${p.month} ${time}`;
}

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
/** Pseudo chat id for the cross-group Digest briefing. */
export const BRIEFING = "__briefing__";

/** Current time, refreshed every minute and when a preference changes (keeps render pure). */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 60_000);
    addEventListener("prefs", tick);
    return () => {
      clearInterval(t);
      removeEventListener("prefs", tick);
    };
  }, []);
  return now;
}

export function waitLabel(date: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(date).getTime()) / 60_000));
  const [n, unit] = mins < 60 ? [mins, "phút"] : mins < 1440 ? [Math.floor(mins / 60), "giờ"] : [Math.floor(mins / 1440), "ngày"];
  return { text: `chờ ${n} ${unit}`, n, unit, overdue: mins >= readOverdueHours() * 60 };
}

/**
 * Supergroups: tg:// opens the message straight in the Telegram app, t.me as the web fallback. Basic groups have no
 * message links in any Telegram app, so they open the group in Telegram Web instead (`exact` false).
 */
export function telegramLink(m: Message) {
  if (!m.chat_id.startsWith("-100")) {
    const web = `https://web.telegram.org/a/#${m.chat_id}`;
    return { app: web, web, exact: false };
  }
  const channel = m.chat_id.slice(4);
  return {
    app: `tg://privatepost?channel=${channel}&post=${m.message_id}`,
    web: `https://t.me/c/${channel}/${m.message_id}`,
    exact: true,
  };
}

/** Local database key of a message, for bug reports. */
export const dbId = (m: Message) => `${m.chat_id}/${m.message_id}`;

export const markHandled = (m: Message, handled: boolean) =>
  api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/handled`, {
    method: "PUT",
    json: { handled },
  });

export type ToastMsg = { text: string; undo?: () => unknown };
/** Show a toast (rendered by the inbox shell); `undo` adds a "Hoàn tác" button and the z shortcut. */
export const toast = (t: ToastMsg) => dispatchEvent(new CustomEvent<ToastMsg>("toast", { detail: t }));

/** Mark done or reopen; marking done offers an undo. */
export async function setHandled(ms: Message[], handled: boolean) {
  try {
    await Promise.all(ms.map((m) => markHandled(m, handled)));
  } catch (e) {
    toast({ text: "Không cập nhật được, thử lại sau" });
    throw e;
  }
  if (handled) {
    toast({
      text: ms.length > 1 ? `Đã xử lý ${ms.length} tin` : "Đã đánh dấu xong",
      undo: () => Promise.all(ms.map((m) => markHandled(m, false))),
    });
  }
}

/** Multi-select for bulk "xong"; keys are "chat:message" so it works across groups. */
export function useSelection() {
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState<Map<string, Message>>(new Map());
  const key = (m: Message) => `${m.chat_id}:${m.message_id}`;
  const stop = () => {
    setOn(false);
    setPicked(new Map());
  };
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]")) stop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [on]);
  return {
    on,
    picked: [...picked.values()],
    has: (m: Message) => picked.has(key(m)),
    start: () => setOn(true),
    stop,
    toggle: (m: Message) =>
      setPicked((prev) => {
        const next = new Map(prev);
        if (!next.delete(key(m))) next.set(key(m), m);
        return next;
      }),
    setAll: (ms: Message[]) => setPicked(new Map(ms.map((m) => [key(m), m]))),
  };
}
export type Selection = ReturnType<typeof useSelection>;

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

/** j/k move, r reply, x done/reopen, a focus the AI prompt. Ignored while typing. */
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
          document.querySelector(`[data-id="${next.message_id}"]`)?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        }
      } else if (e.key === "r" && cur) onReply(cur);
      else if (e.key === "x" && cur && !cur.outgoing) setHandled([cur], !cur.handled).catch(() => {}); // the toast already reported it
      else if (e.key === "a") (document.getElementById("ai-prompt") as HTMLTextAreaElement | null)?.focus();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [items, focused, onReply]);
  return focused;
}

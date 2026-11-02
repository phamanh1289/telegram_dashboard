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
  timeZone: "Asia/Ho_Chi_Minh", hourCycle: "h23", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const vnParts = (d: Date) => Object.fromEntries(VN_PARTS.formatToParts(d).map((p) => [p.type, p.value]));

/** Vietnam time, 24h: "16:12, hôm nay", "09:05, hôm qua" (snoozes: "ngày mai"), else "16:12, 28/10/2026" (also `full`). */
export function timeLabel(date: string, full = false) {
  const p = vnParts(new Date(date));
  const time = `${p.hour}:${p.minute}`;
  return full ? `${time}, ${p.day}/${p.month}/${p.year}` : `${time}, ${dayLabel(date).toLocaleLowerCase("vi")}`;
}

const dayNo = (x: Record<string, string>) => Date.UTC(+x.year, +x.month - 1, +x.day) / 86_400_000;

/** Vietnam calendar day: "Hôm nay", "Hôm qua", "Ngày mai", else "28/10/2026". Also the key for day separators. */
export function dayLabel(date: string) {
  const p = vnParts(new Date(date));
  return { [-1]: "Hôm qua", 0: "Hôm nay", 1: "Ngày mai" }[dayNo(p) - dayNo(vnParts(new Date()))] ?? `${p.day}/${p.month}/${p.year}`;
}

/** "16:12" in Vietnam time, for rows under a day separator. */
export const clockLabel = (date: string) => {
  const p = vnParts(new Date(date));
  return `${p.hour}:${p.minute}`;
};

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

/** Minutes in the largest whole unit: [12, "phút"], [3, "giờ"], [2, "ngày"]. */
export const byUnit = (mins: number): [number, string] =>
  mins < 60 ? [mins, "phút"] : mins < 1440 ? [Math.floor(mins / 60), "giờ"] : [Math.floor(mins / 1440), "ngày"];

export function waitLabel(date: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(date).getTime()) / 60_000));
  const [n, unit] = byUnit(mins);
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
/** Row identity across groups ("chat:message"): message ids only count up per chat. Also a row's `data-key`. */
export const msgKey = (m: { chat_id: string | null; message_id: string | null }) => `${m.chat_id}:${m.message_id}`;

/** Scroll behaviour that respects reduced motion. */
export const smooth = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
/** Bring a list row (by `msgKey`) into view. */
export const scrollToRow = (key: string) =>
  document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest", behavior: smooth() });

/** How an AI Agent task runs; "terminal" only on old tasks (shown, no longer started). */
export const TASK_MODES: Record<string, string> = { plan: "Chỉ đọc", edit: "Được sửa file", terminal: "Terminal (cũ)" };

export const markHandled = (m: Message, handled: boolean) =>
  api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/handled`, {
    method: "PUT",
    json: { handled },
  });

export type ToastMsg = { text: string; undo?: () => unknown };
/** Show a toast (rendered by the inbox shell); `undo` adds a "Hoàn tác" button and the z shortcut. */
export const toast = (t: ToastMsg) => dispatchEvent(new CustomEvent<ToastMsg>("toast", { detail: t }));
/** Open the AI Agent page on this task (handled by the inbox shell). */
export const openTask = (id: string) => dispatchEvent(new CustomEvent<string>("open-task", { detail: id }));

/** Mark done or reopen; marking done offers an undo (for the ones that went through, if some failed). */
export async function setHandled(ms: Message[], handled: boolean) {
  const res = await Promise.allSettled(ms.map((m) => markHandled(m, handled)));
  const ok = ms.filter((_, i) => res[i].status === "fulfilled");
  const undo = handled && ok.length ? () => Promise.all(ok.map((m) => markHandled(m, false))) : undefined;
  const failed = res.find((r) => r.status === "rejected");
  if (failed) {
    toast({ text: ok.length ? `Chỉ cập nhật được ${ok.length}/${ms.length} tin, thử lại phần còn lại` : "Không cập nhật được, thử lại sau", undo });
    throw failed.reason;
  }
  if (handled) toast({ text: ms.length > 1 ? `Đã xử lý ${ms.length} tin` : "Đã đánh dấu xong", undo });
}


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
    const k = msgKey(t);
    byMessage.set(k, [...(byMessage.get(k) ?? []), t]);
  }
  return byMessage;
}

/** j/k move, r reply, x done/reopen, a focus the AI prompt. Ignored while typing. Returns the focused row's `msgKey`. */
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
      const i = actionable.findIndex((m) => msgKey(m) === focused);
      const cur = actionable[i];
      if (e.key === "j" || e.key === "k") {
        const next = actionable[e.key === "j" ? Math.min(actionable.length - 1, i + 1) : Math.max(0, i < 0 ? actionable.length - 1 : i - 1)];
        if (next) {
          setFocused(msgKey(next));
          scrollToRow(msgKey(next));
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

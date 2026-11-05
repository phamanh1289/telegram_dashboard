"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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

/** Lowercase without accents ("Luận" -> "luan") for forgiving search; anything else becomes its string (null: ""). */
export const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();

/** Local calendar day "YYYY-MM-DD" (Swedish locale = ISO order). */
export const ymd = (t: number | Date = Date.now()) => new Date(t).toLocaleDateString("sv");
/** Short day "2/11" from a time or a "YYYY-MM-DD" day. */
export const dm = (d: number | string) => {
  const [, m, day] = (typeof d === "string" ? d : ymd(d)).split("-");
  return `${+day}/${+m}`;
};

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

/** "vừa xong", "5 phút trước", "3 giờ trước", "2 ngày trước" (`t`: ms or ISO). */
export function ago(t: number | string, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - new Date(t).getTime()) / 60_000));
  return mins < 1 ? "vừa xong" : `${byUnit(mins).join(" ")} trước`;
}

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

export const markHandled = (m: Pick<Message, "chat_id" | "message_id">, handled: boolean, react = true) =>
  api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/handled`, {
    method: "PUT",
    json: { handled, react },
  });

export type ToastMsg = { text: string; undo?: () => unknown; action?: { label: string; run: () => unknown } };
/** Show a toast (rendered by the inbox shell); `undo` adds a "Hoàn tác" button and the z shortcut. */
export const toast = (t: ToastMsg) => dispatchEvent(new CustomEvent<ToastMsg>("toast", { detail: t }));
/** Copy and say so; a refused clipboard (no focus, permissions) says that instead of a false "Đã copy". */
export async function copyText(text: string, done = "Đã copy") {
  try { await navigator.clipboard.writeText(text); toast({ text: done }); } catch { toast({ text: "Không copy được, thử lại" }); }
}
/** Open the AI Agent page on this task (handled by the inbox shell). */
export const openTask = (id: string) => dispatchEvent(new CustomEvent<string>("open-task", { detail: id }));

/** Mark done or reopen; marking done offers an undo (for the ones that went through, if some failed).
 *  `react: false` ticks done without mirroring it as a Telegram reaction. */
export async function setHandled(ms: Message[], handled: boolean, react = true) {
  const res = await Promise.allSettled(ms.map((m) => markHandled(m, handled, react)));
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

/** Hide a tag from the to-do list until `until` (null: back now); the toast offers undo. */
export async function snooze(m: Message, until: Date | null) {
  const put = (u: Date | null) => api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/snooze`, { method: "PUT", json: { until: u?.toISOString() ?? null } });
  await put(until);
  toast(until ? { text: `Nhắc lại lúc ${timeLabel(until.toISOString())}`, undo: () => put(null) } : { text: "Đã bỏ hoãn" });
}

/** The task list query, without polling: rows read it through `select` (only the inbox shell and AI Agent poll). */
export const taskListQuery = {
  queryKey: ["tasks"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<Task[]>("/tasks", { signal }),
};

/** Every task handed to the AI. Polls while some task has no result yet (one poller: the inbox shell / AI Agent page). */
export function useTaskList() {
  return useQuery({
    ...taskListQuery,
    refetchInterval: (query) => (query.state.data?.some((t) => t.running) ? 10_000 : false),
  });
}

/** Short ID of an AI Agent session ("AI-e03a28"): the random tail of its id, shown and searched. */
export const sessionId = (t: { id: string }) => `AI-${t.id.slice(-6)}`;

/** Search the sessions: by ID (with or without "AI-"), title, tagged text, request or group. */
export function sessionMatches(t: Task, q: string) {
  const s = q.trim().toLowerCase().replace(/^#?ai-/, "");
  return !s || t.id.includes(s) || [t.title, t.message_text, t.prompt, t.chat_title].some((v) => v?.toLowerCase().includes(s));
}

/** Tasks created from tags, keyed "chat:message". One Map per task list, so memoised rows keep their props. */
export function useTasks() {
  const data = useQuery(taskListQuery).data;
  return useMemo(() => {
    const byMessage = new Map<string, Task[]>();
    for (const t of data ?? []) {
      if (!t.chat_id || !t.message_id) continue;
      const k = msgKey(t);
      const list = byMessage.get(k);
      if (list) list.push(t);
      else byMessage.set(k, [t]);
    }
    return byMessage;
  }, [data]);
}

/** Open a message in Telegram: the app for a message link, Telegram Web for a basic group (no message links there). */
export function openInTelegram(m: Message) {
  const l = telegramLink(m);
  if (l.exact) location.href = l.app;
  else window.open(l.web, "_blank", "noreferrer");
}

// "g" then a letter jumps to a page (the inbox shell handles it); list keys leave that letter alone.
let gAt = 0;
export const goKey = {
  arm: () => { gAt = Date.now(); },
  armed: () => Date.now() - gAt < 1500,
  take: () => { const on = Date.now() - gAt < 1500; gAt = 0; return on; },
};

/** Keys outside text fields act on the page, not on a focused control. */
export const typing = (e: KeyboardEvent) =>
  e.metaKey || e.ctrlKey || e.altKey || !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable], [role=dialog]");

/**
 * j/k move, Enter or r reply, o open in Telegram, x done/reopen, Shift+x done without a reaction, s snooze 1 hour,
 * p pin / unpin, a focus the AI prompt. Ignored while typing. `actions`: false on live (unstored) rows, which only move
 * and open. Returns the focused row's `msgKey`.
 */
export function useListShortcuts(
  items: Message[],
  onReply: (m: Message) => void,
  actions = true,
) {
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || goKey.armed()) return;
      // A reply open in the detail view covers the list: only "a" (AI prompt) still applies.
      if (e.key !== "a" && document.querySelector("form[aria-label='Soạn trả lời']")) return;
      // Enter on a focused button or link is that control's own click.
      if (e.key === "Enter" && (e.target as HTMLElement | null)?.closest?.("button, a, [role=menuitem]")) return;
      const actionable = items.filter((m) => !m.deleted);
      const i = actionable.findIndex((m) => msgKey(m) === focused);
      const cur = actionable[i];
      const tag = actions && cur && !cur.outgoing ? cur : null; // tag actions: stored, incoming
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; // Caps Lock: same keys
      if (k === "j" || k === "k") {
        const next = actionable[k === "j" ? Math.min(actionable.length - 1, i + 1) : Math.max(0, i < 0 ? actionable.length - 1 : i - 1)];
        if (next) {
          setFocused(msgKey(next));
          scrollToRow(msgKey(next));
        }
      } else if ((k === "r" || k === "Enter") && cur && actions) onReply(cur);
      else if (k === "o" && cur) openInTelegram(cur);
      else if (k === "x" && tag && !e.shiftKey) setHandled([tag], !tag.handled).catch(() => {}); // the toast already reported it
      else if (k === "x" && tag && !tag.handled) setHandled([tag], true, false).catch(() => {}); // Shift+x: no reaction
      else if (k === "s" && tag && !tag.handled) snooze(tag, new Date(Date.now() + 3600_000)).catch(() => toast({ text: "Không hoãn được, thử lại" }));
      else if (k === "p" && tag) {
        pin(tag, !tag.pinned).then(() => toast({ text: tag.pinned ? "Đã bỏ ghim" : "Đã ghim" }), () => toast({ text: "Không ghim được, thử lại" }));
      } else if (k === "a") (document.getElementById("ai-prompt") as HTMLTextAreaElement | null)?.focus();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [items, focused, onReply, actions]);
  return focused;
}

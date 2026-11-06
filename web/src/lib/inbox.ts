"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, errorText, type HandledAllResponse, type Message, type PendingItem, type RuleAdded, type Task } from "@/lib/api";
import { getPref, put, readOverdueHours } from "@/lib/prefs";
import { byUnit, timeLabel } from "@/lib/time";

/** Pending tags across groups (or the pinned archive); one cache shared by the inbox and the sidebar. */
export function pendingQuery(range: string, pinned = false) {
  return {
    queryKey: pinned ? ["pending", "pinned"] : ["pending", range],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<PendingItem[]>(pinned ? "/pinned" : `/pending${range ? `?${range}` : ""}`, { signal }),
  };
}

/** Lowercase without accents ("Luận" -> "luan") for forgiving search; anything else becomes its string (null: ""). */
export const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();

/** Message text plus the URLs hidden behind its words, so an agent can open them. */
export function textWithLinks({ text, links = [] }: Message) {
  const urls = links.filter((l) => l.kind === "link" && l.url); // not bold/code/mentions: those have no URL
  if (!urls.length) return text;
  return `${text}\n\nLiên kết trong tin:\n${urls.map((l) => `- "${text.slice(l.offset, l.offset + l.length)}": ${l.url}`).join("\n")}`;
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

/** An error whose message is meant for the user (the toaster shows it as is). */
export class Told extends Error {}
/** Undo several tags: every request runs; a partial failure says how many went through. */
async function undoAll(ps: Promise<unknown>[]) {
  const res = await Promise.allSettled(ps);
  const bad = res.filter((r) => r.status === "rejected").length;
  if (bad) throw new Told(bad < ps.length ? `Chỉ hoàn tác được ${ps.length - bad}/${ps.length} tin, thử lại phần còn lại` : "Không hoàn tác được");
}

/** Mark done or reopen; marking done offers an undo (for the ones that went through, if some failed).
 *  `react: false` ticks done without mirroring it as a Telegram reaction. A tag marked done drops its reply draft. */
export async function setHandled(ms: Message[], handled: boolean, react = true) {
  const res = await Promise.allSettled(ms.map((m) => markHandled(m, handled, react)));
  const ok = ms.filter((_, i) => res[i].status === "fulfilled");
  if (handled) ok.forEach(dropDraft);
  const undo = handled && ok.length ? () => undoAll(ok.map((m) => markHandled(m, false))) : undefined;
  const failed = res.find((r) => r.status === "rejected");
  if (failed) {
    toast({ text: ok.length ? `Chỉ cập nhật được ${ok.length}/${ms.length} tin, thử lại phần còn lại` : errorText(failed.reason, {}, "Không cập nhật được, thử lại sau"), undo });
    throw new PartialError(ms.filter((_, i) => res[i].status === "rejected"));
  }
  if (handled) toast({ text: ms.length > 1 ? `Đã xử lý ${ms.length} tin` : "Đã đánh dấu xong", undo });
}

/** Thrown after a toast already reported it: `failed` are the tags that did not go through (kept selected). */
export class PartialError extends Error {
  constructor(public failed: Message[]) { super("partial"); }
}

export const pin = (m: Message, pinned: boolean) =>
  api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/pin`, {
    method: "PUT",
    json: { pinned },
  });

/** Pin several; reports "x/y" when some fail and throws `PartialError` with those. */
export async function pinAll(ms: Message[]) {
  const res = await Promise.allSettled(ms.map((m) => pin(m, true)));
  const failed = ms.filter((_, i) => res[i].status === "rejected");
  toast({ text: !failed.length ? `Đã ghim ${ms.length} tin` : `Chỉ ghim được ${ms.length - failed.length}/${ms.length} tin, thử lại phần còn lại` });
  if (failed.length) throw new PartialError(failed);
}

/** Hide tags from the to-do list until `until` (null: back now); the toast offers undo (for the ones that went through).
 *  Throws `PartialError` (after its own toast) when some did not go through. */
export async function snooze(ms: Message[], until: Date | null) {
  const set = (m: Message, u: Date | null) => api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/snooze`, { method: "PUT", json: { until: u?.toISOString() ?? null } });
  const res = await Promise.allSettled(ms.map((m) => set(m, until)));
  const ok = ms.filter((_, i) => res[i].status === "fulfilled");
  if (!ok.length) throw (res[0] as PromiseRejectedResult).reason;
  const undo = until ? () => undoAll(ok.map((m) => set(m, null))) : undefined;
  if (ok.length < ms.length) {
    toast({ text: `Chỉ hoãn được ${ok.length}/${ms.length} tin, thử lại phần còn lại`, undo });
    throw new PartialError(ms.filter((_, i) => res[i].status === "rejected"));
  }
  const n = ok.length > 1 ? `${ok.length} tin, ` : "";
  toast(until ? { text: `Đã hoãn ${n}nhắc lại lúc ${timeLabel(until.toISOString())}`, undo } : { text: "Đã bỏ hoãn" });
}

/** One message: the kept copy, else live from Telegram. */
export const getMessage = (chatId: string, messageId: string, { signal }: { signal?: AbortSignal } = {}) =>
  api<Message>(`/chats/${encodeURIComponent(chatId)}/messages/${messageId}`, { signal });

/** Open the reply panel on a message, optionally with a prefilled line (the inbox shell listens). */
export const openReply = (m: Message, text?: string) => dispatchEvent(new CustomEvent<{ m: Message; text?: string }>("open-reply", { detail: { m, text } }));
/** Load one message and open the reply panel on it; false (after a toast) when it could not be loaded. */
export async function openReplyById(chatId: string, messageId: string, text?: string) {
  try {
    openReply(await getMessage(chatId, messageId), text);
    return true;
  } catch (e) {
    toast({ text: errorText(e, {}, "Không mở được tin gốc, thử lại sau") });
    return false;
  }
}

/** Mark every open tag of a group done (within the day range); Undo reopens exactly those, without reactions. */
export async function markAllHandled(chatId: string, range: string) {
  const { count, message_ids } = await api<HandledAllResponse>(
    `/chats/${encodeURIComponent(chatId)}/handled-all${range ? `?${range}` : ""}`, { method: "POST" });
  const ms = message_ids.map((id) => ({ chat_id: chatId, message_id: String(id) }));
  ms.forEach(dropDraft);
  toast({ text: `Đã xử lý ${count} tin`, undo: ms.length ? () => undoAll(ms.map((m) => markHandled(m, false, false))) : undefined });
}

/** "Luôn bỏ qua {tên}": a sender rule clears their open tags now and later; Undo deletes it and reopens those. */
export async function ignoreSender(m: Message) {
  const name = m.sender_name ?? "người này";
  const r = await api<RuleAdded>("/rules", { method: "POST", json: { kind: "sender", value: m.sender_id, label: name } });
  r.cleared.forEach(dropDraft);
  toast({
    text: `Luôn bỏ qua ${name}: đã dọn ${r.cleared.length} tin`,
    undo: async () => {
      try { await api<void>(`/rules/${r.rule.id}`, { method: "DELETE" }); } catch {
        throw new Told("Chưa xóa được quy tắc: xóa ở Công cụ › Quy tắc"); // reopening the tags now would just clear them again
      }
      await undoAll(r.cleared.map((c) => markHandled(c, false, false)));
    },
  });
}

// Reply drafts, per tag, in this browser only (never sent to the server). A tag marked done here drops its draft;
// ponytail: one handled elsewhere (phone, another browser) keeps it until replaced or Settings › "Xóa nháp".
export const draftKey = (m: { chat_id: string; message_id: string }) => `draft:${msgKey(m)}`;
/** Store (or, for blank text, drop) a tag's draft; false when this browser refused to store it. */
export function saveDraft(m: { chat_id: string; message_id: string }, text: string) {
  const ok = put(draftKey(m), text.trim() ? text : null);
  dispatchEvent(new Event("drafts"));
  return ok;
}
const dropDraft = (m: { chat_id: string; message_id: string }) => saveDraft(m, "");
/** Drop the saved drafts of one group (its data was deleted), or all of them (Settings › "Xóa nháp"). */
export function clearDrafts(chatId?: string) {
  const prefix = chatId ? `draft:${chatId}:` : "draft:";
  try { Object.keys(localStorage).filter((k) => k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k)); } catch {}
  dispatchEvent(new Event("drafts"));
}
const onDrafts = (f: () => void) => { addEventListener("drafts", f); addEventListener("storage", f); return () => { removeEventListener("drafts", f); removeEventListener("storage", f); }; };
/** True while this tag has an unsent reply draft (the row's "Nháp" chip). */
export const useHasDraft = (m: { chat_id: string; message_id: string }) => useSyncExternalStore(onDrafts, () => !!getPref(draftKey(m)), () => false);

/** The reply form (composer); while it covers the list, list keys stay off. */
export const COMPOSER = "form[data-composer]";

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
 * p pin / unpin, a focus the AI prompt, Space select (`onPick`). Ignored while typing. `actions`: false on live
 * (unstored) rows, which only move and open. Returns the focused row's `msgKey`.
 */
export function useListShortcuts(
  items: Message[],
  onReply: (m: Message) => void,
  actions = true,
  { onPick, initial = null }: { onPick?: (m: Message) => void; initial?: string | null } = {},
) {
  const [focused, setFocused] = useState<string | null>(initial); // initial: msgKey to start selected (e.g. "Mở nhóm")
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || goKey.armed()) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; // Caps Lock: same keys
      // A reply open covers the list: only "a" (AI prompt) still applies.
      if (k !== "a" && document.querySelector(COMPOSER)) return;
      // Enter / Space on a focused button or link is that control's own click.
      if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement | null)?.closest?.("button, a, [role=menuitem]")) return;
      const actionable = items.filter((m) => !m.deleted);
      const i = actionable.findIndex((m) => msgKey(m) === focused);
      const cur = actionable[i];
      const tag = actions && cur && !cur.outgoing ? cur : null; // tag actions: stored, incoming
      if (k === "j" || k === "k") {
        const next = actionable[k === "j" ? Math.min(actionable.length - 1, i + 1) : Math.max(0, i < 0 ? actionable.length - 1 : i - 1)];
        if (next) {
          setFocused(msgKey(next));
          scrollToRow(msgKey(next));
        }
      } else if (k === " " && tag && onPick) onPick(tag); else if ((k === "r" || k === "Enter") && cur && actions) onReply(cur);
      else if (k === "o" && cur) openInTelegram(cur);
      else if (k === "x" && tag && !e.shiftKey) setHandled([tag], !tag.handled).catch(() => {}); // the toast already reported it
      else if (k === "x" && tag && !tag.handled) setHandled([tag], true, false).catch(() => {}); // Shift+x: no reaction
      else if (k === "s" && tag && !tag.handled) snooze([tag], new Date(Date.now() + 3600_000)).catch((err) => toast({ text: errorText(err, {}, "Không hoãn được, thử lại") }));
      else if (k === "p" && tag) {
        pin(tag, !tag.pinned).then(() => toast({ text: tag.pinned ? "Đã bỏ ghim" : "Đã ghim" }), (err) => toast({ text: errorText(err, {}, "Không ghim được, thử lại") }));
      } else if (k === "a") (document.getElementById("ai-prompt") as HTMLTextAreaElement | null)?.focus();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [items, focused, onReply, actions, onPick]);
  return focused;
}

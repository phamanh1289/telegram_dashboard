"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, errorText, type HandledAllResponse, type Message, type PendingItem, type RuleAdded, type Task } from "@/lib/api";
import { type Key, t } from "@/lib/i18n";
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
/** "Hôm nay": every source of work in one list (the default page). */
export const TODAY = "__today__";
/** Pseudo chat id for the pinned-tags page. */
export const PINNED = "__pinned__";
/** Pseudo chat id for the AI sessions page. */
export const TASKS = "__tasks__";
/** Pseudo chat id for the cross-group Digest briefing. */
export const BRIEFING = "__briefing__";
/** Pseudo chat id for the cross-group Q&A page. */
export const QA = "__qa__";

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

export function waitLabel(date: string, now: number, priority = false) {
  const mins = Math.max(0, Math.round((now - new Date(date).getTime()) / 60_000));
  const [n, unit] = byUnit(mins);
  return { text: t("chờ {span}", { span: `${n} ${unit}` }), n, unit, overdue: mins >= readOverdueHours() * 60 * (priority ? 0.5 : 1) }; // priority sender: half the wait
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
export const TASK_MODES: Record<string, Key> = { plan: "Chỉ đọc", edit: "Được sửa file", terminal: "Terminal (cũ)" };

export const markHandled = (m: Pick<Message, "chat_id" | "message_id">, handled: boolean, react = true) =>
  api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/handled`, {
    method: "PUT",
    json: { handled, react },
  });

export type ToastMsg = { text: string; undo?: () => unknown; action?: { label: string; run: () => unknown } };
/** Show a toast (rendered by the inbox shell); `undo` adds a "Hoàn tác" button and the z shortcut. */
export const toast = (t: ToastMsg) => dispatchEvent(new CustomEvent<ToastMsg>("toast", { detail: t }));
/** Copy and say so; a refused clipboard (no focus, permissions) says that instead of a false "Đã copy". */
export async function copyText(text: string, done = t("Đã copy")) {
  try { await navigator.clipboard.writeText(text); toast({ text: done }); } catch { toast({ text: t("Không copy được, thử lại") }); }
}
/** Open the AI Agent page on this task (handled by the inbox shell). */
export const openTask = (id: string) => dispatchEvent(new CustomEvent<string>("open-task", { detail: id }));

/** An error whose message is meant for the user (the toaster shows it as is). */
export class Told extends Error {}
/** Undo several tags: every request runs; a partial failure says how many went through. */
async function undoAll(ps: Promise<unknown>[]) {
  const res = await Promise.allSettled(ps);
  const bad = res.filter((r) => r.status === "rejected").length;
  if (bad) throw new Told(bad < ps.length ? t("Chỉ hoàn tác được {ok}/{n} tin, thử lại phần còn lại", { ok: ps.length - bad, n: ps.length }) : t("Không hoàn tác được"));
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
    toast({ text: ok.length ? t("Chỉ cập nhật được {ok}/{n} tin, thử lại phần còn lại", { ok: ok.length, n: ms.length }) : errorText(failed.reason, {}, t("Không cập nhật được, thử lại sau")), undo });
    throw new PartialError(ms.filter((_, i) => res[i].status === "rejected"));
  }
  if (handled) toast({ text: ms.length > 1 ? t("Đã xử lý {n} tin", { n: ms.length }) : t("Đã đánh dấu xong"), undo });
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
  toast({ text: !failed.length ? t("Đã ghim {n} tin", { n: ms.length }) : t("Chỉ ghim được {ok}/{n} tin, thử lại phần còn lại", { ok: ms.length - failed.length, n: ms.length }) });
  if (failed.length) throw new PartialError(failed);
}

/** Hide tags from the to-do list until `until` (null: back now); the toast offers undo (for the ones that went through).
 *  Throws `PartialError` (after its own toast) when some did not go through. */
/** Event snoozes ("until a reply", "until VA-1 is done") also keep a time: this far out, so nothing hides for good. */
export const EVENT_SNOOZE_MS = 7 * 86_400_000;

/** `on`: "reply" or "ticket:<ID>", the event that brings the tags back before `until`. */
export async function snooze(ms: Message[], until: Date | null, on?: string) {
  const set = (m: Message, u: Date | null) => api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/snooze`, { method: "PUT", json: { until: u?.toISOString() ?? null, on: u && on ? on : null } });
  const res = await Promise.allSettled(ms.map((m) => set(m, until)));
  const ok = ms.filter((_, i) => res[i].status === "fulfilled");
  if (!ok.length) throw (res[0] as PromiseRejectedResult).reason;
  const undo = until ? () => undoAll(ok.map((m) => set(m, null))) : undefined;
  if (ok.length < ms.length) {
    toast({ text: t("Chỉ hoãn được {ok}/{n} tin, thử lại phần còn lại", { ok: ok.length, n: ms.length }), undo });
    throw new PartialError(ms.filter((_, i) => res[i].status === "rejected"));
  }
  const when = on === "reply" ? t("tới khi có người trả lời") : on ? t("tới khi {id} xong", { id: on.slice(7) }) : t("nhắc lại lúc {time}", { time: timeLabel(until?.toISOString() ?? "") });
  const text = ok.length > 1 ? t("Đã hoãn {n} tin, {when}", { n: ok.length, when }) : t("Đã hoãn {when}", { when });
  toast(until ? { text, undo } : { text: t("Đã bỏ hoãn") });
}

/** One message: the kept copy, else live from Telegram. */
export const getMessage = (chatId: string, messageId: string, { signal }: { signal?: AbortSignal } = {}) =>
  api<Message>(`/chats/${encodeURIComponent(chatId)}/messages/${messageId}`, { signal });

/** Open the reply panel on a message, optionally with a prefilled line (the inbox shell listens). */
export const openReply = (m: Message, text?: string) => dispatchEvent(new CustomEvent<{ m: Message; text?: string }>("open-reply", { detail: { m, text } }));
let codeAsk = "";
/** "Trả lời từ code" on a message row: open its reply panel, which runs the answer (`takeCodeAsk`; "ask-code" when open). */
export const askCode = (m: Message) => { codeAsk = msgKey(m); openReply(m); dispatchEvent(new CustomEvent<string>("ask-code", { detail: codeAsk })); };
export const takeCodeAsk = (key: string) => { if (codeAsk !== key) return false; codeAsk = ""; return true; };
/** Load one message and open the reply panel on it; false (after a toast) when it could not be loaded. */
export async function openReplyById(chatId: string, messageId: string, text?: string) {
  try {
    openReply(await getMessage(chatId, messageId), text);
    return true;
  } catch (e) {
    toast({ text: errorText(e, {}, t("Không mở được tin gốc, thử lại sau")) });
    return false;
  }
}

/** Mark every open tag of a group done (within the day range); Undo reopens exactly those, without reactions. */
/** `skip`: open tags the list leaves to Q&A (`useChats().qaHidden`), so they stay open there. */
export async function markAllHandled(chatId: string, range: string, skip: readonly string[] = []) {
  const qs = [range, ...skip.map((id) => `skip=${encodeURIComponent(id)}`)].filter(Boolean).join("&");
  const { count, message_ids } = await api<HandledAllResponse>(
    `/chats/${encodeURIComponent(chatId)}/handled-all${qs ? `?${qs}` : ""}`, { method: "POST" });
  const ms = message_ids.map((id) => ({ chat_id: chatId, message_id: String(id) }));
  ms.forEach(dropDraft);
  toast({ text: t("Đã xử lý {n} tin", { n: count }), undo: ms.length ? () => undoAll(ms.map((m) => markHandled(m, false, false))) : undefined });
}

/** "Luôn bỏ qua {tên}": a sender rule clears their open tags now and later; Undo deletes it and reopens those. */
export async function ignoreSender(m: Message) {
  const name = m.sender_name ?? t("người này");
  const r = await api<RuleAdded>("/rules", { method: "POST", json: { kind: "sender", value: m.sender_id, label: name } });
  r.cleared.forEach(dropDraft);
  toast({
    text: t("Luôn bỏ qua {name}: đã dọn {n} tin", { name, n: r.cleared.length }),
    undo: async () => {
      try { await api<void>(`/rules/${r.rule.id}`, { method: "DELETE" }); } catch {
        throw new Told(t("Chưa xóa được quy tắc: xóa ở Cài đặt › Telegram › Luôn bỏ qua")); // reopening the tags now would just clear them again
      }
      await undoAll(r.cleared.map((c) => markHandled(c, false, false)));
    },
  });
}

/** "Luôn ưu tiên {tên}": their tags sort first in Việc cần xử lý and turn overdue at half the time (replaces a "Luôn bỏ
 *  qua" on the same sender); Undo deletes the rule. */
export async function prioritizeSender(m: Message) {
  const name = m.sender_name ?? t("người này");
  const r = await api<RuleAdded>("/rules", { method: "POST", json: { kind: "priority", value: m.sender_id, label: name } });
  toast({ text: t("Luôn ưu tiên {name}: tin của họ lên đầu danh sách", { name }), undo: () => api<void>(`/rules/${r.rule.id}`, { method: "DELETE" }) });
}

/** "Nhắc lại sau": reopen a tag (answered or done) and keep it hidden until `until`, when it comes back to Việc cần xử
 *  lý ("để mình check rồi báo" stays on your list). Undo marks it done again, quietly. */
export async function remind(m: Pick<Message, "chat_id" | "message_id">, until: Date) {
  await api<void>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/remind`, { method: "PUT", json: { until: until.toISOString() } });
  toast({ text: t("Sẽ nhắc lại tin này lúc {time}", { time: timeLabel(until.toISOString()) }), undo: () => markHandled(m, true, false) });
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

/** Short ID of an AI Agent session ("REF-e03a28"): the random tail of its id, shown and searched. A neutral prefix, so
 *  asks posted to groups don't read as AI-made; asks posted before carry the old "AI-". */
export const sessionId = (t: { id: string }) => `REF-${t.id.slice(-6)}`;
/** "#REF-97c501" (or the old "#AI-97c501") in a message; group 1 is the session id's tail. */
export const SESSION_CODE = /#(?:REF|AI)-(\w{6})\b/gi;
/** "#QA128734" in a message: the Q&A question with that id in the message's own group. */
export const QA_CODE = /#QA(\d+)\b/gi;
/** Answer someone's message with Q&A: the Q&A page of its group opens replying to it (the reply gets a code line and
 *  the message leads the new thread). Held until that group's page takes it, so it works whether or not it is open. */
let qaAnswer: Message | null = null;
export const answerQa = (m: Message) => { qaAnswer = m; dispatchEvent(new CustomEvent<Message>("qa-answer", { detail: m })); };
export function takeQaAnswer(chatId: string) {
  const m = qaAnswer?.chat_id === chatId ? qaAnswer : null;
  if (m) qaAnswer = null;
  return m;
}
/** `msgKey` → "#QA…" of every message in a Q&A thread of the groups asked lately (Q&A page `useQaNews`): a tag that
 *  answers one shows its badge even without the code in its text. Empty on the Q&A page itself (the card says it). */
export const QaCodes = createContext<ReadonlyMap<string, string>>(new Map());
/** A tag the Q&A page shows (it names a #QA code, or sits in a thread of `codes`): tag lists and their counts leave it
 *  to Q&A, so it is not listed twice. */
export const inQaPage = (codes: ReadonlyMap<string, string>, m: Message) => codes.has(msgKey(m)) || /#QA\d+\b/i.test(m.text ?? "");
/** Open the Q&A page on one thread: its group and "#QA…" code (the inbox shell listens). */
export const openQa = (chatId: string, code: string) => dispatchEvent(new CustomEvent<{ chatId: string; code: string }>("open-qa", { detail: { chatId, code } }));

/** Search the sessions: by ID (with or without "REF-" / "AI-"), title, tagged text, request or group. */
export function sessionMatches(t: Task, q: string) {
  const s = q.trim().toLowerCase().replace(/^#?(?:ref|ai)-/, "");
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
  // The focused row left the list (done, snoozed, a bulk action): the row now at its place takes the cursor.
  const [prev, setPrev] = useState(items);
  if (prev !== items) {
    setPrev(items);
    const old = prev.findIndex((m) => msgKey(m) === focused);
    if (old >= 0 && items.length && !items.some((m) => msgKey(m) === focused)) setFocused(msgKey(items[Math.min(old, items.length - 1)]));
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || goKey.armed() || e.defaultPrevented) return;
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
      else if (k === "s" && tag && !tag.handled) snooze([tag], new Date(Date.now() + 3600_000)).catch((err) => toast({ text: errorText(err, {}, t("Không hoãn được, thử lại")) }));
      else if (k === "p" && tag) {
        pin(tag, !tag.pinned).then(() => toast({ text: tag.pinned ? t("Đã bỏ ghim") : t("Đã ghim") }), (err) => toast({ text: errorText(err, {}, t("Không ghim được, thử lại")) }));
      } else if (k === "a") (document.getElementById("ai-prompt") as HTMLTextAreaElement | null)?.focus();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [items, focused, onReply, actions, onPick]);
  // A row reached with Tab (or a click on its controls) becomes the cursor row, so x / s / p act on what has focus.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const k = (e.target as HTMLElement | null)?.closest?.("[data-key]")?.getAttribute("data-key");
      if (k && items.some((m) => msgKey(m) === k)) setFocused(k);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [items]);
  return focused;
}

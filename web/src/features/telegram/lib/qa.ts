"use client";

import { useIsFetching, useQueries, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api, errorText, type Member, type Message, type QaItem } from "@/shared/lib/api";
import { t as tr } from "@/shared/lib/i18n";
import { msgKey, openQa, QA_CODE, qaAskKey } from "@/features/telegram/lib/inbox";
import { useNow } from "@/shared/hooks/use-now";
import { toast } from "@/shared/lib/notifications";
import { getPref, notifyPreview, onPrefs, readNotify, readQaAnswerBy, setPref, useQaRemind } from "@/shared/lib/prefs";
import { parsePref, QA_RECENT } from "@/features/telegram/lib/qa-recent";
import { timeLabel } from "@/shared/lib/time";

// Q&A threads (backend /api/qa, live from Telegram): queries, what counts as answered / late, and the per-browser
// state (seen, settled, muted) shared by the Q&A page, its sidebar and the Today page.

export const qaQuery = (chatId: string, days: number) => ({
  queryKey: ["qa", chatId, days],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<QaItem[]>(`/qa?chat_id=${encodeURIComponent(chatId)}&days=${days}`, { signal }),
  staleTime: 60_000,
});

// This browser only: groups you posted Q&A to (they lead the sidebar and are watched for answers), and per thread
// code the newest message id you have seen (later replies are "Mới").
export const SEEN = "qa-seen";
export type Seen = Record<string, number>;
export const useStored = <T,>(key: string, fallback: T) => parsePref(useSyncExternalStore(onPrefs, () => getPref(key), () => null), fallback);
/** Groups you asked lately, newest first (the Q&A page opens on the first). */
export const useQaRecent = () => useStored<string[]>(QA_RECENT, []);
// ponytail: one entry per thread ever seen, never pruned; prune by age if it ever grows large
export function markSeen(pairs: [string, number][]) {
  const seen = parsePref<Seen>(getPref(SEEN), {});
  const more = pairs.filter(([code, id]) => (seen[code] ?? 0) < id);
  if (more.length) setPref(SEEN, JSON.stringify({ ...seen, ...Object.fromEntries(more) }));
}

export const thread = (i: QaItem) => [i.question, ...i.answers];
export const latest = (i: QaItem) => i.answers.at(-1) ?? i.question;
/** A thread's last activity (its rail order and day). */
export const atOf = (i: QaItem) => new Date(latest(i).date).getTime();
/** Others' messages after the newest one seen in this thread (all of them in a thread never opened here). */
export const fresh = (i: QaItem, seen: Seen) => thread(i).filter((m) => !m.outgoing && Number(m.message_id) > (seen[i.code] ?? 0));
// "Chốt": the reply you marked as a thread's answer, code → message id (this browser).
// ponytail: ids only in localStorage, like qa-seen; a backend table if it must follow you to another browser.
const RESOLVED = "qa-resolved";
export const resolvedIds = () => parsePref<Record<string, string>>(getPref(RESOLVED), {});
export function resolve(code: string, id: string | null) {
  const r = resolvedIds();
  if (id) r[code] = id;
  else delete r[code];
  setPref(RESOLVED, JSON.stringify(r));
}
export const accepted = (i: QaItem) => { const id = resolvedIds()[i.code]; return id ? i.answers.find((a) => a.message_id === id) : undefined; };

// Xong / Xóa: backend `qa_marks` (follows you to any browser). Xong closes the thread whatever its answers: no nudge,
// not waiting. Xóa drops it from the dashboard's Q&A only (Telegram keeps the messages). null undoes either.
export type QaMark = "done" | "deleted" | null;
async function markQa(qc: QueryClient, i: QaItem, state: QaMark) {
  const chatId = i.question.chat_id;
  await api("/qa/mark", { method: "PUT", json: { chat_id: chatId, code: i.code, state } });
  qc.setQueriesData<QaItem[]>({ queryKey: ["qa", chatId] }, (d) => d && (state === "deleted"
    ? d.filter((x) => x.code !== i.code) : d.map((x) => (x.code === i.code ? { ...x, done: state === "done" } : x))));
  void qc.invalidateQueries({ queryKey: ["qa", chatId] }); // undoing a Xóa brings the thread back
  if (state !== "deleted") void qc.invalidateQueries({ queryKey: ["tasks"] }); // Xong moves the thread's tags: their sessions follow
}
/** Mark with a toast (undo restores what it was); a failed call says so. */
export async function markWithUndo(qc: QueryClient, i: QaItem, state: QaMark) {
  const was: QaMark = i.done ? "done" : null;
  try {
    await markQa(qc, i, state);
    toast({ text: state === "deleted" ? tr("Đã xóa {code} khỏi Q&A", { code: i.code }) : state ? tr("Đã đánh dấu xong {code}", { code: i.code }) : tr("Đã mở lại {code}", { code: i.code }),
      undo: () => void markQa(qc, i, was) });
  } catch (e) {
    toast({ text: errorText(e, {}, tr("Không lưu được, thử lại")) });
  }
}
/** Xóa threads (one row, a whole day) with one toast whose undo brings them all back as they were. */
export async function deleteWithUndo(qc: QueryClient, its: QaItem[]) {
  const r = await Promise.allSettled(its.map((i) => markQa(qc, i, "deleted")));
  const ok = its.filter((_, k) => r[k].status === "fulfilled");
  const failed = its.length - ok.length;
  if (!ok.length) return toast({ text: errorText((r[0] as PromiseRejectedResult).reason, {}, tr("Không xóa được, thử lại")) });
  toast({
    text: `${ok.length > 1 ? tr("Đã xóa {n} Q&A", { n: ok.length }) : tr("Đã xóa {code} khỏi Q&A", { code: ok[0].code })}${failed ? tr(", {n} câu không xóa được", { n: failed }) : ""}`,
    undo: () => void Promise.all(ok.map((i) => markQa(qc, i, i.done ? "done" : null)))
      .catch((e) => toast({ text: errorText(e, {}, tr("Không khôi phục được, thử lại")) })),
  });
}
/** Still waiting on someone: not answered and not marked Xong. */
export const waiting = (i: QaItem) => !i.done && !answered(i);

/** A Telegram @username (not an e-mail address): only a message that tags someone opens a Q&A (backend `has_tag`). */
const TAG = /(?<![\w.])@(\w{5,32})/g;
export const hasTag = (s: string) => new RegExp(TAG.source).test(s) || s.includes("](tg://user?id="); // or tagged by name (@ popup)
/** Answered: you marked an answer, or someone other than the asker replied (the asker's own "up" / thanks is no
 *  answer); by default (Cài đặt › "Người được tag") only a reply from someone the question tagged (@username or a
 *  name mention) counts, when it tagged anyone. Reads its prefs live: pages re-render on a prefs change (`useNow`). */
export function answered(i: QaItem) {
  if (accepted(i)) return true;
  const others = i.answers.filter((a) => a.sender_id !== i.question.sender_id);
  if (readQaAnswerBy() !== "tagged") return others.length > 0;
  const q = i.question;
  const names = new Set([...q.text.matchAll(TAG)].map((x) => x[1].toLowerCase()));
  const ids = new Set(q.links.flatMap((l) => (l.kind === "mention" && l.url.startsWith("tg://user?id=") ? [l.url.slice(13)] : [])));
  if (!names.size && !ids.size) return others.length > 0;
  return others.some((a) => (!!a.sender_username && names.has(a.sender_username.toLowerCase())) || (!!a.sender_id && ids.has(a.sender_id)));
}
export const who = (m: Message) => (m.outgoing ? tr("Bạn") : m.sender_name || tr("Ẩn danh"));
export function transcript(i: QaItem, title?: string) {
  const a = accepted(i);
  return [`Q&A ${i.code}${title ? ` · ${title}` : ""}`, ...(a ? [`${tr("Câu trả lời đã chốt")}: ${who(a)}: ${a.text}`] : []),
    ...thread(i).map((m) => `${who(m)} (${timeLabel(m.date, true)}): ${m.text || tr("[Tệp đính kèm]")}`)].join("\n\n");
}
/** The text without a "#QA…" code at its end (the line the dashboard adds): the thread names its code once. */
const CODE_TAIL = new RegExp(`\\s*${QA_CODE.source}\\s*$`, "i"); // QA_CODE, at the end of the text
export function untag(m: Message): Message {
  const cut = m.text.search(CODE_TAIL);
  return cut < 0 ? m : { ...m, text: m.text.slice(0, cut), links: m.links.filter((l) => l.offset + l.length <= cut) };
}
export const gist = (m: Message) => untag(m).text.trim() || tr("[Tệp đính kèm]");

// Nudges: your question nobody answered a while (Cài đặt / the Q&A toolbar) after you last spoke in it asks you to
// nudge the group, unless you muted it (this browser). ponytail: muted codes never pruned, like qa-seen.
export const MUTED = "qa-muted";
export function mute(code: string, off: boolean) {
  const s = new Set(parsePref<string[]>(getPref(MUTED), []));
  if (off) s.add(code);
  else s.delete(code);
  setPref(MUTED, JSON.stringify([...s]));
}
/** When you last spoke in your own question's thread: the question, or your latest nudge / follow-up. */
export const lastOwn = (i: QaItem) => thread(i).findLast((m) => m.outgoing)?.date ?? i.question.date;
export const isLate = (i: QaItem, mins: number, now: number, muted: readonly string[]) =>
  mins > 0 && i.question.outgoing && waiting(i) && !muted.includes(i.code) && now - new Date(lastOwn(i)).getTime() >= mins * 60_000;
/** The nudge put in the box (polite, peer to peer, short): the people the question tagged, else everyone (a reply to
 *  the question, so it is quoted). Vietnamese whatever the UI language: it goes to the group. */
export function nudgeText(i: QaItem, members: readonly Member[] = []) { // members: a name tag goes as its @username when it has one
  const q = i.question;
  const named = Object.entries(nameTags(q)).map(([at, id]) => { const u = members.find((m) => m.user_id === id)?.username; return u ? `@${u}` : at; });
  const ats = [...new Set([...[...q.text.matchAll(TAG)].map((x) => `@${x[1]}`), ...named])].join(" ");
  return `Nhờ ${ats || "mọi người"} xem giúp phần này nha.`;
}
/** The members a message tagged by name (no @username: a mention entity), "@Name" → user id: a box answering it
 *  sends those "@Name" as tags again (useMention `known`). */
export function nameTags(m: Message | null): Record<string, string> {
  return Object.fromEntries((m?.links ?? []).flatMap((l) => l.kind === "mention" && l.url.startsWith("tg://user?id=")
    ? [[`@${m!.text.slice(l.offset, l.offset + l.length).replace(/^@|[[\]\n]/g, "").trim()}`, l.url.slice(13)] as const] : [])
    .filter(([at]) => at.length > 1));
}
/** A desktop notification once per wait ("code@your last message") when one of your questions turns late while the
 *  tab is hidden (Cài đặt › Thông báo); a late one seen while the tab is visible is only marked, never notified later. */
const notified = new Set<string>();
function notifyLate(items: QaItem[], preview: boolean) {
  for (const i of items) {
    const key = `${i.code}@${lastOwn(i)}`;
    if (notified.has(key)) continue;
    notified.add(key);
    if (!document.hidden || !readNotify()) continue;
    try {
      const n = new Notification(tr("Chưa ai trả lời · {group}", { group: i.chat_title }), { body: preview ? gist(i.question).slice(0, 200) : i.code, tag: `qa:${i.code}` });
      n.onclick = () => { focus(); openQa(i.question.chat_id, i.code); n.close(); };
    } catch {} // no Notification constructor here (Android Chrome, webviews)
  }
}

const dataOf = (rs: UseQueryResult<QaItem[]>[]) => ({ datas: rs.map((r) => r.data), errors: rs.map((r) => r.error) }); // structurally shared: stable until results change

/** The groups you asked lately (newest 8): their new replies (`by` group, `total`), your questions waiting for a nudge
 *  (`late` group, `lateTotal`) and `codes`, msgKey → "#QA…" of every message in their threads (tags show the badge).
 *  Read on load and every 5 min, every 2 min on the Q&A page.
 *  ponytail: one live read per group each time; a server-side watch if more groups need it. */
export function useQaNews(days: number, onPage: boolean, poll = true) { // poll false: read along another caller's poll
  const ids = useQaRecent().slice(0, 8);
  const seen = useStored<Seen>(SEEN, {});
  const muted = useStored<string[]>(MUTED, []);
  const mins = useQaRemind();
  const now = useNow();
  const { datas, errors } = useQueries({ queries: ids.map((id) => ({ ...qaQuery(id, days), refetchInterval: poll && (onPage ? 120_000 : 300_000) })), combine: dataOf });
  const codes = useMemo(() => new Map(datas.flatMap((d) => (d ?? []).flatMap((i) => [
    ...thread(i).map((m) => [msgKey(m), i.code] as const),
    ...(i.question.reply_to_id ? [[qaAskKey({ chat_id: i.question.chat_id, message_id: i.question.reply_to_id }), i.code] as const] : []),
  ]))), [datas]);
  const by: Record<string, number> = {};
  const late: Record<string, number> = {};
  const lists: Record<string, QaItem[]> = {};
  const lateItems: QaItem[] = [];
  let firstNew: QaItem | null = null;
  ids.forEach((id, k) => {
    const items = (lists[id] = datas[k] ?? []);
    by[id] = items.reduce((n, i) => n + fresh(i, seen).length, 0);
    firstNew ??= items.find((i) => fresh(i, seen).length > 0) ?? null;
    const l = items.filter((i) => isLate(i, mins, now, muted));
    late[id] = l.length;
    lateItems.push(...l);
  });
  const qc = useQueryClient();
  useEffect(() => notifyLate(lateItems, notifyPreview(qc))); // every render: the set keeps it to one notification per wait
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  // `lists`: each group's threads (the cross-group "Câu hỏi của tôi" view); `firstNew` / `firstLate`: where a link to
  // "new answers" / "due a nudge" opens (openQa).
  const ready = datas.every((d) => d !== undefined); // every group read once (a failed read stays not ready)
  // a group still on its first read: wait for it (a failed read is no longer fetching, so this never hangs)
  const fetching = useIsFetching({ queryKey: ["qa"] });
  const loading = !ready && fetching > 0;
  // the first group whose read failed (shown instead of an empty list), null while every read is fine
  const error = errors.find((e, k) => e && datas[k] === undefined) ?? null;
  return { loading, error, by, total: sum(by), late, lateTotal: sum(late), lateItems, codes, lists, ready, firstNew: firstNew as QaItem | null, firstLate: lateItems[0] ?? null };
}

/** Sidebar / page value for the cross-group list of your unanswered questions (not a chat id). */
export const QA_MINE = "__qa_mine__";
/** Your questions nobody answered yet, across the groups you asked lately (`lists` of useQaNews), oldest first. */
export const mineOpen = (lists: Record<string, QaItem[]>) =>
  Object.values(lists).flat().filter((i) => i.question.outgoing && waiting(i))
    .sort((a, b) => new Date(a.question.date).getTime() - new Date(b.question.date).getTime());

export const QA_DAYS = [[1, "24 giờ"], [3, "3 ngày"], [7, "7 ngày"], [30, "30 ngày"]] as const;
export type QaDays = (typeof QA_DAYS)[number][0];
/** msgKey → the AI Agent / Đối chiếu BE / Trợ lý AI sessions a message was sent to (sentQuery); undefined until read. */
export type Sent = Record<string, string[]> | undefined;
/** What "sent to AI" counts in a thread: others' replies, or their question while nobody replied (yours: nothing). */
export function sendable(i: QaItem) {
  const a = i.answers.filter((m) => !m.outgoing && !m.deleted);
  return a.length || i.question.outgoing || i.question.deleted ? a : [i.question];
}
export const sentCount = (i: QaItem, sent: NonNullable<Sent>) => sendable(i).filter((m) => sent[msgKey(m)]).length;

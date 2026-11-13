"use client";

import { useIsFetching, useMutation, useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ArrowLeft, BellOff, BellRing, Check, CheckCheck, CircleCheck, Clock3, Copy, MessageCircleQuestion, Plus, Reply, RotateCcw, RotateCw, Search, Send, Trash2, X } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DayGroups, DayTrash, dayOf, newestDay, RAIL_BTN, RAIL_SIDE, RailSection, railRow, revealRow, RowTrash, useDayFold } from "@/components/ai/day-groups";
import { AiBotIcon, AiPromptBox, AiResultCard, AiStop, AiThinking } from "@/components/ai/chat";
import { AiFetching, useAiWait } from "@/components/ai/fetching";
import { DeepAnswerAction } from "@/components/deep-think";
import { Avatar, railHide } from "@/components/chat-list";
import { Markdown } from "@/components/markdown";
import { groupMembers, useMention } from "@/components/mention";
import { AttachThread, MessageItem } from "@/components/message-item";
import { NavPill } from "@/components/shell";
import { AiAsk } from "@/components/yt/bits";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Empty, NoPick } from "@/components/ui/empty";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiStream, errorText, type GroupInfo, type Message, type QaItem, type QaPosted } from "@/lib/api";
import { type Key, t as tr, useT } from "@/lib/i18n";
import { copyText, fold, msgKey, openQa, QA_CODE, QA_PREFILL, qaAskKey, sentQuery, takeQaAnswer, toast, typing, useNow, waitLabel } from "@/lib/inbox";
import { getPref, onPrefs, put, QA_REMIND_CHOICES, qaRemindLabel, readIntro, readNotify, readQaAnswerBy, setPref, useQaRemind } from "@/lib/prefs";
import { parsePref, QA_RECENT, rememberQaGroup } from "@/lib/qa-recent";
import { clockLabel, timeLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

// Q&A: post a question to any group (the text, then a "#QA…" line the backend adds) and read each one back as a thread:
// the question and the whole reply chain under it (backend /api/qa, live from Telegram, one group at a time).
// Layout: the questions as a list, the open one read beside it (one at a time on narrow screens), the box under it.

const qaQuery = (chatId: string, days: number) => ({
  queryKey: ["qa", chatId, days],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<QaItem[]>(`/qa?chat_id=${encodeURIComponent(chatId)}&days=${days}`, { signal }),
  staleTime: 60_000,
});
export const qaGroupsQuery = {
  queryKey: ["groups"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<GroupInfo[]>("/groups", { signal }),
  staleTime: 60_000,
};

// This browser only: groups you posted Q&A to (they lead the sidebar and are watched for answers), and per thread
// code the newest message id you have seen (later replies are "Mới").
const SEEN = "qa-seen";
type Seen = Record<string, number>;
const useStored = <T,>(key: string, fallback: T) => parsePref(useSyncExternalStore(onPrefs, () => getPref(key), () => null), fallback);
/** Groups you asked lately, newest first (the Q&A page opens on the first). */
export const useQaRecent = () => useStored<string[]>(QA_RECENT, []);
// ponytail: one entry per thread ever seen, never pruned; prune by age if it ever grows large
function markSeen(pairs: [string, number][]) {
  const seen = parsePref<Seen>(getPref(SEEN), {});
  const more = pairs.filter(([code, id]) => (seen[code] ?? 0) < id);
  if (more.length) setPref(SEEN, JSON.stringify({ ...seen, ...Object.fromEntries(more) }));
}

const thread = (i: QaItem) => [i.question, ...i.answers];
const latest = (i: QaItem) => i.answers.at(-1) ?? i.question;
/** A thread's last activity (its rail order and day). */
const atOf = (i: QaItem) => new Date(latest(i).date).getTime();
/** Others' messages after the newest one seen in this thread (all of them in a thread never opened here). */
const fresh = (i: QaItem, seen: Seen) => thread(i).filter((m) => !m.outgoing && Number(m.message_id) > (seen[i.code] ?? 0));
// "Chốt": the reply you marked as a thread's answer, code → message id (this browser).
// ponytail: ids only in localStorage, like qa-seen; a backend table if it must follow you to another browser.
const RESOLVED = "qa-resolved";
const resolvedIds = () => parsePref<Record<string, string>>(getPref(RESOLVED), {});
function resolve(code: string, id: string | null) {
  const r = resolvedIds();
  if (id) r[code] = id;
  else delete r[code];
  setPref(RESOLVED, JSON.stringify(r));
}
const accepted = (i: QaItem) => { const id = resolvedIds()[i.code]; return id ? i.answers.find((a) => a.message_id === id) : undefined; };

// Xong / Xóa: backend `qa_marks` (follows you to any browser). Xong closes the thread whatever its answers: no nudge,
// not waiting. Xóa drops it from the dashboard's Q&A only (Telegram keeps the messages). null undoes either.
type QaMark = "done" | "deleted" | null;
async function markQa(qc: QueryClient, i: QaItem, state: QaMark) {
  const chatId = i.question.chat_id;
  await api("/qa/mark", { method: "PUT", json: { chat_id: chatId, code: i.code, state } });
  qc.setQueriesData<QaItem[]>({ queryKey: ["qa", chatId] }, (d) => d && (state === "deleted"
    ? d.filter((x) => x.code !== i.code) : d.map((x) => (x.code === i.code ? { ...x, done: state === "done" } : x))));
  void qc.invalidateQueries({ queryKey: ["qa", chatId] }); // undoing a Xóa brings the thread back
  if (state !== "deleted") void qc.invalidateQueries({ queryKey: ["tasks"] }); // Xong moves the thread's tags: their sessions follow
}
/** Mark with a toast (undo restores what it was); a failed call says so. */
async function markWithUndo(qc: QueryClient, i: QaItem, state: QaMark) {
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
async function deleteWithUndo(qc: QueryClient, its: QaItem[]) {
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
const waiting = (i: QaItem) => !i.done && !answered(i);

/** A Telegram @username (not an e-mail address): only a message that tags someone opens a Q&A (backend `has_tag`). */
const TAG = /(?<![\w.])@(\w{5,32})/g;
const hasTag = (s: string) => new RegExp(TAG.source).test(s) || s.includes("](tg://user?id="); // or tagged by name (@ popup)
/** Answered: you marked an answer, or someone other than the asker replied (the asker's own "up" / thanks is no
 *  answer); by default (Cài đặt › "Người được tag") only a reply from someone the question tagged (@username or a
 *  name mention) counts, when it tagged anyone. Reads its prefs live: pages re-render on a prefs change (`useNow`). */
function answered(i: QaItem) {
  if (accepted(i)) return true;
  const others = i.answers.filter((a) => a.sender_id !== i.question.sender_id);
  if (readQaAnswerBy() !== "tagged") return others.length > 0;
  const q = i.question;
  const names = new Set([...q.text.matchAll(TAG)].map((x) => x[1].toLowerCase()));
  const ids = new Set(q.links.flatMap((l) => (l.kind === "mention" && l.url.startsWith("tg://user?id=") ? [l.url.slice(13)] : [])));
  if (!names.size && !ids.size) return others.length > 0;
  return others.some((a) => (!!a.sender_username && names.has(a.sender_username.toLowerCase())) || (!!a.sender_id && ids.has(a.sender_id)));
}
const who = (m: Message) => (m.outgoing ? tr("Bạn") : m.sender_name || tr("Ẩn danh"));
function transcript(i: QaItem, title?: string) {
  const a = accepted(i);
  return [`Q&A ${i.code}${title ? ` · ${title}` : ""}`, ...(a ? [`${tr("Câu trả lời đã chốt")}: ${who(a)}: ${a.text}`] : []),
    ...thread(i).map((m) => `${who(m)} (${timeLabel(m.date, true)}): ${m.text || tr("[Tệp đính kèm]")}`)].join("\n\n");
}
/** The text without a "#QA…" code at its end (the line the dashboard adds): the thread names its code once. */
const CODE_TAIL = new RegExp(`\\s*${QA_CODE.source}\\s*$`, "i"); // QA_CODE, at the end of the text
function untag(m: Message): Message {
  const cut = m.text.search(CODE_TAIL);
  return cut < 0 ? m : { ...m, text: m.text.slice(0, cut), links: m.links.filter((l) => l.offset + l.length <= cut) };
}
const gist = (m: Message) => untag(m).text.trim() || tr("[Tệp đính kèm]");

// Nudges: your question nobody answered a while (Cài đặt / the Q&A toolbar) after you last spoke in it asks you to
// nudge the group, unless you muted it (this browser). ponytail: muted codes never pruned, like qa-seen.
const MUTED = "qa-muted";
function mute(code: string, off: boolean) {
  const s = new Set(parsePref<string[]>(getPref(MUTED), []));
  if (off) s.add(code);
  else s.delete(code);
  setPref(MUTED, JSON.stringify([...s]));
}
/** When you last spoke in your own question's thread: the question, or your latest nudge / follow-up. */
const lastOwn = (i: QaItem) => thread(i).findLast((m) => m.outgoing)?.date ?? i.question.date;
const isLate = (i: QaItem, mins: number, now: number, muted: readonly string[]) =>
  mins > 0 && i.question.outgoing && waiting(i) && !muted.includes(i.code) && now - new Date(lastOwn(i)).getTime() >= mins * 60_000;
/** The nudge put in the box (polite, peer to peer, short): the people the question tagged, else everyone (a reply to
 *  the question, so it is quoted). Vietnamese whatever the UI language: it goes to the group. */
function nudgeText(i: QaItem) {
  const ats = [...new Set([...i.question.text.matchAll(TAG)].map((x) => `@${x[1]}`))].join(" ");
  return `Nhờ ${ats || "mọi người"} xem giúp phần này nha.`;
}
/** A desktop notification once per wait ("code@your last message") when one of your questions turns late while the
 *  tab is hidden (Cài đặt › Thông báo); a late one seen while the tab is visible is only marked, never notified later. */
const notified = new Set<string>();
function notifyLate(items: QaItem[]) {
  for (const i of items) {
    const key = `${i.code}@${lastOwn(i)}`;
    if (notified.has(key)) continue;
    notified.add(key);
    if (!document.hidden || !readNotify()) continue;
    try {
      const n = new Notification(tr("Chưa ai trả lời · {group}", { group: i.chat_title }), { body: gist(i.question).slice(0, 200), tag: `qa:${i.code}` });
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
  useEffect(() => notifyLate(lateItems)); // every render: the set keeps it to one notification per wait
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
type Sent = Record<string, string[]> | undefined;
/** What "sent to AI" counts in a thread: others' replies, or their question while nobody replied (yours: nothing). */
function sendable(i: QaItem) {
  const a = i.answers.filter((m) => !m.outgoing && !m.deleted);
  return a.length || i.question.outgoing || i.question.deleted ? a : [i.question];
}
const sentCount = (i: QaItem, sent: NonNullable<Sent>) => sendable(i).filter((m) => sent[msgKey(m)]).length;

type Filter = "open" | "done" | "unsent" | "closed" | "mine" | "all";
const FILTERS: [Filter, Key, (i: QaItem, sent: Sent) => boolean, Key | ""][] = [
  ["all", "Tất cả", () => true, ""],
  ["open", "Chờ trả lời", waiting, "Người được tag chưa trả lời (hoặc bất kỳ ai ngoài người hỏi, theo Cài đặt), chưa chốt, chưa đánh dấu xong"],
  ["done", "Đã trả lời", (i) => !i.done && answered(i), "Người được tag đã trả lời (hoặc bất kỳ ai, theo Cài đặt), hoặc bạn đã chốt câu trả lời"],
  ["unsent", "Chưa gửi AI", (i, s) => !!s && !i.done && sentCount(i, s) < sendable(i).length,
    "Còn tin của người khác (trả lời, hoặc câu hỏi chưa ai trả lời) chưa gửi kèm vào phiên AI Agent / Đối chiếu BE / Trợ lý AI nào; chưa đánh dấu xong"],
  ["closed", "Xong", (i) => i.done, "Bạn đã đánh dấu xong: không nhắc, không tính là chờ"],
  ["mine", "Bạn hỏi", (i) => i.question.outgoing, "Câu hỏi bạn đăng"],
];

const PILL = "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium [&_svg]:size-3";

/** Settled ("Chốt"), answered, or how long the question has waited (`late`: yours, past the nudge threshold): text +
 *  icon, not colour alone. */
function State({ i, now, late }: { i: QaItem; now: number; late?: boolean }) {
  const tx = useT();
  if (i.done) return <span className={cn(PILL, "bg-paper-3 text-ink-2")}><CircleCheck aria-hidden />{tx("Xong")}</span>;
  if (accepted(i)) return <span className={cn(PILL, "bg-ok-wash text-ok")}><CheckCheck aria-hidden />{tx("Đã chốt")}</span>;
  if (answered(i)) return <span className={cn(PILL, "bg-ok-wash text-ok")}><Check aria-hidden />{tx("Đã trả lời")}</span>;
  const w = waitLabel(i.question.date, now);
  return (
    <span className={cn(PILL, late ? "bg-signal-wash text-signal-2" : "bg-warn-wash text-warn")}>
<Clock3 aria-hidden />{late ? tx("Quá hạn") : tx("Chờ")} <span className="font-mono tabular-nums">{w.n}</span> {w.unit}
    </span>
  );
}

/** One question in the list: its text, then its state and the latest reply (or who asked), new replies at the end.
 *  `late`: signal mark, and the nudge / mute buttons in their own column on the right (siblings of the row button,
 *  never inside it, never over its text). */
function Row({ i, now, on, news, late, sent, onOpen, onNudge, onMute, onDelete }: {
  i: QaItem; now: number; on: boolean; news: number; late: boolean; sent?: Sent; onOpen: () => void; onNudge: () => void; onMute: () => void; onDelete?: () => void;
}) {
  const tx = useT();
  const total = sendable(i).length, got = sent ? sentCount(i, sent) : 0;
  const end = accepted(i) ?? i.answers.at(-1); // a settled thread previews its answer
  const at = latest(i).date;
  return (
    <li className={railRow(on, late)}>
      <button type="button" data-qa={i.code} aria-current={on || undefined} onClick={onOpen} className={cn(RAIL_BTN, "grid grid-cols-1 gap-1")}>
        <span className="flex items-start gap-3">
          <span className={cn("line-clamp-2 min-w-0 flex-1 text-sm leading-snug text-ink", news ? "font-bold" : "font-medium")}>{gist(i.question)}</span>
          <time dateTime={at} title={timeLabel(at, true)} className="shrink-0 pt-px font-mono text-xs text-ink-3 tabular-nums">{clockLabel(at)}</time>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
          <State i={i} now={now} late={late} />
          <span className="min-w-0 flex-1 truncate">
            {end ? <><b className="font-medium text-ink-2">{who(end)}:</b> {gist(end)}</> : tx("{who} hỏi", { who: who(i.question) })}
          </span>
          {got > 0 && <span className={cn(PILL, got < total ? "bg-paper-3 text-ink-2" : "bg-hl-wash text-hl-2")}>
            <AiBotIcon aria-hidden />{got < total ? tx("Gửi AI {n}/{total}", { n: got, total }) : tx("Đã gửi AI")}
          </span>}
          {news > 0 && <span className={cn(PILL, "bg-hl text-hl-ink")}>{tx("{n} mới", { n: news })}</span>}
        </span>
      </button>
      {(late || onDelete) && (
        <span className={RAIL_SIDE}>
          {late && <>
            <Hint side="bottom" text={tx("Nhắc lại trong nhóm: soạn sẵn tin trả lời vào câu hỏi này (tag lại người được hỏi), Enter để gửi")}>
              <Button size="icon-xs" variant="ghost" className="text-signal-2 hover:bg-signal-wash" aria-label={tx("Nhắc lại {code}", { code: i.code })} onClick={onNudge}><BellRing /></Button>
            </Hint>
            <Hint side="bottom" text={tx("Bỏ qua: không nhắc câu này nữa")}>
              <Button size="icon-xs" variant="ghost" className="text-ink-3" aria-label={tx("Bỏ qua nhắc {code}", { code: i.code })} onClick={onMute}><BellOff /></Button>
            </Hint>
          </>}
          {onDelete && <RowTrash label={tx("Xóa {code} khỏi Q&A", { code: i.code })} hint={tx("Xóa khỏi Q&A trên dashboard (tin trên Telegram vẫn còn); hoàn tác ở thông báo")} onClick={onDelete} />}
        </span>
      )}
    </li>
  );
}

const SUM_ERR: Record<string, Key> = { ai_not_configured: "Chưa cài AI (Cài đặt › AI).", ai_context_too_large: "Chuỗi quá dài để AI đọc.", message_not_found: "Không đọc được các tin của chuỗi." };
const SUM_LINES: Key[] = ["Đang đọc cả chuỗi", "Đang tìm câu trả lời chốt", "Đang gom việc còn mở"];
const MINE_LINES: Key[] = ["AI đang kết nối Telegram", "Đang đọc câu bạn hỏi ở các nhóm", "Đang tìm câu chưa ai trả lời", "Sắp xong rồi"];

/** The open question: its code, state and people, the answer you settled on, then the chain as tag rows (`MessageItem`,
 *  bare) on one rail. Kept tags keep their tag actions; a click on a message makes it the one the box below answers;
 *  "Chốt" on a reply marks it as the answer. AI can sum the thread up (question, conclusion, what is still open).
 *  Keyed by code: a new thread starts with no summary. */
function Thread({ i, now, title, seenAt, target, onTarget, onClose, late, muted, remind, onNudge, onMute, onResolve, onMark }: {
  i: QaItem; now: number; title?: string; seenAt: Seen; target: Message | null; onTarget: (m: Message) => void; onClose: () => void;
  late: boolean; muted: boolean; remind: number; onNudge: () => void; onMute: (off: boolean) => void; onResolve: (id: string | null) => void;
  onMark: (state: QaMark) => void;
}) {
  const tx = useT();
  const [sure, setSure] = useState(false); // Xóa waits for a second click
  const all = thread(i);
  const news = new Set(fresh(i, seenAt).map((m) => m.message_id));
  const nudged = i.answers.filter((a) => a.outgoing).length;
  const answer = accepted(i);
  const [sum, setSum] = useState<{ text: string; busy: boolean; error?: string } | null>(null);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  async function summarize() {
    stop.current?.abort();
    const ctl = (stop.current = new AbortController());
    setSum({ text: "", busy: true });
    try {
      const r = await apiStream<{ text: string }>("/qa/summary", {
        chat_id: i.question.chat_id, message_ids: all.map((m) => m.message_id), accepted_id: answer?.message_id ?? null, intro: readIntro(),
      }, ctl.signal, (text) => setSum({ text, busy: true }));
      setSum({ text: r.text, busy: false });
    } catch (e) {
      setSum({ text: "", busy: false, error: ctl.signal.aborted ? tr("Đã dừng.") : errorText(e, Object.fromEntries(Object.entries(SUM_ERR).map(([k, v]) => [k, tr(v)])), tr("AI không tóm tắt được.")) });
    }
  }
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 @4xl/qa:px-5">
        <Hint side="bottom" text={tx("Về danh sách câu hỏi (Esc)")}>
          <Button size="icon-sm" variant="ghost" className="@4xl/qa:hidden" aria-label={tx("Về danh sách")} onClick={onClose}><ArrowLeft /></Button>
        </Hint>
        <Hint side="bottom" title={i.code} text={tx("Mã Q&A, bấm để chép. Ghi mã này trong tin trên Telegram là gắn vào chuỗi; bấm hashtag đó trong Telegram để xem cả chuỗi.")}>
          <button type="button" aria-label={tx("Chép mã {code}", { code: i.code })} onClick={() => void copyText(i.code, tr("Đã chép {code}", { code: i.code }))}
            className="rounded-full bg-hl-wash px-2 font-mono text-xs leading-5 font-medium text-hl-2 tabular-nums transition-colors duration-(--dur-micro) hover:bg-hl hover:text-hl-ink">
            {i.code}
          </button>
        </Hint>
        <State i={i} now={now} late={late} />
        <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{[...new Set(all.map(who))].join(", ")}</span>
        <AiAsk label={tx("AI tóm tắt kết luận")} hint={tx("Mình tóm câu hỏi, kết luận và việc còn mở nhé!")} onClick={() => void summarize()} />
        <Hint side="bottom" text={tx("Chép cả chuỗi (người, giờ, nội dung; câu trả lời đã chốt ở đầu) để dán vào ticket, AI hay gửi người khác")}>
          <Button size="icon-sm" variant="ghost" aria-label={tx("Chép chuỗi {code}", { code: i.code })} onClick={() => void copyText(transcript(i, title), tr("Đã chép chuỗi {code}", { code: i.code }))}><Copy /></Button>
        </Hint>
        <Hint side="bottom" text={i.done ? tx("Mở lại: chuỗi quay về trạng thái theo các trả lời, nhắc lại như cũ; tin tag trong chuỗi thành chưa xử lý")
          : tx("Đánh dấu xong: không nhắc nữa, rời Chờ trả lời và Câu hỏi của tôi (xem lại ở bộ lọc Xong); tin tag trong chuỗi cũng thành đã xử lý")}>
          <Button size="icon-sm" variant="ghost" aria-pressed={i.done} aria-label={i.done ? tx("Mở lại {code}", { code: i.code }) : tx("Đánh dấu xong {code}", { code: i.code })}
            className={cn(i.done && "text-ok")} onClick={() => onMark(i.done ? null : "done")}>{i.done ? <RotateCcw /> : <CircleCheck />}</Button>
        </Hint>
        <Hint side="bottom" text={tx("Xóa chuỗi khỏi Q&A trên dashboard (tin trên Telegram vẫn còn). Bấm 2 lần để xác nhận")}>
          <Button size={sure ? "xs" : "icon-sm"} variant={sure ? "destructive" : "ghost"} aria-label={tx("Xóa {code} khỏi Q&A", { code: i.code })} onBlur={() => setSure(false)}
            onClick={() => { if (!sure) return setSure(true); setSure(false); onMark("deleted"); }}>
            <Trash2 />{sure && tx("Bấm lần nữa để xóa")}
          </Button>
        </Hint>
      </div>
      {answer && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-ok-wash px-3 py-2 text-xs text-ok @4xl/qa:px-5">
          <CheckCheck className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-ink-2"><b className="font-bold text-ok">{tx("Đã chốt · {who}:", { who: who(answer) })}</b> {gist(answer)}</span>
          <DeepAnswerAction m={answer} q={i.question.message_id} />
          <Hint side="bottom" text={tx("Bỏ chốt: chuỗi quay lại trạng thái theo các trả lời")}>
            <Button size="xs" variant="ghost" onClick={() => onResolve(null)}>{tx("Bỏ chốt")}</Button>
          </Hint>
        </div>
      )}
      {late ? (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-signal-wash px-3 py-2 text-xs text-signal-2 @4xl/qa:px-5">
          <BellRing className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{tx("Chưa ai trả lời sau {x}", { x: qaRemindLabel(remind) })}{nudged > 0 && tx(", bạn đã nhắc {n} lần", { n: nudged })}.</span>
          <Button size="xs" className="bg-hl" onClick={onNudge}><BellRing /> {tx("Nhắc lại trong nhóm")}</Button>
          <Hint side="bottom" text={tx("Không nhắc câu này nữa (bật lại ngay tại đây)")}>
            <Button size="xs" variant="ghost" onClick={() => onMute(true)}><BellOff /> {tx("Bỏ qua")}</Button>
          </Hint>
        </div>
      ) : muted && i.question.outgoing && waiting(i) && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-ink-3 @4xl/qa:px-5">
          <BellOff className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{tx("Đã tắt nhắc cho câu này.")}</span>
          <Button size="xs" variant="ghost" onClick={() => onMute(false)}>{tx("Bật lại")}</Button>
        </div>
      )}
      {/* The rail runs through the avatars, so the chain reads as one conversation. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sum && (
          <div aria-live="polite" className="grid grid-cols-[minmax(0,1fr)] gap-2 px-4 pt-3 @4xl/qa:px-5">
            {sum.error ? (
              <AiResultCard error actions={<Button size="xs" variant="ghost" onClick={() => setSum(null)}><X /> {tx("Đóng")}</Button>}>{sum.error}</AiResultCard>
            ) : sum.busy && !sum.text ? (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1"><AiThinking lines={SUM_LINES.map((l) => tx(l))} /></div>
                <AiStop onClick={() => stop.current?.abort()} hint={tx("Dừng tóm tắt")} />
              </div>
            ) : (
              <AiResultCard title={tx("Kết luận (AI)")} busy={sum.busy} actions={sum.busy ? <AiStop onClick={() => stop.current?.abort()} hint={tx("Dừng tóm tắt")} /> : <>
                <Button size="xs" variant="ghost" onClick={() => void copyText(sum.text, tr("Đã chép kết luận"))}><Copy /> Copy</Button>
                <Button size="xs" variant="ghost" onClick={() => setSum(null)}><X /> {tx("Đóng")}</Button>
              </>}>
                <Markdown text={sum.text} className="text-ink" />
              </AiResultCard>
            )}
          </div>
        )}
        <AttachThread.Provider value={i.answers}>
        <ol aria-label={tx("Chuỗi {code}", { code: i.code })} className="@container relative py-2 before:absolute before:inset-y-6 before:left-8 before:w-px before:bg-rule-2 @xl:before:left-9">
          {all.map((m, k) => (
            <MessageItem key={m.message_id} m={untag(m)} now={now} head={k === 0 || all[k - 1].sender_id !== m.sender_id || all[k - 1].outgoing !== m.outgoing}
              isReplyTarget={!!target && msgKey(target) === msgKey(m)} onReply={onTarget} live={!m.kept} liveReply bare fresh={news.has(m.message_id)}
              extra={<>{k > 0 && !m.deleted && (answer?.message_id === m.message_id ? (
                <span className={cn(PILL, "mr-1 bg-ok-wash text-ok")}><CheckCheck aria-hidden />{tx("Câu trả lời")}</span>
              ) : (
                <Hint side="bottom" text={tx("Chốt tin này là câu trả lời của câu hỏi: chuỗi thành Đã chốt, không nhắc nữa, tin này hiện ở đầu chuỗi và trong Chép chuỗi")}>
                  <Button size="xs" variant="ghost" onClick={() => onResolve(m.message_id)}
                    className="opacity-0 transition-opacity duration-(--dur-micro) group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
                    <CheckCheck /> {tx("Chốt")}
                  </Button>
                </Hint>
              ))}</>} />
          ))}
        </ol>
        </AttachThread.Provider>
      </div>
    </>
  );
}

/** Q&A page: one group's questions and the open thread; with no group picked yet, the groups to pick from.
 *  `focus`: a "#QA…" code to open (a badge on a message), widening to 30 days when it is older. */
export function QaPage({ focus, group, onGroup, days, onDays, onBack }: {
  focus: string | null; group: string | null; onGroup: (chatId: string) => void; days: QaDays; onDays: (d: QaDays) => void; onBack: () => void;
}) {
  const tx = useT();
  const groups = useQuery(qaGroupsQuery);
  const title = groups.data?.find((g) => g.chat_id === group)?.title;
  return (
    <section aria-label="Q&A" className="flex min-h-0 flex-col">
      {group === QA_MINE ? <MyQuestions days={days} onDays={onDays} /> : group ? <GroupQa key={group} chatId={group} title={title} focus={focus} days={days} onDays={onDays} /> : (
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-4 sm:p-6">
          <div className="grid w-full max-w-sm justify-items-center gap-2 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-hl-wash text-hl-2"><MessageCircleQuestion className="size-5" aria-hidden /></span>
            <p className="text-sm font-bold text-ink">{tx("Hỏi nhóm nào?")}</p>
            <p className="text-sm leading-relaxed text-ink-3">{tx("Đăng câu hỏi vào bất kỳ nhóm nào (kèm mã #QA…) và xem lại từng câu với cả chuỗi trả lời.")}</p>
            <div className="mt-2 h-[min(55vh,26rem)] w-full rounded-xl border bg-cotton pt-2 text-left">
              <QaGroups days={days} selected={null} onSelect={onGroup} collapsed={false} />
            </div>
            <Button size="sm" variant="ghost" className="md:hidden" onClick={onBack}><ArrowLeft /> {tx("Việc cần xử lý")}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** "Câu hỏi của tôi": your unanswered questions across the groups you asked lately, oldest first, grouped by group.
 *  A row opens its thread in its own group (openQa); the late ones lead, with nudge / mute like a group's list.
 *  No new reads: the same per-group queries the sidebar badges poll. */
function MyQuestions({ days, onDays }: { days: QaDays; onDays: (d: QaDays) => void }) {
  const tx = useT();
  const { lists, loading, error } = useQaNews(days, true);
  const qc = useQueryClient();
  const now = useNow();
  const mins = useQaRemind();
  const muted = useStored<string[]>(MUTED, []);
  const recent = useQaRecent();
  const open = mineOpen(lists);
  const wait = useAiWait(loading && !open.length);
  const late = open.filter((i) => isLate(i, mins, now, muted));
  const groups: [string, QaItem[]][] = [];
  for (const i of open.filter((x) => !late.includes(x))) {
    const g = groups.find(([t]) => t === i.chat_title);
    if (g) g[1].push(i);
    else groups.push([i.chat_title, [i]]);
  }
  const row = (i: QaItem, isLateRow: boolean) => (
    <Row key={`${i.question.chat_id}:${i.code}`} i={i} now={now} on={false} news={0} late={isLateRow}
      onOpen={() => openQa(i.question.chat_id, i.code)} onNudge={() => openQa(i.question.chat_id, i.code)}
      onMute={() => { mute(i.code, true); toast({ text: tr("Đã bỏ qua nhắc {code}", { code: i.code }), undo: () => mute(i.code, false) }); }} />
  );
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-4">
        <p className="min-w-0 flex-1 truncate text-sm text-ink-2">
          {tx.n("{n} câu bạn hỏi chưa ai trả lời", { n: <span className="font-mono text-base font-bold text-ink tabular-nums">{open.length}</span> })}
          <span className="hidden text-ink-3 sm:inline">{tx(" · {n} nhóm hỏi gần đây", { n: recent.slice(0, 8).length })}</span>
        </p>
        <Dropdown label={tx("Khoảng thời gian")} value={String(days)} onChange={(v) => onDays(Number(v) as QaDays)} className="w-[5.5rem]"
          options={QA_DAYS.map(([v, l]) => ({ value: String(v), label: tx(l) }))} />
      </header>
      <div className="min-h-0 overflow-y-auto px-2 pb-2">
        {!wait && error && (
          <div role="alert" className="grid justify-items-start gap-2 p-4 text-sm text-error">
            {errorText(error, { not_connected: tx("Chưa kết nối Telegram") }, tx("Không đọc được nhóm."))}
            <Button size="xs" variant="outline" onClick={() => void qc.refetchQueries({ queryKey: ["qa"], type: "active" })}><RotateCw /> {tx("Thử lại")}</Button>
          </div>
        )}
        {wait ? (
          <AiFetching kind="qa" lines={MINE_LINES.map((l) => tx(l))} />
        ) : error && !open.length ? null : !open.length ? (
          <Empty icon={<CheckCheck />} tone="bg-ok-wash text-ok" title={recent.length ? tx("Câu nào bạn hỏi cũng có người trả lời rồi") : tx("Bạn chưa hỏi nhóm nào")}
            action={recent.length > 0 && days < 30 && <Button size="xs" variant="outline" onClick={() => onDays(30)}>{tx("Xem 30 ngày")}</Button>}>
            {recent.length ? tx("Trong {x} qua.", { x: tx(QA_DAYS.find(([v]) => v === days)![1]) }) : tx("Chọn một nhóm bên trái để đăng câu hỏi kèm mã #QA…")}
          </Empty>
        ) : (
          [...(late.length ? [["late", late] as const] : []), ...groups].map(([g, its]) => (
            <RailSection key={g} name={g === "late" ? tx("Cần nhắc") : g} late={g === "late"} count={its.length} icon={g === "late" && <BellRing aria-hidden />}
              label={g === "late" ? tx("Chưa ai trả lời sau {x}", { x: qaRemindLabel(mins) }) : g}>
              {its.map((i) => row(i, g === "late"))}
            </RailSection>
          ))
        )}
      </div>
    </div>
  );
}


/** A group's unsent box text: read / written from handlers without re-rendering the page; saved for reloads 300 ms
 *  after the last keystroke (`flush` on leaving). */
function draftStore(key: string) {
  let v = getPref(key) ?? "";
  let t: ReturnType<typeof setTimeout> | undefined;
  const subs = new Set<() => void>();
  const flush = () => { clearTimeout(t); put(key, v.trim() ? v : null); };
  return {
    get: () => v,
    set: (x: string) => { v = x; subs.forEach((f) => f()); clearTimeout(t); t = setTimeout(flush, 300); },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    flush,
  };
}
type Draft = ReturnType<typeof draftStore>;

/** The Q&A prompt box: the only part that re-renders as you type. */
function QaBox({ chatId, draft, onSend, busy, to, title, top }: {
  chatId: string; draft: Draft; onSend: (text: string) => void; busy: boolean; to: Message | null; title?: string;
  top: (text: string) => React.ReactNode;
}) {
  const tx = useT();
  const typed = useSyncExternalStore(draft.sub, draft.get, draft.get);
  const mention = useMention(groupMembers(chatId), typed, draft.set);
  const text = mention.wire(typed); // as sent: a member tagged by name counts as a tag
  const send = () => onSend(text);
  return (
    <AiPromptBox value={typed} onChange={draft.set} onSend={send} maxLength={4000} mention={mention}
      aria-label={to ? tx("Trả lời trong chuỗi") : tx("Câu hỏi mới")}
      placeholder={to ? tx("Trả lời {who}…", { who: who(to) }) : tx("Hỏi {title}… (tag @tên người được hỏi)", { title: title ?? tx("nhóm") })}
      top={top(text)}
      tools={!to && (hasTag(text)
        ? <span className="text-ink-3">{tx.n("Có tag: tự thêm mã {code} ở cuối tin", { code: <span className="font-mono">#QA…</span> })}</span>
        : <span className="text-ink-3">{tx.n("Tag người được hỏi ({at}) để mở Q&A; không tag thì gửi như tin thường", { at: <span className="font-mono">{tx("@tên")}</span> })}</span>)}
      actions={
        <Hint side="bottom" text={to ? tx("Gửi trả lời (Enter, Shift+Enter xuống dòng)") : tx("Đăng câu hỏi vào nhóm (Enter, Shift+Enter xuống dòng)")}>
          <Button size="sm" className="rounded-full bg-hl" disabled={!text.trim() || busy} aria-busy={busy} onClick={send}>
            <Send />{to ? tx("Trả lời") : tx("Đăng")}
          </Button>
        </Hint>
      } />
  );
}

function GroupQa({ chatId, title, focus, days, onDays }: {
  chatId: string; title?: string; focus: string | null; days: QaDays; onDays: (d: QaDays) => void;
}) {
  const tx = useT();
  const qc = useQueryClient();
  const list = useQuery({ ...qaQuery(chatId, days), refetchInterval: 60_000 }); // answers show up while you read
  const listWait = useAiWait(list.isPending);
  const sentQ = useQuery(sentQuery);
  const sent = sentQ.data;
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  // The box text lives outside this component's state: a keystroke re-renders only the box, not the list and thread.
  const [draft] = useState(() => draftStore(`qa-draft:${chatId}`));
  useEffect(() => draft.flush, [draft]); // leaving within the save debounce
  const edit = draft.set;
  // The open thread's code, or "new": the empty box on its own. The box shows only then (`reading`).
  const [open, setOpen] = useState<string | null>(null);
  const [target, setTarget] = useState<Message | null>(null); // the message picked to answer (default: the thread's last)
  const box = useRef<HTMLDivElement>(null);
  const focusBox = () => box.current?.querySelector("textarea")?.focus();
  const pick = (m: Message) => { setTarget(m); focusBox(); };
  const [read, setRead] = useState<ReadonlySet<string>>(new Set()); // opened this visit: the list drops their "mới"
  const [autoText, setAutoText] = useState(""); // the nudge last put in the box: dropped on leaving its thread unsent
  const show = (code: string | null) => {
    setOpen(code);
    setTarget(null);
    if (code) setRead((r) => new Set(r).add(code));
    if (autoText && draft.get() === autoText) edit(""); // a nudge tags that thread's people: never carry it to another
  };
  const mins = useQaRemind();
  const muted = useStored<string[]>(MUTED, []);
  // Nudge: open the thread, answer the question itself (Telegram quotes it), a reminder line in the box unless you
  // already typed something. Sending stays one Enter: nothing goes to the group on its own.
  const [ask, setAsk] = useState(0); // bumped: focus the box once the opened thread has rendered
  useEffect(() => { if (ask) box.current?.querySelector("textarea")?.focus(); }, [ask]);
  const nudge = (i: QaItem) => {
    show(i.code);
    setTarget(i.question);
    if (!draft.get().trim() || draft.get() === autoText) {
      edit(nudgeText(i));
      setAutoText(nudgeText(i));
    }
    setAsk((n) => n + 1);
  };
  const onMute = (i: QaItem, off: boolean) => {
    mute(i.code, off);
    if (off) toast({ text: tr("Đã bỏ qua nhắc {code}", { code: i.code }), undo: () => mute(i.code, false) });
  };
  const onResolve = (i: QaItem, id: string | null) => {
    const was = resolvedIds()[i.code] ?? null;
    resolve(i.code, id);
    toast({ text: id ? tr("Đã chốt câu trả lời cho {code}", { code: i.code }) : tr("Đã bỏ chốt {code}", { code: i.code }), undo: () => resolve(i.code, was) });
  };
  // "Trả lời bằng Q&A" on a message of this group, from anywhere (taken on open, or while open).
  useEffect(() => {
    const take = () => { const m = takeQaAnswer(chatId); if (m) { setOpen("new"); setTarget(m); requestAnimationFrame(focusBox); } };
    take();
    addEventListener("qa-answer", take);
    return () => removeEventListener("qa-answer", take);
  }, [chatId]);
  // "Hỏi lại trong nhóm" from a YouTrack ticket (the inbox stores `qa-prefill` and opens this group): a new question
  // with that text, under whatever you had typed.
  useEffect(() => {
    const take = () => {
      let p: { chatId?: string; text?: string } | null = null;
      try { p = JSON.parse(sessionStorage.getItem(QA_PREFILL) ?? "null"); } catch {}
      if (!p?.text || p.chatId !== chatId) return;
      try { sessionStorage.removeItem(QA_PREFILL); } catch {}
      const cur = draft.get().trim();
      setOpen("new");
      setTarget(null);
      edit(cur ? `${cur}\n${p.text}` : p.text);
      requestAnimationFrame(focusBox);
    };
    take();
    addEventListener(QA_PREFILL, take);
    return () => removeEventListener(QA_PREFILL, take);
  }, [chatId, draft, edit]);

  // "Mới" is against what you had seen when the group opened; everything shown counts as seen from then on.
  const [seenAt, setSeenAt] = useState(() => parsePref<Seen>(getPref(SEEN), {}));
  useEffect(() => {
    if (list.data) markSeen(list.data.map((i) => [i.code, Math.max(...thread(i).map((m) => Number(m.message_id)))]));
  }, [list.data]);


  // One-shot open of a code once the list has it (effect below the list).
  const want = useRef<{ code: string; widen: boolean } | null>(focus ? { code: focus, widen: true } : null);
  const items = list.data ?? [];
  const cur = items.find((i) => i.code === open);
  const to = target ?? (cur && latest(cur)) ?? null; // what a send answers; none: a new question
  // A target outside every thread (someone's question): the answer opens a thread on it.
  const start = !!target && !!list.data && !items.some((i) => thread(i).some((m) => msgKey(m) === msgKey(target)));
  const reading = !!cur || open === "new" || !!target; // narrow screens: the reader takes the list's place

  const post = useMutation({
    mutationFn: (text: string) => api<QaPosted>("/qa", { method: "POST", json: { chat_id: chatId, text, reply_to: to?.message_id ?? null, start } }),
    onSuccess: (r) => {
      rememberQaGroup(chatId);
      edit("");
      setTarget(null);
      if (r.code) {
        markSeen([[r.code, Number(r.message_id)]]);
        setSeenAt((x) => ({ ...x, [r.code!]: Number(r.message_id) })); // you just answered it: nothing in it is "Mới"
        setFilter("all");
        setFind("");
        want.current = { code: r.code, widen: r.joined }; // joined: an older thread, maybe outside the range
      }
      toast({ text: r.joined ? tr("Đã trả lời trong chuỗi {code}", { code: r.code ?? "" }) : r.code ? tr(start ? "Đã trả lời, mở Q&A {code}" : "Đã đăng câu hỏi {code}", { code: r.code })
        : !to || start ? tr("Đã gửi như tin thường: không tag ai nên không tạo Q&A") : tr("Đã gửi trả lời") });
      void qc.invalidateQueries({ queryKey: ["qa", chatId] });
    },
    onError: (e) => toast({ text: errorText(e, { forbidden: tr("Nhóm không cho bạn gửi tin"), reply_not_found: tr("Tin được trả lời không còn") }, tr("Không gửi được, thử lại")) }),
  });
  const send = (t: string) => { if (t.trim() && !post.isPending) post.mutate(t); };

  const s = fold(find.trim());
  const keep = FILTERS.find(([f]) => f === filter)![2];
  const shown = items.filter((i) => keep(i, sent))
    .filter((i) => !s || fold(`${i.code} ${thread(i).map((m) => `${who(m)} ${m.text}`).join(" ")}`).includes(s));
  // Your questions due a nudge lead the list (what needs you first), the rest by the day of their latest message
  // (`DayGroups`, the AI Agent rail's). Days start folded but the newest; "late" starts open. A bar click folds /
  // unfolds (this visit only); j / k skip folded days; a search opens every day.
  const late = shown.filter((i) => isLate(i, mins, now, muted));
  const rest = shown.filter((i) => !late.includes(i));
  const newest = newestDay(rest, atOf);
  const dayFold = useDayFold((d) => d === "late" || d === newest);
  const [isOpen, fold1] = dayFold;
  const ordered = [...(isOpen("late") ? late : []), ...rest.filter((i) => !!s || isOpen(dayOf(atOf(i)))).sort((a, b) => atOf(b) - atOf(a))];
  const dayTrash = (its: QaItem[], what: string) => (
    <DayTrash label={tx("Xóa {n} Q&A {what}", { n: its.length, what })} ask={tx("Xóa {n} câu?", { n: its.length })} onRemove={() => remove(its)}
      hint={tx("Xóa {n} câu của {what} khỏi Q&A trên dashboard (tin trên Telegram vẫn còn). Bấm 2 lần để xác nhận", { n: its.length, what })} />
  );
  // Its day folded: open it so the row shows.
  const reveal = useEffectEvent((it: QaItem) => {
    const d = late.includes(it) ? "late" : dayOf(atOf(it));
    if (!isOpen(d)) fold1(d);
  });
  // One-shot open of a code once the list has it: a badge's code (not in range: widen to 30 days, then give up)
  // or the question just posted (waits for the refetch).
  useEffect(() => {
    const w = want.current;
    if (!w || !list.data) return;
    if (!list.data.some((i) => i.code === w.code)) {
      if (!w.widen) return;
      if (days < 30) return onDays(30);
      want.current = null;
      toast({ text: tr("Không thấy {code} trong 30 ngày qua của nhóm này", { code: w.code }) });
      return;
    }
    want.current = null;
    reveal(list.data.find((i) => i.code === w.code)!);
    setOpen(w.code); // `show` minus the nudge cleanup: a send already emptied the box
    setTarget(null);
    setRead((r) => new Set(r).add(w.code));
    requestAnimationFrame(() => revealRow(document.querySelector<HTMLElement>(`[data-qa="${CSS.escape(w.code)}"]`)));
  }, [list.data, days, onDays]);

  const remove = (its: QaItem[]) => { if (cur && its.includes(cur)) show(null); void deleteWithUndo(qc, its); };
  const qaRow = (i: QaItem, isLate: boolean) => (
    <Row key={i.code} i={i} now={now} on={i.code === open} news={read.has(i.code) ? 0 : fresh(i, seenAt).length} late={isLate} sent={sent}
      onOpen={() => show(i.code === open ? null : i.code)} onNudge={() => nudge(i)} onMute={() => onMute(i, true)} onDelete={() => remove([i])} />
  );

  // j / k the next / previous question, r the box, Esc back to the list (outside text fields).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || typing(e)) return;
    if (e.key === "Escape" && reading) return show(null);
    if (e.key === "r" && reading) { e.preventDefault(); return focusBox(); }
    if (e.key !== "j" && e.key !== "k") return;
    const k = ordered.findIndex((i) => i.code === open);
    const next = ordered[e.key === "j" ? k + 1 : Math.max(0, k - 1)];
    if (!next) return;
    e.preventDefault();
    show(next.code);
    document.querySelector(`[data-qa="${CSS.escape(next.code)}"]`)?.scrollIntoView({ block: "nearest" });
  });
  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="@container/qa grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2 @4xl/qa:px-4">
        <div className={cn("max-w-full overflow-x-auto [scrollbar-width:none]", reading && "@max-4xl/qa:hidden")}>
          <Segmented id="qa-filter" label={tx("Lọc Q&A")} value={filter} onChange={setFilter} className="w-max"
            items={FILTERS.map(([v, l, f, hint]) => ({
              value: v, title: hint ? tx(hint) : undefined,
              label: <span className="flex items-center gap-1.5">{tx(l)}<span className="font-mono tabular-nums opacity-70">{items.filter((i) => f(i, sent)).length}</span></span>,
            }))} />
        </div>
        <label className={cn("relative min-w-36 flex-1 @2xl/qa:max-w-64", reading && "@max-4xl/qa:hidden")}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx("Tìm nội dung, người, #QA…")} aria-label={tx("Tìm Q&A")}
            className="h-8 pl-8 text-xs md:text-xs" />
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          <Dropdown label={tx("Khoảng thời gian")} value={String(days)} onChange={(v) => onDays(Number(v) as QaDays)} className="w-[5.5rem]"
            options={QA_DAYS.map(([v, l]) => ({ value: String(v), label: tx(l) }))} />
          <Hint side="bottom" text={tx("Nhắc khi câu hỏi của bạn chưa ai trả lời sau khoảng này (cũng ở Cài đặt › Telegram)")}>
            <span className="inline-flex">
              <Dropdown label={tx("Nhắc khi chưa ai trả lời sau")} value={String(mins)} onChange={(v) => setPref("qaRemindMins", v)} className="w-[7.25rem]"
                prefix={mins ? <BellRing aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : <BellOff aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
                options={QA_REMIND_CHOICES.map((m) => ({ value: String(m), label: qaRemindLabel(m), hint: m ? tx("Nhắc sau {x}", { x: qaRemindLabel(m) }) : tx("Không nhắc") }))} />
            </span>
          </Hint>
          <Hint side="bottom" text={tx("Đọc lại nhóm (tự đọc lại mỗi phút)")}>
            <Button size="icon-sm" variant="ghost" aria-label={tx("Đọc lại")} disabled={list.isFetching} onClick={() => void list.refetch()}>
              <RotateCw className={cn(list.isFetching && "animate-spin")} />
            </Button>
          </Hint>
          <Hint side="bottom" text={tx("Đăng câu hỏi mới vào nhóm này")}>
            <Button size="sm" onClick={() => { show("new"); requestAnimationFrame(focusBox); }}><Plus /><span className="@max-md/qa:sr-only">{tx("Câu hỏi mới")}</span></Button>
          </Hint>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-1 @4xl/qa:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)]">
        <div className={cn("min-h-0 overflow-y-auto px-2 pb-2 @4xl/qa:border-r", reading ? "hidden @4xl/qa:block" : "block")}>
          {listWait ? (
            <AiFetching kind="qa" />
          ) : list.isError ? (
            <div role="alert" className="grid justify-items-start gap-2 p-4 text-sm text-error">
              {errorText(list.error, { not_connected: tx("Chưa kết nối Telegram") }, tx("Không đọc được nhóm."))}
              <Button size="xs" variant="outline" onClick={() => void list.refetch()}><RotateCw /> {tx("Thử lại")}</Button>
            </div>
          ) : filter === "unsent" && sentQ.isError ? (
            <div role="alert" className="grid justify-items-start gap-2 p-4 text-sm text-error">
              {errorText(sentQ.error, {}, tx("Không đọc được tin nào đã gửi AI."))}
              <Button size="xs" variant="outline" onClick={() => void sentQ.refetch()}><RotateCw /> {tx("Thử lại")}</Button>
            </div>
          ) : !shown.length ? (
            <Empty icon={items.length ? <Search /> : <MessageCircleQuestion />} title={items.length ? tx("Không thấy Q&A khớp") : tx("Chưa có Q&A nào")}
              action={items.length ? <Button size="xs" variant="outline" onClick={() => { setFilter("all"); setFind(""); }}>{tx("Bỏ lọc")}</Button>
                : days < 30 && <Button size="xs" variant="outline" onClick={() => onDays(30)}>{tx("Xem 30 ngày")}</Button>}>
              {items.length ? tx("Thử từ khác hoặc bộ lọc khác.") : tx("Trong {x} qua chưa có câu hỏi kèm mã #QA… ở nhóm này.", { x: tx(QA_DAYS.find(([v]) => v === days)![1]) })}
            </Empty>
          ) : <>
            {late.length > 0 && (
              <RailSection name={tx("Chưa ai trả lời")} late count={late.length} icon={<BellRing aria-hidden />} open={isOpen("late")} onToggle={() => fold1("late")}
                label={tx("Chưa ai trả lời sau {x}", { x: qaRemindLabel(mins) })} actions={dayTrash(late, tx("chưa ai trả lời"))}>
                {late.map((i) => qaRow(i, true))}
              </RailSection>
            )}
            <DayGroups items={rest} at={atOf} open={!!s} fold={dayFold} row={(i) => qaRow(i, false)}
              actions={(d, its) => dayTrash(its, tx(d).toLowerCase())} />
          </>}
        </div>

        <div className={cn("min-h-0 flex-col", reading ? "flex" : "hidden @4xl/qa:flex")}>
          {cur ? (
            <Thread key={cur.code} i={cur} now={now} title={title} seenAt={seenAt} target={target} onTarget={pick} onClose={() => show(null)}
              late={late.includes(cur)} muted={muted.includes(cur.code)} remind={mins} onNudge={() => nudge(cur)} onMute={(off) => onMute(cur, off)}
              onResolve={(id) => onResolve(cur, id)}
              onMark={(state) => { if (state === "deleted") show(null); void markWithUndo(qc, cur, state); }} />
          ) : open === null && !target ? (shown.length
            ? <NoPick title={tx("Chưa chọn câu hỏi nào")}>{tx("Chọn một câu bên trái để đọc cả chuỗi, hoặc bấm “Câu hỏi mới” để hỏi.")}</NoPick>
            : <NoPick title={tx("Không có câu hỏi nào để xem")}>{tx("Danh sách bên trái đang trống. Đổi bộ lọc, khoảng thời gian, hoặc bấm “Câu hỏi mới” để hỏi.")}</NoPick>) : (
            <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
              <div className="grid max-w-sm justify-items-center gap-2 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-hl-wash text-hl-2"><MessageCircleQuestion className="size-5" aria-hidden /></span>
                <p className="text-sm font-bold text-ink">{tx("Câu hỏi mới cho {title}", { title: title ?? tx("nhóm") })}</p>
                <p className="text-sm leading-relaxed text-ink-3">
                  {tx("Gõ ở ô dưới: tin đăng vào nhóm kèm một dòng mã #QA…, mọi trả lời nối tiếp gom thành một chuỗi.")}
                  <span className="hidden @4xl/qa:inline">{tx(" Chọn một câu bên trái để đọc cả chuỗi.")}</span>
                </p>
                <Button size="sm" variant="ghost" className="@4xl/qa:hidden" onClick={() => show(null)}><ArrowLeft /> {tx("Danh sách câu hỏi")}</Button>
              </div>
            </div>
          )}
          {reading && <div ref={box} className="shrink-0 border-t px-3 py-3 @4xl/qa:px-5" onKeyDown={(e) => { if (e.key === "Escape" && target && !e.defaultPrevented) { e.preventDefault(); setTarget(null); } }}>
            <QaBox chatId={chatId} draft={draft} onSend={send} busy={post.isPending} to={to} title={title}
              top={(text) => to && (
                <div className="flex items-center gap-2 rounded-md border-l-[3px] border-hl bg-paper-2 py-1 pr-1 pl-2.5 text-xs">
                  <Reply className="size-3.5 shrink-0 text-hl-2" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink-2"><b className="font-bold text-ink">{who(to)}:</b> {gist(to)}</span>
                  {start && (hasTag(text) ? (
                    <Hint side="bottom" text={tx("Tin này không thuộc chuỗi nào đang hiện và bạn có tag người: câu trả lời kèm mã #QA…, tin này đứng đầu chuỗi mới. Nếu nó nằm trong một chuỗi cũ hơn thì trả lời vào đúng chuỗi đó, không thêm mã.")}>
                      <span className="shrink-0 rounded-full bg-hl-wash px-2 leading-5 font-medium text-hl-2">{tx("Mở Q&A mới")}</span>
                    </Hint>
                  ) : (
                    <Hint side="bottom" text={tx("Chưa tag ai (@tên): gửi như một tin trả lời thường, không mở Q&A. Tag người được hỏi để mở chuỗi Q&A.")}>
                      <span className="shrink-0 rounded-full bg-paper-3 px-2 leading-5 font-medium text-ink-2">{tx("Tin thường")}</span>
                    </Hint>
                  ))}
                  {target ? (
                    <Hint side="bottom" text={cur ? tx("Bỏ chọn (Esc): trả lời tin mới nhất của chuỗi") : tx("Bỏ trả lời (Esc): gửi thành câu hỏi mới")}>
                      <Button size="icon-xs" variant="ghost" aria-label={tx("Bỏ chọn tin")} onClick={() => setTarget(null)}><X /></Button>
                    </Hint>
                  ) : <span className="hidden shrink-0 pr-1.5 text-ink-3 @2xl/qa:inline">{tx("Bấm một tin để trả lời tin đó")}</span>}
                </div>
              )}
            />
          </div>}
        </div>
      </div>
    </div>
  );
}

/** Group list for Q&A (sidebar tab, and the page before a group is picked): every group the account is in (any can be
 *  asked), the ones you asked lately first, with their new replies. */
export function QaGroups({ days, selected, onSelect, collapsed }: {
  days: QaDays; selected: string | null | undefined; onSelect: (chatId: string) => void; collapsed: boolean;
}) {
  const tx = useT();
  const list = useQuery(qaGroupsQuery);
  const { by: news, late, lists } = useQaNews(days, true);
  const mine = mineOpen(lists).length;
  const recents = useQaRecent();
  const [q, setQ] = useState("");
  const s = fold(q.trim());
  const all = (list.data ?? []).filter((g) => !s || fold(g.title).includes(s)).sort((a, b) => a.title.localeCompare(b.title, "vi"));
  const recent = s ? [] : recents.flatMap((id) => all.filter((g) => g.chat_id === id));
  const rest = all.filter((g) => !recent.includes(g));
  const fade = collapsed ? railHide : undefined;
  const row = (g: GroupInfo) => (
    <li key={g.chat_id} className="rounded-md">
      <button type="button" aria-current={selected === g.chat_id} onClick={() => onSelect(g.chat_id)}
        className={cn("relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
          selected === g.chat_id && "font-medium text-hl-2 hover:bg-transparent", !!news[g.chat_id] && "font-medium text-ink")}>
        {selected === g.chat_id && <NavPill />}
        <Avatar name={g.title} className="relative" />
        <span className={cn("relative min-w-0 flex-1 truncate", fade)}>{g.title}</span>
        {!!late[g.chat_id] && (
          <span className={cn("relative inline-flex shrink-0 items-center gap-0.5 rounded-full bg-signal-wash px-1.5 font-mono text-xs leading-5 font-medium text-signal-2 tabular-nums", fade)}
            aria-label={tx("{n} câu chưa ai trả lời, cần nhắc", { n: late[g.chat_id] })}><BellRing className="size-3" aria-hidden />{late[g.chat_id]}</span>
        )}
        {!!news[g.chat_id] && (
          <span className={cn("relative shrink-0 rounded-full bg-hl px-1.5 text-xs leading-5 font-medium text-hl-ink tabular-nums", fade)}
            aria-label={tx("{n} trả lời mới", { n: news[g.chat_id] })}>{news[g.chat_id]}</span>
        )}
      </button>
    </li>
  );
  const label = (x: string) => <li data-zebra-off className={cn("px-3 pt-2 pb-0.5 text-xs font-medium text-ink-3", fade)}>{x}</li>;
  return (
    <nav aria-label={tx("Nhóm Q&A")} className="no-scrollbar h-full min-h-0 overflow-y-auto px-2 pb-3">
      <label className={cn("relative mb-1 block px-1", fade)}>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Tìm nhóm…")} aria-label={tx("Tìm nhóm")}
          className="h-8 pl-8 text-xs md:text-xs" />
      </label>
      <ul className="zebra grid grid-cols-[minmax(0,1fr)] gap-1">
        {!s && recents.length > 0 && (
          <li className="rounded-md">
            <button type="button" aria-current={selected === QA_MINE} onClick={() => onSelect(QA_MINE)}
              className={cn("relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
                selected === QA_MINE && "font-medium text-hl-2 hover:bg-transparent")}>
              {selected === QA_MINE && <NavPill />}
              <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-paper-3 text-ink-2"><MessageCircleQuestion className="size-4" aria-hidden /></span>
              <span className={cn("relative min-w-0 flex-1 truncate", fade)}>{tx("Câu hỏi của tôi")}</span>
              {mine > 0 && <span className={cn("relative shrink-0 rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums", fade)}
                aria-label={tx("{n} câu chưa ai trả lời", { n: mine })}>{mine}</span>}
            </button>
          </li>
        )}
        {recent.length > 0 && <>{label(tx("Đã hỏi gần đây"))}{recent.map(row)}{label(tx("Mọi nhóm"))}</>}
        {rest.map(row)}
      </ul>
      {list.isPending && <div className="grid gap-2 px-3 pt-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-4" style={{ width: `${70 - k * 12}%` }} />)}</div>}
      {list.isError && <p className={cn("px-3 py-2 text-sm text-error", fade)}>{tx("Không đọc được danh sách nhóm.")}</p>}
      {list.isSuccess && !all.length && <p className={cn("px-3 py-2 text-sm leading-relaxed text-ink-3", fade)}>{tx("Không thấy nhóm nào.")}</p>}
    </nav>
  );
}

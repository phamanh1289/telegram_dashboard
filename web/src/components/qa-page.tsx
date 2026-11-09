"use client";

import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ArrowLeft, BellOff, BellRing, Check, CheckCheck, CircleCheck, Clock3, Copy, MessageCircleQuestion, Plus, Reply, RotateCcw, RotateCw, Search, Send, Trash2, X } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AiPromptBox, AiResultCard, AiStop, AiThinking, AiWriting } from "@/components/ai/chat";
import { AiFetching, useAiWait } from "@/components/ai/fetching";
import { Avatar, railHide } from "@/components/chat-list";
import { Markdown } from "@/components/markdown";
import { groupMembers, useMention } from "@/components/mention";
import { MessageItem } from "@/components/message-item";
import { NavPill } from "@/components/shell";
import { AiAsk } from "@/components/yt/bits";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiStream, errorText, type GroupInfo, type Message, type QaItem, type QaPosted } from "@/lib/api";
import { copyText, fold, msgKey, openQa, smooth, takeQaAnswer, toast, typing, useNow, waitLabel } from "@/lib/inbox";
import { getPref, onPrefs, put, QA_REMIND_CHOICES, qaRemindLabel, readIntro, readNotify, readQaAnswerBy, setPref, useQaRemind } from "@/lib/prefs";
import { clockLabel, dayLabel, timeLabel } from "@/lib/time";
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
const RECENT = "qa-recent-groups";
const SEEN = "qa-seen";
type Seen = Record<string, number>;
const parse = <T,>(raw: string | null, fallback: T): T => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
const useStored = <T,>(key: string, fallback: T) => parse(useSyncExternalStore(onPrefs, () => getPref(key), () => null), fallback);
/** Groups you asked lately, newest first (the Q&A page opens on the first). */
export const useQaRecent = () => useStored<string[]>(RECENT, []);
const remember = (id: string) => setPref(RECENT, JSON.stringify([id, ...parse<string[]>(getPref(RECENT), []).filter((x) => x !== id)].slice(0, 20)));
// ponytail: one entry per thread ever seen, never pruned; prune by age if it ever grows large
function markSeen(pairs: [string, number][]) {
  const seen = parse<Seen>(getPref(SEEN), {});
  const more = pairs.filter(([code, id]) => (seen[code] ?? 0) < id);
  if (more.length) setPref(SEEN, JSON.stringify({ ...seen, ...Object.fromEntries(more) }));
}

const thread = (i: QaItem) => [i.question, ...i.answers];
const latest = (i: QaItem) => i.answers.at(-1) ?? i.question;
/** Others' messages after the newest one seen in this thread (all of them in a thread never opened here). */
const fresh = (i: QaItem, seen: Seen) => thread(i).filter((m) => !m.outgoing && Number(m.message_id) > (seen[i.code] ?? 0));
// "Chốt": the reply you marked as a thread's answer, code → message id (this browser).
// ponytail: ids only in localStorage, like qa-seen; a backend table if it must follow you to another browser.
const RESOLVED = "qa-resolved";
const resolvedIds = () => parse<Record<string, string>>(getPref(RESOLVED), {});
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
}
/** Mark with a toast (undo restores what it was); a failed call says so. */
async function markWithUndo(qc: QueryClient, i: QaItem, state: QaMark) {
  const was: QaMark = i.done ? "done" : null;
  try {
    await markQa(qc, i, state);
    toast({ text: state === "deleted" ? `Đã xóa ${i.code} khỏi Q&A` : state ? `Đã đánh dấu xong ${i.code}` : `Đã mở lại ${i.code}`,
      undo: () => void markQa(qc, i, was) });
  } catch (e) {
    toast({ text: errorText(e, {}, "Không lưu được, thử lại") });
  }
}
/** Still waiting on someone: not answered and not marked Xong. */
const waiting = (i: QaItem) => !i.done && !answered(i);

/** A Telegram @username (not an e-mail address): only a message that tags someone opens a Q&A (backend `has_tag`). */
const TAG = /(?<![\w.])@(\w{5,32})/g;
const hasTag = (s: string) => new RegExp(TAG.source).test(s) || s.includes("](tg://user?id="); // or tagged by name (@ popup)
/** Answered: you marked an answer, or someone other than the asker replied (the asker's own "up" / thanks is no
 *  answer); with Cài đặt › "Người được tag", only a reply from someone the question tagged (@username or a name
 *  mention) counts, when it tagged anyone. Reads its prefs live: pages re-render on a prefs change (`useNow`). */
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
const who = (m: Message) => (m.outgoing ? "Bạn" : m.sender_name || "Ẩn danh");
function transcript(i: QaItem, title?: string) {
  const a = accepted(i);
  return [`Q&A ${i.code}${title ? ` · ${title}` : ""}`, ...(a ? [`Câu trả lời đã chốt: ${who(a)}: ${a.text}`] : []),
    ...thread(i).map((m) => `${who(m)} (${timeLabel(m.date, true)}): ${m.text || "[Tệp đính kèm]"}`)].join("\n\n");
}
/** The text without a "#QA…" code at its end (the line the dashboard adds): the thread names its code once. */
const CODE_TAIL = /\s*#QA\d+\s*$/i;
function untag(m: Message): Message {
  const cut = m.text.search(CODE_TAIL);
  return cut < 0 ? m : { ...m, text: m.text.slice(0, cut), links: m.links.filter((l) => l.offset + l.length <= cut) };
}
const gist = (m: Message) => untag(m).text.trim() || "[Tệp đính kèm]";
const noop = () => {};

// Nudges: your question nobody answered a while (Cài đặt / the Q&A toolbar) after you last spoke in it asks you to
// nudge the group, unless you muted it (this browser). ponytail: muted codes never pruned, like qa-seen.
const MUTED = "qa-muted";
function mute(code: string, off: boolean) {
  const s = new Set(parse<string[]>(getPref(MUTED), []));
  if (off) s.add(code);
  else s.delete(code);
  setPref(MUTED, JSON.stringify([...s]));
}
/** When you last spoke in your own question's thread: the question, or your latest nudge / follow-up. */
const lastOwn = (i: QaItem) => thread(i).findLast((m) => m.outgoing)?.date ?? i.question.date;
const isLate = (i: QaItem, mins: number, now: number, muted: readonly string[]) =>
  mins > 0 && i.question.outgoing && waiting(i) && !muted.includes(i.code) && now - new Date(lastOwn(i)).getTime() >= mins * 60_000;
/** The nudge put in the box: the people the question tagged, else everyone (a reply to the question, so it is quoted). */
function nudgeText(i: QaItem) {
  const ats = [...new Set([...i.question.text.matchAll(TAG)].map((x) => `@${x[1]}`))].join(" ");
  return `${ats || "Mọi người"} check giúp phần này.`;
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
      const n = new Notification(`Chưa ai trả lời · ${i.chat_title}`, { body: gist(i.question).slice(0, 200), tag: `qa:${i.code}` });
      n.onclick = () => { focus(); openQa(i.question.chat_id, i.code); n.close(); };
    } catch {} // no Notification constructor here (Android Chrome, webviews)
  }
}

const dataOf = (rs: UseQueryResult<QaItem[]>[]) => rs.map((r) => r.data); // structurally shared: stable until data changes

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
  const datas = useQueries({ queries: ids.map((id) => ({ ...qaQuery(id, days), refetchInterval: poll && (onPage ? 120_000 : 300_000) })), combine: dataOf });
  const codes = useMemo(() => new Map(datas.flatMap((d) => (d ?? []).flatMap((i) => thread(i).map((m) => [msgKey(m), i.code] as const)))), [datas]);
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
  return { by, total: sum(by), late, lateTotal: sum(late), codes, lists, ready, firstNew: firstNew as QaItem | null, firstLate: lateItems[0] ?? null };
}

/** Sidebar / page value for the cross-group list of your unanswered questions (not a chat id). */
export const QA_MINE = "__qa_mine__";
/** Your questions nobody answered yet, across the groups you asked lately (`lists` of useQaNews), oldest first. */
const mineOpen = (lists: Record<string, QaItem[]>) =>
  Object.values(lists).flat().filter((i) => i.question.outgoing && waiting(i))
    .sort((a, b) => new Date(a.question.date).getTime() - new Date(b.question.date).getTime());

export const QA_DAYS = [[1, "24 giờ"], [3, "3 ngày"], [7, "7 ngày"], [30, "30 ngày"]] as const;
export type QaDays = (typeof QA_DAYS)[number][0];
type Filter = "open" | "done" | "closed" | "mine" | "all";
const FILTERS: [Filter, string, (i: QaItem) => boolean, string][] = [
  ["all", "Tất cả", () => true, ""],
  ["open", "Chờ trả lời", waiting, "Chưa ai (ngoài người hỏi; hoặc người được tag, theo Cài đặt) trả lời, chưa chốt, chưa đánh dấu xong"],
  ["done", "Đã trả lời", (i) => !i.done && answered(i), "Đã có người trả lời, hoặc bạn đã chốt câu trả lời"],
  ["closed", "Xong", (i) => i.done, "Bạn đã đánh dấu xong: không nhắc, không tính là chờ"],
  ["mine", "Bạn hỏi", (i) => i.question.outgoing, "Câu hỏi bạn đăng"],
];

const PILL = "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium [&_svg]:size-3";

/** Settled ("Chốt"), answered, or how long the question has waited (`late`: yours, past the nudge threshold): text +
 *  icon, not colour alone. */
function State({ i, now, late }: { i: QaItem; now: number; late?: boolean }) {
  if (i.done) return <span className={cn(PILL, "bg-paper-3 text-ink-2")}><CircleCheck aria-hidden />Xong</span>;
  if (accepted(i)) return <span className={cn(PILL, "bg-ok-wash text-ok")}><CheckCheck aria-hidden />Đã chốt</span>;
  if (answered(i)) return <span className={cn(PILL, "bg-ok-wash text-ok")}><Check aria-hidden />Đã trả lời</span>;
  const w = waitLabel(i.question.date, now);
  return (
    <span className={cn(PILL, late ? "bg-signal-wash text-signal-2" : "bg-warn-wash text-warn")}>
<Clock3 aria-hidden />{late ? "Quá hạn" : "Chờ"} <span className="font-mono tabular-nums">{w.n}</span> {w.unit}
    </span>
  );
}

/** One question in the list: its text, then its state and the latest reply (or who asked), new replies at the end.
 *  `late`: signal mark, and the nudge / mute buttons in their own column on the right (siblings of the row button,
 *  never inside it, never over its text). */
function Row({ i, now, on, news, late, onOpen, onNudge, onMute }: {
  i: QaItem; now: number; on: boolean; news: number; late: boolean; onOpen: () => void; onNudge: () => void; onMute: () => void;
}) {
  const end = accepted(i) ?? i.answers.at(-1); // a settled thread previews its answer
  const at = latest(i).date;
  return (
    <li className={cn("relative flex transition-colors duration-(--dur-micro) hover:bg-paper-2",
      (on || late) && "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
      on ? "bg-hl-wash before:bg-hl hover:bg-hl-wash" : late && "bg-signal-wash/50 before:bg-signal")}>
      <button type="button" data-qa={i.code} aria-current={on || undefined} onClick={onOpen}
        className={cn("grid min-w-0 flex-1 grid-cols-1 gap-1.5 py-2.5 pl-4 text-left", late ? "pr-1" : "pr-4")}>
        <span className="flex items-start gap-3">
          <span className={cn("line-clamp-2 min-w-0 flex-1 text-sm leading-snug text-ink", news ? "font-semibold" : "font-medium")}>{gist(i.question)}</span>
          <time dateTime={at} title={timeLabel(at, true)} className="shrink-0 pt-px font-mono text-xs text-ink-3 tabular-nums">{clockLabel(at)}</time>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
          <State i={i} now={now} late={late} />
          <span className="min-w-0 flex-1 truncate">
            {end ? <><b className="font-medium text-ink-2">{who(end)}:</b> {gist(end)}</> : <>{who(i.question)} hỏi</>}
          </span>
          {news > 0 && <span className={cn(PILL, "bg-hl text-hl-ink")}>{news} mới</span>}
        </span>
      </button>
      {late && (
        <span className="flex shrink-0 flex-col items-center justify-center gap-1 border-l border-rule/60 px-1.5">
          <Hint side="bottom" text="Nhắc lại trong nhóm: soạn sẵn tin trả lời vào câu hỏi này (tag lại người được hỏi), Enter để gửi">
            <Button size="icon-xs" variant="ghost" className="text-signal-2 hover:bg-signal-wash" aria-label={`Nhắc lại ${i.code}`} onClick={onNudge}><BellRing /></Button>
          </Hint>
          <Hint side="bottom" text="Bỏ qua: không nhắc câu này nữa">
            <Button size="icon-xs" variant="ghost" className="text-ink-3" aria-label={`Bỏ qua nhắc ${i.code}`} onClick={onMute}><BellOff /></Button>
          </Hint>
        </span>
      )}
    </li>
  );
}

const SUM_ERR = { ai_not_configured: "Chưa cài AI (Cài đặt › AI).", ai_context_too_large: "Chuỗi quá dài để AI đọc.", message_not_found: "Không đọc được các tin của chuỗi." };

/** The open question: its code, state and people, the answer you settled on, then the chain as tag rows (`MessageItem`,
 *  bare) on one rail. Kept tags keep their tag actions; a click on a message makes it the one the box below answers;
 *  "Chốt" on a reply marks it as the answer. AI can sum the thread up (question, conclusion, what is still open).
 *  Keyed by code: a new thread starts with no summary. */
function Thread({ i, now, title, seenAt, target, onTarget, onClose, late, muted, remind, onNudge, onMute, onResolve, onMark }: {
  i: QaItem; now: number; title?: string; seenAt: Seen; target: Message | null; onTarget: (m: Message) => void; onClose: () => void;
  late: boolean; muted: boolean; remind: number; onNudge: () => void; onMute: (off: boolean) => void; onResolve: (id: string | null) => void;
  onMark: (state: QaMark) => void;
}) {
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
      setSum({ text: "", busy: false, error: ctl.signal.aborted ? "Đã dừng." : errorText(e, SUM_ERR, "AI không tóm tắt được.") });
    }
  }
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 @4xl/qa:px-5">
        <Hint side="bottom" text="Về danh sách câu hỏi (Esc)">
          <Button size="icon-sm" variant="ghost" className="@4xl/qa:hidden" aria-label="Về danh sách" onClick={onClose}><ArrowLeft /></Button>
        </Hint>
        <Hint side="bottom" title={i.code} text="Mã Q&A, bấm để chép. Ghi mã này trong tin trên Telegram là gắn vào chuỗi; bấm hashtag đó trong Telegram để xem cả chuỗi.">
          <button type="button" aria-label={`Chép mã ${i.code}`} onClick={() => void copyText(i.code, `Đã chép ${i.code}`)}
            className="rounded-full bg-hl-wash px-2 font-mono text-xs leading-5 font-medium text-hl-2 tabular-nums transition-colors duration-(--dur-micro) hover:bg-hl hover:text-hl-ink">
            {i.code}
          </button>
        </Hint>
        <State i={i} now={now} late={late} />
        <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{[...new Set(all.map(who))].join(", ")}</span>
        <AiAsk label="AI tóm tắt kết luận" hint="Mình tóm câu hỏi, kết luận và việc còn mở nhé!" onClick={() => void summarize()} />
        <Hint side="bottom" text="Chép cả chuỗi (người, giờ, nội dung; câu trả lời đã chốt ở đầu) để dán vào ticket, AI hay gửi người khác">
          <Button size="icon-sm" variant="ghost" aria-label={`Chép chuỗi ${i.code}`} onClick={() => void copyText(transcript(i, title), `Đã chép chuỗi ${i.code}`)}><Copy /></Button>
        </Hint>
        <Hint side="bottom" text={i.done ? "Mở lại: chuỗi quay về trạng thái theo các trả lời, nhắc lại như cũ"
          : "Đánh dấu xong: không nhắc nữa, rời Chờ trả lời và Câu hỏi của tôi (xem lại ở bộ lọc Xong)"}>
          <Button size="icon-sm" variant="ghost" aria-pressed={i.done} aria-label={i.done ? `Mở lại ${i.code}` : `Đánh dấu xong ${i.code}`}
            className={cn(i.done && "text-ok")} onClick={() => onMark(i.done ? null : "done")}>{i.done ? <RotateCcw /> : <CircleCheck />}</Button>
        </Hint>
        <Hint side="bottom" text="Xóa chuỗi khỏi Q&A trên dashboard (tin trên Telegram vẫn còn). Bấm 2 lần để xác nhận">
          <Button size={sure ? "xs" : "icon-sm"} variant={sure ? "destructive" : "ghost"} aria-label={`Xóa ${i.code} khỏi Q&A`} onBlur={() => setSure(false)}
            onClick={() => { if (!sure) return setSure(true); setSure(false); onMark("deleted"); }}>
            <Trash2 />{sure && "Bấm lần nữa để xóa"}
          </Button>
        </Hint>
      </div>
      {answer && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-ok-wash px-3 py-2 text-xs text-ok @4xl/qa:px-5">
          <CheckCheck className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-ink-2"><b className="font-semibold text-ok">Đã chốt · {who(answer)}:</b> {gist(answer)}</span>
          <Hint side="bottom" text="Bỏ chốt: chuỗi quay lại trạng thái theo các trả lời">
            <Button size="xs" variant="ghost" onClick={() => onResolve(null)}>Bỏ chốt</Button>
          </Hint>
        </div>
      )}
      {late ? (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-signal-wash px-3 py-2 text-xs text-signal-2 @4xl/qa:px-5">
          <BellRing className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Chưa ai trả lời sau {qaRemindLabel(remind)}{nudged > 0 && `, bạn đã nhắc ${nudged} lần`}.</span>
          <Button size="xs" className="bg-hl" onClick={onNudge}><BellRing /> Nhắc lại trong nhóm</Button>
          <Hint side="bottom" text="Không nhắc câu này nữa (bật lại ngay tại đây)">
            <Button size="xs" variant="ghost" onClick={() => onMute(true)}><BellOff /> Bỏ qua</Button>
          </Hint>
        </div>
      ) : muted && i.question.outgoing && waiting(i) && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-ink-3 @4xl/qa:px-5">
          <BellOff className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Đã tắt nhắc cho câu này.</span>
          <Button size="xs" variant="ghost" onClick={() => onMute(false)}>Bật lại</Button>
        </div>
      )}
      {/* The rail runs through the avatars, so the chain reads as one conversation. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sum && (
          <div aria-live="polite" className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-2 px-4 pt-3 @4xl/qa:px-5">
            {sum.error ? (
              <AiResultCard error actions={<Button size="xs" variant="ghost" onClick={() => setSum(null)}><X /> Đóng</Button>}>{sum.error}</AiResultCard>
            ) : sum.busy ? (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">{sum.text ? <><Markdown text={sum.text} className="text-ink" /><AiWriting /></> : <AiThinking lines={["Đang đọc cả chuỗi", "Đang tìm câu trả lời chốt", "Đang gom việc còn mở"]} />}</div>
                <AiStop onClick={() => stop.current?.abort()} hint="Dừng tóm tắt" />
              </div>
            ) : (
              <AiResultCard title="Kết luận (AI)" actions={<>
                <Button size="xs" variant="ghost" onClick={() => void copyText(sum.text, "Đã chép kết luận")}><Copy /> Copy</Button>
                <Button size="xs" variant="ghost" onClick={() => setSum(null)}><X /> Đóng</Button>
              </>}>
                <Markdown text={sum.text} className="text-ink" />
              </AiResultCard>
            )}
          </div>
        )}
        <ol aria-label={`Chuỗi ${i.code}`} className="@container relative mx-auto max-w-3xl py-2 before:absolute before:inset-y-6 before:left-8 before:w-px before:bg-rule-2 @xl:before:left-9">
          {all.map((m, k) => (
            <MessageItem key={m.message_id} m={untag(m)} now={now} head={k === 0 || all[k - 1].sender_id !== m.sender_id || all[k - 1].outgoing !== m.outgoing}
              isReplyTarget={!!target && msgKey(target) === msgKey(m)} onReply={onTarget} onUseText={noop} live={!m.kept} liveReply bare fresh={news.has(m.message_id)}
              extra={k > 0 && !m.deleted && (answer?.message_id === m.message_id ? (
                <span className={cn(PILL, "mr-1 bg-ok-wash text-ok")}><CheckCheck aria-hidden />Câu trả lời</span>
              ) : (
                <Hint side="bottom" text="Chốt tin này là câu trả lời của câu hỏi: chuỗi thành Đã chốt, không nhắc nữa, tin này hiện ở đầu chuỗi và trong Chép chuỗi">
                  <Button size="xs" variant="ghost" onClick={() => onResolve(m.message_id)}
                    className="opacity-0 transition-opacity duration-(--dur-micro) group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
                    <CheckCheck /> Chốt
                  </Button>
                </Hint>
              ))} />
          ))}
        </ol>
      </div>
    </>
  );
}

/** Q&A page: one group's questions and the open thread; with no group picked yet, the groups to pick from.
 *  `focus`: a "#QA…" code to open (a badge on a message), widening to 30 days when it is older. */
export function QaPage({ focus, group, onGroup, days, onDays, onBack }: {
  focus: string | null; group: string | null; onGroup: (chatId: string) => void; days: QaDays; onDays: (d: QaDays) => void; onBack: () => void;
}) {
  const groups = useQuery(qaGroupsQuery);
  const title = groups.data?.find((g) => g.chat_id === group)?.title;
  return (
    <section aria-label="Q&A" className="flex min-h-0 flex-col">
      {group === QA_MINE ? <MyQuestions days={days} onDays={onDays} /> : group ? <GroupQa key={group} chatId={group} title={title} focus={focus} days={days} onDays={onDays} /> : (
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-4 sm:p-6">
          <div className="grid w-full max-w-sm justify-items-center gap-2 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-hl-wash text-hl-2"><MessageCircleQuestion className="size-5" aria-hidden /></span>
            <p className="text-sm font-semibold text-ink">Hỏi nhóm nào?</p>
            <p className="text-sm leading-relaxed text-ink-3">Đăng câu hỏi vào bất kỳ nhóm nào (kèm mã #QA…) và xem lại từng câu với cả chuỗi trả lời.</p>
            <div className="mt-2 h-[min(55vh,26rem)] w-full rounded-xl border bg-cotton pt-2 text-left">
              <QaGroups days={days} selected={null} onSelect={onGroup} collapsed={false} />
            </div>
            <Button size="sm" variant="ghost" className="md:hidden" onClick={onBack}><ArrowLeft /> Việc cần xử lý</Button>
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
  const { lists, ready } = useQaNews(days, true);
  const now = useNow();
  const mins = useQaRemind();
  const muted = useStored<string[]>(MUTED, []);
  const recent = useQaRecent();
  const open = mineOpen(lists);
  const wait = useAiWait(recent.length > 0 && !ready && !open.length);
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
      onMute={() => { mute(i.code, true); toast({ text: `Đã bỏ qua nhắc ${i.code}`, undo: () => mute(i.code, false) }); }} />
  );
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-4">
        <p className="min-w-0 flex-1 truncate text-sm text-ink-2">
          <span className="font-mono text-base font-semibold text-ink tabular-nums">{open.length}</span> câu bạn hỏi chưa ai trả lời
          <span className="hidden text-ink-3 sm:inline"> · {recent.slice(0, 8).length} nhóm hỏi gần đây</span>
        </p>
        <Dropdown label="Khoảng thời gian" value={String(days)} onChange={(v) => onDays(Number(v) as QaDays)} className="w-[5.5rem]"
          options={QA_DAYS.map(([v, l]) => ({ value: String(v), label: l }))} />
      </header>
      <div className="min-h-0 overflow-y-auto">
        {wait ? (
          <AiFetching kind="qa" lines={["AI đang kết nối Telegram", "Đang đọc câu bạn hỏi ở các nhóm", "Đang tìm câu chưa ai trả lời", "Sắp xong rồi"]} />
        ) : !open.length ? (
          <div className="grid justify-items-center gap-2 px-4 py-16 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-ok-wash text-ok"><CheckCheck className="size-5" aria-hidden /></span>
            <p className="text-sm font-semibold text-ink">{recent.length ? "Câu nào bạn hỏi cũng có người trả lời rồi" : "Bạn chưa hỏi nhóm nào"}</p>
            <p className="max-w-xs text-sm leading-relaxed text-ink-3">
              {recent.length ? `Trong ${QA_DAYS.find(([v]) => v === days)![1]} qua.` : "Chọn một nhóm bên trái để đăng câu hỏi kèm mã #QA…"}
            </p>
            {recent.length > 0 && days < 30 && <Button size="xs" variant="outline" onClick={() => onDays(30)}>Xem 30 ngày</Button>}
          </div>
        ) : (
          [...(late.length ? [["late", late] as const] : []), ...groups].map(([g, its]) => (
            <section key={g} aria-label={g === "late" ? "Cần nhắc" : g}>
              <h3 className={cn("sticky top-0 z-10 flex items-center gap-1.5 border-b bg-paper-2/95 px-4 py-1 text-xs font-medium backdrop-blur-sm", g === "late" ? "text-signal-2" : "text-ink-3")}>
                {g === "late" ? <><BellRing className="size-3.5" aria-hidden />Chưa ai trả lời sau {qaRemindLabel(mins)}</> : g}
                <span className="ml-auto font-mono tabular-nums">{its.length}</span>
              </h3>
              <ul className="divide-y divide-rule">{its.map((i) => row(i, g === "late"))}</ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

const QA_PREFILL = "qa-prefill"; // sessionStorage key + window event: {chatId, text} for a new question (YouTrack sheet)

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
  const typed = useSyncExternalStore(draft.sub, draft.get, draft.get);
  const mention = useMention(groupMembers(chatId), typed, draft.set);
  const text = mention.wire(typed); // as sent: a member tagged by name counts as a tag
  const send = () => onSend(text);
  return (
    <AiPromptBox className="mx-auto max-w-3xl" value={typed} onChange={draft.set} onSend={send} maxLength={4000} mention={mention}
      aria-label={to ? "Trả lời trong chuỗi" : "Câu hỏi mới"}
      placeholder={to ? `Trả lời ${who(to)}…` : `Hỏi ${title ?? "nhóm"}… (tag @tên người được hỏi)`}
      top={top(text)}
      tools={!to && (hasTag(text)
        ? <span className="text-ink-3">Có tag: tự thêm mã <span className="font-mono">#QA…</span> ở cuối tin</span>
        : <span className="text-ink-3">Tag người được hỏi (<span className="font-mono">@tên</span>) để mở Q&A; không tag thì gửi như tin thường</span>)}
      actions={
        <Hint side="bottom" text={`${to ? "Gửi trả lời" : "Đăng câu hỏi vào nhóm"} (Enter, Shift+Enter xuống dòng)`}>
          <Button size="sm" className="rounded-full bg-hl" disabled={!text.trim() || busy} aria-busy={busy} onClick={send}>
            <Send />{to ? "Trả lời" : "Đăng"}
          </Button>
        </Hint>
      } />
  );
}

function GroupQa({ chatId, title, focus, days, onDays }: {
  chatId: string; title?: string; focus: string | null; days: QaDays; onDays: (d: QaDays) => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({ ...qaQuery(chatId, days), refetchInterval: 60_000 }); // answers show up while you read
  const listWait = useAiWait(list.isPending);
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  // The box text lives outside this component's state: a keystroke re-renders only the box, not the list and thread.
  const [draft] = useState(() => draftStore(`qa-draft:${chatId}`));
  useEffect(() => draft.flush, [draft]); // leaving within the save debounce
  const edit = draft.set;
  // The open thread's code, or "new": the empty box on its own (narrow screens; wide ones always show the reader).
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
    if (off) toast({ text: `Đã bỏ qua nhắc ${i.code}`, undo: () => mute(i.code, false) });
  };
  const onResolve = (i: QaItem, id: string | null) => {
    const was = resolvedIds()[i.code] ?? null;
    resolve(i.code, id);
    toast({ text: id ? `Đã chốt câu trả lời cho ${i.code}` : `Đã bỏ chốt ${i.code}`, undo: () => resolve(i.code, was) });
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
  const [seenAt, setSeenAt] = useState(() => parse<Seen>(getPref(SEEN), {}));
  useEffect(() => {
    if (list.data) markSeen(list.data.map((i) => [i.code, Math.max(...thread(i).map((m) => Number(m.message_id)))]));
  }, [list.data]);

  // One-shot open of a code once the list has it: a badge's code (not in range: widen to 30 days, then give up)
  // or the question just posted (waits for the refetch).
  const want = useRef<{ code: string; widen: boolean } | null>(focus ? { code: focus, widen: true } : null);
  useEffect(() => {
    const w = want.current;
    if (!w || !list.data) return;
    if (!list.data.some((i) => i.code === w.code)) {
      if (!w.widen) return;
      if (days < 30) return onDays(30);
      want.current = null;
      toast({ text: `Không thấy ${w.code} trong 30 ngày qua của nhóm này` });
      return;
    }
    want.current = null;
    setOpen(w.code); // `show` minus the nudge cleanup: a send already emptied the box
    setTarget(null);
    setRead((r) => new Set(r).add(w.code));
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-qa="${CSS.escape(w.code)}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: smooth() });
      el?.animate([{ boxShadow: "inset 0 0 0 2px var(--color-hl)" }, { boxShadow: "inset 0 0 0 0 transparent" }], { duration: 1800, easing: "ease-out" });
    });
  }, [list.data, days, onDays]);

  const items = list.data ?? [];
  const cur = items.find((i) => i.code === open);
  const to = target ?? (cur && latest(cur)) ?? null; // what a send answers; none: a new question
  // A target outside every thread (someone's question): the answer opens a thread on it.
  const start = !!target && !!list.data && !items.some((i) => thread(i).some((m) => msgKey(m) === msgKey(target)));
  const reading = !!cur || open === "new" || !!target; // narrow screens: the reader takes the list's place

  const post = useMutation({
    mutationFn: (text: string) => api<QaPosted>("/qa", { method: "POST", json: { chat_id: chatId, text, reply_to: to?.message_id ?? null, start } }),
    onSuccess: (r) => {
      remember(chatId);
      edit("");
      setTarget(null);
      if (r.code) {
        markSeen([[r.code, Number(r.message_id)]]);
        setSeenAt((x) => ({ ...x, [r.code!]: Number(r.message_id) })); // you just answered it: nothing in it is "Mới"
        setFilter("all");
        setFind("");
        want.current = { code: r.code, widen: r.joined }; // joined: an older thread, maybe outside the range
      }
      toast({ text: r.joined ? `Đã trả lời trong chuỗi ${r.code}` : r.code ? `${start ? "Đã trả lời, mở Q&A" : "Đã đăng câu hỏi"} ${r.code}`
        : !to || start ? "Đã gửi như tin thường: không tag ai nên không tạo Q&A" : "Đã gửi trả lời" });
      void qc.invalidateQueries({ queryKey: ["qa", chatId] });
    },
    onError: (e) => toast({ text: errorText(e, { forbidden: "Nhóm không cho bạn gửi tin", reply_not_found: "Tin được trả lời không còn" }, "Không gửi được, thử lại") }),
  });
  const send = (t: string) => { if (t.trim() && !post.isPending) post.mutate(t); };

  const s = fold(find.trim());
  const shown = items.filter(FILTERS.find(([f]) => f === filter)![2])
    .filter((i) => !s || fold(`${i.code} ${thread(i).map((m) => `${who(m)} ${m.text}`).join(" ")}`).includes(s));
  // Your questions due a nudge lead the list (what needs you first), the rest by the day of their latest message.
  const late = shown.filter((i) => isLate(i, mins, now, muted));
  const rest = shown.filter((i) => !late.includes(i));
  const ordered = [...late, ...rest];
  const dayGroups: [string, QaItem[]][] = [];
  for (const i of rest) {
    const d = dayLabel(latest(i).date);
    if (dayGroups.at(-1)?.[0] === d) dayGroups.at(-1)![1].push(i);
    else dayGroups.push([d, [i]]);
  }

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
          <Segmented id="qa-filter" label="Lọc Q&A" value={filter} onChange={setFilter} className="w-max"
            items={FILTERS.map(([v, l, f, hint]) => ({
              value: v, title: hint || undefined,
              label: <span className="flex items-center gap-1.5">{l}<span className="font-mono tabular-nums opacity-70">{items.filter(f).length}</span></span>,
            }))} />
        </div>
        <label className={cn("relative min-w-36 flex-1 @2xl/qa:max-w-64", reading && "@max-4xl/qa:hidden")}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Tìm nội dung, người, #QA…" aria-label="Tìm Q&A"
            className="h-8 w-full rounded-[var(--radius-input)] border border-rule-2 bg-cotton pr-2 pl-8 text-xs text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1" />
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          <Dropdown label="Khoảng thời gian" value={String(days)} onChange={(v) => onDays(Number(v) as QaDays)} className="w-[5.5rem]"
            options={QA_DAYS.map(([v, l]) => ({ value: String(v), label: l }))} />
          <Hint side="bottom" text="Nhắc khi câu hỏi của bạn chưa ai trả lời sau khoảng này (cũng ở Cài đặt › Telegram)">
            <span className="inline-flex">
              <Dropdown label="Nhắc khi chưa ai trả lời sau" value={String(mins)} onChange={(v) => setPref("qaRemindMins", v)} className="w-[7.25rem]"
                prefix={mins ? <BellRing aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : <BellOff aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
                options={QA_REMIND_CHOICES.map((m) => ({ value: String(m), label: qaRemindLabel(m), hint: m ? `Nhắc sau ${qaRemindLabel(m)}` : "Không nhắc" }))} />
            </span>
          </Hint>
          <Hint side="bottom" text="Đọc lại nhóm (tự đọc lại mỗi phút)">
            <Button size="icon-sm" variant="ghost" aria-label="Đọc lại" disabled={list.isFetching} onClick={() => void list.refetch()}>
              <RotateCw className={cn(list.isFetching && "animate-spin")} />
            </Button>
          </Hint>
          <Hint side="bottom" text="Đăng câu hỏi mới vào nhóm này">
            <Button size="sm" onClick={() => { show("new"); requestAnimationFrame(focusBox); }}><Plus /><span className="@max-md/qa:sr-only">Câu hỏi mới</span></Button>
          </Hint>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-1 @4xl/qa:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)]">
        <div className={cn("min-h-0 overflow-y-auto @4xl/qa:border-r", reading ? "hidden @4xl/qa:block" : "block")}>
          {listWait ? (
            <AiFetching kind="qa" />
          ) : list.isError ? (
            <div role="alert" className="grid justify-items-start gap-2 p-4 text-sm text-error">
              {errorText(list.error, {}, "Không đọc được nhóm.")}
              <Button size="xs" variant="outline" onClick={() => void list.refetch()}><RotateCw /> Thử lại</Button>
            </div>
          ) : !shown.length ? (
            <div className="grid justify-items-center gap-2 px-4 py-12 text-center">
              <p className="text-sm font-semibold text-ink">{items.length ? "Không thấy Q&A khớp" : "Chưa có Q&A nào"}</p>
              <p className="max-w-xs text-sm leading-relaxed text-ink-3">
                {items.length ? "Thử từ khác hoặc bộ lọc khác." : `Trong ${QA_DAYS.find(([v]) => v === days)![1]} qua chưa có câu hỏi kèm mã #QA… ở nhóm này.`}
              </p>
              {items.length ? <Button size="xs" variant="outline" onClick={() => { setFilter("all"); setFind(""); }}>Bỏ lọc</Button>
                : days < 30 && <Button size="xs" variant="outline" onClick={() => onDays(30)}>Xem 30 ngày</Button>}
            </div>
          ) : (
            [...(late.length ? [["late", late] as const] : []), ...dayGroups].map(([d, its]) => (
              <section key={d} aria-label={d === "late" ? "Chưa ai trả lời" : d}>
                <h3 className={cn("sticky top-0 z-10 flex items-center gap-1.5 border-b bg-paper-2/95 px-4 py-1 text-xs font-medium backdrop-blur-sm", d === "late" ? "text-signal-2" : "text-ink-3")}>
                  {d === "late" ? <><BellRing className="size-3.5" aria-hidden />Chưa ai trả lời sau {qaRemindLabel(mins)}<span className="ml-auto font-mono tabular-nums">{late.length}</span></> : d}
                </h3>
                <ul className="divide-y divide-rule">
                  {its.map((i) => (
                    <Row key={i.code} i={i} now={now} on={i.code === open} news={read.has(i.code) ? 0 : fresh(i, seenAt).length} late={d === "late"}
                      onOpen={() => show(i.code)} onNudge={() => nudge(i)} onMute={() => onMute(i, true)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className={cn("min-h-0 flex-col", reading ? "flex" : "hidden @4xl/qa:flex")}>
          {cur ? (
            <Thread key={cur.code} i={cur} now={now} title={title} seenAt={seenAt} target={target} onTarget={pick} onClose={() => show(null)}
              late={late.includes(cur)} muted={muted.includes(cur.code)} remind={mins} onNudge={() => nudge(cur)} onMute={(off) => onMute(cur, off)}
              onResolve={(id) => onResolve(cur, id)}
              onMark={(state) => { if (state === "deleted") show(null); void markWithUndo(qc, cur, state); }} />
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
              <div className="grid max-w-sm justify-items-center gap-2 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-hl-wash text-hl-2"><MessageCircleQuestion className="size-5" aria-hidden /></span>
                <p className="text-sm font-semibold text-ink">Câu hỏi mới cho {title ?? "nhóm"}</p>
                <p className="text-sm leading-relaxed text-ink-3">
                  Gõ ở ô dưới: tin đăng vào nhóm kèm một dòng mã #QA…, mọi trả lời nối tiếp gom thành một chuỗi.
                  <span className="hidden @4xl/qa:inline"> Chọn một câu bên trái để đọc cả chuỗi.</span>
                </p>
                <Button size="sm" variant="ghost" className="@4xl/qa:hidden" onClick={() => show(null)}><ArrowLeft /> Danh sách câu hỏi</Button>
              </div>
            </div>
          )}
          <div ref={box} className="shrink-0 border-t px-3 py-3 @4xl/qa:px-5" onKeyDown={(e) => { if (e.key === "Escape" && target && !e.defaultPrevented) { e.preventDefault(); setTarget(null); } }}>
            <QaBox chatId={chatId} draft={draft} onSend={send} busy={post.isPending} to={to} title={title}
              top={(text) => to && (
                <div className="flex items-center gap-2 rounded-md border-l-[3px] border-hl bg-paper-2 py-1 pr-1 pl-2.5 text-xs">
                  <Reply className="size-3.5 shrink-0 text-hl-2" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink-2"><b className="font-semibold text-ink">{who(to)}:</b> {gist(to)}</span>
                  {start && (hasTag(text) ? (
                    <Hint side="bottom" text="Tin này không thuộc chuỗi nào đang hiện và bạn có tag người: câu trả lời kèm mã #QA…, tin này đứng đầu chuỗi mới. Nếu nó nằm trong một chuỗi cũ hơn thì trả lời vào đúng chuỗi đó, không thêm mã.">
                      <span className="shrink-0 rounded-full bg-hl-wash px-2 leading-5 font-medium text-hl-2">Mở Q&A mới</span>
                    </Hint>
                  ) : (
                    <Hint side="bottom" text="Chưa tag ai (@tên): gửi như một tin trả lời thường, không mở Q&A. Tag người được hỏi để mở chuỗi Q&A.">
                      <span className="shrink-0 rounded-full bg-paper-3 px-2 leading-5 font-medium text-ink-2">Tin thường</span>
                    </Hint>
                  ))}
                  {target ? (
                    <Hint side="bottom" text={cur ? "Bỏ chọn (Esc): trả lời tin mới nhất của chuỗi" : "Bỏ trả lời (Esc): gửi thành câu hỏi mới"}>
                      <Button size="icon-xs" variant="ghost" aria-label="Bỏ chọn tin" onClick={() => setTarget(null)}><X /></Button>
                    </Hint>
                  ) : <span className="hidden shrink-0 pr-1.5 text-ink-3 @2xl/qa:inline">Bấm một tin để trả lời tin đó</span>}
                </div>
              )}
            />
          </div>
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
    <li key={g.chat_id}>
      <button type="button" aria-current={selected === g.chat_id} onClick={() => onSelect(g.chat_id)}
        className={cn("relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
          selected === g.chat_id && "font-medium text-hl-2 hover:bg-transparent", !!news[g.chat_id] && "font-medium text-ink")}>
        {selected === g.chat_id && <NavPill />}
        <Avatar name={g.title} className="relative" />
        <span className={cn("relative min-w-0 flex-1 truncate", fade)}>{g.title}</span>
        {!!late[g.chat_id] && (
          <span className={cn("relative inline-flex shrink-0 items-center gap-0.5 rounded-full bg-signal-wash px-1.5 font-mono text-xs leading-5 font-medium text-signal-2 tabular-nums", fade)}
            aria-label={`${late[g.chat_id]} câu chưa ai trả lời, cần nhắc`}><BellRing className="size-3" aria-hidden />{late[g.chat_id]}</span>
        )}
        {!!news[g.chat_id] && (
          <span className={cn("relative shrink-0 rounded-full bg-hl px-1.5 text-xs leading-5 font-medium text-hl-ink tabular-nums", fade)}
            aria-label={`${news[g.chat_id]} trả lời mới`}>{news[g.chat_id]}</span>
        )}
      </button>
    </li>
  );
  const label = (t: string) => <li className={cn("px-3 pt-2 pb-0.5 text-xs font-medium text-ink-3", fade)}>{t}</li>;
  return (
    <nav aria-label="Nhóm Q&A" className="no-scrollbar h-full min-h-0 overflow-y-auto px-2 pb-3">
      <label className={cn("relative mb-1 block px-1", fade)}>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhóm…" aria-label="Tìm nhóm"
          className="h-8 w-full rounded-[var(--radius-input)] border border-rule-2 bg-cotton pr-2 pl-8 text-xs text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1" />
      </label>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
        {!s && recents.length > 0 && (
          <li>
            <button type="button" aria-current={selected === QA_MINE} onClick={() => onSelect(QA_MINE)}
              className={cn("relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
                selected === QA_MINE && "font-medium text-hl-2 hover:bg-transparent")}>
              {selected === QA_MINE && <NavPill />}
              <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-paper-3 text-ink-2"><MessageCircleQuestion className="size-4" aria-hidden /></span>
              <span className={cn("relative min-w-0 flex-1 truncate", fade)}>Câu hỏi của tôi</span>
              {mine > 0 && <span className={cn("relative shrink-0 rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums", fade)}
                aria-label={`${mine} câu chưa ai trả lời`}>{mine}</span>}
            </button>
          </li>
        )}
        {recent.length > 0 && <>{label("Đã hỏi gần đây")}{recent.map(row)}{label("Mọi nhóm")}</>}
        {rest.map(row)}
      </ul>
      {list.isPending && <div className="grid gap-2 px-3 pt-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-4" style={{ width: `${70 - k * 12}%` }} />)}</div>}
      {list.isError && <p className={cn("px-3 py-2 text-sm text-error", fade)}>Không đọc được danh sách nhóm.</p>}
      {list.isSuccess && !all.length && <p className={cn("px-3 py-2 text-sm leading-relaxed text-ink-3", fade)}>Không thấy nhóm nào.</p>}
    </nav>
  );
}

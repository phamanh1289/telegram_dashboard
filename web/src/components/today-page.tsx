"use client";

import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowRight, ChevronDown, Clock, Hourglass, Inbox, type LucideIcon, Megaphone, MessageCircleQuestion, RotateCw, Sparkles, TriangleAlert } from "lucide-react";
import { AiBotIcon } from "@/components/ai/chat";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { GROUP_NEST as NEST, GroupBar } from "@/components/ai/day-groups";
import { AiFetching, AllDone, useAiWait, useReload } from "@/components/ai/fetching";
import { Empty } from "@/components/ui/empty";
import { briefingQuery, ROW_MOTION } from "@/components/briefing-page";
import { answeredQuery, openCount, useDone } from "@/components/digest-page";
import { mineOpen, useQaNews } from "@/components/qa-page";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { api, errorText, type Message, type PendingItem, type QaItem, type Task } from "@/lib/api";
import { fmtDate, type Key, type T, useT } from "@/lib/i18n";
import { inQaPage, msgKey, openQa, openReplyById, openTask, ticketClick, pendingQuery, sentQuery, sessionId, TASK_STATE, ticketsIn, useNow, useTaskList, waitLabel } from "@/lib/inbox";
import { useRole } from "@/lib/prefs";
import { loopKey, useDoneLoop, useLoopBack } from "@/lib/report-back";
import { timeLabel } from "@/lib/time";
import { riskOf, useMyTickets, ytProjectsQuery } from "@/lib/yt";
import { cn, groupBy } from "@/lib/utils";

// "Hôm nay": everything that needs you, from every source, in one list ordered by how urgent it is, and what you are
// waiting on from others. It only reads what the shell already loads and polls (pending tags, my tickets, Q&A, AI
// Agent, Báo lại, Briefing); the snoozed list is its one extra read, keyed under "pending" so the live sync refreshes it.

type Src = "tg" | "yt" | "qa" | "agent" | "loop" | "brief";
const SRC: Record<Src, [Key, LucideIcon, string]> = {
  tg: ["Tag", Clock, "bg-hl-wash text-hl-2"],
  yt: ["YouTrack", TriangleAlert, "bg-paper-3 text-ink-2"],
  qa: ["Q&A", MessageCircleQuestion, "bg-info-wash text-info"],
  agent: ["AI Agent", AiBotIcon, "bg-paper-3 text-ink-2"],
  loop: ["Báo lại", Megaphone, "bg-ok-wash text-ok"],
  brief: ["Briefing", Sparkles, "bg-paper-3 text-ink-2"],
};

/** `links`: what ties a row to others ("chat:message" of a tag or a Q&A message, "yt:VA-1"); `side`: "theirs" waits on
 *  someone else, "ctx" (a running session, an answered thread) is shown only under a thread that has real work. */
/** `text` / `to`: the row as plain text and a deep link to it, for the know-it-all bot (workText). */
type Row = { key: string; src: Src; title: ReactNode; text: string; to: string; where?: string; why: string; hot?: boolean; at: number; go?: () => void; href?: string; click?: ReturnType<typeof ticketClick>; /* a ticket: its sheet here, href on ⌘ click */ extra?: ReactNode;
  links?: string[]; side?: "theirs" | "ctx" };
type Thread = { head: Row; rest: Row[]; hot: boolean; at: number; theirs: boolean };

const byUrgency = (a: { hot?: boolean; at: number }, b: { hot?: boolean; at: number }) => Number(!!b.hot) - Number(!!a.hot) || a.at - b.at; // urgent first, then the oldest

/** Rows sharing a link join one thread: the tag leads (else the most urgent row), its AI sessions, Q&A and tickets under it.
 *  A thread of only context rows is dropped. */
function threads(rows: Row[]): Thread[] {
  const up = rows.map((_, i) => i);
  const root = (i: number): number => (up[i] === i ? i : (up[i] = root(up[i])));
  const first = new Map<string, number>();
  rows.forEach((r, i) => r.links?.forEach((l) => { const j = first.get(l); if (j === undefined) first.set(l, i); else up[root(i)] = root(j); }));
  const groups = groupBy(rows.map((r, i) => [r, root(i)] as const), ([, g]) => g);
  return [...groups.values()].flatMap((g): Thread[] => {
    const all = g.map(([r]) => r);
    const real = all.filter((r) => r.side !== "ctx");
    if (!real.length) return [];
    const head = real.find((r) => r.src === "tg") ?? [...real].sort(byUrgency)[0];
    return [{ head, rest: all.filter((r) => r !== head).sort((a, b) => a.at - b.at), hot: real.some((r) => r.hot), at: Math.min(...real.map((r) => r.at)),
      theirs: real.every((r) => r.side === "theirs") }];
  }).sort(byUrgency);
}

const snoozedQuery = { queryKey: ["pending", "snoozed"], queryFn: ({ signal }: { signal: AbortSignal }) => api<PendingItem[]>("/snoozed", { signal }) };

const who = (m: Message, t: T) => (m.outgoing ? t("Bạn") : m.sender_name || "?");
const ms = (d: string) => new Date(d).getTime();
const Id = ({ children }: { children: ReactNode }) => <b className="font-mono font-medium text-ink">{children}</b>;
// deep links inbox.tsx `openLink` reads (the page's URL, or "Mở …" in the bot's answer)
const q = (p: Record<string, string>) => `/?${new URLSearchParams(p)}`;
const msgTo = (m: { chat_id: string; message_id: string }) => q({ chat: m.chat_id, msg: m.message_id });

/** Everything Hôm nay lists, split into what waits on you (`mine`) and what you wait on (`theirs`): the page and the
 *  know-it-all bot (guide.tsx, "còn tin nào chờ?") read this one list. The callbacks only matter on the page. */
export function useTodayWork(onReply?: (m: Message) => void, onBriefGroup?: (chatId: string) => void) {
  const t = useT();
  const now = useNow();
  const role = useRole();
  const pending = useQuery(pendingQuery(""));
  const snoozed = useQuery(snoozedQuery);
  const { me, rows: tickets } = useMyTickets(true, false); // the shell's 5-minute poll feeds it
  const known = useQuery(ytProjectsQuery).data;
  const qa = useQaNews(7, false, false);
  const codes = qa.codes; // as the inbox's QaCodes, which the bot (outside the inbox) has no provider for
  const taskQ = useTaskList();
  const tasks = taskQ.data ?? [];
  const sent = useQuery(sentQuery).data;
  const loopQ = useLoopBack();
  const loops = loopQ.data?.items ?? [];
  const doneLoop = useDoneLoop();
  const briefQ = useQuery(briefingQuery);
  const brief = briefQ.data ?? [];
  // a source that failed (not the tag list: it has its own alert): its items are missing, so the page must not read "all done"
  const partial = [taskQ.error, qa.error, briefQ.error, loopQ.error].find(Boolean);
  const [done] = useDone();
  const answered = useQuery({ ...answeredQuery, enabled: brief.some((b) => b.saved) }).data;

  const sentBy = new Map<string, string[]>(); // session id → the messages its turns carried
  for (const [k, ids] of Object.entries(sent ?? {})) for (const id of ids) sentBy.set(id, [...(sentBy.get(id) ?? []), k]);
  const tagLinks = (m: Message) => [msgKey(m), ...ticketsIn(m.text, known).map((id) => `yt:${id}`)];
  // the thread's messages, and the tag its question replied to (an ask posted from a session replies to the attached tag)
  const qaLinks = (i: QaItem) => [...[i.question, ...i.answers].map(msgKey), ...(i.question.reply_to_id ? [`${i.question.chat_id}:${i.question.reply_to_id}`] : [])];
  const qaRow = (i: QaItem, key: string, title: string, why: string, extra: Partial<Row> = {}): Row => ({ key, src: "qa", title: <><Id>{i.code}</Id> {title}</>,
    text: `${i.code} ${title}`, to: q({ qa: i.question.chat_id, code: i.code }),
    where: i.chat_title, why, at: ms(i.question.date), go: () => openQa(i.question.chat_id, i.code), links: qaLinks(i), ...extra });
  const taskRow = (k: Task, why: string, extra: Partial<Row> = {}): Row => ({ key: `ag:${k.id}`, src: "agent", title: <><Id>{sessionId(k)}</Id> {k.title || k.prompt || k.message_text}</>,
    text: `${sessionId(k)} ${k.title || k.prompt || k.message_text}`, to: q({ task: k.id }),
    where: k.chat_title || k.project.split("/").pop(), why, at: ms(k.created_at), go: () => openTask(k.id),
    links: [...(k.chat_id && k.message_id ? [msgKey(k)] : []), ...(sentBy.get(k.id) ?? [])], ...extra });
  const seen = new Set(qa.lateItems);
  const theirQa = mineOpen(qa.lists).filter((i) => !seen.has(i));
  for (const i of theirQa) seen.add(i);

  const rows: Row[] = [
    ...(pending.data ?? []).filter((p) => !inQaPage(codes, p.message)).map(({ chat_title, message: m }): Row => { // Q&A rows cover those
      const w = waitLabel(m.date, now, !!m.priority);
      const body = m.text || t("(tệp đính kèm)");
      return { key: `tg:${msgKey(m)}`, src: "tg", title: <><b className="font-medium text-ink">{who(m, t)}:</b> {body}</>, text: `${who(m, t)}: ${body}`, to: msgTo(m),
        where: chat_title, why: w.text, hot: w.overdue || !!m.pinned, at: ms(m.date), go: () => onReply?.(m), links: tagLinks(m) };
    }),
    ...tickets.flatMap((i): Row[] => {
      const risk = (role === "po" || (role === "qa" ? i.qc : i.assignee) === me) && riskOf(i, now);
      const href = `/youtrack/?ticket=${encodeURIComponent(i.id)}`;
      return risk ? [{ key: `yt:${i.id}`, src: "yt", title: <><Id>{i.id}</Id> {i.summary}</>, text: `${i.id} ${i.summary}`, to: href, where: i.state ?? undefined,
        why: risk, hot: risk === t("Quá hạn") || risk === t("Blocked"), at: i.updated, href, click: ticketClick(i.id), links: [`yt:${i.id}`] }] : [];
    }),
    ...qa.lateItems.map((i) => qaRow(i, `qal:${i.code}`, t("Chưa ai trả lời: {q}", { q: i.question.text }), t("cần nhắc"), { hot: true })),
    ...(qa.total && qa.firstNew ? [{ key: "qan", src: "qa" as const, hot: false, title: t("{n} trả lời mới cho câu hỏi của bạn", { n: qa.total }), where: qa.firstNew.chat_title,
      text: t("{n} trả lời mới cho câu hỏi của bạn", { n: qa.total }), to: q({ qa: qa.firstNew.question.chat_id, code: qa.firstNew.code }),
      why: t("trả lời mới"), at: now, go: () => void openQa(qa.firstNew!.question.chat_id, qa.firstNew!.code) }] : []),
    // a session waiting on an answer is one you wait on (it goes on by itself when BE answers: autobe.py)
    ...tasks.filter((k) => !k.handled && (k.running || !!k.result)).map((k) => k.running ? taskRow(k, t("đang chạy"), { side: "ctx" })
      : k.state === "waiting" ? taskRow(k, t(TASK_STATE.waiting), { side: "theirs" })
      : taskRow(k, k.state ? t(TASK_STATE[k.state]) : t("xong, chưa xem"))),
    ...loops.map((l): Row => ({ key: `lp:${loopKey(l)}`, src: "loop", title: t.n("{ticket} đã {state}: báo lại người hỏi", { ticket: <Id>{l.ticket}</Id>, state: l.state }),
      text: t("{ticket} đã {state}: báo lại người hỏi", { ticket: l.ticket, state: l.state }), to: msgTo(l),
      why: t("người hỏi chưa biết"), at: now - 2, go: () => void openReplyById(l.chat_id, l.message_id, `${l.ticket} đã chuyển ${l.state}, bạn kiểm tra lại giúp mình nhé.`),
      links: [`${l.chat_id}:${l.message_id}`, `yt:${l.ticket}`],
      extra: <Button size="xs" variant="ghost" className="text-ink-3" onClick={(e) => { e.preventDefault(); e.stopPropagation(); doneLoop(l); }}>{t("Bỏ qua")}</Button> })),
    ...brief.flatMap((b): Row[] => {
      const n = b.consent && b.saved ? openCount(b.chat_id, b.saved.result, done, answered) : 0;
      return n ? [{ key: `br:${b.chat_id}`, src: "brief", title: t("{n} việc còn mở (cần confirm, cần làm)", { n }), where: b.title,
        text: t("{n} việc còn mở (cần confirm, cần làm)", { n }), to: q({ brief: b.chat_id }),
        why: t("tóm tắt {time}", { time: timeLabel(b.saved!.created_at) }), at: ms(b.saved!.created_at), go: () => onBriefGroup?.(b.chat_id) }] : [];
    }),
    ...(snoozed.data ?? []).map(({ chat_title, message: m }): Row => ({
      key: `sz:${msgKey(m)}`, src: "tg", title: <><b className="font-medium text-ink">{who(m, t)}:</b> {m.text}</>, text: `${who(m, t)}: ${m.text}`, to: msgTo(m), where: chat_title, side: "theirs",
      why: m.snooze_on === "reply" ? t("chờ người trả lời") : m.snooze_on ? t("chờ {x} xong", { x: m.snooze_on.slice(7) }) : t("nhắc lại {time}", { time: timeLabel(m.snoozed_until!) }),
      at: ms(m.snoozed_until!), go: () => onReply?.(m), links: [...tagLinks(m), ...(m.snooze_on?.startsWith("ticket:") ? [`yt:${m.snooze_on.slice(7)}`] : [])] })),
    ...theirQa.map((i) => qaRow(i, `qm:${i.code}`, i.question.text, t("hỏi {time}", { time: timeLabel(i.question.date) }), { side: "theirs" })),
    ...Object.values(qa.lists).flat().filter((i) => !i.done && !seen.has(i)).map((i) => qaRow(i, `qc:${i.question.chat_id}:${i.code}`, i.question.text,
      i.answers.length ? t("{n} trả lời", { n: i.answers.length }) : t("chưa ai trả lời"), { side: "ctx" })),
  ];
  const all = threads(rows);
  return { mine: all.filter((th) => !th.theirs), theirs: all.filter((th) => th.theirs), pending, snoozed, qa, partial };
}

const BOT_ROWS = 25; // per section: the bot lists at most 7, the rest is for counting by kind
const cut = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ");

/** useTodayWork as plain text for the know-it-all bot (AiGuideRequest.work): one line per thread with its deep link;
 *  a source that failed is said, so the bot never reads it as "nothing waiting". */
export function workText({ mine, theirs, pending, partial }: ReturnType<typeof useTodayWork>, t: T): string {
  const line = (th: Thread) => {
    const r = th.head;
    return `- ${th.hot ? `[${t("Gấp")}] ` : ""}${t(SRC[r.src][0])}${r.where ? ` · ${cut(r.where, 40)}` : ""} · ${r.why} · ${cut(r.text)}${th.rest.length ? ` (+${th.rest.length})` : ""} → ${r.to}`;
  };
  const part = (label: string, items: Thread[]) => `${label} (${items.length}):\n${items.slice(0, BOT_ROWS).map(line).join("\n") || "-"}`;
  const err = pending.isError ? t("Không đọc được danh sách tag. Kiểm tra kết nối rồi thử lại.") : partial ? t("Một số nguồn chưa đọc được nên danh sách có thể thiếu: {e}", { e: errorText(partial, {}, t("lỗi kết nối.")) }) : "";
  if (pending.isPending) return t("Đang tải danh sách việc, chưa có số liệu.");
  return [err, part(t("Đang chờ bạn"), mine), part(t("Bạn đang chờ"), theirs)].filter(Boolean).join("\n\n");
}

export function TodayPage({ onReply, onGo, onBriefGroup }: {
  onReply: (m: Message) => void; onGo: (view: string) => void; onBriefGroup: (chatId: string) => void;
}) {
  const t = useT();
  const now = useNow();
  const { mine, theirs, pending, snoozed, qa, partial } = useTodayWork(onReply, onBriefGroup);
  const [loading, reload] = useReload([["pending"], ["tasks"], ["qa"], ["briefing"], ["yt", "issues"], ["briefing-answered"]]); // every source the page reads
  const wait = useAiWait(pending.isPending || loading);
  const theirWait = useAiWait(snoozed.isPending || qa.loading); // its own reads: tags you snoozed, your Q&A threads

  const urgent = mine.filter((th) => th.hot);
  const kinds = (Object.keys(SRC) as Src[]).map((k) => [k, mine.filter((th) => th.head.src === k).length] as const).filter(([, n]) => n > 0);
  const today = fmtDate(now, { weekday: "long", day: "2-digit", month: "2-digit" }, t.lang);

  const free = !mine.length && !pending.isError && !partial; // a failed read is not "all done"
  const none = free && !theirs.length && !theirWait && !snoozed.isError; // nobody waits either way: one scene, no sections

  if (wait) return <AiFetching kind="today" />;
  return (
    <MotionConfig reducedMotion="user">
      <section aria-label={t("Hôm nay")} className="@container flex min-h-0 flex-col overflow-y-auto">
        <header className="grid grid-cols-1 gap-2 px-4 pt-5 pb-4 @xl:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="text-xs text-ink-3 first-letter:uppercase">{today}</p>
              <h2 className="text-lg font-bold text-ink">{mine.length ? t("{n} việc đang chờ bạn", { n: mine.length }) : pending.isError ? t("Chưa đọc được việc của bạn") : t("Không có việc nào đang chờ bạn")}</h2>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {(pending.data?.length ?? 0) > 0 && <Button size="xs" variant="ghost" onClick={() => onGo("all")}>{t("Mở Việc cần xử lý")}<ArrowRight aria-hidden /></Button>}
              <Hint side="bottom" text={t("Tải lại việc hôm nay: đọc lại tag, phiên AI, Q&A, ticket và Briefing")}>
                <Button size="icon-xs" variant="ghost" aria-label={t("Tải lại việc hôm nay")} onClick={reload}><RotateCw aria-hidden /></Button>
              </Hint>
            </div>
          </div>
          {mine.length > 0 && (
            <ul aria-label={t("Theo loại")} className="flex flex-wrap gap-1.5">
              {urgent.length > 0 && <li className="inline-flex h-7 items-center gap-1.5 rounded-full bg-signal-wash px-2.5 text-xs text-signal-2"><AlarmClock className="size-3.5" aria-hidden /><b className="font-bold tabular-nums">{urgent.length}</b>{t("Gấp")}</li>}
              {kinds.map(([k, n]) => { const [label, Icon, tone] = SRC[k]; return (
                <li key={k} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-paper-2 pr-2.5 pl-1 text-xs text-ink-2">
                  <span className={cn("grid size-5 place-items-center rounded-full", tone)}><Icon className="size-3" aria-hidden /></span><b className="font-bold text-ink tabular-nums">{n}</b>{t(label)}
                </li>
              ); })}
            </ul>
          )}
          {pending.isError && (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-error">
              {errorText(pending.error, {}, t("Không đọc được danh sách tag. Kiểm tra kết nối rồi thử lại."))}
              <Button size="xs" variant="outline" onClick={reload}>{t("Thử lại")}</Button>
            </p>
          )}
        </header>

        {partial && !pending.isError && (
          <p role="alert" className="mx-4 flex flex-wrap items-center gap-2 text-xs text-error @xl:mx-6">
            {t("Một số nguồn chưa đọc được nên danh sách có thể thiếu: {e}", { e: errorText(partial, {}, t("lỗi kết nối.")) })}
            <Button size="xs" variant="outline" onClick={reload}>{t("Thử lại")}</Button>
          </p>
        )}
        {free && (none
          ? <Empty art={<AllDone className="mb-1 @max-[21rem]:[zoom:0.8]" />} className="@container flex-1 content-center py-8" title={t("Hết việc rồi!")}>{t("Không ai chờ bạn, bạn cũng không chờ ai. Tag mới, ticket rủi ro, tag đã hoãn và câu hỏi Q&A sẽ hiện ở đây.")}</Empty>
          : <Empty art={<AllDone className="mb-1 @max-[21rem]:[zoom:0.8]" />} className="@container pt-4 pb-8" title={t("Hết việc rồi!")}>{t("Đã xử lý hết. Tag mới, ticket rủi ro và câu trả lời Q&A sẽ hiện ở đây.")}</Empty>)}
        <div className="grid grid-cols-1 pb-4">
          {urgent.length > 0 && <Fold label={t("Gấp")} icon={<AlarmClock aria-hidden />} items={urgent} late />}
          {mine.length > urgent.length && <Fold label={t("Đang chờ bạn")} icon={<Inbox aria-hidden />} items={mine.filter((th) => !th.hot)} />}
          {!none && <Fold label={t("Bạn đang chờ")} icon={<Hourglass aria-hidden />} items={theirs} shut={mine.length > 0} note={t("tag đã hoãn, câu hỏi chưa ai trả lời")} wait={theirWait}
            empty={snoozed.isError ? <span role="alert" className="text-error">{t("Không đọc được danh sách tag đã hoãn. Thử tải lại trang.")}</span>
              : <Empty art={<AllDone className="mb-1 @max-[21rem]:[zoom:0.8]" />} className="@container py-4" title={t("Bạn không chờ ai")}>{t("Không có gì: tag bạn hoãn và câu hỏi Q&A chưa ai trả lời sẽ hiện ở đây.")}</Empty>} />}
        </div>
      </section>
    </MotionConfig>
  );
}

const FOLD = { initial: { height: 0, opacity: 0 }, animate: { height: "auto", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] } } as const;
const FIRST = 6; // threads a section shows before "Xem thêm"
const PAD = "px-4 @xl:px-6";

/** One section: a sticky GroupBar (click: fold / unfold, animated), its first FIRST threads and "Xem thêm" for the rest. */
function Fold({ label, icon, items, late, shut, note, empty, wait }: { label: string; icon: ReactNode; items: Thread[]; late?: boolean; shut?: boolean; note?: string; empty?: ReactNode; wait?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(!shut);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <section aria-label={label}>
      <GroupBar className={cn("bg-cotton/85", PAD)} label={label} icon={icon} count={items.length} note={note} open={open} late={late} onToggle={() => setOpen((o) => !o)} />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body" {...FOLD} className="grid grid-cols-1 overflow-hidden">
            {wait ? <AiFetching kind="waiting" className="min-h-0 py-4" /> : items.length ? (
              <ul className={cn("zebra grid grid-cols-1 divide-y divide-rule", NEST)}>
                <AnimatePresence initial={false}>
                  {shown.map((th) => <motion.li key={th.head.key} layout="position" {...ROW_MOTION} className="min-w-0"><ThreadItem th={th} /></motion.li>)}
                </AnimatePresence>
              </ul>
            ) : <div className={cn("py-3 text-sm text-ink-3", PAD, NEST)}>{empty}</div>}
            {!wait && items.length > FIRST && (
              <button type="button" onClick={() => setAll((a) => !a)}
                className={cn("flex items-center gap-1.5 border-t border-rule py-2 text-left text-xs font-medium text-ink-3 transition-colors duration-(--dur-micro) hover:bg-paper-2 hover:text-ink", PAD, NEST)}>
                <ChevronDown className={cn("size-3.5 transition-transform duration-(--dur-short)", all && "rotate-180")} aria-hidden />
                {all ? t("Thu gọn") : t("Xem thêm {n}", { n: items.length - FIRST })}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** A thread: its lead row; what links to it (AI sessions, Q&A, tickets) folds under it in an inset panel, closed until
 *  its chip is clicked. */
function ThreadItem({ th }: { th: Thread }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const n = th.rest.length;
  const tip = t(open ? "Ẩn {n} mục liên quan" : "Xem {n} mục liên quan (phiên AI, Q&A, ticket)", { n });
  const chip = n > 0 && (
    <Hint side="bottom" text={tip}>
      <button type="button" aria-expanded={open} aria-label={tip}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} // inside the row's link: no navigation onKeyDown={(e) => e.stopPropagation()}
        className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full border pr-1.5 pl-0.5 text-2xs font-medium tabular-nums transition-colors duration-(--dur-micro)",
          open ? "border-hl/40 bg-hl-wash text-hl-2" : "border-rule bg-cotton text-ink-2 hover:border-ink-3 hover:text-ink")}>
        <span className="flex -space-x-1.5">
          {[...new Set(th.rest.map((r) => r.src))].slice(0, 3).map((k) => {
            const [, Icon, tone] = SRC[k];
            return <span key={k} className={cn("grid size-[1.125rem] place-items-center rounded-full ring-2 ring-cotton", tone)}><Icon className="size-2.5" aria-hidden /></span>;
          })}
        </span>
        {n}
        <ChevronDown className={cn("size-3 transition-transform duration-(--dur-short)", open && "rotate-180")} aria-hidden />
      </button>
    </Hint>
  );
  return (
    <div className="grid grid-cols-1">
      <RowItem r={th.head} hot={th.hot} chip={chip} />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="rest" {...FOLD} className="grid grid-cols-1 overflow-hidden">
            <ul className={cn("mb-2 ml-[3.75rem] grid grid-cols-1 rounded-[var(--radius-input)] border border-rule bg-paper-2/60 p-1 @xl:ml-[4.25rem]", "mr-4 @xl:mr-6")}>
              {th.rest.map((r) => <li key={r.key} className="min-w-0"><RowItem r={r} child /></li>)}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RowItem({ r, child, hot = r.hot, chip }: { r: Row; child?: boolean; hot?: boolean; chip?: ReactNode }) {
  const t = useT();
  const [label, Icon, tone] = SRC[r.src];
  const muted = r.side === "ctx" || r.side === "theirs";
  // narrow: the wait goes under the title, so the title keeps the width
  const why = cn("flex items-center gap-1 text-xs tabular-nums", hot ? "font-medium text-signal-2" : muted || child ? "text-ink-3" : "text-ink-2");
  const dot = hot && <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden />;
  const body = <>
    <Hint side="bottom" text={r.where ? `${t(label)} · ${r.where}` : t(label)}>
      <span className={cn("grid shrink-0 place-items-center", child ? "size-6 rounded-md" : "size-8 rounded-lg", tone)}>
        <Icon className={child ? "size-3.5" : "size-4"} aria-hidden /><span className="sr-only">{t(label)}{r.where && `, ${r.where}`}</span>
      </span>
    </Hint>
    <span className="grid min-w-0 flex-1">
      <span className={cn("truncate text-ink", child ? "text-xs" : "text-sm")}>{r.title}</span>
      {!child && <span className={cn(why, "@md:hidden")}>{dot}{r.why}</span>}
    </span>
    {chip}
    <span className={cn(why, "shrink-0", !child && "hidden @md:flex")}>{dot}{r.why}</span>
    {r.extra}
  </>;
  const cls = cn("flex w-full min-w-0 items-center text-left transition-colors duration-(--dur-micro) hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none",
    child ? "gap-2 rounded-md px-1.5 py-1 hover:bg-paper-3" : cn("gap-3 py-2.5", PAD));
  return r.href ? <Link href={r.href} onClick={r.click} className={cls}>{body}</Link>
    : <div role="button" tabIndex={0} className={cn(cls, "cursor-pointer")} onClick={r.go} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.go?.(); } }}>{body}</div>;
}

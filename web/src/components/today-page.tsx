"use client";

import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Bot, Clock, Flame, Hourglass, type LucideIcon, Megaphone, MessageCircleQuestion, Sparkles, Sun, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { type ReactNode, use } from "react";
import { AiFetching, useAiWait } from "@/components/ai/fetching";
import { briefingQuery, ROW_MOTION } from "@/components/briefing-page";
import { answeredQuery, openCount, useDone } from "@/components/digest-page";
import { mineOpen, useQaNews } from "@/components/qa-page";
import { Button } from "@/components/ui/button";
import { api, type Message, type PendingItem } from "@/lib/api";
import { fmtDate, type Key, type T, useT } from "@/lib/i18n";
import { inQaPage, openQa, openReplyById, openTask, pendingQuery, QaCodes, useNow, useTaskList, waitLabel } from "@/lib/inbox";
import { useRole } from "@/lib/prefs";
import { doneLoopItem, loopKey, useLoopItems } from "@/lib/report-back";
import { timeLabel } from "@/lib/time";
import { riskOf, useMyTickets } from "@/lib/yt";
import { cn } from "@/lib/utils";

// "Hôm nay": everything that needs you, from every source, in one list ordered by how urgent it is, and what you are
// waiting on from others. It only reads what the shell already loads and polls (pending tags, my tickets, Q&A, AI
// Agent, Báo lại, Briefing); the snoozed list is its one extra read, keyed under "pending" so the live sync refreshes it.

type Src = "tg" | "yt" | "qa" | "agent" | "loop" | "brief";
const SRC: Record<Src, [Key, LucideIcon, string]> = {
  tg: ["Tag", Clock, "bg-hl-wash text-hl-2"],
  yt: ["YouTrack", TriangleAlert, "bg-paper-3 text-ink-2"],
  qa: ["Q&A", MessageCircleQuestion, "bg-info-wash text-info"],
  agent: ["AI Agent", Bot, "bg-paper-3 text-ink-2"],
  loop: ["Báo lại", Megaphone, "bg-ok-wash text-ok"],
  brief: ["Briefing", Sparkles, "bg-paper-3 text-ink-2"],
};

type Row = { key: string; src: Src; title: ReactNode; where?: string; why: string; hot?: boolean; at: number; go?: () => void; href?: string; extra?: ReactNode };

const snoozedQuery = { queryKey: ["pending", "snoozed"], queryFn: ({ signal }: { signal: AbortSignal }) => api<PendingItem[]>("/snoozed", { signal }) };

const who = (m: Message, t: T) => (m.outgoing ? t("Bạn") : m.sender_name || "?");
const ms = (d: string) => new Date(d).getTime();

export function TodayPage({ onReply, onGo, onBriefGroup }: {
  onReply: (m: Message) => void; onGo: (view: string) => void; onBriefGroup: (chatId: string) => void;
}) {
  const t = useT();
  const now = useNow();
  const role = useRole();
  const pending = useQuery(pendingQuery(""));
  const snoozed = useQuery(snoozedQuery);
  const { me, rows: tickets } = useMyTickets(true, false); // the shell's 5-minute poll feeds it
  const qa = useQaNews(7, false, false);
  const codes = use(QaCodes);
  const tasks = useTaskList().data ?? [];
  const loops = useLoopItems();
  const brief = useQuery(briefingQuery).data ?? [];
  const [done] = useDone();
  const answered = useQuery({ ...answeredQuery, enabled: brief.some((b) => b.saved) }).data;
  const wait = useAiWait(pending.isPending);

  const mine: Row[] = [
    ...(pending.data ?? []).filter((p) => !inQaPage(codes, p.message)).map(({ chat_title, message: m }): Row => { // Q&A rows cover those
      const w = waitLabel(m.date, now, !!m.priority);
      return { key: `tg:${m.chat_id}:${m.message_id}`, src: "tg", title: <><b className="font-medium text-ink">{who(m, t)}:</b> {m.text || t("(tệp đính kèm)")}</>,
        where: chat_title, why: w.text, hot: w.overdue || !!m.pinned, at: ms(m.date), go: () => onReply(m) };
    }),
    ...tickets.flatMap((i): Row[] => {
      const risk = (role === "po" || (role === "qa" ? i.qc : i.assignee) === me) && riskOf(i, now);
      return risk ? [{ key: `yt:${i.id}`, src: "yt", title: <><b className="font-mono font-medium text-ink">{i.id}</b> {i.summary}</>, where: i.state ?? undefined,
        why: risk, hot: risk === t("Quá hạn") || risk === t("Blocked"), at: i.updated, href: `/youtrack/?ticket=${encodeURIComponent(i.id)}` }] : [];
    }),
    ...qa.lateItems.map((i): Row => ({ key: `qal:${i.code}`, src: "qa", title: t("Chưa ai trả lời: {q}", { q: i.question.text }), where: i.chat_title,
      why: t("cần nhắc"), hot: true, at: ms(i.question.date), go: () => openQa(i.question.chat_id, i.code) })),
    ...(qa.total && qa.firstNew ? [{ key: "qan", src: "qa" as const, hot: false, title: t("{n} trả lời mới cho câu hỏi của bạn", { n: qa.total }), where: qa.firstNew.chat_title,
      why: t("trả lời mới"), at: now, go: () => void openQa(qa.firstNew!.question.chat_id, qa.firstNew!.code) }] : []),
    ...tasks.filter((k) => !k.running && !k.handled && !!k.result).map((k): Row => ({ key: `ag:${k.id}`, src: "agent", title: k.title || k.message_text || k.prompt,
      where: k.chat_title || k.project.split("/").pop(), why: t("xong, chưa xem"), at: now - 1, go: () => openTask(k.id) })),
    ...loops.map((l): Row => ({ key: `lp:${loopKey(l)}`, src: "loop", title: t.n("{ticket} đã {state}: báo lại người hỏi", { ticket: <b className="font-mono font-medium text-ink">{l.ticket}</b>, state: l.state }),
      why: t("người hỏi chưa biết"), at: now - 2, go: () => void openReplyById(l.chat_id, l.message_id, `${l.ticket} đã chuyển ${l.state}, bạn kiểm tra lại giúp mình nhé.`),
      extra: <Button size="xs" variant="ghost" className="text-ink-3" onClick={(e) => { e.stopPropagation(); doneLoopItem(l); }}>{t("Bỏ qua")}</Button> })),
    ...brief.flatMap((b): Row[] => {
      const n = b.consent && b.saved ? openCount(b.chat_id, b.saved.result, done, answered) : 0;
      return n ? [{ key: `br:${b.chat_id}`, src: "brief", title: t("{n} việc còn mở (cần confirm, cần làm)", { n }), where: b.title,
        why: t("tóm tắt {time}", { time: timeLabel(b.saved!.created_at) }), at: ms(b.saved!.created_at), go: () => onBriefGroup(b.chat_id) }] : [];
    }),
  ].sort((a, b) => Number(!!b.hot) - Number(!!a.hot) || a.at - b.at); // urgent first, then the oldest

  const theirs: Row[] = [
    ...(snoozed.data ?? []).map(({ chat_title, message: m }): Row => ({
      key: `sz:${m.chat_id}:${m.message_id}`, src: "tg", title: <><b className="font-medium text-ink">{who(m, t)}:</b> {m.text}</>, where: chat_title,
      why: m.snooze_on === "reply" ? t("chờ người trả lời") : m.snooze_on ? t("chờ {x} xong", { x: m.snooze_on.slice(7) }) : t("nhắc lại {time}", { time: timeLabel(m.snoozed_until!) }),
      at: ms(m.snoozed_until!), go: () => onReply(m) })),
    ...mineOpen(qa.lists).filter((i) => !qa.lateItems.includes(i)).map((i): Row => ({ key: `qm:${i.code}`, src: "qa", title: i.question.text, where: i.chat_title,
      why: t("hỏi {time}", { time: timeLabel(i.question.date) }), at: ms(i.question.date), go: () => openQa(i.question.chat_id, i.code) })),
  ];

  const hot = mine.filter((r) => r.hot).length;
  const today = fmtDate(now, { weekday: "long", day: "2-digit", month: "2-digit" }, t.lang);

  if (wait) return <AiFetching kind="today" />;
  return (
    <MotionConfig reducedMotion="user">
      <section aria-label={t("Hôm nay")} className="@container flex min-h-0 flex-col overflow-y-auto">
        <header className="grid gap-1 border-b px-4 py-4 @xl:px-6">
          <p className="text-xs font-medium text-ink-3 first-letter:uppercase">{today}</p>
          <h2 className="text-xl font-bold tracking-[-0.01em] text-ink">
            {mine.length ? <>{t("{n} việc đang chờ bạn", { n: mine.length })}{hot > 0 && <span className="text-signal-2">{t(", {n} gấp", { n: hot })}</span>}</> : t("Không có việc nào đang chờ bạn")}
          </h2>
          {pending.isError && <p role="alert" className="text-xs text-error">{t("Không đọc được danh sách tag. Kiểm tra kết nối rồi thử lại.")}</p>}
        </header>

        <Block title={t("Đang chờ bạn")} icon={Flame} rows={mine}
          empty={<span className="flex items-center gap-2"><Sun className="size-4 text-ok" aria-hidden />{t("Đã xử lý hết. Tag mới, ticket rủi ro và câu trả lời Q&A sẽ hiện ở đây.")}</span>}
          more={(pending.data?.length ?? 0) > 0 && <Button size="xs" variant="ghost" onClick={() => onGo("all")}>{t("Mở Việc cần xử lý")}</Button>} />
        <Block title={t("Bạn đang chờ")} icon={Hourglass} rows={theirs} note={t("tag đã hoãn, câu hỏi chưa ai trả lời")}
          empty={snoozed.isError ? <span role="alert" className="text-error">{t("Không đọc được danh sách tag đã hoãn. Thử tải lại trang.")}</span>
            : t("Không có gì: tag bạn hoãn và câu hỏi Q&A chưa ai trả lời sẽ hiện ở đây.")} />
      </section>
    </MotionConfig>
  );
}

function Block({ title, icon: Icon, rows, note, empty, more }: { title: string; icon: LucideIcon; rows: Row[]; note?: string; empty: ReactNode; more?: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-1 px-2 pt-4 pb-2 @xl:px-4">
      <h3 className="flex items-center gap-2 px-2 text-sm font-bold text-ink">
        <Icon className="size-4 text-ink-3" aria-hidden />{title}
        <span className="rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 font-normal text-ink-2 tabular-nums">{rows.length}</span>
        {note && <span className="truncate text-xs font-normal text-ink-3">{note}</span>}
        <span className="ml-auto">{more}</span>
      </h3>
      {rows.length ? (
        <ul className="grid">
          <AnimatePresence initial={false}>
            {rows.map((r) => <motion.li key={r.key} layout="position" {...ROW_MOTION}><RowItem r={r} /></motion.li>)}
          </AnimatePresence>
        </ul>
      ) : <p className="px-2 py-3 text-sm text-ink-3">{empty}</p>}
    </section>
  );
}

function RowItem({ r }: { r: Row }) {
  const t = useT();
  const [label, Icon, tone] = SRC[r.src];
  const body = <>
    <span className={cn("inline-flex h-6 w-[6.5rem] shrink-0 items-center gap-1 rounded-full px-2 text-2xs font-medium", tone)}>
      <Icon className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{t(label)}</span>
    </span>
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="truncate text-sm text-ink">{r.title}</span>
      {r.where && <span className="truncate text-xs text-ink-3">{r.where}</span>}
    </span>
    <span className={cn("flex shrink-0 items-center gap-1 text-xs tabular-nums", r.hot ? "font-medium text-signal-2" : "text-ink-3")}>
      {r.hot && <AlarmClock className="size-3.5" aria-hidden />}{r.why}
    </span>
    {r.extra}
  </>;
  const cls = "flex w-full items-center gap-3 rounded-[var(--radius-input)] px-2 py-2 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2 focus-visible:bg-paper-2";
  return r.href ? <Link href={r.href} className={cls}>{body}</Link>
    : <div role="button" tabIndex={0} className={cn(cls, "cursor-pointer")} onClick={r.go} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.go?.(); } }}>{body}</div>;
}

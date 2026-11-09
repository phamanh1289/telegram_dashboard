"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, CircleCheckBig, CornerDownRight, GitCompareArrows, Hourglass, ListTodo, type LucideIcon, MessageCircleQuestion, MessageSquareReply, RotateCw } from "lucide-react";
import { DeepBulkAction, DeepTopicAction, isStale, type TopicVerdict, useVerdicts, VerdictChip, VerdictTally } from "@/components/deep-think";
import { beRepliesQuery, isAnswered, ItemActions, ItemFlags, repliesTo, Tickets } from "@/components/digest-page";
import { Hint } from "@/components/ui/hint";
import type { BeReply, DigestItem, DigestResult, DigestTopic } from "@/lib/api";
import { toast } from "@/lib/inbox";
import { timeLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

// "Với BE": a group's Q&A with BE as one card per subject, the questions next to what BE answered, so a chat full of
// back-and-forth reads as a short list of topics, each checkable against the code.

const KINDS = ["confirmations", "decisions", "changes", "actions"] as const;
type Kind = (typeof KINDS)[number];
const LINE: Record<Kind, { Icon: LucideIcon; tone: string; label: string }> = {
  confirmations: { Icon: MessageCircleQuestion, tone: "text-signal-2", label: "Hỏi" },
  decisions: { Icon: CircleCheckBig, tone: "text-ok", label: "Đã chốt" },
  changes: { Icon: GitCompareArrows, tone: "text-code", label: "Thay đổi" },
  actions: { Icon: ListTodo, tone: "text-info", label: "Cần làm" },
};
const OTHER = "Khác";

type Line = { kind: Kind; it: DigestItem };
type Topic = { title: string; summary: string; lines: Line[]; waiting: boolean; ids: string[]; tickets: string[] };

/** The topic an item belongs to: its own `topic` (kept when carried), else the topic citing most of its messages. */
function topicOf(it: DigestItem, topics: DigestTopic[]) {
  if (it.topic) return it.topic;
  const hit = (t: DigestTopic) => (t.message_ids ?? []).filter((i) => it.message_ids?.includes(i)).length;
  return [...topics].sort((a, b) => hit(b) - hit(a)).find((t) => hit(t) > 0)?.title ?? OTHER;
}

/** Open BE items grouped by topic: the ones still waiting on an answer first. */
export function beTopics(r: DigestResult, open: (kind: Kind, it: DigestItem) => boolean): Topic[] {
  const by = new Map<string, Line[]>();
  for (const kind of KINDS) {
    for (const it of r[kind] ?? []) {
      if (!it.be || !open(kind, it)) continue;
      const title = topicOf(it, r.topics ?? []);
      by.set(title, [...(by.get(title) ?? []), { kind, it }]);
    }
  }
  return [...by].map(([title, lines]) => ({
    title, lines,
    summary: r.topics?.find((t) => t.title === title)?.summary ?? "",
    waiting: lines.some((l) => l.kind === "confirmations"),
    ids: [...new Set(lines.flatMap((l) => l.it.message_ids ?? []))],
    tickets: [...new Set(lines.flatMap((l) => l.it.tickets ?? []))],
  })).sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.lines.length - a.lines.length);
}

/** What the code check gets for a topic: its title, summary and lines, and the messages they cite; a question BE has
 *  answered since the digest goes as answered, with that reply among its messages. */
const checkOf = (t: Topic, hits?: BeReply[]) => {
  const fresh = t.lines.flatMap(({ it }) => repliesTo(it, hits));
  return {
    text: [t.title, t.summary, ...t.lines.map(({ kind, it }) => [
      it.question ? `Hỏi${it.asker ? ` (${it.asker === "me" ? "tôi" : it.asker})` : ""}: ${it.question}\n${it.who || "BE"} trả lời: ${it.text}` : `${LINE[kind].label}: ${it.text}`,
      ...repliesTo(it, hits).map((h) => h.direct ? `${h.sender} vừa trả lời: ${h.text}` : `${h.sender} nhắn sau câu hỏi (có thể là trả lời): ${h.text}`),
      it.why && `Bối cảnh: ${it.why}`,
    ].filter(Boolean).join("\n"))].filter(Boolean).join("\n"),
    message_ids: [...t.ids, ...fresh.map((h) => h.message_id)],
    waiting: t.waiting && !t.lines.every(({ kind, it }) => kind !== "confirmations" || isAnswered(it, hits)),
  };
};
/** Still waiting on BE: an open question nobody has replied to since the digest. */
export const stillWaiting = (it: DigestItem, hits?: BeReply[]) => !isAnswered(it, hits);

/** A group's open BE items as topic cards, with one code check for all of them. `onToggle`: tick an item off. */
export function BeTopics({ chatId, title, r, open, onToggle, onJump, lit }: {
  chatId: string; title: string; r: DigestResult; open: (kind: Kind, it: DigestItem) => boolean;
  onToggle?: (kind: Kind, it: DigestItem) => void; onJump?: (id: string) => void; lit?: string | null;
}) {
  const topics = beTopics(r, open);
  const verdicts = useVerdicts(chatId); // the last code check, per topic
  const replies = useQuery(beRepliesQuery); // BE answered since the digest: the card says so before the next summary
  const hits = replies.data?.[chatId];
  if (!topics.length) return null;
  const answered = topics.filter((t) => t.lines.some(({ kind, it }) => kind === "confirmations" && isAnswered(it, hits))).length;
  const checked = topics.map((t) => verdicts?.get(t.title)).filter((x): x is TopicVerdict => !!x);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span>{topics.length} chủ đề · {topics.filter((t) => t.waiting && t.lines.some(({ kind, it }) => kind === "confirmations" && stillWaiting(it, hits))).length} chờ trả lời</span>
        {answered > 0 && <span className="inline-flex items-center gap-1 text-info"><MessageSquareReply className="size-3" aria-hidden />{answered} có trả lời mới</span>}
        {replies.isError && (
          <span role="alert" className="inline-flex items-center gap-1 text-error">
            Không dò được trả lời mới
            <button type="button" aria-label="Thử lại" onClick={() => void replies.refetch()} className="rounded-sm hover:text-ink"><RotateCw className="size-3" aria-hidden /></button>
          </span>
        )}
        {checked.length > 0 && <><span aria-hidden>·</span><span>Code:</span><VerdictTally vs={checked.map((x) => x.v)} /></>}
        <DeepBulkAction chatId={chatId} title={title} items={topics.map((t) => checkOf(t, hits))} className="ml-auto" />
      </div>
      <ul className="grid gap-2">
        {topics.map((t) => <Card key={t.title} chatId={chatId} t={t} tv={verdicts?.get(t.title)} hits={hits} onToggle={onToggle} onJump={onJump} lit={lit} />)}
      </ul>
    </div>
  );
}

function Card({ chatId, t, tv, hits, onToggle, onJump, lit }: {
  chatId: string; t: Topic; tv?: TopicVerdict; hits?: BeReply[]; onToggle?: (kind: Kind, it: DigestItem) => void; onJump?: (id: string) => void; lit?: string | null;
}) {
  const asked = t.lines.filter(({ kind }) => kind === "confirmations");
  const fresh = t.waiting && asked.some(({ it }) => isAnswered(it, hits));
  const maybe = t.waiting && !fresh && asked.some(({ it }) => repliesTo(it, hits).length);
  return (
    <li className="grid gap-2 rounded-[var(--radius-card)] border border-rule bg-cotton p-3">
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="min-w-0 text-sm font-semibold text-ink">{t.title}</h4>
        {fresh
          ? <span className="inline-flex items-center gap-1 rounded-full bg-info-wash px-1.5 text-xs leading-5 font-medium text-info"><MessageSquareReply className="size-3" aria-hidden />Có trả lời mới</span>
          : maybe
          ? <Hint side="bottom" text="Người phải trả lời đã nhắn sau câu hỏi nhưng không bấm reply: có thể là câu trả lời. Tóm tắt lại để AI chốt.">
            <span tabIndex={0} className="inline-flex items-center gap-1 rounded-full border border-dashed border-info/50 px-1.5 text-xs leading-5 font-medium text-info"><MessageSquareReply className="size-3" aria-hidden />Có thể đã trả lời</span>
          </Hint>
          : t.waiting
          ? <span className="inline-flex items-center gap-1 rounded-full bg-signal-wash px-1.5 text-xs leading-5 font-medium text-signal-2"><Hourglass className="size-3" aria-hidden />Chờ trả lời</span>
          : <span className="inline-flex items-center gap-1 rounded-full bg-ok-wash px-1.5 text-xs leading-5 font-medium text-ok"><CircleCheckBig className="size-3" aria-hidden />Đã chốt</span>}
        {tv && !(t.waiting && tv.v === "waiting") && (
          <VerdictChip tv={tv} open stale={isStale(tv, [...t.ids, ...t.lines.flatMap(({ it }) => repliesTo(it, hits).map((h) => h.message_id))])} />
        )}
        <Tickets ids={t.tickets} />
        <span className="ml-auto"><DeepTopicAction chatId={chatId} item={checkOf(t, hits)} /></span>
      </header>
      {t.summary && <p className="text-sm leading-relaxed text-ink-2">{t.summary}</p>}
      <ul className="grid gap-2">
        {t.lines.map(({ kind, it }) => {
          const { Icon, tone, label } = LINE[kind];
          // A question with what BE answered (or still waiting): one pair. Older digests have no "question": a plain line.
          const pair = kind === "confirmations" || !!it.question;
          const who = kind === "decisions" ? it.who && `chốt bởi ${it.who}` : kind === "confirmations" ? "" : it.who;
          return (
            <li key={`${kind}:${(it.message_ids ?? []).join(",")}:${it.text}`} className="group/line flex gap-2 text-sm leading-relaxed">
              {pair ? <MessageCircleQuestion className="mt-1 size-3.5 shrink-0 text-info" aria-label="Hỏi" />
                : <Icon className={cn("mt-1 size-3.5 shrink-0", tone)} aria-label={label} />}
              <div className="grid min-w-0 flex-1 gap-1">
                {pair ? <>
                  <p className="min-w-0">
                    <span className="text-ink">{it.question || it.text}</span>
                    {it.asker && <span className="text-ink-3"> — {it.asker === "me" ? "Bạn" : it.asker} hỏi</span>}
                    <ItemFlags it={it} be={false} />
                  </p>
                  {kind === "confirmations" && repliesTo(it, hits).length ? (
                    <FreshReplies hits={repliesTo(it, hits)} onJump={onJump} lit={lit} />
                  ) : kind === "confirmations" ? (
                    <p className="inline-flex items-center gap-1.5 text-xs text-signal-2">
                      <Hourglass className="size-3 shrink-0" aria-hidden />Chờ {it.who || "BE"} trả lời
                    </p>
                  ) : (
                    <p className="flex min-w-0 gap-1.5 rounded-md bg-ok-wash/60 px-2 py-1">
                      <CornerDownRight className="mt-1 size-3 shrink-0 text-ok" aria-hidden />
                      <span className="min-w-0"><b className="font-semibold text-ok">{it.who || "BE"}:</b> <span className="text-ink">{it.text}</span></span>
                    </p>
                  )}
                </> : (
                  <p className="min-w-0">
                    <span className="text-ink">{it.text}</span>
                    {who && <span className="text-ink-3"> — {who}</span>}
                    <ItemFlags it={it} be={false} />
                  </p>
                )}
                {it.why && <p className="text-xs leading-relaxed text-ink-3">{it.why}</p>}
                {(onJump && it.message_ids?.length || kind === "confirmations" || kind === "actions") ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {onJump && (it.message_ids ?? []).map((id) => (
                      <button key={id} type="button" onClick={() => onJump(id)} aria-label={`Xem tin gốc #${id}`}
                        className={cn("rounded-sm px-1 font-mono text-xs transition-colors duration-(--dur-micro)", lit === id ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2 hover:bg-hl-wash hover:text-hl-2")}>
                        #{id}
                      </button>
                    ))}
                    {(kind === "confirmations" || kind === "actions") && <ItemActions chatId={chatId} ids={it.message_ids ?? []} text={it.text} />}
                  </div>
                ) : null}
              </div>
              {onToggle && (
                <Hint side="bottom" text="Đánh dấu đã xử lý (chỉ trên máy này): mục này rời khỏi Với BE">
                  <button type="button" aria-label="Đánh dấu đã xử lý"
                    onClick={() => { onToggle(kind, it); toast({ text: "Đã đánh dấu xử lý", action: { label: "Hoàn tác", run: () => onToggle(kind, it) } }); }}
                    className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-rule-2 text-transparent transition-colors duration-(--dur-short) hover:border-ok hover:bg-ok-wash hover:text-ok">
                    <Check className="size-3" strokeWidth={3} aria-hidden />
                  </button>
                </Hint>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** Replies to an open question since the digest: the newest one in full, a count of the rest; the next summary settles it. */
function FreshReplies({ hits, onJump, lit }: { hits: BeReply[]; onJump?: (id: string) => void; lit?: string | null }) {
  const h = hits.at(-1)!;
  return (
    <div className={cn("grid gap-1 rounded-md px-2 py-1.5", h.direct ? "bg-info-wash/60" : "border border-dashed border-info/40")}>
      <p className="flex min-w-0 gap-1.5">
        <CornerDownRight className="mt-1 size-3 shrink-0 text-info" aria-hidden />
        <span className="min-w-0"><b className="font-semibold text-info">{h.sender}:</b> <span className="line-clamp-3 inline whitespace-pre-wrap break-words text-ink">{h.text}</span></span>
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 pl-[18px] text-xs text-ink-3">
        <span>{h.direct ? "vừa trả lời" : "nhắn sau câu hỏi (không reply), có thể là câu trả lời ·"} {timeLabel(h.date)}{hits.length > 1 && ` · +${hits.length - 1} tin`} · chưa vào tóm tắt, bấm Tóm tắt lại để AI chốt</span>
        {onJump && (
          <button type="button" onClick={() => onJump(h.message_id)} aria-label={`Xem tin #${h.message_id}`}
            className={cn("rounded-sm px-1 font-mono transition-colors duration-(--dur-micro)", lit === h.message_id ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2 hover:bg-hl-wash hover:text-hl-2")}>
            #{h.message_id}
          </button>
        )}
      </p>
    </div>
  );
}

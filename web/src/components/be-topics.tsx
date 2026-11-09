"use client";

import { Check, CircleCheckBig, GitCompareArrows, Hourglass, ListTodo, type LucideIcon, MessageCircleQuestion } from "lucide-react";
import { DeepBulkAction, DeepTopicAction } from "@/components/deep-think";
import { ItemActions, ItemFlags, Tickets } from "@/components/digest-page";
import { Hint } from "@/components/ui/hint";
import type { DigestItem, DigestResult, DigestTopic } from "@/lib/api";
import { toast } from "@/lib/inbox";
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

/** What the code check gets for a topic: its title, summary and lines, and the messages they cite. */
const checkOf = (t: Topic) => ({
  text: [t.title, t.summary, ...t.lines.map((l) => `${LINE[l.kind].label}: ${l.it.text}`)].filter(Boolean).join("\n"),
  message_ids: t.ids,
  waiting: t.waiting,
});

/** A group's open BE items as topic cards, with one code check for all of them. `onToggle`: tick an item off. */
export function BeTopics({ chatId, title, r, open, onToggle, onJump, lit }: {
  chatId: string; title: string; r: DigestResult; open: (kind: Kind, it: DigestItem) => boolean;
  onToggle?: (kind: Kind, it: DigestItem) => void; onJump?: (id: string) => void; lit?: string | null;
}) {
  const topics = beTopics(r, open);
  if (!topics.length) return null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span>{topics.length} chủ đề · {topics.filter((t) => t.waiting).length} chờ trả lời</span>
        <DeepBulkAction chatId={chatId} title={title} items={topics.map(checkOf)} className="ml-auto" />
      </div>
      <ul className="grid gap-2">
        {topics.map((t) => <Card key={t.title} chatId={chatId} t={t} onToggle={onToggle} onJump={onJump} lit={lit} />)}
      </ul>
    </div>
  );
}

function Card({ chatId, t, onToggle, onJump, lit }: {
  chatId: string; t: Topic; onToggle?: (kind: Kind, it: DigestItem) => void; onJump?: (id: string) => void; lit?: string | null;
}) {
  return (
    <li className="grid gap-2 rounded-[var(--radius-card)] border border-rule bg-cotton p-3">
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="min-w-0 text-sm font-semibold text-ink">{t.title}</h4>
        {t.waiting
          ? <span className="inline-flex items-center gap-1 rounded-full bg-signal-wash px-1.5 text-xs leading-5 font-medium text-signal-2"><Hourglass className="size-3" aria-hidden />Chờ trả lời</span>
          : <span className="inline-flex items-center gap-1 rounded-full bg-ok-wash px-1.5 text-xs leading-5 font-medium text-ok"><CircleCheckBig className="size-3" aria-hidden />Đã chốt</span>}
        <Tickets ids={t.tickets} />
        <span className="ml-auto"><DeepTopicAction chatId={chatId} item={checkOf(t)} /></span>
      </header>
      {t.summary && <p className="text-sm leading-relaxed text-ink-2">{t.summary}</p>}
      <ul className="grid gap-1.5">
        {t.lines.map(({ kind, it }) => {
          const { Icon, tone, label } = LINE[kind];
          const who = kind === "confirmations" ? it.who && `hỏi ${it.who}` : kind === "decisions" ? it.who && `chốt bởi ${it.who}` : it.who;
          return (
            <li key={`${kind}:${(it.message_ids ?? []).join(",")}:${it.text}`} className="group/line flex gap-2 text-sm leading-relaxed">
              <Icon className={cn("mt-1 size-3.5 shrink-0", tone)} aria-label={label} />
              <div className="min-w-0 flex-1">
                <span className="text-ink">{it.text}</span>
                {who && <span className="text-ink-3"> — {who}</span>}
                <ItemFlags it={it} be={false} />
                {onJump && (it.message_ids ?? []).map((id) => (
                  <button key={id} type="button" onClick={() => onJump(id)} aria-label={`Xem tin gốc #${id}`}
                    className={cn("ml-1 rounded-sm px-1 font-mono text-xs transition-colors duration-(--dur-micro)", lit === id ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2 hover:bg-hl-wash hover:text-hl-2")}>
                    #{id}
                  </button>
                ))}
                {(kind === "confirmations" || kind === "actions") && <ItemActions chatId={chatId} ids={it.message_ids ?? []} text={it.text} />}
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

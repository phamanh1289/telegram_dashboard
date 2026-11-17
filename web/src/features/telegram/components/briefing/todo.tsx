"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, ChevronRight, CircleCheckBig, GitCompareArrows, ListTodo, type LucideIcon, MessageCircleQuestion } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { DeepItemAction, DeepTopicAction } from "@/features/telegram/components/deep-think";
import { Evidence, ItemActions, ItemFlags, Tickets } from "@/features/telegram/components/digest-page";
import { TicketChip } from "@/features/telegram/components/message/rich-text";
import { useOpenSimilar } from "@/features/youtrack/components/ticket-form";
import { Hint } from "@/shared/components/ui/hint";
import { type BriefingItem, type DigestItem, statusQuery } from "@/shared/lib/api";
import { type Key, t as tr, useT } from "@/shared/lib/i18n";
import { timeLabel } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

export const EASE = [0.16, 1, 0.3, 1] as const; // --ease-out
export const ROW_MOTION = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } },
  exit: { opacity: 0, x: 24, transition: { duration: 0.16 } },
} as const;
export const FADE = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.18, ease: EASE } } as const;

// ---- to-do items: every group's latest digest in one list ------------------------------------------------------------

export type Kind = "confirmations" | "actions" | "decisions" | "changes";
export type Tab = "mine" | "be" | Kind;
export type Todo = DigestItem & { kind: Kind; chat: BriefingItem; key: string; mine: boolean; replied: boolean };
export const KINDS = ["confirmations", "actions", "decisions", "changes"] as const;
// One hue per kind, the same on its tab, its icon and in Saved Messages. Confirmations need you: the signal amber.
export const KIND: Record<Kind, { label: Key; Icon: LucideIcon; tone: string; dot: string; tg: string }> = {
  confirmations: { label: "Cần confirm", Icon: MessageCircleQuestion, tone: "bg-signal-wash text-signal-2", dot: "bg-signal", tg: "❓" },
  actions: { label: "Việc cần làm", Icon: ListTodo, tone: "bg-info-wash text-info", dot: "bg-info", tg: "📌" },
  decisions: { label: "Đã chốt", Icon: CircleCheckBig, tone: "bg-ok-wash text-ok", dot: "bg-ok", tg: "✅" },
  changes: { label: "Thay đổi", Icon: GitCompareArrows, tone: "bg-code-wash text-code", dot: "bg-code", tg: "🔄" },
};

function meta(t: Todo) {
  if (t.kind === "confirmations") return t.who && tr("hỏi {who}", { who: t.who });
  if (t.kind === "decisions") return t.who && tr("chốt bởi {who}", { who: t.who });
  if (t.kind === "actions") return t.who;
  return "";
}

// Saved Messages: Telegram's markdown has bold / italic only, no headings or lists.
export const tgText = (md: string) => md.replace(/^#{1,6}\s+(.+)$/gm, "**$1**").replace(/^(\s*)[-*]\s+/gm, "$1• ");
export function tgBriefing(open: Todo[]) {
  const out = [`**Briefing ${timeLabel(new Date().toISOString(), true)}**`];
  for (const c of new Set(open.map((t) => t.chat))) {
    out.push("", `**${c.title}**`);
    for (const k of KINDS) {
      const its = open.filter((t) => t.chat === c && t.kind === k);
      if (its.length) out.push(`${KIND[k].tg} ${tr(KIND[k].label)}`, ...its.map((t) => {
        const extra = [meta(t), t.due && tr("hạn {due}", { due: t.due }), ...(t.tickets ?? [])].filter(Boolean).join(", ");
        return `• ${t.text}${extra ? ` — ${extra}` : ""}`;
      }));
    }
  }
  if (!open.length) out.push("", tr("Không còn mục nào cần xử lý."));
  return out.join("\n");
}

/** "Trả lời" / "Tạo ticket"; a to-do with no ticket is checked against YouTrack: a likely match is shown, else creating one is suggested. */
function TodoActions({ chatId, it, kind, onCreated }: { chatId: string; it: DigestItem; kind: string; onCreated?: () => void }) {
  const tx = useT();
  const ytOn = useQuery({ ...statusQuery, staleTime: Infinity }).data?.youtrack_configured; // the shell keeps it fresh
  const check = !!ytOn && kind === "actions" && !it.tickets?.length;
  const similar = useOpenSimilar(it.text, { enabled: check });
  const hit = similar.data?.[0];
  return (
    <>
      {hit && <span className="inline-flex items-center gap-1">{tx("có thể đã có")} <TicketChip id={hit.id} /></span>}
      <ItemActions chatId={chatId} ids={it.message_ids ?? []} text={it.text} suggest={check && similar.isSuccess && !hit} onCreated={onCreated} />
    </>
  );
}

/** The next step on a digest item, for Briefing's rows and the Trợ lý's cited points alike: an open question / to-do
 *  is answered or made a ticket (one with BE also checked against the code); the rest checked against the code. */
export function NextSteps({ chatId, it, kind, onCreated }: { chatId: string; it: DigestItem; kind: string; onCreated?: () => void }) {
  if (kind !== "confirmations" && kind !== "actions") return <DeepItemAction chatId={chatId} ids={it.message_ids ?? []} />;
  return <>
    <TodoActions chatId={chatId} it={it} kind={kind} onCreated={onCreated} />
    {it.be && <DeepTopicAction chatId={chatId} item={{ text: it.text, message_ids: it.message_ids ?? [], waiting: kind === "confirmations" }} />}
  </>;
}

const TOPIC: Record<string, [Key, string]> = { decided: ["đã chốt", "text-ok"], open: ["đang bàn", "text-signal-2"], dropped: ["bỏ", "text-ink-3"] };

/** Why an item says what it says: the AI's context, the topic it belongs to, and the cited messages read live from Telegram. */
function TodoDetail({ t, onOpen }: { t: Todo; onOpen: () => void }) {
  const tx = useT();
  const ids = (t.message_ids ?? []).slice(0, 40);
  // The topic citing most of the same messages.
  const overlap = (x: string[] = []) => x.filter((i) => ids.includes(i)).length;
  const topic = [...(t.chat.saved?.result.topics ?? [])].sort((a, b) => overlap(b.message_ids) - overlap(a.message_ids))
    .find((x) => overlap(x.message_ids) > 0);
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: EASE }}
      className="overflow-hidden">
      <div className="mt-1.5 grid gap-3 rounded-lg border border-rule bg-cotton/60 p-3 text-xs">
        {t.why && (
          <div className="grid gap-0.5">
            <p className="font-medium text-ink-3">{tx("Bối cảnh")}</p>
            <p className="text-sm leading-relaxed text-ink-2">{t.why}</p>
          </div>
        )}
        {topic && (
          <div className="grid gap-0.5">
            <p className="font-medium text-ink-3">{tx("Chủ đề")} <span className={TOPIC[topic.status ?? "open"]?.[1]}>· {tx(TOPIC[topic.status ?? "open"]?.[0] ?? "đang bàn")}</span></p>
            <p className="text-sm leading-relaxed text-ink-2"><b className="font-bold text-ink">{topic.title}</b>{topic.summary && `: ${topic.summary}`}</p>
          </div>
        )}
        <Evidence chatId={t.chat.chat_id} ids={ids} extra={
          <button type="button" onClick={onOpen} className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-sm font-normal whitespace-nowrap hover:text-ink hover:underline">
            {tx("Xem cả nhóm")} <ArrowUpRight className="size-3" aria-hidden />
          </button>
        } />
      </div>
    </motion.div>
  );
}

export function TodoRow({ t, closed, showKind, showGroup, onToggle, onOpen }: {
  t: Todo; closed: boolean; showKind: boolean; showGroup: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const tx = useT();
  const m = meta(t);
  const k = KIND[t.kind];
  const [open, setOpen] = useState(false);
  const n = t.message_ids?.length ?? 0;
  return (
    <motion.li layout="position" {...ROW_MOTION}
      className="group/todo flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-(--dur-micro) hover:bg-paper-2/70 focus-within:bg-paper-2/70">
      <Hint side="bottom" text={t.replied ? tx("Bạn đã trả lời tin này trên Telegram") : closed ? tx("Đánh dấu chưa xử lý") : tx("Đánh dấu đã xử lý (chỉ trên máy này)")}>
        <button type="button" aria-pressed={closed} aria-label={closed ? tx("Bỏ đánh dấu đã xử lý") : tx("Đánh dấu đã xử lý")} onClick={onToggle} disabled={t.replied}
          className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,color,scale] duration-(--dur-short) ease-(--ease-out) active:scale-85",
            closed ? "border-ok bg-ok text-cotton" : "border-rule-2 text-transparent hover:border-ok hover:bg-ok-wash hover:text-ok")}>
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </button>
      </Hint>
      {showKind && (
        <span role="img" aria-label={tx(k.label)} className={cn("mt-px grid size-6 shrink-0 place-items-center rounded-md", k.tone)}>
          <k.Icon className="size-3.5" aria-hidden />
        </span>
      )}
      <div className="grid min-w-0 flex-1 gap-1">
        <p className={cn("text-sm leading-relaxed text-ink transition-colors duration-(--dur-short)", closed && "text-ink-3 line-through decoration-ink-3/60")}>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-sm text-left hover:text-hl-2">{t.text}</button>
          <ItemFlags it={t} />
          <Tickets ids={t.tickets} />
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-3">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
            className={cn("inline-flex items-center gap-0.5 rounded-sm hover:text-ink", open && "text-hl-2")}>
            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out)", open && "rotate-90")} aria-hidden />
            {n ? tx("Bằng chứng · {n} tin", { n }) : tx("Chi tiết")}
          </button>
          {t.replied && <span className="inline-flex items-center gap-1 font-medium text-ok"><Check className="size-3" aria-hidden />{tx("Bạn đã trả lời")}</span>}
          {m && <span className="font-medium text-ink-2">{m}</span>}
          {t.due && <span className="rounded-full bg-warn-wash px-1.5 leading-5 font-medium text-warn">{tx("hạn {due}", { due: t.due })}</span>}
          {showGroup && (
            <Hint side="bottom" text={tx("Mở trang tóm tắt của nhóm")}>
              <button type="button" onClick={onOpen} className="max-w-48 truncate rounded-sm underline-offset-2 hover:text-ink hover:underline">{t.chat.title}</button>
            </Hint>
          )}
          {!closed && <NextSteps chatId={t.chat.chat_id} it={t} kind={t.kind} onCreated={onToggle} />}
        </div>
        <AnimatePresence initial={false}>{open && <TodoDetail key="detail" t={t} onOpen={onOpen} />}</AnimatePresence>
      </div>
    </motion.li>
  );
}

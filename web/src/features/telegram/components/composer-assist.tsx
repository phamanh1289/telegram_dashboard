"use client";

import { Check, Copy, FileSearch, Link2, MessageCircleQuestion, Plus, Send, Sparkles, Square } from "lucide-react";
import { Fragment } from "react";
import { AiResultCard, AiThinking, AiWriting, UserBubble } from "@/shared/components/ai/chat";
import { AiFetching } from "@/shared/components/ai/fetching";
import type { TaskEvent } from "@/shared/components/ai/steps";
import { ASK_BTN, Markdown } from "@/shared/components/markdown";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { inline } from "@/features/telegram/components/message/rich-text";
import { SessionAsks } from "@/features/telegram/components/tasks-feed";
import { splitAttachments } from "@/features/telegram/lib/attach";
import { ticketClick } from "@/features/telegram/lib/inbox";
import { fitsSend, SEND_MAX } from "@/features/telegram/lib/send";
import type { Task, YouTrackIssue } from "@/shared/lib/api";
import { type Key, useT } from "@/shared/lib/i18n";
import { copyText } from "@/shared/lib/notifications";
import { getPref } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

// The assistant side of the reply panel (composer.tsx): the asks as a conversation, the AI's reply drafts, the tickets
// that look related, and what a "Trả lời từ code" run keeps per tag.

// The AI summary's Markdown: headings, -/1. lists and **bold** on top of the message look (links, @mentions, `code`).
// React nodes only, never HTML: the text comes from the model.
function Md({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let items: React.ReactNode[] = [];
  let ordered = false;
  const flush = (k: number) => {
    if (!items.length) return;
    out.push(ordered
      ? <ol key={`l${k}`} className="grid list-decimal gap-1 pl-5 marker:text-ink-3">{items}</ol>
      : <ul key={`l${k}`} className="grid list-disc gap-1 pl-5 marker:text-ink-3">{items}</ul>);
    items = [];
  };
  text.split("\n").forEach((line, i) => {
    const li = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)/.exec(line);
    if (li) {
      if (items.length && ordered !== !!li[2]) flush(i);
      ordered = !!li[2];
      items.push(<li key={i} className={li[1].length >= 2 ? "ml-4" : undefined}>{bold(li[3], i)}</li>);
      return;
    }
    flush(i);
    const h = /^#{1,6}\s+(.*)/.exec(line);
    if (h) out.push(<p key={i} className="mt-1 font-bold text-ink first:mt-0">{bold(h[1], i)}</p>);
    else if (line.trim()) out.push(<p key={i}>{bold(line, i)}</p>);
  });
  flush(-1);
  return out;
}

function bold(s: string, key: number) {
  return s.split(/\*\*(.+?)\*\*/g).map((t, i) =>
    i % 2 ? <strong key={i} className="font-bold text-ink">{inline(t, key * 100 + i)}</strong> : inline(t, key * 100 + i));
}

export const TICKET_ID = /\b[A-Z][A-Z0-9]+-\d+\b/;
export const TICKET_IDS = new RegExp(TICKET_ID.source, "g");

/** QA: a reply asking for what the summary marked [cần bổ sung] ("**Môi trường:** [cần bổ sung]" → "Môi trường"). */
export function askMissing(analysis: string) {
  const lines = analysis.split("\n").filter((l) => /cần bổ sung/i.test(l));
  if (!lines.length) return "";
  const what = [...new Set(lines.map((l) => l.match(/\*\*([^*]+?):?\*\*/)?.[1]?.trim()).filter(Boolean))];
  return `Bạn bổ sung giúp mình ${what.length ? what.join(", ").toLowerCase() : "các thông tin còn thiếu (build, thiết bị / OS, bước tái hiện)"} để mình tái hiện và test nhé.`;
}

// The AI drafts come in this order (prompt in ai.py): who the user is to the person they answer.
export const LEVELS: Key[] = ["Tôi là cấp trên", "Ngang cấp", "Trả lời cấp trên"];
const ANSWER_LEVELS: Key[] = ["Ngắn gọn", "Đầy đủ"]; // ai.py ANSWER_TASK
const DRAFT_BTN = cn(ASK_BTN, "aria-disabled:cursor-not-allowed aria-disabled:opacity-40"); // the AI Agent asks' copy / send look

/** A "Trả lời từ code" run on the server, saved per tag (the panel may close and open again). */
type SavedJob = { id: string; code: string; prompt: string; at: number };
export type AskVars = { instruction: string; job?: SavedJob; resume?: boolean };
export const JOB_KEEP_MS = 2 * 3600_000; // a run's start + ai.py JOB_KEEP (an ended run waits 1 h), with room for a long run
export const readJob = (key: string): SavedJob | null => {
  try {
    return JSON.parse(getPref(key) ?? "null");
  } catch {
    return null;
  }
};

// error "": cancelled; code: the project read for it ("Trả lời từ code")
export type Turn = { prompt: string; at: number; analysis?: string; took?: number; error?: string; code?: string };

const THINKING: Key[] = [
  "Đang đọc tin nhắn…",
  "Đang lục lại ngữ cảnh nhóm…",
  "Đang hỏi ý kiến con Android…",
  "Đang pha cà phê cho AI…",
  "Đang gọt câu trả lời cho lịch sự…",
  "Sắp xong rồi, đợi xíu nha…",
];

/** The panel's asks as a conversation: the ask in a bubble, then the AI thinking / writing, then the result card. */
export function AiTurns({ turns, running, partial, missing, onMissing, session }: {
  turns: Turn[]; running: boolean; partial: string; missing: string; onMissing: () => void; session?: Task;
}) {
  const t = useT();
  const live = partial.split(/\n\s*={3,}\s*(?:\n|$)/)[0]; // the summary part; the reply options come after "==="
  const list = (
    <ul aria-label={t("Hội thoại với AI")} className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {turns.map((turn, i) => {
        const last = i === turns.length - 1;
        return (
          <Fragment key={turn.at}>
            <li><UserBubble>{turn.prompt || (turn.code
              ? <span className="inline-flex items-center gap-1.5"><FileSearch className="size-3.5 text-hl-2" aria-hidden /> {t("Trả lời từ code · {project}", { project: turn.code })}</span>
              : <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5 text-hl-2" aria-hidden /> {t("Tóm tắt & gợi ý")}</span>)}</UserBubble></li>
            {last && running ? (
              live.trim() ? <>
                <li aria-label={t("AI đang viết")} className="grid gap-1.5 break-words px-0.5 text-sm leading-[1.6] text-ink animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
                  <Md text={live} />
                </li>
                <li><AiWriting /></li>
              </> : turn.code ? <li><AiFetching kind="code" project={turn.code} className="min-h-0 py-2 [&_[role=status]]:w-auto" /></li>
                : <li><AiThinking lines={THINKING.map((l) => t(l))} /></li>
            ) : turn.analysis ? (
              <li>
                <AiResultCard aria-label={turn.code ? t("Trả lời từ code") : t("Tóm tắt và bước tiếp theo")} took={turn.took} dim={!last}
                  actions={last && missing && <Button type="button" size="xs" variant="outline" className="mr-auto" onClick={onMissing}><MessageCircleQuestion /> {t("Hỏi thông tin còn thiếu")}</Button>}>
                  <Markdown asks text={turn.analysis} className="text-sm leading-[1.6] text-ink" />
                </AiResultCard>
              </li>
            ) : turn.error ? (
              <li><AiResultCard error>{turn.error}</AiResultCard></li>
            ) : turn.error === "" && (
              <li role="status" className="flex items-center gap-1.5 px-0.5 text-xs text-ink-3 animate-in fade-in-0 duration-(--dur-short)">
                <Square className="size-3 fill-current" aria-hidden /> {t("Đã hủy tóm tắt.")}
              </li>
            )}
          </Fragment>
        );
      })}
    </ul>
  );
  // its asks (Cần hỏi …) copy with the session's ID and post to the group, like any AI Agent session
  return session ? <SessionAsks t={session}>{list}</SessionAsks> : list;
}

/** A saved Trợ lý AI session's answered (or failed) turns, from its log; an ask still running has no result yet. */
export function logTurns(items: TaskEvent[]): Turn[] {
  const out: Turn[] = [];
  let ask: Turn | null = null;
  for (const e of items) {
    if (e.kind === "user") ask = { prompt: splitAttachments(e.text)[0], at: (e.at ?? 0) * 1000, code: e.code?.split("/").pop() };
    else if (e.kind === "result" && ask) {
      out.push(e.error ? { ...ask, error: e.text } : { ...ask, analysis: e.text, took: e.at && ask.at ? e.at - ask.at / 1000 : undefined });
      ask = null;
    }
  }
  return out;
}

/** The AI's reply drafts as cards: picking one puts it in the reply box (`onPick`), each has its own copy and send.
 *  `answerMode`: they answer from code ("Ngắn gọn" / "Đầy đủ"). `edited`: the box holds hand edits, which a draft's own
 *  Gửi would overwrite, so it waits; `ready`: a send may start now. */
export function AiOptions({ options, picked, answerMode, name, edited, ready, onPick, onSend }: {
  options: string[]; picked: number; answerMode: boolean; name: string; edited: boolean; ready: boolean;
  onPick: (i: number) => void; onSend: (i: number) => void;
}) {
  const t = useT();
  return (
    <fieldset className="grid gap-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)">
      <legend className="mb-2 text-xs font-medium text-ink-3">{t("Mẫu AI")} <span className="font-normal">{t("(chọn để đưa vào ô soạn)")}</span></legend>
      {options.map((o, i) => (
        <label
          key={i}
          style={{ animationDelay: `${i * 60}ms` }}
          className={cn(
            "relative grid cursor-pointer gap-1 rounded-xl border px-3 py-2.5 text-sm leading-[1.55] transition-[border-color,background-color] duration-(--dur-micro) animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-(--dur-short) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
            picked === i ? "border-hl bg-hl-wash" : "border-rule bg-cotton hover:border-rule-2",
          )}
        >
          <input
            type="radio"
            name="ai-option"
            className="absolute size-px opacity-0"
            checked={picked === i}
            onChange={() => onPick(i)}
          />
          <span className={cn("flex min-h-5 items-center gap-1.5 text-xs font-medium", picked === i ? "text-hl-2" : "text-ink-3")}>
            {picked === i && <Check className="size-3.5 animate-in zoom-in-50 duration-(--dur-short)" aria-hidden />}
            {answerMode && options.length === ANSWER_LEVELS.length ? t(ANSWER_LEVELS[i]) : options.length === LEVELS.length ? t(LEVELS[i]) : t.n("Mẫu {n}", { n: <span className="font-mono">{i + 1}</span> })}
            <span className="ml-auto flex">
              <Hint side="bottom" text={t("Copy bản nháp này")}>
                <button type="button" aria-label={t("Copy bản nháp này")} className={DRAFT_BTN}
                  onClick={(e) => { e.preventDefault(); void copyText(o); }}><Copy className="size-3.5" aria-hidden /></button>
              </Hint>
              <Hint side="bottom" text={edited ? t("Ô soạn đang có nội dung bạn sửa: gửi từ ô soạn, hoặc xóa nó trước") : o.length > SEND_MAX ? t("Quá {n} ký tự, sửa trong ô soạn rồi gửi", { n: SEND_MAX }) : t("Gửi ngay bản nháp này, trả lời {name}", { name })}>
                <button type="button" aria-label={t("Gửi bản nháp này")} aria-disabled={edited || !fitsSend(o) || !ready} className={DRAFT_BTN}
                  onClick={(e) => { e.preventDefault(); if (!edited && fitsSend(o) && ready) onSend(i); }}><Send className="size-3.5" aria-hidden /></button>
              </Hint>
            </span>
          </span>
          <span className="block min-w-0 whitespace-pre-wrap break-words text-ink">{o}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Open tickets that look like the tag (YouTrack search, no AI): each opens its ticket, "+" puts its link in the reply. */
export function RelatedTickets({ items, onInsert }: { items: YouTrackIssue[]; onInsert: (line: string) => void }) {
  const t = useT();
  return (
    <section aria-label={t("Ticket có vẻ liên quan")} className="grid grid-cols-1 gap-1.5">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-ink-3"><Link2 className="size-3.5" aria-hidden />{t("Ticket có vẻ liên quan")}</h4>
      <ul className="grid grid-cols-1 gap-1">
        {items.slice(0, 3).map((tk) => (
          <li key={tk.id} className="flex min-h-9 items-center gap-2 rounded-lg border border-rule bg-cotton py-0.5 pr-0.5 pl-2 text-xs transition-colors duration-(--dur-micro) hover:border-rule-2">
            <a href={`/youtrack/?ticket=${tk.id}`} onClick={ticketClick(tk.id)} title={tk.summary} className="flex min-w-0 flex-1 items-center gap-2 hover:[&>span:last-child]:underline">
              <span className="shrink-0 rounded-md bg-hl-wash px-1.5 py-0.5 font-mono text-2xs font-medium text-hl-2">{tk.id}</span>
              <span className="truncate text-ink">{tk.summary}</span>
            </a>
            <Hint side="bottom" text={t("Chèn link {id} vào trả lời", { id: tk.id })}>
              <Button type="button" size="icon-xs" variant="ghost" aria-label={t("Chèn link {id} vào trả lời", { id: tk.id })} onClick={() => onInsert(`${tk.id}: ${tk.url}`)}>
                <Plus />
              </Button>
            </Hint>
          </li>
        ))}
      </ul>
    </section>
  );
}

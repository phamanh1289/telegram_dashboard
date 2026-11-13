"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, ExternalLink, Loader2, Paperclip, Send } from "lucide-react";
import { createContext, memo, type ReactNode, use, useMemo } from "react";
import { AiResultCard, dur, UserBubble } from "@/components/ai/chat";
import type { TaskEvent } from "@/components/ai/steps";
import { SEND_ERRORS } from "@/components/composer";
import { ASK_BTN, AskPost, type AskRole, AskTag, Markdown } from "@/components/markdown";
import { Hint } from "@/components/ui/hint";
import { api, ApiError, errorText, type Outbox, type Task } from "@/lib/api";
import { type Attached, chatByTitle, chatTitle, parseAttachments, splitAttachments } from "@/lib/attach";
import { t as tNow, useT } from "@/lib/i18n";
import { sessionId, toast } from "@/lib/inbox";
import { rememberQaGroup } from "@/lib/qa-recent";
import { cn } from "@/lib/utils";

// An AI Agent session's conversation: the log's events folded into turns, tool runs and results (steps: ai/steps.tsx).

export type TaskLog = { items: TaskEvent[]; next: number; running?: boolean };

/** A session's log, read as it grows (AI Agent and Đối chiếu BE alike). It grows in the cache (each poll appends the
 *  new lines), so coming back to a session shows it at once. */
export function useTaskLog(id: string | null, running: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["task-events", id],
    enabled: !!id,
    queryFn: async ({ signal }): Promise<TaskLog> => {
      const prev = qc.getQueryData<TaskLog>(["task-events", id]);
      const read = (after: number) =>
        api<{ items: TaskEvent[]; next: number; total: number; running: boolean }>(`/tasks/${id}/events?after=${after}`, { signal });
      let after = prev?.next ?? 0;
      let r = await read(after);
      if (r.total < after) r = await read((after = 0)); // the task was re-run: start over
      if (!r.running && prev?.running !== false) void qc.invalidateQueries({ queryKey: ["tasks"] }); // the result is in: the list's poll can be 10s behind
      return { items: after ? [...prev!.items, ...r.items] : r.items, next: r.items.length ? r.next : after, running: r.running };
    },
    // Until the log itself says the run ended: the list can flip `running` off before the last poll caught the
    // result (the server reads the log before checking `running`, so that last poll has every line).
    // A finished turn only changes after a send, which refetches.
    refetchInterval: (query) => (running || query.state.data?.running ? 1500 : false),
  });
}

/** Where a turn's time went: tools vs the model thinking/writing, as one bar. */
/** USD the CLI reports, short: $0.42, $1.3 */
export const usd = (n: number) => "$" + (n < 1 ? n.toFixed(2) : n.toFixed(1));

function TurnTimeline({ took, tools, cost }: { took: number; tools: number; cost?: number }) {
  const t = useT();
  const pct = took > 0 ? (tools / took) * 100 : 0;
  return (
    <div className="mt-3 grid gap-1.5 border-t border-ok/20 pt-2.5 text-2xs text-ink-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-paper-3" aria-hidden>
        <span className="h-full origin-left bg-warn/80 animate-in slide-in-from-left-full duration-(--dur-long)" style={{ width: `${pct}%` }} />
        <span className="h-full flex-1 bg-hl/70" />
      </div>
      <p className="flex flex-wrap gap-x-3 font-mono tabular-nums">
        <span>{t("Tổng {time}", { time: dur(took) })}</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-warn/80" aria-hidden />{t("Công cụ {time}", { time: dur(tools) })}</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-hl/70" aria-hidden />{t("Suy nghĩ {time}", { time: dur(took - tools) })}</span>
        {cost !== undefined && <span title={t("Ước tính theo giá API do CLI báo (gói thuê bao không trừ tiền theo số này)")}>≈ {usd(cost)}</span>}
      </p>
    </div>
  );
}

const AI_TEXT = "text-md leading-[1.6]";

/** Opens a message in its group (AI Agent: the session's group is `home`, attached messages of others name it by title). */
export const OpenAttached = createContext<{ home: string | null; open: (chatId: string, messageId: string) => void } | null>(null);

/** One attached message: who, when, which group if not the session's, its text; ↗ opens it in the group. */
function AttachedCard({ a }: { a: Attached }) {
  const t = useT();
  const ctx = use(OpenAttached);
  const qc = useQueryClient();
  const chat = a.id ? (a.group ? chatByTitle(qc, a.group) : ctx?.home) : null;
  return (
    <li className="grid gap-1 rounded-lg border border-rule bg-cotton px-2.5 py-2">
      {a.id && (
        <p className="flex min-w-0 items-center gap-1.5 text-ink-3">
          <span className="shrink-0 font-mono tabular-nums">#{a.id}</span>
          <span className="truncate font-medium text-ink-2">{a.who}</span>
          <span className="shrink-0">{a.when}</span>
          {a.group && <span className="truncate rounded-sm bg-paper-2 px-1">{a.group}</span>}
          {a.media && <span className="shrink-0 rounded-sm bg-paper-2 px-1">{a.media}</span>}
          {ctx && chat && (
            <Hint side="bottom" text={t("Mở tin này trong nhóm Telegram")}>
              <button type="button" aria-label={t("Mở tin #{id} trong nhóm", { id: a.id })} onClick={() => ctx.open(chat, a.id)}
                className="-my-1 ml-auto grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
                <ExternalLink className="size-3.5" aria-hidden />
              </button>
            </Hint>
          )}
        </p>
      )}
      <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{a.body}</p>
    </li>
  );
}

/** A prompt the user sent; attached messages fold under it, one card each. */
/** `code`: a Trợ lý AI ask that read this project; with no typed text it says what the ask was, like the reply panel. */
function UserTurn({ text, code }: { text: string; code?: string }) {
  const t = useT();
  const [typed, attached] = splitAttachments(text);
  const said = typed || attached ? typed : code ? t("Trả lời từ code · {project}", { project: code.split("/").pop() ?? code }) : t("Tóm tắt & gợi ý");
  const items = attached ? parseAttachments(attached) : [];
  return (
    <UserBubble className={AI_TEXT}>
      {said && <p>{said}</p>}
      {items.length > 0 && (
        <details className={cn("whitespace-normal text-xs text-ink-2", said && "mt-1.5")}>
          <summary className="inline-flex cursor-pointer items-center gap-1 rounded-sm hover:text-ink"><Paperclip className="size-3" aria-hidden /> {t("{n} tin đính kèm", { n: items.length })}</summary>
          <ul className="mt-1.5 grid gap-1.5">{items.map((a, i) => <AttachedCard key={a.id || i} a={a} />)}</ul>
        </details>
      )}
    </UserBubble>
  );
}

/** One turn's text, prompt or result. Memoised on the event itself (the log keeps old event objects while it grows), so
 *  the 1.5s poll doesn't re-parse every Markdown block of the session. */
export const EventItem = memo(function EventItem({ ev, took, tools }: { ev: TaskEvent; took?: number; tools?: number }) {
  if (ev.kind === "user") return <li><UserTurn text={ev.text} code={ev.code} /></li>;
  if (ev.kind === "result") {
    return (
      <li>
        <AiResultCard error={ev.error} className="p-4">
          {ev.text && <Markdown asks text={ev.text} className={cn(AI_TEXT, "text-ink")} />}
          {took !== undefined && <TurnTimeline took={took} tools={tools ?? 0} cost={ev.cost} />}
        </AiResultCard>
      </li>
    );
  }
  return <li className={cn("px-0.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)", ev.error ? "text-error" : "text-ink")}><Markdown asks text={ev.text} className={AI_TEXT} /></li>;
});

/** Where an ask goes: `reply`, a reply to the message last attached to the session (its group, even another one);
 *  else a new message in the session's group (the tagged message's topic). `qa`: add a #QA line when it tags someone
 *  (not when the reply already sits in a Q&A thread: it joins that one). */
type AskTo = { taskId: string; chatId: string; messageId: string; reply: boolean; qa: boolean };
const AskTarget = createContext<AskTo | null>(null);

/** The same ask in the same session always gets the same request ID: the outbox then says, on any later visit,
 *  whether it went out, and a second click can't post it twice. */
async function askRequestId(taskId: string, text: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${taskId}\n${text}`))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x80; // UUID v8 (custom), RFC variant
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Send button of one ask: posts it to the group; remembers (via the outbox) that it was sent. */
function PostAsk({ text, role }: { text: string; role: AskRole | null }) {
  const t = useT();
  const at = use(AskTarget)!;
  const qc = useQueryClient();
  const rid = useQuery({ queryKey: ["ask-id", at.taskId, text], queryFn: () => askRequestId(at.taskId, text), staleTime: Infinity });
  const key = ["outbox", rid.data];
  const rec = useQuery({
    queryKey: key, enabled: !!rid.data, staleTime: Infinity, retry: false,
    queryFn: ({ signal }) => api<Outbox>(`/outbox/${rid.data}`, { signal })
      .catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }), // never sent
  });
  const status = rec.data?.status;
  const send = useMutation({
    mutationFn: () => api<Outbox>("/messages/reply", { method: "POST", json: {
      request_id: rid.data!, chat_id: at.chatId, reply_to_message_id: at.messageId, text,
      retry_unknown: status === "unknown", // the user saw "không rõ" and chose to send again
      quote: at.reply,
      qa: at.qa, // tags someone: a #QA line, so the Q&A tab follows the answer
      qa_role: role, // asked to BE / PO / QC (its label in the answer): "#QA_BE_…"
    } }),
    onSuccess: (r) => {
      qc.setQueryData(key, r);
      if (r.status === "failed") return void toast({ text: SEND_ERRORS[r.error_code ?? ""] ?? tNow("Gửi thất bại.") });
      if (at.qa) rememberQaGroup(at.chatId); // the Q&A tab follows this group's answers
      toast({ text: r.status === "sent" ? tNow("Đã gửi vào nhóm") : r.status === "unknown"
        ? tNow("Chưa rõ Telegram đã nhận tin hay chưa: xem nhóm trước khi gửi lại.") : tNow("Đang gửi vào nhóm…") });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: key });
      toast({ text: errorText(e, SEND_ERRORS, tNow("Gửi thất bại.")) });
    },
  });
  const sent = status === "sent";
  const busy = send.isPending || status === "pending" || status === "sending";
  const hint = sent ? t("Đã gửi vào nhóm") : busy ? t("Đang gửi…") : status === "unknown" ? t("Không rõ đã gửi chưa: xem nhóm trước, bấm để gửi lại")
    : at.reply ? t("Gửi ngay ý này thành tin trả lời (reply) tin #{id} ở nhóm {group}: tin đính kèm gần nhất của phiên", { id: at.messageId, group: chatTitle(qc, at.chatId) ?? at.chatId })
    : t("Gửi ngay ý này thành tin mới trong nhóm (có @tên: thêm mã #QA để Q&A theo dõi trả lời)");
  return (
    <Hint text={hint}>
      <button type="button" aria-label={sent ? t("Đã gửi vào nhóm") : t("Gửi ý này vào nhóm")} aria-busy={busy} disabled={sent || busy || !rid.data}
        onClick={() => send.mutate()} className={cn(ASK_BTN, sent && "text-ok", status === "unknown" && "text-warn")}>
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : sent ? <CheckCheck className="size-3.5" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
      </button>
    </Hint>
  );
}

const postAsk = (text: string, role: AskRole | null) => <PostAsk text={text} role={role} />;

/** A session's answers: asks copy with its ID ("#REF-…") and, when it has a group message, post there. Every place
 *  that shows a session's result wraps it in this, so they behave the same. */
export function SessionAsks({ t, children }: { t: Pick<Task, "id" | "chat_id" | "message_id" | "ask_to">; children: ReactNode }) {
  // Stable per session row, so the memoised answers don't re-render on every poll.
  const { id, chat_id, message_id } = t;
  const [toChat, toMsg, inQa] = [t.ask_to?.chat_id, t.ask_to?.message_id, !!t.ask_to?.qa];
  const target = useMemo<AskTo | null>(() => toChat && toMsg ? { taskId: id, chatId: toChat, messageId: toMsg, reply: true, qa: !inQa }
    : chat_id && message_id ? { taskId: id, chatId: chat_id, messageId: message_id, reply: false, qa: true } : null,
  [id, chat_id, message_id, toChat, toMsg, inQa]);
  return (
    <AskTag value={sessionId(t)}>
      <AskTarget value={target}>
        <AskPost value={target && postAsk}>{children}</AskPost>
      </AskTarget>
    </AskTag>
  );
}

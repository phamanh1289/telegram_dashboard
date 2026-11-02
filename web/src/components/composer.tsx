"use client";

import { Bot, Bug, Check, ExternalLink, Loader2, Send, Sparkles, Square, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ModelEffortPicker } from "@/components/claude";
import { IssueDialog, TaskDialog } from "@/components/composer-dialogs";
import { ContextPanel, inline, MessageActions, richText } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { onChanges } from "@/hooks/use-events";
import { api, ApiError, errorText, type AiResult, type Message, type Outbox } from "@/lib/api";
import { telegramLink } from "@/lib/inbox";
import { readComposerAiOpen, readPlatform, readTemplates, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const MAX = 4096; // UTF-16 code units == JS string length

type Outcome =
  | { kind: "idle" }
  | { kind: "sent" }
  | { kind: "unknown"; reason: string }
  | { kind: "error"; message: string; until?: number };

export type DraftInjection = { result: AiResult; chatId: string; nonce: number };

const ERRORS: Record<string, string> = {
  not_tracking: "Nhóm không còn được theo dõi.",
  reply_not_found: "Tin đích không còn hoặc không thuộc nhóm này.",
  not_connected: "Chưa kết nối Telegram. Bản nháp vẫn được giữ.",
  forbidden: "Không có quyền gửi trong nhóm này.",
  request_payload_mismatch: "Nội dung đã đổi so với yêu cầu đang chờ.",
  retry_after: "Telegram yêu cầu chờ trước khi gửi tiếp.",
};

export function Composer({
  chatId,
  replyTo,
  onClearReply,
  onTaskCreated,
  draft,
  onSent,
  onDone,
  aiConfigured,
  youtrackConfigured,
}: {
  chatId: string;
  replyTo: Message; // the inbox remounts the composer (key) for each reply
  onClearReply: () => void;
  onTaskCreated?: () => void;
  draft: DraftInjection | null;
  onSent?: () => void;
  onDone?: () => void; // marked "Xong" here
  aiConfigured: boolean;
  youtrackConfigured: boolean;
}) {
  const [text, setText] = useState("");
  const [templates] = useState(readTemplates); // quick replies from Settings; the composer remounts per reply
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [targetDeleted, setTargetDeleted] = useState(false);
  const [draftStale, setDraftStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // One UUID per send attempt until its result is known; reused on explicit retry.
  const [requestId, setRequestId] = useState<string | null>(null);
  const [draftSources, setDraftSources] = useState<Set<string>>(new Set());
  const [seenDraft, setSeenDraft] = useState<number | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState("");
  const [picked, setPicked] = useState(0); // which AI option is in the textarea
  const [taskOpen, setTaskOpen] = useState(false); // AI Agent dialog
  const [issueOpen, setIssueOpen] = useState(false); // YouTrack dialog
  const [aiPrompt, setAiPrompt] = useState("");
  // Panel layout: the assistant block remembers open/closed per browser.
  const [aiOpen, setAiOpen] = useState(readComposerAiOpen);
  // "Tóm tắt" summarizes only on click: an open panel without a summary for this tag runs instead of closing.
  function toggleAi() {
    const run = !aiOpen || (!analysis && !ask.isPending);
    setAiOpen(run);
    setPref("composerAiOpen", run ? "1" : "0");
    if (run && !analysis && !ask.isPending && !targetDeleted) ask.mutate();
  }

  // Adjust state while rendering when inputs change (no effect round-trip).
  if (draft && draft.chatId === chatId && draft.nonce !== seenDraft) {
    setSeenDraft(draft.nonce);
    setText(draft.result.text);
    setDraftSources(new Set(draft.result.source_message_ids));
    setDraftStale(false);
  }

  useEffect(
    () =>
      onChanges((items) => {
        for (const it of items) {
          if (it.chat_id !== chatId || !it.message_id) continue;
          if (it.message_id === replyTo.message_id && it.kind === "delete") setTargetDeleted(true);
          if (draftSources.has(it.message_id)) setDraftStale(true);
        }
      }),
    [chatId, replyTo.message_id, draftSources],
  );

  useEffect(() => {
    if (outcome.kind !== "error" || !outcome.until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [outcome]);

  const send = useMutation({
    mutationFn: (v: { id: string; retryUnknown: boolean; text: string }) =>
      api<Outbox>("/messages/reply", {
        method: "POST",
        json: {
          request_id: v.id,
          chat_id: chatId,
          reply_to_message_id: replyTo.message_id,
          text: v.text,
          retry_unknown: v.retryUnknown,
        },
      }),
    onSuccess: (rec) => handle(rec),
    onError: (err) => {
      // Only a 4xx with a known code is a rejection. A 5xx may come after Telegram took the message, so keep the request
      // id: a retry then reuses it (retry_unknown) instead of sending twice.
      if (err instanceof ApiError && err.status < 500 && err.code !== "http_error") {
        setRequestId(null); // rejected => certainly not sent
        const until = err.retryAfter ? Date.now() + err.retryAfter * 1000 : undefined;
        setOutcome({ kind: "error", message: errorText(err, ERRORS, "Gửi thất bại."), until });
      } else {
        setOutcome({ kind: "unknown", reason: err instanceof ApiError ? "Máy chủ local gặp lỗi khi gửi." : "Không liên lạc được máy chủ local." });
      }
    },
  });

  // Tagged message (+ nearby context) + the user's prompt -> AI summary, next steps and reply options.
  // Aborting the request is the cancel: the server sees the browser go and kills the claude run.
  const askAbort = useRef<AbortController | null>(null);
  useEffect(() => () => askAbort.current?.abort(), []); // Esc / closing the reply unmounts: stop its run
  const ask = useMutation({
    mutationFn: () => {
      askAbort.current = new AbortController();
      return api<AiResult>("/ai/draft", {
        method: "POST",
        json: { chat_id: chatId, message_ids: [replyTo.message_id], instruction: aiPrompt, project: null, with_context: true, platform: readPlatform() },
        signal: askAbort.current.signal,
      });
    },
    onSuccess: (r) => {
      setAnalysis(r.analysis);
      setOptions(r.options.length > 1 ? r.options : []);
      setPicked(0);
      setText(r.text);
      setDraftSources(new Set(r.source_message_ids));
      setDraftStale(false);
    },
  });

  const check = useMutation({
    mutationFn: (id: string) => api<Outbox>(`/outbox/${id}`),
    onSuccess: (rec) => handle(rec),
  });

  function handle(rec: Outbox) {
    if (rec.status === "sent") {
      setRequestId(null);
      setText("");
      setOptions([]);
      setDraftSources(new Set());
      setDraftStale(false);
      onClearReply();
      onSent?.();
      setOutcome({ kind: "sent" });
    } else if (rec.status === "failed") {
      setRequestId(null);
      setOutcome({ kind: "error", message: ERRORS[rec.error_code ?? ""] ?? "Gửi thất bại." });
    } else {
      setOutcome({
        kind: "unknown",
        reason: rec.status === "sending" ? "Đang gửi…" : "Chưa rõ Telegram đã nhận tin hay chưa.",
      });
    }
  }

  const pending = requestId !== null && outcome.kind === "unknown";
  const waitLeft = outcome.kind === "error" && outcome.until ? Math.max(0, Math.ceil((outcome.until - now) / 1000)) : 0;
  const canSend = text.trim().length > 0 && text.length <= MAX && !send.isPending && !pending && waitLeft === 0 && !targetDeleted;

  function submit(body = text) {
    if (!canSend) return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    setOutcome({ kind: "idle" });
    send.mutate({ id, retryUnknown: false, text: body });
  }

  const head = "text-xs font-medium tracking-normal text-ink-3";
  const link = telegramLink(replyTo);

  return (
    <form
      aria-label="Soạn trả lời"
      className="flex h-full min-h-0 flex-col bg-cotton"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex h-14 shrink-0 items-center gap-0.5 border-b px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-normal tracking-normal text-ink-3">
          Trả lời <span className="font-semibold text-ink">{replyTo.sender_name ?? `#${replyTo.message_id}`}</span>
        </h2>
        <a href={link.app} {...(!link.exact && { target: "_blank", rel: "noreferrer" })}
          title={link.exact ? "Mở tin này trong app Telegram" : "Mở nhóm trên Telegram Web (nhóm thường không có link tới từng tin)"}
          aria-label="Mở Telegram"
          className="grid size-[30px] place-items-center rounded-[var(--radius-input)] text-ink-2 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
          <ExternalLink className="size-4" aria-hidden />
        </a>
        {!replyTo.outgoing && (
          <MessageActions m={replyTo} showContext={showContext} onToggleContext={() => setShowContext((v) => !v)}
            onDone={onDone} />
        )}
        <span aria-hidden className="mx-1 h-5 w-px bg-rule" />
        <Button type="button" size="icon-sm" variant="ghost" onClick={onClearReply} disabled={pending} aria-label="Đóng (Esc)" title="Đóng (Esc)">
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 *:shrink-0">
      {/* Small screens: the composer covers the list, so keep the tagged text in view (xl shows the row beside it). */}
      {replyTo.text && (
        <p className="line-clamp-3 whitespace-pre-wrap break-words rounded-[var(--radius-input)] bg-paper-2 px-3 py-2 text-sm leading-[1.55] text-ink xl:hidden">
          {richText(replyTo)}
        </p>
      )}
      {targetDeleted && <p role="alert" className="text-xs text-error">Tin đích đã bị xóa.</p>}
      <Collapse open={showContext}>{showContext && <ContextPanel m={replyTo} />}</Collapse>
      {(aiConfigured || youtrackConfigured) && (
        <div aria-label="Công cụ" role="group" className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          {aiConfigured && (
            <Button type="button" variant="outline" aria-expanded={aiOpen} aria-controls="ai-panel" onClick={() => toggleAi()}
              className={cn(aiOpen && "border-hl bg-hl-wash text-hl-2 hover:bg-hl-wash")}
              title="AI tóm tắt tin được tag (kèm ngữ cảnh nhóm), đề xuất bước tiếp theo và mẫu trả lời (góc nhìn mobile, chủ yếu Android)">
              <Sparkles /> Tóm tắt
            </Button>
          )}
          {aiConfigured && (
            <Button type="button" variant="outline" disabled={targetDeleted} onClick={() => setTaskOpen(true)}
              title="Giao việc cho AI Agent làm trong một dự án (sửa bug, thêm tính năng…)">
              <Bot /> AI Agent
            </Button>
          )}
          {youtrackConfigured && (
            <Button type="button" variant="outline" disabled={targetDeleted} onClick={() => setIssueOpen(true)}
              title="Tạo ticket YouTrack từ tin này; link ticket được thêm vào trả lời">
              <Bug /> YouTrack
            </Button>
          )}
        </div>
      )}
      {aiConfigured && (
        <Collapse open={aiOpen} id="ai-panel">
          <section aria-label="Tóm tắt" aria-busy={ask.isPending} className="rounded-[var(--radius-card)] border">
            <div className="grid gap-3 p-3">
              <Textarea
                id="ai-prompt"
                aria-label="Prompt cho AI"
                className="min-h-16 resize-y text-sm md:text-sm"
                rows={2}
                maxLength={2000}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (!ask.isPending && !targetDeleted) ask.mutate();
                  }
                }}
                placeholder="Thêm yêu cầu (không bắt buộc). Ví dụ: trả lời lịch sự, hẹn chiều nay"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="AI tóm tắt tin được tag, đề xuất bước tiếp theo và các mẫu trả lời. Enter trong ô prompt cũng chạy."
                  aria-busy={ask.isPending}
                  disabled={targetDeleted || pending || ask.isPending}
                  onClick={() => ask.mutate()}
                >
                  {ask.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                  {ask.isPending ? "Đang tóm tắt…" : analysis ? "Tóm tắt lại" : "Tóm tắt & gợi ý"}
                </Button>
                {ask.isPending && (
                  <Button type="button" size="sm" variant="ghost" className="hover:bg-error-wash hover:text-error animate-in fade-in-0 duration-(--dur-short)"
                    title="Dừng AI đang tóm tắt" onClick={() => askAbort.current?.abort()}>
                    <Square className="fill-current" aria-hidden /> Hủy
                  </Button>
                )}
                <ModelEffortPicker />
              </div>
              {ask.isPending ? (
                <AiThinking />
              ) : analysis && (
                <div aria-label="Tóm tắt và bước tiếp theo" className="grid gap-1.5 break-words rounded-[var(--radius-input)] bg-paper-2 px-3 py-2.5 text-sm leading-[1.55] text-ink-2 animate-in fade-in-0 duration-(--dur-short)">
                  <Md text={analysis} />
                </div>
              )}
            </div>
          </section>
        </Collapse>
      )}
      {options.length > 0 && (
        <fieldset className="grid gap-2 animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short)">
          <legend className={cn(head, "mb-2")}>
            Mẫu AI <span className="font-normal">(chọn để đưa vào ô trả lời)</span>
          </legend>
          {options.map((o, i) => (
            <label
              key={i}
              style={{ animationDelay: `${i * 40}ms` }}
              className={cn(
                "relative grid cursor-pointer gap-1 rounded-[var(--radius-input)] border px-3 py-2.5 text-[0.9375rem] leading-[1.55] transition-[border-color,background-color] duration-(--dur-micro) animate-in fade-in-0 fill-mode-backwards duration-(--dur-short) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                picked === i ? "border-hl bg-hl-wash" : "border-rule bg-cotton hover:border-rule-2 hover:bg-paper-2",
              )}
            >
              <input
                type="radio"
                name="ai-option"
                className="absolute size-px opacity-0"
                checked={picked === i}
                onChange={() => {
                  setPicked(i);
                  setText(o);
                }}
              />
              <span className={cn("flex items-center gap-1.5 text-xs font-medium", picked === i ? "text-hl-2" : "text-ink-3")}>
                {picked === i && <Check className="size-3.5" aria-hidden />}
                {options.length === LEVELS.length ? LEVELS[i] : <>Mẫu <span className="font-mono">{i + 1}</span></>}
              </span>
              <span className="block min-w-0 whitespace-pre-wrap break-words text-ink">{o}</span>
            </label>
          ))}
        </fieldset>
      )}
      </div>
      <div className="grid shrink-0 gap-2 border-t bg-cotton px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        {templates.length > 0 && !pending && (
          <div aria-label="Mẫu trả lời nhanh" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 no-scrollbar">
            {templates.map((t) => (
              <button key={t} type="button" title={t} onClick={() => setText((cur) => (cur.trim() ? `${cur}\n${t}` : t))}
                className="max-w-56 shrink-0 truncate rounded-full border border-rule bg-paper-2 px-2.5 py-1 text-xs text-ink-2 transition-[background-color,border-color,color,translate] duration-(--dur-micro) hover:-translate-y-px hover:border-rule-2 hover:bg-hl-wash hover:text-hl-2 active:translate-y-0">
                {t}
              </button>
            ))}
          </div>
        )}
        <Textarea
          aria-label="Nội dung trả lời"
          className="min-h-24 resize-y"
          value={text}
          readOnly={pending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={4}
          placeholder="Viết trả lời… (⌘/Ctrl+Enter để gửi)"
        />
      {pending && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" aria-busy={check.isPending} disabled={check.isPending} onClick={() => requestId && check.mutate(requestId)}>
            Kiểm tra
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={send.isPending}
            onClick={() => requestId && send.mutate({ id: requestId, retryUnknown: true, text })}>
            Thử lại cùng yêu cầu
          </Button>
          <Button type="button" size="sm" variant="ghost"
            onClick={() => {
              setRequestId(null);
              setOutcome({ kind: "idle" });
            }}>
            Bỏ theo dõi yêu cầu
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3">
      <div aria-live="polite" className="min-h-5 min-w-0 flex-1 text-xs leading-snug">
        <span>
          {draftStale && (
            <span role="status" className="text-warn">Tin nguồn của bản nháp AI đã đổi; bản nháp có thể đã cũ. </span>
          )}
          {ask.isError && ask.error.name === "AbortError" && <span role="status" className="text-ink-3">Đã hủy tóm tắt. </span>}
          {ask.isError && ask.error.name !== "AbortError" && (
            <span role="alert" className="text-error">
              {errorText(ask.error, {
                ai_scope_not_allowed: "AI bị chặn do chưa cấp quyền dữ liệu (đặt AI_REQUIRE_CONSENT=0 cho dùng cá nhân). ",
                ai_agent_missing: "Không tìm thấy Claude Code CLI (lệnh claude) để đọc dự án. Cài Claude Code hoặc đặt AI_AGENT_PROJECT_COMMAND trong .env. ",
              }, "AI Agent lỗi hoặc quá thời gian; bạn vẫn có thể trả lời thủ công. ")}
            </span>
          )}
          {outcome.kind === "sent" && <span className="text-ok">Đã gửi.</span>}
          {outcome.kind === "unknown" && (
            <span className="text-warn">
              {outcome.reason} Thử lại sẽ dùng cùng yêu cầu, Telegram có thể đã nhận tin.
            </span>
          )}
          {outcome.kind === "error" && (
            <span className="text-error">
              {outcome.message}
              {waitLeft > 0 && ` Còn ${waitLeft} giây.`}
            </span>
          )}
        </span>
      </div>
        {text.length > 0 && (
          <span className={cn("shrink-0 font-mono text-xs tabular-nums", text.length > MAX ? "font-medium text-error" : "text-ink-3")}>
            {text.length}/{MAX}
          </span>
        )}
        <Button type="submit" aria-busy={send.isPending} disabled={!canSend} className="shrink-0 px-4">
          {send.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {send.isPending ? "Đang gửi…" : "Gửi"}
          <span aria-hidden className="ml-1 font-mono text-[0.6875rem] font-normal opacity-70">⌘↵</span>
        </Button>
      </div>
      </div>
      <TaskDialog m={replyTo} analysis={analysis} open={taskOpen} onOpenChange={setTaskOpen}
        onCreated={() => { setTaskOpen(false); onTaskCreated?.(); }} />
      <IssueDialog m={replyTo} note={aiPrompt} open={issueOpen} onOpenChange={setIssueOpen}
        onCreated={(line) => { setText((t) => (t.trim() ? `${t}\n${line}` : line)); setIssueOpen(false); }} />
    </form>
  );
}

/** Folds content open and closed: the row track grows from 0fr to 1fr and the content fades, so siblings below glide instead of jumping. */
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
    if (h) out.push(<p key={i} className="mt-1 font-semibold text-ink first:mt-0">{bold(h[1], i)}</p>);
    else if (line.trim()) out.push(<p key={i}>{bold(line, i)}</p>);
  });
  flush(-1);
  return out;
}

function bold(s: string, key: number) {
  return s.split(/\*\*(.+?)\*\*/g).map((t, i) =>
    i % 2 ? <strong key={i} className="font-semibold text-ink">{inline(t, key * 100 + i)}</strong> : inline(t, key * 100 + i));
}

// The AI drafts come in this order (prompt in ai.py): who the user is to the person they answer.
const LEVELS = ["Tôi là cấp trên", "Ngang cấp", "Trả lời cấp trên"];

const THINKING = [
  "Đang đọc tin nhắn…",
  "Đang lục lại ngữ cảnh nhóm…",
  "Đang hỏi ý kiến con Android 🤖",
  "Đang pha cà phê cho AI ☕",
  "Đang gọt câu trả lời cho lịch sự…",
  "Sắp xong rồi, đợi xíu nha…",
];

// Waiting on the AI: a bouncing sparkle, a dot wave and a rotating status line (motion stops under reduced motion).
function AiThinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % THINKING.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div role="status" className="flex items-center gap-3 rounded-[var(--radius-input)] bg-paper-2 px-3 py-3 text-sm text-ink-2">
      <Sparkles aria-hidden className="ai-hop size-5 shrink-0 text-hl" />
      <span key={i} className="min-w-0 flex-1 truncate animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">{THINKING[i]}</span>
      <span aria-hidden className="flex shrink-0 gap-1">
        {[0, 1, 2].map((d) => <span key={d} className="ai-dot size-1.5 rounded-full bg-hl" style={{ animationDelay: `${d * 150}ms` }} />)}
      </span>
    </div>
  );
}

function Collapse({ open, id, children }: { open: boolean; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} inert={!open}
      className={cn("grid transition-[grid-template-rows,opacity] duration-(--dur-short) ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="-m-1 min-h-0 overflow-hidden p-1">{children}</div>
    </div>
  );
}

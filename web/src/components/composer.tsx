"use client";

import { ArrowLeft, ArrowUp, Bot, Bug, Check, ChevronDown, ChevronUp, ExternalLink, Loader2, MessageCircleQuestion, Plus, Send, Sparkles, Square } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ModelEffortPicker, useAiPrefs } from "@/components/ai";
import { type AiSkill, AiIdle, AiPromptBox, AiResultCard, AiThinking, AiWriting, UserBubble, useFollow } from "@/components/ai/chat";
import { Avatar } from "@/components/chat-list";
import { IssueDialog, TaskPage } from "@/components/composer-dialogs";
import { Dialog, DialogContent, DIALOG_SHEET } from "@/components/ui/dialog";
import { useOpenSimilar } from "@/components/ticket-form";
import { DeepBadge, DeepPick } from "@/components/deep-think";
import { RemindPick, remindAt } from "@/components/remind";
import { Snippets } from "@/components/snippets";
import { groupMembers, useMention } from "@/components/mention";
import { ContextPanel, inline, MessageActions, richText } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { onChanges } from "@/hooks/use-events";
import { api, ApiError, apiStream, errorText, type AiResult, type Message, type Outbox } from "@/lib/api";
import { draftKey, remind, saveDraft, telegramLink, toast } from "@/lib/inbox";
import { doneLoopMessage } from "@/lib/report-back";
import { timeLabel } from "@/lib/time";
import { getPref, put, readIntro, readPlatform, useRole, usesCode, type YtRole } from "@/lib/prefs";
import { cn, MOD } from "@/lib/utils";

const MAX = 4096; // UTF-16 code units == JS string length
// What "Tóm tắt" brings out and an example ask, per role (Cài đặt chung › Vai trò); the prompt side is ai.py ROLE_FOCUS.
const ROLE_AI: Record<YtRole, [string, string]> = {
  dev: ["góc nhìn kỹ thuật", "trả lời lịch sự, hẹn chiều nay"],
  qa: ["góc nhìn QA: bước tái hiện, môi trường, mức độ, phạm vi test", "hỏi thêm build và thiết bị để tái hiện"],
  po: ["góc nhìn PO: ảnh hưởng người dùng, ưu tiên, việc cần bạn quyết", "chốt ưu tiên, hẹn trả lời trước thứ Sáu"],
};

type Outcome =
  | { kind: "idle" }
  | { kind: "sent" }
  | { kind: "unknown"; reason: string }
  | { kind: "error"; message: string; until?: number };

export type DraftInjection = { result: AiResult; chatId: string; nonce: number };

export const SEND_ERRORS: Record<string, string> = {
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
  onStep,
  position,
  aiConfigured,
  youtrackConfigured,
  groupTitle,
}: {
  chatId: string;
  replyTo: Message; // the inbox remounts the composer (key) for each reply
  onClearReply: () => void;
  onTaskCreated?: (id: string) => void;
  draft: DraftInjection | null;
  onSent?: () => void;
  onDone?: () => void; // marked "Xong" here
  onStep?: (dir: 1 | -1) => void; // Alt+↓ / Alt+↑: the next / previous open tag
  position?: [number, number]; // this tag among the open ones (1/4)
  aiConfigured: boolean;
  youtrackConfigured: boolean;
  groupTitle?: string;
}) {
  // The reply draft lives per tag in this browser: Esc, Quay lại, j/k, a reload or a crash never lose it.
  const [text, setText] = useState(() => getPref(draftKey(replyTo)) ?? "");
  const latest = useRef(text);
  // A send whose result is not known yet: its text may already be on Telegram, so it is not kept as a draft
  // (reopening it would invite a duplicate send that skips "Thử lại cùng yêu cầu").
  const unsure = useRef(false);
  const qc = useQueryClient();
  useEffect(() => {
    latest.current = text;
    const t = setTimeout(() => { if (!unsure.current) saveDraft(replyTo, text); }, 300);
    return () => clearTimeout(t);
  }, [replyTo, text]);
  useEffect(() => () => { if (!unsure.current) saveDraft(replyTo, latest.current); }, [replyTo]); // leaving within the debounce
  const warned = useRef(false); // Esc once more leaves without a saved draft
  const [remindAfter, setRemindAfter] = useState(""); // RemindPick: reopen this tag at that time once the reply is sent
  const [snips, setSnips] = useState(false);
  const { attach, ...mention } = useMention(groupMembers(chatId), text, setText);
  const [pane, setPane] = useState<"reply" | "ai">("reply"); // narrow (split view, phones): one pane at a time
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [targetDeleted, setTargetDeleted] = useState(false);
  const [draftStale, setDraftStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // One UUID per send attempt until its result is known; reused on explicit retry.
  const [requestId, setRequestId] = useState<string | null>(null);
  const [draftSources, setDraftSources] = useState<Set<string>>(new Set());
  const [seenDraft, setSeenDraft] = useState<number | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState("");
  const [partial, setPartial] = useState(""); // the answer so far, while the AI writes it
  const [turns, setTurns] = useState<Turn[]>([]); // the asks of this panel, oldest first, like an AI Agent session
  const lastTurn = (f: (t: Turn) => Turn) => setTurns((l) => l.map((t, i) => (i === l.length - 1 ? f(t) : t)));
  const aiName = useAiPrefs().name;
  const role = useRole();
  const [, example] = ROLE_AI[role ?? "dev"];
  const missing = role === "qa" ? askMissing(analysis) : "";
  const [picked, setPicked] = useState(0); // which AI option is in the textarea
  const [taskOpen, setTaskOpen] = useState(false); // the AI Agent sheet
  const [issueOpen, setIssueOpen] = useState(false); // YouTrack dialog
  const [aiPrompt, setAiPrompt] = useState("");
  const [showContext, setShowContext] = useState(true); // the group thread around the tag (Ngữ cảnh toggles it)
  // A reply sent here can land after the panel closed: its callbacks must not close or advance the next one.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // Bring the tag into view whenever its card mounts (first paint, then again once the thread loads around it).
  const toTag = useCallback((el: HTMLElement | null) => el?.scrollIntoView({ block: "start" }), []);

  // Adjust state while rendering when inputs change (no effect round-trip).
  if (draft && draft.chatId === chatId && draft.nonce !== seenDraft) {
    setSeenDraft(draft.nonce);
    const t = draft.result.text;
    setText((cur) => (cur.trim() && cur !== t ? `${cur}\n${t}` : t)); // a saved draft stays, the new text goes under it
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
        unsure.current = false;
        saveDraft(replyTo, latest.current);
        const until = err.retryAfter ? Date.now() + err.retryAfter * 1000 : undefined;
        setOutcome({ kind: "error", message: errorText(err, SEND_ERRORS, "Gửi thất bại."), until });
      } else {
        setOutcome({ kind: "unknown", reason: err instanceof ApiError ? "Máy chủ local gặp lỗi khi gửi." : "Không liên lạc được máy chủ local." });
      }
    },
  });

  const relKey = `aiRel:${replyTo.sender_id ?? "?"}`; // which of LEVELS the user is to this sender
  // Open tickets that look like this tag (YouTrack search, no AI), when it names none itself.
  const related = useOpenSimilar(replyTo.text, { enabled: youtrackConfigured && !TICKET_ID.test(replyTo.text) });

  // Tagged message (+ nearby context) + the user's prompt -> AI summary, next steps and reply options.
  // Aborting the request is the cancel: the server sees the browser go and kills the claude run.
  const askAbort = useRef<AbortController | null>(null);
  useEffect(() => () => askAbort.current?.abort(), []); // Esc / closing the reply unmounts: stop its run
  const ask = useMutation({
    mutationFn: (instruction: string) => {
      askAbort.current = new AbortController();
      setPartial("");
      return apiStream<AiResult>("/ai/draft",
        { chat_id: chatId, message_ids: [replyTo.message_id], instruction, project: null, with_context: true, platform: readPlatform(), role: role ?? "dev", intro: readIntro() },
        askAbort.current.signal, setPartial);
    },
    onMutate: (instruction) => {
      setTurns((l) => [...l, { prompt: instruction, at: Date.now() }]);
      setAiPrompt(""); // sent, like a chat; the ask stays in its bubble
    },
    onError: (err) => lastTurn((t) => ({ ...t, error: err.name === "AbortError" ? "" : errorText(err, {
      ai_agent_missing: `Không tìm thấy ${aiName} CLI để đọc dự án, xem Cài đặt › AI.`,
    }, "AI lỗi hoặc quá thời gian; bạn vẫn có thể trả lời thủ công.") })),
    onSuccess: (r) => {
      lastTurn((t) => ({ ...t, analysis: r.analysis, took: (Date.now() - t.at) / 1000 }));
      setAnalysis(r.analysis);
      setOptions(r.options.length > 1 ? r.options : []);
      // the relationship picked last time for this sender comes first in the textarea
      const rel = r.options.length === LEVELS.length ? Number(getPref(relKey) ?? 0) : 0;
      const i = rel >= 0 && rel < r.options.length ? rel : 0;
      setPicked(i);
      setText(r.options[i] ?? r.text);
      if (r.options.length <= 1) setPane("reply"); // narrow: one draft, show it; several: pick them on this pane
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
      unsure.current = false;
      latest.current = "";
      saveDraft(replyTo, ""); // also when it lands after the panel closed
      doneLoopMessage(replyTo); // a "Báo lại" item for this tag is answered
      void qc.invalidateQueries({ queryKey: ["briefing-answered"] }); // …and a Briefing item citing it
      const at = remindAt(remindAfter); // "để mình check rồi báo": back on the list at that time (the pick at send)
      if (at) remind(replyTo, at).catch((e) => toast({ text: errorText(e, {}, "Đã gửi, nhưng chưa đặt được nhắc lại") }));
    } else if (rec.status === "failed") {
      unsure.current = false;
      saveDraft(replyTo, latest.current); // certainly not sent: keep the text, even when the panel already closed
    }
    if (!alive.current) return;
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
      setOutcome({ kind: "error", message: SEND_ERRORS[rec.error_code ?? ""] ?? "Gửi thất bại." });
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

  // Captured before the inbox's own Esc (which closes the reply): a send in flight holds it. A draft doesn't: it is saved.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const step = e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp") ? (e.key === "ArrowDown" ? 1 : -1) : 0;
    if ((e.key !== "Escape" && !step) || document.querySelector("[role=dialog], [role=menu], [role=listbox]")) return; // an open dialog / menu goes first
    if (send.isPending) {
      e.preventDefault();
      return;
    }
    // Leaving relies on the saved draft: if this browser refuses to store it, warn once before the text is lost.
    if (e.key === "Escape" && !unsure.current && latest.current.trim() && !saveDraft(replyTo, latest.current) && !warned.current) {
      warned.current = true;
      e.preventDefault();
      toast({ text: "Không lưu được nháp trên trình duyệt này: bấm Esc lần nữa để bỏ nội dung" });
      return;
    }
    if (step) {
      e.preventDefault();
      onStep?.(step);
    }
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => onKey(e);
    document.addEventListener("keydown", on, true);
    return () => document.removeEventListener("keydown", on, true);
  }, []);

  function submit(body = text) {
    if (!canSend) return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    unsure.current = true;
    saveDraft(replyTo, ""); // back if the send fails (handle / onError)
    setOutcome({ kind: "idle" });
    send.mutate({ id, retryUnknown: false, text: mention.wire(body) });
  }

  const head = "text-sm font-semibold text-ink";
  const link = telegramLink(replyTo);
  const name = replyTo.sender_name ?? `#${replyTo.message_id}`;
  const insert = (line: string) => setText((cur) => (cur.trim() ? `${cur}\n${line}` : line));
  const tools = (aiConfigured && usesCode(role)) || youtrackConfigured;
  // What the idle assistant shows it can do here: only the tools this panel offers.
  const skills: AiSkill[] = ["summary", "steps", "reply", ...(youtrackConfigured ? ["ticket" as const] : []), ...(usesCode(role) ? ["code" as const] : [])];
  const { ref: feedRef, onScroll: onFeedScroll } = useFollow(`${partial.length}:${options.length}`, turns.length); // follows the AI's writing unless scrolled up
  const runAsk = () => { if (!ask.isPending && !targetDeleted && !pending) ask.mutate(aiPrompt.trim()); };
  const askLabel = analysis ? "Tóm tắt lại" : "Tóm tắt & gợi ý";
  const tag = (
    <article ref={toTag} aria-label="Tin được tag" className="my-1 grid scroll-mt-16 gap-1 rounded-[var(--radius-input)] border-l-[3px] border-hl bg-hl-wash py-2.5 pr-3 pl-3">
      <span className="flex min-h-6 items-center gap-2 text-xs font-medium text-hl-2">
        <span>{replyTo.outgoing ? "Bạn" : name}</span><span className="font-normal">tag bạn</span>
        <DeepBadge m={replyTo} />
        <DeepPick m={replyTo} className="ml-auto" />
      </span>
      <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.6] text-ink">
        {replyTo.text ? richText(replyTo) : <i className="text-ink-3">Tin không có chữ</i>}
      </p>
    </article>
  );

  return (<>
    {/* A wide sheet over the reply, like Tạo ticket: the reply stays as it was underneath. */}
    <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
      <DialogContent showCloseButton={false} className={cn(DIALOG_SHEET, "sm:max-w-6xl")}>
        <TaskPage m={replyTo} analysis={analysis} groupTitle={groupTitle} onBack={() => setTaskOpen(false)}
          onCreated={(id) => { setTaskOpen(false); onTaskCreated?.(id); }} />
      </DialogContent>
    </Dialog>
    <form
      aria-label="Soạn trả lời"
      data-composer
      className="@container grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-cotton"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* Back, who you answer, the actions on that tag. */}
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 sm:px-5">
        <Hint side="bottom" text="Quay lại danh sách (Esc)">
          <Button type="button" size="icon-sm" variant="ghost" onClick={onClearReply} disabled={pending} aria-label="Quay lại danh sách (Esc)">
            <ArrowLeft />
          </Button>
        </Hint>
        {onStep && (
          <span className="flex items-center">
            <Hint side="bottom" text="Tag trước (k, Alt+↑)">
              <Button type="button" size="icon-sm" variant="ghost" disabled={pending || send.isPending} onClick={() => onStep(-1)} aria-label="Tag trước"><ChevronUp /></Button>
            </Hint>
            {position && <span className="px-0.5 font-mono text-xs text-ink-3 tabular-nums" aria-label={`Tag ${position[0]} trên ${position[1]} đang chờ`}>{position[0]}/{position[1]}</span>}
            <Hint side="bottom" text="Tag tiếp theo (j, Alt+↓)">
              <Button type="button" size="icon-sm" variant="ghost" disabled={pending || send.isPending} onClick={() => onStep(1)} aria-label="Tag tiếp theo"><ChevronDown /></Button>
            </Hint>
          </span>
        )}
        <Avatar name={name} className="size-9 text-sm" />
        <div className="grid min-w-0 flex-1 leading-tight">
          <h2 className="truncate text-base font-semibold">{name}</h2>
          <span className="flex min-w-0 gap-2 text-xs text-ink-3">
            {groupTitle && <span className="truncate">{groupTitle}</span>}
            <time dateTime={replyTo.date} className="shrink-0 font-mono tabular-nums">{timeLabel(replyTo.date)}</time>
          </span>
        </div>
        {/* Narrow: Mở Telegram stays on the name row, the actions take the next row whole. */}
        {!replyTo.outgoing && (
          <div className="order-last flex w-full flex-wrap items-center gap-0.5 sm:order-none sm:w-auto">
            <MessageActions m={replyTo} showContext={showContext} onDone={onDone} onToggleContext={() => setShowContext((v) => !v)} />
          </div>
        )}
        <Hint side="bottom" title="Mở Telegram" text={link.exact ? "Mở tin này trong app Telegram" : "Mở nhóm trên Telegram Web (nhóm thường không có link tới từng tin)"}>
          <a href={link.app} {...(!link.exact && { target: "_blank", rel: "noreferrer" })} aria-label="Mở Telegram"
            className="grid size-[30px] shrink-0 place-items-center rounded-[var(--radius-input)] text-ink-2 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </Hint>
      </div>

      {/* Wide: conversation + reply box on the left, assistant on the right. Narrow: one scroll, reply box pinned at the bottom. */}
      <div className={cn("flex min-h-0 flex-col overflow-y-auto @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] @3xl:grid-rows-[minmax(0,1fr)_auto] @3xl:overflow-hidden",
        pane === "ai" && "@max-3xl:overflow-hidden")}>
        {/* Narrow: the reply or the assistant, so the AI prompt box stays pinned at the bottom of its pane. */}
        {(aiConfigured || tools) && (
          <div className="shrink-0 px-3 pt-2 @3xl:hidden">
            <Segmented id="composer-pane" label="Khung" variant="card" value={pane} onChange={setPane}
              items={[{ value: "reply", label: <><Send className="size-3.5" aria-hidden />Trả lời</> }, { value: "ai", label: <><Sparkles className="size-3.5" aria-hidden />{aiConfigured ? "Trợ lý AI" : "Công cụ"}</> }]} />
          </div>
        )}
        {/* The thread as it reads in the group: messages before, the tag in place, messages after. */}
        <div className={cn("grid content-start gap-3 px-4 py-5 sm:px-6 @3xl:col-start-1 @3xl:row-start-1 @3xl:overflow-y-auto", pane === "ai" && "@max-3xl:hidden")}>
          {targetDeleted && <p role="alert" className="rounded-[var(--radius-input)] bg-error-wash px-3 py-2 text-xs text-error">Tin đích đã bị xóa.</p>}
          {showContext
            ? <ContextPanel m={replyTo} focus={tag} className="mt-0 max-h-none gap-3 overflow-visible bg-transparent p-0 text-sm" />
            : tag}
        </div>

        <aside aria-label="Trợ lý" className={cn("order-2 flex min-h-0 flex-1 flex-col border-t bg-paper-2 @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1 @3xl:border-t-0 @3xl:border-l",
          pane === "reply" && "@max-3xl:hidden")}>
          {/* Like an AI Agent session: header and conversation scroll, the prompt box stays pinned under them. */}
          <div ref={feedRef} onScroll={onFeedScroll}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6 @3xl:px-5">
          {/* One row: what this panel is, and the tools that act on the tag. */}
          {(aiConfigured || tools) && (
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
              <h3 className={cn(head, "flex items-center gap-1.5")}>
                {aiConfigured ? <><Sparkles className="size-4 text-hl" aria-hidden /> Trợ lý AI</> : "Công cụ"}
              </h3>
              {tools && (
                <div role="toolbar" aria-label="Công cụ" className="flex flex-wrap gap-1.5">
                  {aiConfigured && usesCode(role) && (
                    <Hint side="bottom" title="AI Agent" text="Giao cho AI Agent làm trong một dự án (sửa bug, thêm tính năng…)">
                      <Button type="button" size="sm" variant="outline" aria-label="AI Agent" disabled={targetDeleted} onClick={() => setTaskOpen(true)}><Bot /> Giao AI Agent</Button>
                    </Hint>
                  )}
                  {youtrackConfigured && (
                    <Hint side="bottom" title="YouTrack" text="Tạo ticket YouTrack từ tin này; link ticket được thêm vào trả lời">
                      <Button type="button" size="sm" variant="outline" aria-label="YouTrack" disabled={targetDeleted} onClick={() => setIssueOpen(true)}><Bug /> Tạo ticket</Button>
                    </Hint>
                  )}
                </div>
              )}
            </div>
          )}

          {!!related.data?.length && (
            <section aria-label="Ticket có vẻ liên quan" className="grid grid-cols-1 gap-2">
              <h3 className={head}>Ticket có vẻ liên quan</h3>
              <ul className="grid grid-cols-1 divide-y rounded-[var(--radius-input)] border bg-cotton">
                {related.data.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex min-h-10 items-center gap-2 py-1 pr-1 pl-3 text-xs">
                    <a href={`/youtrack/?ticket=${t.id}`} title={t.summary} className="min-w-0 flex-1 truncate text-ink-2 hover:underline">
                      <b className="font-mono font-medium text-ink">{t.id}</b> {t.summary}
                    </a>
                    <Button type="button" size="xs" variant="ghost" aria-label={`Chèn link ${t.id} vào trả lời`} onClick={() => insert(`${t.id}: ${t.url}`)}>
                      <Plus /> Chèn
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {aiConfigured && (
            <section aria-label="Trợ lý AI" aria-busy={ask.isPending} className="grid grid-cols-[minmax(0,1fr)] gap-3">
              <AiTurns turns={turns} running={ask.isPending} partial={partial} missing={missing} onMissing={() => insert(missing)} />

              {options.length > 0 && !ask.isPending && (
                <fieldset className="grid gap-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)">
                  <legend className="mb-2 text-xs font-medium text-ink-3">Mẫu AI <span className="font-normal">(chọn để đưa vào ô soạn)</span></legend>
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
                        onChange={() => {
                          // Edited by hand: add the new pick under it rather than overwrite the edits.
                          if (text.trim() && text !== options[picked]) {
                            insert(o);
                            toast({ text: "Đã chèn mẫu dưới nội dung bạn đã sửa" });
                          } else setText(o);
                          setPicked(i);
                          if (options.length === LEVELS.length) put(relKey, String(i));
                        }}
                      />
                      <span className={cn("flex items-center gap-1.5 text-xs font-medium", picked === i ? "text-hl-2" : "text-ink-3")}>
                        {picked === i && <Check className="size-3.5 animate-in zoom-in-50 duration-(--dur-short)" aria-hidden />}
                        {options.length === LEVELS.length ? LEVELS[i] : <>Mẫu <span className="font-mono">{i + 1}</span></>}
                      </span>
                      <span className="block min-w-0 whitespace-pre-wrap break-words text-ink">{o}</span>
                    </label>
                  ))}
                </fieldset>
              )}
            </section>
          )}
          {aiConfigured && !turns.length && <AiIdle skills={skills} className="flex-1" />}
          </div>

          {aiConfigured && (
            <div className="shrink-0 px-4 pb-4 sm:px-6 @3xl:px-5">
              <AiPromptBox id="ai-prompt" aria-label="Prompt cho AI" maxLength={2000} value={aiPrompt} onChange={setAiPrompt} onSend={runAsk}
                running={ask.isPending} onStop={() => askAbort.current?.abort()} stopLabel="Hủy" stopHint="Dừng AI (Hủy tóm tắt)"
                placeholder={ask.isPending ? "AI đang tóm tắt…" : `Thêm yêu cầu (không bắt buộc). Ví dụ: ${example}`}
                tools={<ModelEffortPicker compact className="min-w-0 gap-x-2" />}
                actions={!ask.isPending && (
                  <Hint text={`${askLabel} (Enter)`} side="bottom">
                    <Button type="button" size="sm" aria-label={askLabel} disabled={targetDeleted || pending} onClick={runAsk}
                      className="rounded-full bg-hl text-hl-ink hover:brightness-110 animate-in zoom-in-95 fade-in-0 duration-(--dur-short)">
                      {aiPrompt.trim() ? <ArrowUp aria-hidden /> : <Sparkles aria-hidden />} {askLabel}
                    </Button>
                  </Hint>
                )} />
            </div>
          )}
        </aside>

        <div className={cn("sticky bottom-0 z-10 order-3 mt-auto grid gap-2 border-t bg-cotton px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-6 @3xl:static @3xl:col-start-1 @3xl:row-start-2",
          pane === "ai" && "@max-3xl:hidden")}>
          {/* One field: the text and the send row (the tag it answers is the highlighted card above). */}
          <div className="relative grid rounded-[var(--radius-card)] border border-rule-2 bg-cotton transition-[border-color] duration-(--dur-micro) hover:border-ink-3 has-[textarea:focus-visible]:border-hl">
            {mention.popup}
            <Textarea
              ref={attach}
              aria-label="Nội dung trả lời"
              className="max-h-[40vh] min-h-16 resize-none border-0 bg-transparent hover:border-0 focus-visible:outline-none"
              value={text}
              readOnly={pending}
              onChange={(e) => { setText(e.target.value); mention.track(e); }}
              onSelect={mention.track}
              onKeyDown={(e) => {
                if (mention.onKeyDown(e)) return;
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "/" && !text && !pending) { // "/" in an empty box: the reply templates
                  e.preventDefault();
                  setSnips(true);
                }
              }}
              rows={2}
              placeholder={`Trả lời ${name}… (@ để tag, / để chèn mẫu)`}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-2 pl-1.5">
              <span className="flex items-center gap-0.5">
                <Snippets open={snips} onOpenChange={setSnips} current={text}
                  vars={{ "tên": replyTo.sender_name ?? "", ticket: replyTo.text.match(TICKET_ID)?.[0] ?? "" }}
                  onInsert={(line) => { insert(line); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Nội dung trả lời']")?.focus()); }} />
                {!replyTo.outgoing && <RemindPick value={remindAfter} onChange={setRemindAfter} />}
              </span>
              <div aria-live="polite" className="min-w-0 flex-1 text-xs leading-snug">
                {draftStale && <span role="status" className="text-warn">Tin nguồn của bản nháp AI đã đổi; bản nháp có thể đã cũ. </span>}
                {outcome.kind === "sent" && <span className="text-ok">Đã gửi.</span>}
                {outcome.kind === "unknown" && <span className="text-warn">{outcome.reason} Thử lại sẽ dùng cùng yêu cầu, Telegram có thể đã nhận tin.</span>}
                {outcome.kind === "error" && <span className="text-error">{outcome.message}{waitLeft > 0 && ` Còn ${waitLeft} giây.`}</span>}
              </div>
              {text.length > 0 && (
                <span className={cn("shrink-0 font-mono text-xs tabular-nums", text.length > MAX ? "font-medium text-error" : "text-ink-3")}>
                  {text.length}/{MAX}
                </span>
              )}
              <Button type="submit" size="sm" aria-busy={send.isPending} disabled={!canSend} className="shrink-0 px-3">
                {send.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {send.isPending ? "Đang gửi…" : "Gửi"}
                <span aria-hidden className="ml-0.5 font-mono text-[0.6875rem] font-normal opacity-70">{MOD}↵</span>
              </Button>
            </div>
          </div>
          {pending && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" aria-busy={check.isPending} disabled={check.isPending} onClick={() => requestId && check.mutate(requestId)}>
                Kiểm tra
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={send.isPending}
                onClick={() => requestId && send.mutate({ id: requestId, retryUnknown: true, text: mention.wire(text) })}>
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
        </div>
      </div>
      <IssueDialog m={replyTo} note={aiPrompt || turns.at(-1)?.prompt || ""} ai={aiConfigured} open={issueOpen} onOpenChange={setIssueOpen}
        onCreated={(line) => { insert(line); setIssueOpen(false); }} />
    </form>
  </>);
}

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

const TICKET_ID = /\b[A-Z][A-Z0-9]+-\d+\b/;

/** QA: a reply asking for what the summary marked [cần bổ sung] ("**Môi trường:** [cần bổ sung]" → "Môi trường"). */
export function askMissing(analysis: string) {
  const lines = analysis.split("\n").filter((l) => /cần bổ sung/i.test(l));
  if (!lines.length) return "";
  const what = [...new Set(lines.map((l) => l.match(/\*\*([^*]+?):?\*\*/)?.[1]?.trim()).filter(Boolean))];
  return `Bạn bổ sung giúp mình ${what.length ? what.join(", ").toLowerCase() : "các thông tin còn thiếu (build, thiết bị / OS, bước tái hiện)"} để mình tái hiện và test nhé.`;
}

// The AI drafts come in this order (prompt in ai.py): who the user is to the person they answer.
const LEVELS = ["Tôi là cấp trên", "Ngang cấp", "Trả lời cấp trên"];

type Turn = { prompt: string; at: number; analysis?: string; took?: number; error?: string }; // error "": cancelled

const THINKING = [
  "Đang đọc tin nhắn…",
  "Đang lục lại ngữ cảnh nhóm…",
  "Đang hỏi ý kiến con Android…",
  "Đang pha cà phê cho AI…",
  "Đang gọt câu trả lời cho lịch sự…",
  "Sắp xong rồi, đợi xíu nha…",
];

/** The panel's asks as a conversation: the ask in a bubble, then the AI thinking / writing, then the result card. */
function AiTurns({ turns, running, partial, missing, onMissing }: {
  turns: Turn[]; running: boolean; partial: string; missing: string; onMissing: () => void;
}) {
  const live = partial.split(/\n\s*={3,}\s*(?:\n|$)/)[0]; // the summary part; the reply options come after "==="
  return (
    <ul aria-label="Hội thoại với AI" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {turns.map((t, i) => {
        const last = i === turns.length - 1;
        return (
          <Fragment key={t.at}>
            <li><UserBubble>{t.prompt || <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5 text-hl-2" aria-hidden /> Tóm tắt & gợi ý</span>}</UserBubble></li>
            {last && running ? (
              live.trim() ? <>
                <li aria-label="AI đang viết" className="grid gap-1.5 break-words px-0.5 text-sm leading-[1.6] text-ink animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
                  <Md text={live} />
                </li>
                <li><AiWriting /></li>
              </> : <li><AiThinking lines={THINKING} /></li>
            ) : t.analysis ? (
              <li>
                <AiResultCard aria-label="Tóm tắt và bước tiếp theo" took={t.took} dim={!last}
                  actions={last && missing && <Button type="button" size="xs" variant="outline" className="mr-auto" onClick={onMissing}><MessageCircleQuestion /> Hỏi thông tin còn thiếu</Button>}>
                  <Md text={t.analysis} />
                </AiResultCard>
              </li>
            ) : t.error ? (
              <li><AiResultCard error>{t.error}</AiResultCard></li>
            ) : t.error === "" && (
              <li role="status" className="flex items-center gap-1.5 px-0.5 text-xs text-ink-3 animate-in fade-in-0 duration-(--dur-short)">
                <Square className="size-3 fill-current" aria-hidden /> Đã hủy tóm tắt.
              </li>
            )}
          </Fragment>
        );
      })}
    </ul>
  );
}

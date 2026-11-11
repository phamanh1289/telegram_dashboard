"use client";

import { ArrowLeft, ArrowUp, Bot, Check, ChevronDown, ChevronUp, Copy, ExternalLink, FileSearch, Link2, Loader2, MessageCircleQuestion, Plus, Send, Sparkles, Square, TicketPlus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ModelEffortPicker, useAiPrefs } from "@/components/ai";
import { type AiSkill, AiIdle, AiPromptBox, AiSend, AiResultCard, AiThinking, AiWriting, UserBubble, useFollow } from "@/components/ai/chat";
import { Avatar } from "@/components/chat-list";
import { IssueDialog, TaskPage } from "@/components/composer-dialogs";
import { ProjectPicker, useProjects } from "@/components/project-picker";
import { Dialog, DialogContent, DIALOG_SHEET } from "@/components/ui/dialog";
import { useOpenSimilar } from "@/components/ticket-form";
import { DeepBadge, DeepPick } from "@/components/deep-think";
import { promiseChoice, RemindPick, remindAt } from "@/components/remind";
import { WorkTrail } from "@/components/work-trail";
import { Snippets } from "@/components/snippets";
import { groupMembers, useMention } from "@/components/mention";
import { ContextPanel, inline, MessageActions, richText } from "@/components/message-item";
import { ASK_BTN, Markdown } from "@/components/markdown";
import { SessionAsks, useTaskLog } from "@/components/tasks-feed";
import type { TaskEvent } from "@/components/ai/steps";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { onChanges } from "@/hooks/use-events";
import { api, ApiError, apiStream, errorText, type AiResult, type Message, type Outbox, type Task } from "@/lib/api";
import { copyText, draftKey, msgKey, remind, saveDraft, telegramLink, toast, useSessionOn } from "@/lib/inbox";
import { splitAttachments } from "@/lib/attach";
import { doneLoopMessage } from "@/lib/report-back";
import { timeLabel } from "@/lib/time";
import { getPref, put, readIntro, setPref, readPlatform, readReplyCode, saveReplyCode, useRole, usesCode, type YtRole } from "@/lib/prefs";
import { cn, MOD } from "@/lib/utils";
import { type Key, t as tNow, useT } from "@/lib/i18n";

const MAX = 4096; // UTF-16 code units == JS string length
// What "Tóm tắt" brings out and an example ask, per role (Cài đặt chung › Vai trò); the prompt side is ai.py ROLE_FOCUS.
const ROLE_AI: Record<YtRole, [string, Key]> = {
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

const SEND_ERROR_KEYS: Record<string, Key> = {
  not_tracking: "Nhóm không còn được theo dõi.",
  reply_not_found: "Tin đích không còn hoặc không thuộc nhóm này.",
  not_connected: "Chưa kết nối Telegram. Bản nháp vẫn được giữ.",
  forbidden: "Không có quyền gửi trong nhóm này.",
  request_payload_mismatch: "Nội dung đã đổi so với yêu cầu đang chờ.",
  retry_after: "Telegram yêu cầu chờ trước khi gửi tiếp.",
};
/** Send error texts, in the language at lookup time (for `errorText`). */
export const SEND_ERRORS: Record<string, string> = new Proxy(SEND_ERROR_KEYS, {
  get: (o, k) => (typeof k === "string" && k in o ? tNow(o[k]) : undefined),
});

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
  const t = useT();
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
  const [remindSet, setRemindSet] = useState(false); // picked by hand: the text's promise no longer decides
  useEffect(() => { // "Lời hứa": a promise in the reply sets the reminder (kept once the box clears after the send)
    if (!remindSet && text.trim()) setRemindAfter(promiseChoice(text)); // eslint-disable-line react-hooks/set-state-in-effect -- follows the typed text
  }, [text, remindSet]);
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
  // Every ask is a turn of the tag's saved Trợ lý AI session (AI Agent › Trợ lý AI): opening the tag again shows the
  // earlier ones, read once from its log; what this panel asks from then on stays in `turns`.
  const sessionQ = useSessionOn("assist", chatId, replyTo.message_id);
  const session = sessionQ.data;
  const savedLog = useTaskLog(session?.id ?? null, false);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !sessionQ.isSuccess || (session && !savedLog.isFetchedAfterMount)) return;
    seeded.current = true;
    const job = readJob(`replyJob:${msgKey(replyTo)}`); // its turn comes back by reading the job on
    const old = logTurns(savedLog.data?.items ?? []).filter((x) => !job || x.at < job.at - 5000);
    if (old.length) setTurns((l) => [...old, ...l]); // eslint-disable-line react-hooks/set-state-in-effect -- seeded once from the saved log
  }, [sessionQ.isSuccess, session, savedLog.isFetchedAfterMount, savedLog.data, replyTo]);
  const aiName = useAiPrefs().nameOf();
  const role = useRole();
  const [, example] = ROLE_AI[role ?? "dev"];
  const missing = role === "qa" ? askMissing(analysis) : "";
  const [picked, setPicked] = useState(0); // which AI option is in the textarea
  const [taskOpen, setTaskOpen] = useState(false); // the AI Agent sheet
  const [issueOpen, setIssueOpen] = useState(false); // YouTrack dialog
  const [aiPrompt, setAiPrompt] = useState("");
  // "Trả lời từ code": a project picked here, the AI answers the tag's question from its code (a Dev tool, like Giao AI Agent)
  const codeOn = aiConfigured && usesCode(role);
  const projects = useProjects();
  const [code, setCode] = useState(readReplyCode);
  const codeProject = codeOn ? projects.data?.find((p) => p.path === code) : undefined; // a removed folder reads as none
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
        setOutcome({ kind: "error", message: errorText(err, SEND_ERRORS, t("Gửi thất bại.")), until });
      } else {
        setOutcome({ kind: "unknown", reason: err instanceof ApiError ? t("Máy chủ local gặp lỗi khi gửi.") : t("Không liên lạc được máy chủ local.") });
      }
    },
  });

  const relKey = `aiRel:${replyTo.sender_id ?? "?"}`; // which of LEVELS the user is to this sender
  // Open tickets that look like this tag (YouTrack search, no AI), when it names none itself.
  const related = useOpenSimilar(replyTo.text, { enabled: youtrackConfigured && !TICKET_ID.test(replyTo.text) });

  // Tagged message (+ nearby context) + the user's prompt -> AI summary, next steps and reply options.
  // Aborting the request is the cancel: the server sees the browser go and kills the claude run.
  // "Trả lời từ code" takes minutes: it runs in the background (a server job saved per tag), so closing the panel only
  // stops reading it; opening the tag again reads it on. Hủy stops it for good.
  const askAbort = useRef<AbortController | null>(null);
  useEffect(() => () => askAbort.current?.abort(), []); // Esc / closing the reply unmounts: stop its run (a job: reading it)
  const jobKey = `replyJob:${msgKey(replyTo)}`;
  const ask = useMutation({
    mutationFn: ({ instruction, job, resume }: AskVars) => {
      askAbort.current = new AbortController();
      setPartial("");
      if (resume && job) return apiStream<AiResult>(`/ai/job/${job.id}`, undefined, askAbort.current.signal, setPartial);
      // progress questions: the tickets the tag names, then the open ones that look like it
      const tickets = codeProject && youtrackConfigured ? [...new Set([...(replyTo.text.match(TICKET_IDS) ?? []), ...(related.data ?? []).slice(0, 3).map((tk) => tk.id)])].slice(0, 10) : [];
      return apiStream<AiResult>("/ai/draft",
        { chat_id: chatId, message_ids: [replyTo.message_id], instruction, project: codeProject?.path ?? null, ticket_ids: tickets, with_context: true, platform: readPlatform(), role: role ?? "dev", intro: readIntro(), save: true },
        askAbort.current.signal, setPartial, job?.id);
    },
    onMutate: ({ instruction, job }) => {
      setTurns((l) => [...l, { prompt: instruction, at: job?.at ?? Date.now(), code: job?.code ?? codeProject?.name }]);
      setAiPrompt(""); // sent, like a chat; the ask stays in its bubble
    },
    onSettled: (_r, err) => {
      if (err?.name !== "AbortError") setPref(jobKey, null); // ended; an abort: Hủy clears it, a closed panel keeps it
      void qc.invalidateQueries({ queryKey: ["tasks"] }); // the session (made on the first ask) and its turn
    },
    onError: (err) => lastTurn((turn) => ({ ...turn, error: err.name === "AbortError" ? "" : errorText(err, {
      ai_agent_missing: t("Không tìm thấy {name} CLI để đọc dự án, xem Cài đặt › AI.", { name: aiName }),
      project_not_found: t("Dự án không còn trong danh sách, chọn lại dự án."),
      ai_job_gone: t("Lượt AI trước không còn trên máy chủ (app khởi động lại, hoặc xong quá 1 giờ): chạy lại."),
      task_busy: t("Phiên Trợ lý AI của tin này đang chạy một lượt khác (mở ở AI Agent), đợi xong rồi hỏi tiếp."),
      ai_cancelled: t("Đã dừng."),
      youtrack_unauthorized: t("Token YouTrack hết hạn hoặc thiếu quyền, xem Cài đặt › YouTrack."),
      youtrack_error: t("Không đọc được ticket YouTrack, thử lại sau."),
    }, t("AI lỗi hoặc quá thời gian; bạn vẫn có thể trả lời thủ công.")) })),
    onSuccess: (r) => {
      lastTurn((t) => ({ ...t, analysis: r.analysis, took: (Date.now() - t.at) / 1000 }));
      setAnalysis(r.analysis);
      setOptions(r.options.length > 1 ? r.options : []);
      // the relationship picked last time for this sender comes first in the textarea
      const rel = r.options.length === LEVELS.length ? Number(getPref(relKey) ?? 0) : 0;
      const i = rel >= 0 && rel < r.options.length ? rel : 0;
      setPicked(i);
      // hand edits in the box (a draft typed while the AI read the code) stay; the drafts wait on the cards
      if (!latest.current.trim() || options.includes(latest.current)) setText(r.options[i] ?? r.text);
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
      if (at) remind(replyTo, at).catch((e) => toast({ text: errorText(e, {}, t("Đã gửi, nhưng chưa đặt được nhắc lại")) }));
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
      setOutcome({ kind: "error", message: SEND_ERRORS[rec.error_code ?? ""] ?? t("Gửi thất bại.") });
    } else {
      setOutcome({
        kind: "unknown",
        reason: rec.status === "sending" ? t("Đang gửi…") : t("Chưa rõ Telegram đã nhận tin hay chưa."),
      });
    }
  }

  const pending = requestId !== null && outcome.kind === "unknown";
  const waitLeft = outcome.kind === "error" && outcome.until ? Math.max(0, Math.ceil((outcome.until - now) / 1000)) : 0;
  const fits = (body: string) => body.trim().length > 0 && body.length <= MAX;
  const ready = !send.isPending && !pending && waitLeft === 0 && !targetDeleted;
  const canSend = fits(text) && ready;

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
      toast({ text: t("Không lưu được nháp trên trình duyệt này: bấm Esc lần nữa để bỏ nội dung") });
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
    if (!fits(body) || !ready) return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    unsure.current = true;
    saveDraft(replyTo, ""); // back if the send fails (handle / onError)
    setOutcome({ kind: "idle" });
    send.mutate({ id, retryUnknown: false, text: mention.wire(body) });
  }

  const link = telegramLink(replyTo);
  const name = replyTo.sender_name ?? `#${replyTo.message_id}`;
  const insert = (line: string) => setText((cur) => (cur.trim() ? `${cur}\n${line}` : line));
  const tools = (aiConfigured && usesCode(role)) || youtrackConfigured;
  // What the idle assistant shows it can do here: only the tools this panel offers.
  const skills: AiSkill[] = codeProject ? ["answer", "reply", ...(youtrackConfigured ? ["ticket" as const] : []), "code"]
    : ["summary", "steps", "reply", ...(youtrackConfigured ? ["ticket" as const] : []), ...(usesCode(role) ? ["code" as const] : [])];
  const { ref: feedRef, onScroll: onFeedScroll } = useFollow(`${partial.length}:${options.length}`, turns.length); // follows the AI's writing unless scrolled up
  const runAsk = () => {
    if (ask.isPending || targetDeleted || pending) return;
    const instruction = aiPrompt.trim();
    const job = codeProject ? { id: crypto.randomUUID(), code: codeProject.name, prompt: instruction, at: Date.now() } : undefined;
    if (job) setPref(jobKey, JSON.stringify(job));
    ask.mutate({ instruction, job });
  };
  const stopAsk = () => {
    const job = readJob(jobKey);
    if (job) api<void>(`/ai/job/${job.id}`, { method: "DELETE" }).catch(() => {}); // gone already: nothing to stop
    setPref(jobKey, null);
    askAbort.current?.abort();
  };
  // A run of this tag still on the server (the panel was closed): read it on.
  // Deferred a tick: React dev runs effects twice, and a cancelled timer starts nothing.
  const onOpen = useEffectEvent(() => {
    const job = readJob(jobKey);
    if (job && Date.now() - job.at > JOB_KEEP_MS) setPref(jobKey, null); // the server dropped it long ago
    else if (job && aiConfigured) ask.mutate({ instruction: job.prompt, job, resume: true });
  });
  useEffect(() => { const id = setTimeout(onOpen, 0); return () => clearTimeout(id); }, []);
  const askLabel = codeProject ? (analysis ? t("Hỏi code lại") : t("Trả lời từ code")) : analysis ? t("Tóm tắt lại") : t("Tóm tắt & gợi ý");
  const answerMode = !!turns.at(-1)?.code; // the drafts on screen answer from code: "Ngắn gọn" / "Đầy đủ"
  // The textarea holds hand edits (not one of the drafts): a draft's own Gửi would overwrite them, so it waits.
  const edited = !!text.trim() && !options.includes(text);
  const tag = (
    <article ref={toTag} aria-label={t("Tin được tag")} className="my-1 grid scroll-mt-16 gap-1 rounded-[var(--radius-input)] border-l-[3px] border-hl bg-hl-wash py-2.5 pr-3 pl-3">
      <span className="flex min-h-6 items-center gap-2 text-xs font-medium text-hl-2">
        <span>{replyTo.outgoing ? t("Bạn") : name}</span><span className="font-normal">{t("tag bạn")}</span>
        <DeepBadge m={replyTo} />
        <DeepPick m={replyTo} className="ml-auto" />
      </span>
      <p className="whitespace-pre-wrap break-words text-md leading-[1.6] text-ink">
        {replyTo.text ? richText(replyTo) : <i className="text-ink-3">{t("Tin không có chữ")}</i>}
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
      aria-label={t("Soạn trả lời")}
      data-composer
      className="@container grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-cotton"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* Back, who you answer, the actions on that tag. */}
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 sm:px-5">
        <Hint side="bottom" text={t("Quay lại danh sách (Esc)")}>
          <Button type="button" size="icon-sm" variant="ghost" onClick={onClearReply} disabled={pending} aria-label={t("Quay lại danh sách (Esc)")}>
            <ArrowLeft />
          </Button>
        </Hint>
        {onStep && (
          <span className="flex items-center">
            <Hint side="bottom" text={t("Tag trước (k, Alt+↑)")}>
              <Button type="button" size="icon-sm" variant="ghost" disabled={pending || send.isPending} onClick={() => onStep(-1)} aria-label={t("Tag trước")}><ChevronUp /></Button>
            </Hint>
            {position && <span className="px-0.5 font-mono text-xs text-ink-3 tabular-nums" aria-label={t("Tag {i} trên {n} đang chờ", { i: position[0], n: position[1] })}>{position[0]}/{position[1]}</span>}
            <Hint side="bottom" text={t("Tag tiếp theo (j, Alt+↓)")}>
              <Button type="button" size="icon-sm" variant="ghost" disabled={pending || send.isPending} onClick={() => onStep(1)} aria-label={t("Tag tiếp theo")}><ChevronDown /></Button>
            </Hint>
          </span>
        )}
        <Avatar name={name} className="size-9 text-sm" />
        <div className="grid min-w-0 flex-1 leading-tight">
          <h2 className="truncate text-base font-bold">{name}</h2>
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
        <Hint side="bottom" title={t("Mở Telegram")} text={link.exact ? t("Mở tin này trong app Telegram") : t("Mở nhóm trên Telegram Web (nhóm thường không có link tới từng tin)")}>
          <a href={link.app} {...(!link.exact && { target: "_blank", rel: "noreferrer" })} aria-label={t("Mở Telegram")}
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
            <Segmented id="composer-pane" label={t("Khung")} variant="card" value={pane} onChange={setPane}
              items={[{ value: "reply", label: <><Send className="size-3.5" aria-hidden />{t("Trả lời")}</> }, { value: "ai", label: <><Sparkles className="size-3.5" aria-hidden />{aiConfigured ? t("Trợ lý AI") : t("Công cụ")}</> }]} />
          </div>
        )}
        {/* The thread as it reads in the group: messages before, the tag in place, messages after. */}
        <div className={cn("grid content-start gap-3 px-4 py-5 sm:px-6 @3xl:col-start-1 @3xl:row-start-1 @3xl:overflow-y-auto", pane === "ai" && "@max-3xl:hidden")}>
          {targetDeleted && <p role="alert" className="rounded-[var(--radius-input)] bg-error-wash px-3 py-2 text-xs text-error">{t("Tin đích đã bị xóa.")}</p>}
          {showContext
            ? <ContextPanel m={replyTo} focus={tag} className="mt-0 max-h-none gap-3 overflow-visible bg-transparent p-0 text-sm" />
            : tag}
          <WorkTrail m={replyTo} />
        </div>

        <aside aria-label={t("Trợ lý")} className={cn("order-2 flex min-h-0 flex-1 flex-col border-t bg-paper-2 @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1 @3xl:border-t-0 @3xl:border-l",
          pane === "reply" && "@max-3xl:hidden")}>
          {/* Like an AI Agent session: header and conversation scroll, the prompt box stays pinned under them. */}
          <div ref={feedRef} onScroll={onFeedScroll}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 *:shrink-0 sm:px-6 @3xl:px-5">
          {/* One row: what this panel is, and short pill tools that act on the tag (wrap under it if the label runs long). */}
          {(aiConfigured || tools) && (
            <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1.5">
              <h3 className="mr-auto flex items-center gap-1.5 text-sm font-bold text-ink">
                {aiConfigured ? <><Sparkles className="size-4 text-hl" aria-hidden /> {t("Trợ lý AI")}</> : t("Công cụ")}
              </h3>
              {tools && (
                <div role="toolbar" aria-label={t("Công cụ")} className="flex gap-1">
                  {aiConfigured && usesCode(role) && (
                    <Hint side="bottom" title="AI Agent" text={t("Giao cho AI Agent làm trong một dự án (sửa bug, thêm tính năng…)")}>
                      <Button type="button" size="xs" variant="outline" className="rounded-full" aria-label="AI Agent" disabled={targetDeleted} onClick={() => setTaskOpen(true)}><Bot /> AI Agent</Button>
                    </Hint>
                  )}
                  {youtrackConfigured && (
                    <Hint side="bottom" title="YouTrack" text={t("Tạo ticket YouTrack từ tin này; link ticket được thêm vào trả lời")}>
                      <Button type="button" size="xs" variant="outline" className="rounded-full" aria-label="YouTrack" disabled={targetDeleted} onClick={() => setIssueOpen(true)}><TicketPlus /> {t("Tạo ticket")}</Button>
                    </Hint>
                  )}
                </div>
              )}
            </div>
          )}

          {!!related.data?.length && (
            <section aria-label={t("Ticket có vẻ liên quan")} className="grid grid-cols-1 gap-1.5">
              <h4 className="flex items-center gap-1.5 text-xs font-medium text-ink-3"><Link2 className="size-3.5" aria-hidden />{t("Ticket có vẻ liên quan")}</h4>
              <ul className="grid grid-cols-1 gap-1">
                {related.data.slice(0, 3).map((tk) => (
                  <li key={tk.id} className="flex min-h-9 items-center gap-2 rounded-lg border border-rule bg-cotton py-0.5 pr-0.5 pl-2 text-xs transition-colors duration-(--dur-micro) hover:border-rule-2">
                    <a href={`/youtrack/?ticket=${tk.id}`} title={tk.summary} className="flex min-w-0 flex-1 items-center gap-2 hover:[&>span:last-child]:underline">
                      <span className="shrink-0 rounded-md bg-hl-wash px-1.5 py-0.5 font-mono text-2xs font-medium text-hl-2">{tk.id}</span>
                      <span className="truncate text-ink">{tk.summary}</span>
                    </a>
                    <Hint side="bottom" text={t("Chèn link {id} vào trả lời", { id: tk.id })}>
                      <Button type="button" size="icon-xs" variant="ghost" aria-label={t("Chèn link {id} vào trả lời", { id: tk.id })} onClick={() => insert(`${tk.id}: ${tk.url}`)}>
                        <Plus />
                      </Button>
                    </Hint>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {aiConfigured && (
            <section aria-label={t("Trợ lý AI")} aria-busy={ask.isPending} className="grid grid-cols-[minmax(0,1fr)] gap-3">
              <AiTurns turns={turns} running={ask.isPending} partial={partial} missing={missing} onMissing={() => insert(missing)} session={session} />

              {options.length > 0 && !ask.isPending && (
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
                        onChange={() => {
                          // Edited by hand: add the new pick under it rather than overwrite the edits.
                          if (text.trim() && text !== options[picked]) {
                            insert(o);
                            toast({ text: t("Đã chèn mẫu dưới nội dung bạn đã sửa") });
                          } else setText(o);
                          setPicked(i);
                          if (options.length === LEVELS.length) put(relKey, String(i));
                        }}
                      />
                      <span className={cn("flex min-h-5 items-center gap-1.5 text-xs font-medium", picked === i ? "text-hl-2" : "text-ink-3")}>
                        {picked === i && <Check className="size-3.5 animate-in zoom-in-50 duration-(--dur-short)" aria-hidden />}
                        {answerMode && options.length === ANSWER_LEVELS.length ? t(ANSWER_LEVELS[i]) : options.length === LEVELS.length ? t(LEVELS[i]) : t.n("Mẫu {n}", { n: <span className="font-mono">{i + 1}</span> })}
                        <span className="ml-auto flex">
                          <Hint side="bottom" text={t("Copy bản nháp này")}>
                            <button type="button" aria-label={t("Copy bản nháp này")} className={DRAFT_BTN}
                              onClick={(e) => { e.preventDefault(); void copyText(o); }}><Copy className="size-3.5" aria-hidden /></button>
                          </Hint>
                          <Hint side="bottom" text={edited ? t("Ô soạn đang có nội dung bạn sửa: gửi từ ô soạn, hoặc xóa nó trước") : o.length > MAX ? t("Quá {n} ký tự, sửa trong ô soạn rồi gửi", { n: MAX }) : t("Gửi ngay bản nháp này, trả lời {name}", { name })}>
                            <button type="button" aria-label={t("Gửi bản nháp này")} aria-disabled={edited || !fits(o) || !ready} className={DRAFT_BTN}
                              onClick={(e) => { e.preventDefault(); if (edited || !fits(o) || !ready) return; setPicked(i); setText(o); submit(o); }}><Send className="size-3.5" aria-hidden /></button>
                          </Hint>
                        </span>
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
              <AiPromptBox id="ai-prompt" aria-label={t("Prompt cho AI")} maxLength={2000} value={aiPrompt} onChange={setAiPrompt} onSend={runAsk}
                running={ask.isPending} onStop={stopAsk} stopLabel={t("Hủy")} stopHint={t("Dừng AI (Hủy tóm tắt)")}
                placeholder={ask.isPending ? (turns.at(-1)?.code ? t("AI đang đọc code…") : t("AI đang tóm tắt…")) : codeProject ? t("Hỏi thêm về code (không bắt buộc). Ví dụ: {example}", { example: t("trả lời ngắn cho PO, không nêu tên file") }) : t("Thêm yêu cầu (không bắt buộc). Ví dụ: {example}", { example: t(example) })}
                tools={<>
                  {codeOn && (
                    <Hint side="bottom" title={t("Trả lời từ code")} text={t("Chọn dự án: AI đọc code trong đó để trả lời câu hỏi của tin này, kèm căn cứ file / hàm và 2 bản nháp trả lời. Không đọc code: tóm tắt & gợi ý như thường.")}>
                      <span className="inline-flex min-w-0">
                        <ProjectPicker value={codeProject?.path ?? ""} none="" chip className="max-w-40"
                          onChange={(path) => { setCode(path); saveReplyCode(path); }} />
                      </span>
                    </Hint>
                  )}
                  <ModelEffortPicker compact />
                </>}
                actions={!ask.isPending && (
                  <AiSend onClick={runAsk} disabled={targetDeleted || pending} label={askLabel} hint={`${askLabel} (Enter)`}
                    icon={aiPrompt.trim() ? <ArrowUp aria-hidden /> : codeProject ? <FileSearch aria-hidden /> : <Sparkles aria-hidden />} />
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
              aria-label={t("Nội dung trả lời")}
              data-reply
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
              placeholder={t("Trả lời {name}… (@ để tag, / để chèn mẫu)", { name })}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-2 pl-1.5">
              <span className="flex items-center gap-0.5">
                <Snippets open={snips} onOpenChange={setSnips} current={text}
                  vars={{ "tên": replyTo.sender_name ?? "", ticket: replyTo.text.match(TICKET_ID)?.[0] ?? "" }}
                  onInsert={(line) => { insert(line); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[data-reply]")?.focus()); }} />
                {!replyTo.outgoing && <RemindPick value={remindAfter} auto={!remindSet && !!remindAfter} onChange={(v) => { setRemindSet(true); setRemindAfter(v); }} />}
              </span>
              <div aria-live="polite" className="min-w-0 flex-1 text-xs leading-snug">
                {draftStale && <span role="status" className="text-warn">{t("Tin nguồn của bản nháp AI đã đổi; bản nháp có thể đã cũ.")} </span>}
                {outcome.kind === "sent" && <span className="text-ok">{t("Đã gửi.")}</span>}
                {outcome.kind === "unknown" && <span className="text-warn">{outcome.reason} {t("Thử lại sẽ dùng cùng yêu cầu, Telegram có thể đã nhận tin.")}</span>}
                {outcome.kind === "error" && <span className="text-error">{outcome.message}{waitLeft > 0 && ` ${t("Còn {n} giây.", { n: waitLeft })}`}</span>}
              </div>
              {text.length > 0 && (
                <span className={cn("shrink-0 font-mono text-xs tabular-nums", text.length > MAX ? "font-medium text-error" : "text-ink-3")}>
                  {text.length}/{MAX}
                </span>
              )}
              <Button type="submit" size="sm" aria-busy={send.isPending} disabled={!canSend} className="shrink-0 px-3">
                {send.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {send.isPending ? t("Đang gửi…") : t("Gửi")}
                <span aria-hidden className="ml-0.5 font-mono text-2xs font-normal opacity-70">{MOD}↵</span>
              </Button>
            </div>
          </div>
          {pending && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" aria-busy={check.isPending} disabled={check.isPending} onClick={() => requestId && check.mutate(requestId)}>
                {t("Kiểm tra")}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={send.isPending}
                onClick={() => requestId && send.mutate({ id: requestId, retryUnknown: true, text: mention.wire(text) })}>
                {t("Thử lại cùng yêu cầu")}
              </Button>
              <Button type="button" size="sm" variant="ghost"
                onClick={() => {
                  setRequestId(null);
                  setOutcome({ kind: "idle" });
                }}>
                {t("Bỏ theo dõi yêu cầu")}
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

const TICKET_ID = /\b[A-Z][A-Z0-9]+-\d+\b/;
const TICKET_IDS = new RegExp(TICKET_ID.source, "g");

/** QA: a reply asking for what the summary marked [cần bổ sung] ("**Môi trường:** [cần bổ sung]" → "Môi trường"). */
export function askMissing(analysis: string) {
  const lines = analysis.split("\n").filter((l) => /cần bổ sung/i.test(l));
  if (!lines.length) return "";
  const what = [...new Set(lines.map((l) => l.match(/\*\*([^*]+?):?\*\*/)?.[1]?.trim()).filter(Boolean))];
  return `Bạn bổ sung giúp mình ${what.length ? what.join(", ").toLowerCase() : "các thông tin còn thiếu (build, thiết bị / OS, bước tái hiện)"} để mình tái hiện và test nhé.`;
}

// The AI drafts come in this order (prompt in ai.py): who the user is to the person they answer.
const LEVELS: Key[] = ["Tôi là cấp trên", "Ngang cấp", "Trả lời cấp trên"];
const ANSWER_LEVELS: Key[] = ["Ngắn gọn", "Đầy đủ"]; // ai.py ANSWER_TASK
const DRAFT_BTN = cn(ASK_BTN, "aria-disabled:cursor-not-allowed aria-disabled:opacity-40"); // the AI Agent asks' copy / send look

/** A "Trả lời từ code" run on the server, saved per tag (the panel may close and open again). */
type SavedJob = { id: string; code: string; prompt: string; at: number };
type AskVars = { instruction: string; job?: SavedJob; resume?: boolean };
const JOB_KEEP_MS = 2 * 3600_000; // a run's start + ai.py JOB_KEEP (an ended run waits 1 h), with room for a long run
const readJob = (key: string): SavedJob | null => {
  try {
    return JSON.parse(getPref(key) ?? "null");
  } catch {
    return null;
  }
};

// error "": cancelled; code: the project read for it ("Trả lời từ code")
type Turn = { prompt: string; at: number; analysis?: string; took?: number; error?: string; code?: string };

const CODE_THINKING: Key[] = [
  "Đang đọc câu hỏi…",
  "Đang lục code dự án…",
  "Đang lần theo màn hình và API…",
  "Đang soi rule validate…",
  "Đang đối chiếu nghiệp vụ…",
  "Đang viết câu trả lời có căn cứ…",
];

const THINKING: Key[] = [
  "Đang đọc tin nhắn…",
  "Đang lục lại ngữ cảnh nhóm…",
  "Đang hỏi ý kiến con Android…",
  "Đang pha cà phê cho AI…",
  "Đang gọt câu trả lời cho lịch sự…",
  "Sắp xong rồi, đợi xíu nha…",
];

/** The panel's asks as a conversation: the ask in a bubble, then the AI thinking / writing, then the result card. */
function AiTurns({ turns, running, partial, missing, onMissing, session }: {
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
              </> : <li><AiThinking lines={(turn.code ? CODE_THINKING : THINKING).map((l) => t(l))} /></li>
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
function logTurns(items: TaskEvent[]): Turn[] {
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

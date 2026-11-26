"use client";

import { ArrowUp, FileSearch, Loader2, Send, Sparkles, TicketPlus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import { ModelEffortPicker, useAiPrefs } from "@/shared/components/ai";
import { AiBotIcon, AiIdle, AiPromptBox, AiSend, type AiSkill, useFollow } from "@/shared/components/ai/chat";
import { AiLocked, SetupTip } from "@/shared/components/ai/setup-tip";
import { AiOptions, AiTurns, type AskVars, askMissing, JOB_KEEP_MS, LEVELS, logTurns, readJob, RelatedTickets, TICKET_ID, TICKET_IDS, type Turn } from "@/features/telegram/components/composer-assist";
import { IssueDialog, TaskPage } from "@/features/telegram/components/composer-dialogs";
import { ReplyHead, TagCard } from "@/features/telegram/components/composer-head";
import { ProjectPicker, useProjects } from "@/shared/components/project-picker";
import { Dialog, DialogContent, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { useOpenSimilar } from "@/features/youtrack/components/ticket-form";
import { promiseChoice, RemindPick, remindAt } from "@/features/telegram/components/remind";
import { WorkTrail } from "@/features/telegram/components/work-trail";
import { Snippets } from "@/features/telegram/components/snippets";
import { useJoin, useMention } from "@/shared/components/mention";
import { useDocTag } from "@/features/docs/components/doc-tag";
import { groupMembers } from "@/features/telegram/lib/mentions";
import { ContextPanel } from "@/features/telegram/components/message/context-panel";
import { useTaskLog } from "@/features/telegram/components/tasks-feed";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { Segmented } from "@/shared/components/ui/segmented";
import { Textarea } from "@/shared/components/ui/textarea";
import { onChanges } from "@/features/telegram/hooks/use-events";
import { api, ApiError, apiStream, errorText, type AiResult, type Message, type Outbox } from "@/shared/lib/api";
import { draftKey, msgKey, remind, saveDraft, typing, useSessionOn } from "@/features/telegram/lib/inbox";
import { fitsSend, SEND_ERRORS, SEND_MAX, sendLost, sendLostText } from "@/features/telegram/lib/send";
import { toast } from "@/shared/lib/notifications";
import { getPref, put, readIntro, setPref, readPlatform, readReplyCode, saveReplyCode, useIntro, useRole, useSetupTips, usesCode, type YtRole } from "@/shared/lib/prefs";
import { cn, MOD } from "@/shared/lib/utils";
import { type Key, useT } from "@/shared/lib/i18n";

// An example ask per role (Cài đặt chung › Vai trò); what "Tóm tắt" brings out for it is the prompt's ROLE_FOCUS.
const ROLE_ASK: Record<YtRole, Key> = {
  dev: "trả lời lịch sự, hẹn chiều nay",
  qa: "hỏi thêm build và thiết bị để tái hiện",
  po: "chốt ưu tiên, hẹn trả lời trước thứ Sáu",
};

type Outcome =
  | { kind: "idle" }
  | { kind: "sent" }
  | { kind: "unknown"; reason: string }
  | { kind: "error"; message: string; until?: number };

export type DraftInjection = { result: AiResult; chatId: string; nonce: number };

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
  const { attach, ...mention } = useJoin(useMention(groupMembers(chatId), text, setText), useDocTag("telegram", text, setText)); // "@" tags, "#" a document's link
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
  const role = useRole(), intro = useIntro(), tips = useSetupTips();
  const example = ROLE_ASK[role ?? "dev"];
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
    onError: (err, v) => {
      // A coded answer is a rejection. No answer (or one the server could not word) may come after Telegram took the
      // message, so keep the request id: a retry then reuses it (retry_unknown) instead of sending twice.
      if (err instanceof ApiError && !sendLost(err, v.retryUnknown)) {
        setRequestId(null); // rejected => certainly not sent
        unsure.current = false;
        saveDraft(replyTo, latest.current);
        const until = err.retryAfter ? Date.now() + err.retryAfter * 1000 : undefined;
        const message = errorText(err, SEND_ERRORS, t("Gửi thất bại."));
        if (alive.current) setOutcome({ kind: "error", message, until });
        else toast({ text: message }); // the panel closed meanwhile: the draft is kept, say why it is still there
      } else if (!alive.current) {
        toast({ text: sendLostText() }); // nobody is left to show "Kiểm tra": at least say it may be out
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
    onError: (e) => toast({ text: errorText(e, {}, t("Không kiểm tra được, thử lại.")) }),
  });

  function handle(rec: Outbox) {
    if (rec.status === "sent") {
      unsure.current = false;
      latest.current = "";
      saveDraft(replyTo, ""); // also when it lands after the panel closed
      void qc.invalidateQueries({ queryKey: ["briefing-answered"] }); // …and a Briefing item citing it
      const at = remindAt(remindAfter); // "để mình check rồi báo": back on the list at that time (the pick at send)
      if (at) remind(replyTo, at).catch((e) => toast({ text: errorText(e, {}, t("Đã gửi, nhưng chưa đặt được nhắc lại")) }));
    } else if (rec.status === "failed") {
      unsure.current = false;
      saveDraft(replyTo, latest.current); // certainly not sent: keep the text, even when the panel already closed
    }
    if (!alive.current) { // the panel closed while it was sending: only a result that needs the user is said
      if (rec.status === "failed") toast({ text: SEND_ERRORS[rec.error_code ?? ""] ?? t("Gửi thất bại.") });
      else if (rec.status !== "sent") toast({ text: sendLostText() });
      return;
    }
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
  const ready = !send.isPending && !pending && waitLeft === 0 && !targetDeleted;
  const canSend = fitsSend(text) && ready;

  // Captured before the inbox's own Esc (which closes the reply): a send in flight holds it. A draft doesn't: it is saved.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const step = e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp") ? (e.key === "ArrowDown" ? 1 : -1) : 0;
    const jk = send.isPending && !typing(e) && "jk".includes(e.key.toLowerCase()); // the inbox's own next / previous tag
    if ((e.key !== "Escape" && !step && !jk) || document.querySelector("[role=dialog], [role=menu], [role=listbox]")) return; // an open dialog / menu goes first
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
    if (!fitsSend(body) || !ready) return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    unsure.current = true;
    saveDraft(replyTo, ""); // back if the send fails (handle / onError)
    setOutcome({ kind: "idle" });
    send.mutate({ id, retryUnknown: false, text: mention.wire(body) });
  }

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
  const pickOption = (i: number) => {
    // Edited by hand: add the new pick under it rather than overwrite the edits.
    if (text.trim() && text !== options[picked]) {
      insert(options[i]);
      toast({ text: t("Đã chèn mẫu dưới nội dung bạn đã sửa") });
    } else setText(options[i]);
    setPicked(i);
    if (options.length === LEVELS.length) put(relKey, String(i));
  };
  const tag = <TagCard m={replyTo} />;

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
      <ReplyHead m={replyTo} groupTitle={groupTitle} held={pending || send.isPending} onBack={onClearReply} onStep={onStep} position={position}
        showContext={showContext} onToggleContext={() => setShowContext((v) => !v)} onDone={onDone} />

      {/* Wide: conversation + reply box on the left, assistant on the right. Narrow: one scroll, reply box pinned at the bottom. */}
      <div className={cn("flex min-h-0 flex-col overflow-y-auto @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] @3xl:grid-rows-[minmax(0,1fr)_auto] @3xl:overflow-hidden",
        pane === "ai" && "@max-3xl:overflow-hidden")}>
        {/* Narrow: the reply or the assistant, so the AI prompt box stays pinned at the bottom of its pane. */}
        {(aiConfigured || tools || tips) && ( // no AI: the pane still opens on the locked assistant (how to set AI up)
          <div className="shrink-0 px-3 pt-2 @3xl:hidden">
            <Segmented id="composer-pane" label={t("Khung")} variant="bar" value={pane} onChange={setPane}
              items={[{ value: "reply", label: <><Send className="size-3.5" aria-hidden />{t("Trả lời")}</> }, { value: "ai", label: <><Sparkles className="size-3.5" aria-hidden />{aiConfigured || !tools ? t("Trợ lý AI") : t("Công cụ")}</> }]} />
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
                      <Button type="button" size="xs" variant="outline" className="rounded-full" aria-label="AI Agent" disabled={targetDeleted} onClick={() => setTaskOpen(true)}><AiBotIcon /> AI Agent</Button>
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

          {!!related.data?.length && <RelatedTickets items={related.data} onInsert={insert} />}

          {aiConfigured && (
            <section aria-label={t("Trợ lý AI")} aria-busy={ask.isPending} className="grid grid-cols-[minmax(0,1fr)] gap-3">
              <AiTurns turns={turns} running={ask.isPending} partial={partial} missing={missing} onMissing={() => insert(missing)} session={session} />

              {options.length > 0 && !ask.isPending && (
                <AiOptions options={options} picked={picked} answerMode={answerMode} name={name} edited={edited} ready={ready}
                  onPick={pickOption} onSend={(i) => { setPicked(i); setText(options[i]); submit(options[i]); }} />
              )}
              <SetupTip id="ai-intro" when={!!turns.length && !ask.isPending && !intro} tour="settings-ai-intro" go={t("Thêm giới thiệu")}
                text={t("AI chưa biết bạn làm gì, rành gì, cần gì nên đang đoán. Thêm Giới thiệu bản thân cho AI (có mẫu theo vai trò) để tóm tắt và bản nháp sát việc của bạn hơn.")} />
            </section>
          )}
          {aiConfigured && !turns.length && <AiIdle skills={skills} className="flex-1" />}
          {!aiConfigured && <AiLocked title={t("Trợ lý AI")} className="my-auto"
            what={t("Tóm tắt tin và cả luồng, gợi ý bản trả lời theo vai trò người nhận, chỉ ra thông tin còn thiếu; với Dev còn trả lời từ code dự án và giao việc cho AI Agent.")} />}
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
            {mention.top}
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
                <span className={cn("shrink-0 font-mono text-xs tabular-nums", text.length > SEND_MAX ? "font-medium text-error" : "text-ink-3")}>
                  {text.length}/{SEND_MAX}
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
                  unsure.current = false; // let go on purpose: the text is a draft again (saved, kept on Esc)
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

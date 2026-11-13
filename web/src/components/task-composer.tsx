"use client";

import { type UseQueryResult, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, ListPlus, Loader2, Paperclip, RotateCw, TriangleAlert, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { Picks, useAiPrefs } from "@/components/ai";
import { AiPromptBox, AiSend } from "@/components/ai/chat";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import { type AiPicks, api, ApiError, apiStart, errorText, type Message, type Task } from "@/lib/api";
import { attach, chatTitle, MAX_REFS, messageQuery, parseRefs, type Ref, sameRef, setRefs, splitAttachments, takeConfirm, takeWantEdit, useConfirm, useRefs, useWantEdit, withAttachments } from "@/lib/attach";
import { readIntro, readPlatform, setPref, useAgentMcp, useRole } from "@/lib/prefs";
import { toast } from "@/lib/inbox";
import { timeLabel } from "@/lib/time";
import { cn, MOD } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// The follow-up box under an AI Agent session: queue, attached messages, paste, send, stop. Its own memoised component,
// so the session log's 1.5s poll doesn't re-render the textarea.

type Effort = AiPicks["effort"];

/** Model + effort for this session's next turns; until picked, the task picks in AI settings. */
function SessionAi({ t: task, disabled }: { t: Task; disabled: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { info, picks } = useAiPrefs();
  const save = useMutation({
    mutationFn: (ai: { model: string; effort: Effort }) => api<void>(`/tasks/${task.id}/ai`, { method: "PUT", json: ai }),
    onMutate: (ai) => qc.setQueryData<Task[]>(["tasks"], (l) => l?.map((x) => (x.id === task.id ? { ...x, ...ai } : x))),
    onError: (e) => toast({ text: errorText(e, {}, t("Không lưu được, thử lại")) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const c = info(task.provider ?? "claude");
  if (!c) return null;
  const k = picks(task.provider ?? "claude");
  const model = task.model ?? k.task_model;
  const effort = (task.effort ?? k.task_effort) as Effort;
  return (
    <Hint text={t("{name} cho phiên này, áp dụng từ lượt nhắn tiếp", { name: c.name })} side="bottom">
      <span role="group" aria-label={t("{name}: model và effort cho phiên này", { name: c.name })}
        className={cn("flex min-w-0 items-center gap-2", disabled && "pointer-events-none opacity-50", save.isError && "[&_button]:border-error")}>
        <Picks c={c} label={t("phiên này")} model={model} effort={effort} modelClass="w-28"
          variant="short" onModel={(m) => save.mutate({ model: m, effort })} onEffort={(e) => save.mutate({ model, effort: e })} />
      </span>
    </Hint>
  );
}

// Queued prompts per task, kept outside the panel so switching sessions doesn't drop them.
// ponytail: client-only, drains only while that session is open and lost on reload; move server-side if that matters.
type Queued = { line: string; refs: Ref[] }; // refs: sent along so Done on the session ticks them too
const queues = new Map<string, Queued[]>();

/** One attached message above the composer: who and when, two lines of it; or why it can't be read. */
function AttachChip({ r, q, other, onRemove }: { r: Ref; q: UseQueryResult<Message>; other: boolean; onRemove: () => void }) {
  const t = useT();
  const m = q.data;
  const qc = useQueryClient();
  return (
    <li className="flex max-w-64 items-start gap-1.5 rounded-lg border border-rule bg-paper-2 py-1 pr-0.5 pl-2 text-xs animate-in fade-in-0 zoom-in-95 duration-(--dur-short)">
      <Paperclip className="mt-0.5 size-3 shrink-0 text-ink-3" aria-hidden />
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1 text-ink-2">
          <span className="shrink-0 font-mono text-ink-3 tabular-nums">#{r.message_id}</span>
          {m && <><span className="truncate font-medium">{m.outgoing ? t("Bạn") : (m.sender_name ?? "?")}</span><span className="shrink-0 text-ink-3">{timeLabel(m.date)}</span></>}
        </span>
        {q.isPending ? <span className="inline-flex items-center gap-1 text-ink-3"><Loader2 className="size-3 animate-spin" aria-hidden /> {t("Đang tìm tin…")}</span>
          : q.isError ? <span className="text-error">{errorText(q.error, { not_connected: t("Chưa kết nối Telegram"), message_not_found: t("Không tìm thấy tin") }, t("Không tìm thấy tin")).trim()}</span>
          : <span className="line-clamp-2 text-ink-3">{other && <span className="text-ink-2">{chatTitle(qc, r.chat_id) ?? t("Nhóm khác|một")}: </span>}{m?.text || (m?.media_kind ? `[${m.media_kind}]` : "")}</span>}
      </span>
      <Button type="button" size="icon-xs" variant="ghost" aria-label={t("Bỏ tin #{id}", { id: r.message_id })} onClick={onRemove}><X /></Button>
    </li>
  );
}

/** The follow-up composer of a headless session (queue, attachments, send / stop). */
/** `cut`: the last turn ended in an error (stopped, server restarted): a one-click "go on". */
export const TaskComposer = memo(function TaskComposer({ t: task, cut }: { t: Task; cut?: boolean }) {
  const t = useT();
  const { id } = task;
  const running = !!task.running;
  const assist = task.kind === "assist"; // Trợ lý AI: no project; its turns run as the reply panel's asks
  const plan = task.mode === "plan" && !assist;
  const role = useRole();
  const qc = useQueryClient();
  const stop = useMutation({ mutationFn: () => api<void>(`/tasks/${id}/stop`, { method: "POST" }), onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(false); // plan task: let the next turns edit files (approve the plan)
  const wanted = useWantEdit(id); // a message attached from a row: ticked for the user
  const edit = picked || wanted;
  const setEdit = (v: boolean) => { takeWantEdit(id); setPicked(v); }; // unticked, or sent: the user's own from now
  // An edit turn uses the user's own MCP servers / plugins (outside the sandbox), on every CLI: on until unticked, remembered.
  const mcpOn = useAgentMcp();
  const canMcp = !assist && (task.mode === "edit" || (plan && edit));
  const mcp = canMcp && mcpOn;
  // Messages pasted (ID / t.me link) or sent here from a message row: quoted under the typed text on send.
  const refs = useRefs(id);
  // Text written by others in the session: what this turn may do with it, on a warning icon beside the boxes
  const others = !!task.chat_id || refs.length > 0 || /https?:\/\//.test(task.prompt);
  const warn = !others ? "" : [
    plan && edit && t("Phiên này có tin / link do người khác viết: lượt sau được sửa file và chạy lệnh (trong sandbox, chỉ mạng tới kho package). Đọc kỹ plan trước khi duyệt."),
    mcp && t("Lượt này AI được gọi MCP / plugin của bạn ngoài sandbox (có thể ghi lên YouTrack, mở trình duyệt, gọi mạng). Tin / link do người khác viết trong phiên có thể lái AI dùng chúng: chỉ bật khi bạn tin nội dung phiên."),
  ].filter(Boolean).join(" ");
  // An answer attached from a "#QA_PO_…" thread: "PO đã confirm. Hãy trace…" added to the prompt once, the user's text after that.
  const confirmed = useConfirm(id);
  useEffect(() => {
    if (!confirmed.length) return;
    const line = t("{role} đã confirm. Hãy trace code base, fix hoặc refactor.", { role: confirmed.join(", ") });
    if (!assist) setText((cur) => (cur.includes(line) ? cur : [cur.trim(), line].filter(Boolean).join("\n"))); // eslint-disable-line react-hooks/set-state-in-effect -- consumes an attach from a row, once
    takeConfirm(id); // Trợ lý AI: dropped, it has no code to trace
  }, [confirmed, id, t, assist]);
  const looked = useQueries({ queries: refs.map(messageQuery) });
  const resolving = looked.some((r) => r.isPending);
  const failed = looked.some((r) => r.isError); // a dangling "[#id]" mark: the AI would get no quote for it
  const line = withAttachments(text.trim(), looked.flatMap((r) => (r.data ? [r.data] : [])), task.chat_id, (c) => chatTitle(qc, c));
  const ready = !!line && !resolving && !failed;
  /** Clear what went out, not what was typed or attached while the send was pending. */
  const sentOnly = (s: string, r: Ref[]) => () => {
    setText((cur) => (cur === s ? "" : cur));
    setRefs(id, attach(id, []).filter((x) => !r.some((y) => sameRef(x, y)))); // attach(id, []): the draft as it is now
  };
  const send = useMutation({
    mutationFn: ({ line, refs }: Queued & { queued?: boolean }) => {
      if (!assist) return api<void>(`/tasks/${id}/message`, { method: "POST", json: { text: line, refs, edit: plan && edit, mcp } });
      // the AI reads attached messages as group messages, so only the session's group (its tag first)
      if (refs.some((r) => r.chat_id !== task.chat_id)) throw new ApiError(422, "assist_other_chat", null, null);
      return apiStart("/ai/draft", {
        chat_id: task.chat_id, message_ids: [task.message_id, ...refs.map((r) => r.message_id)], instruction: splitAttachments(line)[0],
        shown: line, save: true, with_context: true, platform: readPlatform(), role: role ?? "dev", intro: readIntro(),
      });
    },
    // Awaited so the mutation stays pending until the task list shows the new turn running: the queue can't fire twice.
    // Here, not per-mutate, so a sent queued prompt leaves the queue even if the panel unmounted meanwhile.
    onSuccess: async (_, { queued }) => {
      if (queued) setQueue((q) => q.slice(1));
      void qc.invalidateQueries({ queryKey: ["task-events", id] });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const submit = () => {
    if (ready && !running && !send.isPending) { setEdit(edit); send.mutate({ line, refs }, { onSuccess: sentOnly(text, refs) }); }
  };
  // Cmd/Ctrl+Enter queues the prompt; queued prompts run one per turn, in order, once the AI is idle.
  const [queue, setQueueState] = useState<Queued[]>(() => queues.get(id) ?? []);
  const setQueue = (f: (q: Queued[]) => Queued[]) => {
    const next = f(queues.get(id) ?? []);
    queues.set(id, next);
    setQueueState(next);
  };
  const enqueue = () => { if (ready) { if (send.isError) send.reset(); setQueue((q) => [...q, { line, refs }]); sentOnly(text, refs)(); } }; // reset: a new prompt retries a paused queue
  /** A paste of message IDs / links only: attach them and leave a "[#id]" mark at the caret, so the sentence still reads. */
  const paste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const add = parseRefs(e.clipboardData.getData("text"), task.chat_id);
    if (!add) return;
    e.preventDefault();
    const next = attach(id, add);
    const kept = add.filter((r) => next.some((x) => sameRef(x, r)));
    if (kept.length < add.length) toast({ text: t("Tối đa {n} tin đính kèm mỗi lượt", { n: MAX_REFS }) });
    if (!kept.length) return;
    const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd;
    const mark = kept.map((r) => `[#${r.message_id}]`).join(" ");
    const pad = a > 0 && !/\s/.test(text[a - 1]) ? " " : "";
    setText(text.slice(0, a) + pad + mark + " " + text.slice(b));
    const at = a + pad.length + mark.length + 1;
    requestAnimationFrame(() => el.setSelectionRange(at, at));
  };
  useEffect(() => {
    // Sent prompts leave the queue on success; a failed send stays first and pauses the queue until the next manual send.
    if (!running && !send.isPending && !send.isError && queue.length) send.mutate({ ...queue[0], queued: true });
  });
  const busy = send.error instanceof ApiError && send.error.code === "task_busy";

  return <>
    {queue.length > 0 && (
      <ol aria-label={t("Hàng đợi")} className="grid gap-1">
        {queue.map(({ line }, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-paper-2 px-2.5 py-1 text-xs text-ink-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
            <span className="shrink-0 font-mono tabular-nums text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate" title={line}>{line}</span>
            <Button size="icon-xs" variant="ghost" aria-label={t("Bỏ khỏi hàng đợi")} disabled={i === 0 && send.isPending} onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}><X /></Button>
          </li>
        ))}
      </ol>
    )}
    <AiPromptBox aria-label={t("Nhắn tiếp cho AI")} maxLength={assist ? 2000 : 8000} value={text} onChange={setText} onPaste={paste}
      onSend={submit} onModEnter={enqueue} running={running} onStop={() => stop.mutate()} stopping={stop.isPending}
      stopHint={t("Dừng AI (giữ hội thoại, có thể nhắn tiếp)")}
      placeholder={running ? t("AI đang làm: {mod}+Enter để thêm vào hàng đợi", { mod: MOD }) : t("Nhắn tiếp cho AI, dán ID hoặc link tin Telegram để đính kèm (Enter gửi, {mod}+Enter vào hàng đợi)", { mod: MOD })}
      // Attached messages win over "Chạy tiếp" (after Stop): sending them goes on with them; hiding them lost them.
      top={refs.length > 0 ? (
        <ul aria-label={t("Tin đính kèm")} className="flex flex-wrap gap-1.5">
          {refs.map((r, i) => <AttachChip key={`${r.chat_id}:${r.message_id}`} r={r} q={looked[i]} other={r.chat_id !== task.chat_id}
            onRemove={() => setRefs(id, refs.filter((x) => !sameRef(x, r)))} />)}
        </ul>
      ) : cut && !queue.length && !send.isPending && (
        <Button size="xs" variant="outline" className="justify-self-start animate-in fade-in-0 duration-(--dur-short)"
          onClick={() => send.mutate({ line: "Tiếp tục từ chỗ đã dừng.", refs: [] })}>
          <RotateCw /> {t("Chạy tiếp")}
        </Button>
      )}
      tools={<>
        {!assist && (
          <span className="inline-flex min-w-0 max-w-40 items-center gap-1 rounded-full bg-paper-2 px-2 py-1" title={task.project}>
            <FolderGit2 className="size-3.5 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{task.project.split("/").pop()}</span>
          </span>
        )}
        {plan && (
          <Hint text={t("Phiên đang ở chế độ chỉ đọc (plan). Bật để lượt nhắn tiếp được sửa file, ví dụ duyệt plan rồi bảo AI làm.")} side="bottom">
            <label className="flex items-center gap-1.5">
              <Checkbox checked={edit} onCheckedChange={(v) => setEdit(!!v)} disabled={running} />
              {t("Cho sửa code")}
            </label>
          </Hint>
        )}
        {canMcp && ( // an edit turn only: it shows once "Cho sửa code" is ticked
          <Hint text={t("Lượt sửa code dùng cả MCP server và plugin bạn đã cài cho CLI của phiên (Claude, Codex, Antigravity: YouTrack, markitdown, Zeplin…), như tự chạy CLI đó. Chúng chạy ngoài sandbox bằng đăng nhập của bạn; bỏ tick để tắt, app nhớ lựa chọn.")} side="bottom">
            <label className="flex items-center gap-1.5 animate-in fade-in-0 duration-(--dur-short)">
              <Checkbox checked={mcp} onCheckedChange={(v) => setPref("agentMcp", v ? null : "0")} disabled={running} />
              {t("Dùng MCP / plugin")}
            </label>
          </Hint>
        )}
        {warn && ( // in the row, not a line under the box: ticking a box never moves the page
          <Hint text={warn} side="bottom">
            <button type="button" aria-label={warn} className="grid size-6 place-items-center rounded-full text-warn hover:bg-warn-wash animate-in fade-in-0 duration-(--dur-short)">
              <TriangleAlert className="size-4" aria-hidden />
            </button>
          </Hint>
        )}
      </>}
      actions={<>
        {!assist && <SessionAi t={task} disabled={running} />}
        {running ? (
          <Hint text={t("Thêm vào hàng đợi, chạy khi AI xong lượt này ({mod}+Enter)", { mod: MOD })} side="bottom">
            <Button type="button" size="icon-sm" variant="outline" className="rounded-full" aria-label={t("Vào hàng đợi")} disabled={!ready} onClick={enqueue}><ListPlus /></Button>
          </Hint>
        ) : (
          <AiSend onClick={submit} disabled={!ready} busy={send.isPending || resolving} />
        )}
      </>} />
    {failed && <p role="alert" className="text-xs text-error">{t("Có tin đính kèm không đọc được: bỏ tin đó (×) rồi gửi.")}</p>}
    {send.isError && <p role="alert" className="text-xs text-error">{busy ? t("AI đang làm lượt trước.") : errorText(send.error, {
      assist_other_chat: t("Trợ lý AI chỉ đọc được tin trong nhóm của phiên: bỏ tin nhóm khác (×) rồi gửi."),
      ai_job_taken: t("AI đang làm lượt trước."),
    }, t("Gửi thất bại."))}</p>}
    {stop.isError && <p role="alert" className="text-xs text-error">{t("Không dừng được, thử lại.")}</p>}
  </>;
});

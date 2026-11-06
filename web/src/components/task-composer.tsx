"use client";

import { type UseQueryResult, useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, FolderGit2, ListPlus, Loader2, Paperclip, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { Picks, useAiPrefs } from "@/components/ai";
import { AiPromptBox } from "@/components/ai/chat";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import { type AiPicks, api, ApiError, errorText, type Message, type Task } from "@/lib/api";
import { attach, chatTitle, MAX_REFS, messageQuery, parseRefs, type Ref, sameRef, setRefs, useRefs, withAttachments } from "@/lib/attach";
import { toast } from "@/lib/inbox";
import { timeLabel } from "@/lib/time";
import { cn, MOD } from "@/lib/utils";

// The follow-up box under an AI Agent session: queue, attached messages, paste, send, stop. Its own memoised component,
// so the session log's 1.5s poll doesn't re-render the textarea.

type Effort = AiPicks["effort"];

/** Model + effort for this session's next turns; until picked, the task picks in AI settings. */
function SessionAi({ t, disabled }: { t: Task; disabled: boolean }) {
  const qc = useQueryClient();
  const { info, picks } = useAiPrefs();
  const save = useMutation({
    mutationFn: (ai: { model: string; effort: Effort }) => api<void>(`/tasks/${t.id}/ai`, { method: "PUT", json: ai }),
    onMutate: (ai) => qc.setQueryData<Task[]>(["tasks"], (l) => l?.map((x) => (x.id === t.id ? { ...x, ...ai } : x))),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const c = info(t.provider ?? "claude");
  if (!c) return null;
  const k = picks(t.provider ?? "claude");
  const model = t.model ?? k.task_model;
  const effort = (t.effort ?? k.task_effort) as Effort;
  return (
    <Hint text={`${c.name} cho phiên này, áp dụng từ lượt nhắn tiếp`} side="bottom">
      <span role="group" aria-label={`${c.name}: model và effort cho phiên này`}
        className={cn("flex min-w-0 items-center gap-2", disabled && "pointer-events-none opacity-50", save.isError && "[&_button]:border-error")}>
        <Picks c={c} label="phiên này" model={model} effort={effort} modelClass="w-28"
          variant="short" onModel={(m) => save.mutate({ model: m, effort })} onEffort={(e) => save.mutate({ model, effort: e })} />
      </span>
    </Hint>
  );
}

// Queued prompts per task, kept outside the panel so switching sessions doesn't drop them.
// ponytail: client-only, drains only while that session is open and lost on reload; move server-side if that matters.
const queues = new Map<string, string[]>();

/** One attached message above the composer: who and when, two lines of it; or why it can't be read. */
function AttachChip({ r, q, other, onRemove }: { r: Ref; q: UseQueryResult<Message>; other: boolean; onRemove: () => void }) {
  const m = q.data;
  const qc = useQueryClient();
  return (
    <li className="flex max-w-64 items-start gap-1.5 rounded-lg border border-rule bg-paper-2 py-1 pr-0.5 pl-2 text-xs animate-in fade-in-0 zoom-in-95 duration-(--dur-short)">
      <Paperclip className="mt-0.5 size-3 shrink-0 text-ink-3" aria-hidden />
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1 text-ink-2">
          <span className="shrink-0 font-mono text-ink-3 tabular-nums">#{r.message_id}</span>
          {m && <><span className="truncate font-medium">{m.outgoing ? "Bạn" : (m.sender_name ?? "?")}</span><span className="shrink-0 text-ink-3">{timeLabel(m.date)}</span></>}
        </span>
        {q.isPending ? <span className="inline-flex items-center gap-1 text-ink-3"><Loader2 className="size-3 animate-spin" aria-hidden /> Đang tìm tin…</span>
          : q.isError ? <span className="text-error">{errorText(q.error, { not_connected: "Chưa kết nối Telegram", message_not_found: "Không tìm thấy tin" }, "Không tìm thấy tin").trim()}</span>
          : <span className="line-clamp-2 text-ink-3">{other && <span className="text-ink-2">{chatTitle(qc, r.chat_id) ?? "Nhóm khác"}: </span>}{m?.text || (m?.media_kind ? `[${m.media_kind}]` : "")}</span>}
      </span>
      <Button type="button" size="icon-xs" variant="ghost" aria-label={`Bỏ tin #${r.message_id}`} onClick={onRemove}><X /></Button>
    </li>
  );
}

/** The follow-up composer of a headless session (queue, attachments, send / stop). */
export const TaskComposer = memo(function TaskComposer({ t }: { t: Task }) {
  const { id } = t;
  const running = !!t.running;
  const plan = t.mode === "plan";
  const qc = useQueryClient();
  const stop = useMutation({ mutationFn: () => api<void>(`/tasks/${id}/stop`, { method: "POST" }), onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
  const [text, setText] = useState("");
  const [edit, setEdit] = useState(false); // plan task: let the next turns edit files (approve the plan)
  // Messages pasted (ID / t.me link) or sent here from a message row: quoted under the typed text on send.
  const refs = useRefs(id);
  const looked = useQueries({ queries: refs.map(messageQuery) });
  const resolving = looked.some((r) => r.isPending);
  const failed = looked.some((r) => r.isError); // a dangling "[#id]" mark: the AI would get no quote for it
  const line = withAttachments(text.trim(), looked.flatMap((r) => (r.data ? [r.data] : [])), t.chat_id, (c) => chatTitle(qc, c));
  const ready = !!line && !resolving && !failed;
  /** Clear what went out, not what was typed or attached while the send was pending. */
  const sentOnly = (s: string, r: Ref[]) => () => {
    setText((cur) => (cur === s ? "" : cur));
    setRefs(id, attach(id, []).filter((x) => !r.some((y) => sameRef(x, y)))); // attach(id, []): the draft as it is now
  };
  const send = useMutation({
    mutationFn: ({ line }: { line: string; queued?: boolean }) =>
      api<void>(`/tasks/${id}/message`, { method: "POST", json: { text: line, edit: plan && edit } }),
    // Awaited so the mutation stays pending until the task list shows the new turn running: the queue can't fire twice.
    // Here, not per-mutate, so a sent queued prompt leaves the queue even if the panel unmounted meanwhile.
    onSuccess: async (_, { queued }) => {
      if (queued) setQueue((q) => q.slice(1));
      void qc.invalidateQueries({ queryKey: ["task-events", id] });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const submit = () => {
    if (ready && !running && !send.isPending) send.mutate({ line }, { onSuccess: sentOnly(text, refs) });
  };
  // Cmd/Ctrl+Enter queues the prompt; queued prompts run one per turn, in order, once the AI is idle.
  const [queue, setQueueState] = useState<string[]>(() => queues.get(id) ?? []);
  const setQueue = (f: (q: string[]) => string[]) => {
    const next = f(queues.get(id) ?? []);
    queues.set(id, next);
    setQueueState(next);
  };
  const enqueue = () => { if (ready) { if (send.isError) send.reset(); setQueue((q) => [...q, line]); sentOnly(text, refs)(); } }; // reset: a new prompt retries a paused queue
  /** A paste of message IDs / links only: attach them and leave a "[#id]" mark at the caret, so the sentence still reads. */
  const paste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const add = parseRefs(e.clipboardData.getData("text"), t.chat_id);
    if (!add) return;
    e.preventDefault();
    const next = attach(id, add);
    const kept = add.filter((r) => next.some((x) => sameRef(x, r)));
    if (kept.length < add.length) toast({ text: `Tối đa ${MAX_REFS} tin đính kèm mỗi lượt` });
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
    if (!running && !send.isPending && !send.isError && queue.length) send.mutate({ line: queue[0], queued: true });
  });
  const busy = send.error instanceof ApiError && send.error.code === "task_busy";

  return <>
    {queue.length > 0 && (
      <ol aria-label="Hàng đợi" className="grid gap-1">
        {queue.map((line, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-paper-2 px-2.5 py-1 text-xs text-ink-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
            <span className="shrink-0 font-mono tabular-nums text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate" title={line}>{line}</span>
            <Button size="icon-xs" variant="ghost" aria-label="Bỏ khỏi hàng đợi" disabled={i === 0 && send.isPending} onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}><X /></Button>
          </li>
        ))}
      </ol>
    )}
    <AiPromptBox aria-label="Nhắn tiếp cho AI" maxLength={8000} value={text} onChange={setText} onPaste={paste}
      onSend={submit} onModEnter={enqueue} running={running} onStop={() => stop.mutate()} stopping={stop.isPending}
      stopHint="Dừng AI (giữ hội thoại, có thể nhắn tiếp)"
      placeholder={running ? `AI đang làm: ${MOD}+Enter để thêm vào hàng đợi` : `Nhắn tiếp cho AI, dán ID hoặc link tin Telegram để đính kèm (Enter gửi, ${MOD}+Enter vào hàng đợi)`}
      top={refs.length > 0 && (
        <ul aria-label="Tin đính kèm" className="flex flex-wrap gap-1.5">
          {refs.map((r, i) => <AttachChip key={`${r.chat_id}:${r.message_id}`} r={r} q={looked[i]} other={r.chat_id !== t.chat_id}
            onRemove={() => setRefs(id, refs.filter((x) => !sameRef(x, r)))} />)}
        </ul>
      )}
      tools={<>
        <span className="inline-flex min-w-0 max-w-40 items-center gap-1 rounded-full bg-paper-2 px-2 py-1" title={t.project}>
          <FolderGit2 className="size-3.5 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{t.project.split("/").pop()}</span>
        </span>
        {plan && (
          <Hint text="Phiên đang ở chế độ chỉ đọc (plan). Bật để lượt nhắn tiếp được sửa file, ví dụ duyệt plan rồi bảo AI làm." side="bottom">
            <label className="flex items-center gap-1.5">
              <Checkbox checked={edit} onCheckedChange={(v) => setEdit(!!v)} disabled={running} />
              Cho sửa code
            </label>
          </Hint>
        )}
      </>}
      actions={<>
        <SessionAi t={t} disabled={running} />
        {running ? (
          <Hint text={`Thêm vào hàng đợi, chạy khi AI xong lượt này (${MOD}+Enter)`} side="bottom">
            <Button type="button" size="icon-sm" variant="outline" className="rounded-full" aria-label="Vào hàng đợi" disabled={!ready} onClick={enqueue}><ListPlus /></Button>
          </Hint>
        ) : (
          <Button type="button" size="icon-sm" aria-label="Gửi" aria-busy={send.isPending || resolving} disabled={!ready || send.isPending} onClick={submit}
            className="rounded-full bg-hl text-hl-ink hover:brightness-110">
            {send.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp />}
          </Button>
        )}
      </>} />
    {failed && <p role="alert" className="text-xs text-error">Có tin đính kèm không đọc được: bỏ tin đó (×) rồi gửi.</p>}
    {send.isError && <p role="alert" className="text-xs text-error">{busy ? "AI đang làm lượt trước." : "Gửi thất bại."}</p>}
    {stop.isError && <p role="alert" className="text-xs text-error">Không dừng được, thử lại.</p>}
  </>;
});

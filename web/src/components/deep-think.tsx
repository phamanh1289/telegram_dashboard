"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, BrainCircuit, CheckCheck, CornerDownRight, Loader2, Plus } from "lucide-react";
import { type ReactNode, useCallback, useState, useSyncExternalStore } from "react";
import { ModelEffortPicker } from "@/components/ai";
import { ProjectPicker, useProjects } from "@/components/project-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { IntroNotice } from "@/components/composer-dialogs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Message, type Task } from "@/lib/api";
import { getMessage, openTask, taskListQuery, toast } from "@/lib/inbox";
import { readAgentProject, readIntro, readPlatform, setPref } from "@/lib/prefs";
import { timeLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

// The answer to check, plus the question when the caller already knows it (a Briefing item cites both).
// Module state: rows, context panels, Digest rows and Briefing items open the one dialog.
type Target = { m: Message; q?: string };
let target: Target | null = null;
const subs = new Set<() => void>();
const open = (t: Target | null) => { target = t; subs.forEach((f) => f()); };
const useTarget = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => target, () => target);

/** The newest Đối chiếu BE session on this message (the task list is newest first), if any. */
function useDeepTaskAt(chatId: string, messageId: string | undefined) {
  // `select` + structural sharing: a row re-renders only when its own session changes, not on every task-list poll.
  const pick = useCallback((l: Task[]) => l.find((t) => t.kind === "deep" && t.chat_id === chatId && t.message_id === messageId), [chatId, messageId]);
  return useQuery({ ...taskListQuery, select: pick, enabled: !!messageId }).data;
}
export const useDeepTask = (m: Message) => useDeepTaskAt(m.chat_id, m.message_id);

const HINT = "AI đọc câu hỏi và câu trả lời của BE, rồi soi code dự án: đã làm đúng chưa, còn thiếu gì, cần sửa gì.";

/** Row button: check this message (BE's answer) against the code. Any message: a reply's question is picked for you. */
export function DeepPick({ m, className }: { m: Message; className?: string }) {
  const done = !!useDeepTask(m);
  const label = done ? "Đối chiếu BE lại" : "Đối chiếu BE";
  return (
    <Hint side="bottom" title={label} text={HINT}>
      <Button type="button" size="icon-xs" variant="ghost" className={cn(done && "text-ok", className)} aria-label={label}
        onClick={(e) => { e.stopPropagation(); open({ m }); }}>
        <BrainCircuit />
      </Button>
    </Hint>
  );
}

/** The session's state as a chip; opens it in AI Agent. */
function TaskChip({ t, className }: { t: Task; className?: string }) {
  return (
    <Hint side="bottom" title={t.running ? "Đang đối chiếu BE" : "Đã đối chiếu BE"} text="Bấm để xem kết quả ở AI Agent › Đối chiếu BE.">
      <button type="button" onClick={(e) => { e.stopPropagation(); openTask(t.id); }}
        className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-xs leading-5 font-medium transition-colors duration-(--dur-micro)",
          t.running ? "bg-info-wash text-info hover:bg-info/20" : "bg-ok-wash text-ok hover:bg-ok/20", className)}>
        {t.running ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <CheckCheck className="size-3" aria-hidden />}
        {t.running ? "Đang đối chiếu BE" : "Xem đối chiếu BE"}
      </button>
    </Hint>
  );
}

/** Always-visible mark on a message already checked (running or done); opens that session. */
export function DeepBadge({ m, className }: { m: Message; className?: string }) {
  const t = useDeepTask(m);
  return t ? <TaskChip t={t} className={className} /> : null;
}

/** Briefing / Digest item ("Đã chốt", "Thay đổi"): its cited messages, oldest = question, newest = BE's answer. */
export function DeepItemAction({ chatId, ids, className }: { chatId: string; ids: string[]; className?: string }) {
  const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
  const answer = sorted.at(-1);
  const t = useDeepTaskAt(chatId, answer);
  const load = useMutation({
    mutationFn: () => getMessage(chatId, answer!),
    onSuccess: (m) => open({ m, q: sorted.length > 1 ? sorted[0] : undefined }),
    onError: (e) => toast({ text: errorText(e, {}, "Không mở được tin gốc, thử lại sau") }),
  });
  if (!answer) return null;
  if (t) return <TaskChip t={t} className={cn("ml-1", className)} />;
  return (
    <Hint side="bottom" title="Đối chiếu BE" text={HINT}>
      <Button type="button" size="xs" variant="ghost" disabled={load.isPending} onClick={() => load.mutate()}
        className={cn("ml-1 h-5 px-1 text-ink-3 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3", className)}>
        {load.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <BrainCircuit aria-hidden />} Đối chiếu code
      </Button>
    </Hint>
  );
}

const who = (m: Message) => (m.outgoing ? "Bạn" : (m.sender_name ?? "?"));
const body = (m: Message) => m.text || (m.media_kind ? `[${m.media_kind === "photo" ? "ảnh" : "file"}]` : "");

/** Mounted once (inbox): the dialog for the clicked message. */
export function DeepThinking() {
  const t = useTarget();
  return t ? <DeepDialog key={`${t.m.chat_id}:${t.m.message_id}`} c={t.m} preset={t.q} onClose={() => open(null)} /> : null;
}

/** One message of the pair, as a card: what it is, who said it, all of its text. */
function Said({ m, label, tone, action, children }: {
  m?: Message; label: string; tone: string; action?: ReactNode; children?: ReactNode;
}) {
  return (
    <section aria-label={label} className="grid gap-1.5 rounded-[var(--radius-card)] border border-rule bg-cotton p-3">
      <header className="flex min-w-0 items-center gap-2 text-xs">
        <span className={cn("shrink-0 rounded-full px-2 leading-5 font-semibold", tone)}>{label}</span>
        {m && <b className="truncate font-semibold text-ink">{who(m)}</b>}
        {m && <span className="shrink-0 font-mono tabular-nums text-ink-3">{timeLabel(m.date)}</span>}
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </header>
      {children ?? (m && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{body(m)}</p>)}
    </section>
  );
}

function DeepDialog({ c, preset, onClose }: { c: Message; preset?: string; onClose: () => void }) {
  // Question candidates, live: the known question (however old) first, then the messages right before the answer.
  const known = preset ?? c.reply_to_id;
  const before = useQuery({
    queryKey: ["before", c.chat_id, c.message_id, known],
    queryFn: ({ signal }) => api<Message[]>(
      `/chats/${encodeURIComponent(c.chat_id)}/messages/${c.message_id}/before${known ? `?reply_to=${known}` : ""}`, { signal }),
    staleTime: 30_000,
  });
  const candidates = (before.data ?? []).filter((m) => m.text && m.message_id !== c.message_id);
  // No known question: the newest message from someone else is the best guess; the user can change it.
  const guess = known ?? candidates.find((m) => m.sender_id !== c.sender_id)?.message_id ?? candidates[0]?.message_id ?? null;
  const [chosen, setChosen] = useState<string | null>(null);
  const qId = chosen ?? guess;
  const q = candidates.find((m) => m.message_id === qId);
  const [picking, setPicking] = useState(false);
  const [project, setProject] = useState(readAgentProject);
  const projects = useProjects();
  const projectOk = !!projects.data?.some((p) => p.path === project);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const chooseProject = (p: string) => { setProject(p); setPref("agentProject", p); };
  // A read-only AI Agent session: it runs in the background; the message shows its state and opens it.
  const run = useMutation({
    mutationFn: () => api<{ id: string }>("/ai/deep", { method: "POST",
      json: { chat_id: c.chat_id, question_id: qId, confirm_id: c.message_id, project, instruction: note.trim(), platform: readPlatform(), intro: readIntro() } }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
      toast({ text: "Đang đối chiếu BE, xong sẽ có nhãn xanh trên tin", action: { label: "Xem", run: () => openTask(id) } });
    },
  });
  const showList = picking || (before.isSuccess && !q);
  const blocker = !q ? "Chọn tin hỏi" : !projectOk ? "Chọn dự án để AI đọc code" : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="ai-in flex max-h-[calc(100dvh-2.5rem)] flex-col gap-4 sm:max-w-xl">
        <div className="grid gap-1">
          <DialogTitle className="flex items-center gap-2"><BrainCircuit className="size-4 text-ink-3" aria-hidden /> Đối chiếu BE</DialogTitle>
          <DialogDescription>{HINT}</DialogDescription>
        </div>

        <div className="grid min-h-0 gap-1 overflow-y-auto">
          <Said m={showList ? undefined : q} label="1 · Câu hỏi" tone="bg-info-wash text-info"
            action={q && (
              <Button type="button" size="xs" variant="ghost" className="-my-1 h-6" onClick={() => setPicking((v) => !v)}>
                {picking ? "Giữ tin này" : "Đổi tin hỏi"}
              </Button>
            )}>
            {before.isPending ? (
              <p className="inline-flex items-center gap-1.5 text-sm text-ink-3"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Đang tìm câu hỏi…</p>
            ) : before.isError ? (
              <p role="alert" className="flex items-center gap-2 text-sm text-error">
                Không lấy được tin (cần đang kết nối Telegram).
                <Button type="button" size="xs" variant="outline" onClick={() => void before.refetch()}>Thử lại</Button>
              </p>
            ) : showList ? (
              <div className="grid gap-1.5">
                <p className="text-xs text-ink-3">Tin nào là câu hỏi gửi BE?</p>
                <ul aria-label="Chọn tin hỏi" className="grid max-h-64 gap-0.5 overflow-y-auto">
                  {candidates.map((m) => (
                    <li key={m.message_id}>
                      <button type="button" aria-pressed={m.message_id === qId} onClick={() => { setChosen(m.message_id); setPicking(false); }}
                        className={cn("grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-(--dur-micro) hover:bg-paper-3",
                          m.message_id === qId && "bg-hl-wash")}>
                        <span className="flex items-center gap-1.5 text-ink-3">
                          <b className="font-semibold text-ink">{who(m)}</b>
                          <span className="font-mono tabular-nums">{timeLabel(m.date)}</span>
                          {m.message_id === c.reply_to_id && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-hl-wash px-1.5 text-hl-2"><CornerDownRight className="size-3" aria-hidden /> được trả lời</span>
                          )}
                        </span>
                        <span className="line-clamp-2 text-sm text-ink">{m.text}</span>
                      </button>
                    </li>
                  ))}
                  {!candidates.length && <li className="px-2 text-sm text-ink-3">Không có tin nào trước tin này.</li>}
                </ul>
              </div>
            ) : undefined}
          </Said>
          <ArrowDown className="mx-auto size-4 text-ink-3" aria-hidden />
          <Said m={c} label="2 · BE trả lời" tone="bg-ok-wash text-ok" />
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink-2">Dự án</span>
            <ProjectPicker value={project} onChange={chooseProject} />
            {!noteOpen && (
              <Button type="button" size="xs" variant="ghost" className="ml-auto text-ink-3" onClick={() => setNoteOpen(true)}>
                <Plus aria-hidden /> Yêu cầu thêm
              </Button>
            )}
          </div>
          {noteOpen && (
            <Textarea autoFocus aria-label="Yêu cầu thêm" className="min-h-16 resize-none text-sm md:text-sm" maxLength={2000} value={note}
              onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: chỉ xét màn thanh toán" />
          )}
          <ModelEffortPicker kind="task" compact className="gap-x-2 text-xs" />
          <IntroNotice compact />
        </div>

        {run.isError && (
          <p role="alert" className="text-sm text-error">
            {errorText(run.error, {
              project_not_found: "Dự án không còn trong danh sách, hãy chọn lại.",
              ai_agent_missing: "Không tìm thấy AI CLI để đọc dự án, xem Cài đặt › AI.",
              ai_not_configured: "Chưa cấu hình AI, xem Cài đặt › AI.",
              message_not_found: "Không đọc được một trong hai tin (cần đang kết nối Telegram).",
              ai_context_too_large: "Hai tin quá dài.",
            }, "Không chạy được Đối chiếu BE.")}
          </p>
        )}

        <DialogFooter className="items-center">
          {blocker && !before.isPending && <span className="text-xs text-ink-3 sm:mr-auto">{blocker}</span>}
          <DialogClose render={<Button type="button" variant="outline" />}>Hủy</DialogClose>
          <Button type="button" aria-busy={run.isPending} disabled={!!blocker || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <BrainCircuit />} Phân tích
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

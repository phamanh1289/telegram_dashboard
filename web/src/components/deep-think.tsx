"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, CornerDownRight, Loader2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { ModelEffortPicker } from "@/components/ai";
import { ProjectPicker, useProjects } from "@/components/project-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type Message } from "@/lib/api";
import { openTask } from "@/lib/inbox";
import { readAgentProject, readPlatform, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";

// The BE answer the user clicked 🧠 on. Module state: rows, context panels and Digest rows open the one dialog.
let target: Message | null = null;
const subs = new Set<() => void>();
const open = (m: Message | null) => { target = m; subs.forEach((f) => f()); };
const useTarget = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => target, () => target);

/** Row button: Đối chiếu BE on this message as BE's confirmation; the message it replies to becomes the question. */
export function DeepPick({ m, className }: { m: Message; className?: string }) {
  if (!m.reply_to_id) return null; // not a reply: no question to compare against
  return (
    <Button type="button" size="icon-xs" variant="ghost" className={className}
      aria-label="Đối chiếu BE" title="Đối chiếu BE: tin này là BE confirm, tin nó trả lời là câu hỏi; AI trace code và đề xuất xử lý"
      onClick={(e) => { e.stopPropagation(); open(m); }}>
      <BrainCircuit />
    </Button>
  );
}

const who = (m: Message) => (m.outgoing ? "Bạn" : (m.sender_name ?? "?"));

/** Mounted once (inbox): the dialog for the clicked message. */
export function DeepThinking() {
  const c = useTarget();
  return c ? <DeepDialog key={`${c.chat_id}:${c.message_id}`} c={c} onClose={() => open(null)} /> : null;
}

function DeepDialog({ c, onClose }: { c: Message; onClose: () => void }) {
  // Question candidates, live: the replied message (however old) first, then the ones right before.
  const before = useQuery({
    queryKey: ["before", c.chat_id, c.message_id, c.reply_to_id],
    queryFn: ({ signal }) => api<Message[]>(
      `/chats/${encodeURIComponent(c.chat_id)}/messages/${c.message_id}/before${c.reply_to_id ? `?reply_to=${c.reply_to_id}` : ""}`, { signal }),
    staleTime: 30_000,
  });
  const [qId, setQId] = useState<string | null>(c.reply_to_id);
  const [picking, setPicking] = useState(false);
  const q = before.data?.find((m) => m.message_id === qId);
  const [project, setProject] = useState(readAgentProject);
  const projectOk = !!useProjects().data?.some((p) => p.path === project);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  // Runs as a read-only AI Agent session: the full page (tool log, follow-ups, stop / re-run) takes over from here.
  const run = useMutation({
    mutationFn: () => api<{ id: string }>("/ai/deep", { method: "POST",
      json: { chat_id: c.chat_id, question_id: qId, confirm_id: c.message_id, project, instruction: note, platform: readPlatform() } }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
      openTask(id);
    },
  });
  const showList = picking || (before.isSuccess && !q);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2.5rem)] flex-col sm:max-w-2xl">
        <DialogTitle className="flex items-center gap-2"><BrainCircuit className="size-4 text-ink-3" aria-hidden /> Đối chiếu BE</DialogTitle>
        <DialogDescription render={<div />}>
          AI đọc tin hỏi BE và tin BE confirm, so với code dự án: đã adapt chưa, còn thiếu gì, cần bổ sung hay thay đổi gì. Chạy thành phiên Chỉ đọc ở AI Agent › Đối chiếu BE.
        </DialogDescription>
        <dl className="grid gap-1.5 rounded-md bg-paper-2 p-2.5 text-xs">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <dt className="w-20 shrink-0 font-semibold text-ink-2">Hỏi BE:</dt>
            <dd className="min-w-0 flex-1 text-ink">
              {q ? <span className="line-clamp-2"><b className="font-medium">{who(q)}</b> · {q.text}</span>
                : before.isPending ? <span className="inline-flex items-center gap-1.5 text-ink-3"><Loader2 className="size-3 animate-spin" aria-hidden /> Đang lấy tin từ Telegram…</span>
                : before.isError ? <span className="text-error">Không lấy được tin (cần đang kết nối Telegram).</span>
                : <span className="text-ink-3">{c.reply_to_id ? "Không đọc được tin được trả lời; " : "Tin này không trả lời tin nào; "}chọn tin hỏi bên dưới.</span>}
            </dd>
            {q && <Button type="button" size="xs" variant="link" className="h-auto shrink-0 px-0" onClick={() => setPicking((v) => !v)}>{picking ? "Xong" : "Đổi"}</Button>}
          </div>
          {showList && (
            <ul aria-label="Chọn tin hỏi" className="ml-[5.375rem] grid max-h-56 gap-0.5 overflow-y-auto">
              {before.data?.filter((m) => m.text).map((m) => (
                <li key={m.message_id}>
                  <button type="button" onClick={() => { setQId(m.message_id); setPicking(false); }}
                    className={cn("grid w-full gap-0.5 rounded-sm px-2 py-1 text-left hover:bg-paper-3", m.message_id === qId && "bg-hl-wash")}>
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <b className="font-semibold text-ink">{who(m)}</b>
                      {m.message_id === c.reply_to_id && <span className="inline-flex items-center gap-0.5 rounded-full bg-hl-wash px-1.5 text-hl-2"><CornerDownRight className="size-3" aria-hidden /> được trả lời</span>}
                      <span className="ml-auto font-mono text-ink-3">#{m.message_id}</span>
                    </span>
                    <span className="line-clamp-2 text-ink">{m.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex min-w-0 gap-1.5">
            <dt className="w-20 shrink-0 font-semibold text-ink-2">BE confirm:</dt>
            <dd className="line-clamp-2 min-w-0 text-ink"><b className="font-medium">{who(c)}</b> · {c.text}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-3">Dự án</span>
          <ProjectPicker value={project} onChange={(p) => { setProject(p); setPref("agentProject", p); }} />
        </div>
        <Textarea aria-label="Yêu cầu thêm" className="min-h-16 resize-none text-sm md:text-sm" maxLength={2000} value={note}
          onChange={(e) => setNote(e.target.value)} placeholder="Yêu cầu thêm (không bắt buộc), ví dụ: chỉ xét màn thanh toán" />
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
        <DialogFooter>
          <ModelEffortPicker task className="sm:mr-auto" />
          <DialogClose render={<Button type="button" variant="outline" />}>Đóng</DialogClose>
          <Button type="button" aria-busy={run.isPending} disabled={!projectOk || !q || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <BrainCircuit />} Phân tích
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Bot, ChevronDown, Copy, Loader2, MessageSquarePlus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useTaskList } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { copyText, similar, type Ticket, yt } from "@/lib/yt";
import { Label, Markdown, StatePill } from "./bits";
import { useYt } from "./state";

// Ticket sheet extras: tickets that look like this one, and the AI Agent runs that mention it.

/** Tickets with a similar title in the loaded data; the AI can say which are real duplicates. */
export function Related({ t }: { t: Ticket }) {
  const y = useYt();
  const list = useMemo(() => similar(t, y.rows), [t, y.rows]);
  if (!list.length) return null;
  const ids = [t.id, ...list.map(([i]) => i.id)];
  const check = () => y.setSheet({ kind: "work", title: `AI · kiểm tra trùng ${t.id}`, ids, auto: {
    label: "AI đang so sánh",
    run: (sig) => yt.aiTickets(ids, `${t.id} và các ticket giống`, "ask", sig,
      `Ticket nào trong danh sách là TRÙNG với ${t.id} (cùng một việc), ticket nào chỉ LIÊN QUAN (nên link), ticket nào không liên quan? Mỗi dòng '- ID: trùng / liên quan / không, vì sao'. Cuối cùng đề xuất: gộp, link hay giữ riêng.`),
  } });
  return (
    <section className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Label>Ticket giống / liên quan ({list.length})</Label>
        {y.aiOn && <Button size="xs" variant="ghost" className="ml-auto" onClick={check}><Sparkles /> AI kiểm tra trùng</Button>}
      </div>
      {list.map(([i, score]) => (
        <button key={i.id} type="button" onClick={() => y.openTicket(i.id)} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-paper-2">
          <b className={cn("font-mono text-xs", i.resolved && "text-ink-3 line-through")}>{i.id}</b>
          <span className="truncate">{i.summary}</span>
          <span className="flex items-center gap-2"><StatePill state={i.state} /><span className="font-mono text-xs text-ink-3">{Math.round(score * 100)}%</span></span>
        </button>
      ))}
    </section>
  );
}

/** AI Agent runs (Telegram › AI Agent) whose prompt names every one of these tickets; a result can become a comment. */
export function LinkedTasks({ ids, onComment }: { ids: string[]; onComment?: (text: string) => void }) {
  const tasks = useTaskList();
  const key = ids.join();
  const res = useMemo(() => key.split(",").map((id) => new RegExp(`(^|[^A-Z0-9-])${id.replace(/[-]/g, "\\-")}(?![0-9])`)), [key]);
  const mine = (tasks.data ?? []).filter((t) => res.every((re) => re.test(t.prompt))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const [open, setOpen] = useState<string | null>(null);
  if (!mine.length) return null;
  return (
    <section className="grid gap-1.5">
      <Label><Bot className="size-3.5" />AI Agent ({mine.length})</Label>
      {mine.map((t) => {
        const isOpen = open === t.id;
        return (
          <div key={t.id} className="grid gap-1.5 rounded-lg bg-cotton p-2.5 shadow-edge">
            <button type="button" onClick={() => setOpen(isOpen ? null : t.id)} className="flex items-center gap-2 text-left text-xs">
              {t.running ? <Loader2 className="size-3.5 animate-spin text-hl-2" /> : <Bot className="size-3.5 text-ink-3" />}
              <span className="font-medium">{t.running ? "Đang chạy" : t.result ? "Đã xong" : "Không có kết quả"}</span>
              <span className="text-ink-3">{t.mode === "edit" ? "được sửa code" : "chỉ phân tích"} · {new Date(t.created_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}</span>
              <ChevronDown className={cn("ml-auto size-3.5 transition-transform", isOpen && "rotate-180")} />
            </button>
            {t.result && (
              <>
                <Markdown text={t.result} className={cn(!isOpen && "line-clamp-3")} />
                {isOpen && (
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button size="xs" variant="ghost" onClick={() => void copyText(t.result!)}><Copy /> Copy</Button>
                    {onComment && <Button size="xs" variant="outline" title="Điền kết quả vào ô bình luận để bạn sửa rồi gửi lên YouTrack"
                      onClick={() => { onComment(`Kết quả phân tích code (AI Agent):\n${t.result!.slice(0, 15000)}`); toast({ text: "Đã điền vào ô bình luận ở cuối, sửa rồi gửi" }); }}><MessageSquarePlus /> Đăng làm bình luận</Button>}
                    <Link href="/?chat=__tasks__" className="self-center px-2 text-xs text-ink-3">Mở AI Agent</Link>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

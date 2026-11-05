"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Bug, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useDeferredValue, useEffect, useRef, useState } from "react";
import { useAiPrefs } from "@/components/ai";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, type YouTrackIssue } from "@/lib/api";
import { getPref, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { yt } from "@/lib/yt";

// The one "create a ticket" form, for the YouTrack tab and the Telegram composer. Two ways in:
// Thủ công (type it) and AI (a rough note → summary, Type / Priority, templated description), then review and create.

export type TicketDraft = { summary: string; description: string; type?: string; priority?: string };
export type TicketMeta = { type: string; priority: string; assignee: string }; // "": leave unset
export type TicketValue = TicketMeta & { project: string; summary: string; description: string; markdown: boolean };
type Mode = "manual" | "ai";
type Format = "md" | "text";

/**
 * Markdown → readable plain text (what "Text thường" sends): marks dropped, lists as •, links as "text (url)".
 * ponytail: regex, not a parser; nested emphasis inside code can lose a *, fine for ticket prose.
 */
export const toPlain = (md: string) => md
  .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "──────────")
  .replace(/^[ \t]*```[^\n]*\n?/gm, "")
  .replace(/^[ \t]*\|[ \t|:-]*-[ \t|:-]*$\n?/gm, "")
  .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/gm, "$1")
  .replace(/^[ \t]*>[ \t]?/gm, "")
  .replace(/^([ \t]*)[-*+][ \t]+\[ \][ \t]+/gm, "$1☐ ")
  .replace(/^([ \t]*)[-*+][ \t]+\[[xX]\][ \t]+/gm, "$1☑ ")
  .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ")
  .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, "$2")
  .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t: string, u: string) => (t === u ? u : `${t} (${u})`))
  .replace(/`([^`\n]+)`/g, "$1")
  .replace(/(\*\*|__)(.+?)\1/g, "$2")
  .replace(/~~(.+?)~~/g, "$1")
  .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
  .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const readMode = (): Mode => (getPref("ticketMode") === "manual" ? "manual" : "ai");
const readFormat = (): Format => (getPref("ticketFormat") === "text" ? "text" : "md");
const opts = (vs: string[] | undefined, cur: string) => [...(cur && !vs?.includes(cur) ? [cur] : []), ...(vs ?? [])];
const fade = { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.16 } };

/** A field as a compact chip: quiet label, value, native select (keyboard and screen readers for free). */
function Pick({ label, value, onChange, empty, items }: {
  label: string; value: string; onChange: (v: string) => void; empty?: string; items: [string, string][];
}) {
  return (
    <label className={cn("flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-rule-2 bg-cotton pl-2.5 text-xs transition-colors duration-(--dur-micro) hover:border-ink-3 focus-within:border-hl",
      value && "border-hl/40 bg-hl-wash")}>
      <span className="shrink-0 text-ink-3">{label}</span>
      <select className="h-full min-w-0 flex-1 cursor-pointer truncate bg-transparent pr-1.5 font-medium text-ink outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        {empty != null && <option value="">{empty}</option>}
        {items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}

export function TicketForm({ title, hint, project: startProject, projects, initial, meta: startMeta, note: startNote = "", notePlaceholder, aiOn, aiContext, aiDraft,
  onSubmit, addTo, onOpenTicket, extra, demo }: {
  title: ReactNode;
  hint: string;
  project: string;
  projects?: string[]; // given: the project can be changed here
  initial: { summary: string; description: string };
  meta?: Partial<TicketMeta>;
  note?: string; // starts the AI tab's note
  notePlaceholder?: string;
  aiOn: boolean;
  aiContext?: ReactNode; // what the AI reads besides the note (the tagged message)
  aiDraft: (note: string, f: { types: string[]; priorities: string[]; project: string }, signal: AbortSignal) => Promise<TicketDraft>;
  onSubmit: (v: TicketValue) => Promise<unknown>;
  addTo?: (t: YouTrackIssue) => Promise<unknown>; // a duplicate: record this on that ticket instead
  onOpenTicket?: (id: string) => void;
  extra?: ReactNode;
  demo?: boolean; // mock data: nothing is written
}) {
  const [mode, setMode] = useState<Mode>(() => (aiOn ? readMode() : "manual"));
  const [format, setFormat] = useState<Format>(readFormat);
  const [view, setView] = useState<"write" | "preview">("write");
  const [project, setProject] = useState(startProject);
  const [summary, setSummary] = useState(initial.summary);
  const [desc, setDesc] = useState(initial.description);
  const [meta, setMeta] = useState<TicketMeta>({ type: "", priority: "", assignee: "", ...startMeta });
  const [note, setNote] = useState(startNote);
  const [drafted, setDrafted] = useState(0); // AI drafts so far: the manual tab re-enters on each
  const aiName = useAiPrefs().name;
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const fields = useQuery({ queryKey: ["yt", "fields", project], queryFn: () => yt.fields(project), staleTime: Infinity, enabled: !!project && !demo });
  const people = useQuery({ queryKey: ["yt", "people", project], queryFn: () => yt.people(project), staleTime: 10 * 60_000, enabled: !!project });
  const q = useDeferredValue(summary.trim());
  const similar = useQuery({
    queryKey: ["youtrack-similar", q, project],
    queryFn: ({ signal }) => api<YouTrackIssue[]>(`/youtrack/similar?q=${encodeURIComponent(q)}&project=${encodeURIComponent(project)}`, { signal }),
    enabled: q.length > 8 && !!project, staleTime: 60_000,
  });

  const draft = useMutation({
    mutationFn: () => {
      abort.current = new AbortController();
      return aiDraft(note.trim(), { types: fields.data?.Type ?? [], priorities: fields.data?.Priority ?? [], project }, abort.current.signal);
    },
    onSuccess: (r) => {
      if (r.summary) setSummary(r.summary);
      setDesc(r.description);
      setMeta((m) => ({ ...m, ...(r.type && { type: r.type }), ...(r.priority && { priority: r.priority }) }));
      setDrafted((n) => n + 1);
      setView("write");
      setMode("manual");
    },
  });
  const create = useMutation({
    mutationFn: () => onSubmit({ ...meta, project, summary: summary.trim(), markdown: format === "md", description: format === "md" ? desc : toPlain(desc) }),
  });
  const dup = useMutation({ mutationFn: (t: YouTrackIssue) => addTo!(t) });

  const pickMode = (m: Mode) => { setMode(m); setPref("ticketMode", m); };
  const pickFormat = (f: Format) => { setFormat(f); setPref("ticketFormat", f); };
  const pickProject = (p: string) => { setProject(p); setMeta({ type: "", priority: "", assignee: "" }); };
  const canDraft = !!note.trim() && !draft.isPending && !fields.isLoading;
  const canCreate = !!summary.trim() && !create.isPending && !demo;
  const primary = () => { if (mode === "ai") { if (canDraft) draft.mutate(); } else if (canCreate) create.mutate(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); primary(); } };
  const aiError = draft.isError && (draft.error as Error).name !== "AbortError" && errorText(draft.error, {
    ai_scope_not_allowed: "Tin này chưa được cấp quyền dùng AI.",
    ai_timeout: `${aiName} chạy quá lâu, thử lại.`,
    ai_provider_error: `${aiName} lỗi, kiểm tra đăng nhập ${aiName} trong Cài đặt.`,
  }, "AI chưa soạn được ticket.");

  return (
    <div className="contents" onKeyDown={onKey}>
      <header className="grid gap-3">
        <div className="grid gap-1 pr-10">
          <DialogTitle className="flex items-center gap-2"><Bug className="size-4 text-hl" aria-hidden />{title}</DialogTitle>
          <DialogDescription className="text-xs">{hint}</DialogDescription>
        </div>
        {aiOn && (
          <Segmented id="ticket-mode" label="Cách tạo ticket" value={mode} onChange={pickMode} className="justify-self-start"
            items={[{ value: "manual", label: "Thủ công" }, { value: "ai", label: <span className="flex items-center gap-1"><Sparkles className="size-3.5" aria-hidden />AI soạn</span> }]} />
        )}
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {mode === "ai" ? (
          <motion.section key="ai" aria-label="AI soạn ticket" className="grid gap-3"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
            {aiContext}
            <label className="grid gap-1.5 text-xs text-ink-3">{aiContext ? "Dặn thêm AI (không bắt buộc)" : "Kể cho AI vấn đề / yêu cầu"}
              <Textarea autoFocus rows={5} maxLength={8000} value={note} onChange={(e) => setNote(e.target.value)} disabled={draft.isPending}
                className="min-h-28 resize-none" placeholder={notePlaceholder} />
            </label>
            <p className="text-xs text-ink-3">AI viết tiêu đề, chọn Type / Priority và soạn mô tả theo mẫu (bug: bước tái hiện, kết quả mong đợi; feature: tiêu chí nghiệm thu). Bạn xem lại trước khi tạo.</p>
            <AnimatePresence>
              {draft.isPending && (
                <motion.div {...fade} role="status" className="grid gap-2 rounded-lg bg-paper-2 p-3">
                  <span className="flex items-center gap-2 text-xs text-ink-2"><Loader2 className="size-3.5 animate-spin" aria-hidden />{aiName} đang soạn…</span>
                  {[92, 70, 84, 55].map((w, i) => (
                    <motion.span key={w} className="h-2.5 rounded bg-paper-3" style={{ width: `${w}%` }}
                      animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }} />
                  ))}
                </motion.div>
              )}
              {aiError && <motion.p {...fade} role="alert" className="text-sm text-error">{aiError}</motion.p>}
            </AnimatePresence>
          </motion.section>
        ) : (
          <motion.section key={`manual-${drafted}`} aria-label="Nội dung ticket" className="grid gap-3"
            initial={{ opacity: 0, x: aiOn ? -16 : 0 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
            {drafted > 0 && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.2 }}
                className="flex items-center gap-2 rounded-lg bg-hl-wash px-3 py-2 text-xs text-ink-2">
                <Sparkles className="size-3.5 shrink-0 text-hl" aria-hidden />
                <span className="flex-1">{aiName} đã soạn xong. Xem lại tiêu đề, Type / Priority và mô tả rồi tạo.</span>
                <Button type="button" size="xs" variant="ghost" onClick={() => pickMode("ai")}><RotateCcw aria-hidden />Soạn lại</Button>
              </motion.div>
            )}
            <Input autoFocus={!drafted} aria-label="Tiêu đề ticket" maxLength={300} value={summary} onChange={(e) => setSummary(e.target.value)}
              placeholder="Tiêu đề: một dòng nêu vấn đề / yêu cầu" className="h-10 text-[0.9375rem] font-medium md:text-[0.9375rem]" />
            <AnimatePresence>
              {!!similar.data?.length && (
                <motion.section {...fade} aria-label="Ticket có thể trùng" className="grid gap-1 rounded-lg bg-warn-wash px-3 py-2 text-xs">
                  <span className="font-medium text-warn">Có ticket đang mở giống thế này, kiểm tra trước khi tạo:</span>
                  {similar.data.map((t) => (
                    <span key={t.id} className="flex items-center gap-2">
                      {onOpenTicket
                        ? <button type="button" onClick={() => onOpenTicket(t.id)} className="flex min-w-0 flex-1 gap-2 text-left text-ink-2 hover:text-ink"><b className="shrink-0 font-mono">{t.id}</b><span className="truncate">{t.summary}</span></button>
                        : <a href={t.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 gap-2 text-ink-2 hover:text-ink"><b className="shrink-0 font-mono">{t.id}</b><span className="truncate">{t.summary}</span></a>}
                      {addTo && <Button type="button" size="xs" variant="outline" disabled={dup.isPending || demo} onClick={() => dup.mutate(t)}>Ghi thêm vào đây</Button>}
                    </span>
                  ))}
                  {dup.isError && <p role="alert" className="text-error">{dup.error.message || "Không ghi được bình luận."}</p>}
                </motion.section>
              )}
            </AnimatePresence>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
              {projects && <Pick label="Project" value={project} onChange={pickProject} items={opts(projects, project).map((v) => [v, v])} />}
              <Pick label="Type" value={meta.type} empty="Mặc định" onChange={(v) => setMeta((m) => ({ ...m, type: v }))} items={opts(fields.data?.Type, meta.type).map((v) => [v, v])} />
              <Pick label="Priority" value={meta.priority} empty="Mặc định" onChange={(v) => setMeta((m) => ({ ...m, priority: v }))} items={opts(fields.data?.Priority, meta.priority).map((v) => [v, v])} />
              <Pick label="Assignee" value={meta.assignee} empty="Chưa assign" onChange={(v) => setMeta((m) => ({ ...m, assignee: v }))}
                items={[...(meta.assignee && !people.data?.some((p) => p.login === meta.assignee) ? [[meta.assignee, meta.assignee] as [string, string]] : []),
                  ...(people.data ?? []).map((p) => [p.login, p.name] as [string, string])]} />
            </div>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented id="ticket-desc-view" label="Mô tả" value={view} onChange={setView}
                  items={[{ value: "write", label: "Viết" }, { value: "preview", label: "Xem trước" }]} />
                <Segmented id="ticket-format" label="Định dạng gửi lên YouTrack" value={format} onChange={pickFormat}
                  items={[{ value: "md", label: "Markdown" }, { value: "text", label: "Text thường" }]} />
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {view === "write" ? (
                  <motion.div key="write" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                    <Textarea aria-label="Mô tả ticket" rows={10} maxLength={20000} value={desc} onChange={(e) => setDesc(e.target.value)}
                      className={cn("max-h-[40dvh] min-h-40 resize-none overflow-y-auto", format === "md" && "font-mono text-[0.8125rem] md:text-[0.8125rem]")}
                      placeholder={format === "md" ? "Mô tả (Markdown): ## Bước tái hiện, - danh sách, **đậm**…" : "Mô tả"} />
                  </motion.div>
                ) : (
                  <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
                    aria-label="Xem trước mô tả" className="max-h-[40dvh] min-h-40 overflow-y-auto rounded-md border border-rule px-3 py-2 text-[0.9375rem] leading-relaxed">
                    {!desc.trim() ? <p className="text-ink-3">Chưa có mô tả.</p>
                      : format === "md" ? <Markdown text={desc} /> : <p className="whitespace-pre-wrap">{toPlain(desc)}</p>}
                  </motion.div>
                )}
              </AnimatePresence>
              <p className="text-xs text-ink-3">
                {format === "md"
                  ? "YouTrack hiển thị Markdown: tiêu đề, danh sách, chữ đậm, bảng. Bấm Xem trước để xem ticket trông thế nào."
                  : "Gửi chữ thuần: bỏ ký hiệu Markdown (#, **, -, `) để YouTrack nào cũng đọc được. Xem trước để thấy bản sẽ gửi."}
              </p>
            </div>
            {extra}
            {create.isError && (
              <p role="alert" className="text-sm text-error">
                {errorText(create.error, {
                  youtrack_unauthorized: "YouTrack từ chối token (YOUTRACK_TOKEN).",
                  youtrack_project_not_found: "Không thấy project này trên YouTrack.",
                }, "Không tạo được ticket.")}
              </p>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <DialogFooter className="sticky -bottom-5 z-10 sm:items-center">
        <span aria-hidden className="mr-auto hidden font-mono text-[0.6875rem] text-ink-3 sm:inline">⌘↵ {mode === "ai" ? "AI soạn" : "tạo ticket"}</span>
        {mode === "ai" && draft.isPending
          ? <Button type="button" variant="outline" onClick={() => abort.current?.abort()}><X aria-hidden />Dừng</Button>
          : <DialogClose render={<Button type="button" variant="outline" />}>Hủy</DialogClose>}
        {mode === "ai" ? (
          <Button type="button" disabled={!canDraft} aria-busy={draft.isPending} onClick={() => draft.mutate()}>
            {draft.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} {draft.isPending ? "Đang soạn…" : "AI soạn ticket"}
          </Button>
        ) : (
          <Button type="button" disabled={!canCreate} aria-busy={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Bug aria-hidden />} {create.isPending ? "Đang tạo…" : "Tạo ticket"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { ArrowUp, Bug, Check, Link2, MessageSquarePlus, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useDeferredValue, useEffect, useRef, useState } from "react";
import { ModelEffortPicker, type RunKind, useAiPrefs } from "@/shared/components/ai";
import { AiBot, AiDots, AiPromptBox, AiResultCard } from "@/shared/components/ai/chat";
import { Markdown } from "@/shared/components/markdown";
import { Button } from "@/shared/components/ui/button";
import { DialogClose, DialogDescription, DialogTitle } from "@/shared/components/ui/dialog";
import { Dropdown, type DropdownOption } from "@/shared/components/ui/dropdown";
import { Hint } from "@/shared/components/ui/hint";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Textarea } from "@/shared/components/ui/textarea";
import { api, errorText, type YouTrackIssue } from "@/shared/lib/api";
import { getPref, setPref } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { resolveProject, yt, ytMeQuery, ytProjectsQuery } from "@/features/youtrack/lib/yt";
import { useMention } from "@/shared/components/mention";
import { ytPeople } from "@/features/youtrack/lib/mentions";
import { type Key, useT } from "@/shared/lib/i18n";

// The one "create a ticket" form, for the YouTrack tab and the Telegram composer. Two ways in:
// Thủ công (type it) and AI (a rough note → summary, Type / Priority, templated description), then review and create.

export type TicketDraft = { summary: string; description: string; type?: string; priority?: string };
export type TicketMeta = { type: string; priority: string; assignee: string }; // "": leave unset
export type TicketValue = TicketMeta & { project: string; summary: string; description: string; markdown: boolean };

/** The one create call (YouTrack tab and Telegram composer); `from`: the Telegram message it came from (photo attached). */
export const createTicket = (v: TicketValue, from?: { chat_id: string; message_id: string }) =>
  api<YouTrackIssue>("/youtrack/issues", { method: "POST", json: {
    summary: v.summary, description: v.description, markdown: v.markdown, project: v.project || null,
    type: v.type || null, priority: v.priority || null, assignee: v.assignee || null, ...from } });
/** The YouTrack project the app is on: the YouTrack tab's, else VA, else the first one. The one default for the ticket
 *  form, the comment dialog and the composer's related tickets (never "": the server then has no project to search). */
export function useYtProject(wanted?: string) {
  const projects = useQuery(ytProjectsQuery);
  return resolveProject(projects.data, wanted || getPref("project") || "VA");
}
/** Open tickets whose text matches free `text` (YouTrack's own search, server-side; no AI). The one lookup for text
 *  with no ticket list loaded: the ticket form, the composer, the comment dialog, the briefing. Same text + project =
 *  one shared cache entry. A ticket against the loaded tickets (YouTrack tab sheet) uses `similar` in lib/yt instead. */
export function useOpenSimilar(text: string, { project, enabled = true }: { project?: string; enabled?: boolean } = {}) {
  const fallback = useYtProject();
  const p = project ?? fallback;
  const q = text.trim().slice(0, 300);
  return useQuery({
    queryKey: ["youtrack-similar", q, p],
    queryFn: ({ signal }) => api<YouTrackIssue[]>(`/youtrack/similar?q=${encodeURIComponent(q)}&project=${encodeURIComponent(p)}`, { signal }),
    enabled: enabled && !!q && !!p, staleTime: 5 * 60_000,
  });
}
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

/** A field as a compact chip: quiet name, value, the app's Dropdown (keyboard and screen readers via base-ui Select). */
function Pick({ label, value, onChange, empty, items }: {
  label: string; value: string; onChange: (v: string) => void; empty?: string; items: DropdownOption[];
}) {
  const options = [...(empty != null ? [{ value: "", label: empty }] : []), ...items];
  return (
    <Dropdown label={label} value={value} onChange={onChange} options={options}
      prefix={<span className="shrink-0 font-normal text-ink-3">{label}</span>}
      className={cn(value && "border-hl/40 bg-hl-wash hover:bg-hl-wash")} />
  );
}

/**
 * Open tickets that may be related (close titles): a highlighted button beside Hủy / Tạo ticket, the list in a popover
 * above it, so the form keeps its room. Each: its ID opens it on YouTrack; if it is the same work, add this report to it.
 */
function Similar({ items, searching, onAdd, adding, error, failed }: {
  items?: YouTrackIssue[]; searching: boolean;
  onAdd?: (t: YouTrackIssue) => void; adding?: string; error?: string; failed?: string; // failed: the lookup itself
}) {
  const t = useT();
  if (!items?.length) {
    return searching
      ? <span role="status" className="flex items-center gap-1.5 text-xs text-ink-3"><Loader2 className="size-3.5 animate-spin" aria-hidden />{t("Đang tìm ticket liên quan…")}</span>
      : failed ? <span role="alert" className="text-xs text-error">{failed}</span> : null;
  }
  return (
    <Popover.Root>
      <Hint text={t("Ticket đang mở có thể liên quan tới ticket này: xem trước khi tạo")} side="bottom">
        <Popover.Trigger render={
          <Button type="button" variant="outline" key={items.length}
            className="border-warn/45 bg-warn-wash text-warn hover:bg-warn-wash hover:brightness-110 data-popup-open:border-warn animate-in zoom-in-90 fade-in-0 duration-(--dur-short)" />}>
          <Link2 aria-hidden />{t("{n} ticket liên quan", { n: items.length })}
          <span aria-hidden className="ml-0.5 size-1.5 rounded-full bg-warn ai-dot" />
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} className="z-50 outline-none">
          <Popover.Popup aria-label={t("Ticket có thể liên quan")}
            className="grid max-h-(--available-height) w-[30rem] max-w-[calc(100vw-2rem)] origin-(--transform-origin) grid-cols-1 gap-2 overflow-y-auto rounded-xl bg-cotton p-3 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <header className="grid gap-0.5 px-1">
              <Popover.Title className="flex items-center gap-1.5 text-sm font-bold text-ink"><Link2 className="size-4 text-warn" aria-hidden />{t("Có thể liên quan ({n})", { n: items.length })}</Popover.Title>
              <Popover.Description className="text-xs text-ink-3">
                {t("Ticket đang mở có tiêu đề gần với ticket bạn sắp tạo.")}{onAdd && ` ${t("Nếu là cùng một việc, thêm comment vào ticket đó thay vì tạo mới.")}`}
              </Popover.Description>
            </header>
            <ul className="grid grid-cols-1 gap-1">
              {items.map((tk) => (
                <li key={tk.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-(--dur-micro) hover:bg-paper-2">
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <a href={tk.url} target="_blank" rel="noopener noreferrer" aria-label={t("Mở {id} trên YouTrack", { id: tk.id })}
                      className="justify-self-start font-mono text-xs font-bold text-hl-2 underline-offset-4 hover:underline">{tk.id}</a>
                    <span className="line-clamp-2 text-xs leading-snug text-ink-2">{tk.summary}</span>
                  </span>
                  {onAdd && ( // only the Telegram dialog passes onAdd: the note speaks of its message
                    <Hint title={t("Thêm comment vào {id}", { id: tk.id })} side="bottom"
                      text={t("Gửi tin Telegram này (kèm link tin gốc) thành một comment trên ticket đó, rồi thêm link ticket vào khung trả lời. Không tạo ticket mới; phần bạn đang sửa trong form không được gửi.")}>
                      <Button type="button" size="xs" variant="outline" disabled={!!adding} aria-busy={adding === tk.id} aria-label={t("Thêm comment vào {id}", { id: tk.id })} onClick={() => onAdd(tk)} className="shrink-0">
                        {adding === tk.id ? <Loader2 className="animate-spin" aria-hidden /> : <MessageSquarePlus aria-hidden />}{t("Thêm comment")}
                      </Button>
                    </Hint>
                  )}
                </li>
              ))}
            </ul>
            {error && <p role="alert" className="px-1 text-xs text-error">{error}</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const LABEL = "text-xs font-medium text-ink-3";
const NO_META = { type: "", priority: "", assignee: null };
const DRAFT_LINES: Key[] = ["Đọc nội dung và ngữ cảnh", "Viết tiêu đề một dòng", "Chọn Type / Priority", "Soạn mô tả theo mẫu"];

/** While the AI drafts: the hopping robot, its steps ticking off (paced, not real progress), a ghost of the ticket. */
function Drafting({ name }: { name: string }) {
  const t = useT();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, DRAFT_LINES.length - 1)), 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <div role="status" className="grid gap-4 rounded-xl border border-rule bg-cotton p-4 shadow-stock animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)">
      <div className="flex items-center gap-3">
        <AiBot className="ai-hop size-9 shrink-0 drop-shadow-sm" />
        <span className="grid min-w-0 gap-0.5">
          <span className="ai-text truncate text-sm font-medium">{t("{name} đang soạn ticket", { name })}</span>
          <span className="text-xs text-ink-3">{t("Xong sẽ chuyển sang Thủ công để bạn xem lại")}</span>
        </span>
        <AiDots className="ml-auto" />
      </div>
      <ol className="grid gap-2 text-xs">
        {DRAFT_LINES.map((l, i) => (
          <li key={l} className={cn("flex items-center gap-2 transition-opacity duration-(--dur-short)", i > step && "opacity-50")}>
            {i < step ? <Check className="size-3.5 shrink-0 text-ok animate-in zoom-in-50 duration-(--dur-short)" aria-hidden />
              : i === step ? <Loader2 className="size-3.5 shrink-0 animate-spin text-hl" aria-hidden />
              : <span className="size-3.5 shrink-0 rounded-full border border-rule-2" aria-hidden />}
            <span className={i === step ? "ai-text font-medium" : i < step ? "text-ink-2" : "text-ink-3"}>{t(l)}</span>
          </li>
        ))}
      </ol>
      <Skeleton className="h-5 w-4/5" />
      <span className="flex gap-2">{[16, 20, 24].map((w) => <Skeleton key={w} className="h-6 rounded-md" style={{ width: `${w * 0.25}rem` }} />)}</span>
      <span className="grid gap-2">{[92, 70, 84, 55].map((w) => <Skeleton key={w} className="h-2.5" style={{ width: `${w}%` }} />)}</span>
    </div>
  );
}

export function TicketForm({ title, hint, project: startProject, initial, note: startNote = "", notePlaceholder, aiOn, aiKind, aiContext, aiDraft,
  onSubmit, addTo, extra, demo }: {
  title: ReactNode;
  hint: string;
  project?: string; // where it starts (default: the YouTrack tab's project); the YouTrack project list lets the user move it
  initial: { summary: string; description: string };
  note?: string; // starts the AI tab's note
  notePlaceholder?: string;
  aiOn: boolean;
  aiKind: RunKind; // whose model / effort the AI draft runs on
  aiContext?: ReactNode; // what the AI reads besides the note (the tagged message): the note is then optional
  aiDraft: (note: string, f: { types: string[]; priorities: string[]; project: string }, signal: AbortSignal) => Promise<TicketDraft>;
  onSubmit: (v: TicketValue) => Promise<unknown>;
  addTo?: (t: YouTrackIssue) => Promise<unknown>; // a related ticket that is the same work: record this on it instead
  extra?: ReactNode;
  demo?: boolean; // mock data: nothing is written
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>(() => (aiOn ? readMode() : "manual"));
  const [format, setFormat] = useState<Format>(readFormat);
  const [view, setView] = useState<"write" | "preview">("write");
  const [picked, setPicked] = useState<string | null>(null); // null: the default project
  const [summary, setSummary] = useState(initial.summary);
  const [desc, setDesc] = useState(initial.description);
  const [meta, setMeta] = useState<Omit<TicketMeta, "assignee"> & { assignee: string | null }>(NO_META); // assignee null: me
  const [note, setNote] = useState(startNote);
  const [drafted, setDrafted] = useState(0); // AI drafts so far: the manual tab re-enters on each
  const aiName = useAiPrefs().nameOf(aiKind);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  // Same defaults on both tabs: the project the YouTrack tab is on (VA, else the first), assigned to me.
  const projects = useQuery(ytProjectsQuery);
  const fallback = useYtProject(startProject);
  const me = useQuery(ytMeQuery);
  const project = picked ?? fallback;
  const assignee = meta.assignee ?? me.data?.login ?? "";
  const fields = useQuery({ queryKey: ["yt", "fields", project], queryFn: () => yt.fields(project), staleTime: Infinity, enabled: !!project && !demo });
  const people = useQuery({ queryKey: ["yt", "people", project], queryFn: () => yt.people(project), staleTime: 10 * 60_000, enabled: !!project });
  const { attach, ...mention } = useMention(ytPeople(project), desc, setDesc); // "@" in the description tags the team
  const q = useDeferredValue(summary.trim());
  const similar = useOpenSimilar(q, { project, enabled: q.length > 8 });

  const draft = useMutation({
    mutationFn: () => {
      abort.current = new AbortController();
      return aiDraft(note.trim(), { types: fields.data?.Type ?? [], priorities: fields.data?.Priority ?? [], project }, abort.current.signal);
    },
    onSuccess: (r) => {
      if (r.summary) setSummary(r.summary);
      setDesc(r.description);
      // what the user already picked wins; the AI fills the rest
      setMeta((m) => ({ ...m, ...(r.type && !m.type && { type: r.type }), ...(r.priority && !m.priority && { priority: r.priority }) }));
      setDrafted((n) => n + 1);
      setView("write");
      setMode("manual");
    },
  });
  const create = useMutation({
    mutationFn: () => onSubmit({ ...meta, assignee, project, summary: summary.trim(), markdown: format === "md", description: format === "md" ? desc : toPlain(desc) }),
  });
  const dup = useMutation({ mutationFn: (t: YouTrackIssue) => addTo!(t) });

  const pickMode = (m: Mode) => { setMode(m); setPref("ticketMode", m); };
  const pickFormat = (f: Format) => { setFormat(f); setPref("ticketFormat", f); };
  const pickProject = (p: string) => { setPicked(p); setMeta(NO_META); };
  // With a message to read the note is optional; without one (YouTrack tab) the note is all the AI has.
  const canDraft = (!!aiContext || !!note.trim()) && !draft.isPending && !fields.isLoading;
  const canCreate = !!summary.trim() && !create.isPending && !demo;
  const runDraft = () => { if (canDraft) draft.mutate(); };
  const primary = () => { if (mode === "ai") runDraft(); else if (canCreate) create.mutate(); };
  // the prompt box handles its own Enter (and marks it handled)
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) { e.preventDefault(); primary(); } };
  const aiError = draft.isError && (draft.error as Error).name !== "AbortError" && errorText(draft.error, {
    ai_scope_not_allowed: t("Tin này chưa được cấp quyền dùng AI."),
    ai_timeout: t("{name} chạy quá lâu, thử lại.", { name: aiName }),
    ai_provider_error: t("{name} lỗi, kiểm tra đăng nhập {name} trong Cài đặt.", { name: aiName }),
  }, t("AI chưa soạn được ticket."));
  // grid-cols-1 (minmax(0,1fr)) on grid sections: a long one-line text must truncate, not widen the column; a wider
  // column overflowed the scroller and autoFocus scrolled it sideways, cutting the tab off.
  const slide = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.18, ease: [0.2, 0, 0, 1] as const } };
  const setField = (k: keyof TicketMeta) => (v: string) => setMeta((m) => ({ ...m, [k]: v }));
  // Project / Type / Priority / Assignee, all read from YouTrack; the same row on both tabs.
  const attrs = (
    <fieldset className="grid gap-1.5">
      <legend className={cn(LABEL, "mb-1.5")}>{t("Thuộc tính")}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]">
        <Pick label="Project" value={project} onChange={pickProject}
          items={[...(project && !projects.data?.some((p) => p.shortName === project) ? [{ value: project, label: project }] : []),
            ...(projects.data ?? []).map((p) => ({ value: p.shortName, label: p.shortName, hint: p.name !== p.shortName ? p.name : undefined }))]} />
        <Pick label="Type" value={meta.type} empty={fields.isLoading ? t("Đang tải…") : t("Mặc định")} onChange={setField("type")} items={opts(fields.data?.Type, meta.type).map((v) => ({ value: v, label: v }))} />
        <Pick label="Priority" value={meta.priority} empty={fields.isLoading ? t("Đang tải…") : t("Mặc định")} onChange={setField("priority")} items={opts(fields.data?.Priority, meta.priority).map((v) => ({ value: v, label: v }))} />
        <Pick label="Assignee" value={assignee} empty={people.isLoading ? t("Đang tải…") : t("Chưa assign")} onChange={setField("assignee")}
          items={[...(assignee && !people.data?.some((p) => p.login === assignee) ? [{ value: assignee, label: assignee }] : []),
            ...(people.data ?? []).map((p) => ({ value: p.login, label: p.name, hint: p.login }))]} />
      </div>
      {fields.isError || projects.isError ? <p className="text-xs text-warn">{t("Không tải được dữ liệu YouTrack, các ô còn lại để mặc định.")}</p>
        : fields.isSuccess && !fields.data.Type?.length && !fields.data.Priority?.length
          && <p className="text-xs text-ink-3">{t("Project {project} không có Type / Priority trên YouTrack.", { project })}</p>}
    </fieldset>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKey}>
      <header className="grid gap-3 border-b border-rule bg-paper-2 px-5 pt-5 pb-4">
        <div className="grid gap-1 pr-10">
          <DialogTitle className="flex items-center gap-2"><Bug className="size-4 text-hl" aria-hidden />{title}</DialogTitle>
          <DialogDescription className="text-xs">{hint}</DialogDescription>
        </div>
        {aiOn && (
          <Segmented id="ticket-mode" label={t("Cách tạo ticket")} value={mode} onChange={pickMode} className="justify-self-start"
            items={[{ value: "ai", label: <span className="flex items-center gap-1"><Sparkles className="size-3.5" aria-hidden />{t("AI soạn")}</span> }, { value: "manual", label: t("Thủ công") }]} />
        )}
      </header>

      {/* Manual: the description fills what is left and is the one thing that scrolls; the body is clipped, never scrolled
          (overflow-clip: not even by autoFocus or the ai-in beam sliding past the bottom). */}
      <div className={cn("flex min-h-0 flex-1 flex-col px-5 py-5", mode === "ai" ? "overflow-x-hidden overflow-y-auto overscroll-contain" : "overflow-clip")}>
        <AnimatePresence mode="wait" initial={false}>
          {mode === "ai" ? (
            <motion.section key="ai" aria-label={t("AI soạn ticket")} className="grid grid-cols-1 gap-5" {...slide}>
              {aiContext}
              {attrs}
              <AnimatePresence mode="wait" initial={false}>
                {draft.isPending ? (
                  <motion.div key="busy" {...fade}><Drafting name={aiName} /></motion.div>
                ) : aiError ? (
                  <motion.div key="err" {...fade}><AiResultCard error title={t("Chưa soạn được")}>{aiError}</AiResultCard></motion.div>
                ) : null}
              </AnimatePresence>
            </motion.section>
          ) : (
            <motion.section key={`manual-${drafted}`} aria-label={t("Nội dung ticket")} className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-5", drafted > 0 && "relative ai-in")} {...slide}>
              {drafted > 0 && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.2 }}
                  className="flex items-center gap-2.5 rounded-xl border border-ok/25 bg-ok-wash px-3 py-2 text-xs text-ink-2">
                  <AiBot className="size-6 shrink-0" />
                  <span className="flex-1">{t("{name} đã soạn xong. Xem lại tiêu đề, thuộc tính và mô tả rồi tạo.", { name: aiName })}</span>
                  <Button type="button" size="xs" variant="ghost" onClick={() => pickMode("ai")}><RotateCcw aria-hidden />{t("Soạn lại")}</Button>
                </motion.div>
              )}
              <label className="grid gap-1.5">
                <span className={LABEL}>{t("Tiêu đề")}</span>
                <Input autoFocus={!drafted} maxLength={300} value={summary} onChange={(e) => setSummary(e.target.value)}
                  placeholder={t("Một dòng nêu vấn đề / yêu cầu")} className="h-10 text-md font-medium md:text-md" />
              </label>
              {attrs}
              <div className="flex min-h-40 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn(LABEL, "mr-auto")}>{t("Mô tả")}</span>
                  <Segmented id="ticket-desc-view" label={t("Mô tả")} value={view} onChange={setView}
                    items={[{ value: "write", label: t("Viết") }, { value: "preview", label: t("Xem trước") }]} />
                  <Segmented id="ticket-format" label={t("Định dạng gửi lên YouTrack")} value={format} onChange={pickFormat}
                    items={[{ value: "md", label: "Markdown" }, { value: "text", label: t("Text thường") }]} />
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  {view === "write" ? (
                    <motion.div key="write" className="relative flex min-h-0 flex-1 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                      {mention.popup}
                      <Textarea ref={attach} aria-label={t("Mô tả ticket")} maxLength={20000} value={desc}
                        onChange={(e) => { setDesc(e.target.value); mention.track(e); }} onSelect={mention.track} onKeyDown={mention.onKeyDown}
                        className={cn("min-h-24 flex-1 resize-none overflow-y-auto field-sizing-fixed", format === "md" && "font-mono text-sm md:text-sm")}
                        placeholder={format === "md" ? t("Mô tả (Markdown): ## Bước tái hiện, - danh sách, **đậm**, @ để tag…") : t("Mô tả (@ để tag người)")} />
                    </motion.div>
                  ) : (
                    <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
                      aria-label={t("Xem trước mô tả")} className="min-h-24 flex-1 overflow-y-auto rounded-md border border-rule bg-cotton px-3 py-2 text-md leading-relaxed">
                      {!desc.trim() ? <p className="text-ink-3">{t("Chưa có mô tả.")}</p>
                        : format === "md" ? <Markdown text={desc} /> : <p className="whitespace-pre-wrap">{toPlain(desc)}</p>}
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-xs text-ink-3">
                  {format === "md"
                    ? t("YouTrack hiển thị Markdown: tiêu đề, danh sách, chữ đậm, bảng.")
                    : t("Gửi chữ thuần: bỏ ký hiệu Markdown (#, **, -, `) để YouTrack nào cũng đọc được.")}
                </p>
              </div>
              {extra}
              {create.isError && (
                <AiResultCard error title={t("Không tạo được ticket")}>
                  {errorText(create.error, {
                    youtrack_unauthorized: t("YouTrack từ chối token (YOUTRACK_TOKEN)."),
                    youtrack_project_not_found: t("Không thấy project này trên YouTrack."),
                  }, t("Không tạo được ticket."))}
                </AiResultCard>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {mode === "ai" ? (
        // The prompt pinned at the bottom; its run / stop buttons live inside the box (CLAUDE.md: AI prompt).
        <footer className="border-t border-rule bg-paper-2 px-5 py-3">
          <AiPromptBox aria-label={aiContext ? t("Dặn thêm AI (không bắt buộc)") : t("Vấn đề / yêu cầu cho AI")} autoFocus maxLength={8000}
            placeholder={notePlaceholder ?? (aiContext ? t("Dặn thêm AI (không bắt buộc)") : t("Kể vấn đề / yêu cầu"))}
            value={note} onChange={setNote} onSend={runDraft} running={draft.isPending} onStop={() => abort.current?.abort()} stopHint={t("Dừng soạn")}
            tools={<ModelEffortPicker kind={aiKind} compact className="min-w-0 gap-x-2" />}
            actions={!draft.isPending && (
              <Hint text={t("AI soạn ticket (Enter)")} side="bottom">
                <Button type="button" size="sm" disabled={!canDraft} onClick={runDraft}
                  className="rounded-full bg-hl text-hl-ink hover:brightness-110 animate-in zoom-in-95 fade-in-0 duration-(--dur-short)">
                  {note.trim() ? <ArrowUp aria-hidden /> : <Sparkles aria-hidden />} {t("AI soạn")}
                </Button>
              </Hint>
            )} />
        </footer>
      ) : (
        <footer className="flex flex-col-reverse gap-2 border-t border-rule bg-paper-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          <span aria-hidden className="mr-auto hidden font-mono text-2xs text-ink-3 sm:inline">⌘↵ {t("tạo ticket")}</span>
          <Similar items={similar.data} searching={similar.isFetching} failed={similar.isError ? errorText(similar.error, {}, t("Không kiểm được ticket trùng")) : undefined}
            onAdd={addTo && !demo ? (t) => dup.mutate(t) : undefined} adding={dup.isPending ? dup.variables?.id : undefined}
            error={dup.isError ? dup.error.message || t("Không ghi được bình luận.") : undefined} />
          <DialogClose render={<Button type="button" variant="outline" />}>{t("Hủy")}</DialogClose>
          <Button type="button" disabled={!canCreate} aria-busy={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Bug aria-hidden />} {create.isPending ? t("Đang tạo…") : t("Tạo ticket")}
          </Button>
        </footer>
      )}
    </div>
  );
}

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, MessageSquareText, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { type Detail, type Field, issueUrl, shortName, type Ticket, when, yt } from "@/lib/yt";
import { Label, Markdown, Prio, StatePill } from "./bits";
import { selfEdits, useYt, type Yt } from "./state";
import { LinkedTasks, Related } from "./ticket-extras";
import { HistoryView } from "./history";
import { WorkView } from "./work";
import { useFlow } from "./workflow";

// The side sheet: one ticket, the list behind a dashboard number, or an AI answer.

export function Sheet() {
  const y = useYt();
  const s = y.sheet;
  const close = () => y.setSheet(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!s) { opener.current?.focus?.(); opener.current = null; return; }
    opener.current ??= document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [s]);
  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) { close(); return; }
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input,textarea,select,[contenteditable]")) return;
      if ((e.key === "j" || e.key === "k") && s.kind === "ticket") { e.preventDefault(); step(e.key === "j" ? 1 : -1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  function step(d: number) {
    if (s?.kind !== "ticket") return;
    const k = s.nav.indexOf(s.id);
    if (k >= 0 && s.nav[k + d]) y.setSheet({ ...s, id: s.nav[k + d] });
  }
  const nav = s?.kind === "ticket" ? s.nav : [];
  const k = s?.kind === "ticket" ? nav.indexOf(s.id) : -1;

  return (
    <AnimatePresence>
      {s && (
        <>
          <motion.div key="dim" aria-hidden className="fixed inset-0 z-40 bg-(--scrim)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.aside key="sheet" ref={panel} role="dialog" aria-modal aria-label={s.kind === "ticket" ? `Ticket ${s.id}` : s.title}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-paper shadow-pop", s.kind === "ticket" ? "max-w-2xl" : "max-w-4xl")}>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-paper-2 px-4">
              {s.kind === "ticket" ? (
                <a href={issueUrl(y.config?.base ?? "", s.id)} target="_blank" rel="noreferrer" title="Mở trên YouTrack" className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold no-underline hover:text-hl-2">
                  {s.id}<ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : <h2 className="truncate text-sm font-semibold">{s.title}</h2>}
              {k >= 0 && (
                <span className="ml-1 flex gap-0.5">
                  <Button size="icon-xs" variant="ghost" disabled={k <= 0} onClick={() => step(-1)} aria-label="Ticket trước" title="Ticket trước (k)"><ChevronLeft /></Button>
                  <Button size="icon-xs" variant="ghost" disabled={k >= nav.length - 1} onClick={() => step(1)} aria-label="Ticket sau" title="Ticket sau (j)"><ChevronRight /></Button>
                  <span className="self-center font-mono text-xs text-ink-3 tabular-nums">{k + 1}/{nav.length}</span>
                </span>
              )}
              {s.kind === "ticket" && y.aiOn && (
                <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="AI cho ticket này" title="Hỏi AI về ticket này, có thể thêm ticket khác hoặc trace code"
                  onClick={() => y.setSheet({ kind: "work", title: "AI · ticket đã chọn", ids: [s.id] })}><Sparkles /></Button>
              )}
              <Button data-autofocus size="icon-sm" variant="ghost" className={cn(!(s.kind === "ticket" && y.aiOn) && "ml-auto")} onClick={close} aria-label="Đóng" title="Đóng (Esc)"><X /></Button>
            </div>
            <div className={cn("min-h-0 flex-1 p-4 sm:p-5", s.kind === "work" ? "flex flex-col" : "overflow-y-auto")}>{/* work: a chat, it scrolls its own middle */}
              {s.kind === "ticket" ? <TicketView key={s.id} id={s.id} draft={s.comment} />
                : s.kind === "list" ? <TicketList rows={s.rows} />
                : s.kind === "history" ? <HistoryView />
                : <WorkView key={s.title + s.ids.join() + (s.resume?.id ?? "")} title={s.title} ids={s.ids} auto={s.auto} resume={s.resume} />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** The tickets behind a dashboard number; a row opens it, prev / next walk this list. */
export function TicketList({ rows }: { rows: Ticket[] }) {
  const y = useYt();
  const MAX = 300;
  return (
    <div className="grid gap-2">
      <p className="text-xs text-ink-3">{rows.length.toLocaleString("vi-VN")} ticket{rows.length > MAX ? `, hiện ${MAX} đầu` : ""}</p>
      {rows.length ? (
        <ul className="divide-y divide-rule overflow-hidden rounded-lg bg-cotton shadow-stock">
          {rows.slice(0, MAX).map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => y.openTicket(i.id, rows.slice(0, MAX))} className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-paper-2 max-sm:grid-cols-[5.5rem_minmax(0,1fr)]">
                <span className="grid"><b className="font-mono text-xs">{i.id}</b><span className="truncate text-xs text-ink-2">{i.assignee ? shortName(i.assignee) : "Chưa assign"}</span></span>
                <span className={cn("truncate text-sm", i.resolved && "text-ink-3 line-through")}>{i.summary}</span>
                <span className="flex items-center gap-3 max-sm:hidden"><StatePill state={i.state} /><Prio p={i.priority} /></span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-3 italic">Không có ticket nào.</p>}
    </div>
  );
}

function TicketView({ id, draft }: { id: string; draft?: string }) {
  const y = useYt();
  const qc = useQueryClient();
  const row = y.rows.find((i) => i.id === id);
  const d = useQuery({ queryKey: ["yt", "detail", id], queryFn: () => yt.detail(id), staleTime: 60_000 });
  const mentions = useQuery({ queryKey: ["yt", "mentions", id], queryFn: () => yt.mentions(id), staleTime: 60_000 });
  const i: Ticket | Detail | undefined = d.data ?? row;
  const [comment, setComment] = useState(draft ?? ""); // draft: an AI answer the user chose to send as a comment
  const [sending, setSending] = useState(false);
  const write = !y.config?.mock;
  const box = useRef<HTMLTextAreaElement>(null);
  function toComment(text: string) {
    setComment(text);
    requestAnimationFrame(() => { box.current?.scrollIntoView({ behavior: "smooth", block: "center" }); box.current?.focus(); });
  }

  async function send() {
    const t = comment.trim();
    if (!t) return;
    setSending(true);
    try {
      await yt.comment(id, t);
      selfEdits.set(id, Date.now());
      setComment("");
      toast({ text: "Đã gửi bình luận" });
      await qc.invalidateQueries({ queryKey: ["yt", "detail", id] });
    } catch (e) { toast({ text: `Không gửi được: ${(e as Error).message}` }); }
    finally { setSending(false); }
  }

  if (!i) {
    return d.isError ? <p role="alert" className="text-sm text-error">Không tải được {id}: {(d.error as Error).message}</p>
      : <p className="text-sm text-ink-3">Đang tải…</p>;
  }
  const meta: [string, React.ReactNode][] = [
    ["State", <FieldSelect key="s" ticket={i} name="State" />], ["Assignee", <AssigneeSelect key="a" ticket={i} />], ["Priority", <FieldSelect key="p" ticket={i} name="Priority" />],
    ["QC", i.qc || "—"], ["Sprint", i.sprints.join(", ") || "—"], ...(i.due ? [["Hạn", when(i.due)] as [string, string]] : []),
    ["Tạo", when(i.created)], ["Cập nhật", when(i.updated)], ["Reporter", d.data?.reporter || (d.isPending ? "…" : "—")],
  ];
  return (
    <motion.div className="grid gap-5" initial="h" animate="v" variants={{ v: { transition: { staggerChildren: 0.03 } } }}>
      {!row && <p className="text-xs text-ink-3">Ticket ngoài dữ liệu đã tải.</p>}
      <motion.h3 variants={fade} className="text-lg leading-snug font-semibold">{i.summary}</motion.h3>
      <motion.dl variants={fade} className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-[var(--radius-card)] bg-paper-2 p-3 text-sm sm:grid-cols-2">
        {meta.map(([k, v]) => <div key={k} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-xs text-ink-3">{k}</dt><dd className="min-w-0 truncate">{v}</dd></div>)}
      </motion.dl>

      <motion.div variants={fade}><LinkedTasks ids={[id]} onComment={write ? toComment : undefined} /></motion.div>

      <motion.section variants={fade} className="grid gap-2">
        <Label>Mô tả</Label>
        {d.isPending ? <p className="text-sm text-ink-3">Đang tải…</p> : d.data?.description ? <Markdown text={d.data.description} className="rounded-lg bg-cotton p-3 shadow-edge" /> : <p className="text-sm text-ink-3 italic">Không có mô tả</p>}
      </motion.section>

      <motion.div variants={fade}><Related t={i} /></motion.div>

      {!!d.data?.links.length && (
        <motion.section variants={fade} className="grid gap-1.5">
          <Label>Liên kết</Label>
          {d.data.links.flatMap((l) => l.issues.map((x) => (
            <button key={l.rel + x.id} type="button" onClick={() => y.openTicket(x.id)} className="grid grid-cols-[7rem_5.5rem_minmax(0,1fr)] items-baseline gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-paper-2">
              <em className="truncate text-xs text-ink-3 not-italic">{l.rel}</em>
              <b className={cn("font-mono text-xs", x.resolved && "text-ink-3 line-through")}>{x.id}</b>
              <span className="truncate">{x.summary}</span>
            </button>
          )))}
        </motion.section>
      )}

      {!!mentions.data?.length && (
        <motion.section variants={fade} className="grid gap-1.5">
          <Label>Nhắc trên Telegram ({mentions.data.length})</Label>
          {mentions.data.map((m, k) => (
            <Link key={k} href={`/?chat=${encodeURIComponent(m.chat_id)}`} className="grid gap-0.5 rounded-lg bg-cotton p-2.5 text-sm no-underline shadow-edge hover:bg-paper-2">
              <small className="flex gap-2 text-xs text-ink-3"><span className="font-medium text-ink-2">{m.chat}</span><span>{m.from || "?"}</span><time className="ml-auto">{when(m.date)}</time></small>
              <span className="line-clamp-3">{m.text}</span>
            </Link>
          ))}
        </motion.section>
      )}

      <motion.section variants={fade} className="grid gap-2">
        <Label>Bình luận ({d.data?.comments.length ?? "…"})</Label>
        {d.data?.comments.map((c, k) => (
          <div key={k} className="grid gap-1 rounded-lg bg-cotton p-3 shadow-edge">
            <small className="flex gap-2 text-xs text-ink-3"><span className="font-medium text-ink-2">{c.author || "—"}</span><time className="ml-auto">{when(c.created)}</time></small>
            <Markdown text={c.text} />
          </div>
        ))}
        {d.data && !d.data.comments.length && <p className="text-sm text-ink-3 italic">Chưa có bình luận</p>}
        {write && (
          <div className="grid gap-2">
            <Textarea ref={box} rows={3} maxLength={20000} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Bình luận mới" placeholder="Viết bình luận (gửi lên YouTrack)…" />
            <Button size="sm" className="justify-self-end" disabled={!comment.trim() || sending} aria-busy={sending} onClick={() => void send()}><MessageSquareText /> Gửi bình luận</Button>
          </div>
        )}
      </motion.section>
    </motion.div>
  );
}
const fade = { h: { opacity: 0, y: 6 }, v: { opacity: 1, y: 0 } };

/** Change the assignee; the toast offers to put it back. */
export function AssigneeSelect({ ticket, className }: { ticket: Ticket; className?: string }) {
  return <AssigneePicker ticket={ticket} className={className} acts={useYt()} />;
}
/** The same select fed by props: a memoized table row must not subscribe to the whole YouTrack context. */
export type AssigneeActs = Pick<Yt, "people" | "loginOf" | "patchTicket" | "config">;
export function AssigneePicker({ ticket, className, acts: y }: { ticket: Ticket; className?: string; acts: AssigneeActs }) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false); // the people list is rendered on first focus: hundreds of rows x the team is a heavy DOM
  const cur = ticket.assigneeLogin ?? (ticket.assignee ? y.loginOf.get(ticket.assignee) ?? "" : "");
  if (y.config?.mock) return <span>{ticket.assignee || "Chưa assign"}</span>;
  async function change(login: string, prev: string) {
    setBusy(true);
    try {
      y.patchTicket(await yt.setAssignee(ticket.id, login || null));
      const name = y.people.find((p) => p.login === login)?.name ?? "Chưa assign";
      toast({ text: `${ticket.id} → ${name}`, undo: async () => y.patchTicket(await yt.setAssignee(ticket.id, prev || null)) });
    } catch (e) { toast({ text: `Không đổi được: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }
  return (
    <select value={cur} disabled={busy} aria-label={`Đổi assignee ${ticket.id}`} onChange={(e) => void change(e.target.value, cur)} onClick={(e) => e.stopPropagation()}
      onPointerDown={() => setArmed(true)} onFocus={() => setArmed(true)}
      className={cn("h-7 max-w-full rounded-md border border-rule bg-cotton px-1.5 text-sm", className)}>
      {cur && (!armed || !y.people.some((p) => p.login === cur)) && <option value={cur}>{ticket.assignee}</option>}
      {(armed || !cur) && <option value="">Chưa assign</option>}
      {armed && y.people.map((p) => <option key={p.login} value={p.login}>{p.name}</option>)}
    </select>
  );
}

/** State / Priority, changed through YouTrack (State follows the workflow); the toast offers to put it back. */
function FieldSelect({ ticket, name }: { ticket: Ticket; name: Field }) {
  const y = useYt();
  const [busy, setBusy] = useState(false);
  const project = ticket.id.split("-")[0];
  const opts = useQuery({ queryKey: ["yt", "fields", project], queryFn: () => yt.fields(project), staleTime: Infinity, enabled: !y.config?.mock });
  const key = name === "State" ? "state" : name === "Priority" ? "priority" : "type";
  const cur = ticket[key] ?? "";
  const view = name === "State" ? <StatePill state={ticket.state} /> : name === "Priority" ? <Prio p={ticket.priority} /> : <span>{cur || "—"}</span>;
  const flow = useFlow(project)(name === "State" ? cur : null); // the team's arrows out of this state; null: no rule
  const values = name === "State" && flow ? opts.data?.[name]?.filter((v) => v === cur || flow.includes(v)) : opts.data?.[name];
  if (!values?.length) return view;
  async function change(v: string, prev: string) {
    setBusy(true);
    try {
      y.patchTicket(await yt.setField(ticket.id, name, v));
      toast({ text: `${ticket.id} ${name} → ${v}`, undo: prev ? async () => y.patchTicket(await yt.setField(ticket.id, name, prev)) : undefined });
    } catch (e) { toast({ text: `Không đổi được: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }
  return (
    <span className="relative inline-flex items-center gap-1.5">
      {view}
      <select value={cur} disabled={busy} aria-label={`Đổi ${name} ${ticket.id}`} title={`Đổi ${name}`} onChange={(e) => void change(e.target.value, cur)}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait">
        {!values.includes(cur) && <option value={cur}>{cur || "—"}</option>}
        {values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <ChevronDown className="size-3.5 text-ink-3" aria-hidden />
    </span>
  );
}

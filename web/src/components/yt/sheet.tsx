"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, MessageCircleQuestion, MessageSquareText, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { ImageView } from "@/components/markdown";
import { useEffect, useRef, useState } from "react";
import { useMention, ytPeople } from "@/components/mention";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast, useNow } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { AI_MAX, type Detail, type Field, fileUrl, issueUrl, shortName, type Ticket, type UserField, when, yt, ytDetailQuery } from "@/lib/yt";
import { Avatar, Label, Markdown, Person, Picker, Prio, StatePill, TypeTag } from "./bits";
import { saveTicket, selfEdits, useYt, type Yt } from "./state";
import { Related } from "./ticket-extras";
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
  // aria-modal needs the page behind to be out of reach too: Tab and screen readers stay in the sheet.
  const open = !!s;
  useEffect(() => {
    const p = panel.current;
    if (!open || !p?.parentElement) return;
    const behind = [...p.parentElement.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== p && !el.dataset.sheet && !el.inert);
    behind.forEach((el) => { el.inert = true; });
    return () => behind.forEach((el) => { el.inert = false; });
  }, [open]);
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
          <motion.div key="dim" data-sheet aria-hidden className="fixed inset-0 z-40 bg-(--scrim)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.aside key="sheet" ref={panel} role="dialog" aria-modal aria-label={s.kind === "ticket" ? `Ticket ${s.id}` : s.title}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-paper shadow-pop", s.kind === "ticket" ? "max-w-2xl" : "max-w-4xl")}>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-paper-2 px-4">
              {s.kind === "ticket" ? (
                <Hint side="bottom" text="Mở trên YouTrack"><a href={issueUrl(y.config?.base ?? "", s.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold no-underline hover:text-hl-2">
                  {s.id}<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">, mở trên YouTrack</span>
                </a></Hint>
              ) : <h2 className="truncate text-sm font-semibold">{s.title}</h2>}
              {k >= 0 && (
                <span className="ml-1 flex gap-0.5">
                  <Hint side="bottom" text="Ticket trước (k)"><Button size="icon-xs" variant="ghost" disabled={k <= 0} onClick={() => step(-1)} aria-label="Ticket trước"><ChevronLeft /></Button></Hint>
                  <Hint side="bottom" text="Ticket sau (j)"><Button size="icon-xs" variant="ghost" disabled={k >= nav.length - 1} onClick={() => step(1)} aria-label="Ticket sau"><ChevronRight /></Button></Hint>
                  <span className="self-center font-mono text-xs text-ink-3 tabular-nums">{k + 1}/{nav.length}</span>
                </span>
              )}
              {s.kind === "ticket" && y.aiOn && (
                <Hint side="bottom" text="Hỏi AI về ticket này, có thể thêm ticket khác hoặc trace code"><Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="AI cho ticket này"
                  onClick={() => y.setSheet({ kind: "work", title: "AI", ids: [s.id] })}><Sparkles /></Button></Hint>
              )}
              {s.kind === "list" && y.aiOn && s.rows.length > 0 && (
                <Hint side="bottom" text={`Hỏi AI về ${Math.min(s.rows.length, AI_MAX)} ticket trong danh sách này (ưu tiên ticket đang mở)`}><Button size="sm" variant="ghost" className="ml-auto"
                  onClick={() => y.setSheet({ kind: "work", title: `AI · ${s.title}`, ids: [...s.rows].sort((a, b) => +!!a.resolved - +!!b.resolved).slice(0, AI_MAX).map((i) => i.id) })}><Sparkles /> Hỏi AI</Button></Hint>
              )}
              <Button data-autofocus size="icon-sm" variant="ghost" className={cn(!(y.aiOn && (s.kind === "ticket" || (s.kind === "list" && s.rows.length > 0))) && "ml-auto")} onClick={close} aria-label="Đóng (Esc)"><X /></Button>
            </div>
            <div className={cn("min-h-0 flex-1 p-4 sm:p-5", s.kind === "work" ? "flex flex-col" : "overflow-y-auto")}>{/* work: a chat, it scrolls its own middle */}
              {s.kind === "ticket" ? <TicketView key={s.id} id={s.id} draft={s.comment} />
                : s.kind === "list" ? <TicketList rows={s.rows} />
                : <WorkView key={s.title + s.ids.join() + (s.resume?.id ?? "")} title={s.title} ids={s.ids} auto={s.auto} start={s.start} resume={s.resume} />}
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
  const d = useQuery(ytDetailQuery(id));
  const mentions = useQuery({ queryKey: ["yt", "mentions", id], queryFn: () => yt.mentions(id), staleTime: 60_000 });
  const i: Ticket | Detail | undefined = d.data ?? row;
  const [comment, setComment] = useState(draft ?? ""); // draft: an AI answer the user chose to send as a comment
  const [sending, setSending] = useState(false);
  const write = !y.config?.mock;
  const { attach, ...mention } = useMention(ytPeople(id.split("-")[0]), comment, setComment); // "@" tags the project's team
  const now = useNow();

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
      : (
        <div aria-label={`Đang tải ${id}…`} className="grid gap-5">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-24 rounded-[var(--radius-card)]" />
          <div className="grid gap-2">{[96, 88, 92, 60].map((w) => <Skeleton key={w} className="h-3.5" style={{ width: `${w}%` }} />)}</div>
        </div>
      );
  }
  const files = d.data?.attachments ?? [];
  const said = [d.data?.description, ...(d.data?.comments.map((c) => c.text) ?? [])].join("\n");
  const loose = files.filter((a) => !said.includes(`(${a.name}`) && !said.includes(`(${encodeURI(a.name)}`)); // not shown inline in any text
  const meta: [string, React.ReactNode][] = [
    ["State", <FieldSelect key="s" ticket={i} name="State" />], ["Assignee", <AssigneeSelect key="a" ticket={i} />], ["Priority", <FieldSelect key="p" ticket={i} name="Priority" />],
    ["QC", <AssigneePicker key="q" ticket={i} acts={y} field="QC" className="-ml-1.5" />], ["Type", <FieldSelect key="t" ticket={i} name="Type" />],
    ["Sprint", i.sprints.join(", ") || "—"], ...(i.due ? [["Hạn", <span key="d" className={cn(i.due < now && !i.resolved && "font-medium text-error")}>{when(i.due)}</span>] as [string, React.ReactNode]] : []),
    ...(i.estimate ? [["Estimate", `${+(i.estimate / 60).toFixed(1)}h`] as [string, string]] : []),
    ["Tạo", when(i.created)], ["Cập nhật", when(i.updated)], ["Reporter", d.data?.reporter || (d.isPending ? "…" : "—")],
  ];
  return (
    <motion.div className="grid gap-5" initial="h" animate="v" variants={{ v: { transition: { staggerChildren: 0.03 } } }}>
      {!row && <p className="text-xs text-ink-3">Ticket ngoài dữ liệu đã tải.</p>}
      <motion.h3 variants={fade} className="text-lg leading-snug font-semibold">{i.summary}</motion.h3>
      <motion.dl variants={fade} className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-[var(--radius-card)] bg-paper-2 p-3 text-sm sm:grid-cols-2">
        {meta.map(([k, v]) => <div key={k} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-xs text-ink-3">{k}</dt><dd className="min-w-0 truncate">{v}</dd></div>)}
      </motion.dl>


      <motion.section variants={fade} className="grid gap-2">
        <Label>Mô tả</Label>
        {d.isPending ? (
          <div aria-label="Đang tải mô tả…" className="grid gap-2 rounded-lg bg-cotton p-3 shadow-edge">
            {[96, 88, 92, 60].map((w) => <Skeleton key={w} className="h-3.5" style={{ width: `${w}%` }} />)}
          </div>
        ) : d.data?.description ? <Markdown text={d.data.description} files={{ issue: id, list: files }} className="rounded-lg bg-cotton p-3 shadow-edge" /> : <p className="text-sm text-ink-3 italic">Không có mô tả</p>}
      </motion.section>

      {!!loose.length && (
        <motion.section variants={fade} className="grid gap-2">
          <Label>Tệp đính kèm ({loose.length})</Label>
          <div className="flex flex-wrap gap-2">
            {loose.map((a) => (
              /^image\/(?!svg)/.test(a.mime) ? (
                <span key={a.id} title={a.name} className="grid w-32 gap-1 rounded-lg bg-cotton p-1.5 text-xs shadow-edge">
                  <ImageView src={fileUrl(id, a)} alt={a.name} boxClass="my-0 block w-full" className="h-20 w-full rounded object-cover" />
                  <span className="truncate text-ink-2">{a.name}</span>
                </span>
              ) : (
                <a key={a.id} href={fileUrl(id, a)} target="_blank" rel="noopener noreferrer" title={a.name}
                  className="grid w-32 gap-1 rounded-lg bg-cotton p-1.5 text-xs no-underline shadow-edge hover:bg-paper-2">
                  <span className="grid h-20 place-items-center rounded bg-paper-2 font-mono text-ink-3 uppercase">{a.name.split(".").pop()?.slice(0, 5) || "file"}</span>
                  <span className="truncate text-ink-2">{a.name}</span>
                </a>
              )
            ))}
          </div>
        </motion.section>
      )}

      <motion.div variants={fade}><Related t={i} links={d.data?.links} /></motion.div>

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
          {mentions.data.map((m) => (
            <div key={`${m.chat_id}:${m.message_id}`} className="grid rounded-lg bg-cotton text-sm shadow-edge">
              <Link href={`/?chat=${encodeURIComponent(m.chat_id)}&msg=${encodeURIComponent(m.message_id)}`} className="grid gap-0.5 rounded-t-lg p-2.5 pb-1.5 no-underline hover:bg-paper-2">
                <small className="flex gap-2 text-xs text-ink-3"><span className="font-medium text-ink-2">{m.chat}</span><span>{m.from || "?"}</span><time className="ml-auto">{when(m.date)}</time></small>
                <span className="line-clamp-3">{m.text}</span>
              </Link>
              {/* Q&A in that group, the box prefilled (inbox reads ?qa= / ?ask=): the post gets a #QA code and nudges */}
              <Hint side="bottom" text="Đăng câu hỏi Q&A vào nhóm này (kèm mã #QA, có nhắc khi chưa ai trả lời)">
                <Link href={`/?qa=${encodeURIComponent(m.chat_id)}&ask=${encodeURIComponent(`Về ${i.id} ${i.summary ?? ""}: `)}`}
                  className="inline-flex items-center gap-1 justify-self-start rounded-md px-2.5 py-1 text-xs text-hl-2 no-underline hover:bg-paper-2">
                  <MessageCircleQuestion className="size-3.5" aria-hidden /> Hỏi lại trong nhóm
                </Link>
              </Hint>
            </div>
          ))}
        </motion.section>
      )}

      <motion.section variants={fade} className="grid gap-2">
        <Label>Bình luận ({d.data?.comments.length ?? "…"})</Label>
        {d.data?.comments.map((c, k) => (
          <div key={c.id ?? k} className="grid gap-1 rounded-lg bg-cotton p-3 shadow-edge">
            <small className="flex gap-2 text-xs text-ink-3"><span className="font-medium text-ink-2">{c.author || "—"}</span><time className="ml-auto">{when(c.created)}</time></small>
            <Markdown text={c.text} files={{ issue: id, list: files, comment: c.id }} />
          </div>
        ))}
        {d.data && !d.data.comments.length && <p className="text-sm text-ink-3 italic">Chưa có bình luận</p>}
        {write && (
          <div className="relative grid gap-2">
            {mention.popup}
            <Textarea ref={attach} rows={3} maxLength={20000} value={comment} aria-label="Bình luận mới" placeholder="Viết bình luận (gửi lên YouTrack, ⌘↵ gửi, @ để tag)…"
              onChange={(e) => { setComment(e.target.value); mention.track(e); }} onSelect={mention.track}
              onKeyDown={(e) => { if (mention.onKeyDown(e)) return; if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !sending) { e.preventDefault(); void send(); } }} />
            <Button size="sm" className="justify-self-end" disabled={!comment.trim() || sending} aria-busy={sending} onClick={() => void send()}><MessageSquareText /> Gửi bình luận</Button>
          </div>
        )}
      </motion.section>
    </motion.div>
  );
}
const fade = { h: { opacity: 0, y: 6 }, v: { opacity: 1, y: 0 } };

/** Change the assignee; "Nhận" takes it. The toast offers to put it back. */
export function AssigneeSelect({ ticket }: { ticket: Ticket }) {
  const y = useYt(), me = y.me ? y.loginOf.get(y.me) : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <AssigneePicker ticket={ticket} acts={y} className="-ml-1.5" />
      {me && userLogin(y, ticket, "Assignee") !== me && !y.config?.mock && (
        <Button size="xs" variant="ghost" className="shrink-0 text-ink-3" onClick={() => void setPerson(y, ticket, "Assignee", me)}>Nhận</Button>
      )}
    </span>
  );
}
/** The same picker fed by props: a memoized table row must not subscribe to the whole YouTrack context. */
export type AssigneeActs = Pick<Yt, "people" | "loginOf" | "patchTicket" | "config" | "me">;
/** The two single-user fields: the ticket keys they live in and their empty label. */
const USER = {
  Assignee: { name: "assignee", login: "assigneeLogin", empty: "Chưa assign" },
  QC: { name: "qc", login: "qcLogin", empty: "Chưa có QC" },
} as const;
const userLogin = (y: AssigneeActs, t: Ticket, f: UserField) => { const u = USER[f], n = t[u.name]; return t[u.login] ?? (n ? y.loginOf.get(n) ?? "" : ""); };
const Nobody = ({ text }: { text: string }) => <span className="inline-flex items-center gap-1.5 text-ink-3"><i aria-hidden className="size-6 shrink-0 rounded-full border border-dashed border-rule-2" />{text}</span>;

export function AssigneePicker({ ticket, className, acts: y, field = "Assignee" }: { ticket: Ticket; className?: string; acts: AssigneeActs; field?: UserField }) {
  const u = USER[field], who = ticket[u.name];
  const label = who ? <Person name={who} /> : <Nobody text={u.empty} />;
  if (y.config?.mock) return <span className={cn("inline-flex px-1.5", className)}>{label}</span>;
  const cur = userLogin(y, ticket, field);
  const meLogin = y.me ? y.loginOf.get(y.me) : undefined;
  const team = y.people.some((p) => p.login === cur) || !cur ? y.people : [...y.people, { login: cur, name: who ?? cur }];
  const opt = (p: { login: string; name: string }) => ({ v: p.login, text: p.name, node: <><Avatar name={p.name} /><span className="truncate">{p.name}</span></>, hint: p.login === meLogin ? "Tôi" : undefined });
  const options = [
    ...team.filter((p) => p.login === meLogin).map(opt), // me first: taking a ticket is the common case
    { v: "", text: `${u.empty} bỏ chọn`, node: <Nobody text={u.empty} /> },
    ...team.filter((p) => p.login !== meLogin).map(opt),
  ];
  return <Picker label={label} title={`Đổi ${field} ${ticket.id}`} value={cur} options={options} search="Tìm người…" className={className}
    onPick={(login) => void setPerson(y, ticket, field, login)} />;
}
/** Set Assignee / QC at once, settle on YouTrack's answer; the toast offers to put it back. False on error. */
export async function setPerson(y: AssigneeActs, t: Ticket, field: UserField, login: string) {
  const u = USER[field], prev = userLogin(y, t, field);
  const name = (l: string) => y.people.find((p) => p.login === l)?.name ?? (l === prev ? t[u.name] : null) ?? null;
  const local = (l: string): Partial<Ticket> => ({ [u.name]: name(l), [u.login]: l || null });
  const go = (from: Ticket, l: string) => saveTicket(y.patchTicket, from, local(l), () => yt.setAssignee(t.id, l || null, field));
  const ok = await go(t, login);
  if (ok) toast({ text: `${t.id} ${field === "QC" ? "QC " : ""}→ ${name(login) ?? u.empty}`, undo: () => void go({ ...t, ...local(login) }, prev) });
  return ok;
}

/** State / Priority / Type, changed through YouTrack (State follows the team's workflow); shown at once, the toast offers to put it back. */
const FIELD = {
  State: { key: "state", node: (v: string | null) => <StatePill state={v} /> },
  Priority: { key: "priority", node: (v: string | null) => <Prio p={v} /> },
  Type: { key: "type", node: (v: string | null) => <TypeTag type={v} /> },
} as const;
function FieldSelect({ ticket, name }: { ticket: Ticket; name: Field }) {
  const y = useYt();
  const project = ticket.id.split("-")[0];
  const opts = useQuery({ queryKey: ["yt", "fields", project], queryFn: () => yt.fields(project), staleTime: Infinity, enabled: !y.config?.mock });
  const { key, node } = FIELD[name], cur = ticket[key] ?? "";
  const flowOf = useFlow(project);
  const flow = name === "State" ? flowOf(cur) : null; // the team's arrows out of this state; null: no rule
  const all = opts.data?.[name] ?? [];
  const values = flow ? all.filter((v) => v === cur || flow.includes(v)) : all;
  if (!values.length) return node(ticket[key]);
  const options = (values.includes(cur) || !cur ? values : [cur, ...values]).map((v) => ({ v, node: node(v) }));
  async function change(v: string) {
    const go = (from: Ticket, to: string) => saveTicket(y.patchTicket, from, { [key]: to }, () => yt.setField(ticket.id, name, to));
    if (await go(ticket, v)) toast({ text: `${ticket.id} ${name} → ${v}`, undo: cur ? () => void go({ ...ticket, [key]: v }, cur) : undefined });
  }
  return <Picker label={node(ticket[key])} title={`Đổi ${name} ${ticket.id}`} value={cur} options={options} onPick={(v) => void change(v)}
    foot={flow && all.length > values.length ? (flow.length ? `Theo workflow của team: chỉ hiện các bước đi tiếp từ ${cur || "—"}` : `Workflow của team: ${cur || "—"} là bước cuối`) : undefined} />;
}

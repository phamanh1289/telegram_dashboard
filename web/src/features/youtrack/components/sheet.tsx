"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, FilePenLine, Lock, MessageCircleQuestion, Sparkles, Workflow, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageView } from "@/shared/components/markdown";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { GrowLabel, GrowRow, useGrow } from "@/shared/components/ui/grow";
import { Hint } from "@/shared/components/ui/hint";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { fmtNum, type Key, t as tNow, useT } from "@/shared/lib/i18n";
import { useNow } from "@/shared/hooks/use-now";
import { toast } from "@/shared/lib/notifications";
import { goApp } from "@/shared/lib/nav";
import { useRoleOrDev, useSetupTips } from "@/shared/lib/prefs";
import { openTour } from "@/shared/lib/nav";
import { cn } from "@/shared/lib/utils";
import { AI_MAX, type Detail, type Field, fileUrl, useFlowRunning, issueUrl, type Ticket, type UserField, when, yt, ytDetailQuery, ytFieldsQuery, ytPeopleQuery } from "@/features/youtrack/lib/yt";
import { Avatar, Label, Markdown, Person, Picker, Prio, StatePill, Title, TypeTag } from "./bits";
import { Comments, ENTRY, Rail, Who } from "./comments";
import { saveTicket, useYt, type Yt, YtProvider } from "./state";
import { tagsFor } from "@/features/telegram/lib/mentions";
import { StoryUpdate } from "./story-update";
import { Related } from "./ticket-extras";
import { WorkView } from "./work";
import { useFlow, useNoFlow, WorkflowTip } from "./workflow";

// The UI flow dialog (and, with it, the drawing engine) loads only when it is opened.
const FlowDialog = dynamic(() => import("./flow").then((m) => m.FlowDialog));

// The side sheet: one ticket, the list behind a dashboard number, or an AI answer.

/** One ticket's sheet over another page (Telegram's ticket chip: AI sessions, messages, Briefing): the YouTrack tab's
 *  own sheet, on a provider that loads no list and leaves the URL alone. Mounted on open; `onClose` once it slid out. */
export function TicketSheet({ id, onClose }: { id: string; onClose: () => void }) {
  return <YtProvider embed={id}><Sheet /><Closed onClose={onClose} /></YtProvider>;
}
function Closed({ onClose }: { onClose: () => void }) {
  const open = !!useYt().sheet;
  useEffect(() => { if (!open) { const t = setTimeout(onClose, 300); return () => clearTimeout(t); } }, [open, onClose]); // after the exit slide
  return null;
}

export function Sheet() {
  const t = useT();
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
            className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-paper shadow-pop", s.kind === "work" ? "max-w-4xl" : "max-w-2xl")}>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-paper-2 px-4">
              {s.kind === "ticket" ? (
                <Hint side="bottom" text={t("Mở trên YouTrack")}><a href={issueUrl(y.config?.base ?? "", s.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-sm font-bold no-underline hover:text-hl-2">
                  {s.id}<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">, {t("mở trên YouTrack")}</span>
                </a></Hint>
              ) : <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold"><span className="truncate">{s.title}</span>
                {s.kind === "list" && <span aria-label={t("{n} ticket", { n: fmtNum(s.rows.length, t.lang) })} className="shrink-0 rounded-full bg-paper-3 px-2 text-2xs leading-5 font-medium text-ink-2 tabular-nums">{fmtNum(s.rows.length, t.lang)}</span>}
              </h2>}
              {k >= 0 && (
                <span className="ml-1 flex gap-0.5">
                  <Hint side="bottom" text={t("Ticket trước (k)")}><Button size="icon-xs" variant="ghost" disabled={k <= 0} onClick={() => step(-1)} aria-label={t("Ticket trước")}><ChevronLeft /></Button></Hint>
                  <Hint side="bottom" text={t("Ticket sau (j)")}><Button size="icon-xs" variant="ghost" disabled={k >= nav.length - 1} onClick={() => step(1)} aria-label={t("Ticket sau")}><ChevronRight /></Button></Hint>
                  <span className="self-center font-mono text-xs text-ink-3 tabular-nums">{k + 1}/{nav.length}</span>
                </span>
              )}
              {s.kind === "list" && y.aiOn && s.rows.length > 0 && (
                <Hint side="bottom" text={t("Hỏi AI về {n} ticket trong danh sách này (ưu tiên ticket đang mở)", { n: Math.min(s.rows.length, AI_MAX) })}><Button size="sm" variant="ghost" className="ml-auto"
                  onClick={() => y.setSheet({ kind: "work", title: `AI · ${s.title}`, ids: [...s.rows].sort((a, b) => +!!a.resolved - +!!b.resolved).slice(0, AI_MAX).map((i) => i.id) })}><Sparkles /> {t("Hỏi AI")}</Button></Hint>
              )}
              <Button data-autofocus size="icon-sm" variant="ghost" className={cn(!(y.aiOn && s.kind === "list" && s.rows.length > 0) && "ml-auto")} onClick={close} aria-label={t("Đóng (Esc)")}><X /></Button>
            </div>
            <div className={cn("min-h-0 flex-1 p-4 sm:p-5", s.kind === "work" ? "flex flex-col" : "overflow-y-auto")}>{/* work: a chat, it scrolls its own middle */}
              {s.kind === "ticket" ? <TicketView key={s.id} id={s.id} draft={s.comment} />
                : s.kind === "list" ? <TicketList rows={s.rows} />
                : <WorkView key={s.title + s.ids.join() + (s.resume?.id ?? "")} title={s.title} ids={s.ids} auto={s.auto} start={s.start} resume={s.resume} canDelete />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** The tickets behind a dashboard number; a row opens it, prev / next walk this list. */
export function TicketList({ rows }: { rows: Ticket[] }) {
  const t = useT();
  const y = useYt();
  const MAX = 300;
  if (!rows.length) return <p className="py-10 text-center text-sm text-ink-3">{t("Không có ticket nào.")}</p>;
  const shown = rows.slice(0, MAX);
  return (
    <ul className="zebra grid gap-0.5">
      {shown.map((i) => (
        <li key={i.id} className="rounded-md">
          <button type="button" onClick={() => y.openTicket(i.id, shown)} className="grid w-full gap-1.5 rounded-md px-2.5 py-2 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2">
            <Title i={i} clamp={cn("line-clamp-2", i.resolved && "line-through opacity-60")} />
            <span className="flex min-w-0 items-center gap-2.5 text-xs">
              <span className="shrink-0 font-mono text-ink-3">{i.id}</span><StatePill state={i.state} />{i.priority && <Prio p={i.priority} />}
              <span className="ml-auto min-w-0 text-ink-2"><Person name={i.assignee} empty={t("Chưa assign")} /></span>
            </span>
          </button>
        </li>
      ))}
      {rows.length > MAX && <li data-zebra-off className="px-2.5 py-2 text-xs text-ink-3">{t("{n} ticket", { n: fmtNum(rows.length, t.lang) })}{t(", hiện {n} đầu", { n: MAX })}</li>}
    </ul>
  );
}

function TicketView({ id, draft }: { id: string; draft?: string }) {
  const t = useT();
  const y = useYt();
  const qc = useQueryClient();
  const row = y.rows.find((i) => i.id === id);
  const d = useQuery(ytDetailQuery(id));
  const mentions = useQuery({ queryKey: ["yt", "mentions", id], queryFn: () => yt.mentions(id), staleTime: 60_000 });
  // a ticket of another project (a link, a chip): Assignee / QC pick from that project's team (same query as the tab's)
  const proj = id.split("-")[0], other = proj !== y.project;
  const team = useQuery({ ...ytPeopleQuery(proj), enabled: other });
  const acts: AssigneeActs = other ? { ...y, people: team.data ?? [], loginOf: new Map([...y.loginOf, ...(team.data ?? []).map((p) => [p.name, p.login] as const)]) } : y;
  const i: Ticket | Detail | undefined = d.data ?? row;
  const [flowOpen, setFlowOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const role = useRoleOrDev(), po = role === "po", tips = useSetupTips();
  // who a reply about this ticket tags, by role: QC tells the Assignee (the dev), a Dev the QC, the PO both; never me
  const notify = (i ? role === "qa" ? [i.assignee] : role === "dev" ? [i.qc] : [i.assignee, i.qc] : []).filter((p): p is string => !!p && p !== y.me);
  const router = useRouter();
  // Cập nhật story › Telegram: a reply to the latest Telegram message naming this ticket (none: the user picks a group)
  const lastMention = mentions.data?.reduce<(typeof mentions.data)[number] | undefined>((a, m) => (!a || m.date > a.date ? m : a), undefined);
  const flowRun = useFlowRunning(id, flowOpen); // the UI flow dialog (one entry: this ticket's "UI flow")
  const write = !y.config?.mock;
  // which .html attachment is the UI flow file: told by the backend from the file's content (its name follows the
  // flow's title); keyed by those attachments, so a save / upload asks again. Unread / failed: it is a plain file row.
  const htmlIds = (d.data?.attachments ?? []).filter((a) => a.mime === "text/html" || /\.html?$/i.test(a.name)).map((a) => a.id);
  const flowAtt = useQuery({ queryKey: ["yt", "flow-att", id, ...htmlIds], queryFn: ({ signal }) => yt.flow(id, signal).then((r) => r.att),
    enabled: write && htmlIds.length > 0, staleTime: Infinity, retry: false }).data;
  const now = useNow();

  const loadError = d.isError && <p role="alert" className="text-sm text-error">{t("Không tải được {id}: {msg}", { id, msg: (d.error as Error).message })}</p>;
  if (!i) {
    return loadError || (
        <div aria-label={t("Đang tải {id}…", { id })} className="grid gap-5">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-24 rounded-[var(--radius-card)]" />
          <div className="grid gap-2">{[96, 88, 92, 60].map((w) => <Skeleton key={w} className="h-3.5" style={{ width: `${w}%` }} />)}</div>
        </div>
      );
  }
  const files = d.data?.attachments ?? [];
  const said = [d.data?.description, ...(d.data?.comments.map((c) => c.text) ?? [])].join("\n");
  const loose = files.filter((a) => !said.includes(`(${a.name}`) && !said.includes(`(${encodeURI(a.name)}`)); // not shown inline in any text
  const meta: [Key, React.ReactNode][] = [
    ["State", <FieldSelect key="s" ticket={i} name="State" />], ["Assignee", <AssigneePicker key="a" ticket={i} acts={acts} className="-ml-1.5" />], ["Priority", <FieldSelect key="p" ticket={i} name="Priority" />],
    ["QC", <AssigneePicker key="q" ticket={i} acts={acts} field="QC" className="-ml-1.5" />], ["Type", <FieldSelect key="t" ticket={i} name="Type" />],
    ["Sprint", i.sprints.join(", ") || "—"], ...(i.due ? [["Hạn", <span key="d" className={cn(i.due < now && !i.resolved && "font-medium text-error")}>{when(i.due)}</span>] as [Key, React.ReactNode]] : []),
    ...(i.estimate ? [["Estimate", `${+(i.estimate / 60).toFixed(1)}h`] as [Key, string]] : []),
    ["Ngày tạo", when(i.created)], ["Cập nhật lúc", when(i.updated)], ["Reporter", d.isPending ? "…" : <Person key="r" name={d.data?.reporter || null} />],
  ];
  // a UI flow render left going when its dialog closed (read again on open); this re-renders as the dialog closes

  return (
    <motion.div className="grid gap-5" initial="h" animate="v" variants={{ v: { transition: { staggerChildren: 0.03 } } }}>
      {!row && <p className="text-xs text-ink-3">{t("Ticket ngoài dữ liệu đã tải.")}</p>}
      <motion.h3 variants={fade} className="text-lg leading-snug font-bold">{i.summary}</motion.h3>
      {loadError}
      <motion.dl variants={fade} className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-[var(--radius-card)] bg-paper-2 p-3 text-sm sm:grid-cols-2">
        {meta.map(([k, v]) => <div key={k} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2"><dt className="text-xs text-ink-3">{t(k)}</dt><dd className="min-w-0 truncate">{v}</dd></div>)}
      </motion.dl>


      {(y.aiOn || write || tips) && ( // the ticket's features, one row, one look; Cập nhật story last, so an icon sits in the same place for every role
        <motion.div variants={fade}>
          <GrowRow className="flex w-fit max-w-full flex-wrap gap-2">
            {y.aiOn ? (
              <Spot label={t("AI cho ticket này")} hint={t("Hỏi AI về ticket này, có thể thêm ticket khác hoặc trace code")} className="ai-chip"
                onClick={() => y.setSheet({ kind: "work", title: "AI", ids: [id] })}><Sparkles aria-hidden /></Spot>
            ) : tips && ( // no AI CLI here: the spot stays, locked, and shows how to set one up
              <Spot label={t("AI cho ticket này")} hint={t("Máy này chưa có AI CLI. Bấm để được chỉ cách cài, rồi hỏi AI về ticket, viết test case, trace code…")} className="bg-paper-3 text-ink-3 hover:bg-paper-2"
                onClick={() => openTour("settings-ai-accounts")}><Lock aria-hidden /></Spot>
            )}
            {write && ( // reads and saves the ticket's attachment: needs a token like the other writes
              <Spot label={t("UI flow")} hint={flowRun ? t("Đang render UI flow — mở để xem") : t("Sơ đồ màn hình và luồng bấm của ticket này")} className={TONE.code}
                onClick={() => setFlowOpen(true)}>
                <Workflow aria-hidden />
                {flowRun && <span data-flow-running aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-hl ring-2 ring-paper" />}
              </Spot>
            )}
            {write && po && ( // a PO tool (story = their spec); Dev / QC ask the PO instead
              <Spot label={t("Cập nhật story")} hint={t("Sửa mô tả (thay đổi, AC còn thiếu) rồi lưu lên YouTrack; cần thì nhờ AI soạn và báo nhóm")} className={TONE.ok}
                onClick={() => setStoryOpen(true)}><FilePenLine aria-hidden /></Spot>
            )}
          </GrowRow>
        </motion.div>
      )}
      {flowOpen && <FlowDialog issue={id} open onClose={() => setFlowOpen(false)} />}

      <motion.section variants={fade} className="grid gap-2">
        <Label>{t("Mô tả")}</Label>
        {storyOpen && (
          <StoryUpdate ids={[id]} note="" onClose={() => setStoryOpen(false)}
            notify={lastMention ? { chatId: lastMention.chat_id, replyTo: lastMention.message_id } : undefined} />
        )}
        {d.isPending ? (
          <div aria-label={t("Đang tải mô tả…")} className="grid gap-2 rounded-lg bg-cotton p-3 shadow-edge">
            {[96, 88, 92, 60].map((w) => <Skeleton key={w} className="h-3.5" style={{ width: `${w}%` }} />)}
          </div>
        ) : d.data?.description ? <Markdown text={d.data.description} files={{ issue: id, list: files }} className="rounded-lg bg-cotton p-3 shadow-edge" />
          : d.data ? <p className="text-sm text-ink-3 italic">{t("Không có mô tả")}</p> : <p className="text-sm text-ink-3">—</p>}
      </motion.section>

      {!!loose.length && (
        <motion.section variants={fade} className="grid gap-2">
          <Label>{t("Tệp đính kèm ({n})", { n: loose.length })}</Label>
          <div className="flex flex-wrap gap-2">
            {loose.map((a) => (
              a.id === flowAtt ? ( // the same dialog as the "UI flow" button: this is that file
                <button key={a.id} type="button" onClick={() => setFlowOpen(true)}
                  className="grid w-32 gap-1 rounded-lg bg-cotton p-1.5 text-left text-xs shadow-edge hover:bg-paper-2">
                  <span className="grid h-20 place-items-center rounded bg-hl-wash text-hl-2"><Workflow className="size-6" aria-hidden /></span>
                  <span className="truncate text-ink-2">{a.name}</span>
                </button>
              ) : /^image\/(?!svg)/.test(a.mime) ? (
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
          <Label>{t("Liên kết")}</Label>
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
        <motion.section variants={fade} className="grid gap-2">
          <Label>{t("Nhắc trên Telegram ({n})", { n: mentions.data.length })}</Label>
          <ul className="grid gap-1.5">{/* rows like the comments below; each its own message, so no line joins them */}
            {mentions.data.map((m) => (
              <li key={`${m.chat_id}:${m.message_id}`} className="grid">
                <Hint side="bottom" text={notify.length ? t("Trả lời tin này trong nhóm, @tag sẵn {who} (nếu có trong nhóm)", { who: notify.join(", ") }) : t("Trả lời tin này trong nhóm")}>
                  <Link href={`/?chat=${encodeURIComponent(m.chat_id)}&msg=${encodeURIComponent(m.message_id)}`} className={cn(ENTRY, "-mx-2 rounded-lg px-2 py-1.5 no-underline hover:bg-paper-2")}
                    onClick={(e) => { // tags found in the group go into the reply box; none found: the plain link
                      if (!notify.length || e.metaKey || e.ctrlKey || e.shiftKey) return;
                      e.preventDefault();
                      const href = e.currentTarget.getAttribute("href")!;
                      void tagsFor(qc, m.chat_id, notify).then((tags) => goApp(router, tags ? `${href}&text=${encodeURIComponent(`${tags} `)}` : href));
                    }}>
                    <Rail name={m.from || "?"} line={false} />
                    <span className="grid min-w-0">
                      <Who name={m.from || "?"} mine={m.outgoing} meta={m.chat} at={m.date} now={now} />
                      <span className="line-clamp-3 text-sm text-ink">{m.text}</span>
                    </span>
                  </Link>
                </Hint>
                {/* Q&A in that group, the box prefilled (inbox reads ?qa= / ?ask=): the post gets a #QA code and nudges */}
                <Hint side="bottom" text={t("Đăng câu hỏi Q&A vào nhóm này (kèm mã #QA, có nhắc khi chưa ai trả lời)")}>
                  <Link href={`/?qa=${encodeURIComponent(m.chat_id)}&ask=${encodeURIComponent(`Về ${i.id} ${i.summary ?? ""}: `)}`}
                    className="ml-8 inline-flex items-center gap-1 justify-self-start rounded-md px-2 py-1 text-xs text-hl-2 no-underline hover:bg-paper-2">
                    <MessageCircleQuestion className="size-3.5" aria-hidden /> {t("Hỏi lại trong nhóm")}
                  </Link>
                </Hint>
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      {mentions.isError && <p role="alert" className="text-xs text-error">{t("Không đọc được tin Telegram nhắc ticket này: {msg}", { msg: (mentions.error as Error).message })}</p>}

      <motion.div variants={fade}>
        <Comments id={id} comments={d.data?.comments} pending={d.isPending} failed={d.isError} files={files} draft={draft} write={write} />
      </motion.div>
    </motion.div>
  );
}
const fade = { h: { opacity: 0, y: 6 }, v: { opacity: 1, y: 0 } };

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
  const t = useT();
  const u = USER[field], who = ticket[u.name];
  const label = who ? <Person name={who} /> : <Nobody text={t(u.empty)} />;
  if (y.config?.mock) return <span className={cn("inline-flex px-1.5", className)}>{label}</span>;
  const cur = userLogin(y, ticket, field);
  const meLogin = y.me ? y.loginOf.get(y.me) : undefined;
  const team = y.people.some((p) => p.login === cur) || !cur ? y.people : [...y.people, { login: cur, name: who ?? cur }];
  const opt = (p: { login: string; name: string }) => ({ v: p.login, text: p.name, node: <><Avatar name={p.name} /><span className="truncate">{p.name}</span></>, hint: p.login === meLogin ? t("Tôi") : undefined });
  const options = [
    ...team.filter((p) => p.login === meLogin).map(opt), // me first: taking a ticket is the common case
    { v: "", text: t("{empty} bỏ chọn", { empty: t(u.empty) }), node: <Nobody text={t(u.empty)} /> },
    ...team.filter((p) => p.login !== meLogin).map(opt),
  ];
  return <Picker label={label} title={t("Đổi {field} {id}", { field, id: ticket.id })} value={cur} options={options} search={t("Tìm người…")} className={className}
    onPick={(login) => void setPerson(y, ticket, field, login)} />;
}
/** Set Assignee / QC at once, settle on YouTrack's answer; the toast offers to put it back. False on error. */
export async function setPerson(y: AssigneeActs, t: Ticket, field: UserField, login: string) {
  const u = USER[field], prev = userLogin(y, t, field);
  const name = (l: string) => y.people.find((p) => p.login === l)?.name ?? (l === prev ? t[u.name] : null) ?? null;
  const local = (l: string): Partial<Ticket> => ({ [u.name]: name(l), [u.login]: l || null });
  const go = (from: Ticket, l: string) => saveTicket(y.patchTicket, from, local(l), () => yt.setAssignee(t.id, l || null, field));
  const ok = await go(t, login);
  if (ok) toast({ text: `${t.id} ${field === "QC" ? "QC " : ""}→ ${name(login) ?? tNow(u.empty)}`, undo: () => void go({ ...t, ...local(login) }, prev) });
  return ok;
}

/** State / Priority / Type, changed through YouTrack (State follows the team's workflow); shown at once, the toast offers to put it back. */
const FIELD = {
  State: { key: "state", node: (v: string | null) => <StatePill state={v} /> },
  Priority: { key: "priority", node: (v: string | null) => <Prio p={v} /> },
  Type: { key: "type", node: (v: string | null) => <TypeTag type={v} /> },
} as const;
function FieldSelect({ ticket, name }: { ticket: Ticket; name: Field }) {
  const t = useT();
  const y = useYt();
  const project = ticket.id.split("-")[0];
  const opts = useQuery({ ...ytFieldsQuery(project), enabled: !y.config?.mock });
  const { key, node } = FIELD[name], cur = ticket[key] ?? "";
  const flowOf = useFlow(project), noFlow = useNoFlow(project);
  const flow = name === "State" ? flowOf(cur) : null; // the team's arrows out of this state; null: no rule
  const all = opts.data?.[name] ?? [];
  const values = flow ? all.filter((v) => v === cur || flow.includes(v)) : all;
  // the values could not be read (a token without rights, YouTrack down): say why the field cannot be changed here
  if (opts.isError) return <Hint side="bottom" text={t("Không tải được danh sách {name} nên chưa đổi được ở đây: {msg}", { name, msg: opts.error.message })}><span>{node(ticket[key])}</span></Hint>;
  if (!values.length) return node(ticket[key]);
  const options = (values.includes(cur) || !cur ? values : [cur, ...values]).map((v) => ({ v, node: node(v) }));
  async function change(v: string) {
    const go = (from: Ticket, to: string) => saveTicket(y.patchTicket, from, { [key]: to }, () => yt.setField(ticket.id, name, to));
    // undo is a move back: offered only when the team workflow has that arrow (the server would refuse it)
    const back = !!cur && (name !== "State" || flowOf(v)?.includes(cur) !== false);
    if (await go(ticket, v)) toast({ text: `${ticket.id} ${name} → ${v}`, undo: back ? () => void go({ ...ticket, [key]: v }, cur) : undefined });
  }
  return <Picker label={node(ticket[key])} title={t("Đổi {field} {id}", { field: name, id: ticket.id })} value={cur} options={options} onPick={(v) => void change(v)}
    foot={name !== "State" ? undefined : <>
      {flow && !noFlow && all.length > values.length && t(flow.length ? "Theo workflow của team: chỉ hiện các bước đi tiếp từ {state}"
        : flowOf(null)?.includes(cur) ? "Workflow của team: {state} là bước cuối" : "{state} chưa có trong workflow của team nên chưa đổi được", { state: cur || "—" })}
      <WorkflowTip project={project} />
    </>} />;
}

/** A feature's own colour (AI has `ai-chip`): tinted at rest, filled under the pointer. */
const TINT = "bg-(--w) text-(--c) shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c)_45%,transparent)] hover:scale-105 hover:bg-(--c) hover:text-paper focus-visible:bg-(--c) focus-visible:text-paper";
const TONE = { code: `[--c:var(--color-code)] [--w:var(--color-code-wash)] ${TINT}`, ok: `[--c:var(--color-ok)] [--w:var(--color-ok-wash)] ${TINT}` };

/** One of a ticket's features (AI, UI flow, Cập nhật story), in a GrowRow: a colored round icon, its label slides out. */
function Spot({ label, hint, className, onClick, children }: { label: string; hint: string; className: string; onClick: () => void; children: React.ReactNode }) {
  const g = useGrow();
  return (
    <Hint side="bottom" text={hint}>{/* no title: the label is already out beside the icon */}
      <button type="button" onClick={onClick} onPointerEnter={g.enter}
        className={cn("group/grow relative inline-flex h-9 items-center rounded-full px-2.5 text-sm font-bold transition-[color,background-color,box-shadow,scale] duration-(--dur-short) [&_svg]:size-4 [&_svg]:shrink-0", className)}>
        {children}
        <GrowLabel open={g.open}>{label}</GrowLabel>
      </button>
    </Hint>
  );
}

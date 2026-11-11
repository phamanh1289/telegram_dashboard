"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, CheckCircle2, ChevronDown, Ellipsis, ExternalLink, GitPullRequest, Loader2, type LucideIcon, MessageSquare, RotateCcw, RotateCw, Search, Sparkles, Square, Trash2, Users } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Menu } from "@base-ui/react/menu";
import { AiBot, AiResultCard, AiSpin, AiThinking, UserBubble, useFollow } from "@/components/ai/chat";
import { DayGroups } from "@/components/ai/day-groups";
import { Markdown } from "@/components/markdown";
import { groupEvents, ToolGroup } from "@/components/ai/steps";
import { EventItem, OpenAttached, SessionAsks, usd, useTaskLog } from "@/components/tasks-feed";
import { TaskChanges } from "@/components/task-changes";
import { TaskComposer } from "@/components/task-composer";
import { Button } from "@/components/ui/button";
import { MENU_POPUP } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Message, type Task } from "@/lib/api";
import { type Key, t as tNow, tMaybe, useT } from "@/lib/i18n";
import type { View } from "@/hooks/use-chat-messages";
import { type Brief, dropBriefs, useBriefs } from "@/lib/briefs";
import { ALL, BRIEFING, copyText, fold, openReply, sessionId, sessionMatches, toast, useNow, useTaskList } from "@/lib/inbox";
import { ago, timeLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

// The AI Agent page: session list and the selected session (its log in tasks-feed.tsx, its input in task-composer.tsx).

type Filter = "all" | "doing" | "done";
// Labels: Vietnamese keys or names, shown through tMaybe.
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["doing", "Doing"], ["done", "Done"]];
// assist: a tag's Trợ lý AI turns (reply panel, no project); brief: Trợ lý Briefing conversations (this browser), not server tasks
type Kind = "task" | "deep" | "assist" | "brief";
const KINDS: [Kind, string][] = [["task", "Giao AI Agent"], ["deep", "Đối chiếu BE"], ["assist", "Trợ lý AI"], ["brief", "Briefing"]];
const KIND_LABEL = Object.fromEntries(KINDS) as Record<Kind, string>;

/** The tagged message as the reply panel needs it (the task row only keeps a snapshot). */
function asMessage(t: Task): Message {
  return {
    chat_id: t.chat_id!, message_id: t.message_id!, sender_id: null, sender_name: t.sender_name ?? null, text: t.message_text ?? "", date: t.created_at,
    edit_date: null, reply_to_id: null, topic_id: null, outgoing: false, media_kind: null, deleted: false,
    handled: t.handled ?? false, handled_by: "", pinned: false, priority: false, links: [], kept: true,
  };
}

type Status = "running" | "stopped" | "done";
const statusOf = (t: Task): Status =>
  t.running ? "running" : !t.result && t.mode !== "terminal" ? "stopped" : "done";
/** Last activity of a session (its latest turn or step; before any: when it started): the time shown and the order. */
const lastIso = (t: Task) => t.active_at ?? t.created_at;
const lastAt = (t: Task) => Date.parse(lastIso(t));
/** Done = the tagged message was ticked done (handled); everything else is Doing. */
const isDone = (t: Task) => !!t.handled;
const STATUS_LABEL: Record<Status, Key> = { running: "Đang chạy", stopped: "Đã dừng", done: "Đã xong" };

function StatusIcon({ s, className }: { s: Status; className?: string }) {
  if (s === "running") return <AiSpin className={className} />;
  if (s === "stopped") return <Square className={cn("fill-current text-warn", className)} aria-hidden />;
  return <CheckCircle2 className={cn("text-ok", className)} aria-hidden />;
}

function HandledBadge() {
  const tt = useT();
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-ok">
      <CheckCheck className="size-3" aria-hidden /> {tt("Đã xử lý")}
    </span>
  );
}

/**
 * Scrolling body plus a footer pinned under it (the input). Follows new output only while
 * the user sits at the bottom, and only inside this box so the page never jumps.
 */
function Feed({ follow, children, footer }: { follow: unknown; children: ReactNode; footer?: ReactNode }) {
  const { ref, onScroll } = useFollow(follow);
  return (
    <>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
      </div>
      {footer && <div className="shrink-0 px-4 pt-2 pb-4 sm:px-6"><div className="grid gap-1.5">{footer}</div></div>}
    </>
  );
}

/** Headless session: conversation log with the follow-up composer pinned below it. */
function ChatPanel({ t, head }: { t: Task; head: ReactNode }) {
  const tt = useT();
  const { id } = t;
  const running = !!t.running;
  const q = useTaskLog(id, running);
  const items = q.data?.items;
  const blocks = useMemo(() => groupEvents(items ?? []), [items]);
  const last = items?.at(-1);
  const turns = (items ?? []).filter((e) => e.kind === "result");
  const spent = turns.reduce((n, e) => n + (e.cost ?? 0), 0);
  const cut = !running && last?.kind === "result" && !!last.error; // stopped / restarted / failed: offer to go on

  return (
    <Feed follow={(items?.length ?? 0) + (running ? 0.5 : 0)} footer={<TaskComposer t={t} cut={cut} />}>
      {head}
      {turns.length > 0 && (
        <p className="-mt-2 flex gap-3 font-mono text-2xs text-ink-3 tabular-nums">
          <span>{tt("{n} lượt", { n: turns.length })}</span>
          {spent > 0 && <Hint side="bottom" text={tt("Cộng chi phí ước tính của các lượt, theo giá API do CLI báo; gói thuê bao không trừ tiền theo số này.")}><span>≈ {tt("{cost} cả phiên", { cost: usd(spent) })}</span></Hint>}
        </p>
      )}
      <ul aria-label={tt("Hội thoại với AI")} className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {blocks.map((b, i) => b.kind === "tools"
          ? <li key={i} className="animate-in fade-in-0 duration-(--dur-short)"><ToolGroup steps={b.steps} live={running && i === blocks.length - 1} /></li>
          : <EventItem key={i} ev={b.ev} took={b.took} tools={b.tools} />)}
        {q.isPending && <li><Skeleton className="h-8 w-2/3" /></li>}
        {q.isError && (
          <li role="alert" className="flex items-center gap-2 px-1 text-xs text-error">
            {tt("Không đọc được hội thoại.")}
            <Button size="xs" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}><RotateCw /> {tt("Thử lại")}</Button>
          </li>
        )}
        {running && blocks.at(-1)?.kind !== "tools" && (
          <li><AiThinking /></li>
        )}
      </ul>
    </Feed>
  );
}

/** One card in the session list: status, what it is about, group and age. */
function TaskRow({ t, now, active, mixed, picked, onSelect }: {
  t: Task; now: number; active: boolean; mixed: boolean; picked?: boolean; onSelect: () => void; // picked set = picking mode (bulk delete)
}) {
  const tt = useT();
  const s = statusOf(t);
  const picking = picked !== undefined;
  return (
    <li>
      <button type="button" aria-current={(!picking && active) || undefined} aria-pressed={picking ? picked : undefined} onClick={onSelect}
        className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-lg px-2.5 py-2 text-left transition-[background-color,box-shadow] duration-(--dur-micro)",
          (picking ? picked : active) ? "bg-hl-wash shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-hl)_35%,transparent)]" : "hover:bg-paper-2")}>
        {picking ? (
          <span aria-hidden className={cn("row-span-2 mt-0.5 grid size-4 place-items-center rounded-sm border transition-[background-color,border-color] duration-(--dur-micro)",
            picked ? "border-board bg-board text-board-type" : "border-rule-2 bg-cotton")}>
            {picked && <Check className="size-3.5" />}
          </span>
        ) : (
          <span className="relative row-span-2 mt-0.5 grid size-4 place-items-center">
            <StatusIcon s={s} className="size-4" /><span className="sr-only">{tt(STATUS_LABEL[s])}</span>
          </span>
        )}
        <span className={cn("line-clamp-2 text-sm font-medium leading-snug", t.handled ? "text-ink-3" : "text-ink")}>{t.title || t.message_text || t.prompt}</span>
        <span className="flex min-w-0 flex-wrap gap-x-2.5 text-xs text-ink-3">
          <span className="shrink-0 font-mono tabular-nums">{sessionId(t)}</span>
          {mixed && <span className="shrink-0">{tMaybe(KIND_LABEL[t.kind])}</span>}
          {t.handled && <HandledBadge />}
          <span className="truncate">{t.chat_title || t.project.split("/").pop()}</span>
          <time className="shrink-0" dateTime={lastIso(t)} title={timeLabel(lastIso(t), true)}>{ago(lastIso(t), now)}</time>
        </span>
      </button>
    </li>
  );
}

/** One action in the session menu: icon, label, and what it does underneath. */
function MenuRow({ icon: Icon, label, hint, tone, disabled, onClick }: {
  icon: LucideIcon; label: string; hint: string; tone?: "ok" | "error"; disabled?: boolean; onClick: () => void;
}) {
  return (
    <Menu.Item disabled={disabled} onClick={onClick}
      className={cn("group grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 rounded-md px-2.5 py-1.5 outline-none select-none data-disabled:opacity-50",
        tone === "error" ? "data-highlighted:bg-error-wash" : tone === "ok" ? "data-highlighted:bg-ok-wash" : "data-highlighted:bg-paper-2")}>
      <Icon className={cn("mt-0.5 size-4 transition-transform duration-(--dur-micro) group-data-highlighted:scale-110",
        tone === "error" ? "text-error" : tone === "ok" ? "text-ok" : "text-ink-3")} aria-hidden />
      <span className="grid">
        <span className={cn("text-sm font-medium", tone === "error" ? "text-error" : "text-ink")}>{label}</span>
        <span className="text-xs text-ink-3">{hint}</span>
      </span>
    </Menu.Item>
  );
}


/** The selected session: a slim title bar with one action menu, the scrolling conversation, the composer pinned at the bottom. */
function TaskDetail({ t, now, onBack, onChanges, onOpenGroup }: {
  t: Task; now: number; onBack: () => void; onChanges: () => void; onOpenGroup: (chatId: string, messageId?: string, view?: View) => void;
}) {
  const tt = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const [asking, setAsking] = useState(false); // "Xóa phiên" confirm
  const remove = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}`, { method: "DELETE" }), onSettled: () => { setAsking(false); return refresh(); } });
  // Done: on the tagged message, or on the session itself when its message is not a kept tag (Đối chiếu BE on any
  // reply); the session moves to the Done tab.
  const tag = t.chat_id && t.message_id ? asMessage(t) : null;
  const put = (handled: boolean, react = true) =>
    api<void>(`/tasks/${t.id}/handled`, { method: "PUT", json: { handled, react } })
      .finally(() => { void qc.invalidateQueries({ queryKey: ["qa"] }); return refresh(); }); // its Q&A follow (#QA in the prompt too)
  const mark = useMutation({
    mutationFn: ({ handled, react }: { handled: boolean; react: boolean }) => put(handled, react),
    onSuccess: (_, { handled }) => { if (handled) toast({ text: tNow("Đã đánh dấu xong"), undo: () => put(false) }); },
    onError: () => toast({ text: tNow("Không cập nhật được, thử lại sau") }),
  });

  // Đối chiếu BE sits on a BE reply, not a kept tag: only Cả nhóm has it.
  const tagView: View = t.kind === "deep" || isDone(t) ? "live" : "pending";
  const openTag = () => onOpenGroup(t.chat_id!, t.message_id ?? undefined, tagView);

  const openAttached = useMemo(() => ({
    home: t.chat_id, open: (chatId: string, messageId: string) => onOpenGroup(chatId, messageId, "live"),
  }), [t.chat_id, onOpenGroup]);

  const head = <>
    {(t.title || t.message_text || t.chat_title) && (
      <div className="rounded-xl border-l-2 border-hl bg-paper-2 px-3.5 py-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short)">
        <p className="mb-1 flex flex-wrap items-center gap-x-2.5 text-xs text-ink-3">
          {t.sender_name && <span className="font-medium text-ink-2">{t.sender_name}</span>}
          {t.chat_title && <span className="inline-flex items-center gap-1"><Users className="size-3" aria-hidden /> {t.chat_title}</span>}
          {tag && (
            <Hint side="bottom" text={tt("Mở tin này trong nhóm Telegram")}>
              <button type="button" aria-label={tt("Mở tin trong nhóm")} onClick={openTag}
                className="-my-1 ml-auto grid size-6 place-items-center rounded-md text-ink-3 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
                <ExternalLink className="size-3.5" aria-hidden />
              </button>
            </Hint>
          )}
        </p>
        <p className="line-clamp-3 max-w-[70ch] whitespace-pre-wrap break-words text-md leading-[1.55] text-ink">{t.title || t.message_text}</p>
      </div>
    )}
    {t.prompt && <section aria-label={tt("Yêu cầu giao cho AI")} className="grid gap-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-fit items-center gap-1 rounded-sm text-left text-xs font-medium text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink">
        <ChevronDown className={cn("size-3.5 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden /> {tt("Yêu cầu đã giao")}
      </button>
      {open && <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-2 animate-in fade-in-0 duration-(--dur-short)">{t.prompt}</p>}
    </section>}
  </>;

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-(--dur-short)">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Button size="icon-sm" variant="ghost" className="-ml-1 md:hidden" onClick={onBack} aria-label={tt("Về danh sách phiên")}><ArrowLeft /></Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={t.title || t.message_text || t.prompt}>{t.title || t.message_text || t.prompt}</p>
        {t.handled && <span className="text-xs"><HandledBadge /></span>}
        <Hint side="bottom" title={sessionId(t)} text={tt("ID phiên. Bấm để chép; gõ hoặc dán vào ô tìm phiên để mở lại nhanh.")}>
          <button type="button" aria-label={tt("Chép ID phiên {id}", { id: sessionId(t) })}
            onClick={() => void copyText(sessionId(t), tt("Đã chép {id}", { id: sessionId(t) }))}
            className="shrink-0 rounded-sm px-1 font-mono text-xs text-ink-3 tabular-nums transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
            {sessionId(t)}
          </button>
        </Hint>
        {/* every project kind: an Đối chiếu BE session can go on with edits too (ô nhắn: cho sửa file) */}
        {t.kind !== "assist" && (
          <Hint side="bottom" text={tt("Xem file AI đã sửa trong dự án, rồi tạo nhánh + PR (hỏi lại trước khi đẩy)")}>
            <Button size="xs" variant="outline" className="shrink-0" onClick={onChanges}><GitPullRequest /> {tt("Thay đổi")}</Button>
          </Hint>
        )}
        <time className="shrink-0 text-xs text-ink-3" dateTime={lastIso(t)} title={timeLabel(lastIso(t), true)}>{ago(lastIso(t), now)}</time>
        <Menu.Root>
          <Menu.Trigger openOnHover delay={120} aria-label={tt("Thao tác phiên")}
            className="grid size-[30px] shrink-0 place-items-center rounded-md text-ink-2 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink data-popup-open:bg-paper-3 data-popup-open:text-ink">
            {mark.isPending || remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Ellipsis className="size-4" aria-hidden />}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
              <Menu.Popup className={cn(MENU_POPUP, "w-64")}>
                {tag && (t.handled ? (
                  <MenuRow icon={RotateCcw} label={tt("Mở lại")} hint={tt("Tin tag chưa xử lý, phiên về Doing")} disabled={mark.isPending}
                    onClick={() => mark.mutate({ handled: false, react: true })} />
                ) : <>
                  <MenuRow icon={CheckCheck} tone="ok" label="Done" hint={tt("Tin tag, tin đính kèm và tin trả lời phiên đã xử lý, thả reaction")} disabled={mark.isPending}
                    onClick={() => mark.mutate({ handled: true, react: true })} />
                  <MenuRow icon={Check} tone="ok" label={tt("Done không reaction")} hint={tt("Tin tag, tin đính kèm và tin trả lời phiên đã xử lý, không reaction")} disabled={mark.isPending}
                    onClick={() => mark.mutate({ handled: true, react: false })} />
                </>)}
                {tag && <Menu.Separator className="mx-1 my-0.5 h-px bg-rule" />}
                {t.result && tag && t.kind !== "assist" && <MenuRow icon={MessageSquare} label={tt("Dùng làm nháp trả lời")} hint={tt("Kết quả thành nháp trả lời tin tag")} onClick={() => openReply(tag, t.result!)} />}
                {t.chat_id && <MenuRow icon={Users} label={tt("Mở nhóm")} hint={tagView === "live" ? tt("Cả nhóm, cuộn tới tin đã giao AI Agent") : tt("Chưa xử lý, cuộn tới tin đã giao AI Agent")} onClick={openTag} />}
                {t.chat_id && <Menu.Separator className="mx-1 my-0.5 h-px bg-rule" />}
                <MenuRow icon={Trash2} tone="error" label={tt("Xóa phiên")} hint={tt("Hỏi xác nhận trước khi xóa")} disabled={remove.isPending}
                  onClick={() => setAsking(true)} />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <ConfirmDialog open={asking} onOpenChange={setAsking} busy={remove.isPending} onConfirm={() => remove.mutate()}
          title={tt("Xóa phiên này?")} confirmLabel={tt("Xóa phiên")}
          description={t.running ? tt("Phiên đang chạy sẽ bị dừng rồi xóa. Không hoàn tác được.") : tt("Phiên biến khỏi danh sách AI Agent. Không hoàn tác được.")}
          items={[{ id: t.id, tag: sessionId(t), label: t.title || t.message_text || t.prompt }]} />
      </div>
      {remove.isError && <p role="alert" className="border-b px-4 py-1.5 text-xs text-error">{tt("Xóa thất bại, thử lại.")}</p>}

      <SessionAsks t={t}>
      <OpenAttached value={openAttached}>
      {t.mode !== "terminal" ? <ChatPanel t={t} head={head} /> : ( // old Terminal tasks: prompt and result only
        <Feed follow={t.result}>
          {head}
          <section aria-label={tt("Kết quả")} className="grid gap-1.5">
            <h3 className="text-xs font-medium text-ink-3">{tt("Kết quả từ AI")}</h3>
            {t.result ? <Markdown asks text={t.result} className="rounded-md bg-ok-wash p-3 text-md leading-[1.55] text-ink" />
              : <p className="rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-3">{tt("Phiên Terminal cũ chưa có kết quả.")}</p>}
          </section>
        </Feed>
      )}
      </OpenAttached>
      </SessionAsks>
    </div>
  );
}

/** AI Agent › Briefing: the Trợ lý Briefing conversations kept on this browser, read again like a session; asking on is
 *  the Trợ lý itself (Briefing page). */
function BriefsPanel({ now, onOpenBriefing }: { now: number; onOpenBriefing: () => void }) {
  const tt = useT();
  const list = useBriefs();
  const [find, setFind] = useState("");
  const [sel, setSel] = useState<string | null>(null); // null on phones = show the list
  const [asking, setAsking] = useState(false); // "Xóa phiên" confirm
  const k = fold(find.trim());
  const rows = k ? list.filter((b) => fold(b.turns.map((t) => `${t.q} ${t.a}`).join(" ")).includes(k)) : list;
  const cur = rows.find((b) => b.id === sel) ?? rows[0];
  const name = (b: Brief) => b.turns[0]?.q ?? tt("Trợ lý Briefing");
  const open = <Button size="sm" variant="outline" onClick={onOpenBriefing}><Sparkles /> {tt("Hỏi Trợ lý Briefing")}</Button>;
  if (!list.length) return (
    <div className="grid justify-items-center gap-3 py-20 text-center text-sm text-ink-2 animate-in fade-in-0">
      <AiBot className="size-10" />
      <p>{tt("Chưa có hội thoại nào với Trợ lý Briefing (⌘J). Mỗi hội thoại được giữ ở đây, trên trình duyệt này, 14 ngày.")}</p>
      {open}
    </div>
  );
  return (
    <div className="view-back flex min-h-0 flex-1">
      <aside aria-label={tt("Hội thoại Briefing")} className={cn("flex min-h-0 w-full flex-col md:w-72 md:shrink-0 md:border-r", sel && "max-md:hidden")}>
        <span className="relative shrink-0 p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" value={find} onChange={(e) => setFind(e.target.value)} aria-label={tt("Tìm hội thoại")} placeholder={tt("Tìm theo câu hỏi, câu trả lời")} className="h-8 pl-8 text-xs md:text-xs" />
        </span>
        <div role="group" aria-label={tt("Danh sách hội thoại")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <DayGroups items={rows} at={(b) => b.at} open={!!k} row={(b) => (
            <li key={b.id}>
              <button type="button" aria-current={b.id === cur?.id || undefined} onClick={() => setSel(b.id)}
                className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-lg px-2.5 py-2 text-left transition-[background-color,box-shadow] duration-(--dur-micro)",
                  b.id === cur?.id ? "bg-hl-wash shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-hl)_35%,transparent)]" : "hover:bg-paper-2")}>
                <Sparkles className="row-span-2 mt-0.5 size-4 text-hl-2" aria-hidden />
                <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">{name(b)}</span>
                <span className="flex gap-x-2.5 text-xs text-ink-3"><span className="font-mono tabular-nums">{tt("{n} lượt", { n: b.turns.length })}</span><time dateTime={new Date(b.at).toISOString()}>{ago(b.at, now)}</time></span>
              </button>
            </li>
          )} />
          {!rows.length && <p className="px-2 py-6 text-center text-xs text-ink-3">{tt("Không có hội thoại nào khớp.")}</p>}
        </div>
      </aside>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", sel ? "flex" : "hidden md:flex")}>
        {cur && <>
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:px-4">
            <Button size="icon-sm" variant="ghost" className="-ml-1 md:hidden" onClick={() => setSel(null)} aria-label={tt("Về danh sách hội thoại")}><ArrowLeft /></Button>
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name(cur)}</p>
            <time className="shrink-0 text-xs text-ink-3" dateTime={new Date(cur.at).toISOString()}>{ago(cur.at, now)}</time>
            <Hint side="bottom" text={tt("Xóa hội thoại (hỏi xác nhận trước)")}>
              <Button size="icon-sm" variant="ghost" aria-label={tt("Xóa hội thoại")} onClick={() => setAsking(true)}><Trash2 /></Button>
            </Hint>
            <ConfirmDialog open={asking} onOpenChange={setAsking} onConfirm={() => { dropBriefs([cur.id]); setAsking(false); setSel(null); }}
              title={tt("Xóa hội thoại này?")} confirmLabel={tt("Xóa hội thoại")} description={tt("Hội thoại biến khỏi trình duyệt này. Không hoàn tác được.")}
              items={[{ id: cur.id, label: name(cur) }]} />
          </div>
          <Feed key={cur.id} follow={cur.id} footer={<div className="justify-self-start">{open}</div>}>
            <ul aria-label={tt("Hội thoại với AI")} className="grid grid-cols-[minmax(0,1fr)] gap-3">
              {cur.turns.map((t, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)] gap-3">
                  <UserBubble>{t.q}</UserBubble>
                  <AiResultCard className="p-4"><Markdown text={t.a} className="text-md leading-[1.6] text-ink" /></AiResultCard>
                </li>
              ))}
            </ul>
          </Feed>
        </>}
      </div>
    </div>
  );
}

/** Every task handed to the AI: session tabs up in the page header, the list on the left, the selected session on the right. */
export function TasksPage({ focus, headSlot, onOpenGroup }: {
  focus?: string | null; // task to select on open ("Mở phiên" from a tagged message)
  headSlot: HTMLElement | null; // the page header, where the session tabs go
  onOpenGroup: (chatId: string, messageId?: string, view?: View) => void;
}) {
  const tt = useT();
  const q = useTaskList();
  const now = useNow();
  const briefs = useBriefs();
  const [picked, setFilter] = useState<Filter | null>(focus ? null : "doing");
  const [pickedKind, setKind] = useState<Kind | null>(null);
  const [sel, setSel] = useState<string | null>(focus ?? null); // null on phones = show the list
  const [find, setFind] = useState(""); // ID or text: searches every session, whatever the tabs say
  const [diffOf, setDiffOf] = useState<string | null>(null); // "Thay đổi" page over list + session (both kept mounted)
  const every = q.data ?? [];
  // "Mở phiên": open the tabs matching the session (its kind; Done → done, else doing) until the user picks one.
  const focused = focus ? every.find((t) => t.id === focus) : undefined;
  const kind: Kind = pickedKind ?? focused?.kind ?? (q.isSuccess && !every.length && briefs.length ? "brief" : "task"); // only Briefing chats (QA / PO): open on them
  const all = every.filter((t) => t.kind === kind);
  const filter: Filter = picked ?? (focused ? (isDone(focused) ? "done" : "doing") : "all");
  const running = every.filter((t) => t.running).length;
  const done = all.filter(isDone).length;
  const count: Record<Filter, number> = { all: all.length, doing: all.length - done, done };
  const searching = !!find.trim();
  const rows = (searching ? every.filter((t) => sessionMatches(t, find)) : all.filter((t) => filter === "all" || (filter === "done") === isDone(t)))
    .sort((a, b) => lastAt(b) - lastAt(a)); // rows[0]: the session opened by default, the top one
  // "Mở phiên" on a session that is gone: say so rather than open another one.
  const gone = !!focus && sel === focus && q.isSuccess && !every.some((t) => t.id === focus);
  const cur = gone ? undefined : (rows.find((t) => t.id === sel) ?? rows[0]);
  const diffTask = diffOf ? every.find((t) => t.id === diffOf) : undefined;
  // Done tab: pick several finished sessions and delete them at once (one DELETE per session, as the menu does).
  const qc = useQueryClient();
  const [pick, setPick] = useState<Set<string> | null>(null);
  const picking = !!pick && filter === "done" && !searching;
  const chosen = picking ? rows.filter((t) => pick.has(t.id)) : [];
  const toggle = (id: string) => setPick((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; });
  const [askMany, setAskMany] = useState(false); // the "Xóa N phiên" confirm
  const removeMany = useMutation({
    mutationFn: (ids: string[]) => Promise.allSettled(ids.map((id) => api<void>(`/tasks/${id}`, { method: "DELETE" }))),
    onSuccess: (res) => {
      const failed = res.filter((r) => r.status === "rejected").length;
      toast({ text: failed ? tNow("Xóa lỗi {failed}/{n} phiên, thử lại.", { failed, n: res.length }) : tNow("Đã xóa {n} phiên", { n: res.length }) });
      if (!failed) setPick(null);
    },
    onSettled: () => { setAskMany(false); return qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });

  return (
    <section aria-label="AI Agent" className="flex min-h-0 flex-col">
      {headSlot && createPortal(
        <div className="flex min-w-0 items-center gap-3">
          <Segmented id="agent-kind" label={tt("Loại phiên")} value={kind} onChange={(k) => { setKind(k); setSel(null); setDiffOf(null); }}
            items={KINDS.map(([id, label]) => ({ value: id, label: <>{tMaybe(label)} <span className="font-mono tabular-nums opacity-70">{id === "brief" ? briefs.length : every.filter((t) => t.kind === id).length}</span></> }))} />
          {running > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-hl-2 animate-in fade-in-0 zoom-in-95">
              <span className="relative flex size-2" aria-hidden><span className="absolute inset-0 animate-ping rounded-full bg-hl/60" /><span className="relative size-2 rounded-full bg-hl" /></span>
              {tt.n("{n} đang chạy", { n: <span className="font-mono tabular-nums">{running}</span> })}
            </span>
          )}
        </div>,
        headSlot,
      )}

      {kind === "brief" ? <BriefsPanel now={now} onOpenBriefing={() => onOpenGroup(BRIEFING)} /> : <>
      {q.isPending && (
        <div aria-label={tt("Đang tải…")} className="flex min-h-0 flex-1">
          <ul className="grid w-full content-start gap-3 p-3 md:w-72 md:border-r">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-2.5"><Skeleton className="size-4 rounded-full" /><div className="grid flex-1 gap-1.5"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></li>
            ))}
          </ul>
          <div className="hidden flex-1 gap-3 p-5 md:grid md:content-start"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" /></div>
        </div>
      )}
      {q.isError && (
        <div role="alert" className="grid justify-items-start gap-2 p-5 text-sm">
          <p className="text-error">{tt("Không tải được danh sách phiên.")}</p>
          <Button size="sm" variant="outline" aria-busy={q.isFetching} disabled={q.isFetching} onClick={() => void q.refetch()}>
            <RotateCw /> {tt("Thử lại")}
          </Button>
        </div>
      )}
      {q.isSuccess && all.length === 0 && (
        <div className="grid justify-items-center gap-3 py-20 text-center text-sm text-ink-2 animate-in fade-in-0">
          <AiBot className="size-10" />
          <p>{kind === "deep" ? tt("Chưa có phiên Đối chiếu BE. Bấm nút bộ não trên tin BE trả lời, hoặc “Đối chiếu code” ở mục Đã chốt trong Briefing.")
            : kind === "assist" ? tt("Chưa có phiên Trợ lý AI. Mở một tin, hỏi Trợ lý AI trong khung trả lời: mỗi tin một phiên, lưu ở đây.")
            : tt("Chưa giao việc nào cho AI Agent. Mở một tin, bấm “Giao AI Agent”, chọn dự án.")}</p>
          {kind !== "deep" && <Button size="sm" variant="outline" onClick={() => onOpenGroup(ALL)}>{tt("Mở Việc cần xử lý")}</Button>}
        </div>
      )}
      {q.isSuccess && diffTask && <TaskChanges key={diffTask.id} t={diffTask} onBack={() => setDiffOf(null)} />}
      {q.isSuccess && all.length > 0 && (
        <div className={cn("view-back flex min-h-0 flex-1", diffTask && "hidden")}>
          <aside aria-label={tt("Phiên")} className={cn("flex min-h-0 w-full flex-col md:w-72 md:shrink-0 md:border-r", sel && "max-md:hidden")}>
            <div className="grid shrink-0 gap-2 p-2">
              <span className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input type="search" value={find} onChange={(e) => setFind(e.target.value)} aria-label={tt("Tìm phiên")}
                  placeholder={tt("Tìm theo ID (REF-…) hoặc nội dung")} className="h-8 pl-8 text-xs md:text-xs" />
              </span>
              {!searching && <Segmented id="agent-filter" label={tt("Lọc phiên")} value={filter} onChange={setFilter} className="w-full [&>button]:flex-1"
                items={FILTERS.map(([id, label]) => ({ value: id, label: <>{tMaybe(label)} <span className="font-mono tabular-nums opacity-70">{count[id]}</span></> }))} />}
              {!searching && filter === "done" && rows.length > 0 && (picking ? (
                <div className="flex items-center gap-1.5">
                  <Button size="xs" variant="ghost" onClick={() => setPick(chosen.length === rows.length ? new Set() : new Set(rows.map((t) => t.id)))}>
                    <CheckCheck /> {chosen.length === rows.length ? tt("Bỏ chọn") : tt("Chọn tất cả")}
                  </Button>
                  <span className="flex-1" />
                  <Button size="xs" variant="ghost" disabled={removeMany.isPending} onClick={() => setPick(null)}>{tt("Hủy")}</Button>
                  <Button size="xs" variant="destructive" disabled={!chosen.length || removeMany.isPending} aria-busy={removeMany.isPending}
                    onClick={() => setAskMany(true)}>
                    {removeMany.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} {tt.n("Xóa {n}", { n: <span className="font-mono tabular-nums">{chosen.length}</span> })}
                  </Button>
                </div>
              ) : (
                <Hint text={tt("Chọn nhiều phiên đã xong để xóa một lần")}>
                  <Button size="xs" variant="ghost" className="justify-self-end text-ink-3" onClick={() => setPick(new Set())}><Trash2 /> {tt("Xóa nhiều phiên")}</Button>
                </Hint>
              ))}
            </div>
            <ConfirmDialog open={askMany} onOpenChange={setAskMany} busy={removeMany.isPending} onConfirm={() => removeMany.mutate(chosen.map((t) => t.id))}
              title={tt.n("Xóa {n} phiên đã xong?", { n: <span className="font-mono tabular-nums">{chosen.length}</span> })}
              description={tt("Các phiên này biến khỏi danh sách AI Agent. Không hoàn tác được.")} unit={tt("phiên")}
              confirmLabel={tt.n("Xóa {n} phiên", { n: <span className="font-mono tabular-nums">{chosen.length}</span> })}
              items={chosen.map((t) => ({ id: t.id, tag: sessionId(t), label: t.title || t.message_text || t.prompt }))} />
            <div role="group" aria-label={tt("Danh sách phiên")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <DayGroups items={rows} at={lastAt} open={searching}
                row={(t) => <TaskRow key={t.id} t={t} now={now} active={t.id === cur?.id} mixed={searching}
                  picked={picking ? pick.has(t.id) : undefined} onSelect={() => (picking ? toggle(t.id) : setSel(t.id))} />} />
              {rows.length === 0 && <p className="px-2 py-6 text-center text-xs text-ink-3">{searching ? tt("Không có phiên nào khớp.") : tt("Không có phiên nào khớp bộ lọc.")}</p>}
            </div>
          </aside>
          <div className={cn("min-h-0 min-w-0 flex-1 flex-col", sel ? "flex" : "hidden md:flex")}>
            {cur ? <TaskDetail key={cur.id} t={cur} now={now} onBack={() => setSel(null)} onChanges={() => setDiffOf(cur.id)} onOpenGroup={onOpenGroup} />
              : gone ? (
                <div role="status" className="grid justify-items-start gap-2 p-5 text-sm text-ink-2">
                  <p>{tt("Phiên này không còn (có thể đã bị xóa).")}</p>
                  <Button size="sm" variant="outline" onClick={() => setSel(null)}>{tt("Xem danh sách phiên")}</Button>
                </div>
              ) : <div className="grid flex-1 place-items-center text-sm text-ink-3"><AiBot className="size-10 opacity-60" /></div>}
          </div>
        </div>
      )}
      </>}
    </section>
  );
}

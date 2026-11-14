"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, BrainCircuit, Check, CheckCheck, CircleCheckBig, CircleHelp, CircleX, Copy, CornerDownRight, History, Hourglass, ListChecks, Loader2, type LucideIcon, TriangleAlert } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ModelEffortPicker } from "@/shared/components/ai";
import { AiBotIcon, AiPromptBox, AiResultCard } from "@/shared/components/ai/chat";
import { AiFetching, deepLines, useAiWait } from "@/shared/components/ai/fetching";
import { type Block, groupEvents, type TaskEvent, toolMeta } from "@/shared/components/ai/steps";
import { EventItem, SessionAsks, useTaskLog } from "@/features/telegram/components/tasks-feed";
import { ProjectPicker, useProjects } from "@/shared/components/project-picker";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { IntroNotice } from "@/features/telegram/components/composer-dialogs";
import { api, errorText, type Message, type Task } from "@/shared/lib/api";
import { type Key, t as tNow, useT } from "@/shared/lib/i18n";
import { getMessage, openTask, taskListQuery, useSessionOn } from "@/features/telegram/lib/inbox";
import { copyText, toast } from "@/shared/lib/notifications";
import { aboutMe, readAgentProject, readNotify, setPref, useRole, usesCode } from "@/shared/lib/prefs";
import { timeLabel } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";
import { isBatch, type Verdict, VERDICT_EMOJI, VERDICT_ORDER, verdictsOf } from "@/features/telegram/lib/verdicts";

export { type Verdict, VERDICT_ORDER, verdictsOf };

// The answer to check, plus the question when the caller already knows it (a Briefing item cites both).
// Module state: rows, context panels, Digest rows and Briefing items open the one dialog.
type Target = { m: Message; q?: string };
let target: Target | null = null;
const subs = new Set<() => void>();
const open = (t: Target | null) => { target = t; subs.forEach((f) => f()); };
const useTarget = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => target, () => target);

/** The newest Đối chiếu BE session on this message, if any. */
const useDeepTaskAt = (chatId: string, messageId: string | undefined) => useSessionOn("deep", chatId, messageId).data;
export const useDeepTask = (m: Message) => useDeepTaskAt(m.chat_id, m.message_id);

const HINT: Key = "AI đọc câu hỏi và câu trả lời của BE, rồi soi code dự án: đã làm đúng chưa, còn thiếu gì, cần sửa gì.";

/** Row button: check this message (BE's answer) against the code. Any message: a reply's question is picked for you. */
export function DeepPick({ m, className }: { m: Message; className?: string }) {
  const tt = useT();
  const done = !!useDeepTask(m);
  const code = usesCode(useRole()); // QA / PO have no code folder: a past check still shows as DeepBadge
  if (!code) return null;
  const label = done ? tt("Đối chiếu BE lại") : tt("Đối chiếu BE");
  return (
    <Hint side="bottom" title={label} text={tt(HINT)}>
      <Button type="button" size="icon-xs" variant="ghost" className={cn(done && "text-ok", className)} aria-label={label}
        onClick={(e) => { e.stopPropagation(); open({ m }); }}>
        <BrainCircuit />
      </Button>
    </Hint>
  );
}

/** The session's state as a chip; opens it in AI Agent. */
function TaskChip({ t, className }: { t: Task; className?: string }) {
  const tt = useT();
  return (
    <Hint side="bottom" title={t.running ? tt("Đang đối chiếu BE") : tt("Đã đối chiếu BE")} text={tt("Bấm để xem kết quả ở AI Agent › Đối chiếu BE.")}>
      <button type="button" onClick={(e) => { e.stopPropagation(); openTask(t.id); }}
        className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-xs leading-5 font-medium transition-colors duration-(--dur-micro)",
          t.running ? "bg-info-wash text-info hover:bg-info/20" : "bg-ok-wash text-ok hover:bg-ok/20", className)}>
        {t.running ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <CheckCheck className="size-3" aria-hidden />}
        {t.running ? tt("Đang đối chiếu BE") : tt("Xem đối chiếu BE")}
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
  const tt = useT();
  const t = useDeepTaskAt(chatId, answer);
  const load = useMutation({
    mutationFn: () => getMessage(chatId, answer!),
    onSuccess: (m) => open({ m, q: sorted.length > 1 ? sorted[0] : undefined }),
    onError: (e) => toast({ text: errorText(e, {}, tNow("Không mở được tin gốc, thử lại sau")) }),
  });
  const code = usesCode(useRole());
  if (!answer) return null;
  if (t) return <TaskChip t={t} className={cn("ml-1", className)} />;
  if (!code) return null;
  return (
    <Hint side="bottom" title={tt("Đối chiếu BE")} text={tt(HINT)}>
      <Button type="button" size="xs" variant="ghost" disabled={load.isPending} onClick={() => load.mutate()}
        className={cn("ml-1 h-5 px-1 text-ink-3 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3", className)}>
        {load.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <BrainCircuit aria-hidden />} {tt("Đối chiếu code")}
      </Button>
    </Hint>
  );
}

/** A settled Q&A ("Đã chốt"): check the accepted answer against the code, the question already known. */
export function DeepAnswerAction({ m, q, className }: { m: Message; q: string; className?: string }) {
  const tt = useT();
  const t = useDeepTask(m);
  const code = usesCode(useRole());
  if (t) return <TaskChip t={t} className={className} />;
  if (!code) return null;
  return (
    <Hint side="bottom" title={tt("Đối chiếu BE")} text={tt(HINT)}>
      <Button type="button" size="xs" variant="ghost" className={className} onClick={() => open({ m, q })}>
        <BrainCircuit aria-hidden /> {tt("Đối chiếu BE")}
      </Button>
    </Hint>
  );
}

// Render-time helpers (plain `t`: their callers use `useT`).
const who = (m: Message) => (m.outgoing ? tNow("Bạn") : (m.sender_name ?? "?"));
const body = (m: Message) => m.text || (m.media_kind ? `[${m.media_kind === "photo" ? tNow("ảnh") : "file"}]` : "");

/** Mounted once (inbox): the dialog for the clicked message. */
export function DeepThinking() {
  const t = useTarget();
  useDoneNotice();
  return t ? <DeepDialog key={`${t.m.chat_id}:${t.m.message_id}`} c={t.m} preset={t.q} onClose={() => open(null)} /> : null;
}

// Bulk checks started from the page (id -> group title): when one ends with the page no longer showing it, say so.
const watched = new Map<string, string>();
let onPage: string | null = null;
function useDoneNotice() {
  const ended = useQuery({ ...taskListQuery,
    select: useCallback((l: Task[]) => l.filter((t) => watched.has(t.id) && !t.running), []) }).data;
  useEffect(() => {
    for (const t of ended ?? []) {
      const group = watched.get(t.id);
      watched.delete(t.id);
      if (t.id === onPage) continue; // its page shows the table itself
      const tally = [...verdictsOf(t).values()];
      const sum = VERDICT_ORDER.map((v) => [VERDICT_EMOJI[v], tally.filter((x) => x === v).length] as const).filter(([, n]) => n).map(([e, n]) => `${e}${n}`).join(" ");
      const text = t.result ? `${tNow("Đối chiếu code {group} xong", { group: group ?? "" })}${sum ? `: ${sum}` : ""}` : tNow("Đối chiếu code {group} dừng mà chưa có bảng", { group: group ?? "" });
      toast({ text, action: { label: tNow("Xem"), run: () => openTask(t.id) } });
      if (document.hidden && readNotify()) {
        try {
          const n = new Notification(text, { body: tNow("Bấm để xem bảng đối chiếu ở AI Agent"), tag: `deep:${t.id}` });
          n.onclick = () => { focus(); openTask(t.id); n.close(); };
        } catch {} // no Notification constructor here (Android Chrome, webviews)
      }
    }
  }, [ended]);
}

// ---- in bulk: every BE topic of a digest (Briefing's "Với BE" tab, a group's Tóm tắt) checked in one session -----------
// A detail page over the inbox list (like a reply): pick topics and project, run, watch the AI read the code, read the table.

type BulkItem = { text: string; message_ids: string[]; waiting?: boolean; key?: string }; // key: the topic id
type Bulk = { chatId: string; title: string; items: BulkItem[] };
let bulk: Bulk | null = null;
const openBulk = (b: Bulk | null) => { bulk = b; subs.forEach((f) => f()); };
export const closeBulk = () => { if (bulk) openBulk(null); };
/** The bulk check on screen, if any (the inbox shows its page over the list). */
export const useBulk = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => bulk, () => bulk);
const MAX_BULK = 20; // the server's cap per session
// The question and the latest of the discussion: the server takes ≤10 messages per item.
const cap = (ids: string[]) => {
  const s = [...ids].sort((a, b) => Number(a) - Number(b));
  return s.length > 10 ? [s[0], ...s.slice(-9)] : s;
};

/** "Đối chiếu code N chủ đề": a group's topics with BE (agreed or still waiting), checked against the code in one session. */
export function DeepBulkAction({ chatId, title, items, className }: { chatId: string; title: string; items: BulkItem[]; className?: string }) {
  const tt = useT();
  const list = items.filter((it) => it.message_ids.length);
  const code = usesCode(useRole());
  if (!list.length || !code) return null;
  return (
    <Hint side="bottom" title={tt("Đối chiếu code các chủ đề BE đã trả lời")}
      text={tt("AI soi code dự án với từng chủ đề BE đã trả lời / chốt của nhóm này và trả về một bảng: đã adapt, lệch, chưa làm. Chủ đề còn chờ BE: dùng nút Đối chiếu code trên thẻ của nó.")}>
      <Button type="button" size="xs" variant="outline" className={cn("gap-1 [&_svg]:size-3", className)}
        onClick={(e) => { e.stopPropagation(); openBulk({ chatId, title, items: list }); }}>
        <ListChecks aria-hidden /> {tt("Đối chiếu code {n} chủ đề đã trả lời", { n: list.length })}
      </Button>
    </Hint>
  );
}

/** One topic card's check: its session once there is one (anchored on the topic's newest message), else the button. */
export function DeepTopicAction({ chatId, item }: { chatId: string; item: BulkItem }) {
  const tt = useT();
  const ids = cap(item.message_ids);
  const t = useDeepTaskAt(chatId, ids.at(-1));
  const code = usesCode(useRole());
  if (!ids.length) return null;
  if (t) return <TaskChip t={t} />;
  if (!code) return null;
  return (
    <Hint side="bottom" title={tt("Đối chiếu code")} text={tt("AI soi code dự án với chủ đề này: đã làm đúng chưa, hoặc nếu BE chưa trả lời thì code hiện đang làm gì.")}>
      <Button type="button" size="xs" variant="ghost" className="h-5 px-1 text-ink-3 hover:bg-hl-wash hover:text-hl-2 [&_svg]:size-3"
        onClick={(e) => { e.stopPropagation(); openBulk({ chatId, title: item.text.split("\n")[0], items: [item] }); }}>
        <BrainCircuit aria-hidden /> {tt("Đối chiếu code")}
      </Button>
    </Hint>
  );
}

const VERDICTS = [["✅", "đã adapt"], ["⚠️", "lệch"], ["❌", "chưa làm"], ["⏳", "chờ BE"]] as const satisfies readonly (readonly [string, Key])[];

// ---- verdicts: a finished check's table read back per topic, so Với BE cards show where the code stands -------------

const VERDICT: Record<Verdict, { Icon: LucideIcon; label: Key; tone: string }> = {
  ok: { Icon: CircleCheckBig, label: "đã adapt", tone: "bg-ok-wash text-ok" },
  off: { Icon: TriangleAlert, label: "lệch", tone: "bg-warn-wash text-warn" },
  missing: { Icon: CircleX, label: "chưa làm", tone: "bg-error-wash text-error" },
  waiting: { Icon: Hourglass, label: "chờ BE", tone: "bg-signal-wash text-signal-2" },
  unclear: { Icon: CircleHelp, label: "chưa rõ", tone: "bg-paper-3 text-ink-2" },
};

/** `anchor`: the newest message the check had read (its session sits on it); a topic with a newer one moved on since. */
export type TopicVerdict = { v: Verdict; task: string; at: string; anchor?: number; done?: boolean }; // done: the session was marked Done
/** The topic has messages newer than the check read: its verdict may be out of date. */
export const isStale = (tv: TopicVerdict, ids: string[]) => !!tv.anchor && ids.some((i) => Number(i) > tv.anchor!);
/** Per topic id (or title) of a chat: the newest finished check's verdict (the task list is newest first). */
export function useVerdicts(chatId: string) {
  const pick = useCallback((l: Task[]) => {
    const out = new Map<string, TopicVerdict>();
    for (const t of l) {
      if (t.chat_id !== chatId || t.running) continue;
      for (const [title, v] of verdictsOf(t)) if (!out.has(title)) out.set(title, { v, task: t.id, at: t.created_at, anchor: t.message_id ? Number(t.message_id) : undefined, done: t.handled });
    }
    return out;
  }, [chatId]);
  return useQuery({ ...taskListQuery, select: pick }).data;
}

/** "Code: lệch" — where the code stood at the last check; `open` makes it a button to that session. */
export function VerdictChip({ tv, open: openIt, stale, className }: { tv: TopicVerdict; open?: boolean; stale?: boolean; className?: string }) {
  const tt = useT();
  const { Icon, tone } = VERDICT[tv.v], label = tt(VERDICT[tv.v].label);
  const chip = cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-xs leading-5 font-medium", tone,
    stale && "opacity-60 ring-1 ring-current/30 ring-inset", className);
  const body = <><Icon className="size-3" aria-hidden />Code: {label}{stale && <span className="font-normal"> · {tt("cũ")}</span>}</>;
  if (!openIt) return <span className={chip}>{body}</span>;
  return (
    <Hint side="bottom" title={`Code: ${label}${stale ? ` (${tt("cũ")})` : ""}`}
      text={`${tt("Theo lần đối chiếu {time}.", { time: timeLabel(tv.at) })}${stale ? ` ${tt("Chủ đề có tin mới sau đó, nên đối chiếu lại.")}` : ""} ${tt("Bấm để xem bảng và bằng chứng ở AI Agent.")}`}>
      <button type="button" className={cn(chip, "transition-[filter] duration-(--dur-micro) hover:brightness-110")}
        onClick={(e) => { e.stopPropagation(); openTask(tv.task); }}>{body}</button>
    </Hint>
  );
}

/** "✅ 3 · ⚠️ 1 · ❌ 1": a check's verdicts counted. */
export function VerdictTally({ vs, className }: { vs: Verdict[]; className?: string }) {
  if (!vs.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {VERDICT_ORDER.map((v) => [v, vs.filter((x) => x === v).length] as const).filter(([, n]) => n).map(([v, n]) => {
        const { Icon, tone } = VERDICT[v];
        return <span key={v} className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 text-xs leading-5 font-medium tabular-nums", tone)}><Icon className="size-3" aria-hidden />{n}</span>;
      })}
    </span>
  );
}
/** What the agent is doing right now, from the session's log (the AI Agent one): "Đang đọc PaymentScreen.kt · 23 bước". */
function LiveStep({ items }: { items?: TaskEvent[] }) {
  const tt = useT();
  const tools = items?.filter((e) => e.kind === "tool") ?? [];
  if (!tools.length) return <p className="h-5 text-xs text-ink-3">{tt("Đang khởi động phiên AI Agent…")}</p>;
  const [name, ...rest] = tools.at(-1)!.text.split("  ");
  const [Icon, , doing] = toolMeta(name);
  const arg = rest.join("  ");
  const file = arg.startsWith("/") ? arg.slice(arg.lastIndexOf("/") + 1) : arg;
  return (
    <p key={tools.length} className="flex h-5 max-w-full min-w-0 items-center gap-1.5 text-xs text-ink-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
      <Icon className="size-3.5 shrink-0 text-hl-2" aria-hidden />
      <span className="shrink-0">{doing}</span>
      <span className="min-w-0 truncate font-mono text-ink" title={arg}>{file}</span>
      <span className="shrink-0 font-mono text-ink-3 tabular-nums">· {tt("{n} bước", { n: tools.length })}</span>
    </p>
  );
}

/** One Đối chiếu session followed live (the bulk page and the one-message dialog alike): run state, log, answer, stop. */
function useDeepRun(taskId: string | null) {
  const qc = useQueryClient();
  const task = useQuery({ ...taskListQuery, select: useCallback((l: Task[]) => l.find((t) => t.id === taskId), [taskId]), enabled: !!taskId }).data;
  const running = !!taskId && (!task || task.running); // the log ending refetches the list (useTaskLog), so this flips soon after
  const items = useTaskLog(taskId, running).data?.items;
  // The last turn as the AI Agent session shows it (its texts, then the result card with asks and timeline), tools aside.
  const turn = useMemo(() => {
    const b = groupEvents(items ?? []);
    return b.slice(b.findLastIndex((x) => x.kind === "event" && x.ev.kind === "user") + 1)
      .filter((x): x is Extract<Block, { kind: "event" }> => x.kind === "event");
  }, [items]);
  const shown = useAiWait(running);
  const done = !!taskId && !shown && !!task && !task.running;
  const stop = useMutation({
    mutationFn: () => api<void>(`/tasks/${taskId}/stop`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => toast({ text: errorText(e, {}, tNow("Không dừng được, thử lại sau")) }),
  });
  return { task, running, items, turn, shown, done, stop };
}
type DeepRun = ReturnType<typeof useDeepRun>;

/** A run on screen: the AI reading the code while it runs (`children`: what it reads), then its answer. */
function DeepProgress({ dr, project, lines, children }: { dr: DeepRun; project?: string; lines: string[]; children?: ReactNode }) {
  const tt = useT();
  const { task, turn } = dr;
  if (dr.shown) return (
    <div className="grid justify-items-center gap-3">
      <AiFetching kind="deep" project={project} className="min-h-0 py-2 [&_[role=status]]:w-auto"
        lines={lines} />
      <LiveStep items={dr.items} />
      {children}
      <p className="text-center text-xs text-ink-3">{tt("Chạy ngầm: có thể rời đi, kết quả nằm ở AI Agent › Đối chiếu BE.")}</p>
    </div>
  );
  if (!dr.done || !task) return null;
  // the list's result if the log lags behind it
  const shown = turn.length ? turn : task.result?.trim() ? [{ kind: "event" as const, ev: { kind: "result", text: task.result } }] : [];
  return shown.length ? (
    <SessionAsks t={task}>
      <ul aria-label={tt("Kết quả đối chiếu")} className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {shown.map((x, i) => <EventItem key={i} ev={x.ev} took={"took" in x ? x.took : undefined} tools={"tools" in x ? x.tools : undefined} />)}
      </ul>
      <div className="-mt-3 flex flex-wrap justify-end gap-1">
        {task.result && <Button size="xs" variant="ghost" onClick={() => void copyText(task.result!, tt("Đã copy kết quả đối chiếu"))}><Copy aria-hidden /> Copy</Button>}
        <Button size="xs" variant="outline" onClick={() => openTask(task.id)}><AiBotIcon aria-hidden /> {tt("Hỏi tiếp ở AI Agent")}</Button>
      </div>
    </SessionAsks>
  ) : (
    <AiResultCard error title={tt("Phiên dừng mà chưa có kết quả")}
      actions={<Button size="xs" variant="outline" onClick={() => openTask(task.id)}><AiBotIcon aria-hidden /> {tt("Xem phiên")}</Button>}>
      {tt("Phiên bị dừng hoặc lỗi giữa chừng. Mở phiên để xem bước cuối, hoặc bấm Đối chiếu lại.")}
    </AiResultCard>
  );
}

export function DeepBulkPage({ b, onClose }: { b: Bulk; onClose: () => void }) {
  const tt = useT();
  const [off, setOff] = useState(() => new Set(b.items.map((_, i) => i).filter((i) => i >= MAX_BULK)));
  const picked = b.items.filter((_, i) => !off.has(i));
  const flip = (i: number) => setOff((s) => { const n = new Set(s); if (!n.delete(i)) n.add(i); return n; });
  const [project, setProject] = useState(readAgentProject);
  const projects = useProjects();
  const proj = projects.data?.find((p) => p.path === project);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  // Back on the page while this group's check still runs: pick its scene up again instead of starting over.
  const [taskId, setTaskId] = useState<string | null>(() =>
    qc.getQueryData<Task[]>(taskListQuery.queryKey)?.find((t) => t.chat_id === b.chatId && t.running && isBatch(t))?.id ?? null);
  const verdicts = useVerdicts(b.chatId);
  const vOf = (it: BulkItem) => verdicts?.get(it.key ?? "") ?? verdicts?.get(it.text.split("\n")[0]);
  const staleOf = (it: BulkItem) => !!vOf(it) && isStale(vOf(it)!, it.message_ids);
  const last = useQuery({ ...taskListQuery,
    select: useCallback((l: Task[]) => l.find((t) => t.chat_id === b.chatId && !t.running && isBatch(t) && !!t.result), [b.chatId]) }).data;
  const adapted = b.items.map((it, i) => [it, i] as const).filter(([it, i]) => !off.has(i) && vOf(it)?.v === "ok" && !staleOf(it)).map(([, i]) => i);
  const chooseProject = (p: string) => { setProject(p); setPref("agentProject", p); };
  const dr = useDeepRun(taskId);
  const { running, done, stop } = dr;
  const waiting = b.items.filter((it) => it.waiting).length;

  const run = useMutation({
    mutationFn: () => api<{ id: string }>("/ai/deep-batch", { method: "POST",
      json: { chat_id: b.chatId, items: picked.map((it) => ({ text: it.text.slice(0, 1000), message_ids: cap(it.message_ids), waiting: !!it.waiting, key: it.key ?? "" })),
        project, instruction: note.trim(), ...aboutMe() } }),
    onSuccess: async ({ id }) => { watched.set(id, b.title); setTaskId(id); await qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });
  useEffect(() => { onPage = taskId; return () => { onPage = null; }; }, [taskId]);
  const leave = () => {
    if (running && taskId) toast({ text: tNow("Đối chiếu vẫn chạy ngầm ở AI Agent"), action: { label: tNow("Xem"), run: () => openTask(taskId) } });
    onClose();
  };
  const blocker = !proj ? tt("Chọn dự án để AI đọc code") : !picked.length ? tt("Chọn ít nhất một chủ đề")
    : picked.length > MAX_BULK ? tt("Tối đa {n} chủ đề mỗi lần", { n: MAX_BULK }) : null;
  const go = () => { if (!blocker && !run.isPending && !running) run.mutate(); };

  return (
    <section aria-label={tt("Đối chiếu code")} className="flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2 md:px-5">
        <Hint side="bottom" text={tt("Quay lại Briefing")}>
          <Button size="icon-sm" variant="ghost" onClick={leave} aria-label={tt("Quay lại")}><ArrowLeft /></Button>
        </Hint>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-hl-wash text-hl-2"><ListChecks className="size-4" aria-hidden /></span>
        <div className="grid min-w-0 gap-0.5">
          <h2 className="truncate text-sm font-bold text-ink">{tt("Đối chiếu code")} · {b.title}</h2>
          <p className="truncate text-xs text-ink-3">
            {tt("{n} chủ đề với BE", { n: b.items.length })}{waiting > 0 && <> · <span className="text-signal-2">{tt("{n} chờ BE", { n: waiting })}</span></>}
            <span className="max-sm:hidden"> · {tt("AI soi code dự án, trả về bảng {verdicts}", { verdicts: VERDICTS.map(([e, l]) => `${e} ${tt(l)}`).join(", ") })}</span>
          </p>
        </div>
        {taskId && (
          <Hint side="bottom" text={tt("Mở phiên ở AI Agent để xem từng bước hoặc hỏi tiếp")}>
            <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={() => openTask(taskId)}>
              <AiBotIcon aria-hidden /> <span className="max-sm:hidden">{tt("Mở ở AI Agent")}</span>
            </Button>
          </Hint>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto grid max-w-3xl grid-cols-1 gap-5">
          {dr.shown || done ? (
            <DeepProgress dr={dr} project={proj?.name} lines={deepLines(proj?.name, picked.length)}>
              <ul aria-label={tt("Chủ đề đang soi")} className="flex max-w-full flex-wrap justify-center gap-1.5">
                {picked.map((it, i) => (
                  <li key={i} className="fx-step max-w-56 truncate rounded-full border border-rule bg-paper-2 px-2 text-xs leading-6 text-ink-2"
                    style={{ "--fx-d": `${Math.max(4, picked.length * 0.6)}s`, animationDelay: `${i * 0.6}s` } as CSSProperties}>
                    {it.waiting ? "⏳ " : ""}{it.text.split("\n")[0]}
                  </li>
                ))}
              </ul>
            </DeepProgress>
          ) : (
            <>
              {last && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-card)] border border-rule bg-paper-2 px-3 py-2 text-xs text-ink-2">
                  <History className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                  <span>{tt("Lần đối chiếu trước")} · {timeLabel(last.created_at)}</span>
                  <VerdictTally vs={[...verdictsOf(last).values()]} />
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => setTaskId(last.id)}>{tt("Xem bảng")}</Button>
                </div>
              )}
              <section aria-label={tt("Chủ đề sẽ đối chiếu")} className="grid gap-2">
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  <span>{tt("Chủ đề sẽ soi")} · <b className="font-bold text-ink-2 tabular-nums">{picked.length}</b>/{b.items.length}</span>
                  {adapted.length > 0 && (
                    <Hint side="bottom" text={tt("Bỏ chọn các chủ đề lần trước code đã adapt và chưa có tin mới, chỉ soi lại phần còn lệch / chưa làm / chờ BE")}>
                      <button type="button" className="rounded-sm text-ok hover:underline" onClick={() => setOff((s) => new Set([...s, ...adapted]))}>
                        {tt("Bỏ {n} chủ đề đã adapt", { n: adapted.length })}
                      </button>
                    </Hint>
                  )}
                  {b.items.length > 1 && (
                    <button type="button" className="ml-auto rounded-sm hover:text-ink hover:underline"
                      onClick={() => setOff(picked.length ? new Set(b.items.map((_, i) => i)) : new Set())}>
                      {picked.length ? tt("Bỏ chọn hết") : tt("Chọn hết")}
                    </button>
                  )}
                </div>
                <ul className="grid gap-1.5">
                  {b.items.map((it, i) => {
                    const on = !off.has(i);
                    const [head, ...rest] = it.text.split("\n");
                    return (
                      <li key={i}>
                        <button type="button" aria-pressed={on} onClick={() => flip(i)}
                          className={cn("flex w-full min-w-0 items-start gap-3 rounded-[var(--radius-card)] border px-3 py-2.5 text-left transition-colors duration-(--dur-micro)",
                            on ? "border-rule bg-cotton hover:border-hl/50" : "border-dashed border-rule-2 bg-transparent opacity-55 hover:opacity-100")}>
                          <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors duration-(--dur-short)",
                            on ? "border-hl bg-hl text-hl-ink" : "border-rule-2 text-transparent")}>
                            <Check className="size-3" strokeWidth={3} aria-hidden />
                          </span>
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 font-mono text-xs text-ink-3 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                              <span className="min-w-0 truncate text-sm font-medium text-ink">{head}</span>
                            </span>
                            {rest[0] && <span className="line-clamp-1 text-xs text-ink-3">{rest[0]}</span>}
                          </span>
                          {vOf(it) && !(it.waiting && vOf(it)!.v === "waiting") && <VerdictChip tv={vOf(it)!} stale={staleOf(it)} className="max-sm:hidden" />}
                          {it.waiting
                            ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-signal-wash px-1.5 text-xs leading-5 font-medium text-signal-2"><Hourglass className="size-3" aria-hidden />{tt("Chờ BE")}</span>
                            : <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ok-wash px-1.5 text-xs leading-5 font-medium text-ok"><CircleCheckBig className="size-3" aria-hidden />{tt("Đã chốt")}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
              <section aria-label={tt("Dự án")} className="grid gap-2">
                <span className="text-xs text-ink-3">{tt("Dự án để AI đọc code")}</span>
                <ProjectPicker value={project} onChange={chooseProject} className="max-w-full min-w-40" />
                <IntroNotice compact />
              </section>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pt-2 pb-4 sm:px-6">
        <div className="mx-auto grid max-w-3xl gap-1.5">
          {run.isError && (
            <p role="alert" className="text-sm text-error">
              {errorText(run.error, {
                project_not_found: tt("Dự án không còn trong danh sách, hãy chọn lại."),
                ai_agent_missing: tt("Không tìm thấy AI CLI để đọc dự án, xem Cài đặt › AI."),
                ai_not_configured: tt("Chưa cấu hình AI, xem Cài đặt › AI."),
                message_not_found: tt("Không đọc được tin gốc của các chủ đề (cần đang kết nối Telegram)."),
                ai_context_too_large: tt("Các chủ đề quá dài; bỏ bớt chủ đề hoặc đối chiếu từng chủ đề trên thẻ của nó."),
              }, tt("Không chạy được đối chiếu."))}
            </p>
          )}
          <AiPromptBox aria-label={tt("Yêu cầu thêm")} placeholder={tt("Yêu cầu thêm (tùy chọn), ví dụ: chỉ xét màn thanh toán")} maxLength={2000}
            value={note} onChange={setNote} onSend={go} running={running || run.isPending}
            onStop={taskId ? () => stop.mutate() : undefined} stopping={stop.isPending} stopHint={tt("Dừng đối chiếu")} stopLabel={tt("Dừng")}
            tools={<>
              <ModelEffortPicker kind="task" compact className="gap-x-2 text-xs" />
              {blocker && !running && <span className="text-ink-3">{blocker}</span>}
            </>}
            actions={!running && (
              <Hint text={tt("Giao AI Agent đối chiếu các chủ đề với code dự án (Enter)")} side="bottom">
                <Button type="button" size="sm" className="rounded-full bg-hl text-hl-ink hover:brightness-110" aria-busy={run.isPending}
                  disabled={!!blocker || run.isPending} onClick={go}>
                  {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ListChecks aria-hidden />}
                  {done ? tt("Đối chiếu lại {n} chủ đề", { n: picked.length }) : tt("Đối chiếu {n} chủ đề", { n: picked.length })}
                </Button>
              </Hint>
            )} />
        </div>
      </div>
    </section>
  );
}

/** One message of the pair, as a card: what it is, who said it, all of its text. */
function Said({ m, label, tone, action, children }: {
  m?: Message; label: string; tone: string; action?: ReactNode; children?: ReactNode;
}) {
  return (
    <section aria-label={label} className="grid gap-1.5 rounded-[var(--radius-card)] border border-rule bg-cotton p-3">
      <header className="flex min-w-0 items-center gap-2 text-xs">
        <span className={cn("shrink-0 rounded-full px-2 leading-5 font-bold", tone)}>{label}</span>
        {m && <b className="truncate font-bold text-ink">{who(m)}</b>}
        {m && <span className="shrink-0 font-mono tabular-nums text-ink-3">{timeLabel(m.date)}</span>}
        {m && <span className="shrink-0 font-mono tabular-nums text-ink-3">#{m.message_id}</span>}
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </header>
      {children ?? (m && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{body(m)}</p>)}
    </section>
  );
}

function DeepDialog({ c, preset, onClose }: { c: Message; preset?: string; onClose: () => void }) {
  // Question candidates, live: the known question (however old) first, then the messages right before the answer.
  const tt = useT();
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
  const proj = projects.data?.find((p) => p.path === project);
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const chooseProject = (p: string) => { setProject(p); setPref("agentProject", p); };
  // A read-only AI Agent session, followed here like the bulk page (scene, then the answer); closing leaves it running.
  const [taskId, setTaskId] = useState<string | null>(null);
  const dr = useDeepRun(taskId);
  const run = useMutation({
    mutationFn: () => api<{ id: string }>("/ai/deep", { method: "POST",
      json: { chat_id: c.chat_id, question_id: qId, confirm_id: c.message_id, project, instruction: note.trim(), ...aboutMe() } }),
    onSuccess: async ({ id }) => { setTaskId(id); await qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });
  const close = () => {
    if (dr.running && taskId) toast({ text: tNow("Đối chiếu vẫn chạy ngầm, xong sẽ có nhãn xanh trên tin"), action: { label: tNow("Xem"), run: () => openTask(taskId) } });
    onClose();
  };
  const showList = picking || (before.isSuccess && !q);
  const blocker = !q ? tt("Chọn tin hỏi") : !proj ? tt("Chọn dự án để AI đọc code") : null;
  const go = () => { if (!blocker && !run.isPending && !dr.running) run.mutate(); };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className={cn("ai-in flex max-h-[calc(100dvh-2.5rem)] flex-col gap-4", taskId ? "sm:max-w-3xl" : "sm:max-w-xl")}>
        <div className="grid gap-1">
          <DialogTitle className="flex items-center gap-2"><BrainCircuit className="size-4 text-ink-3" aria-hidden /> {tt("Đối chiếu BE")}</DialogTitle>
          <DialogDescription>{tt(HINT)}</DialogDescription>
        </div>

        {taskId ? (
          <div className="@container grid min-h-0 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto">
            <DeepProgress dr={dr} project={proj?.name} lines={deepLines(proj?.name)} />
          </div>
        ) : <>
        <div className="grid min-h-0 gap-1 overflow-y-auto">
          <Said m={showList ? undefined : q} label={tt("1 · Câu hỏi")} tone="bg-info-wash text-info"
            action={q && (
              <Button type="button" size="xs" variant="ghost" className="-my-1 h-6" onClick={() => setPicking((v) => !v)}>
                {picking ? tt("Giữ tin này") : tt("Đổi tin hỏi")}
              </Button>
            )}>
            {before.isPending ? (
              <p className="inline-flex items-center gap-1.5 text-sm text-ink-3"><Loader2 className="size-3.5 animate-spin" aria-hidden /> {tt("Đang tìm câu hỏi…")}</p>
            ) : before.isError ? (
              <p role="alert" className="flex items-center gap-2 text-sm text-error">
                {tt("Không lấy được tin (cần đang kết nối Telegram).")}
                <Button type="button" size="xs" variant="outline" onClick={() => void before.refetch()}>{tt("Thử lại")}</Button>
              </p>
            ) : showList ? (
              <div className="grid gap-1.5">
                <p className="text-xs text-ink-3">{tt("Tin nào là câu hỏi gửi BE?")}</p>
                <ul aria-label={tt("Chọn tin hỏi")} className="grid max-h-64 gap-0.5 overflow-y-auto">
                  {candidates.map((m) => (
                    <li key={m.message_id}>
                      <button type="button" aria-pressed={m.message_id === qId} onClick={() => { setChosen(m.message_id); setPicking(false); }}
                        className={cn("grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-(--dur-micro) hover:bg-paper-3",
                          m.message_id === qId && "bg-hl-wash")}>
                        <span className="flex items-center gap-1.5 text-ink-3">
                          <b className="font-bold text-ink">{who(m)}</b>
                          <span className="font-mono tabular-nums">{timeLabel(m.date)}</span>
                          <span className="font-mono tabular-nums">#{m.message_id}</span>
                          {m.message_id === c.reply_to_id && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-hl-wash px-1.5 text-hl-2"><CornerDownRight className="size-3" aria-hidden /> {tt("được trả lời")}</span>
                          )}
                        </span>
                        <span className="line-clamp-2 text-sm text-ink">{m.text}</span>
                      </button>
                    </li>
                  ))}
                  {!candidates.length && <li className="px-2 text-sm text-ink-3">{tt("Không có tin nào trước tin này.")}</li>}
                </ul>
              </div>
            ) : undefined}
          </Said>
          <ArrowDown className="mx-auto size-4 text-ink-3" aria-hidden />
          <Said m={c} label={tt("2 · BE trả lời")} tone="bg-ok-wash text-ok" />
        </div>

        <div className="grid gap-2">
          <ProjectPicker value={project} onChange={chooseProject} className="max-w-full min-w-40" />
          <IntroNotice compact />
        </div>
        </>}

        {run.isError && (
          <p role="alert" className="text-sm text-error">
            {errorText(run.error, {
              project_not_found: tt("Dự án không còn trong danh sách, hãy chọn lại."),
              ai_agent_missing: tt("Không tìm thấy AI CLI để đọc dự án, xem Cài đặt › AI."),
              ai_not_configured: tt("Chưa cấu hình AI, xem Cài đặt › AI."),
              message_not_found: tt("Không đọc được một trong hai tin (cần đang kết nối Telegram)."),
              ai_context_too_large: tt("Hai tin quá dài."),
            }, tt("Không chạy được Đối chiếu BE."))}
          </p>
        )}

        <AiPromptBox aria-label={tt("Yêu cầu thêm")} placeholder={tt("Yêu cầu thêm (tùy chọn), ví dụ: chỉ xét màn thanh toán")} maxLength={2000}
          value={note} onChange={setNote} onSend={go} running={dr.running || run.isPending}
          onStop={taskId ? () => dr.stop.mutate() : undefined} stopping={dr.stop.isPending} stopHint={tt("Dừng đối chiếu")} stopLabel={tt("Dừng")}
          tools={<>
            <ModelEffortPicker kind="task" compact className="gap-x-2 text-xs" />
            {blocker && !before.isPending && !dr.running && <span className="text-ink-3">{blocker}</span>}
          </>}
          actions={!dr.running && (
            <Hint text={tt("Giao AI Agent đối chiếu câu trả lời của BE với code dự án (Enter)")} side="bottom">
              <Button type="button" size="sm" className="rounded-full bg-hl text-hl-ink hover:brightness-110" aria-busy={run.isPending}
                disabled={!!blocker || run.isPending} onClick={go}>
                {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <BrainCircuit aria-hidden />} {dr.done ? tt("Đối chiếu lại") : tt("Phân tích")}
              </Button>
            </Hint>
          )} />
      </DialogContent>
    </Dialog>
  );
}

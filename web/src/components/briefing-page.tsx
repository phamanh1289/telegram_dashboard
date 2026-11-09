"use client";

import { Popover } from "@base-ui/react/popover";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheckBig, ClipboardList, Copy, GitCompareArrows, ListTodo, Loader2,
  type LucideIcon, MessageCircleQuestion, Plus, RotateCw, Send, ShieldCheck, Sparkles, Sun, Trash2, TriangleAlert, UserRound, Users,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ModelEffortPicker } from "@/components/ai";
import { AiBot, AiPromptBox, AiResultCard, AiStop, AiThinking, AiWriting, UserBubble, useFollow } from "@/components/ai/chat";
import { AiFetching, useAiWait } from "@/components/ai/fetching";
import { Avatar, railHide } from "@/components/chat-list";
import { DeepItemAction } from "@/components/deep-think";
import { NavPill } from "@/components/shell";
import { digestError, ItemActions, Tickets, toMarkdown } from "@/components/digest-page";
import { Markdown } from "@/components/markdown";
import { TicketChip } from "@/components/message-item";
import { useOpenSimilar } from "@/components/ticket-form";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { WeekStatsCard } from "@/components/week-stats";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiStream, type BriefingItem, type DigestItem, type DigestResult, errorText, type GroupInfo, type Message, statusQuery } from "@/lib/api";
import { copyText, toast } from "@/lib/inbox";
import { isString, put, readDigestTeams, readIntro, readList, useRole } from "@/lib/prefs";
import { timeLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import { yt } from "@/lib/yt";

// Layout: header, a strip of group chips (status + filter), then two panes that scroll on their own: the to-do feed
// and the AI assistant (on phones one at a time). The page itself never scrolls.

type RunState = { status: "running" | "done" | "error"; error?: string };

/** Every followed group with its latest digest (shared by the page and the sidebar's Briefing tab). */
export const briefingQuery = {
  queryKey: ["briefing"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<BriefingItem[]>("/briefing", { signal }),
};

// The batch run lives outside the page: switching to another view (to triage tags meanwhile) keeps it going, and coming
// back shows its progress. Stop is explicit (AiStop), or the tab closing.
type BriefRun = { runs: Record<string, RunState>; batch: { done: number; total: number } | null };
let brief: BriefRun = { runs: {}, batch: null };
let briefStop: AbortController | null = null;
const briefSubs = new Set<() => void>();
const setBrief = (f: (b: BriefRun) => BriefRun) => { brief = f(brief); briefSubs.forEach((n) => n()); };
const subBrief = (f: () => void) => { briefSubs.add(f); return () => { briefSubs.delete(f); }; };
/** The Briefing batch (per-group status, progress; `batch` null: nothing running), wherever it is read. */
export const useBriefRun = () => useSyncExternalStore(subBrief, () => brief, () => brief);
const stopBrief = () => briefStop?.abort();

/** One group at a time: keeps the AI provider and Telegram calm, and each result lands as it comes.
 *  Aborting is the stop: the server sees the request go and kills that AI run. */
async function runBrief(qc: QueryClient, groups: BriefingItem[]) {
  if (brief.batch) return; // one batch at a time
  const stop = (briefStop = new AbortController()).signal;
  setBrief((b) => ({ ...b, batch: { done: 0, total: groups.length } }));
  const until = new Date().toISOString();
  const teams = readDigestTeams();
  const status = (id: string, r: RunState) => setBrief((b) => ({ ...b, runs: { ...b.runs, [id]: r } }));
  for (const it of groups) {
    if (stop.aborted) break;
    status(it.chat_id, { status: "running" });
    try {
      await api<DigestResult>("/digest", {
        method: "POST",
        json: {
          chat_id: it.chat_id,
          since: it.saved?.last_date ?? new Date(Date.now() - 24 * 3_600_000).toISOString(),
          until,
          message_ids: [],
          after_id: it.saved ? Number(it.saved.last_message_id) : null,
          teams,
          intro: readIntro(),
        },
        signal: stop,
      });
      status(it.chat_id, { status: "done" });
    } catch (e) {
      status(it.chat_id, { status: "error", error: stop.aborted ? "Đã dừng." : digestError(e) });
    }
    setBrief((b) => ({ ...b, batch: b.batch && { ...b.batch, done: b.batch.done + 1 } }));
    void qc.invalidateQueries({ queryKey: ["digest-saved", it.chat_id] });
    void qc.invalidateQueries({ queryKey: ["briefing"] }); // each group fills in as its digest lands
    void qc.invalidateQueries({ queryKey: ["briefing-answered"] });
  }
  setBrief((b) => ({ ...b, batch: null }));
}

/** Telegram has messages newer than the last digest (or there was none yet). */
export const hasNews = (i: BriefingItem) =>
  i.latest_id !== null && i.latest_id !== undefined && (!i.saved || Number(i.latest_id) > Number(i.saved.last_message_id));

const EASE = [0.16, 1, 0.3, 1] as const; // --ease-out
const ROW_MOTION = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } },
  exit: { opacity: 0, x: 24, transition: { duration: 0.16 } },
} as const;
const FADE = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.18, ease: EASE } } as const;

// ---- to-do items: every group's latest digest in one list ------------------------------------------------------------

type Kind = "confirmations" | "actions" | "decisions" | "changes";
type Tab = "mine" | Kind;
type Todo = DigestItem & { kind: Kind; chat: BriefingItem; key: string; mine: boolean; replied: boolean };
const KINDS = ["confirmations", "actions", "decisions", "changes"] as const;
// One hue per kind, the same on its tab, its icon and in Saved Messages. Confirmations need you: the signal amber.
const KIND: Record<Kind, { label: string; Icon: LucideIcon; tone: string; dot: string; tg: string }> = {
  confirmations: { label: "Cần confirm", Icon: MessageCircleQuestion, tone: "bg-signal-wash text-signal-2", dot: "bg-signal", tg: "❓ Cần confirm" },
  actions: { label: "Việc cần làm", Icon: ListTodo, tone: "bg-info-wash text-info", dot: "bg-info", tg: "📌 Việc cần làm" },
  decisions: { label: "Đã chốt", Icon: CircleCheckBig, tone: "bg-ok-wash text-ok", dot: "bg-ok", tg: "✅ Đã chốt" },
  changes: { label: "Thay đổi", Icon: GitCompareArrows, tone: "bg-code-wash text-code", dot: "bg-code", tg: "🔄 Thay đổi" },
};

// Handled marks, per browser, refs only (chat, kind, message ids; a hash when an item cites none): never the text.
const DONE = "briefDone";
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36);
const todoKey = (chat: string, kind: Kind, it: DigestItem) => `${chat}:${kind}:${it.message_ids?.length ? it.message_ids.join(",") : hash(it.text)}`;

function useDone() {
  const [done, setDone] = useState<Set<string>>(() => new Set(readList(DONE, [], isString)));
  const toggle = (key: string) => setDone((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    put(DONE, JSON.stringify([...next].slice(-500))); // ponytail: oldest marks drop off past 500
    return next;
  });
  return [done, toggle] as const;
}

function meta(t: Todo) {
  if (t.kind === "confirmations") return t.who && `hỏi ${t.who}`;
  if (t.kind === "decisions") return t.who && `chốt bởi ${t.who}`;
  if (t.kind === "actions") return t.who;
  return "";
}

// Saved Messages: Telegram's markdown has bold / italic only, no headings or lists.
const tgText = (md: string) => md.replace(/^#{1,6}\s+(.+)$/gm, "**$1**").replace(/^(\s*)[-*]\s+/gm, "$1• ");
function tgBriefing(open: Todo[]) {
  const out = [`**Briefing ${timeLabel(new Date().toISOString(), true)}**`];
  for (const c of new Set(open.map((t) => t.chat))) {
    out.push("", `**${c.title}**`);
    for (const k of KINDS) {
      const its = open.filter((t) => t.chat === c && t.kind === k);
      if (its.length) out.push(KIND[k].tg, ...its.map((t) => {
        const extra = [meta(t), t.due && `hạn ${t.due}`, ...(t.tickets ?? [])].filter(Boolean).join(", ");
        return `• ${t.text}${extra ? ` — ${extra}` : ""}`;
      }));
    }
  }
  if (!open.length) out.push("", "Không còn mục nào cần xử lý.");
  return out.join("\n");
}

/** "Trả lời" / "Tạo ticket"; a to-do with no ticket is checked against YouTrack: a likely match is shown, else creating one is suggested. */
function TodoActions({ t, onCreated }: { t: Todo; onCreated: () => void }) {
  const ytOn = useQuery({ ...statusQuery, staleTime: Infinity }).data?.youtrack_configured; // the shell keeps it fresh
  const check = !!ytOn && t.kind === "actions" && !t.tickets?.length;
  const similar = useOpenSimilar(t.text, { enabled: check });
  const hit = similar.data?.[0];
  return (
    <>
      {hit && <span className="inline-flex items-center gap-1">có thể đã có <TicketChip id={hit.id} /></span>}
      <ItemActions chatId={t.chat.chat_id} ids={t.message_ids ?? []} text={t.text} suggest={check && similar.isSuccess && !hit} onCreated={onCreated} />
    </>
  );
}

const TOPIC: Record<string, [string, string]> = { decided: ["đã chốt", "text-ok"], open: ["đang bàn", "text-signal-2"], dropped: ["bỏ", "text-ink-3"] };

/** Why an item says what it says: the AI's context, the topic it belongs to, and the cited messages read live from Telegram. */
function TodoDetail({ t, onOpen }: { t: Todo; onOpen: () => void }) {
  const ids = (t.message_ids ?? []).slice(0, 40);
  const ev = useQuery({
    queryKey: ["evidence", t.chat.chat_id, ids],
    queryFn: ({ signal }) => api<Message[]>(`/chats/${t.chat.chat_id}/evidence?${ids.map((i) => `ids=${i}`).join("&")}`, { signal }),
    enabled: ids.length > 0, staleTime: 10 * 60_000,
  });
  // The topic citing most of the same messages.
  const overlap = (x: string[] = []) => x.filter((i) => ids.includes(i)).length;
  const topic = [...(t.chat.saved?.result.topics ?? [])].sort((a, b) => overlap(b.message_ids) - overlap(a.message_ids))
    .find((x) => overlap(x.message_ids) > 0);
  const cited = new Set(ids);
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: EASE }}
      className="overflow-hidden">
      <div className="mt-1.5 grid gap-3 rounded-lg border border-rule bg-cotton/60 p-3 text-xs">
        {t.why && (
          <div className="grid gap-0.5">
            <p className="font-medium text-ink-3">Bối cảnh</p>
            <p className="text-sm leading-relaxed text-ink-2">{t.why}</p>
          </div>
        )}
        {topic && (
          <div className="grid gap-0.5">
            <p className="font-medium text-ink-3">Chủ đề <span className={TOPIC[topic.status ?? "open"]?.[1]}>· {TOPIC[topic.status ?? "open"]?.[0]}</span></p>
            <p className="text-sm leading-relaxed text-ink-2"><b className="font-semibold text-ink">{topic.title}</b>{topic.summary && `: ${topic.summary}`}</p>
          </div>
        )}
        <div className="grid gap-1.5">
          <p className="flex items-center gap-2 font-medium text-ink-3">
            Tin nhắn liên quan {ev.data && <span className="font-mono tabular-nums">{ev.data.length}</span>}
            <button type="button" onClick={onOpen} className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-sm font-normal whitespace-nowrap hover:text-ink hover:underline">
              Xem cả nhóm <ArrowUpRight className="size-3" aria-hidden />
            </button>
          </p>
          {!ids.length ? <p className="text-ink-3">AI không trích tin nào cho mục này.</p>
            : ev.isPending ? <Skeleton className="h-16" />
            : ev.isError ? <p role="alert" className="text-error">{digestError(ev.error)}</p>
            : !ev.data.length ? <p className="text-ink-3">Tin gốc đã bị xóa hoặc không đọc được.</p>
            : (
              <ol className="grid gap-1.5">
                {ev.data.map((m) => (
                  <li key={m.message_id} className={cn("grid gap-0.5 border-l-2 py-0.5 pl-2.5", cited.has(m.message_id) ? "border-hl" : "border-rule opacity-75")}>
                    <span className="flex flex-wrap items-baseline gap-x-2 text-ink-3">
                      <b className="font-semibold text-ink-2">{m.outgoing ? "Bạn" : m.sender_name || "?"}</b>
                      {timeLabel(m.date)}
                      {!cited.has(m.message_id) && <span>· tin được trả lời</span>}
                    </span>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
                      {m.media_kind && <span className="text-ink-3">{m.media_kind === "photo" ? "[ảnh] " : "[file] "}</span>}
                      {m.text}
                    </p>
                  </li>
                ))}
              </ol>
            )}
        </div>
      </div>
    </motion.div>
  );
}

function TodoRow({ t, closed, showKind, showGroup, onToggle, onOpen }: {
  t: Todo; closed: boolean; showKind: boolean; showGroup: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const m = meta(t);
  const k = KIND[t.kind];
  const [open, setOpen] = useState(false);
  const n = t.message_ids?.length ?? 0;
  return (
    <motion.li layout="position" {...ROW_MOTION}
      className="group/todo flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-(--dur-micro) hover:bg-paper-2/70 focus-within:bg-paper-2/70">
      <Hint side="bottom" text={t.replied ? "Bạn đã trả lời tin này trên Telegram" : closed ? "Đánh dấu chưa xử lý" : "Đánh dấu đã xử lý (chỉ trên máy này)"}>
        <button type="button" aria-pressed={closed} aria-label={closed ? "Bỏ đánh dấu đã xử lý" : "Đánh dấu đã xử lý"} onClick={onToggle} disabled={t.replied}
          className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,color,scale] duration-(--dur-short) ease-(--ease-out) active:scale-85",
            closed ? "border-ok bg-ok text-cotton" : "border-rule-2 text-transparent hover:border-ok hover:bg-ok-wash hover:text-ok")}>
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </button>
      </Hint>
      {showKind && (
        <span role="img" aria-label={k.label} className={cn("mt-px grid size-6 shrink-0 place-items-center rounded-md", k.tone)}>
          <k.Icon className="size-3.5" aria-hidden />
        </span>
      )}
      <div className="grid min-w-0 flex-1 gap-1">
        <p className={cn("text-sm leading-relaxed text-ink transition-colors duration-(--dur-short)", closed && "text-ink-3 line-through decoration-ink-3/60")}>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-sm text-left hover:text-hl-2">{t.text}</button>
          <Tickets ids={t.tickets} />
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-3">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
            className={cn("inline-flex items-center gap-0.5 rounded-sm hover:text-ink", open && "text-hl-2")}>
            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out)", open && "rotate-90")} aria-hidden />
            {n ? `Bằng chứng · ${n} tin` : "Chi tiết"}
          </button>
          {t.replied && <span className="inline-flex items-center gap-1 font-medium text-ok"><Check className="size-3" aria-hidden />Bạn đã trả lời</span>}
          {m && <span className="font-medium text-ink-2">{m}</span>}
          {t.due && <span className="rounded-full bg-warn-wash px-1.5 leading-5 font-medium text-warn">hạn {t.due}</span>}
          {showGroup && (
            <Hint side="bottom" text="Mở trang tóm tắt của nhóm">
              <button type="button" onClick={onOpen} className="max-w-48 truncate rounded-sm underline-offset-2 hover:text-ink hover:underline">{t.chat.title}</button>
            </Hint>
          )}
          {!closed && (t.kind === "confirmations" || t.kind === "actions"
            ? <TodoActions t={t} onCreated={onToggle} />
            : <DeepItemAction chatId={t.chat.chat_id} ids={t.message_ids ?? []} />)}
        </div>
        <AnimatePresence initial={false}>{open && <TodoDetail key="detail" t={t} onOpen={onOpen} />}</AnimatePresence>
      </div>
    </motion.li>
  );
}

// ---- group picker: one button, every group's status in its list ----------------------------------------------------

function StatusDot({ i, r }: { i: BriefingItem; r?: RunState }) {
  return r?.status === "running" ? <Loader2 className="size-3 shrink-0 animate-spin text-hl" aria-hidden />
    : r?.status === "error" ? <CircleAlert className="size-3 shrink-0 text-error" aria-hidden />
    : <span aria-hidden className={cn("size-2 shrink-0 rounded-full", hasNews(i) ? "bg-signal ring-[3px] ring-signal-wash" : i.saved ? "bg-ok/70" : "bg-rule-2")} />;
}

/** Which group's items to show; each row also says how fresh its digest is, and can re-run or open it. */
function GroupPicker({ groups, runs, group, openOf, running, onPick, onRun, onOpen }: {
  groups: BriefingItem[]; runs: Record<string, RunState>; group: string | null; openOf: (i: BriefingItem) => number; running: boolean;
  onPick: (chatId: string | null) => void; onRun: (i: BriefingItem) => void; onOpen: (i: BriefingItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const cur = groups.find((g) => g.chat_id === group);
  const news = groups.filter(hasNews).length;
  const total = groups.reduce((n, g) => n + openOf(g), 0);
  const needle = q.trim().toLowerCase();
  const sorted = [...groups].sort((a, b) => Number(hasNews(b)) - Number(hasNews(a)) || openOf(b) - openOf(a))
    .filter((g) => g.title.toLowerCase().includes(needle));
  const pick = (id: string | null) => { setOpen(false); setQ(""); onPick(id); };
  const hint = (i: BriefingItem) => {
    const r = runs[i.chat_id];
    return r?.status === "error" ? r.error ?? "Lỗi" : r?.status === "running" ? "Đang tóm tắt…"
      : !i.saved ? "Chưa tóm tắt lần nào" : `Tóm tắt lúc ${timeLabel(i.saved.created_at)}${hasNews(i) ? " · có tin mới" : ""}`;
  };
  const count = (n: number) => n > 0 && <span className="rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-4 text-ink-2 tabular-nums">{n}</span>;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label="Chọn nhóm"
        className="flex h-8 max-w-72 min-w-0 shrink items-center gap-1.5 rounded-full border border-rule bg-cotton pr-2 pl-2.5 text-xs text-ink-2 transition-colors duration-(--dur-micro) hover:border-rule-2 hover:text-ink data-popup-open:border-hl data-popup-open:text-hl-2">
        {cur ? <StatusDot i={cur} r={runs[cur.chat_id]} /> : <Users className="size-3.5 shrink-0" aria-hidden />}
        <span className="truncate font-medium">{cur?.title ?? `Tất cả ${groups.length} nhóm`}</span>
        {count(cur ? openOf(cur) : total)}
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-40 outline-none">
          <Popover.Popup aria-label="Chọn nhóm"
            className="grid w-96 max-w-[calc(100vw-2rem)] origin-(--transform-origin) gap-2 rounded-lg bg-cotton p-2.5 text-sm shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {groups.length > 6 && <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhóm…" aria-label="Tìm nhóm" />}
            <ul className="grid max-h-80 gap-0.5 overflow-y-auto">
              {!needle && (
                <li>
                  <button type="button" aria-pressed={!group} onClick={() => pick(null)}
                    className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left", !group ? "bg-hl-wash text-hl-2" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}>
                    <Users className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">Tất cả nhóm</span>
                    {news > 0 && <span className="text-xs text-signal-2">{news} có tin mới</span>}
                    {count(total)}
                  </button>
                </li>
              )}
              {sorted.map((i) => (
                <li key={i.chat_id} className={cn("flex items-center rounded-md", group === i.chat_id ? "bg-hl-wash text-hl-2" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}>
                  <Hint side="right" text={hint(i)}>
                    <button type="button" aria-pressed={group === i.chat_id} onClick={() => pick(i.chat_id)} className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left">
                      <StatusDot i={i} r={runs[i.chat_id]} />
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      {count(openOf(i))}
                    </button>
                  </Hint>
                  {hasNews(i) && (
                    <Hint side="bottom" text="Chỉ tóm tắt nhóm này">
                      <button type="button" aria-label={`Tóm tắt ${i.title}`} disabled={running} onClick={() => onRun(i)}
                        className="grid size-7 place-items-center rounded-md text-hl-2 hover:bg-hl-wash disabled:opacity-40">
                        <Sparkles className="size-3.5" aria-hidden />
                      </button>
                    </Hint>
                  )}
                  <Hint side="bottom" text="Mở trang tóm tắt của nhóm (chọn khoảng thời gian, chọn tin)">
                    <button type="button" aria-label={`Mở ${i.title}`} onClick={() => { setOpen(false); onOpen(i); }} className="mr-0.5 grid size-7 place-items-center rounded-md hover:bg-paper-3">
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    </button>
                  </Hint>
                </li>
              ))}
              {!sorted.length && <li className="px-2 py-1.5 text-ink-3">Không có nhóm nào khớp.</li>}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Groups not here yet: those waiting for "Cho phép", and any other Telegram group; picking one opens its Digest. */
function AddGroup({ blocked, known, open, onOpenChange, onPick }: {
  blocked: BriefingItem[]; known: Set<string>; open: boolean; onOpenChange: (o: boolean) => void; onPick: (chatId: string, title: string) => void;
}) {
  const [q, setQ] = useState("");
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: ({ signal }) => api<GroupInfo[]>("/groups", { signal }),
    enabled: open, staleTime: 60_000,
  });
  const needle = q.trim().toLowerCase();
  const match = (t: string) => t.toLowerCase().includes(needle);
  const waiting = blocked.filter((b) => match(b.title));
  const others = (groups.data ?? []).filter((g) => !known.has(g.chat_id) && match(g.title));
  const item = (id: string, title: string, allow?: boolean) => (
    <li key={id}>
      <button type="button" onClick={() => { onOpenChange(false); onPick(id, title); }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-2 hover:bg-paper-2 hover:text-ink">
        {allow && <ShieldCheck className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {allow && <span className="text-xs font-medium text-hl-2">Cho phép</span>}
      </button>
    </li>
  );
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Hint side="bottom" text="Thêm nhóm vào Briefing">
        <Popover.Trigger aria-label="Thêm nhóm"
          className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-rule-2 px-2.5 text-xs text-ink-3 transition-colors duration-(--dur-micro) hover:border-ink-3 hover:text-ink data-popup-open:border-hl data-popup-open:text-hl-2">
          <Plus className="size-3.5" aria-hidden /> Thêm
          {blocked.length > 0 && <span className="rounded-full bg-paper-3 px-1.5 font-mono leading-4 tabular-nums">{blocked.length}</span>}
        </Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-40 outline-none">
          <Popover.Popup aria-label="Thêm nhóm"
            className="grid w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) gap-2 rounded-lg bg-cotton p-2.5 text-sm shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhóm Telegram…" aria-label="Tìm nhóm" />
            <div className="grid max-h-72 gap-2 overflow-y-auto">
              {waiting.length > 0 && (
                <div className="grid gap-0.5">
                  <p className="px-2 text-xs font-medium text-ink-3">Chưa cho phép AI</p>
                  <ul className="grid gap-0.5">{waiting.map((b) => item(b.chat_id, b.title, true))}</ul>
                </div>
              )}
              <div className="grid gap-0.5">
                <p className="px-2 text-xs font-medium text-ink-3">Nhóm khác</p>
                {groups.isPending && <Skeleton className="mx-2 h-12" />}
                {groups.isError && <p role="alert" className="px-2 text-error">{digestError(groups.error)}</p>}
                {groups.data && (others.length ? <ul className="grid gap-0.5">{others.map((g) => item(g.chat_id, g.title))}</ul>
                  : <p className="px-2 text-ink-3">Không có nhóm nào khác.</p>)}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---- the AI assistant: questions across every group's latest digest ------------------------------------------------

const SUGGEST: [LucideIcon, string, string][] = [
  [Sun, "Hôm nay làm gì trước?", "Hôm nay tôi cần làm gì trước? Xếp theo độ gấp."],
  [UserRound, "Ai đang chờ tôi?", "Ai đang chờ tôi trả lời hoặc chốt?"],
  [TriangleAlert, "Blocker và rủi ro", "Có blocker hay rủi ro nào cần để ý không?"],
  [ClipboardList, "Viết standup", "Viết standup update ngắn từ các nhóm."],
];
const ASK_ERR = { briefing_empty: "Chưa có bản tóm tắt nào; bấm “Tóm tắt” trước.", ai_not_configured: "AI chưa cài hoặc chưa đăng nhập, xem Cài đặt › AI." };
type Turn = { id: number; q: string; text: string; busy: boolean; error?: string };

function AiPane({ ready, onSave, saving, className }: { ready: boolean; onSave: (text: string) => void; saving: boolean; className?: string }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  useEffect(() => () => abort.current?.abort(), []);
  const last = turns.at(-1);
  const busy = !!last?.busy;
  const { ref: feedRef, onScroll } = useFollow(last?.text, turns.length);

  async function ask(question = q.trim()) {
    if (!question || busy || !ready) return;
    const ctl = (abort.current = new AbortController());
    const id = ++seq.current;
    const set = (t: Partial<Turn>) => setTurns((all) => all.map((x) => (x.id === id ? { ...x, ...t } : x)));
    setQ("");
    setTurns((all) => [...all, { id, q: question, text: "", busy: true }]);
    try {
      const r = await apiStream<{ text: string }>("/briefing/ask", { question, intro: readIntro() }, ctl.signal, (text) => set({ text }));
      set({ text: r.text, busy: false });
    } catch (e) {
      set({ busy: false, error: ctl.signal.aborted ? "Đã dừng." : errorText(e, ASK_ERR, "AI không trả lời được.") });
    }
  }

  return (
    <aside aria-label="Trợ lý AI" className={cn("flex min-h-0 flex-col bg-paper-2/40 lg:border-l", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <AiBot className="size-6 shrink-0" />
        <span className="text-sm font-semibold text-ink">Trợ lý Briefing</span>
        <span className="truncate text-xs text-ink-3">đọc tóm tắt mọi nhóm</span>
        {turns.length > 0 && (
          <Hint side="bottom" text="Xóa hội thoại">
            <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Xóa hội thoại" disabled={busy} onClick={() => setTurns([])}><Trash2 /></Button>
          </Hint>
        )}
      </div>
      <div ref={feedRef} onScroll={onScroll} aria-live="polite" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <motion.div {...FADE} className="grid gap-4 pt-2">
            <div className="grid justify-items-center gap-2 text-center">
              <AiBot className="ai-hop size-12 drop-shadow-sm" />
              <p className="text-sm font-semibold text-ink">Hỏi gì về các nhóm cũng được</p>
              <p className="max-w-64 text-xs leading-relaxed text-ink-3">
                {ready ? "AI đọc bản tóm tắt mới nhất của mọi nhóm, không đọc thêm tin Telegram." : "Tóm tắt ít nhất một nhóm để bắt đầu hỏi."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SUGGEST.map(([Icon, label, prompt], n) => (
                <motion.button key={label} type="button" disabled={!ready} onClick={() => void ask(prompt)}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.05 * n, duration: 0.24, ease: EASE } }}
                  className="grid gap-1.5 rounded-xl border border-rule bg-cotton p-3 text-left text-xs font-medium text-ink-2 shadow-stock transition-[border-color,color,translate] duration-(--dur-short) ease-(--ease-out) hover:-translate-y-0.5 hover:border-hl/50 hover:text-ink disabled:pointer-events-none disabled:opacity-50">
                  <Icon className="size-4 text-hl" aria-hidden />{label}
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : turns.map((t) => (
          <div key={t.id} className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <UserBubble>{t.q}</UserBubble>
            {t.error ? <AiResultCard error>{t.error}</AiResultCard>
              : t.busy ? (t.text ? <><Markdown text={t.text} className="px-0.5 text-ink" /><AiWriting /></>
                : <AiThinking lines={["Đang đọc tóm tắt các nhóm", "Đang tìm việc chờ bạn", "Đang xếp theo độ gấp"]} />)
              : (
                <AiResultCard title="Trả lời" dim={t !== last} actions={<>
                  <Button size="xs" variant="ghost" disabled={saving} onClick={() => onSave(tgText(t.text))}><Send /> Saved Messages</Button>
                  <Button size="xs" variant="ghost" onClick={() => void copyText(t.text, "Đã copy")}><Copy /> Copy</Button>
                </>}>
                  <Markdown text={t.text} className="text-ink" />
                </AiResultCard>
              )}
          </div>
        ))}
      </div>
      <div className="shrink-0 p-3">
        <AiPromptBox value={q} onChange={setQ} onSend={() => void ask()} running={busy} onStop={() => abort.current?.abort()}
          aria-label="Hỏi AI về các nhóm" maxLength={1000}
          placeholder={ready ? "Hỏi về mọi nhóm…" : "Tóm tắt một nhóm để hỏi AI"}
          tools={<ModelEffortPicker kind="brief" compact className="gap-x-2 text-xs" />}
          actions={!busy && (
            <Button size="icon-sm" className="rounded-full" aria-label="Gửi câu hỏi" disabled={!ready || !q.trim()} onClick={() => void ask()}>
              <ArrowUp />
            </Button>
          )} />
      </div>
    </aside>
  );
}

function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action: ReactNode }) {
  return (
    <motion.div {...FADE} className="grid content-center justify-items-center gap-2 p-8 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-hl-wash text-hl-2">{icon}</span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-ink-3">{text}</p>
      <div className="mt-1">{action}</div>
    </motion.div>
  );
}

// ---- the page --------------------------------------------------------------------------------------------------------

/** Every group at a glance: a to-do feed across groups, an AI assistant over all digests, and each group's status. */
/** `group`: the one group whose items show (null: all); the sidebar's Briefing tab picks it too. */
export function BriefingPage({ group, onGroup, onBack, onOpenDigest }: {
  group: string | null; onGroup: (chatId: string | null) => void; onBack: () => void; onOpenDigest: (chatId: string, title: string) => void;
}) {
  const qc = useQueryClient();
  const list = useQuery(briefingQuery);
  const wait = useAiWait(list.isPending);
  const { runs, batch } = useBriefRun(); // null batch: nothing running
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null); // null: the first tab with something left
  const [showDone, setShowDone] = useState(false);
  const [pane, setPane] = useState<"todo" | "ai">("todo"); // phones: one pane at a time

  const items = list.data ?? [];
  const allowed = items.filter((i) => i.consent);
  const blocked = items.filter((i) => !i.consent);
  const todo = allowed.filter(hasNews);
  const offline = allowed.length > 0 && allowed.every((i) => i.latest_id == null);
  const summarized = allowed.some((i) => i.saved);
  // Items whose cited message I have replied to on Telegram tick themselves off.
  const answered = useQuery({
    queryKey: ["briefing-answered"],
    queryFn: ({ signal }) => api<Record<string, string[]>>("/briefing/answered", { signal }),
    enabled: summarized, staleTime: 60_000,
  });
  const [done, toggle] = useDone();
  // Asked of / assigned to me (my YouTrack name; a PO also answers to "PO" / "PM").
  const role = useRole();
  const me = useQuery({ queryKey: ["yt", "me"], queryFn: yt.me, staleTime: Infinity, retry: false }).data?.name?.toLowerCase();
  const isMine = (who: string) => (!!me && who.toLowerCase().includes(me)) || (role === "po" && /\b(PO|PM|product owner)\b/i.test(who));
  const todos: Todo[] = allowed.flatMap((chat) => KINDS.flatMap((kind) =>
    (chat.saved?.result[kind] ?? []).map((it) => {
      const ask = kind === "confirmations" || kind === "actions";
      return {
        ...it, kind, chat, key: todoKey(chat.chat_id, kind, it),
        mine: ask && isMine(it.who ?? ""),
        replied: ask && !!it.message_ids?.some((id) => answered.data?.[chat.chat_id]?.includes(id)),
      };
    })));
  const isClosed = (t: Todo) => t.replied || done.has(t.key);
  const pending = (t: Todo) => !isClosed(t) && (t.kind === "confirmations" || t.kind === "actions");
  const leftAll = todos.filter(pending).length;

  const shown = group ? todos.filter((t) => t.chat.chat_id === group) : todos;
  const tabs: [Tab, string, string][] = [
    ...(todos.some((x) => x.mine) ? [["mine", "Cần bạn", "bg-hl"] as [Tab, string, string]] : []),
    ...KINDS.map((k) => [k, KIND[k].label, KIND[k].dot] as [Tab, string, string]),
  ];
  const inTabOf = (t: Tab) => shown.filter((x) => (t === "mine" ? x.mine : x.kind === t));
  const left = (t: Tab) => inTabOf(t).filter((x) => !isClosed(x)).length;
  const cur = tabs.find(([t]) => t === tab)?.[0] ?? tabs.find(([t]) => left(t))?.[0] ?? "confirmations";
  const inTab = inTabOf(cur);
  const openItems = inTab.filter((x) => !isClosed(x));
  const closedItems = inTab.filter(isClosed);

  const last = allowed.map((i) => i.saved?.created_at).filter((x): x is string => !!x).sort().at(-1);
  const running = batch !== null;
  const now = allowed.find((i) => runs[i.chat_id]?.status === "running");
  const save = useMutation({
    mutationFn: (text: string) => api<null>("/briefing/saved", { method: "POST", json: { text } }),
    onSuccess: () => toast({ text: "Đã gửi vào Saved Messages" }),
    onError: (e) => toast({ text: errorText(e, { not_connected: "Telegram chưa kết nối." }, "Không gửi được, thử lại sau") }),
  });

  const run = (groups: BriefingItem[]) => runBrief(qc, groups);

  async function copyAll() {
    const parts = allowed.filter((i) => i.saved).map((i) => toMarkdown(i.saved!.result, i.title).replace(/^# /, "## "));
    await copyText([`# Briefing ${timeLabel(new Date().toISOString(), true)}`, ...parts].join("\n\n"), "Đã copy markdown");
  }

  const open = (i: Pick<BriefingItem, "chat_id" | "title">) => onOpenDigest(i.chat_id, i.title);
  const byGroup = !group && allowed.length > 1; // all groups: items sit under their group's heading
  const row = (t: Todo) => (
    <TodoRow key={t.key} t={t} closed={isClosed(t)} showKind={cur === "mine"} showGroup={byGroup && isClosed(t)}
      onToggle={() => toggle(t.key)} onOpen={() => open(t.chat)} />
  );
  const runButton = (
    <Button id="briefing-run" size="sm" disabled={!todo.length || running} onClick={() => void run(todo)}>
      <Sparkles /> {todo.length ? `Tóm tắt ${todo.length} nhóm` : "Đã cập nhật"}
    </Button>
  );

  return (
    <MotionConfig reducedMotion="user">
      <section aria-label="Briefing" className="flex min-h-0 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 md:px-5">
          <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại">
            <ArrowLeft />
          </Button>
          <span className="flex min-w-0 items-center gap-2 truncate text-sm text-ink-2">
            {!list.data ? "Đang kiểm tra các nhóm…" : <>
              <span><b className="font-semibold text-ink tabular-nums">{leftAll}</b> việc chờ xử lý</span>
              {last && <span className="hidden text-ink-3 sm:inline">· cập nhật {timeLabel(last)}</span>}
              {offline && <span className="text-warn">· Telegram chưa kết nối</span>}
            </>}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <Hint side="bottom" text="Kiểm tra lại tin mới ở các nhóm">
              <Button size="icon-sm" variant="ghost" aria-label="Kiểm tra lại" disabled={running || list.isFetching}
                onClick={() => { void list.refetch(); void answered.refetch(); }}>
                <RotateCw className={cn(list.isFetching && "animate-spin")} />
              </Button>
            </Hint>
            <Hint side="bottom" text="Copy tóm tắt của mọi nhóm thành một file markdown">
              <Button size="icon-sm" variant="ghost" aria-label="Copy tất cả" disabled={!summarized} onClick={() => void copyAll()}>
                <Copy />
              </Button>
            </Hint>
            <Hint side="bottom" text="Gửi các mục chưa xử lý của mọi nhóm vào Saved Messages trên Telegram">
              <Button size="icon-sm" variant="ghost" aria-label="Gửi vào Saved Messages" disabled={!summarized || save.isPending}
                onClick={() => save.mutate(tgBriefing(todos.filter((t) => !isClosed(t))))}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </Hint>
            <span className="ml-1.5">{runButton}</span>
          </div>
        </header>
        <WeekStatsCard />

        <AnimatePresence initial={false}>
          {batch && (
            <motion.div key="progress" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE }}
              className="grid shrink-0 gap-1.5 border-b bg-hl-wash/40 px-3 py-2 md:px-5">
              <div className="flex items-center gap-3">
                <AiThinking className="min-w-0 flex-1" label={`Đang tóm tắt ${now?.title ?? "…"} (${Math.min(batch.done + 1, batch.total)}/${batch.total})`} />
                <AiStop onClick={stopBrief} label="Dừng tóm tắt" hint="Dừng tóm tắt (nhóm đang chạy bị hủy)" />
              </div>
              <div role="progressbar" aria-label="Tiến độ tóm tắt" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={batch.done}
                className="h-1 overflow-hidden rounded-full bg-paper-3">
                <div className="h-full origin-left bg-hl transition-transform duration-(--dur-long) ease-(--ease-out)" style={{ transform: `scaleX(${batch.total ? batch.done / batch.total : 0})` }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {list.data && (
          <div role="group" aria-label="Lọc theo nhóm" className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2 md:px-5">
            {allowed.length > 0 && (
              <GroupPicker groups={allowed} runs={runs} group={group} running={running}
                openOf={(i) => todos.filter((t) => t.chat === i && pending(t)).length}
                onPick={(id) => { onGroup(id); setShowDone(false); }} onRun={(i) => void run([i])} onOpen={open} />
            )}
            <AddGroup blocked={blocked} known={new Set(items.map((i) => i.chat_id))} open={adding} onOpenChange={setAdding} onPick={onOpenDigest} />
          </div>
        )}

        {summarized && (
          <div className="shrink-0 px-3 pt-2 lg:hidden">
            <Segmented id="brief-pane" label="Khung" variant="card" value={pane} onChange={setPane}
              items={[{ value: "todo", label: <><ListTodo className="size-3.5" aria-hidden />Việc · {leftAll}</> }, { value: "ai", label: <><Sparkles className="size-3.5" aria-hidden />Trợ lý AI</> }]} />
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
          <div className={cn("flex min-h-0 flex-col", summarized && pane === "ai" && "max-lg:hidden")}>
            {wait ? (
              <AiFetching kind="brief" />
            ) : list.isError ? (
              <p role="alert" className="flex items-center gap-2 p-5 text-sm text-error">
                {digestError(list.error)}
                <Button size="xs" variant="outline" onClick={() => void list.refetch()}><RotateCw /> Thử lại</Button>
              </p>
            ) : !allowed.length ? (
              <Empty icon={<Plus className="size-5" aria-hidden />} title="Chưa có nhóm nào trong Briefing"
                text="Chọn một nhóm, cho phép AI đọc, rồi mỗi sáng chỉ cần bấm một nút để biết: ai đang chờ bạn, đã chốt gì, việc gì cần làm."
                action={<Button size="sm" onClick={() => setAdding(true)}><Plus /> Thêm nhóm</Button>} />
            ) : !summarized ? (
              <Empty icon={<Sparkles className="size-5" aria-hidden />} title="Chưa có bản tóm tắt nào"
                text="Tóm tắt các nhóm có tin mới: AI gom câu hỏi cần confirm, việc cần làm, quyết định và thay đổi vào một danh sách." action={runButton} />
            ) : (
              <>
                <div className="shrink-0 overflow-x-auto px-3 pt-3 [scrollbar-width:none] md:px-5">
                  <Segmented id="brief-tab" label="Lọc việc" value={cur} className="w-max"
                    onChange={(v) => { setTab(v); setShowDone(false); }}
                    items={tabs.map(([v, l]) => ({
                      value: v,
                      label: <span className="flex items-center gap-1.5">{l}<span className="font-mono tabular-nums opacity-70">{left(v)}</span></span>,
                      title: v === "mine" ? "Câu hỏi chờ bạn trả lời và việc giao cho bạn (theo tên YouTrack / vai trò PO)" : undefined,
                    }))} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-4 md:px-3">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={`${cur}:${group}`} {...FADE}>
                      {openItems.length ? (
                        byGroup ? (
                          <div className="grid gap-3">
                            {allowed.map((c) => [c, openItems.filter((t) => t.chat === c)] as const).filter(([, its]) => its.length).map(([c, its]) => (
                              <section key={c.chat_id} aria-label={c.title} className="grid gap-0.5">
                                <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-cotton/95 px-2.5 py-1 text-xs font-semibold text-ink-2 backdrop-blur-sm">
                                  <StatusDot i={c} r={runs[c.chat_id]} />
                                  <button type="button" onClick={() => onGroup(c.chat_id)} className="min-w-0 truncate rounded-sm hover:text-ink hover:underline">{c.title}</button>
                                  <span className="font-mono font-normal text-ink-3 tabular-nums">{its.length}</span>
                                  <Hint side="bottom" text="Mở trang tóm tắt của nhóm">
                                    <button type="button" aria-label={`Mở ${c.title}`} onClick={() => open(c)} className="grid size-5 place-items-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
                                      <ArrowUpRight className="size-3" aria-hidden />
                                    </button>
                                  </Hint>
                                </h3>
                                <ul className="grid gap-0.5"><AnimatePresence initial={false}>{its.map(row)}</AnimatePresence></ul>
                              </section>
                            ))}
                          </div>
                        ) : <ul aria-label="Việc cần xử lý" className="grid gap-0.5"><AnimatePresence initial={false}>{openItems.map(row)}</AnimatePresence></ul>
                      ) : (
                        <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
                          <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}
                            className="grid size-10 place-items-center rounded-full bg-ok-wash text-ok">
                            <Check className="size-5" strokeWidth={2.5} aria-hidden />
                          </motion.span>
                          <p className="text-sm font-medium text-ink">{inTab.length ? "Đã xử lý hết mục này" : cur === "mine" ? "Không có gì đang chờ bạn" : "Không có mục nào"}</p>
                          {inTab.length > 0 && <p className="text-xs text-ink-3">Mục mới sẽ hiện ở đây sau lần tóm tắt tới.</p>}
                        </div>
                      )}
                      {closedItems.length > 0 && (
                        <div className="mt-2 grid gap-1 border-t border-rule px-2.5 pt-2">
                          <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}
                            className="flex items-center gap-1 justify-self-start rounded-sm text-xs text-ink-3 hover:text-ink">
                            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out)", showDone && "rotate-90")} aria-hidden />
                            Đã xử lý {closedItems.length}
                          </button>
                          <AnimatePresence initial={false}>
                            {showDone && (
                              <motion.ul key="done" {...FADE} className="-mx-2.5 grid gap-0.5">
                                <AnimatePresence initial={false}>{closedItems.map(row)}</AnimatePresence>
                              </motion.ul>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>
          {list.data && allowed.length > 0 && (
            <AiPane ready={summarized} onSave={(t) => save.mutate(t)} saving={save.isPending}
              className={cn(pane === "todo" && "max-lg:hidden")} />
          )}
        </div>
      </section>
    </MotionConfig>
  );
}

/** Sidebar tab "Briefing": the followed groups and how fresh each digest is; a pick opens Briefing on that group. */
export function BriefingGroups({ selected, onSelect, collapsed }: {
  selected: string | null | undefined; onSelect: (chatId: string | null) => void; collapsed: boolean;
}) {
  const list = useQuery(briefingQuery);
  const groups = (list.data ?? []).filter((i) => i.consent).sort((a, b) => Number(hasNews(b)) - Number(hasNews(a)));
  const news = groups.filter(hasNews).length;
  const row = (on: boolean) => cn(
    "relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
    on && "font-medium text-hl-2 hover:bg-transparent",
  );
  const fade = collapsed ? railHide : undefined;
  return (
    <nav aria-label="Nhóm Briefing" className="no-scrollbar h-full min-h-0 overflow-y-auto px-2 pb-3">
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
        <li>
          <button type="button" aria-current={selected === null} onClick={() => onSelect(null)} className={row(selected === null)}>
            {selected === null && <NavPill />}
            <Sparkles className="relative size-5 shrink-0 text-hl" aria-hidden />
            <span className={cn("relative min-w-0 flex-1 truncate font-medium", fade)}>Tất cả nhóm</span>
            {news > 0 && <span className={cn("relative shrink-0 text-xs text-signal-2", fade)}>{news} có tin mới</span>}
          </button>
        </li>
        {groups.map((i) => (
          <li key={i.chat_id}>
            <button type="button" aria-current={selected === i.chat_id} onClick={() => onSelect(i.chat_id)} className={row(selected === i.chat_id)}>
              {selected === i.chat_id && <NavPill />}
              <span className="relative shrink-0">
                <Avatar name={i.title} />
                <span className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-paper-2 p-0.5"><StatusDot i={i} /></span>
              </span>
              <span className={cn("relative min-w-0 flex-1 truncate", hasNews(i) && "font-medium text-ink", fade)}>{i.title}</span>
              <span className={cn("relative shrink-0 text-xs", hasNews(i) ? "text-signal-2" : "text-ink-3", fade)}>
                {hasNews(i) ? "tin mới" : i.saved ? timeLabel(i.saved.created_at) : "chưa tóm tắt"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {list.isPending && <div className="grid gap-2 px-3 pt-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-4" style={{ width: `${70 - k * 12}%` }} />)}</div>}
      {list.isError && (
        <div role="alert" className="grid justify-items-start gap-2 px-3 py-2 text-sm">
          <p className="text-error">Không tải được danh sách Briefing.</p>
          <Button size="sm" variant="outline" onClick={() => void list.refetch()}><RotateCw /> Thử lại</Button>
        </div>
      )}
      {list.isSuccess && !groups.length && (
        <p className={cn("px-3 py-2 text-sm leading-relaxed text-ink-3", fade)}>Chưa theo dõi nhóm nào. Mở Tất cả nhóm để thêm nhóm cho AI tóm tắt.</p>
      )}
    </nav>
  );
}

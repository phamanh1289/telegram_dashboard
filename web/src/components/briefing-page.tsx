"use client";

import { Popover } from "@base-ui/react/popover";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowUp, ArrowUpRight, Check, ChevronRight, CircleAlert, CircleCheckBig, ClipboardList, Copy, Gauge, GitCompareArrows, ListTodo, Loader2,
  type LucideIcon, MessageCircleQuestion, PanelRightClose, Plus, RotateCw, Send, ShieldCheck, Sparkles, Sun, Trash2, TriangleAlert, UserRound, X,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ModelEffortPicker } from "@/components/ai";
import { AiBot, AiPromptBox, AiResultCard, AiStop, AiThinking, AiWriting, UserBubble, useFollow } from "@/components/ai/chat";
import { AiFetching, digestLines, useAiWait } from "@/components/ai/fetching";
import { Avatar, railHide } from "@/components/chat-list";
import { BeTopics } from "@/components/be-topics";
import { DeepItemAction } from "@/components/deep-think";
import { NavPill } from "@/components/shell";
import { answeredQuery, beRepliesQuery, closedIds, digestError, Evidence, isClosedItem, ItemActions, ItemFlags, isAnswered, openCount, Tickets, todoKey, toMarkdown, useDone } from "@/components/digest-page";
import { Markdown } from "@/components/markdown";
import { TicketChip } from "@/components/message-item";
import { useOpenSimilar } from "@/components/ticket-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DIALOG_SHEET, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { WeekStatsCard } from "@/components/week-stats";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiStream, type BriefingItem, type DigestItem, type DigestResult, errorText, type GroupInfo, statusQuery } from "@/lib/api";
import { saveBrief } from "@/lib/briefs";
import { type Key, t as tr, useT } from "@/lib/i18n";
import { copyText, toast, useNow } from "@/lib/inbox";
import { getPref, put, readDigestTeams, readIntro, useRole } from "@/lib/prefs";
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
/** `hours`: re-read that far back instead of only what is new (a digest made before BE topics existed). */
async function runBrief(qc: QueryClient, groups: BriefingItem[], hours?: number) {
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
          since: (!hours && it.saved?.last_date) || new Date(Date.now() - (hours ?? 24) * 3_600_000).toISOString(),
          until,
          message_ids: [],
          after_id: it.saved && !hours ? Number(it.saved.last_message_id) : null,
          closed: closedIds(it.chat_id, it.saved?.result, qc.getQueryData(answeredQuery.queryKey)),
          teams,
          intro: readIntro(),
        },
        signal: stop,
      });
      status(it.chat_id, { status: "done" });
    } catch (e) {
      status(it.chat_id, { status: "error", error: stop.aborted ? tr("Đã dừng.") : digestError(e) });
    }
    setBrief((b) => ({ ...b, batch: b.batch && { ...b.batch, done: b.batch.done + 1 } }));
    void qc.invalidateQueries({ queryKey: ["digest-saved", it.chat_id] });
    void qc.invalidateQueries({ queryKey: ["briefing"] }); // each group fills in as its digest lands
    void qc.invalidateQueries({ queryKey: ["briefing-answered"] });
    void qc.invalidateQueries({ queryKey: ["briefing-be-replies"] });
  }
  setBrief((b) => ({ ...b, batch: null }));
}

const AUTO_MS = 2 * 3_600_000; // a group with news is summarized again at most this often
const AUTO_TICK = 5 * 60_000;
export const AUTO_BRIEF = "autoBrief"; // "0": no background runs (Cài đặt › Telegram)

/** Keeps Briefing fresh while the app is open: every few minutes (one shared timer) the groups that have news and a
 *  digest older than AUTO_MS run in the background batch, so opening Briefing shows it ready. Off when AI isn't set. */
export function useAutoBrief(on: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!on) return;
    const tick = async () => {
      if (brief.batch || getPref(AUTO_BRIEF) === "0") return;
      const items = await qc.fetchQuery({ ...briefingQuery, staleTime: AUTO_TICK }).catch(() => []);
      const now = Date.now();
      const due = items.filter((i) => i.consent && hasNews(i) && (!i.saved || now - Date.parse(i.saved.created_at) >= AUTO_MS));
      if (due.length) await runBrief(qc, due);
    };
    const first = setTimeout(() => void tick(), 60_000); // after the app has settled
    const every = setInterval(() => void tick(), AUTO_TICK);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [on, qc]);
}

const RENEW_DAYS = 30;
const SOON_MS = 3 * 86_400_000;

/** Groups whose AI consent ended or ends within 3 days: one click renews them all for RENEW_DAYS. */
function RenewConsents({ items }: { items: BriefingItem[] }) {
  const tx = useT();
  const qc = useQueryClient();
  const now = useNow();
  const due = items.filter((i) => i.consent_until && Date.parse(i.consent_until) - now < SOON_MS);
  const renew = useMutation({
    mutationFn: () => Promise.all(due.map((i) =>
      api(`/chats/${encodeURIComponent(i.chat_id)}/digest-consent`, { method: "PUT", json: { enabled: true, days: RENEW_DAYS } }))),
    onSuccess: () => toast({ text: tr("Đã gia hạn {n} nhóm thêm {d} ngày", { n: due.length, d: RENEW_DAYS }) }),
    onError: (e) => toast({ text: errorText(e, {}, tr("Không gia hạn được, thử lại sau")) }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["briefing"] }),
  });
  if (!due.length) return null;
  const ended = due.filter((i) => !i.consent).length;
  return (
    <motion.div {...FADE} className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-warn-wash/60 px-3 py-2 text-xs text-ink-2 md:px-5">
      <span className="min-w-0 flex-1">
        {ended ? tx("{n} nhóm đã hết quyền cho AI đọc", { n: ended }) : tx("{n} nhóm sắp hết quyền cho AI đọc", { n: due.length })}: {due.map((i) => i.title).join(", ")}
      </span>
      <Button size="xs" variant="outline" disabled={renew.isPending} onClick={() => renew.mutate()}>
        {renew.isPending && <Loader2 className="animate-spin" />} {tx("Gia hạn {n} ngày", { n: RENEW_DAYS })}
      </Button>
    </motion.div>
  );
}

/** Telegram has messages newer than the last digest (or there was none yet). */
export const hasNews = (i: BriefingItem) =>
  i.latest_id !== null && i.latest_id !== undefined && (!i.saved || Number(i.latest_id) > Number(i.saved.last_message_id));

const EASE = [0.16, 1, 0.3, 1] as const; // --ease-out
export const ROW_MOTION = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } },
  exit: { opacity: 0, x: 24, transition: { duration: 0.16 } },
} as const;
const FADE = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.18, ease: EASE } } as const;

const sessionKey = () => `tg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const AI_PANE = "briefAi"; // "0": the AI column is hidden on desktop

// ---- to-do items: every group's latest digest in one list ------------------------------------------------------------

type Kind = "confirmations" | "actions" | "decisions" | "changes";
type Tab = "mine" | "be" | Kind;
type Todo = DigestItem & { kind: Kind; chat: BriefingItem; key: string; mine: boolean; replied: boolean };
const KINDS = ["confirmations", "actions", "decisions", "changes"] as const;
// One hue per kind, the same on its tab, its icon and in Saved Messages. Confirmations need you: the signal amber.
const KIND: Record<Kind, { label: Key; Icon: LucideIcon; tone: string; dot: string; tg: string }> = {
  confirmations: { label: "Cần confirm", Icon: MessageCircleQuestion, tone: "bg-signal-wash text-signal-2", dot: "bg-signal", tg: "❓" },
  actions: { label: "Việc cần làm", Icon: ListTodo, tone: "bg-info-wash text-info", dot: "bg-info", tg: "📌" },
  decisions: { label: "Đã chốt", Icon: CircleCheckBig, tone: "bg-ok-wash text-ok", dot: "bg-ok", tg: "✅" },
  changes: { label: "Thay đổi", Icon: GitCompareArrows, tone: "bg-code-wash text-code", dot: "bg-code", tg: "🔄" },
};


function meta(t: Todo) {
  if (t.kind === "confirmations") return t.who && tr("hỏi {who}", { who: t.who });
  if (t.kind === "decisions") return t.who && tr("chốt bởi {who}", { who: t.who });
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
      if (its.length) out.push(`${KIND[k].tg} ${tr(KIND[k].label)}`, ...its.map((t) => {
        const extra = [meta(t), t.due && tr("hạn {due}", { due: t.due }), ...(t.tickets ?? [])].filter(Boolean).join(", ");
        return `• ${t.text}${extra ? ` — ${extra}` : ""}`;
      }));
    }
  }
  if (!open.length) out.push("", tr("Không còn mục nào cần xử lý."));
  return out.join("\n");
}

/** "Trả lời" / "Tạo ticket"; a to-do with no ticket is checked against YouTrack: a likely match is shown, else creating one is suggested. */
function TodoActions({ t, onCreated }: { t: Todo; onCreated: () => void }) {
  const tx = useT();
  const ytOn = useQuery({ ...statusQuery, staleTime: Infinity }).data?.youtrack_configured; // the shell keeps it fresh
  const check = !!ytOn && t.kind === "actions" && !t.tickets?.length;
  const similar = useOpenSimilar(t.text, { enabled: check });
  const hit = similar.data?.[0];
  return (
    <>
      {hit && <span className="inline-flex items-center gap-1">{tx("có thể đã có")} <TicketChip id={hit.id} /></span>}
      <ItemActions chatId={t.chat.chat_id} ids={t.message_ids ?? []} text={t.text} suggest={check && similar.isSuccess && !hit} onCreated={onCreated} />
    </>
  );
}

const TOPIC: Record<string, [Key, string]> = { decided: ["đã chốt", "text-ok"], open: ["đang bàn", "text-signal-2"], dropped: ["bỏ", "text-ink-3"] };

/** Why an item says what it says: the AI's context, the topic it belongs to, and the cited messages read live from Telegram. */
function TodoDetail({ t, onOpen }: { t: Todo; onOpen: () => void }) {
  const tx = useT();
  const ids = (t.message_ids ?? []).slice(0, 40);
  // The topic citing most of the same messages.
  const overlap = (x: string[] = []) => x.filter((i) => ids.includes(i)).length;
  const topic = [...(t.chat.saved?.result.topics ?? [])].sort((a, b) => overlap(b.message_ids) - overlap(a.message_ids))
    .find((x) => overlap(x.message_ids) > 0);
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: EASE }}
      className="overflow-hidden">
      <div className="mt-1.5 grid gap-3 rounded-lg border border-rule bg-cotton/60 p-3 text-xs">
        {t.why && (
          <div className="grid gap-0.5">
            <p className="font-medium text-ink-3">{tx("Bối cảnh")}</p>
            <p className="text-sm leading-relaxed text-ink-2">{t.why}</p>
          </div>
        )}
        {topic && (
          <div className="grid gap-0.5">
            <p className="font-medium text-ink-3">{tx("Chủ đề")} <span className={TOPIC[topic.status ?? "open"]?.[1]}>· {tx(TOPIC[topic.status ?? "open"]?.[0] ?? "đang bàn")}</span></p>
            <p className="text-sm leading-relaxed text-ink-2"><b className="font-bold text-ink">{topic.title}</b>{topic.summary && `: ${topic.summary}`}</p>
          </div>
        )}
        <Evidence chatId={t.chat.chat_id} ids={ids} extra={
          <button type="button" onClick={onOpen} className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-sm font-normal whitespace-nowrap hover:text-ink hover:underline">
            {tx("Xem cả nhóm")} <ArrowUpRight className="size-3" aria-hidden />
          </button>
        } />
      </div>
    </motion.div>
  );
}

function TodoRow({ t, closed, showKind, showGroup, onToggle, onOpen }: {
  t: Todo; closed: boolean; showKind: boolean; showGroup: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const tx = useT();
  const m = meta(t);
  const k = KIND[t.kind];
  const [open, setOpen] = useState(false);
  const n = t.message_ids?.length ?? 0;
  return (
    <motion.li layout="position" {...ROW_MOTION}
      className="group/todo flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-(--dur-micro) hover:bg-paper-2/70 focus-within:bg-paper-2/70">
      <Hint side="bottom" text={t.replied ? tx("Bạn đã trả lời tin này trên Telegram") : closed ? tx("Đánh dấu chưa xử lý") : tx("Đánh dấu đã xử lý (chỉ trên máy này)")}>
        <button type="button" aria-pressed={closed} aria-label={closed ? tx("Bỏ đánh dấu đã xử lý") : tx("Đánh dấu đã xử lý")} onClick={onToggle} disabled={t.replied}
          className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,color,scale] duration-(--dur-short) ease-(--ease-out) active:scale-85",
            closed ? "border-ok bg-ok text-cotton" : "border-rule-2 text-transparent hover:border-ok hover:bg-ok-wash hover:text-ok")}>
          <Check className="size-3" strokeWidth={3} aria-hidden />
        </button>
      </Hint>
      {showKind && (
        <span role="img" aria-label={tx(k.label)} className={cn("mt-px grid size-6 shrink-0 place-items-center rounded-md", k.tone)}>
          <k.Icon className="size-3.5" aria-hidden />
        </span>
      )}
      <div className="grid min-w-0 flex-1 gap-1">
        <p className={cn("text-sm leading-relaxed text-ink transition-colors duration-(--dur-short)", closed && "text-ink-3 line-through decoration-ink-3/60")}>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-sm text-left hover:text-hl-2">{t.text}</button>
          <ItemFlags it={t} />
          <Tickets ids={t.tickets} />
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-3">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
            className={cn("inline-flex items-center gap-0.5 rounded-sm hover:text-ink", open && "text-hl-2")}>
            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out)", open && "rotate-90")} aria-hidden />
            {n ? tx("Bằng chứng · {n} tin", { n }) : tx("Chi tiết")}
          </button>
          {t.replied && <span className="inline-flex items-center gap-1 font-medium text-ok"><Check className="size-3" aria-hidden />{tx("Bạn đã trả lời")}</span>}
          {m && <span className="font-medium text-ink-2">{m}</span>}
          {t.due && <span className="rounded-full bg-warn-wash px-1.5 leading-5 font-medium text-warn">{tx("hạn {due}", { due: t.due })}</span>}
          {showGroup && (
            <Hint side="bottom" text={tx("Mở trang tóm tắt của nhóm")}>
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
/** Groups not here yet: those waiting for "Cho phép", and any other Telegram group; picking one opens its Digest. */
function AddGroup({ blocked, known, onPick, className, children }: {
  blocked: BriefingItem[]; known: Set<string>; onPick: (chatId: string, title: string) => void; className: string; children: ReactNode;
}) {
  const tx = useT();
  const [open, onOpenChange] = useState(false);
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
        {allow && <span className="text-xs font-medium text-hl-2">{tx("Cho phép")}</span>}
      </button>
    </li>
  );
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Hint side="right" text={tx("Thêm nhóm vào Briefing: chọn nhóm rồi cho phép AI đọc")}>
        <Popover.Trigger aria-label={tx("Thêm nhóm")} className={className}>{children}</Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" side="right" className="z-40 outline-none">
          <Popover.Popup aria-label={tx("Thêm nhóm")}
            className="grid w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) gap-2 rounded-lg bg-cotton p-2.5 text-sm shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Tìm nhóm Telegram…")} aria-label={tx("Tìm nhóm")} />
            <div className="grid max-h-72 gap-2 overflow-y-auto">
              {waiting.length > 0 && (
                <div className="grid gap-0.5">
                  <p className="px-2 text-xs font-medium text-ink-3">{tx("Chưa cho phép AI")}</p>
                  <ul className="grid gap-0.5">{waiting.map((b) => item(b.chat_id, b.title, true))}</ul>
                </div>
              )}
              <div className="grid gap-0.5">
                <p className="px-2 text-xs font-medium text-ink-3">{tx("Nhóm khác")}</p>
                {groups.isPending && <Skeleton className="mx-2 h-12" />}
                {groups.isError && <p role="alert" className="px-2 text-error">{digestError(groups.error)}</p>}
                {groups.data && (others.length ? <ul className="grid gap-0.5">{others.map((g) => item(g.chat_id, g.title))}</ul>
                  : <p className="px-2 text-ink-3">{tx("Không có nhóm nào khác.")}</p>)}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---- the AI assistant: questions across every group's latest digest ------------------------------------------------

const SUGGEST: [LucideIcon, Key, string][] = [
  [Sun, "Hôm nay làm gì trước?", "Hôm nay tôi cần làm gì trước? Xếp theo độ gấp."],
  [UserRound, "Ai đang chờ tôi?", "Ai đang chờ tôi trả lời hoặc chốt?"],
  [TriangleAlert, "Blocker và rủi ro", "Có blocker hay rủi ro nào cần để ý không?"],
  [ClipboardList, "Cần confirm gì?", "Những câu nào đang chờ tôi confirm hoặc chốt, ở nhóm nào?"],
];
const ASK_ERR: Record<string, Key> = { briefing_empty: "Chưa có bản tóm tắt nào; bấm “Tóm tắt” trước.", ai_not_configured: "AI chưa cài hoặc chưa đăng nhập, xem Cài đặt › AI." };
const THINK: Key[] = ["Đang đọc tóm tắt các nhóm", "Đang tìm việc chờ bạn", "Đang xếp theo độ gấp"];
type Turn = { id: number; q: string; text: string; busy: boolean; error?: string };

/** ⌘J from any Telegram page: the Briefing assistant in a drawer (the same pane as on the Briefing page), so a question
 *  about every group needs no trip to Briefing. Mounted only while open (its portal and its reads). */
export function AiDock({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <DockBody />}
    </Dialog>
  );
}

function DockBody() {
  const tx = useT();
  const ready = (useQuery(briefingQuery).data ?? []).some((i) => i.consent && i.saved);
  const save = useMutation({
    mutationFn: (text: string) => api<null>("/briefing/saved", { method: "POST", json: { text } }),
    onSuccess: () => toast({ text: tr("Đã gửi vào Saved Messages") }),
    onError: (e) => toast({ text: errorText(e, { not_connected: tr("Telegram chưa kết nối.") }, tr("Không gửi được, thử lại sau")) }),
  });
  return (
    <DialogContent className={cn(DIALOG_SHEET, "sm:max-w-md")}>
      <DialogTitle className="sr-only">{tx("Trợ lý AI (⌘J)")}</DialogTitle>
      <AiPane ready={ready} onSave={(t) => save.mutate(t)} saving={save.isPending} className="h-full lg:border-l-0" />
    </DialogContent>
  );
}

function AiPane({ ready, onSave, saving, onClose, className }: { ready: boolean; onSave: (text: string) => void; saving: boolean; onClose?: () => void; className?: string }) {
  const tx = useT();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const histId = useRef(sessionKey()); // this conversation in AI Agent › Briefing
  const done = useRef<{ q: string; a: string }[]>([]);
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
      // kept in AI Agent › Briefing, to read again later
      done.current.push({ q: question, a: r.text });
      saveBrief(histId.current, [...done.current]);
    } catch (e) {
      set({ busy: false, error: ctl.signal.aborted ? tr("Đã dừng.") : errorText(e, Object.fromEntries(Object.entries(ASK_ERR).map(([k, v]) => [k, tr(v)])), tr("AI không trả lời được.")) });
    }
  }

  return (
    <aside aria-label={tx("Trợ lý AI")} className={cn("flex min-h-0 flex-col bg-paper-2/40 lg:border-l", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <AiBot className="size-6 shrink-0" />
        <span className="text-sm font-bold text-ink">{tx("Trợ lý Briefing")}</span>
        <span className="truncate text-xs text-ink-3">{tx("đọc tóm tắt mọi nhóm")}</span>
        <div className="ml-auto flex items-center">
          {turns.length > 0 && (
            <Hint side="bottom" text={tx("Xóa hội thoại")}>
              <Button size="icon-xs" variant="ghost" aria-label={tx("Xóa hội thoại")} disabled={busy} onClick={() => { setTurns([]); histId.current = sessionKey(); done.current = []; }}><Trash2 /></Button>
            </Hint>
          )}
          {onClose && (
            <Hint side="bottom" text={tx("Ẩn Trợ lý AI (hội thoại vẫn giữ)")}>
              <Button size="icon-xs" variant="ghost" className="max-lg:hidden" aria-label={tx("Ẩn Trợ lý AI")} onClick={onClose}><X /></Button>
            </Hint>
          )}
        </div>
      </div>
      <div ref={feedRef} onScroll={onScroll} aria-live="polite" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <motion.div {...FADE} className="grid gap-4 pt-2">
            <div className="grid justify-items-center gap-2 text-center">
              <AiBot className="ai-hop size-12 drop-shadow-sm" />
              <p className="text-sm font-bold text-ink">{tx("Hỏi gì về các nhóm cũng được")}</p>
              <p className="max-w-64 text-xs leading-relaxed text-ink-3">
                {ready ? tx("AI đọc bản tóm tắt mới nhất của mọi nhóm, không đọc thêm tin Telegram.") : tx("Tóm tắt ít nhất một nhóm để bắt đầu hỏi.")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SUGGEST.map(([Icon, label, prompt], n) => (
                <motion.button key={label} type="button" disabled={!ready} onClick={() => void ask(prompt)}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.05 * n, duration: 0.24, ease: EASE } }}
                  className="grid gap-1.5 rounded-xl border border-rule bg-cotton p-3 text-left text-xs font-medium text-ink-2 shadow-stock transition-[border-color,color,translate] duration-(--dur-short) ease-(--ease-out) hover:-translate-y-0.5 hover:border-hl/50 hover:text-ink disabled:pointer-events-none disabled:opacity-50">
                  <Icon className="size-4 text-hl" aria-hidden />{tx(label)}
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : turns.map((t) => (
          <div key={t.id} className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <UserBubble>{t.q}</UserBubble>
            {t.error ? <AiResultCard error>{t.error}</AiResultCard>
              : t.busy ? (t.text ? <><Markdown text={t.text} className="px-0.5 text-ink" /><AiWriting /></>
                : <AiThinking lines={THINK.map((l) => tx(l))} />)
              : (
                <AiResultCard title={tx("Trả lời")} dim={t !== last} actions={<>
                  <Button size="xs" variant="ghost" disabled={saving} onClick={() => onSave(tgText(t.text))}><Send /> Saved Messages</Button>
                  <Button size="xs" variant="ghost" onClick={() => void copyText(t.text, tr("Đã copy"))}><Copy /> Copy</Button>
                </>}>
                  <Markdown text={t.text} className="text-ink" />
                </AiResultCard>
              )}
          </div>
        ))}
      </div>
      <div className="shrink-0 p-3">
        <AiPromptBox value={q} onChange={setQ} onSend={() => void ask()} running={busy} onStop={() => abort.current?.abort()}
          aria-label={tx("Hỏi AI về các nhóm")} maxLength={1000}
          placeholder={ready ? tx("Hỏi về mọi nhóm…") : tx("Tóm tắt một nhóm để hỏi AI")}
          tools={<ModelEffortPicker kind="brief" compact className="gap-x-2 text-xs" />}
          actions={!busy && (
            <Button size="icon-sm" className="rounded-full" aria-label={tx("Gửi câu hỏi")} disabled={!ready || !q.trim()} onClick={() => void ask()}>
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
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-ink-3">{text}</p>
      <div className="mt-1">{action}</div>
    </motion.div>
  );
}

// ---- the page --------------------------------------------------------------------------------------------------------

/** Every group at a glance: a to-do feed across groups, an AI assistant over all digests, and each group's status. */
/** `group`: the one group whose items show (null: all; undefined: not picked yet, the sidebar's first group);
 *  the sidebar's Briefing tab picks it too. */
export function BriefingPage({ group: picked, onGroup, onBack, onOpenDigest }: {
  group: string | null | undefined; onGroup: (chatId: string | null) => void; onBack: () => void; onOpenDigest: (chatId: string, title: string) => void;
}) {
  const tx = useT();
  const qc = useQueryClient();
  const list = useQuery(briefingQuery);
  const wait = useAiWait(list.isPending);
  const { runs, batch } = useBriefRun(); // null batch: nothing running
  const [aiOpen, setAiOpen] = useState(() => getPref(AI_PANE) === "1"); // desktop: closed until asked for, the list gets the room
  const showAi = (on: boolean) => { setAiOpen(on); put(AI_PANE, on ? "1" : null); };
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
  const answered = useQuery({ ...answeredQuery, enabled: summarized });
  const beReplies = useQuery({ ...beRepliesQuery, enabled: summarized }).data; // BE answered since the digest
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
  // Opening Briefing lands on the sidebar's first group, pinned so the order shifting after a summary doesn't jump away.
  const first = sortGroups(items, (i) => openCount(i.chat_id, i.saved?.result, done, answered.data))[0]?.chat_id;
  const group = picked === undefined ? first ?? null : picked;
  useEffect(() => { if (picked === undefined && first) onGroup(first); }, [picked, first, onGroup]);

  const shown = group ? todos.filter((t) => t.chat.chat_id === group) : todos;
  const tabs: [Tab, Key, string][] = [
    ...(todos.some((x) => x.mine) ? [["mine", "Cần bạn", "bg-hl"] as [Tab, Key, string]] : []),
    ["be", "Với BE", "bg-code"] as [Tab, Key, string], // always: an empty one says how to get BE topics
    ...KINDS.map((k) => [k, KIND[k].label, KIND[k].dot] as [Tab, Key, string]),
  ];
  const inTabOf = (t: Tab) => shown.filter((x) => (t === "mine" ? x.mine : t === "be" ? x.be : x.kind === t));
  // "Với BE": topics still waiting on BE (as its "N chờ trả lời"); what is settled stays listed for the code check, uncounted.
  const left = (t: Tab) => t === "be"
    ? new Set(inTabOf(t).filter((x) => x.kind === "confirmations" && !isClosed(x) && !isAnswered(x, beReplies?.[x.chat.chat_id])).map((x) => `${x.chat.chat_id}:${x.topic || x.text}`)).size
    : inTabOf(t).filter((x) => !isClosed(x)).length;
  const cur = tabs.find(([t]) => t === tab)?.[0] ?? tabs.find(([t]) => left(t))?.[0] ?? "confirmations";
  const inTab = inTabOf(cur);
  const openItems = inTab.filter((x) => !isClosed(x));
  const closedItems = inTab.filter(isClosed);

  const last = allowed.map((i) => i.saved?.created_at).filter((x): x is string => !!x).sort().at(-1);
  const running = batch !== null;
  const now = allowed.find((i) => runs[i.chat_id]?.status === "running");
  const save = useMutation({
    mutationFn: (text: string) => api<null>("/briefing/saved", { method: "POST", json: { text } }),
    onSuccess: () => toast({ text: tr("Đã gửi vào Saved Messages") }),
    onError: (e) => toast({ text: errorText(e, { not_connected: tr("Telegram chưa kết nối.") }, tr("Không gửi được, thử lại sau")) }),
  });

  const run = (groups: BriefingItem[], hours?: number) => runBrief(qc, groups, hours);
  // Digests made before BE topics existed: nothing in them is sorted by topic, so "Với BE" stays empty until a re-read.
  const legacy = allowed.filter((c) => c.saved && !KINDS.some((k) => c.saved!.result[k]?.some((it) => it.topic)))
    .filter((c) => !group || c.chat_id === group);

  async function copyAll() {
    const parts = allowed.filter((i) => i.saved).map((i) => toMarkdown(i.saved!.result, i.title).replace(/^# /, "## "));
    await copyText([`# Briefing ${timeLabel(new Date().toISOString(), true)}`, ...parts].join("\n\n"), tr("Đã copy markdown"));
  }

  const open = (i: Pick<BriefingItem, "chat_id" | "title">) => onOpenDigest(i.chat_id, i.title);
  // "Với BE" tab: each group's open Q&A with BE as topic cards (questions next to BE's answers), checkable against the code.
  const beCards = (c: BriefingItem) => c.saved && (
    <BeTopics chatId={c.chat_id} title={c.title} r={c.saved.result}
      open={(k, it) => !isClosedItem(c.chat_id, k, it, done, answered.data)} onToggle={(k, it) => toggle(todoKey(c.chat_id, k, it))} />
  );
  const beGroups = (group ? allowed.filter((c) => c.chat_id === group) : allowed).filter((c) => openItems.some((t) => t.chat === c));
  const byGroup = !group && allowed.length > 1; // all groups: items sit under their group's heading
  const row = (t: Todo) => (
    <TodoRow key={t.key} t={t} closed={isClosed(t)} showKind={cur === "mine" || cur === "be"} showGroup={byGroup && isClosed(t)}
      onToggle={() => toggle(t.key)} onOpen={() => open(t.chat)} />
  );
  const scope = group ? allowed.find((c) => c.chat_id === group) : undefined;
  const runFor = scope ? todo.filter((c) => c === scope) : todo; // one group picked in the sidebar: just that one
  const runButton = (
    <Button id="briefing-run" size="sm" disabled={!runFor.length || running} onClick={() => void run(runFor)}>
      <Sparkles /> {!runFor.length ? tx("Đã cập nhật") : scope ? tx("Tóm tắt tin mới") : tx("Tóm tắt tin mới · {n} nhóm", { n: runFor.length })}
    </Button>
  );
  const scopeLeft = shown.filter(pending).length;
  // The group on screen is being read (or nothing is summarized yet and a run is on): its AI scene, not an empty list.
  const reading = scope ? runs[scope.chat_id]?.status === "running" ? scope : undefined : !summarized ? now : undefined;
  const readingShown = useAiWait(!!reading);

  return (
    <MotionConfig reducedMotion="user">
      <section aria-label="Briefing" className="flex min-h-0 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 md:px-5">
          <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label={tx("Quay lại")}>
            <ArrowLeft />
          </Button>
          <div className="grid min-w-0 gap-0.5">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
              <span className="truncate">{scope?.title ?? tx("Tất cả nhóm")}</span>
              {scope && (
                <Hint side="bottom" text={tx("Xem việc của mọi nhóm")}>
                  <button type="button" onClick={() => onGroup(null)} className="shrink-0 rounded-sm text-xs font-normal text-ink-3 hover:text-ink hover:underline">{tx("Tất cả")}</button>
                </Hint>
              )}
            </h2>
            <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-3">
              {!list.data ? tx("Đang kiểm tra các nhóm…") : <>
                <span>{tx.n("{n} việc chờ xử lý", { n: <b className="font-bold text-ink-2 tabular-nums">{scope ? scopeLeft : leftAll}</b> })}</span>
                {(scope?.saved?.created_at ?? last) && <span className="hidden sm:inline">{tx("· cập nhật {time}", { time: timeLabel((scope?.saved?.created_at ?? last)!) })}</span>}
                {offline && <span className="text-warn">{tx("· Telegram chưa kết nối")}</span>}
              </>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <Popover.Root>
              <Hint side="bottom" text={tx("Tuần của tôi: số tag nhận, đã xử lý, thời gian xử lý")}>
                <Popover.Trigger aria-label={tx("Tuần của tôi")}
                  className="grid size-8 place-items-center rounded-md text-ink-2 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink data-popup-open:bg-hl-wash data-popup-open:text-hl-2">
                  <Gauge className="size-4" aria-hidden />
                </Popover.Trigger>
              </Hint>
              <Popover.Portal>
                <Popover.Positioner sideOffset={6} align="end" className="z-40 outline-none">
                  <Popover.Popup aria-label={tx("Tuần của tôi")}
                    className="w-[min(40rem,calc(100vw-2rem))] origin-(--transform-origin) rounded-lg bg-cotton p-3 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
                    <WeekStatsCard className="" empty={<p className="text-sm text-ink-3">{tx("Chưa có số liệu tuần này.")}</p>} />
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <Hint side="bottom" text={tx("Kiểm tra lại tin mới ở các nhóm")}>
              <Button size="icon-sm" variant="ghost" aria-label={tx("Kiểm tra lại")} disabled={running || list.isFetching}
                onClick={() => { void list.refetch(); void answered.refetch(); }}>
                <RotateCw className={cn(list.isFetching && "animate-spin")} />
              </Button>
            </Hint>
            <Hint side="bottom" text={tx("Copy tóm tắt của mọi nhóm thành một file markdown")}>
              <Button size="icon-sm" variant="ghost" aria-label={tx("Copy tất cả")} disabled={!summarized} onClick={() => void copyAll()}>
                <Copy />
              </Button>
            </Hint>
            <Hint side="bottom" text={tx("Gửi các mục chưa xử lý của mọi nhóm vào Saved Messages trên Telegram")}>
              <Button size="icon-sm" variant="ghost" aria-label={tx("Gửi vào Saved Messages")} disabled={!summarized || save.isPending}
                onClick={() => save.mutate(tgBriefing(todos.filter((t) => !isClosed(t))))}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </Hint>
            {summarized && (
              <Hint side="bottom" text={aiOpen ? tx("Ẩn Trợ lý AI để danh sách rộng hơn") : tx("Mở Trợ lý AI: hỏi về mọi nhóm")}>
                <Button size="sm" variant="ghost" className={cn("max-lg:hidden", aiOpen && "text-hl-2")} aria-pressed={aiOpen}
                  aria-label={tx("Trợ lý AI")} onClick={() => showAi(!aiOpen)}>
                  {aiOpen ? <PanelRightClose /> : <><AiBot className="size-4" /> {tx("Hỏi AI")}</>}
                </Button>
              </Hint>
            )}
            <span className="ml-1.5 flex items-center gap-2">
              {batch ? <>
                {batch.total > 1 && <span className="text-xs text-ink-3 tabular-nums">{Math.min(batch.done + 1, batch.total)}/{batch.total}</span>}
                <AiStop onClick={stopBrief} label={tx("Dừng tóm tắt")} hint={tx("Dừng tóm tắt (nhóm đang chạy bị hủy)")} />
              </> : runFor.length > 0 && runButton /* nothing new since the last digest: nothing to run */}
            </span>
          </div>
        </header>

        <AnimatePresence initial={false}>
          <RenewConsents key="renew" items={items} />
        </AnimatePresence>

        {summarized && (
          <div className="shrink-0 px-3 pt-2 lg:hidden">
            <Segmented id="brief-pane" label={tx("Khung")} variant="card" value={pane} onChange={setPane}
              items={[{ value: "todo", label: <><ListTodo className="size-3.5" aria-hidden />{tx("Việc · {n}", { n: leftAll })}</> }, { value: "ai", label: <><Sparkles className="size-3.5" aria-hidden />{tx("Trợ lý AI")}</> }]} />
          </div>
        )}

        {/* desktop: the AI column slides between 0 and 26rem (same track count, so the grid animates) */}
        <div className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] duration-(--dur-long) ease-(--ease-out) lg:transition-[grid-template-columns] motion-reduce:transition-none",
          summarized && (aiOpen ? "lg:grid-cols-[minmax(0,1fr)_26rem]" : "lg:grid-cols-[minmax(0,1fr)_0rem]"))}>
          <div className={cn("flex min-h-0 flex-col", summarized && pane === "ai" && "max-lg:hidden")}>
            {wait ? (
              <AiFetching kind="brief" />
            ) : readingShown ? (
              <AiFetching kind="digest" lines={digestLines((reading ?? scope ?? now)?.title)} />
            ) : list.isError ? (
              <p role="alert" className="flex items-center gap-2 p-5 text-sm text-error">
                {digestError(list.error)}
                <Button size="xs" variant="outline" onClick={() => void list.refetch()}><RotateCw /> {tx("Thử lại")}</Button>
              </p>
            ) : !allowed.length ? (
              <Empty icon={<Plus className="size-5" aria-hidden />} title={tx("Chưa có nhóm nào trong Briefing")}
                text={tx("Chọn một nhóm, cho phép AI đọc, rồi mỗi sáng chỉ cần bấm một nút để biết: ai đang chờ bạn, đã chốt gì, việc gì cần làm.")}
                action={
                  <AddGroup blocked={blocked} known={new Set(items.map((i) => i.chat_id))} onPick={onOpenDigest}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-hl px-3 text-sm font-medium text-hl-ink hover:brightness-110">
                    <Plus className="size-4" aria-hidden /> {tx("Thêm nhóm")}
                  </AddGroup>
                } />
            ) : !summarized ? (
              <Empty icon={<Sparkles className="size-5" aria-hidden />} title={tx("Chưa có bản tóm tắt nào")}
                text={tx("Tóm tắt các nhóm có tin mới: AI gom câu hỏi cần confirm, việc cần làm, quyết định và thay đổi vào một danh sách.")} action={runButton} />
            ) : (
              <>
                <div className="shrink-0 overflow-x-auto px-3 pt-3 [scrollbar-width:none] md:px-5">
                  <Segmented id="brief-tab" label={tx("Lọc việc")} value={cur} className="w-max"
                    onChange={(v) => { setTab(v); setShowDone(false); }}
                    items={tabs.map(([v, l]) => ({
                      value: v,
                      label: <span className="flex items-center gap-1.5">{tx(l)}<span className="font-mono tabular-nums opacity-70">{left(v)}</span></span>,
                      title: v === "mine" ? tx("Câu hỏi chờ bạn trả lời và việc giao cho bạn (theo tên YouTrack / vai trò PO)")
                        : v === "be" ? tx("Hỏi / trả lời / chốt với BE (API, field, data): đối chiếu với code để không sót") : undefined,
                    }))} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-4 md:px-3">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={`${cur}:${group}`} {...FADE}>
                      {cur === "be" && !openItems.length && legacy.length ? (
                        <Empty icon={<MessageCircleQuestion className="size-5" aria-hidden />} title={tx("Bản tóm tắt chưa gom theo chủ đề BE")}
                          text={tx("{groups}: bản tóm tắt làm trước khi có tính năng này. Đọc lại 7 ngày gần nhất để AI gom câu hỏi / trả lời với BE theo chủ đề.", { groups: legacy.map((c) => c.title).join(", ") })}
                          action={<Button size="sm" disabled={running} onClick={() => void run(legacy, 168)}><Sparkles /> {tx("Đọc lại 7 ngày · {n} nhóm", { n: legacy.length })}</Button>} />
                      ) : openItems.length && cur === "be" ? (
                        <div className="grid gap-4 px-1.5">
                          {beGroups.map((c) => (
                            <section key={c.chat_id} aria-label={c.title} className="grid gap-1.5">
                              {beGroups.length > 1 || !group ? (
                                <h3 className="flex items-center gap-2 text-xs font-bold text-ink-2">
                                  <StatusDot i={c} r={runs[c.chat_id]} />
                                  <button type="button" onClick={() => open(c)} className="min-w-0 truncate rounded-sm hover:text-ink hover:underline">{c.title}</button>
                                </h3>
                              ) : null}
                              {beCards(c)}
                            </section>
                          ))}
                        </div>
                      ) : openItems.length ? (
                        byGroup ? (
                          <div className="grid gap-3">
                            {allowed.map((c) => [c, openItems.filter((t) => t.chat === c)] as const).filter(([, its]) => its.length).map(([c, its]) => (
                              <section key={c.chat_id} aria-label={c.title} className="grid gap-0.5">
                                <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-cotton/95 px-2.5 py-1 text-xs font-bold text-ink-2 backdrop-blur-sm">
                                  <StatusDot i={c} r={runs[c.chat_id]} />
                                  <button type="button" onClick={() => onGroup(c.chat_id)} className="min-w-0 truncate rounded-sm hover:text-ink hover:underline">{c.title}</button>
                                  <span className="font-mono font-normal text-ink-3 tabular-nums">{its.length}</span>
                                  <Hint side="bottom" text={tx("Mở trang tóm tắt của nhóm")}>
                                    <button type="button" aria-label={tx("Mở {title}", { title: c.title })} onClick={() => open(c)} className="grid size-5 place-items-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
                                      <ArrowUpRight className="size-3" aria-hidden />
                                    </button>
                                  </Hint>
                                </h3>
                                <ul className="grid gap-0.5"><AnimatePresence initial={false}>{its.map(row)}</AnimatePresence></ul>
                              </section>
                            ))}
                          </div>
                        ) : (
                          <ul aria-label={tx("Việc cần xử lý")} className="grid gap-0.5"><AnimatePresence initial={false}>{openItems.map(row)}</AnimatePresence></ul>
                        )
                      ) : (
                        <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
                          <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}
                            className="grid size-10 place-items-center rounded-full bg-ok-wash text-ok">
                            <Check className="size-5" strokeWidth={2.5} aria-hidden />
                          </motion.span>
                          <p className="text-sm font-medium text-ink">{inTab.length ? tx("Đã xử lý hết mục này") : cur === "mine" ? tx("Không có gì đang chờ bạn") : tx("Không có mục nào")}</p>
                          {inTab.length > 0 && <p className="text-xs text-ink-3">{tx("Mục mới sẽ hiện ở đây sau lần tóm tắt tới.")}</p>}
                        </div>
                      )}
                      {closedItems.length > 0 && (
                        <div className="mt-2 grid gap-1 border-t border-rule px-2.5 pt-2">
                          <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}
                            className="flex items-center gap-1 justify-self-start rounded-sm text-xs text-ink-3 hover:text-ink">
                            <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out)", showDone && "rotate-90")} aria-hidden />
                            {tx("Đã xử lý {n}", { n: closedItems.length })}
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
          {summarized && ( // nothing to ask before a digest exists
            // clipped while it slides; fixed width inside so the text doesn't reflow; invisible (not focusable) once closed
            <div className={cn("min-h-0 overflow-hidden duration-(--dur-long) ease-(--ease-out) lg:transition-[visibility,opacity] motion-reduce:transition-none",
              pane === "todo" && "max-lg:hidden", !aiOpen && "lg:invisible lg:opacity-0")}>
              <AiPane ready onSave={(t) => save.mutate(t)} saving={save.isPending} onClose={() => showAi(false)} className="h-full lg:w-[26rem]" />
            </div>
          )}
        </div>
      </section>
    </MotionConfig>
  );
}

/** Sidebar order: groups with news first, then the most left to do. */
const sortGroups = (items: BriefingItem[], left: (i: BriefingItem) => number) =>
  items.filter((i) => i.consent).sort((a, b) => Number(hasNews(b)) - Number(hasNews(a)) || left(b) - left(a));

/** Sidebar under "Briefing": the groups (what still waits in each, how fresh), and everything done to one group:
 *  summarize it, open its Tóm tắt, take it out; "Thêm nhóm" at the end. A pick shows Briefing for that group. */
export function BriefingGroups({ selected, onSelect, onOpenDigest, collapsed }: {
  selected: string | null | undefined; onSelect: (chatId: string | null) => void; onOpenDigest: (chatId: string, title: string) => void; collapsed: boolean;
}) {
  const tx = useT();
  const qc = useQueryClient();
  const list = useQuery(briefingQuery);
  const { runs, batch } = useBriefRun();
  const [done] = useDone();
  const answered = useQuery({ ...answeredQuery, enabled: !!list.data?.some((i) => i.consent && i.saved) }).data;
  const [asking, setAsking] = useState<BriefingItem | null>(null); // the group whose removal waits for its dialog
  const items = list.data ?? [];
  const left = (i: BriefingItem) => openCount(i.chat_id, i.saved?.result, done, answered);
  const groups = sortGroups(items, left);
  const running = batch !== null;
  // Out of Briefing = AI may no longer read it: revoking the consent also drops its saved digest (as "Thu hồi" does).
  const remove = useMutation({
    mutationFn: (id: string) => api(`/chats/${encodeURIComponent(id)}/digest-consent`, { method: "PUT", json: { enabled: false, days: 30 } }),
    onSuccess: (_, id) => {
      setAsking(null);
      if (selected === id) onSelect(null);
      for (const key of [["briefing"], ["digest-saved", id], ["digest-consent", id]]) void qc.invalidateQueries({ queryKey: key });
      toast({ text: tr("Đã bỏ nhóm khỏi Briefing") });
    },
  });
  const row = (on: boolean) => cn(
    "relative flex h-10 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left text-sm text-ink-2 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink",
    on && "font-medium text-hl-2 hover:bg-transparent",
  );
  const fade = collapsed ? railHide : undefined;
  const count = (n: number, cls?: string) => n > 0 && <span className={cn("relative shrink-0 rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums", cls, fade)}>{n}</span>;
  const act = "grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-paper-3 hover:text-ink disabled:opacity-40";
  const status = (i: BriefingItem) => {
    const r = runs[i.chat_id];
    return r?.status === "error" ? tx("Lỗi: {e}", { e: r.error ?? "" }) : r?.status === "running" ? tx("Đang tóm tắt…")
      : !i.saved ? tx("Chưa tóm tắt lần nào") : `${tx("Tóm tắt lúc {time}", { time: timeLabel(i.saved.created_at) })}${hasNews(i) ? tx(" · có tin mới") : ""}`;
  };
  return (
    <nav aria-label={tx("Nhóm Briefing")} className="no-scrollbar h-full min-h-0 overflow-y-auto px-2 pb-3">
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
        {groups.map((i) => (
          <li key={i.chat_id} className="group/g relative">
            <Hint side="right" text={status(i)}>
              <button type="button" aria-current={selected === i.chat_id} onClick={() => onSelect(i.chat_id)} className={row(selected === i.chat_id)}>
                {selected === i.chat_id && <NavPill />}
                <span className="relative shrink-0">
                  <Avatar name={i.title} />
                  <span className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-paper-2 p-0.5"><StatusDot i={i} r={runs[i.chat_id]} /></span>
                </span>
                <span className={cn("relative min-w-0 flex-1 truncate", hasNews(i) && "font-medium text-ink", fade)}>{i.title}</span>
                {count(left(i), !collapsed ? "group-hover/g:invisible group-focus-within/g:invisible" : undefined)}
              </button>
            </Hint>
            {!collapsed && (
              <span className="absolute inset-y-0 right-1 hidden items-center rounded-md bg-paper-3 group-focus-within/g:flex group-hover/g:flex">
                {hasNews(i) && (
                  <Hint side="bottom" text={tx("Tóm tắt tin mới của nhóm này")}>
                    <button type="button" aria-label={tx("Tóm tắt {title}", { title: i.title })} disabled={running} onClick={() => void runBrief(qc, [i])} className={cn(act, "text-hl-2")}>
                      <Sparkles className="size-3.5" aria-hidden />
                    </button>
                  </Hint>
                )}
                <Hint side="bottom" text={tx("Mở trang Tóm tắt của nhóm (chọn khoảng thời gian, chọn tin)")}>
                  <button type="button" aria-label={tx("Mở {title}", { title: i.title })} onClick={() => onOpenDigest(i.chat_id, i.title)} className={act}>
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </button>
                </Hint>
                <Hint side="bottom" text={tx("Bỏ khỏi Briefing: AI thôi đọc nhóm này, bản tóm tắt đã lưu bị xóa")}>
                  <button type="button" aria-label={tx("Bỏ {title} khỏi Briefing", { title: i.title })} disabled={running} onClick={() => { remove.reset(); setAsking(i); }} className={cn(act, "hover:bg-error/10 hover:text-error")}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </Hint>
              </span>
            )}
          </li>
        ))}
        {list.isSuccess && (
          <li>
            <AddGroup blocked={items.filter((i) => !i.consent)} known={new Set(items.map((i) => i.chat_id))} onPick={onOpenDigest}
              className={cn(row(false), "text-ink-3 data-popup-open:bg-paper-3 data-popup-open:text-ink")}>
              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-rule-2"><Plus className="size-3" aria-hidden /></span>
              <span className={cn("min-w-0 flex-1 truncate", fade)}>{tx("Thêm nhóm")}</span>
              {count(items.filter((i) => !i.consent).length)}
            </AddGroup>
          </li>
        )}
      </ul>
      {list.isPending && <div className="grid gap-2 px-3 pt-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-4" style={{ width: `${70 - k * 12}%` }} />)}</div>}
      {list.isError && (
        <div role="alert" className="grid justify-items-start gap-2 px-3 py-2 text-sm">
          <p className="text-error">{tx("Không tải được danh sách Briefing.")}</p>
          <Button size="sm" variant="outline" onClick={() => void list.refetch()}><RotateCw /> {tx("Thử lại")}</Button>
        </div>
      )}
      {list.isSuccess && !groups.length && (
        <p className={cn("px-3 py-2 text-sm leading-relaxed text-ink-3", fade)}>{tx("Chưa có nhóm nào. Bấm “Thêm nhóm” để chọn nhóm cho AI tóm tắt.")}</p>
      )}
      <ConfirmDialog open={!!asking} onOpenChange={(o) => { if (!o) setAsking(null); }} icon={Trash2}
        title={tx("Bỏ nhóm khỏi Briefing?")} confirmLabel={tx("Bỏ nhóm")}
        description={tx("AI thôi đọc nhóm này và bản tóm tắt đã lưu bị xóa. Thêm lại lúc nào cũng được bằng “Thêm nhóm”.")}
        items={asking ? [{ id: asking.chat_id, label: asking.title,
          tag: asking.saved ? tx("{n} việc chờ", { n: left(asking) }) : tx("chưa tóm tắt") }] : undefined}
        busy={remove.isPending}
        error={running ? tx("Đang tóm tắt, chờ xong rồi bỏ nhóm.") : remove.isError && errorText(remove.error, {}, tx("Không bỏ được nhóm, thử lại."))}
        onConfirm={() => { if (asking && !running) remove.mutate(asking.chat_id); }} />
    </nav>
  );
}

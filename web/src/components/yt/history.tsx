"use client";

import { History, LayoutDashboard, ListChecks, MessageSquareText, Pencil, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { t as tNow, useT } from "@/lib/i18n";
import { getPref, put, readJson } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AI_MAX, type AiReq, type AiTurn, DAY, when, yt } from "@/lib/yt";
import { useQuery } from "@tanstack/react-query";
import { type AiPending, YtFetching } from "./bits";
import { fold, sessionId, toast } from "@/lib/inbox";
import { WorkView } from "./work";
import { AiBot, AiSpin } from "@/components/ai/chat";
import { DayGroups, DayTrash } from "@/components/ai/day-groups";
import { AI_WAIT_MS, useAiWait } from "@/components/ai/fetching";
import { BotStage, Empty } from "@/components/ui/empty";

// The YouTrack tab's AI history, per browser (Telegram's AI conversations live in AI Agent: tasks, Đối chiếu BE, Briefing). A small index lists the sessions,
// each session is its own key: the list never parses an answer, a turn rewrites one session + the index.

/** `pending`: the last turn, saved as it started, never answered (the page closed, an error). */
export type AiSession = { id: string; title: string; ids: string[]; req: AiReq | null; thread: AiTurn[]; pending?: AiPending };
// name: set by the user; pending: the last turn has no answer (job: its server run, maybe still going after a reload)
type Meta = { id: string; title: string; name?: string; ids: string[]; q: string; n: number; at: number; pending?: boolean; job?: string };

const IDX = "ytAiIdx";
const KEY = (id: string) => `ytAiS:${id}`;
const MAX = 40; // sessions kept; the oldest drop off
const TURNS = 12; // the follow-up API reads the last 12 turns, older ones are never sent again
const TTL = 14 * DAY; // ticket text, names, comments: not kept in the browser longer than this
const DONE = "ytAiDone"; // a run whose view was closed has ended (detail: session id): the history shows it afresh

/** Runs this page reads, their view open or closed: session id -> stop. After a reload the server's run goes on
 *  (AiJobs): the session keeps its job id, opening it reads the run again. */
const running = new Map<string, () => void>();
const isRunning = (id: string) => running.has(id);
const changed = () => dispatchEvent(new Event(IDX));

function readIdx(): Meta[] {
  const v = readJson(IDX, []);
  // src "tg": a Trợ lý Briefing conversation kept here before it moved to AI Agent › Briefing (lib/briefs.ts moves it)
  return Array.isArray(v) ? v.filter((m: Meta & { src?: string }) => Date.now() - m.at < TTL && !m.src) : [];
}

/** Sessions older than TTL: off the list (readIdx) and out of storage. */
function prune() {
  const v = readJson(IDX, []);
  const old = Array.isArray(v) ? (v as Meta[]).filter((m) => Date.now() - m.at >= TTL).map((m) => m.id) : [];
  if (old.length) drop(old);
}

export const newSessionId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Keep a session after each answered turn; storage full: drop the oldest sessions and try again. */
export function saveSession(s: AiSession) {
  const thread = s.thread.slice(-TURNS);
  const q = s.pending?.q || [...thread].reverse().find((t) => t.q)?.q || thread[0]?.a || s.pending?.label || "";
  prune();
  const old = readIdx();
  const name = old.find((m) => m.id === s.id)?.name; // a rename outlives the next turn
  const meta: Meta = { id: s.id, title: s.title, name, ids: s.ids, q: q.slice(0, 160), n: s.thread.length, at: Date.now(), pending: s.pending ? true : undefined, job: s.pending?.job };
  let idx = [meta, ...old.filter((m) => m.id !== s.id)];
  const body = JSON.stringify({ ...s, thread });
  for (let tries = 0; ; tries++) {
    for (const m of idx.slice(MAX)) put(KEY(m.id), null);
    idx = idx.slice(0, MAX);
    try { localStorage.setItem(KEY(s.id), body); localStorage.setItem(IDX, JSON.stringify(idx)); dispatchEvent(new Event(IDX)); return; } catch {
      if (tries > 3 || idx.length <= 1) return; // can't keep it; the chat itself still works
      idx = idx.slice(0, Math.max(1, Math.floor(idx.length / 2)));
    }
  }
}

/** A useAi `onTurn` + `session` that keep the conversation in the history: a new entry per conversation, each turn saved
 *  as it starts (pending) and again with its answer. `againRef.current = true` before re-running a saved first turn: the
 *  same entry goes on. `resumeId`: the entry being continued. `session(first)` (called as a turn starts, before its
 *  request) picks the entry and returns its code ("YT-xxxxxx"), also `code` for the view. */
export function useHistory(title: string, ids: string[], resumeId = "") {
  const sid = useRef(resumeId);
  const again = useRef(false);
  const [code, setCode] = useState(resumeId);
  const session = (first: boolean) => {
    if ((first && !again.current) || !sid.current) setCode((sid.current = newSessionId()));
    again.current = false;
    return sessionId({ id: sid.current }, "YT");
  };
  const alive = useRef(true); // the view that started the run is still open
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const onTurn = (req: AiReq | null, thread: AiTurn[], first: boolean, pending?: AiPending, stop?: () => void) => {
    if (!sid.current) setCode((sid.current = newSessionId())); // `session` picked it as the turn started
    const id = sid.current;
    if (!pending && !readIdx().some((m) => m.id === id)) return; // deleted while it ran: stays deleted
    saveSession({ id, title, ids: ids.slice(0, AI_MAX), req, thread, pending });
    if (!pending) return;
    if (stop) running.set(id, stop);
    changed();
    return () => {
      if (running.get(id) !== stop) return; // a newer stream of the same session (reopened run) owns it now
      running.delete(id);
      if (!alive.current) { // its view was closed: tell where the answer is
        dispatchEvent(new CustomEvent(DONE, { detail: id }));
        const m = readIdx().find((x) => x.id === id);
        if (m && !m.pending) toast({ text: tNow("AI đã trả lời “{name}”, xem ở Lịch sử AI", { name: nameOf(m) }) });
      }
      changed();
    };
  };
  return { onTurn, session, againRef: again, code: code ? sessionId({ id: code }, "YT") : "" };
}

/** A one-shot AI use with no follow-up (AI filter, ticket draft): kept as it starts, then with its result as text.
 *  `session`: its code ("YT-xxxxxx") for the request's X-Ai-Session, so the server logs the run with it. */
export function saveOneShot(title: string, q: string, label: string) {
  const id = newSessionId();
  saveSession({ id, title, ids: [], req: null, thread: [], pending: { q, label } });
  return { session: sessionId({ id }, "YT"), done: (a: string) => saveSession({ id, title, ids: [], req: null, thread: [{ q, a }] }) };
}

function loadSession(id: string): AiSession | null {
  try { return JSON.parse(getPref(KEY(id)) ?? "null"); } catch { return null; }
}

/** The user's own name for a session ("": back to the automatic one). */
function rename(id: string, name: string) {
  put(IDX, JSON.stringify(readIdx().map((m) => (m.id === id ? { ...m, name: name.trim().slice(0, 120) || undefined } : m))));
  dispatchEvent(new Event(IDX));
}

function drop(ids: string[]) {
  for (const id of ids) { running.get(id)?.(); put(KEY(id), null); } // a run of a deleted session stops
  put(IDX, JSON.stringify(readIdx().filter((m) => !ids.includes(m.id))));
}

/** Ticket: sessions about picked tickets; Dashboard: about figures (dashboard, reports, team), which pick none. */
type Tab = "all" | "ticket" | "dash";
const tabOf = (m: Meta): Tab => (m.ids.length ? "ticket" : "dash");
/** The session's name: its title, or (a ticket session, whose title said nothing) its tickets. */
function nameOf(m: { title: string; name?: string; ids: string[] }) {
  if (m.name) return m.name;
  const t = m.title.replace(/^AI( · )?/, "").trim();
  return t && t !== "ticket đã chọn" ? t : m.ids.length ? `${m.ids.slice(0, 3).join(", ")}${m.ids.length > 3 ? ` +${m.ids.length - 3}` : ""}` : tNow("Phiên AI");
}

/** A session whose last turn has no answer yet: running (here, or on the server since a reload), answered on the
 *  server (opening it reads the answer), or stopped. */
function PendingTag({ m, job }: { m: Meta; job?: "running" | "done" | "error" }) {
  const t = useT();
  return isRunning(m.id) || job === "running" ? <b className="ai-text font-medium">{t("Đang chạy")} · </b>
    : job === "done" ? <b className="font-medium text-ok">{t("Đã xong, mở để xem")} · </b>
    : <b className="font-medium text-warn">{t("Chưa xong")} · </b>;
}

/** A page like Thành viên: the sessions on a rail, the picked one on the right, where the chat goes on. */
export function HistoryPage() {
  const t = useT();
  const [idx, setIdx] = useState(readIdx);
  useEffect(() => { prune(); const f = () => setIdx(readIdx()); addEventListener(IDX, f); return () => removeEventListener(IDX, f); }, []);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sel, setSel] = useState("");
  const [sure, setSure] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // the open session's name being edited
  const [ver, setVer] = useState<Record<string, number>>({}); // a background run ended: its session is read again
  // the server's background runs (after a reload: which "Chưa xong" sessions still run, or wait with their answer)
  const jobs = useQuery({ queryKey: ["yt", "ai-jobs", idx.filter((m) => m.pending).length], queryFn: () => yt.aiJobStatus(), enabled: idx.some((m) => m.job),
    refetchInterval: (q) => (Object.values(q.state.data ?? {}).includes("running") ? 10_000 : false) }); // one query: a run that ends shows "Đã xong"
  useEffect(() => {
    const f = (e: Event) => { const id = (e as CustomEvent<string>).detail; setVer((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 })); };
    addEventListener(DONE, f); return () => removeEventListener(DONE, f);
  }, []);
  const cancelEdit = useRef(false); // Esc: the blur that follows must not save
  const inTab = useMemo(() => (tab === "all" ? idx : idx.filter((m) => tabOf(m) === tab)), [idx, tab]);
  const shown = useMemo(() => {
    const k = fold(q.trim());
    return k ? inTab.filter((m) => fold(`${sessionId(m, "YT")} ${m.name ?? ""} ${m.title} ${m.q} ${m.ids.join(" ")}`).includes(k)) : inTab;
  }, [inTab, q]);
  const cur = idx.find((m) => m.id === sel) ?? shown[0];
  const v = cur ? ver[cur.id] ?? 0 : 0;
  const s = useMemo(() => (cur ? loadSession(cur.id) : null), [cur?.id, v]); // eslint-disable-line react-hooks/exhaustive-deps -- a new turn must not reload the open chat; a background run's end does
  const n = (x: Tab) => (x === "all" ? idx.length : idx.filter((m) => tabOf(m) === x).length);
  const remove = (ids: string[]) => { drop(ids); setIdx(readIdx()); };

  // opening the tab: the sessions + their tickets are gathered (held AI_WAIT_MS), and the background runs' state when some session has one
  const [opening, setOpening] = useState(true);
  useEffect(() => { const h = setTimeout(() => setOpening(false), AI_WAIT_MS); return () => clearTimeout(h); }, []);
  if (useAiWait(opening || jobs.isLoading)) return <YtFetching kind="sessions" className="max-lg:min-h-[calc(100dvh-8rem)]" />;
  if (!idx.length) return (
    <Empty className="h-full min-h-[50vh] content-center max-lg:min-h-[calc(100dvh-8rem)]" title={t("Chưa có phiên AI nào")}
      art={<BotStage className="mb-2"><AiBot className="ai-float relative size-20 drop-shadow-lg" />
        <span className="absolute right-9 bottom-12 grid size-8 place-items-center rounded-full border border-rule bg-cotton shadow-stock"><History className="ai-hop size-4 text-hl-2" /></span></BotStage>}>
      {t("Mỗi lần hỏi AI trong tab YouTrack (ticket, dashboard, thành viên) sẽ được lưu ở đây, trên trình duyệt này, để đọc lại và hỏi tiếp.")}</Empty>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:h-full lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <nav aria-label={t("Phiên AI")} className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-cotton p-3 shadow-stock max-lg:max-h-80">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Tìm trong {n} phiên…", { n: idx.length })} aria-label={t("Tìm phiên AI")}
            className="h-8 w-full rounded-md border border-rule bg-paper pr-2 pl-7 text-sm focus:border-hl" />
        </label>
        <Segmented id="yt-history" label={t("Loại phiên AI")} value={tab} onChange={(x) => { setTab(x); setSure(false); }} className="w-full" items={([["all", "Tất cả"], ["ticket", "Ticket"], ["dash", "Số liệu"]] as const).map(([v, l]) => (
          { value: v, label: <>{t(l)} <span className="font-mono tabular-nums opacity-70">{n(v)}</span></> }))} />
        {/* sessions by day: a sticky day header (click: fold / unfold its sessions), the sessions hang under it on a guide line */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
          <DayGroups items={shown} at={(m) => m.at} open={!!q.trim()}
            actions={(day, ms) => (
              // delete this day's sessions (those shown: tab + search); two clicks like "Xóa tất cả"
              <DayTrash label={t("Xóa {n} phiên {day}", { n: ms.length, day: t(day).toLowerCase() })} ask={t("Xóa {n}?", { n: ms.length })}
                onRemove={() => remove(ms.map((m) => m.id))} />
            )}
            row={(m) => {
              const on = m.id === cur?.id, Icon = m.ids.length ? ListChecks : LayoutDashboard;
              const live = m.pending && (isRunning(m.id) || (!!m.job && jobs.data?.[m.job] === "running"));
              return (
                <li key={m.id} className="group relative rounded-md">
                  <button type="button" aria-current={on} onClick={() => setSel(m.id)}
                    className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1.5 pr-8 text-left", on ? "bg-hl-wash text-hl-2" : "hover:bg-paper-2")}>
                    {live ? <AiSpin className="mt-0.5" /> : <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />}
                    <span className="grid min-w-0">
                      <span className={cn("truncate text-sm", on && "font-medium")}>{nameOf(m)}</span>
                      <span className="truncate text-xs text-ink-3">{m.pending && <PendingTag m={m} job={m.job ? jobs.data?.[m.job] : undefined} />}{m.q.replace(/[*_#`>]/g, "") || t("{n} lượt", { n: m.n })}</span>
                    </span>
                  </button>
                  <Button size="icon-xs" variant="ghost" className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => remove([m.id])} aria-label={t("Xóa phiên {name}", { name: nameOf(m) })}><Trash2 /></Button>
                </li>
              );
            }} />
          {!shown.length && <p className="px-2 py-4 text-center text-xs text-ink-3">{t(q ? "Không có phiên nào khớp." : "Chưa có phiên nào loại này.")}</p>}
        </div>
        <Button size="xs" variant={sure ? "destructive" : "ghost"} className="self-start text-ink-3" disabled={!inTab.length} onBlur={() => setSure(false)}
          onClick={() => { if (!sure) { setSure(true); return; } remove(inTab.map((m) => m.id)); setSure(false); }}>
          <Trash2 /> {sure ? t("Bấm lần nữa để xóa {n} phiên", { n: inTab.length }) : tab === "all" ? t("Xóa tất cả") : t("Xóa {n} phiên này", { n: inTab.length })}</Button>
      </nav>

      {cur && (
        <section className="flex h-[75dvh] min-h-0 flex-col gap-3 lg:h-auto">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {editing !== null ? (
              <form className="mr-auto min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}>
                <input autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} maxLength={120} aria-label={t("Tên phiên AI")}
                  placeholder={nameOf({ ...cur, name: undefined })} onFocus={(e) => e.target.select()}
                  onBlur={() => { if (!cancelEdit.current) rename(cur.id, editing); cancelEdit.current = false; setEditing(null); }}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancelEdit.current = true; e.currentTarget.blur(); } }}
                  className="h-8 w-full rounded-md border border-hl bg-paper px-2 text-lg font-bold" />
              </form>
            ) : (
              <h2 className="group/name mr-auto flex min-w-0 items-center gap-1 text-lg font-bold">
                <span className="truncate">{nameOf(cur)}</span>
                <Hint side="bottom" text={t("Đổi tên phiên (để trống: về tên tự đặt)")}>
                  <Button size="icon-xs" variant="ghost" aria-label={t("Đổi tên phiên")} onClick={() => setEditing(cur.name ?? nameOf(cur))}
                    className="shrink-0 text-ink-3 opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100"><Pencil /></Button>
                </Hint>
              </h2>
            )}
            <span className="flex items-center gap-1.5 text-xs text-ink-3 tabular-nums"><MessageSquareText className="size-3.5" aria-hidden /><span>{t("{n} lượt", { n: cur.n })}</span><span>{when(cur.at)}</span></span>
          </div>
          {s ? <WorkView key={`${cur.id}:${v}`} title={cur.title} ids={s.ids} resume={s} />
            : <p className="m-auto text-sm text-ink-3">{t("Phiên này không còn trong bộ nhớ trình duyệt.")} <Button size="xs" variant="ghost" onClick={() => remove([cur.id])}>{t("Xóa khỏi danh sách")}</Button></p>}
        </section>
      )}
    </div>
  );
}


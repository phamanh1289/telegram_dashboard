"use client";

import { ChevronRight, History, LayoutDashboard, ListChecks, MessageSquareText, Pencil, Search, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { getPref, put, readJson } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AI_MAX, type AiReq, type AiTurn, DAY, when, yt } from "@/lib/yt";
import { useQuery } from "@tanstack/react-query";
import type { AiPending } from "./bits";
import { fold, toast } from "@/lib/inbox";
import { WorkView } from "./work";
import Link from "next/link";
import { AiResultCard, UserBubble } from "@/components/ai/chat";
import { Markdown } from "@/components/markdown";

// The YouTrack tab's AI history (apart from Telegram's AI Agent tasks), per browser. A small index lists the sessions,
// each session is its own key: the list never parses an answer, a turn rewrites one session + the index.

/** `pending`: the last turn, saved as it started, never answered (the page closed, an error). */
// src "tg": a Telegram AI conversation (Trợ lý Briefing, ⌘J), kept here so every AI conversation sits in one history
export type AiSession = { id: string; title: string; ids: string[]; req: AiReq | null; thread: AiTurn[]; pending?: AiPending; src?: "tg" };
// name: set by the user; pending: the last turn has no answer (job: its server run, maybe still going after a reload)
type Meta = { id: string; title: string; name?: string; ids: string[]; q: string; n: number; at: number; pending?: boolean; job?: string; src?: "tg" };

const IDX = "ytAiIdx";
const KEY = (id: string) => `ytAiS:${id}`;
const MAX = 40; // sessions kept; the oldest drop off
const TURNS = 12; // the follow-up API reads the last 12 turns, older ones are never sent again
const TTL = 14 * DAY; // ticket text, names, comments: not kept in the browser longer than this
const DONE = "ytAiDone"; // a run whose view was closed has ended (detail: session id): the history shows it afresh

/** Runs this page reads, their view open or closed: session id -> stop. After a reload the server's run goes on
 *  (AiJobs): the session keeps its job id, opening it reads the run again. */
const running = new Map<string, () => void>();
export const isRunning = (id: string) => running.has(id);
export const stopRun = (id: string) => running.get(id)?.();
const changed = () => dispatchEvent(new Event(IDX));

function readIdx(): Meta[] {
  const v = readJson(IDX, []);
  return Array.isArray(v) ? v.filter((m: Meta) => Date.now() - m.at < TTL) : [];
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
  const meta: Meta = { id: s.id, title: s.title, name, ids: s.ids, q: q.slice(0, 160), n: s.thread.length, at: Date.now(), pending: s.pending ? true : undefined, job: s.pending?.job, src: s.src };
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

/** A useAi `onTurn` that keeps the conversation in the history: a new entry per conversation, each turn saved as it
 *  starts (pending) and again with its answer. `againRef.current = true` before re-running a saved first turn: the same
 *  entry goes on. `resumeId`: the entry being continued. */
export function useHistory(title: string, ids: string[], resumeId = "") {
  const sid = useRef(resumeId);
  const again = useRef(false);
  const alive = useRef(true); // the view that started the run is still open
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const onTurn = (req: AiReq | null, thread: AiTurn[], first: boolean, pending?: AiPending, stop?: () => void) => {
    if ((first && pending && !again.current) || !sid.current) sid.current = newSessionId();
    const id = sid.current;
    if (!pending && !readIdx().some((m) => m.id === id)) return; // deleted while it ran: stays deleted
    if (pending) again.current = false;
    saveSession({ id, title, ids: ids.slice(0, AI_MAX), req, thread, pending });
    if (!pending) return;
    if (stop) running.set(id, stop);
    changed();
    return () => {
      running.delete(id);
      if (!alive.current) { // its view was closed: tell where the answer is
        dispatchEvent(new CustomEvent(DONE, { detail: id }));
        const m = readIdx().find((x) => x.id === id);
        if (m && !m.pending) toast({ text: `AI đã trả lời “${nameOf(m)}”, xem ở Lịch sử AI` });
      }
      changed();
    };
  };
  return { onTurn, againRef: again };
}

/** A one-shot AI use with no follow-up (AI filter, ticket draft): kept as it starts, then with its result as text. */
export function saveOneShot(title: string, q: string, label: string) {
  const id = newSessionId();
  saveSession({ id, title, ids: [], req: null, thread: [], pending: { q, label } });
  return (a: string) => saveSession({ id, title, ids: [], req: null, thread: [{ q, a }] });
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
type Tab = "all" | "ticket" | "dash" | "tg";
const tabOf = (m: Meta): Tab => (m.src === "tg" ? "tg" : m.ids.length ? "ticket" : "dash");

/** Trợ lý Briefing (Telegram) keeps each answered turn of its conversation here. */
export const saveTgTurns = (id: string, title: string, thread: AiTurn[]) => saveSession({ id, title, ids: [], req: null, thread, src: "tg" });
/** Rail headings: today, yesterday, this week, older. */
function dayOf(at: number) {
  const d = Math.floor((new Date().setHours(24, 0, 0, 0) - at) / DAY);
  return d < 1 ? "Hôm nay" : d < 2 ? "Hôm qua" : d < 7 ? "7 ngày qua" : "Cũ hơn";
}

/** The session's name: its title, or (a ticket session, whose title said nothing) its tickets. */
function nameOf(m: { title: string; name?: string; ids: string[] }) {
  if (m.name) return m.name;
  const t = m.title.replace(/^AI( · )?/, "").trim();
  return t && t !== "ticket đã chọn" ? t : m.ids.length ? `${m.ids.slice(0, 3).join(", ")}${m.ids.length > 3 ? ` +${m.ids.length - 3}` : ""}` : "Phiên AI";
}

/** A session whose last turn has no answer yet: running (here, or on the server since a reload), answered on the
 *  server (opening it reads the answer), or stopped. */
function PendingTag({ m, job }: { m: Meta; job?: "running" | "done" | "error" }) {
  return isRunning(m.id) || job === "running" ? <b className="font-medium text-hl-2">Đang chạy · </b>
    : job === "done" ? <b className="font-medium text-ok">Đã xong, mở để xem · </b>
    : <b className="font-medium text-warn">Chưa xong · </b>;
}

/** A page like Thành viên: the sessions on a rail, the picked one on the right, where the chat goes on. */
export function HistoryPage() {
  const [idx, setIdx] = useState(readIdx);
  useEffect(() => { prune(); const f = () => setIdx(readIdx()); addEventListener(IDX, f); return () => removeEventListener(IDX, f); }, []);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sel, setSel] = useState("");
  const [sure, setSure] = useState(false);
  const [sureDay, setSureDay] = useState(""); // the day whose delete waits for a second click
  const [editing, setEditing] = useState<string | null>(null); // the open session's name being edited
  const [ver, setVer] = useState<Record<string, number>>({}); // a background run ended: its session is read again
  // the server's background runs (after a reload: which "Chưa xong" sessions still run, or wait with their answer)
  const jobs = useQuery({ queryKey: ["yt", "ai-jobs", idx.filter((m) => m.pending).length], queryFn: () => yt.aiJobStatus(), enabled: idx.some((m) => m.job) });
  useEffect(() => {
    const f = (e: Event) => { const id = (e as CustomEvent<string>).detail; setVer((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 })); };
    addEventListener(DONE, f); return () => removeEventListener(DONE, f);
  }, []);
  const cancelEdit = useRef(false); // Esc: the blur that follows must not save
  const inTab = useMemo(() => (tab === "all" ? idx : idx.filter((m) => tabOf(m) === tab)), [idx, tab]);
  const shown = useMemo(() => {
    const k = fold(q.trim());
    return k ? inTab.filter((m) => fold(`${m.name ?? ""} ${m.title} ${m.q} ${m.ids.join(" ")}`).includes(k)) : inTab;
  }, [inTab, q]);
  const groups = useMemo(() => {
    const g: [string, Meta[]][] = [];
    for (const m of shown) { const d = dayOf(m.at), last = g.at(-1); if (last?.[0] === d) last[1].push(m); else g.push([d, [m]]); }
    return g;
  }, [shown]);
  const [shut, setShut] = useState<string[]>([]); // folded days (a search unfolds all)
  const calm = useReducedMotion();
  const cur = idx.find((m) => m.id === sel) ?? shown[0];
  const v = cur ? ver[cur.id] ?? 0 : 0;
  const s = useMemo(() => (cur ? loadSession(cur.id) : null), [cur?.id, v]); // eslint-disable-line react-hooks/exhaustive-deps -- a new turn must not reload the open chat; a background run's end does
  const n = (t: Tab) => (t === "all" ? idx.length : idx.filter((m) => tabOf(m) === t).length);
  const remove = (ids: string[]) => { drop(ids); setIdx(readIdx()); };

  if (!idx.length) return (
    <p className="mx-auto mt-16 max-w-sm text-center text-sm text-ink-3"><History className="mx-auto mb-2 size-6" />
      Chưa có phiên AI nào. Mỗi lần hỏi AI trong tab YouTrack (ticket, dashboard, thành viên) sẽ được lưu ở đây, trên trình duyệt này, để đọc lại và hỏi tiếp.</p>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:h-full lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <nav aria-label="Phiên AI" className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-cotton p-3 shadow-stock max-lg:max-h-80">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm trong ${idx.length} phiên…`} aria-label="Tìm phiên AI"
            className="h-8 w-full rounded-md border border-rule bg-paper pr-2 pl-7 text-sm focus:border-hl" />
        </label>
        <Segmented id="yt-history" label="Loại phiên AI" value={tab} onChange={(t) => { setTab(t); setSure(false); }} className="w-full" items={([["all", "Tất cả"], ["ticket", "Ticket"], ["dash", "Số liệu"], ["tg", "Telegram"]] as const).map(([v, l]) => (
          { value: v, label: <>{l} <span className="font-mono tabular-nums opacity-70">{n(v)}</span></> }))} />
        {/* sessions by day: a sticky day header (click: fold / unfold its sessions), the sessions hang under it on a guide line */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
          {groups.map(([day, ms]) => {
            const off = !q.trim() && shut.includes(day);
            return (
              <section key={day} aria-label={day}>
                <div className="group/day sticky top-0 z-10 flex items-center gap-1 bg-cotton pt-1">
                  <button type="button" aria-expanded={!off} onClick={() => setShut((x) => (off ? x.filter((d) => d !== day) : [...x, day]))}
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 pt-1.5 pb-1.5 text-xs font-semibold text-ink-3 hover:text-ink">
                    <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short)", !off && "rotate-90")} aria-hidden />{day}
                    <span className="ml-auto rounded-full bg-paper-3 px-1.5 font-mono text-[10px] font-medium tabular-nums">{ms.length}</span>
                  </button>
                  {/* delete this day's sessions (those shown: tab + search); two clicks like "Xóa tất cả" */}
                  <Button size="xs" variant={sureDay === day ? "destructive" : "ghost"} onBlur={() => setSureDay("")}
                    className={cn(sureDay !== day && "text-ink-3 opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100")}
                    aria-label={`Xóa ${ms.length} phiên ${day.toLowerCase()}`}
                    onClick={() => { if (sureDay !== day) { setSureDay(day); return; } remove(ms.map((m) => m.id)); setSureDay(""); }}>
                    <Trash2 />{sureDay === day && `Xóa ${ms.length}?`}</Button>
                </div>
                <AnimatePresence initial={false}>
                  {!off && (
                    <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: calm ? 0 : 0.2, ease: [0.2, 0, 0, 1] }} className="ml-3 grid gap-0.5 overflow-hidden border-l border-rule pl-1.5">
                      {ms.map((m) => {
                        const on = m.id === cur?.id, Icon = m.ids.length ? ListChecks : LayoutDashboard;
                        return (
                          <li key={m.id} className="group relative">
                            <button type="button" aria-current={on} onClick={() => setSel(m.id)}
                              className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1.5 pr-8 text-left", on ? "bg-hl-wash text-hl-2" : "hover:bg-paper-2")}>
                              <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                              <span className="grid min-w-0">
                                <span className={cn("truncate text-sm", on && "font-medium")}>{nameOf(m)}</span>
                                <span className="truncate text-xs text-ink-3">{m.pending && <PendingTag m={m} job={m.job ? jobs.data?.[m.job] : undefined} />}{m.q.replace(/[*_#`>]/g, "") || `${m.n} lượt`}</span>
                              </span>
                            </button>
                            <Button size="icon-xs" variant="ghost" className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              onClick={() => remove([m.id])} aria-label={`Xóa phiên ${nameOf(m)}`}><Trash2 /></Button>
                          </li>
                        );
                      })}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </section>
            );
          })}
          {!shown.length && <p className="px-2 py-4 text-center text-xs text-ink-3">{q ? "Không có phiên nào khớp." : "Chưa có phiên nào loại này."}</p>}
        </div>
        <Button size="xs" variant={sure ? "destructive" : "ghost"} className="self-start text-ink-3" disabled={!inTab.length} onBlur={() => setSure(false)}
          onClick={() => { if (!sure) { setSure(true); return; } remove(inTab.map((m) => m.id)); setSure(false); }}>
          <Trash2 /> {sure ? `Bấm lần nữa để xóa ${inTab.length} phiên` : tab === "all" ? "Xóa tất cả" : `Xóa ${inTab.length} phiên này`}</Button>
      </nav>

      {cur && (
        <section className="flex h-[75dvh] min-h-0 flex-col gap-3 lg:h-auto">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {editing !== null ? (
              <form className="mr-auto min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}>
                <input autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} maxLength={120} aria-label="Tên phiên AI"
                  placeholder={nameOf({ ...cur, name: undefined })} onFocus={(e) => e.target.select()}
                  onBlur={() => { if (!cancelEdit.current) rename(cur.id, editing); cancelEdit.current = false; setEditing(null); }}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); cancelEdit.current = true; e.currentTarget.blur(); } }}
                  className="h-8 w-full rounded-md border border-hl bg-paper px-2 text-lg font-semibold" />
              </form>
            ) : (
              <h2 className="group/name mr-auto flex min-w-0 items-center gap-1 text-lg font-semibold">
                <span className="truncate">{nameOf(cur)}</span>
                <Hint side="bottom" text="Đổi tên phiên (để trống: về tên tự đặt)">
                  <Button size="icon-xs" variant="ghost" aria-label="Đổi tên phiên" onClick={() => setEditing(cur.name ?? nameOf(cur))}
                    className="shrink-0 text-ink-3 opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100"><Pencil /></Button>
                </Hint>
              </h2>
            )}
            <span className="flex items-center gap-1.5 text-xs text-ink-3 tabular-nums"><MessageSquareText className="size-3.5" aria-hidden /><span>{cur.n} lượt</span><span>{when(cur.at)}</span></span>
          </div>
          {s?.src === "tg" ? <TgThread s={s} />
            : s ? <WorkView key={`${cur.id}:${v}`} title={cur.title} ids={s.ids} resume={s} />
            : <p className="m-auto text-sm text-ink-3">Phiên này không còn trong bộ nhớ trình duyệt. <Button size="xs" variant="ghost" onClick={() => remove([cur.id])}>Xóa khỏi danh sách</Button></p>}
        </section>
      )}
    </div>
  );
}

/** A Telegram conversation: read here; going on is the Trợ lý itself (⌘J on Telegram), where the groups' digests are. */
function TgThread({ s }: { s: AiSession }) {
  return (
    <div className="grid min-h-0 content-start gap-4 overflow-y-auto rounded-lg bg-cotton p-4 shadow-stock">
      {s.thread.map((t, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {t.q && <UserBubble>{t.q}</UserBubble>}
          <AiResultCard title="Trả lời"><Markdown text={t.a} className="text-ink" /></AiResultCard>
        </div>
      ))}
      <Link href="/?chat=__briefing__" className="w-fit text-sm text-hl-2 underline underline-offset-4">Hỏi tiếp ở Trợ lý Briefing (⌘J bên Telegram)</Link>
    </div>
  );
}

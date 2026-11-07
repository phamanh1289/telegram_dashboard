"use client";

import { ChevronRight, History, LayoutDashboard, ListChecks, MessageSquareText, Search, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { getPref, put, readJson } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { type AiReq, type AiTurn, DAY, when } from "@/lib/yt";
import { fold } from "@/lib/inbox";
import { WorkView } from "./work";

// The YouTrack tab's AI history (apart from Telegram's AI Agent tasks), per browser. A small index lists the sessions,
// each session is its own key: the list never parses an answer, a turn rewrites one session + the index.

export type AiSession = { id: string; title: string; ids: string[]; req: AiReq | null; thread: AiTurn[] };
type Meta = { id: string; title: string; ids: string[]; q: string; n: number; at: number };

const IDX = "ytAiIdx";
const KEY = (id: string) => `ytAiS:${id}`;
const MAX = 40; // sessions kept; the oldest drop off
const TURNS = 12; // the follow-up API reads the last 12 turns, older ones are never sent again

function readIdx(): Meta[] {
  const v = readJson(IDX, []);
  return Array.isArray(v) ? v : [];
}

export const newSessionId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Keep a session after each answered turn; storage full: drop the oldest sessions and try again. */
export function saveSession(s: AiSession) {
  const thread = s.thread.slice(-TURNS);
  const q = [...thread].reverse().find((t) => t.q)?.q ?? thread[0]?.a ?? "";
  const meta: Meta = { id: s.id, title: s.title, ids: s.ids, q: q.slice(0, 160), n: s.thread.length, at: Date.now() };
  let idx = [meta, ...readIdx().filter((m) => m.id !== s.id)];
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

function loadSession(id: string): AiSession | null {
  try { return JSON.parse(getPref(KEY(id)) ?? "null"); } catch { return null; }
}

function drop(ids: string[]) {
  for (const id of ids) put(KEY(id), null);
  put(IDX, JSON.stringify(readIdx().filter((m) => !ids.includes(m.id))));
}

/** Ticket: sessions about picked tickets; Dashboard: about figures (dashboard, reports, team), which pick none. */
type Tab = "all" | "ticket" | "dash";
const tabOf = (m: Meta): Tab => (m.ids.length ? "ticket" : "dash");
/** Rail headings: today, yesterday, this week, older. */
function dayOf(at: number) {
  const d = Math.floor((new Date().setHours(24, 0, 0, 0) - at) / DAY);
  return d < 1 ? "Hôm nay" : d < 2 ? "Hôm qua" : d < 7 ? "7 ngày qua" : "Cũ hơn";
}

/** The session's name: its title, or (a ticket session, whose title said nothing) its tickets. */
function nameOf(m: { title: string; ids: string[] }) {
  const t = m.title.replace(/^AI( · )?/, "").trim();
  return t && t !== "ticket đã chọn" ? t : m.ids.length ? `${m.ids.slice(0, 3).join(", ")}${m.ids.length > 3 ? ` +${m.ids.length - 3}` : ""}` : "Phiên AI";
}

/** A page like Thành viên: the sessions on a rail, the picked one on the right, where the chat goes on. */
export function HistoryPage() {
  const [idx, setIdx] = useState(readIdx);
  useEffect(() => { const f = () => setIdx(readIdx()); addEventListener(IDX, f); return () => removeEventListener(IDX, f); }, []);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sel, setSel] = useState("");
  const [sure, setSure] = useState(false);
  const inTab = useMemo(() => (tab === "all" ? idx : idx.filter((m) => tabOf(m) === tab)), [idx, tab]);
  const shown = useMemo(() => {
    const k = fold(q.trim());
    return k ? inTab.filter((m) => fold(`${m.title} ${m.q} ${m.ids.join(" ")}`).includes(k)) : inTab;
  }, [inTab, q]);
  const groups = useMemo(() => {
    const g: [string, Meta[]][] = [];
    for (const m of shown) { const d = dayOf(m.at), last = g.at(-1); if (last?.[0] === d) last[1].push(m); else g.push([d, [m]]); }
    return g;
  }, [shown]);
  const [shut, setShut] = useState<string[]>([]); // folded days (a search unfolds all)
  const calm = useReducedMotion();
  const cur = idx.find((m) => m.id === sel) ?? shown[0];
  const s = useMemo(() => (cur ? loadSession(cur.id) : null), [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- a new turn must not reload the open chat
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
        <Segmented id="yt-history" label="Loại phiên AI" value={tab} onChange={(t) => { setTab(t); setSure(false); }} className="w-full" items={([["all", "Tất cả"], ["ticket", "Ticket"], ["dash", "Số liệu"]] as const).map(([v, l]) => (
          { value: v, label: <>{l} <span className="font-mono tabular-nums opacity-70">{n(v)}</span></> }))} />
        {/* sessions by day: a sticky day header (click: fold / unfold its sessions), the sessions hang under it on a guide line */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule">
          {groups.map(([day, ms]) => {
            const off = !q.trim() && shut.includes(day);
            return (
              <section key={day} aria-label={day}>
                <button type="button" aria-expanded={!off} onClick={() => setShut((x) => (off ? x.filter((d) => d !== day) : [...x, day]))}
                  className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-cotton px-1.5 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase hover:text-ink">
                  <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short)", !off && "rotate-90")} aria-hidden />{day}
                  <span className="ml-auto rounded-full bg-paper-3 px-1.5 font-mono text-[10px] font-medium tabular-nums">{ms.length}</span>
                </button>
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
                                <span className="truncate text-xs text-ink-3">{m.q.replace(/[*_#`>]/g, "") || `${m.n} lượt`}</span>
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
            <h2 className="mr-auto min-w-0 truncate text-lg font-semibold">{nameOf(cur)}</h2>
            <span className="flex items-center gap-1.5 text-xs text-ink-3 tabular-nums"><MessageSquareText className="size-3.5" aria-hidden /><span>{cur.n} lượt</span><span>{when(cur.at)}</span></span>
          </div>
          {s ? <WorkView key={cur.id} title={cur.title} ids={s.ids} resume={s} />
            : <p className="m-auto text-sm text-ink-3">Phiên này không còn trong bộ nhớ trình duyệt. <Button size="xs" variant="ghost" onClick={() => remove([cur.id])}>Xóa khỏi danh sách</Button></p>}
        </section>
      )}
    </div>
  );
}

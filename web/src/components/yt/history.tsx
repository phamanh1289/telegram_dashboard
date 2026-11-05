"use client";

import { History, LayoutDashboard, ListChecks, MessageSquareText, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { getPref, put } from "@/lib/prefs";
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
  try { const v = JSON.parse(getPref(IDX) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
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
  const cur = idx.find((m) => m.id === sel) ?? shown[0];
  const s = useMemo(() => (cur ? loadSession(cur.id) : null), [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- a new turn must not reload the open chat
  const n = (t: Tab) => (t === "all" ? idx.length : idx.filter((m) => tabOf(m) === t).length);
  const remove = (ids: string[]) => { drop(ids); setIdx(readIdx()); };

  if (!idx.length) return (
    <p className="mx-auto mt-16 max-w-sm text-center text-sm text-ink-3"><History className="mx-auto mb-2 size-6" />
      Chưa có phiên AI nào. Mỗi lần hỏi AI trong tab YouTrack (ticket, dashboard, thành viên) sẽ được lưu ở đây, trên trình duyệt này, để đọc lại và hỏi tiếp.</p>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <nav aria-label="Phiên AI" className="grid content-start gap-2 overflow-y-auto rounded-[var(--radius-card)] bg-cotton p-3 shadow-stock max-lg:max-h-80 lg:sticky lg:top-28 lg:max-h-[calc(100dvh-8rem)]">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm trong ${idx.length} phiên…`} aria-label="Tìm phiên AI"
            className="h-8 w-full rounded-md border border-rule bg-paper pr-2 pl-7 text-sm focus:border-hl" />
        </label>
        <Segmented id="yt-history" label="Loại phiên AI" value={tab} onChange={(t) => { setTab(t); setSure(false); }} className="w-full" items={([["all", "Tất cả"], ["ticket", "Ticket"], ["dash", "Số liệu"]] as const).map(([v, l]) => (
          { value: v, label: <>{l} <span className="font-mono tabular-nums opacity-70">{n(v)}</span></> }))} />
        <ul className="grid gap-0.5 border-t border-rule pt-1">
          {shown.map((m, i) => {
            const on = m.id === cur?.id, day = dayOf(m.at), Icon = m.ids.length ? ListChecks : LayoutDashboard;
            return (
              <li key={m.id}>
                {day !== (shown[i - 1] && dayOf(shown[i - 1].at)) && <p className="px-2 pt-2 pb-1 text-xs font-medium text-ink-3">{day}</p>}
                <div className="group relative">
                <button type="button" aria-current={on} onClick={() => setSel(m.id)}
                  className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1.5 pr-8 text-left", on ? "bg-hl-wash text-hl-2" : "hover:bg-paper-2")}>
                  <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                  <span className="grid min-w-0">
                    <span className={cn("truncate text-sm", on && "font-medium")}>{m.title.replace(/^AI · /, "")}</span>
                    <span className="truncate text-xs text-ink-3">{m.q.replace(/[*_#`>]/g, "") || `${m.n} lượt`}</span>
                  </span>
                </button>
                <Button size="icon-xs" variant="ghost" className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => remove([m.id])} aria-label={`Xóa phiên ${m.title}`}><Trash2 /></Button>
                </div>
              </li>
            );
          })}
          {!shown.length && <li className="px-2 py-4 text-center text-xs text-ink-3">{q ? "Không có phiên nào khớp." : "Chưa có phiên nào loại này."}</li>}
        </ul>
        <Button size="xs" variant={sure ? "destructive" : "ghost"} className="justify-self-start text-ink-3" disabled={!inTab.length} onBlur={() => setSure(false)}
          onClick={() => { if (!sure) { setSure(true); return; } remove(inTab.map((m) => m.id)); setSure(false); }}>
          <Trash2 /> {sure ? `Bấm lần nữa để xóa ${inTab.length} phiên` : tab === "all" ? "Xóa tất cả" : `Xóa ${inTab.length} phiên này`}</Button>
      </nav>

      {cur && (
        <section className="flex h-[75dvh] min-h-0 flex-col gap-3 lg:sticky lg:top-28 lg:h-[calc(100dvh-8rem)]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="mr-auto min-w-0 truncate text-lg font-semibold">{cur.title.replace(/^AI · /, "")}</h2>
            <span className="flex items-center gap-1.5 text-xs text-ink-3 tabular-nums"><MessageSquareText className="size-3.5" aria-hidden /><span>{cur.n} lượt</span><span>{when(cur.at)}</span></span>
          </div>
          {s ? <WorkView key={cur.id} title={cur.title} ids={s.ids} resume={s} />
            : <p className="m-auto text-sm text-ink-3">Phiên này không còn trong bộ nhớ trình duyệt. <Button size="xs" variant="ghost" onClick={() => remove([cur.id])}>Xóa khỏi danh sách</Button></p>}
        </section>
      )}
    </div>
  );
}

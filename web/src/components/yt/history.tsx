"use client";

import { MessageSquareText, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getPref, put } from "@/lib/prefs";
import { toast } from "@/lib/inbox";
import { type AiReq, type AiTurn, when } from "@/lib/yt";
import { useYt } from "./state";

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
    try { localStorage.setItem(KEY(s.id), body); localStorage.setItem(IDX, JSON.stringify(idx)); return; } catch {
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

/** The list: open one to see the whole exchange and keep asking. */
export function HistoryView() {
  const y = useYt();
  const [idx, setIdx] = useState(readIdx);
  const [q, setQ] = useState("");
  const [sure, setSure] = useState(false);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? idx.filter((m) => `${m.title} ${m.q} ${m.ids.join(" ")}`.toLowerCase().includes(k)) : idx;
  }, [idx, q]);
  const remove = (ids: string[]) => { drop(ids); setIdx(readIdx()); };
  function open(m: Meta) {
    const s = loadSession(m.id);
    if (!s) { toast({ text: "Phiên này không còn trong bộ nhớ trình duyệt" }); remove([m.id]); return; }
    y.setSheet({ kind: "work", title: m.title, ids: s.ids, resume: s });
  }

  if (!idx.length) return <p className="m-auto max-w-sm text-center text-sm text-ink-3">Chưa có phiên AI nào. Mỗi lần hỏi AI trong tab YouTrack sẽ được lưu ở đây (trên trình duyệt này) để mở lại và hỏi tiếp.</p>;
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lọc theo tiêu đề, câu hỏi, ticket" aria-label="Lọc lịch sử AI" autoFocus
            className="h-8 w-full rounded-md border border-rule bg-cotton pr-2 pl-7 text-sm" />
        </label>
        <Button size="sm" variant={sure ? "destructive" : "ghost"} onClick={() => { if (!sure) { setSure(true); return; } remove(idx.map((m) => m.id)); setSure(false); }}
          onBlur={() => setSure(false)}><Trash2 /> {sure ? "Chắc chắn xóa hết?" : "Xóa tất cả"}</Button>
      </div>
      <p className="text-xs text-ink-3">{idx.length} phiên gần nhất, lưu trên trình duyệt này.</p>
      <ul className="grid gap-1.5">
        {shown.map((m) => (
          <li key={m.id} className="group grid grid-cols-[minmax(0,1fr)_auto] items-start rounded-lg bg-cotton shadow-stock hover:bg-paper-2">
            <button type="button" onClick={() => open(m)} className="grid gap-1 p-3 text-left">
              <span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{m.title}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-ink-3 tabular-nums">{when(m.at)}</span></span>
              {m.q && <span className="line-clamp-2 text-sm text-ink-2">{m.q}</span>}
              <span className="flex items-center gap-2 text-xs text-ink-3">
                <MessageSquareText className="size-3.5" aria-hidden />{m.n} lượt
                {!!m.ids.length && <span className="truncate font-mono">{m.ids.slice(0, 6).join(", ")}{m.ids.length > 6 ? ` +${m.ids.length - 6}` : ""}</span>}
              </span>
            </button>
            <Button size="icon-xs" variant="ghost" className="m-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => remove([m.id])}
              aria-label={`Xóa phiên ${m.title}`} title="Xóa phiên này"><Trash2 /></Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

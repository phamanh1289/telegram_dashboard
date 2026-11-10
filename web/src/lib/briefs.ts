"use client";

import { useEffect, useState } from "react";
import { put, readJson } from "@/lib/prefs";

// Trợ lý Briefing conversations (⌘J), per browser: listed in AI Agent › Briefing, newest first.

export type BriefTurn = { q: string; a: string };
export type Brief = { id: string; at: number; turns: BriefTurn[] };

const KEY = "tgBriefs";
const MAX = 30; // conversations kept; the oldest drop off
const TTL = 14 * 86_400_000; // group digests in the answers: not kept in the browser longer than this
const EV = "briefs";

/** Before this list, Lịch sử AI (YouTrack) kept them as src "tg" sessions: moved here once, then dropped there. */
function moveOld(): Brief[] {
  const idx = readJson("ytAiIdx", []);
  const old = Array.isArray(idx) ? idx.filter((m) => m?.src === "tg") : [];
  if (!old.length) return [];
  const out = old.flatMap((m): Brief[] => {
    const s = readJson(`ytAiS:${m.id}`) as { thread?: BriefTurn[] } | null;
    put(`ytAiS:${m.id}`, null);
    return s?.thread?.length ? [{ id: m.id, at: m.at, turns: s.thread }] : [];
  });
  put("ytAiIdx", JSON.stringify((idx as { src?: string }[]).filter((m) => m?.src !== "tg")));
  return out;
}

export function readBriefs(): Brief[] {
  const v = readJson(KEY, []);
  const list = Array.isArray(v) ? (v as Brief[]) : [];
  const moved = moveOld();
  const all = moved.length ? [...list, ...moved].sort((a, b) => b.at - a.at) : list;
  if (moved.length) put(KEY, JSON.stringify(all));
  return all.filter((b) => Date.now() - b.at < TTL);
}

function write(list: Brief[]) {
  // storage full: the oldest half goes, then nothing (the chat itself still works)
  if (!list.length) put(KEY, null); // the last one deleted: the loop below would write nothing and keep it
  for (let l = list.slice(0, MAX); l.length; l = l.slice(0, Math.floor(l.length / 2))) if (put(KEY, JSON.stringify(l))) break;
  dispatchEvent(new Event(EV));
}

/** Keep a conversation after each answered turn (`id`: one per conversation). */
export const saveBrief = (id: string, turns: BriefTurn[]) => write([{ id, at: Date.now(), turns }, ...readBriefs().filter((b) => b.id !== id)]);
export const dropBriefs = (ids: string[]) => write(readBriefs().filter((b) => !ids.includes(b.id)));

/** The kept conversations, updated as they change. */
export function useBriefs() {
  const [list, setList] = useState<Brief[]>([]);
  useEffect(() => { const f = () => setList(readBriefs()); f(); addEventListener(EV, f); return () => removeEventListener(EV, f); }, []);
  return list;
}

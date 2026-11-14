"use client";

import { type QueryClient, useMutation } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { answeredQuery, closedIds, digestError } from "@/features/telegram/components/digest-page";
import { api, type BriefingItem, type DigestResult, errorText } from "@/shared/lib/api";
import { t as tr } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { readDigestTeams, readIntro } from "@/shared/lib/prefs";

export type RunState = { status: "running" | "done" | "error"; error?: string };

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
export const stopBrief = () => briefStop?.abort();
/** A batch is running (the background run waits for it). */
export const briefRunning = () => brief.batch !== null;

/** One group at a time: keeps the AI provider and Telegram calm, and each result lands as it comes.
 *  Aborting is the stop: the server sees the request go and kills that AI run. */
/** `hours`: re-read that far back instead of only what is new (a digest made before BE topics existed). */
export async function runBrief(qc: QueryClient, groups: BriefingItem[], hours?: number) {
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

/** Telegram has messages newer than the last digest (or there was none yet). */
export const hasNews = (i: BriefingItem) =>
  i.latest_id !== null && i.latest_id !== undefined && (!i.saved || Number(i.latest_id) > Number(i.saved.last_message_id));

/** Sidebar order: groups with news first, then the most left to do. */
export const sortGroups = (items: BriefingItem[], left: (i: BriefingItem) => number) =>
  items.filter((i) => i.consent).sort((a, b) => Number(hasNews(b)) - Number(hasNews(a)) || left(b) - left(a));

/** Send a text to your Saved Messages on Telegram (Briefing's to-dos, a Trợ lý answer, YouTrack AI Studio). */
export const useSaveBriefing = () => useMutation({
  mutationFn: (text: string) => api<null>("/briefing/saved", { method: "POST", json: { text } }),
  onSuccess: () => toast({ text: tr("Đã gửi vào Saved Messages") }),
  onError: (e) => toast({ text: errorText(e, { not_connected: tr("Telegram chưa kết nối.") }, tr("Không gửi được, thử lại sau")) }),
});

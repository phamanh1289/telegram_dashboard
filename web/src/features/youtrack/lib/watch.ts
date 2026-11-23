"use client";

// The YouTrack watch kept while either module is open: my tickets (top bar, Telegram hints), tickets newly given to me,
// "Báo lại" items, desktop banners, and tickets a Telegram message says need a retest.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { t } from "@/shared/lib/i18n";
import { getPref, put, setPref, usePrefValue } from "@/shared/lib/prefs";
import { groupBy } from "@/shared/lib/utils";
import { loopKey, useLoopBack } from "@/features/telegram/lib/report-back";
import { selfEdits, type Ticket, yt, ytMeQuery } from "./yt";

/** My tickets (assigned or QC) in the saved project, for Telegram-side hints; the same cache as the YouTrack page.
 *  `poll`: the one reader that keeps it fresh (the top bar); per-message readers don't, or each row would run its own timer. */
const NO_ROWS: Ticket[] = [];
export function useMyTickets(on: boolean, poll = true) {
  const project = getPref("project") || "VA";
  const me = useQuery({ ...ytMeQuery, enabled: on });
  const q = useQuery({ queryKey: ["yt", "issues", project, "me"], queryFn: ({ signal }) => yt.issues(project, ["me"], signal), enabled: on && !!me.data?.name, retry: false, refetchInterval: poll && 5 * 60_000 });
  return { me: me.data?.name ?? null, rows: q.data ?? NO_ROWS, ready: !!q.data, project };
}

/** Desktop banner when the tab is in the background and "Thông báo trên máy" is on (bell popover on the YouTrack page). */
export function deskNotify(title: string, body: string, onClick?: () => void) {
  try {
    if (!document.hidden || getPref("ytNotify") !== "1" || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag: "yt-watch" });
    n.onclick = () => { focus(); onClick?.(); n.close(); };
  } catch {} // no Notification API
}

const FRESH = "ytFresh"; // "VA-1,VA-2": tickets checkNew found for me, not yet seen on the YouTrack page (red count on its switch)
const readFresh = () => (getPref(FRESH) ?? "").split(",").filter(Boolean);

/** Tickets newly given to me since I was last on the YouTrack page; `seen` (that page is open) clears them. */
export function useFreshTickets(seen: boolean) {
  const raw = usePrefValue(FRESH);
  useEffect(() => { if (seen && raw) setPref(FRESH, null); }, [seen, raw]);
  return seen ? [] : raw.split(",").filter(Boolean);
}

const NEW_SEEN = "ytNewSeen"; // {project: ids}: my open tickets (assignee or QC) at the last look, from the full "me" list

/** Open tickets newly given to me (assignee or QC) since the last look, in this session or an earlier one.
 *  `rows` must be the whole "me" list: a narrower page scope would make the missing ones look new later. First look only records. */
export function checkNew(project: string, me: string, rows: Ticket[], say: (id: string, text: string) => void) {
  let all: Record<string, string[]> = {};
  try { all = JSON.parse(getPref(NEW_SEEN) ?? "{}") ?? {}; } catch {}
  const seen = all[project] ? new Set(all[project]) : null;
  const mine = rows.filter((i) => !i.resolved && (i.assignee === me || i.qc === me));
  put(NEW_SEEN, JSON.stringify({ ...all, [project]: mine.map((i) => i.id) }));
  if (!seen) return;
  const now = Date.now();
  const fresh = mine.filter((i) => !seen.has(i.id) && i.reporter !== me && (selfEdits.get(i.id) ?? 0) < now - 3 * 60_000);
  for (const i of fresh) say(i.id, `${t(i.assignee === me ? "Mới giao cho bạn" : "Mới nhờ bạn test")}: ${i.summary ?? ""}`);
  if (fresh.length) setPref(FRESH, [...new Set([...readFresh(), ...fresh.map((i) => i.id)])].join(","));
  // on a Mac the server shows the banner (yt_dashboard.watch), even with no page open: not twice
  if (fresh.length && !navigator.userAgent.includes("Mac")) deskNotify(fresh.length === 1 ? t("Ticket mới: {id}", { id: fresh[0].id }) : t("{n} ticket mới cho bạn", { n: fresh.length }),
    fresh.slice(0, 4).map((i) => `${i.id}: ${i.summary ?? ""}`).join("\n"));
}

/** Mounted in the shell of both modules: tickets newly given to me (the shared 5-minute my-tickets poll), and "Báo lại"
 *  items the server's watch just queued (yt_dashboard.watch: it also wakes tags snoozed until a ticket is done). */
export function useWatchGlobal(say: (id: string, text: string) => void) {
  const { me, rows, ready, project } = useMyTickets(true);
  const loops = useLoopBack().data?.items;
  const said = useRef(say);
  const known = useRef<Set<string> | null>(null); // Báo lại items already shown: the first read is not news
  useEffect(() => { said.current = say; });
  useEffect(() => {
    if (!me || !ready) return;
    checkNew(project, me, rows, (id, text) => said.current(id, text));
  }, [project, me, rows, ready]);
  useEffect(() => {
    if (!loops) return;
    const fresh = known.current ? loops.filter((l) => !known.current!.has(loopKey(l))) : [];
    known.current = new Set(loops.map(loopKey));
    for (const [ticket, ls] of groupBy(fresh, (l) => l.ticket)) said.current(ticket, t("Báo lại trên Telegram: {n} tin nhắc ticket này (xem Việc cần xử lý)", { n: ls.length }));
  }, [loops]);
}

const FIXED = /(đã|da)\s*(fix|sửa|xong|deploy|merge|lên)|\b(fixed|deployed|resolved|build|retest)\b|test lại|lên (dev|test|stg|staging|uat)/i;
/** Tickets I QC that a message says are fixed / built: they need a retest. */
export function useRetest(text: string, on: boolean) {
  const ids = on && FIXED.test(text) ? [...new Set(text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g))] : [];
  const { me, rows } = useMyTickets(ids.length > 0, false);
  return ids.filter((id) => rows.some((i) => i.id === id && !i.resolved && i.qc === me));
}

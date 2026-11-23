import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { api, errorText, type Follow as FollowDTO, type FollowChange, type FollowWait } from "@/shared/lib/api";
import { t } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { getPref, isString, put, readList } from "@/shared/lib/prefs";

// Briefing follow-ups (backend telegram/follow.py): Chờ bổ sung and the items already put into a story. One document on
// the server, so every browser / machine sees the same; changes show at once and are saved in the background.

export type Wait = Required<FollowWait>;
export type Follow = { waits: Wait[]; storied: Record<string, { id: string; at: number }> };
// the wire leaves defaulted fields out: filled in here, so the page always has whole items
const whole = (f: FollowDTO): Follow => ({
  waits: (f.waits ?? []).map((w) => ({ ...w, label: w.label ?? "", why: w.why ?? "", who: w.who ?? "", tickets: w.tickets ?? [], message_ids: w.message_ids ?? [], state: w.state ?? "" })),
  storied: f.storied ?? {},
});

export const followQuery = {
  queryKey: ["briefing-follow"],
  queryFn: ({ signal }: { signal: AbortSignal }) => api<FollowDTO>("/briefing/follow", { signal }).then(whole),
  staleTime: 30_000,
};

/** One change: waits parked (`add`, replacing one of the same key) or no longer waiting (`drop`), items put into a story. */
export type Change = { add?: Wait[]; drop?: string[]; storied?: Follow["storied"] };
const apply = (cur: Follow, c: Change): Follow => {
  const gone = new Set([...(c.drop ?? []), ...(c.add ?? []).map((w) => w.key)]);
  return { waits: [...cur.waits.filter((w) => !gone.has(w.key)), ...(c.add ?? [])], storied: { ...cur.storied, ...c.storied } };
};
let tail: Promise<unknown> = Promise.resolve(); // changes go one at a time, in the order made
let sending = 0;

/** Sends one change, merged on the server (two tabs do not undo each other): on screen at once, then saved. Resolves
 *  false when it was not saved: the old list is back, the reason said. */
export function changeFollow(qc: QueryClient, c: Change): Promise<boolean> {
  const before = qc.getQueryData<Follow>(followQuery.queryKey);
  if (before) qc.setQueryData(followQuery.queryKey, apply(before, c)); // not read yet: the answer below fills it
  sending++;
  const run = tail.then(() => api<FollowDTO>("/briefing/follow", { method: "POST", json: c satisfies FollowChange })).then((f) => {
    if (!--sending) qc.setQueryData(followQuery.queryKey, whole(f)); // the last answer holds every change sent
    return true;
  }, (e) => {
    // ponytail: with another change still on its way, that one's answer (or its own failure) sets the list
    if (!--sending && before) qc.setQueryData(followQuery.queryKey, before);
    void qc.invalidateQueries({ queryKey: followQuery.queryKey }); // what the server really holds
    toast({ text: errorText(e, {}, t("Không lưu được danh sách theo dõi, thử lại")) });
    return false;
  });
  tail = run;
  return run;
}

const OLD = "briefWaits"; // the first version kept Chờ bổ sung in this browser only: moved to the server once

/** The follow-ups, read once for the page (Briefing, its rows' buttons, the overdue nudge share the query). */
export function useFollow(enabled = true) {
  const qc = useQueryClient();
  const q = useQuery({ ...followQuery, enabled });
  const loaded = q.isSuccess;
  useEffect(() => {
    const old = getPref(OLD);
    if (!loaded || !old) return;
    let list: Wait[] = [];
    try {
      const have = new Set(qc.getQueryData<Follow>(followQuery.queryKey)?.waits.map((w) => w.key));
      list = whole({ waits: (JSON.parse(old) as FollowWait[]).filter((w) => w?.key && !have.has(w.key)) }).waits;
    } catch {} // unreadable: nothing to move
    if (!list.length) put(OLD, null);
    else void changeFollow(qc, { add: list }).then((ok) => { if (ok) put(OLD, null); }); // not saved: kept here for the next try
  }, [loaded, qc]);
  return q;
}

/** Where one item went ("đã vào story"), for a row: it re-renders only when its own mark changes. */
export const useStoried = (key: string, on = true) =>
  useQuery({ ...followQuery, enabled: on, select: (f: Follow) => f.storied[key] }).data;

// ---- "Đã xử lý" ticks on Briefing items: read once from the server, each change sent as it happens (the server merges,
// so two tabs do not undo each other). One store for Briefing, the sidebar's counts, a group's Tóm tắt and Hôm nay.

const DONE_OLD = "briefDone"; // the first version kept the ticks in this browser only: moved to the server once
const NO_DONE = new Set<string>();
let doneSet: Set<string> | null = null; // null: not read yet
let doneLoad: Promise<void> | null = null;
const doneSubs = new Set<() => void>();
let doneTail: Promise<unknown> = Promise.resolve();
const doneNotify = () => doneSubs.forEach((f) => f());
const postDone = (keys: string[], on: boolean) => api<string[]>("/briefing/done", { method: "POST", json: { keys, on } });

function loadDone() {
  doneLoad ??= api<string[]>("/briefing/done").then((list) => {
    const old = readList(DONE_OLD, [], isString);
    doneSet = new Set([...list, ...(doneSet ?? []), ...old]); // ticks made while it loaded stay
    if (old.length) void postDone(old, true).then(() => put(DONE_OLD, null)).catch(() => {}); // kept here for the next try
    doneNotify();
  }).catch((e) => {
    setTimeout(() => { doneLoad = null; }, 10_000); // read again by the next page that needs it, not by every row mounting now
    toast({ text: errorText(e, {}, t("Không đọc được các mục đã xử lý: danh sách có thể còn mục bạn đã xử lý")) });
  });
}
/** The ticks known now (empty until read): for code outside React (closedIds). */
export const readDone = () => doneSet ?? NO_DONE;
const subDone = (f: () => void) => { loadDone(); doneSubs.add(f); return () => { doneSubs.delete(f); }; };

/** Ticks `keys` on or off: on screen at once, then saved; a failed save puts them back and says why. */
export function setDone(keys: string[], on: boolean) {
  if (!keys.length) return;
  const before = readDone(), next = new Set(before);
  for (const k of keys) if (on) next.add(k); else next.delete(k);
  doneSet = next;
  doneNotify();
  // one save at a time, in click order: a quick tick then untick must not reach the server the other way round
  const save = doneTail.then(() => postDone(keys, on));
  doneTail = save.catch(() => {}); // the next save runs whatever this one did; its own failure is said below
  save.catch((e) => {
    const cur = new Set(readDone());
    for (const k of keys) if (before.has(k)) cur.add(k); else cur.delete(k);
    doneSet = cur;
    doneNotify();
    toast({ text: errorText(e, {}, t("Không lưu được đánh dấu đã xử lý, thử lại")) });
  });
}

export function useDone() {
  const done = useSyncExternalStore(subDone, readDone, () => NO_DONE);
  const toggle = (key: string) => setDone([key], !readDone().has(key));
  return [done, toggle] as const;
}

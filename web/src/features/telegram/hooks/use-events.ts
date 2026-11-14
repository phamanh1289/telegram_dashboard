"use client";

import { type InfiniteData, type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChangeItem, type ChangesPage, type Message, type MessagesPage, type PendingItem, type QaItem, type Status, type Task } from "@/shared/lib/api";
import { t } from "@/shared/lib/i18n";
import { msgKey, sentQuery } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { notifyPreview, readNotify } from "@/shared/lib/prefs";

type Listener = (items: ChangeItem[]) => void;
const listeners = new Set<Listener>();

/** Subscribe to applied changes (e.g. to flag a stale AI draft or deleted reply target). */
export function onChanges(cb: Listener) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export type StreamState = "connecting" | "open" | "closed";

/**
 * Desktop notification for fresh incoming tags while the tab is hidden. Stored messages are only tags/replies
 * to you, so "new" + not outgoing = a new tag. The age check skips the 14-day backfill after a reconnect.
 */
function notifyNew(items: ChangeItem[], preview: boolean) {
  if (!document.hidden || !readNotify()) return;
  const fresh = items.flatMap((it) =>
    it.kind === "new" && it.message && !it.message.outgoing && !it.message.handled && Date.now() - new Date(it.message.date).getTime() < 10 * 60_000
      ? [it.message]
      : [],
  );
  try {
    for (const m of fresh.slice(0, 3)) {
      const n = new Notification(m.sender_name ?? t("Tag mới"), {
        body: preview ? m.text.slice(0, 200) || t("[tệp đính kèm]") : t("Tag mới"), // the text only when Settings › AI allows it
        tag: `${m.chat_id}:${m.message_id}`,
      });
      n.onclick = () => {
        focus();
        n.close();
      };
    }
    if (fresh.length > 3) new Notification(t("Còn {n} tag mới khác", { n: fresh.length - 3 }), { tag: "more" });
  } catch {} // no Notification constructor here (Android Chrome, webviews): nothing to show
}

type Pages = InfiniteData<MessagesPage, string | null>;
/** What decides which views a row is in: a change to any of these can move it, so those views refetch. */
const viewState = (m: Message) => `${m.handled}|${m.deleted}|${m.pinned}|${m.snoozed_until ?? ""}|${m.outgoing}|${m.priority}`;

/**
 * An edit that leaves the row in every view it is in (text, reactions…): put the server's copy into the cached lists
 * instead of refetching every loaded page. False when it may move between views, or no cached copy says what it was.
 */
function patchEdit(qc: QueryClient, m: Message) {
  const k = msgKey(m), want = viewState(m);
  let seen = false, same = true;
  const check = (x: Message) => {
    if (msgKey(x) !== k) return;
    seen = true;
    if (viewState(x) !== want) same = false;
  };
  for (const [, d] of qc.getQueriesData<Pages>({ queryKey: ["messages", m.chat_id] })) d?.pages.forEach((p) => p.items.forEach(check));
  for (const [, d] of qc.getQueriesData<PendingItem[]>({ queryKey: ["pending"] })) d?.forEach((p) => check(p.message));
  if (!seen || !same) return false;
  const swap = (x: Message) => (msgKey(x) === k ? m : x);
  qc.setQueriesData<Pages>({ queryKey: ["messages", m.chat_id] }, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map(swap) })) });
  qc.setQueriesData<PendingItem[]>({ queryKey: ["pending"] }, (d) => d?.map((p) => ({ ...p, message: swap(p.message) })));
  // Search results match on text: those still refetch.
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "messages" && q.queryKey[1] === m.chat_id && !!q.queryKey[2] });
  return true;
}

function inQa(qc: QueryClient, it: ChangeItem) {
  const ids = [it.message_id, it.message?.reply_to_id].filter(Boolean);
  return ids.length > 0 && qc.getQueriesData<QaItem[]>({ queryKey: ["qa", it.chat_id] })
    .some(([, d]) => d?.some((i) => [i.question, ...i.answers].some((m) => ids.includes(m.message_id))));
}

/** Apply one /changes page to the caches; each query is invalidated once per page, not once per item. */
export function applyChanges(qc: QueryClient, items: ChangeItem[]) {
  if (!items.length) return;
  const touched = new Set<string>(); // chats with message changes
  for (const it of items) {
    if (it.message_id === null) {
      if (it.kind === "tracking") void qc.invalidateQueries({ queryKey: ["messages", it.chat_id] });
      else {
        void qc.resetQueries({ queryKey: ["messages", it.chat_id] });
        void qc.invalidateQueries({ queryKey: ["qa", it.chat_id] });
      }
      continue;
    }
    if (it.kind === "edit" && it.message && patchEdit(qc, it.message)) continue;
    touched.add(it.chat_id);
  }
  // Every stored view filters (chưa / đã xử lý, search, dates): a change can add or drop rows, so refetch.
  for (const chat of touched) void qc.invalidateQueries({ queryKey: ["messages", chat] });
  // Pending counts and lists (pinned too); a purged / untracked group drops out of them as well.
  if (touched.size || items.some((it) => it.message_id === null)) {
    void qc.invalidateQueries({ queryKey: ["chats"] });
    void qc.invalidateQueries({ queryKey: ["pending"] });
  }
  // A task's tag, or a message sent along to it, changed (e.g. marked done, which closes the session): its row on AI
  // Agent shows that state
  const tasks = new Set((qc.getQueryData<Task[]>(["tasks"]) ?? []).map(msgKey));
  const sent = qc.getQueryData<Record<string, string[]>>(sentQuery.queryKey) ?? {};
  if (items.some((it) => tasks.has(msgKey(it)) || msgKey(it) in sent)) void qc.invalidateQueries({ queryKey: ["tasks"] });
  // A tag in a Q&A thread changed (done, snoozed, pinned) or a new tag answers one: that group's Q&A reads again now,
  // not at its next poll. Only groups with a cached thread holding it (Q&A reads Telegram live).
  for (const chat of new Set(items.filter((it) => inQa(qc, it)).map((it) => it.chat_id))) void qc.invalidateQueries({ queryKey: ["qa", chat] });
  listeners.forEach((cb) => cb(items));
  notifyNew(items, notifyPreview(qc));
}

/**
 * One EventSource while unlocked and visible (or always, when tag notifications are on). SSE only wakes us up; data comes from
 * /api/changes and lastApplied only advances after a page was fetched. Failed drains and a closed stream retry with backoff.
 */
export function useSync(baseline: string) {
  const qc = useQueryClient();
  // the notification-preview switch (Settings, same key): read by notifyNew; off until it loads
  useQuery({ queryKey: ["privacy"], queryFn: ({ signal }) => api<{ notify_preview: boolean }>("/privacy", { signal }), retry: false, staleTime: Infinity });
  const lastApplied = useRef(baseline);
  const epoch = useRef(0); // bumped by every reset, so a drain started before it drops its page
  const running = useRef(false);
  const again = useRef(false);
  const live = useRef(true);
  const es = useRef<EventSource | null>(null);
  const [stream, setStream] = useState<StreamState>("connecting");

  const reset = useCallback(
    (cursor: string) => {
      epoch.current++;
      lastApplied.current = cursor;
      void qc.resetQueries({ queryKey: ["messages"] });
      for (const k of ["chats", "pending", "tasks", "qa"]) void qc.invalidateQueries({ queryKey: [k] });
    },
    [qc],
  );

  const drain = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    let failed = false;
    try {
      for (let wait = 1000; live.current; wait = Math.min(wait * 2, 30_000)) {
        try {
          do {
            again.current = false;
            for (;;) {
              const seen = epoch.current;
              const page = await api<ChangesPage>(
                `/changes?cursor=${encodeURIComponent(lastApplied.current)}&limit=200`,
              );
              if (seen !== epoch.current) { // an SSE reset moved the cursor meanwhile: this page is from before it
                again.current = true;
                break;
              }
              if (page.reset) {
                reset(page.next_cursor);
                break;
              }
              // Advance first: a throwing listener must not pin the cursor and replay this page forever.
              lastApplied.current = page.next_cursor;
              applyChanges(qc, page.items);
              if (!page.has_more) break;
            }
          } while (again.current);
          if (failed && es.current?.readyState === EventSource.OPEN) setStream("open");
          return;
        } catch (e) {
          console.error("sync: /changes failed, retrying", e);
          failed = true;
          setStream("connecting");
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    } finally {
      running.current = false;
    }
  }, [qc, reset]);

  useEffect(() => {
    live.current = true;
    let wait = 1000;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (es.current || (document.visibilityState !== "visible" && !readNotify())) return;
      setStream("connecting");
      const src = (es.current = new EventSource(`/api/events?cursor=${encodeURIComponent(lastApplied.current)}`));
      src.onopen = () => {
        wait = 1000;
        setStream("open");
        void drain();
      };
      src.onerror = () => {
        if (src.readyState !== EventSource.CLOSED) return setStream("connecting"); // the browser reconnects on its own
        setStream("closed");
        es.current = null;
        void qc.invalidateQueries({ queryKey: ["status"] }); // maybe locked
        retry = setTimeout(open, wait);
        wait = Math.min(wait * 2, 30_000);
      };
      src.addEventListener("change", () => void drain());
      src.addEventListener("reset", (e) => reset(JSON.parse((e as MessageEvent).data).cursor));
      let loop: number | undefined; // the server's Báo lại revision: read the list again when it moves (and on (re)connect)
      let auto: [number, string] | undefined; // Vòng BE tự chạy (autobe.py): [revision, last failure]
      src.addEventListener("status", (e) => {
        const { state, loop: rev, auto: a } = JSON.parse((e as MessageEvent).data) as { state: Status["state"]; loop?: number; auto?: [number, string] };
        qc.setQueryData<Status>(["status"], (s) => (s ? { ...s, state } : s));
        if (rev !== loop) void qc.invalidateQueries({ queryKey: ["loopback"] });
        loop = rev;
        if (a && a[0] !== auto?.[0]) {
          void qc.invalidateQueries({ queryKey: ["tasks"] }); // a session it started / went on
          if (auto && a[1] && a[1] !== auto[1]) toast({ text: t("Vòng BE tự chạy: {e}", { e: a[1] }) });
        }
        auto = a;
      });
    };
    const close = () => {
      clearTimeout(retry);
      es.current?.close();
      es.current = null;
      setStream("closed");
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        open();
        void drain();
      } else if (!readNotify()) close();
    };
    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, [drain, reset, qc]);

  return stream;
}

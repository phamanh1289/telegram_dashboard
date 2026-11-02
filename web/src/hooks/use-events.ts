"use client";

import { type InfiniteData, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChangeItem, type ChangesPage, type Message, type MessagesPage, type Status, type Task } from "@/lib/api";
import { msgKey } from "@/lib/inbox";
import { readNotify } from "@/lib/prefs";

type Listener = (items: ChangeItem[]) => void;
const listeners = new Set<Listener>();

/** Subscribe to applied changes (e.g. to flag a stale AI draft or deleted reply target). */
export function onChanges(cb: Listener) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export type StreamState = "connecting" | "open" | "closed";

function upsert(data: InfiniteData<MessagesPage> | undefined, m: Message) {
  if (!data) return data;
  let found = false;
  const pages = data.pages.map((p) => ({
    ...p,
    items: p.items.map((x) => (x.message_id === m.message_id ? ((found = true), m) : x)),
  }));
  const first = pages[0];
  if (!found && first) {
    const last = first.items.at(-1);
    // pages[0] is the newest page; older unseen ids are fetched when scrolling back.
    if (!last || Number(m.message_id) > Number(last.message_id)) {
      pages[0] = { ...first, items: [...first.items, m] };
    }
  }
  return { ...data, pages };
}

/**
 * Desktop notification for fresh incoming tags while the tab is hidden. Stored messages are only tags/replies
 * to you, so "new" + not outgoing = a new tag. The age check skips the 14-day backfill after a reconnect.
 */
function notifyNew(items: ChangeItem[]) {
  if (!document.hidden || !readNotify()) return;
  const fresh = items.flatMap((it) =>
    it.kind === "new" && it.message && !it.message.outgoing && !it.message.handled && Date.now() - new Date(it.message.date).getTime() < 10 * 60_000
      ? [it.message]
      : [],
  );
  try {
    for (const m of fresh.slice(0, 3)) {
      const n = new Notification(m.sender_name ?? "Tag mới", {
        body: m.text.slice(0, 200) || "[tệp đính kèm]",
        tag: `${m.chat_id}:${m.message_id}`,
      });
      n.onclick = () => {
        focus();
        n.close();
      };
    }
    if (fresh.length > 3) new Notification(`Còn ${fresh.length - 3} tag mới khác`, { tag: "more" });
  } catch {} // no Notification constructor here (Android Chrome, webviews): nothing to show
}

/** Apply one /changes page to the caches; each query is invalidated once per page, not once per item. */
export function applyChanges(qc: QueryClient, items: ChangeItem[]) {
  if (!items.length) return;
  const touched = new Set<string>(); // chats with message changes
  for (const it of items) {
    if (it.message_id === null) {
      if (it.kind === "tracking") void qc.invalidateQueries({ queryKey: ["messages", it.chat_id] });
      else void qc.resetQueries({ queryKey: ["messages", it.chat_id] });
      continue;
    }
    touched.add(it.chat_id);
    // Live rows go into the plain view only (no search, no date range, not "chưa xử lý"); the rest refetch below.
    const m = it.message;
    if (m) qc.setQueriesData<InfiniteData<MessagesPage>>({ queryKey: ["messages", it.chat_id, "", "", false] }, (d) => upsert(d, m));
  }
  // Searches, date ranges and the "not handled" view can gain or lose rows: refetch those.
  for (const chat of touched) {
    void qc.invalidateQueries({
      queryKey: ["messages", chat],
      predicate: (q) => q.queryKey[2] !== "" || q.queryKey[3] !== "" || q.queryKey[4] === true,
    });
  }
  void qc.invalidateQueries({ queryKey: ["chats"] }); // pending counts
  if (touched.size) void qc.invalidateQueries({ queryKey: ["pending"] });
  // A task's tag changed (e.g. marked done): its row on AI Agent shows that state
  const tasks = new Set((qc.getQueryData<Task[]>(["tasks"]) ?? []).map(msgKey));
  if (items.some((it) => tasks.has(msgKey(it)))) void qc.invalidateQueries({ queryKey: ["tasks"] });
  listeners.forEach((cb) => cb(items));
  notifyNew(items);
}

/**
 * One EventSource while unlocked and visible (or always, when tag notifications are on). SSE only wakes us up; data comes from
 * /api/changes and lastApplied only advances after a page was fetched. Failed drains and a closed stream retry with backoff.
 */
export function useSync(baseline: string) {
  const qc = useQueryClient();
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
      void qc.invalidateQueries({ queryKey: ["chats"] });
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
      src.addEventListener("status", (e) => {
        const { state } = JSON.parse((e as MessageEvent).data);
        qc.setQueryData<Status>(["status"], (s) => (s ? { ...s, state } : s));
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

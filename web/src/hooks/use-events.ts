"use client";

import { type InfiniteData, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChangeItem, type ChangesPage, type Message, type MessagesPage, type Status } from "@/lib/api";
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
}

export function applyChanges(qc: QueryClient, items: ChangeItem[]) {
  for (const it of items) {
    if (it.message_id === null) {
      void qc.invalidateQueries({ queryKey: ["chats"] });
      if (it.kind === "tracking") void qc.invalidateQueries({ queryKey: ["messages", it.chat_id] });
      else void qc.resetQueries({ queryKey: ["messages", it.chat_id] });
      continue;
    }
    if (it.message) {
      const m = it.message;
      qc.setQueriesData<InfiniteData<MessagesPage>>(
        { queryKey: ["messages", it.chat_id, ""] },
        (d) => upsert(d, m),
      );
    }
    // Searches and the "not handled" view can gain or lose rows: refetch those.
    void qc.invalidateQueries({
      queryKey: ["messages", it.chat_id],
      predicate: (q) => q.queryKey[2] !== "" || q.queryKey[4] === true,
    });
    void qc.invalidateQueries({ queryKey: ["chats"] }); // pending counts
    void qc.invalidateQueries({ queryKey: ["pending"] });
  }
  if (items.length) listeners.forEach((cb) => cb(items));
  notifyNew(items);
}

/**
 * One EventSource while unlocked and visible (or always, when tag notifications are on). SSE only wakes us up; data comes from
 * /api/changes and lastApplied only advances after a page was applied.
 */
export function useSync(baseline: string) {
  const qc = useQueryClient();
  const lastApplied = useRef(baseline);
  const running = useRef(false);
  const again = useRef(false);
  const [stream, setStream] = useState<StreamState>("connecting");

  const reset = useCallback(
    (cursor: string) => {
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
    try {
      do {
        again.current = false;
        for (;;) {
          const page = await api<ChangesPage>(
            `/changes?cursor=${encodeURIComponent(lastApplied.current)}&limit=200`,
          );
          if (page.reset) {
            reset(page.next_cursor);
            break;
          }
          applyChanges(qc, page.items);
          lastApplied.current = page.next_cursor;
          if (!page.has_more) break;
        }
      } while (again.current);
    } catch {
      // Keep lastApplied; the next notification/refocus drains again from it.
    } finally {
      running.current = false;
    }
  }, [qc, reset]);

  useEffect(() => {
    let es: EventSource | null = null;
    const open = () => {
      if (es || (document.visibilityState !== "visible" && !readNotify())) return;
      setStream("connecting");
      es = new EventSource(`/api/events?cursor=${encodeURIComponent(lastApplied.current)}`);
      es.onopen = () => {
        setStream("open");
        void drain();
      };
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) {
          setStream("closed");
          es = null;
          void qc.invalidateQueries({ queryKey: ["status"] }); // maybe locked
        } else setStream("connecting");
      };
      es.addEventListener("change", () => void drain());
      es.addEventListener("reset", (e) => reset(JSON.parse((e as MessageEvent).data).cursor));
      es.addEventListener("status", (e) => {
        const { state } = JSON.parse((e as MessageEvent).data);
        qc.setQueryData<Status>(["status"], (s) => (s ? { ...s, state } : s));
        void qc.invalidateQueries({ queryKey: ["chats"] }); // per-chat sync state changed
      });
    };
    const close = () => {
      es?.close();
      es = null;
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
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, [drain, reset, qc]);

  return stream;
}

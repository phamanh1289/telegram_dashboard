"use client";

import { Bell, BellRing } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { t, useT } from "@/shared/lib/i18n";
import { getPref, setPref } from "@/shared/lib/prefs";
import { deskNotify, type Ticket } from "@/features/youtrack/lib/yt";
import { ago } from "@/shared/lib/time";
import { Popover } from "./bits";
import { selfEdits, useYt } from "./state";

// What changed on my tickets (assignee or QC) between two refreshes: state moved, updated by someone (a comment, an edit);
// tickets newly given to me come from checkNew in the shell (`note`). Kept for the session; a desktop notification when
// the tab is in the background and it is on.

type Event = { id: string; text: string; at: number };
let events: Event[] = [];
let unread = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

type Snap = { state: string | null; assignee: string | null; updated: number };

export const note = (id: string, text: string) => {
  events = [{ id, text, at: Date.now() }, ...events].slice(0, 40);
  unread += 1;
  emit();
};

/** Runs in the shell: diffs each refreshed list for the same scope. */
export function useWatch() {
  const y = useYt();
  const prev = useRef<{ key: string; m: Map<string, Snap> } | null>(null);
  const data = y.issues.data;
  const key = `${y.project}:${y.filters.assignee.join()}`;
  useEffect(() => {
    if (!data || !y.me || y.issues.isPlaceholderData) return;
    const mine = (i: Ticket) => !i.resolved && (i.assignee === y.me || i.qc === y.me);
    const m = new Map(data.filter(mine).map((i) => [i.id, { state: i.state, assignee: i.assignee, updated: i.updated }]));
    const p = prev.current;
    prev.current = { key, m };
    if (!p || p.key !== key) return; // first load or another scope: nothing to compare with
    const now = Date.now(), out: Event[] = [];
    for (const i of data.filter(mine)) {
      const o = p.m.get(i.id);
      if ((selfEdits.get(i.id) ?? 0) > now - 3 * 60_000) continue;
      if (!o) continue; // newly mine: checkNew in the shell (persists across reloads and scopes)
      if (o.state !== i.state) out.push({ id: i.id, text: `${o.state ?? "—"} → ${i.state ?? "—"}`, at: now });
      else if (o.updated !== i.updated) out.push({ id: i.id, text: t("Có cập nhật mới (bình luận hoặc sửa)"), at: now });
    }
    if (!out.length) return;
    events = [...out, ...events].slice(0, 40);
    unread += out.length;
    emit();
    deskNotify(out.length === 1 ? `${out[0].id}: ${out[0].text}` : t("{n} ticket của bạn vừa thay đổi", { n: out.length }),
      out.slice(0, 4).map((e) => `${e.id}: ${e.text}`).join("\n"), () => y.openTicket(out[0].id));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- one diff per refreshed list
}

export function WatchBell() {
  const t = useT();
  const y = useYt();
  const list = useSyncExternalStore(sub, () => events, () => events);
  const n = useSyncExternalStore(sub, () => unread, () => 0);
  const [desk, setDesk] = useState(() => getPref("ytNotify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted");
  async function toggle(on: boolean) {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      if ((await Notification.requestPermission()) !== "granted") return;
    }
    setPref("ytNotify", on ? "1" : "0");
    setDesk(on);
  }
  return (
    <span onPointerDown={() => { if (unread) { unread = 0; emit(); } }}>
      <Popover align="right" chevron={false} title={t("Thay đổi trên ticket của bạn")} className="px-2"
        label={<span className="relative inline-flex">{n ? <BellRing className="size-4 text-signal-2" /> : <Bell className="size-4" />}
          {n > 0 && <b className="absolute -top-1.5 -right-2 rounded-full bg-signal px-1 font-mono text-xs leading-4 text-white">{n}</b>}</span>}>
        {(close) => (
          <div className="grid">
            <div className="flex items-center gap-2 border-b border-rule px-3 py-2 text-xs">
              <span className="font-medium">{t("Ticket của bạn")}</span>
              <label className="ml-auto flex items-center gap-1.5 text-ink-3"><input type="checkbox" checked={desk} onChange={(e) => void toggle(e.target.checked)} />{t("Thông báo trên máy")}</label>
            </div>
            {list.length ? (
              <ul className="zebra grid max-h-80 overflow-y-auto p-1">
                {list.map((e, k) => (
                  <li key={k} className="rounded"><button type="button" onClick={() => { close(); y.openTicket(e.id); }} className="grid w-full gap-0.5 rounded px-2 py-1.5 text-left hover:bg-paper-2">
                    <span className="flex gap-2 text-xs"><b className="font-mono">{e.id}</b><span className="ml-auto text-ink-3">{ago(e.at)}</span></span>
                    <span className="truncate text-sm">{e.text}</span>
                  </button></li>
                ))}
              </ul>
            ) : <p className="px-3 py-4 text-sm text-ink-3">{t("Chưa có thay đổi nào từ lúc mở trang. Dữ liệu tự làm mới mỗi phút.")}</p>}
          </div>
        )}
      </Popover>
    </span>
  );
}

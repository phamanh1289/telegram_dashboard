"use client";

import { useSyncExternalStore } from "react";
import { put, readList } from "@/lib/prefs";

// "Báo lại": a ticket of mine just reached Fixed / Done, and someone on Telegram asked about it. The YouTrack watch
// (yt/watch.tsx) adds one item per message to answer; the to-do list shows them until the reply is sent or dismissed.
// Per browser, refs only: the message text is read from the server when shown, never copied into localStorage.

export type LoopItem = { ticket: string; state: string; chat_id: string; message_id: string };
export const loopKey = (l: Pick<LoopItem, "ticket" | "chat_id" | "message_id">) => `${l.ticket}:${l.chat_id}:${l.message_id}`;

const QUEUE = "loopBack";
const DONE = "loopDone"; // answered / dismissed keys: a later watch cycle never queues them again
const isItem = (x: unknown): x is LoopItem => {
  const l = x as LoopItem | null;
  return !!l && [l.ticket, l.state, l.chat_id, l.message_id].every((v) => typeof v === "string");
};
const isKey = (x: unknown): x is string => typeof x === "string";
const pick = ({ ticket, state, chat_id, message_id }: LoopItem): LoopItem => ({ ticket, state, chat_id, message_id }); // older entries carried text

const EMPTY: LoopItem[] = [];
let cache: [string | null, LoopItem[]] = [null, EMPTY];
const snapshot = () => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(QUEUE); } catch {}
  if (cache[0] !== raw) cache = [raw, readList(QUEUE, EMPTY, isItem).map(pick)];
  return cache[1];
};
const onLoop = (f: () => void) => { addEventListener("loop", f); addEventListener("storage", f); return () => { removeEventListener("loop", f); removeEventListener("storage", f); }; };
export const useLoopItems = () => useSyncExternalStore(onLoop, snapshot, () => EMPTY);

// ponytail: the queue keeps the newest 30 and the done list 300 keys; older ones drop off (a dropped done key could
// be queued again only if its ticket reaches Fixed / Done a second time).
function save(queue: LoopItem[], done?: string[]) {
  put(QUEUE, queue.length ? JSON.stringify(queue.slice(0, 30)) : null);
  if (done) put(DONE, JSON.stringify(done.slice(0, 300)));
  dispatchEvent(new Event("loop"));
}

/** Queue new items; ones already answered or dismissed (or queued) are skipped. Returns how many were added. */
export function addLoopItems(items: LoopItem[]) {
  const done = new Set(readList(DONE, [], isKey));
  const have = new Set(snapshot().map(loopKey));
  const fresh = [...new Map(items.map((l) => [loopKey(l), pick(l)])).values()].filter((l) => !done.has(loopKey(l)) && !have.has(loopKey(l)));
  if (fresh.length) save([...fresh, ...snapshot()]);
  return fresh.length;
}

/** Dismissed (or answered): off the list for good. */
export function doneLoopItem(l: LoopItem) {
  save(snapshot().filter((x) => loopKey(x) !== loopKey(l)), [loopKey(l), ...readList(DONE, [], isKey)]);
}

/** A reply to this message was sent: every "Báo lại" item for it is answered. */
export function doneLoopMessage(m: { chat_id: string; message_id: string }) {
  const hit = snapshot().filter((l) => l.chat_id === m.chat_id && l.message_id === m.message_id);
  if (hit.length) save(snapshot().filter((l) => !hit.includes(l)), [...hit.map(loopKey), ...readList(DONE, [], isKey)]);
}

/** Forget the queue, or one group's items (its data was deleted); the done list stays. */
export const clearLoopItems = (chatId?: string) => save(chatId ? snapshot().filter((l) => l.chat_id !== chatId) : []);

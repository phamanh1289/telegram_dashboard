import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { ChatsResponse, Message } from "@/lib/api";
import { getMessage } from "@/lib/inbox";
import { timeLabel } from "@/lib/time";

/** A Telegram message attached to an AI Agent session's next prompt. */
export type Ref = { chat_id: string; message_id: string };
export const MAX_REFS = 5;
const MAX_TEXT = 1500; // per attached message: 5 of them + 8000 typed stay under the API's 16000
export const ATTACH_HEAD = "Tin nhắn đính kèm:";

// One pasted token: the dashboard's "chat/message" ID (the #123 chip), a t.me/c link (also inside a topic), or "#123".
const REF = /^(?:(-?\d{5,})\/(\d{1,10})|https?:\/\/t\.me\/c\/(\d+)\/(?:\d+\/)?(\d{1,10})(?:[?#]\S*)?|#(\d{1,10}))$/;

/** Refs in a paste that holds nothing else (space / comma separated); null for an ordinary paste.
 *  "#123" means message 123 in `chatId`, the session's group. */
export function parseRefs(text: string, chatId: string | null): Ref[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return null;
  const out: Ref[] = [];
  for (const p of parts) {
    const x = REF.exec(p);
    if (!x) return null;
    if (x[1]) out.push({ chat_id: x[1], message_id: x[2] });
    else if (x[3]) out.push({ chat_id: `-100${x[3]}`, message_id: x[4] });
    else if (chatId) out.push({ chat_id: chatId, message_id: x[5] });
    else return null;
  }
  return out;
}

export const sameRef = (a: Ref, b: Ref) => a.chat_id === b.chat_id && a.message_id === b.message_id;

// Draft attachments per session, outside React so a message row can add to a session that is not open.
// ponytail: client-only, lost on reload like the prompt queue.
const drafts = new Map<string, Ref[]>();
const subs = new Set<() => void>();
const NONE: Ref[] = [];

export function setRefs(taskId: string, refs: Ref[]) {
  if (refs.length) drafts.set(taskId, refs);
  else drafts.delete(taskId);
  subs.forEach((f) => f());
}

/** Add to a session's draft, deduped and capped at MAX_REFS; returns the draft after. */
export function attach(taskId: string, add: Ref[]) {
  const next = [...(drafts.get(taskId) ?? NONE)];
  for (const r of add) if (next.length < MAX_REFS && !next.some((x) => sameRef(x, r))) next.push(r);
  setRefs(taskId, next);
  return next;
}

export const useRefs = (taskId: string) =>
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => drafts.get(taskId) ?? NONE, () => NONE);

export const messageQuery = (r: Ref) => queryOptions({
  queryKey: ["message", r.chat_id, r.message_id],
  queryFn: ({ signal }) => getMessage(r.chat_id, r.message_id, { signal }), // its text goes to the AI: consent is checked
  staleTime: 60_000,
  retry: false, // 404 / not connected: say so on the chip at once
});

/** A group's title from any loaded group list. */
export function chatTitle(qc: QueryClient, chatId: string) {
  for (const [, d] of qc.getQueriesData<ChatsResponse>({ queryKey: ["chats"] })) {
    const c = d?.items.find((c) => c.chat_id === chatId);
    if (c) return c.title;
  }
}

/** The prompt sent: what was typed, then each attached message quoted, "[#id]" matching the marks in the text. */
export function withAttachments(text: string, msgs: Message[], home: string | null, title: (chatId: string) => string | undefined) {
  if (!msgs.length) return text;
  const block = msgs.map((m) => {
    const where = m.chat_id === home ? "" : ` (nhóm ${title(m.chat_id) ?? m.chat_id})`;
    const media = m.media_kind ? ` [kèm ${m.media_kind}]` : "";
    const body = m.text.length > MAX_TEXT ? `${m.text.slice(0, MAX_TEXT)}…` : m.text || "(không có chữ)";
    return `[#${m.message_id}] ${m.outgoing ? "Bạn" : (m.sender_name ?? "?")}, ${timeLabel(m.date, true)}${where}${media}:\n${body.replace(/^/gm, "> ")}`;
  });
  return [text, `${ATTACH_HEAD}\n${block.join("\n\n")}`].filter(Boolean).join("\n\n");
}

/** A sent prompt split back into what was typed and its attached block ("" if none). */
export function splitAttachments(text: string): [string, string] {
  const i = text.startsWith(`${ATTACH_HEAD}\n`) ? 0 : text.indexOf(`\n\n${ATTACH_HEAD}\n`);
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(text.indexOf("\n", i + 2) + 1)];
}

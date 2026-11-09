"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type KeyboardEvent, type RefObject, type SyntheticEvent } from "react";
import { Avatar } from "@/components/chat-list";
import { api, errorText, type Member } from "@/lib/api";
import { fold } from "@/lib/inbox";
import { cn } from "@/lib/utils";

// "@" in the reply box: pick someone in the group. A @username goes as typed text (Telegram links it itself); someone
// without one shows as "@Name" in the box and is sent as [Name](tg://user?id=N), which the server turns into a mention
// entity (telegram.split_mentions). ponytail: the "@Name" → id map lives in this component only: a reopened draft
// sends the name as plain text; persist it with the draft if that bites.

const QUERY = /(?:^|\s)@([^\s@]{0,32})$/; // the "@word" right before the caret
const SHOWN = 8;
const ERRORS = { members_hidden: "Nhóm ẩn danh sách thành viên, gõ @username để tag." };

/** Members matching what follows "@", best first. */
function rank(members: Member[], q: string): Member[] {
  const k = fold(q);
  // 0: username / name starts with it, 1: a word of the name does ("an" → "Lan Anh"), 2: contains it; then has a username
  const score = (m: Member) => {
    const name = fold(m.name), user = fold(m.username);
    const hit = user.startsWith(k) || name.startsWith(k) ? 0 : name.split(/\s+/).some((w) => w.startsWith(k)) ? 1
      : `${name} ${user}`.includes(k) ? 2 : -1;
    return hit < 0 ? -1 : hit * 2 + (m.username ? 0 : 1);
  };
  return members.map((m) => [score(m), m] as const).filter(([s]) => s >= 0)
    .sort((a, b) => a[0] - b[0]).slice(0, SHOWN).map(([, m]) => m); // stable: ties keep Telegram's order
}

const label = (m: Member) => `@${m.name.replace(/[[\]\n]/g, "").slice(0, 64)}`;

export function useMention(chatId: string, text: string, setText: (s: string) => void, box: RefObject<HTMLTextAreaElement | null>) {
  const [caret, setCaret] = useState<number | null>(null);
  const [closed, setClosed] = useState(-1); // where the "@" Esc dismissed starts: stays shut until another "@"
  const [at, setAt] = useState(0);
  const [named, setNamed] = useState<Record<string, string>>({}); // "@Name" → user id
  const q = caret == null ? undefined : text.slice(0, caret).match(QUERY)?.[1];
  const start = q == null || caret == null ? -1 : caret - q.length - 1;
  const open = start >= 0 && start !== closed;
  const members = useQuery({
    queryKey: ["members", chatId],
    queryFn: () => api<Member[]>(`/chats/${encodeURIComponent(chatId)}/members`),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const shown = open ? rank(members.data ?? [], q ?? "") : [];
  const cur = Math.min(at, Math.max(shown.length - 1, 0));

  const track = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart === e.currentTarget.selectionEnd ? e.currentTarget.selectionStart : null);
    setAt(0);
  };

  function pick(m: Member) {
    if (caret == null) return;
    const tag = m.username ? `@${m.username}` : label(m);
    if (!m.username) setNamed((n) => ({ ...n, [tag]: m.user_id }));
    setText(`${text.slice(0, start)}${tag} ${text.slice(caret)}`);
    const pos = start + tag.length + 1;
    setCaret(null);
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(pos, pos); });
  }

  /** True when the popup took the key (the box must not act on it). */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return false;
    if (e.key === "Escape") setClosed(start);
    else if (shown.length && (e.key === "ArrowDown" || e.key === "ArrowUp"))
      setAt((cur + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
    else if (shown.length && (e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey) pick(shown[cur]);
    else return false;
    e.preventDefault();
    return true;
  }

  /** The text as sent: each "@Name" picked here becomes [Name](tg://user?id=N), longest first ("@Minh BE" before "@Minh"). */
  const wire = (s: string) =>
    Object.entries(named).sort(([a], [b]) => b.length - a.length)
      .reduce((t, [tag, id]) => t.split(tag).join(`[${tag.slice(1)}](tg://user?id=${id})`), s);

  const status = members.isPending ? "Đang tải thành viên…" : members.isError ? errorText(members.error, ERRORS)
    : shown.length ? "" : "Không thấy ai khớp.";
  const popup = open && (
    <div role="listbox" aria-label="Tag thành viên" className="absolute bottom-full left-0 z-20 mb-1 w-72 max-w-full overflow-hidden rounded-[var(--radius-card)] border border-rule-2 bg-cotton py-1 shadow-lg">
      {status && <p className={cn("px-3 py-1.5 text-xs", members.isError ? "text-error" : "text-ink-3")}>{status}</p>}
      {shown.map((m, i) => (
        <div key={m.user_id} role="option" aria-selected={i === cur}
          onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setAt(i)}
          className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm", i === cur && "bg-paper-2")}>
          <Avatar name={m.name} />
          <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
          <span className="shrink-0 text-xs text-ink-3">{m.username ? `@${m.username}` : "tag theo tên"}</span>
        </div>
      ))}
    </div>
  );

  return { track, onKeyDown, wire, popup, open };
}

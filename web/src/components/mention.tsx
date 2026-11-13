"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { Avatar } from "@/components/chat-list";
import { api, errorText, type Member } from "@/lib/api";
import { tMaybe, useT } from "@/lib/i18n";
import { fold, nameTag } from "@/lib/inbox";
import { type Person, yt } from "@/lib/yt";
import { cn } from "@/lib/utils";

// "@" in a box that posts somewhere people get tagged: pick a member. A @username / @login goes as typed text (Telegram
// and YouTrack link it themselves); a Telegram member without a username shows as "@Name" in the box and is sent as
// [Name](tg://user?id=N), which the server turns into a mention entity (telegram.split_format). ponytail: the
// "@Name" → id map lives in this component only: a reopened draft sends the name as plain text; persist it if that bites.

const QUERY = /(?:^|\s)@([^\s@]{0,32}(?: [^\s@]{0,32}){0,3})$/; // "@Lan Q" right before the caret: a full name has spaces
const SHOWN = 8;

/** Where the "@" list comes from; `select` maps the cached data, so a shared query key keeps its own shape. */
export type MentionSource<T> = { queryKey: readonly unknown[]; queryFn: () => Promise<T>; select: (d: T) => Member[]; errors?: Record<string, string> };
const same = (m: Member[]) => m;
/** The Telegram group's members (inbox reply, Q&A). */
export const groupMembers = (chatId: string): MentionSource<Member[]> => ({
  queryKey: ["members", chatId], queryFn: () => api<Member[]>(`/chats/${encodeURIComponent(chatId)}/members`), select: same,
  errors: { members_hidden: "Nhóm ẩn danh sách thành viên, gõ @username để tag." },
});
const asMembers = (l: Person[]) => l.map((p) => ({ user_id: p.login, name: p.name, username: p.login }));
/** The YouTrack project's team (comments, ticket description): same key as the Assignee picker's list. */
export const ytPeople = (project: string): MentionSource<Person[]> => ({
  queryKey: ["yt", "people", project], queryFn: () => yt.people(project), select: asMembers,
});

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

/** Wire onto a textarea: `ref={attach}`, `track` (onChange + onSelect), `onKeyDown` first; `popup` inside a `relative` parent.
 *  Send `wire(text)`. Used by the inbox reply box, Q&A (AiPromptBox `mention`), YouTrack comments and ticket description. */
export function useMention<T>(source: MentionSource<T>, text: string, setText: (s: string) => void, known?: Record<string, string>) { // known: "@Name" → id put in the box by code (Q&A nudge)
  const t = useT();
  const [box, setBox] = useState<HTMLTextAreaElement | null>(null); // callback ref: the textarea, for focus after a pick
  const [caret, setCaret] = useState<number | null>(null);
  const [closed, setClosed] = useState(-1); // where the "@" Esc dismissed starts: stays shut until another "@"
  const [at, setAt] = useState(0);
  const [named, setNamed] = useState<Record<string, string>>({}); // "@Name" → user id
  const q = caret == null ? undefined : text.slice(0, caret).match(QUERY)?.[1];
  const start = q == null || caret == null ? -1 : caret - q.length - 1;
  const asking = start >= 0 && start !== closed;
  const members = useQuery({ queryKey: source.queryKey, queryFn: source.queryFn, select: source.select, enabled: asking, staleTime: 5 * 60_000, retry: false });
  const shown = asking ? rank(members.data ?? [], q ?? "") : [];
  // Past a space only while someone still matches: "@minh_be xem giúp" goes back to plain typing.
  const open = asking && (!q?.includes(" ") || shown.length > 0);
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
    requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(pos, pos); });
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
    e.stopPropagation(); // a dialog / sheet must not close on the Esc meant for the list
    return true;
  }

  /** The text as sent: each "@Name" picked here becomes [Name](tg://user?id=N), longest first ("@Minh BE" before "@Minh"). */
  const wire = (s: string) =>
    Object.entries({ ...known, ...named }).sort(([a], [b]) => b.length - a.length)
      .reduce((s2, [tag, id]) => s2.split(tag).join(nameTag(tag.slice(1), id)), s);

  // `errors` texts are i18n keys (module constants): translated here, where they render.
  const status = members.isPending ? t("Đang tải thành viên…") : members.isError
    ? errorText(members.error, Object.fromEntries(Object.entries(source.errors ?? {}).map(([k, v]) => [k, tMaybe(v)])))
    : shown.length ? "" : t("Không thấy ai khớp.");
  const popup = open && (
    <div role="listbox" aria-label={t("Tag thành viên")} className="absolute bottom-full left-0 z-20 mb-1 w-72 max-w-full overflow-hidden rounded-[var(--radius-card)] border border-rule-2 bg-cotton py-1 shadow-lg">
      {status && <p className={cn("px-3 py-1.5 text-xs", members.isError ? "text-error" : "text-ink-3")}>{status}</p>}
      {shown.map((m, i) => (
        <div key={m.user_id} role="option" aria-selected={i === cur}
          onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setAt(i)}
          className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm", i === cur && "bg-paper-2")}>
          <Avatar name={m.name} />
          <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
          <span className="shrink-0 text-xs text-ink-3">{m.username ? `@${m.username}` : t("tag theo tên")}</span>
        </div>
      ))}
    </div>
  );

  return { attach: setBox, track, onKeyDown, wire, popup, open };
}
export type Mention = ReturnType<typeof useMention<unknown>>;

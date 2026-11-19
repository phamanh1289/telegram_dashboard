"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type ReactNode, type SyntheticEvent, useCallback, useState } from "react";
import { Avatar } from "@/shared/components/avatar";
import { errorText, type Member } from "@/shared/lib/api";
import { tMaybe, useT } from "@/shared/lib/i18n";
import { cn, fold } from "@/shared/lib/utils";

// "@" in a box that posts somewhere people get tagged: pick a member. A @username / @login goes as typed text (Telegram
// and YouTrack link it themselves); a Telegram member without a username shows as "@Name" in the box and is sent as
// [Name](tg://user?id=N), which the server turns into a mention entity (telegram.split_format). ponytail: the
// "@Name" → id map lives in this component only: a reopened draft sends the name as plain text; persist it if that bites.
// The caret engine (useCaretPick, PickPopup) is shared with "#" (features/docs doc-tag: the library's documents).

const QUERY = /(?:^|\s)@([^\s@]{0,32}(?: [^\s@]{0,32}){0,3})$/; // "@Lan Q" right before the caret: a full name has spaces
export const SHOWN = 8;

/** What a box wires in for a caret popup ("@", "#"): `ref={attach}`, `track` (onChange + onSelect), `onKeyDown` first,
 *  `popup` inside a `relative` parent; send `wire(text)`. */
export type Picker = {
  attach: (el: HTMLTextAreaElement | null) => void; track: (e: SyntheticEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean; wire: (s: string) => string; popup: ReactNode; open: boolean;
};

/** The word typed after a trigger right before the caret (`re` group 1), the row picked, and putting a pick in. */
export function useCaretPick(re: RegExp, text: string, setText: (s: string) => void) {
  const [box, setBox] = useState<HTMLTextAreaElement | null>(null); // callback ref: the textarea, for focus after a pick
  const [caret, setCaret] = useState<number | null>(null);
  const [closed, setClosed] = useState(-1); // where the trigger Esc dismissed starts: stays shut until another one
  const [at, setAt] = useState(0);
  const q = caret == null ? undefined : text.slice(0, caret).match(re)?.[1];
  const start = q == null || caret == null ? -1 : caret - q.length - 1;
  if (start < 0 && closed >= 0) setClosed(-1); // the dismissed trigger is gone: a new one at the same place opens again

  const track = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart === e.currentTarget.selectionEnd ? e.currentTarget.selectionStart : null);
    setAt(0);
  };
  /** Replaces the trigger and its word with `tag` and a space, caret after it. */
  function put(tag: string) {
    if (caret == null || start < 0) return;
    setText(`${text.slice(0, start)}${tag} ${text.slice(caret)}`);
    const pos = start + tag.length + 1;
    setCaret(null);
    requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(pos, pos); });
  }
  /** True when the popup took the key (the box must not act on it). `n` rows, `pick(i)`. */
  function keys(e: KeyboardEvent<HTMLTextAreaElement>, open: boolean, n: number, pick: (i: number) => void) {
    if (!open) return false;
    const cur = Math.min(at, Math.max(n - 1, 0));
    if (e.key === "Escape") setClosed(start);
    else if (n && (e.key === "ArrowDown" || e.key === "ArrowUp")) setAt((cur + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    else if (n && (e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) pick(cur);
    else return false;
    e.preventDefault();
    e.stopPropagation(); // a dialog / sheet must not close on the Esc meant for the list
    return true;
  }
  return { attach: setBox, track, put, keys, q: q ?? "", asking: start >= 0 && start !== closed, at, setAt };
}

/** The list over the box: springs in from its bottom-left corner (the caret's side), fades out; reduced motion fades. */
export function PickPopup({ open, label, status, error, rows, cur, onPick, onHover, className }: {
  open: boolean; label: string; status?: ReactNode; error?: boolean; rows: { key: string; body: ReactNode }[];
  cur: number; onPick: (i: number) => void; onHover: (i: number) => void; className?: string;
}) {
  const still = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div role="listbox" aria-label={label} style={{ originX: 0, originY: 1 }}
          initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0, transition: still ? { duration: 0.12 } : IN }}
          exit={{ opacity: 0, ...(still ? {} : { scale: 0.96, y: 2 }), transition: OUT }}
          className={cn("absolute bottom-full left-0 z-20 mb-1 w-72 max-w-full overflow-hidden rounded-[var(--radius-card)] border border-rule-2 bg-cotton py-1 shadow-lg", className)}>
          {status && <p role={error ? "alert" : undefined} className={cn("px-3 py-1.5 text-xs", error ? "text-error" : "text-ink-3")}>{status}</p>}
          {rows.map((r, i) => (
            <div key={r.key} role="option" aria-selected={i === cur}
              onMouseDown={(e) => { e.preventDefault(); onPick(i); }} onMouseEnter={() => onHover(i)}
              className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors duration-(--dur-micro)", i === cur && "bg-paper-2")}>
              {r.body}
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
const IN = { scale: { type: "spring" as const, stiffness: 520, damping: 34 }, y: { type: "spring" as const, stiffness: 520, damping: 34 }, opacity: { duration: 0.12 } };
const OUT = { duration: 0.12, ease: [0.4, 0, 1, 1] as const };

/** Two pickers on one box ("@" members + "#" documents): whichever is open takes the keys. */
export function useJoin(a: Picker, b: Picker): Picker {
  const { attach: aa } = a, { attach: ba } = b;
  const attach = useCallback((el: HTMLTextAreaElement | null) => { aa(el); ba(el); }, [aa, ba]);
  return {
    attach, track: (e) => { a.track(e); b.track(e); }, onKeyDown: (e) => a.onKeyDown(e) || b.onKeyDown(e),
    wire: (s) => b.wire(a.wire(s)), popup: <>{a.popup}{b.popup}</>, open: a.open || b.open,
  };
}

/** Where the "@" list comes from; `select` maps the cached data, so a shared query key keeps its own shape. */
export type MentionSource<T> = { queryKey: readonly unknown[]; queryFn: () => Promise<T>; select: (d: T) => Member[]; errors?: Record<string, string>; formatMention?: (name: string, id: string) => string };
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

/** "@" on a textarea (see Picker). Used by the inbox reply box, Q&A (AiPromptBox `mention`), YouTrack comments and
 *  ticket description. */
export function useMention<T>(source: MentionSource<T>, text: string, setText: (s: string) => void, known?: Record<string, string>): Picker { // known: "@Name" → id put in the box by code (Q&A nudge)
  const t = useT();
  const c = useCaretPick(QUERY, text, setText);
  const [named, setNamed] = useState<Record<string, string>>({}); // "@Name" → user id
  const members = useQuery({ queryKey: source.queryKey, queryFn: source.queryFn, select: source.select, enabled: c.asking, staleTime: 5 * 60_000, retry: false });
  const shown = c.asking ? rank(members.data ?? [], c.q) : [];
  // Past a space only while someone still matches: "@minh_be xem giúp" goes back to plain typing.
  const open = c.asking && (!c.q.includes(" ") || shown.length > 0);

  function pick(i: number) {
    const m = shown[i];
    const tag = m.username ? `@${m.username}` : label(m);
    if (!m.username) setNamed((n) => ({ ...n, [tag]: m.user_id }));
    c.put(tag);
  }

  /** The text as sent: each "@Name" picked here becomes [Name](tg://user?id=N), longest first ("@Minh BE" before "@Minh"). */
  const wire = (s: string) =>
    Object.entries({ ...known, ...named }).sort(([a], [b]) => b.length - a.length)
      .reduce((s2, [tag, id]) => s2.split(tag).join(source.formatMention?.(tag.slice(1), id) ?? tag), s);

  // `errors` texts are i18n keys (module constants): translated here, where they render.
  const status = members.isPending ? t("Đang tải thành viên…") : members.isError
    ? errorText(members.error, Object.fromEntries(Object.entries(source.errors ?? {}).map(([k, v]) => [k, tMaybe(v)])))
    : shown.length ? "" : t("Không thấy ai khớp.");
  const popup = (
    <PickPopup open={open} label={t("Tag thành viên")} status={status} error={members.isError} cur={Math.min(c.at, Math.max(shown.length - 1, 0))}
      onPick={pick} onHover={c.setAt} rows={shown.map((m) => ({ key: m.user_id, body: <>
        <Avatar name={m.name} />
        <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
        <span className="shrink-0 text-xs text-ink-3">{m.username ? `@${m.username}` : t("tag theo tên")}</span>
      </> }))} />
  );

  return { attach: c.attach, track: c.track, onKeyDown: (e) => c.keys(e, open, shown.length, pick), wire, popup, open };
}
export type Mention = Picker;

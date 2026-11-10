"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, Clock, Flame, type LucideIcon, Megaphone, Pin, Reply, RotateCw, X } from "lucide-react";
import { use, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AiFetching, useAiWait } from "@/components/ai/fetching";
import { useChats } from "@/components/chat-list";
import { MessageItem, SnoozeMenu } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Hint } from "@/components/ui/hint";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import type { Message, PendingItem } from "@/lib/api";
import { COMPOSER, fold, getMessage, inQaPage, msgKey, openReplyById, PartialError, pendingQuery, pinAll, QaCodes, setHandled, useListShortcuts, useNow, useTasks, waitLabel } from "@/lib/inbox";
import { doneLoopItem, type LoopItem, loopKey, useLoopItems } from "@/lib/report-back";
import { readOverdueHours } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { type Key, useT } from "@/lib/i18n";

type Section = { id: string; title: Key; note?: Key; icon: LucideIcon; tone: string; rows: PendingItem[] };

/** To-do: pinned, overdue, waiting. Pinned archive: still open, done. Each keeps the server order (oldest first). */
function sectionsOf(rows: PendingItem[], pinned: boolean, now: number): Section[] {
  const by = (f: (p: PendingItem) => boolean) => rows.filter(f);
  if (pinned) {
    return [
      { id: "open", title: "Chưa xử lý", icon: Clock, tone: "text-ink-2", rows: by((p) => !p.message.handled) },
      { id: "done", title: "Đã xử lý", icon: CheckCheck, tone: "text-ok", rows: by((p) => !!p.message.handled) },
    ];
  }
  const late = (p: PendingItem) => !p.message.pinned && waitLabel(p.message.date, now, !!p.message.priority).overdue; // priority: half the wait
  return [
    { id: "pinned", title: "Đã ghim", icon: Pin, tone: "text-ink-2", rows: by((p) => !!p.message.pinned) },
    { id: "late", title: "Quá hạn", note: "chờ hơn {n} giờ", icon: Flame, tone: "text-signal-2", rows: by(late) },
    { id: "wait", title: "Đang chờ", note: "chờ lâu nhất ở trên", icon: Clock, tone: "text-ink-2", rows: by((p) => !p.message.pinned && !late(p)) },
  ];
}

/** Every pending tag across groups as cards in sections, longest wait first; or (pinned) the pinned archive. */
export function PendingInbox({
  pinned = false,
  range,
  search,
  onClearSearch,
  replyTo,
  onReply,
  onBack,
  onUseText,
  itemsRef,
  jump,
  onPinned,
}: {
  pinned?: boolean;
  onPinned?: (pinned: boolean) => void; // the "Đang chờ / Đã ghim" tabs
  range: string;
  search: string;
  onClearSearch: () => void;
  replyTo: string | null; // msgKey of the message being answered
  onReply: (m: Message) => void;
  onBack: () => void;
  onUseText: (m: Message, text: string) => void;
  itemsRef?: React.RefObject<Message[]>; // what is on screen, for "open the next tag"
  jump?: number; // bumps on every sidebar click, to scroll back to the top
}) {
  const t = useT();
  const q = useQuery({
    ...pendingQuery(range, pinned),
    refetchInterval: 60_000, // snoozed tags come back on their own
  });
  const wait = useAiWait(q.isPending);
  const now = useNow();
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { box.current?.scrollTo({ top: 0 }); }, [jump]);
  const tasks = useTasks();
  // Search tag text only, ignoring case and Vietnamese accents. Deferred: typing stays responsive over 300 rows.
  const needle = fold(useDeferredValue(search).trim());
  // To-do leaves the tags Q&A shows to it (pinned ones stay: you kept them on purpose).
  const codes = use(QaCodes);
  const found = useMemo(() => {
    const all = (q.data ?? []).filter((p) => pinned || !inQaPage(codes, p.message));
    return needle ? all.filter((p) => fold(p.message.text).includes(needle)) : all;
  }, [q.data, needle, pinned, codes]);
  // Group filter: most tags first; a group that empties out falls back to all.
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; n: number }>();
    for (const p of found) {
      const g = m.get(p.message.chat_id) ?? { title: p.chat_title, n: 0 };
      m.set(p.message.chat_id, { ...g, n: g.n + 1 });
    }
    return [...m].sort((a, b) => b[1].n - a[1].n);
  }, [found]);
  const [picked, setGroup] = useState("");
  const group = groups.some(([id]) => id === picked) ? picked : "";
  const sections = useMemo(
    () => sectionsOf(group ? found.filter((p) => p.message.chat_id === group) : found, pinned, now),
    [found, group, pinned, now],
  );
  const items = useMemo(() => sections.flatMap((s) => s.rows.map((p) => p.message)), [sections]);
  // Multi-select (to-do only): Space / Shift+click; a bar acts on all of them; Esc clears.
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const pick = useCallback((m: Message) => setSel((cur) => {
    const next = new Set(cur);
    if (!next.delete(msgKey(m))) next.add(msgKey(m));
    return next;
  }), []);
  const chosen = useMemo(() => items.filter((m) => sel.has(msgKey(m))), [items, sel]);
  useEffect(() => {
    if (!chosen.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest?.("[role=dialog], [role=menu]")) return; // an open dialog / menu has focus: its own Esc
      if (document.querySelector(COMPOSER)) return; // the reply covers the list: Esc closes it, the selection stays
      e.preventDefault();
      e.stopPropagation(); // before the inbox's Esc: this one only clears the selection
      setSel(new Set());
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [chosen.length]);
  const focused = useListShortcuts(items, onReply, true, { onPick: pinned ? undefined : pick });
  useEffect(() => { if (itemsRef) itemsRef.current = items; }, [items, itemsRef]);
  const late = sections.find((s) => s.id === "late")?.rows.length ?? 0;

  return (
    <section aria-label={pinned ? t("Tag đã ghim") : t("Việc cần xử lý")} className="relative flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label={t("Quay lại")}><ArrowLeft /></Button>
        {onPinned && <Segmented id="pending-tab" label={t("Đang chờ hoặc đã ghim")} value={pinned ? "pinned" : "todo"} onChange={(v) => onPinned(v === "pinned")}
          items={[{ value: "todo", label: t("Đang chờ"), title: t("Tin tag bạn chưa xử lý") }, { value: "pinned", label: t("Đã ghim"), title: t("Tin bạn ghim để giữ lại, kể cả khi đã xử lý (g p)") }]} />}
        <p className="min-w-0 truncate text-sm text-ink-2" aria-live="polite">
          {!q.data ? t("Đang tải…") : items.length === 0 ? (pinned ? t("Chưa có tin ghim") : t("Không còn việc nào")) : (
            <>
              {t.n(pinned ? "{n} tin đã ghim" : "{n} tin đang chờ bạn", { n: <span className="font-mono text-base font-bold text-ink tabular-nums">{items.length}</span> })}
              {late > 0 && <span className="ml-2 font-medium text-signal-2">{t.n("({n} quá hạn)", { n: <span className="font-mono tabular-nums">{late}</span> })}</span>}
            </>
          )}
        </p>
        {/* Many groups: a list, not a segmented bar (DESIGN: segmented is for 2-4 options). */}
        {groups.length > 1 && (
          <Dropdown label={t("Lọc theo nhóm")} value={group} onChange={setGroup} className={cn("h-7 w-auto max-w-48", group && "border-hl text-hl-2")}
            options={[{ value: "", label: t("Mọi nhóm ({n})", { n: found.length }) }, ...groups.map(([id, g]) => ({ value: id, label: `${g.title} (${g.n})` }))]} />
        )}
        <p className="ml-auto hidden shrink-0 items-center gap-3 text-xs text-ink-3 lg:flex">
          <span className="flex items-center gap-1"><Kbd>j</Kbd><Kbd>k</Kbd> {t("chọn tin")}</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> {t("trả lời")}</span>
          <span className="flex items-center gap-1"><Kbd>x</Kbd> {t("xong")}</span>
          {!pinned && <span className="flex items-center gap-1"><Kbd>Space</Kbd> {t("chọn nhiều")}</span>}
          <span className="flex items-center gap-1"><Kbd>?</Kbd> {t("mọi phím tắt")}</span>
        </p>
      </div>

      <div ref={box} className="relative min-h-0 flex-1 overflow-y-auto bg-cotton">
        {wait && <AiFetching kind="inbox" cover />}
        {q.isError && (
          <div role="alert" className="grid justify-items-start gap-2 px-5 py-6 text-sm">
            <p className="text-error">{t("Không tải được danh sách.")}</p>
            <Button size="sm" variant="outline" aria-busy={q.isFetching} disabled={q.isFetching} onClick={() => void q.refetch()}>
              <RotateCw /> {t("Thử lại")}
            </Button>
          </div>
        )}
        <div className="@container grid gap-1 pb-4">
          {!pinned && !search.trim() && <LoopBack range={range} />}
          {q.isSuccess && items.length === 0 && (
            <div className="grid justify-items-center gap-2 px-6 py-20 text-center text-sm text-ink-2 animate-in fade-in-0 zoom-in-95 duration-(--dur-short)">
              {search.trim() ? (
                <>
                  <p>{t("Không có tin nào khớp “{q}”.", { q: search.trim() })}</p>
                  <Button size="sm" variant="outline" onClick={onClearSearch}>{t("Xóa tìm kiếm")}</Button>
                </>
              ) : pinned ? (
                <>
                  <span className="mb-1 grid size-14 place-items-center rounded-full bg-paper-3 text-ink-3"><Pin className="size-6" aria-hidden /></span>
                  <p className="text-base font-bold text-ink">{t("Chưa ghim tin nào")}</p>
                  <p className="max-w-xs">{t("Bấm “Ghim” trên một tin để giữ nó ở đây, kể cả khi đã xử lý.")}</p>
                </>
              ) : (
                <>
                  <span className="mb-1 grid size-14 place-items-center rounded-full bg-ok-wash text-ok"><CheckCheck className="size-7" aria-hidden /></span>
                  <p className="text-base font-bold text-ink">{t("Xong hết rồi!")}</p>
                  <p className="max-w-xs">{t("Không còn tin tag nào chờ bạn. Tin mới và tin hết hạn hoãn sẽ tự hiện ở đây.")}</p>
                </>
              )}
            </div>
          )}
          {sections.map((s) => s.rows.length > 0 && (
            <section key={s.id} aria-labelledby={`pending-${s.id}`}>
              <SectionHead id={`pending-${s.id}`} icon={s.icon} tone={s.tone} title={t(s.title)} n={s.rows.length} note={s.note && t(s.note, { n: readOverdueHours() })}
                className="sticky top-0 z-10 bg-cotton px-4 @xl:px-5" />
              <ol className="grid divide-y divide-rule border-y border-rule">
                {s.rows.map(({ chat_title, message: m }) => (
                  <MessageItem
                    key={msgKey(m)}
                    m={m}
                    head
                    now={now}
                    groupTitle={chat_title}
                    focused={focused === msgKey(m)}
                    isReplyTarget={replyTo === msgKey(m)}
                    tasks={tasks.get(msgKey(m))}
                    onReply={onReply}
                    onUseText={onUseText}
                    picked={sel.has(msgKey(m))}
                    onPick={pinned ? undefined : pick}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
      {chosen.length > 0 && <BulkBar ms={chosen} onSelect={(ms) => setSel(new Set(ms.map(msgKey)))} />}
    </section>
  );
}

/** What to do with the selected tags; each action clears the selection, or keeps the ones that failed selected (the toast
 *  already said how many, and offers Undo where it can). */
function BulkBar({ ms, onSelect }: { ms: Message[]; onSelect: (ms: Message[]) => void }) {
  const t = useT();
  const run = (f: () => Promise<unknown>) => () => {
    onSelect([]);
    f().catch((e) => { if (e instanceof PartialError) onSelect(e.failed); }); // other failures toast on their own
  };
  return (
    <div role="toolbar" aria-label={t("Tin đã chọn")}
      className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-0.5 rounded-[var(--radius-card)] bg-cotton py-1 pr-1 pl-3 text-sm shadow-pop animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)">
      <span className="mr-1.5 font-medium">{t.n("{n} đã chọn", { n: <span className="font-mono tabular-nums">{ms.length}</span> })}</span>
      <Button size="xs" variant="ghost" className="text-ok hover:bg-ok-wash" onClick={run(() => setHandled(ms, true))}><CheckCheck /> {t("Xong")}</Button>
      <Button size="xs" variant="ghost" onClick={run(() => setHandled(ms, true, false))}>{t("Xong không reaction")}</Button>
      <SnoozeMenu ms={ms} label onDone={onSelect} />
      <Button size="xs" variant="ghost" onClick={run(() => pinAll(ms))}><Pin /> {t("Ghim")}</Button>
      <Hint text={t("Bỏ chọn (Esc)")}>
        <Button size="icon-xs" variant="ghost" aria-label={t("Bỏ chọn")} onClick={() => onSelect([])}><X /></Button>
      </Hint>
    </div>
  );
}

/** A section's title row: icon, title, count, a note. */
function SectionHead({ id, icon: Icon, tone, title, n, note, className }: { id: string; icon: LucideIcon; tone: string; title: string; n: number; note?: string; className?: string }) {
  return (
    <h3 id={id} className={cn("mb-1 flex items-baseline gap-2 py-2 text-sm", className)}>
      <Icon className={cn("size-4 shrink-0 self-center", tone)} aria-hidden />
      <span className={cn("font-bold", tone === "text-ink-2" ? "text-ink" : tone)}>{title}</span>
      <span className="rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums">{n}</span>
      {note && <span className="truncate text-xs text-ink-3">{note}</span>}
    </h3>
  );
}

/** "Báo lại": a ticket I own reached Fixed / Done (seen by the YouTrack watch); answer whoever asked about it.
 *  "Trả lời" opens the reply with a line; the item goes once that reply is sent (or on X). */
function LoopBack({ range }: { range: string }) {
  const t = useT();
  const items = useLoopItems();
  const chats = useChats(range).data?.items;
  if (!items.length) return null;
  return (
    <section aria-labelledby="pending-loop">
      <SectionHead id="pending-loop" icon={Megaphone} tone="text-hl-2" title={t("Báo lại")} n={items.length} note={t("ticket của bạn đã xong, người hỏi chưa biết")} className="px-4 @xl:px-5" />
      <ul className="grid divide-y divide-rule border-y border-rule">
        {items.map((l) => <LoopRow key={loopKey(l)} l={l} chat={chats?.find((c) => c.chat_id === l.chat_id)?.title} />)}
      </ul>
    </section>
  );
}

function LoopRow({ l, chat }: { l: LoopItem; chat?: string }) {
  const t = useT();
  // The text is read when shown (never stored in the browser); the user reads it here, so no AI consent check.
  const m = useQuery({
    queryKey: ["message", l.chat_id, l.message_id, "read"],
    queryFn: ({ signal }) => getMessage(l.chat_id, l.message_id, { signal }),
    staleTime: 5 * 60_000,
  }).data;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm @xl:px-5">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 gap-2 text-xs text-ink-3">
          <b className="font-mono font-bold text-ink">{l.ticket}</b><span className="shrink-0">{l.state}</span>{chat && <span className="truncate">{chat}</span>}
        </span>
        <span className="truncate text-ink-2">
          {m ? <>{!m.outgoing && m.sender_name && <b className="font-medium text-ink">{m.sender_name}: </b>}{m.text}</> : <span className="text-ink-3">{t("Đang tải tin…")}</span>}
        </span>
      </span>
      <Button size="xs" variant="outline" onClick={() => void openReplyById(l.chat_id, l.message_id, `${l.ticket} đã chuyển ${l.state}, bạn kiểm tra lại giúp mình nhé.`)}>
        <Reply /> {t("Trả lời")}
      </Button>
      <Hint side="bottom" text={t("Bỏ qua, không báo lại tin này")}>
        <Button size="icon-xs" variant="ghost" aria-label={t("Bỏ qua")} onClick={() => doneLoopItem(l)}><X /></Button>
      </Hint>
    </li>
  );
}

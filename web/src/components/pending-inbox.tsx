"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCheck, ChevronDown, Clock, Flame, type LucideIcon, Megaphone, MessageCircleQuestion, Pin, Reply, RotateCw, Sun, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AiFetching, useAiWait } from "@/components/ai/fetching";
import { useChats } from "@/components/chat-list";
import { MessageItem, SnoozeMenu } from "@/components/message-item";
import { useQaNews } from "@/components/qa-page";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Hint } from "@/components/ui/hint";
import { Kbd } from "@/components/ui/kbd";
import type { Message, PendingItem } from "@/lib/api";
import { COMPOSER, fold, getMessage, msgKey, openQa, openReplyById, openTask, PartialError, pendingQuery, pinAll, scrollToRow, setHandled, smooth, useListShortcuts, useNow, useTaskList, useTasks, waitLabel } from "@/lib/inbox";
import { doneLoopItem, type LoopItem, loopKey, useLoopItems } from "@/lib/report-back";
import { getPref, onPrefs, readOverdueHours, setPref, useRole } from "@/lib/prefs";
import { riskOf, useMyTickets } from "@/lib/yt";
import { cn } from "@/lib/utils";

type Section = { id: string; title: string; note?: string; icon: LucideIcon; tone: string; rows: PendingItem[] };

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
    { id: "late", title: "Quá hạn", note: `chờ hơn ${readOverdueHours()} giờ`, icon: Flame, tone: "text-signal-2", rows: by(late) },
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
}: {
  pinned?: boolean;
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
  const found = useMemo(() => {
    const all = q.data ?? [];
    return needle ? all.filter((p) => fold(p.message.text).includes(needle)) : all;
  }, [q.data, needle]);
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
    <section aria-label={pinned ? "Tag đã ghim" : "Việc cần xử lý"} className="relative flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại"><ArrowLeft /></Button>
        <p className="min-w-0 truncate text-sm text-ink-2" aria-live="polite">
          {!q.data ? "Đang tải…" : items.length === 0 ? (pinned ? "Chưa có tin ghim" : "Không còn việc nào") : (
            <>
              <span className="font-mono text-base font-semibold text-ink tabular-nums">{items.length}</span>
              {pinned ? " tin đã ghim" : " tin đang chờ bạn"}
              {late > 0 && <span className="ml-2 font-medium text-signal-2">(<span className="font-mono tabular-nums">{late}</span> quá hạn)</span>}
            </>
          )}
        </p>
        {/* Many groups: a list, not a segmented bar (DESIGN: segmented is for 2-4 options). */}
        {groups.length > 1 && (
          <Dropdown label="Lọc theo nhóm" value={group} onChange={setGroup} className={cn("h-7 w-auto max-w-48", group && "border-hl text-hl-2")}
            options={[{ value: "", label: `Mọi nhóm (${found.length})` }, ...groups.map(([id, g]) => ({ value: id, label: `${g.title} (${g.n})` }))]} />
        )}
        <p className="ml-auto hidden shrink-0 items-center gap-3 text-xs text-ink-3 lg:flex">
          <span className="flex items-center gap-1"><Kbd>j</Kbd><Kbd>k</Kbd> chọn tin</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> trả lời</span>
          <span className="flex items-center gap-1"><Kbd>x</Kbd> xong</span>
          {!pinned && <span className="flex items-center gap-1"><Kbd>Space</Kbd> chọn nhiều</span>}
          <span className="flex items-center gap-1"><Kbd>?</Kbd> mọi phím tắt</span>
        </p>
      </div>

      <div ref={box} className="relative min-h-0 flex-1 overflow-y-auto bg-cotton">
        {wait && <AiFetching kind="inbox" cover />}
        {q.isError && (
          <div role="alert" className="grid justify-items-start gap-2 px-5 py-6 text-sm">
            <p className="text-error">Không tải được danh sách.</p>
            <Button size="sm" variant="outline" aria-busy={q.isFetching} disabled={q.isFetching} onClick={() => void q.refetch()}>
              <RotateCw /> Thử lại
            </Button>
          </div>
        )}
        {q.isSuccess && items.length === 0 && (
          <div className="grid justify-items-center gap-2 px-6 py-20 text-center text-sm text-ink-2 animate-in fade-in-0 zoom-in-95 duration-(--dur-short)">
            {search.trim() ? (
              <>
                <p>Không có tin nào khớp “{search.trim()}”.</p>
                <Button size="sm" variant="outline" onClick={onClearSearch}>Xóa tìm kiếm</Button>
              </>
            ) : pinned ? (
              <>
                <span className="mb-1 grid size-14 place-items-center rounded-full bg-paper-3 text-ink-3"><Pin className="size-6" aria-hidden /></span>
                <p className="text-base font-semibold text-ink">Chưa ghim tin nào</p>
                <p className="max-w-xs">Bấm “Ghim” trên một tin để giữ nó ở đây, kể cả khi đã xử lý.</p>
              </>
            ) : (
              <>
                <span className="mb-1 grid size-14 place-items-center rounded-full bg-ok-wash text-ok"><CheckCheck className="size-7" aria-hidden /></span>
                <p className="text-base font-semibold text-ink">Xong hết rồi!</p>
                <p className="max-w-xs">Không còn tin tag nào chờ bạn. Tin mới và tin hết hạn hoãn sẽ tự hiện ở đây.</p>
              </>
            )}
          </div>
        )}
        <div className="@container grid gap-1 pb-4">
          {!pinned && !search.trim() && <Today rows={q.data ?? []} late={late} now={now} />}
          {!pinned && !search.trim() && <LoopBack range={range} />}
          {sections.map((s) => s.rows.length > 0 && (
            <section key={s.id} aria-labelledby={`pending-${s.id}`}>
              <SectionHead id={`pending-${s.id}`} icon={s.icon} tone={s.tone} title={s.title} n={s.rows.length} note={s.note}
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
  const run = (f: () => Promise<unknown>) => () => {
    onSelect([]);
    f().catch((e) => { if (e instanceof PartialError) onSelect(e.failed); }); // other failures toast on their own
  };
  return (
    <div role="toolbar" aria-label="Tin đã chọn"
      className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-0.5 rounded-[var(--radius-card)] bg-cotton py-1 pr-1 pl-3 text-sm shadow-pop animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)">
      <span className="mr-1.5 font-medium"><span className="font-mono tabular-nums">{ms.length}</span> đã chọn</span>
      <Button size="xs" variant="ghost" className="text-ok hover:bg-ok-wash" onClick={run(() => setHandled(ms, true))}><CheckCheck /> Xong</Button>
      <Button size="xs" variant="ghost" onClick={run(() => setHandled(ms, true, false))}>Xong không reaction</Button>
      <SnoozeMenu ms={ms} label onDone={onSelect} />
      <Button size="xs" variant="ghost" onClick={run(() => pinAll(ms))}><Pin /> Ghim</Button>
      <Hint text="Bỏ chọn (Esc)">
        <Button size="icon-xs" variant="ghost" aria-label="Bỏ chọn" onClick={() => onSelect([])}><X /></Button>
      </Hint>
    </div>
  );
}

/** A section's title row: icon, title, count, a note. */
function SectionHead({ id, icon: Icon, tone, title, n, note, className }: { id: string; icon: LucideIcon; tone: string; title: string; n: number; note?: string; className?: string }) {
  return (
    <h3 id={id} className={cn("mb-1 flex items-baseline gap-2 py-2 text-sm", className)}>
      <Icon className={cn("size-4 shrink-0 self-center", tone)} aria-hidden />
      <span className={cn("font-semibold", tone === "text-ink-2" ? "text-ink" : tone)}>{title}</span>
      <span className="rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums">{n}</span>
      {note && <span className="truncate text-xs text-ink-3">{note}</span>}
    </h3>
  );
}

/** "Hôm nay": one dense row of what needs you across modules, each a jump to it: the oldest waiting tag, the overdue ones,
 *  my YouTrack tickets at risk, Q&A (my questions due a nudge, new answers), finished AI Agent sessions not reviewed yet.
 *  Hidden when all are 0; folds to one line (remembered). Reads only what `/` already loads (no new polling).
 *  ponytail: Q&A counts read the 7-day range, the Q&A page's default; another range there is its own read. */
function Today({ rows, late, now }: { rows: PendingItem[]; late: number; now: number }) {
  const folded = useSyncExternalStore(onPrefs, () => getPref("todayStrip") === "0", () => false);
  const role = useRole();
  const { me, rows: tickets } = useMyTickets(true, false); // the shell's 5-min poll feeds it
  const risky = tickets.filter((i) => (role === "po" || (role === "qa" ? i.qc : i.assignee) === me) && riskOf(i, now)).length;
  const qa = useQaNews(7, false, false); // the inbox shell polls these groups
  const ai = (useTaskList().data ?? []).filter((t) => !t.running && !t.handled && !!t.result);
  const oldest = rows.filter((p) => !p.message.pinned).reduce<PendingItem | null>((a, p) => (!a || p.message.date < a.message.date ? p : a), null);
  const wait = oldest && waitLabel(oldest.message.date, now, !!oldest.message.priority);
  const items: { n: number; key: string; label: string; icon: LucideIcon; alert?: boolean; go: () => void; href?: string }[] = [
    ...(late ? [{ n: late, key: "late", label: "tag quá hạn", icon: Flame, alert: true, go: () => document.getElementById("pending-late")?.scrollIntoView({ behavior: smooth() }) }] : []),
    ...(risky ? [{ n: risky, key: "yt", label: "ticket rủi ro", icon: TriangleAlert, alert: true, go: () => {}, href: "/youtrack/" }] : []),
    ...(qa.lateTotal && qa.firstLate ? [{ n: qa.lateTotal, key: "qa-late", label: "câu hỏi cần nhắc", icon: MessageCircleQuestion, alert: true, go: () => openQa(qa.firstLate!.question.chat_id, qa.firstLate!.code) }] : []),
    ...(qa.total && qa.firstNew ? [{ n: qa.total, key: "qa-new", label: "trả lời Q&A mới", icon: MessageCircleQuestion, go: () => openQa(qa.firstNew!.question.chat_id, qa.firstNew!.code) }] : []),
    ...(ai.length ? [{ n: ai.length, key: "ai", label: "phiên AI xong chờ xem", icon: Bot, go: () => openTask(ai[0].id) }] : []),
  ];
  if (!items.length && !wait) return null;
  const chip = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors duration-(--dur-micro)";
  return (
    <section aria-label="Hôm nay" className="mx-3 mt-3 mb-1 rounded-[var(--radius-card)] bg-paper-2 shadow-groove @xl:mx-5">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
        <button type="button" aria-expanded={!folded} onClick={() => setPref("todayStrip", folded ? null : "0")}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs font-semibold text-ink hover:bg-paper-3">
          <Sun className="size-3.5 text-ink-3" aria-hidden />Hôm nay
          <ChevronDown aria-hidden className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short)", folded && "-rotate-90")} />
        </button>
        {folded ? (
          <span className="text-xs text-ink-3">
            {items.length ? items.map((i) => `${i.n} ${i.label}`).join(", ") : wait && `chờ lâu nhất ${wait.n} ${wait.unit}`}
          </span>
        ) : <>
          {wait && oldest && (
            <Hint side="bottom" text="Tag chờ lâu nhất (không tính tin ghim): bấm để tới tin đó">
              <button type="button" onClick={() => scrollToRow(msgKey(oldest.message))} className={cn(chip, "text-ink-2 hover:bg-paper-3")}>
                <Clock className="size-3.5 text-ink-3" aria-hidden />chờ lâu nhất <b className="font-mono font-semibold text-ink tabular-nums">{wait.n}</b> {wait.unit}
              </button>
            </Hint>
          )}
          {items.map(({ n, key, label, icon: Icon, alert, go, href }) => {
            const body = <><Icon className="size-3.5" aria-hidden /><b className="font-mono font-semibold tabular-nums">{n}</b> {label}</>;
            const cls = cn(chip, alert ? "bg-signal-wash text-signal-2 hover:brightness-95" : "text-ink-2 hover:bg-paper-3");
            return href ? <Link key={key} href={href} className={cls}>{body}</Link> : <button key={key} type="button" onClick={go} className={cls}>{body}</button>;
          })}
        </>}
      </div>
    </section>
  );
}

/** "Báo lại": a ticket I own reached Fixed / Done (seen by the YouTrack watch); answer whoever asked about it.
 *  "Trả lời" opens the reply with a line; the item goes once that reply is sent (or on X). */
function LoopBack({ range }: { range: string }) {
  const items = useLoopItems();
  const chats = useChats(range).data?.items;
  if (!items.length) return null;
  return (
    <section aria-labelledby="pending-loop">
      <SectionHead id="pending-loop" icon={Megaphone} tone="text-hl-2" title="Báo lại" n={items.length} note="ticket của bạn đã xong, người hỏi chưa biết" className="px-4 @xl:px-5" />
      <ul className="grid divide-y divide-rule border-y border-rule">
        {items.map((l) => <LoopRow key={loopKey(l)} l={l} chat={chats?.find((c) => c.chat_id === l.chat_id)?.title} />)}
      </ul>
    </section>
  );
}

function LoopRow({ l, chat }: { l: LoopItem; chat?: string }) {
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
          <b className="font-mono font-semibold text-ink">{l.ticket}</b><span className="shrink-0">{l.state}</span>{chat && <span className="truncate">{chat}</span>}
        </span>
        <span className="truncate text-ink-2">
          {m ? <>{!m.outgoing && m.sender_name && <b className="font-medium text-ink">{m.sender_name}: </b>}{m.text}</> : <span className="text-ink-3">Đang tải tin…</span>}
        </span>
      </span>
      <Button size="xs" variant="outline" onClick={() => void openReplyById(l.chat_id, l.message_id, `${l.ticket} đã chuyển ${l.state}, bạn kiểm tra lại giúp mình nhé.`)}>
        <Reply /> Trả lời
      </Button>
      <Hint side="bottom" text="Bỏ qua, không báo lại tin này">
        <Button size="icon-xs" variant="ghost" aria-label="Bỏ qua" onClick={() => doneLoopItem(l)}><X /></Button>
      </Hint>
    </li>
  );
}

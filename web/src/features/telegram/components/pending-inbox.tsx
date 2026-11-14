"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, CirclePause, Clock, Flame, Loader, type LucideIcon, Megaphone, Pin, Reply, RotateCw, Search, X } from "lucide-react";
import { AiBotIcon, AiBot } from "@/shared/components/ai/chat";
import { use, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GROUP_NEST, GroupBar } from "@/shared/components/ai/day-groups";
import { AiFetching, AllDone, useAiWait, useReload } from "@/shared/components/ai/fetching";
import { useChats } from "@/features/telegram/components/chat-list";
import { MessageItem } from "@/features/telegram/components/message-item";
import { SnoozeMenu } from "@/features/telegram/components/message/snooze-menu";
import { Button } from "@/shared/components/ui/button";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Empty } from "@/shared/components/ui/empty";
import { Hint } from "@/shared/components/ui/hint";
import { Kbd } from "@/shared/components/ui/kbd";
import { Segmented } from "@/shared/components/ui/segmented";
import { errorText, type Message, type PendingItem, type Task } from "@/shared/lib/api";
import { acted, COMPOSER, getMessage, inQaPage, msgKey, openReplyById, PartialError, pendingQuery, pinAll, QaCodes, setHandled, settled, taskListQuery, useListShortcuts, useTasks, waitLabel } from "@/features/telegram/lib/inbox";
import { useNow } from "@/shared/hooks/use-now";
import { fold } from "@/shared/lib/utils";
import { type LoopItem, loopKey, useDoneLoop, useLoopBack } from "@/features/telegram/lib/report-back";
import { readOverdueHours } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { type Key, useT } from "@/shared/lib/i18n";

type Section = { id: string; title: Key; note?: Key; icon: LucideIcon; tone: string; rows: PendingItem[] };

export type PendingTab = "todo" | "working" | "pinned";
type View = PendingTab;

/** To-do: pinned, overdue, waiting (no AI session yet). In progress: AI done (your turn), AI running, stopped.
 *  Pinned archive: still open, done. Each keeps the server order (oldest first). */
function sectionsOf(rows: PendingItem[], view: View, now: number, tasks: Map<string, Task[]>): Section[] {
  const by = (f: (p: PendingItem) => boolean) => rows.filter(f);
  if (view === "pinned") {
    return [
      { id: "open", title: "Chưa xử lý", icon: Clock, tone: "text-ink-2", rows: by((p) => !p.message.handled) },
      { id: "done", title: "Đã xử lý", icon: CheckCheck, tone: "text-ok", rows: by((p) => !!p.message.handled) },
    ];
  }
  const ts = (p: PendingItem) => tasks.get(msgKey(p.message)) ?? [];
  if (view === "working") {
    const ready = (p: PendingItem) => ts(p).some(settled);
    const running = (p: PendingItem) => !ready(p) && ts(p).some((x) => x.running);
    return [
      { id: "ready", title: "AI xong, chờ bạn", note: "đọc kết quả rồi trả lời", icon: AiBotIcon, tone: "text-hl-2", rows: by(ready) },
      { id: "running", title: "AI đang làm", icon: Loader, tone: "text-ink-2", rows: by(running) },
      { id: "stopped", title: "Phiên dừng mà chưa có kết quả", note: "mở phiên để chạy tiếp", icon: CirclePause, tone: "text-ink-3", rows: by((p) => !ready(p) && !running(p)) },
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
  itemsRef,
  jump,
  tab = "todo",
  onTab,
}: {
  pinned?: boolean;
  tab?: Exclude<PendingTab, "pinned">; // held by the parent: the page remounts on Đã ghim, the tab must survive it
  onTab?: (v: PendingTab) => void; // the "Đang chờ / Đang xử lý / Đã ghim" tabs
  range: string;
  search: string;
  onClearSearch: () => void;
  replyTo: string | null; // msgKey of the message being answered
  onReply: (m: Message) => void;
  onBack: () => void;
  itemsRef?: React.RefObject<Message[]>; // what is on screen, for "open the next tag"
  jump?: number; // bumps on every sidebar click, to scroll back to the top
}) {
  const t = useT();
  const q = useQuery({
    ...pendingQuery(range, pinned),
    refetchInterval: 60_000, // snoozed tags come back on their own
  });
  const [reloading, reload] = useReload([["pending"], ["tasks"], ["chats"]]); // tags, the AI cards under them, the sidebar counts
  const wait = useAiWait(q.isPending || reloading);
  const now = useNow();
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { box.current?.scrollTo({ top: 0 }); }, [jump]);
  const tasks = useTasks();
  const tasksQ = useQuery(taskListQuery); // the same cache useTasks reads: here only for its error
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
  const view: View = pinned ? "pinned" : tab;
  const inGroup = useMemo(() => (group ? found.filter((p) => p.message.chat_id === group) : found), [found, group]);
  // The "Đang xử lý" badge counts the to-do list (not the pinned one), the same on every tab: no group / search filter.
  // Both lists stay loaded (same query keys as `q`, no extra request for the shown one): switching tabs is instant.
  const todo = useQuery({ ...pendingQuery(range), enabled: !!onTab }).data;
  useQuery({ ...pendingQuery(range, true), enabled: !!onTab });
  const working = useMemo(() => (todo ?? []).filter((p) => !inQaPage(codes, p.message) && acted(p, tasks)).length, [todo, codes, tasks]);
  const sections = useMemo(
    () => sectionsOf(view === "pinned" ? inGroup : inGroup.filter((p) => acted(p, tasks) === (view === "working")), view, now, tasks),
    [inGroup, view, now, tasks],
  );
  const items = useMemo(() => sections.flatMap((s) => s.rows.map((p) => p.message)), [sections]);
  // Multi-select (to-do only): Space / Shift+click; a bar acts on all of them; Esc clears.
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const pick = useCallback((m: Message) => setSel((cur) => {
    const next = new Set(cur);
    if (!next.delete(msgKey(m))) next.add(msgKey(m));
    return next;
  }), []);
  const chosen = useMemo(() => (pinned ? [] : items.filter((m) => sel.has(msgKey(m)))), [items, sel, pinned]); // the page stays mounted on Đã ghim
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
      <div className="@container flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label={t("Quay lại")}><ArrowLeft /></Button>
        {onTab && <Segmented id="pending-tab" label={t("Đang chờ, đang xử lý hoặc đã ghim")} value={view} onChange={onTab}
          items={[
            { value: "todo", label: t("Đang chờ"), title: t("Tin tag bạn chưa xử lý, chưa có phiên AI nào") },
            { value: "working", label: <>{t("Đang xử lý")}{working > 0 && <span className="ml-1 font-mono tabular-nums">{working}</span>}</>, title: t("Tin tag đã có phiên AI: AI Agent, Đối chiếu BE, Trợ lý AI") },
            { value: "pinned", label: t("Đã ghim"), title: t("Tin bạn ghim để giữ lại, kể cả khi đã xử lý (g p)") },
          ]} />}
        <p className="min-w-0 truncate text-sm text-ink-2" aria-live="polite">
          {!q.data ? t("Đang tải…") : items.length === 0 ? (pinned ? t("Chưa có tin ghim") : view === "working" ? t("Không có tin đang xử lý") : t("Không còn việc nào")) : (
            <>
              {t.n(pinned ? "{n} tin đã ghim" : view === "working" ? "{n} tin đang xử lý" : "{n} tin đang chờ bạn", { n: <span className="font-mono text-base font-bold text-ink tabular-nums">{items.length}</span> })}
              {late > 0 && <span className="ml-2 font-medium text-signal-2">{t.n("({n} quá hạn)", { n: <span className="font-mono tabular-nums">{late}</span> })}</span>}
              {!pinned && q.data.length >= PENDING_CAP && <span className="ml-2 text-ink-3">{t("· chỉ hiện {n} tag cũ nhất", { n: PENDING_CAP })}</span>}
            </>
          )}
        </p>
        {/* Many groups: a list, not a segmented bar (DESIGN: segmented is for 2-4 options). */}
        {groups.length > 1 && (
          <Dropdown label={t("Lọc theo nhóm")} value={group} onChange={setGroup} className={cn("h-7 w-auto max-w-48", group && "border-hl text-hl-2")}
            options={[{ value: "", label: t("Mọi nhóm ({n})", { n: found.length }) }, ...groups.map(([id, g]) => ({ value: id, label: `${g.title} (${g.n})` }))]} />
        )}
        <p className="ml-auto hidden shrink-0 items-center gap-3 text-xs text-ink-3 @5xl:flex">
          <span className="flex items-center gap-1"><Kbd>j</Kbd><Kbd>k</Kbd> {t("chọn tin")}</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> {t("trả lời")}</span>
          <span className="flex items-center gap-1"><Kbd>x</Kbd> {t("xong")}</span>
          {!pinned && <span className="flex items-center gap-1"><Kbd>Space</Kbd> {t("chọn nhiều")}</span>}
          <span className="flex items-center gap-1"><Kbd>?</Kbd> {t("mọi phím tắt")}</span>
        </p>
        <Hint side="bottom" text={t("Tải lại danh sách: đọc lại tin tag và phiên AI của chúng")}>
          <Button size="icon-xs" variant="ghost" className="ml-auto shrink-0 @5xl:ml-0" aria-label={t("Tải lại danh sách")} onClick={reload}><RotateCw aria-hidden /></Button>
        </Hint>
      </div>

      {/* the loading scene covers the visible box from outside the scroll, so it stays centred however far the list scrolled */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {wait && <AiFetching kind="inbox" cover />}
      <div ref={box} className="relative min-h-0 flex-1 overflow-y-auto bg-cotton">
        {q.isError && (
          <div role="alert" className="grid justify-items-start gap-2 px-5 py-6 text-sm">
            <p className="text-error">{t("Không tải được danh sách.")}</p>
            <Button size="sm" variant="outline" aria-busy={q.isFetching} disabled={q.isFetching} onClick={() => void q.refetch()}>
              <RotateCw /> {t("Thử lại")}
            </Button>
          </div>
        )}
        {!pinned && tasksQ.isError && ( // without the sessions every tag looks untouched: say so, not "nothing in progress"
          <p role="alert" className="px-5 pt-3 text-xs text-error">
            {t("Không đọc được phiên AI nên tab Đang xử lý có thể thiếu tin: {e}", { e: errorText(tasksQ.error, {}, t("lỗi kết nối.")) })}
          </p>
        )}
        <div key={view} className="@container grid gap-1 pb-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
          {!pinned && !search.trim() && <LoopBack range={range} />}
          {q.isSuccess && items.length === 0 && (search.trim() ? (
            <Empty icon={<Search />} title={t("Không có tin nào khớp “{q}”.", { q: search.trim() })} className="py-20"
              action={<Button size="sm" variant="outline" onClick={onClearSearch}>{t("Xóa tìm kiếm")}</Button>} />
          ) : view === "working" ? (
            <Empty icon={<AiBot />} title={t("Chưa có tin nào đang xử lý")} className="py-20">
              {t("Tin tag có phiên AI Agent, Đối chiếu BE hoặc Trợ lý AI sẽ chuyển sang đây.")}
            </Empty>
          ) : pinned ? (
            <Empty icon={<Pin />} title={t("Chưa ghim tin nào")} className="py-20">
              {t("Chọn “Ghim lên đầu” trong menu ⋯ của một tin để giữ nó ở đây, kể cả khi đã xử lý.")}
            </Empty>
          ) : (
            <Empty art={<AllDone className="mb-1" />} title={t("Xong hết rồi!")} className="py-20">
              {t("Không còn tin tag nào chờ bạn. Tin mới và tin hết hạn hoãn sẽ tự hiện ở đây.")}
            </Empty>
          ))}
          {sections.map((s) => s.rows.length > 0 && (
            <section key={s.id} aria-labelledby={`pending-${s.id}`}>
              <GroupBar id={`pending-${s.id}`} icon={<s.icon aria-hidden />} tone={s.tone} late={s.id === "late"} label={t(s.title)} count={s.rows.length}
                note={s.note && t(s.note, { n: readOverdueHours() })} className="bg-cotton/85 px-4 @xl:px-5" />
              <ol className={cn("zebra grid divide-y divide-rule border-b border-rule", GROUP_NEST)}>
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
                    picked={sel.has(msgKey(m))}
                    onPick={pinned ? undefined : pick}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
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
/** "Báo lại": a ticket I own reached Fixed / Done (seen by the YouTrack watch); answer whoever asked about it.
 *  "Trả lời" opens the reply with a line; the item goes once that reply is sent (or on X). */
function LoopBack({ range }: { range: string }) {
  const t = useT();
  const q = useLoopBack();
  const items = q.data?.items ?? [];
  const error = q.isError ? errorText(q.error, {}, t("Không đọc được danh sách Báo lại.")) : q.data?.error;
  const done = useDoneLoop();
  const chats = useChats(range).data?.items;
  if (!items.length && !error) return null;
  return (
    <section aria-labelledby="pending-loop">
      <GroupBar id="pending-loop" icon={<Megaphone aria-hidden />} tone="text-hl-2" label={t("Báo lại")} count={items.length} note={t("ticket của bạn đã xong, người hỏi chưa biết")} className="bg-cotton/85 px-4 @xl:px-5" />
      <ul className={cn("zebra grid divide-y divide-rule border-b border-rule", GROUP_NEST)}>
        {error && <li className="px-4 py-2.5 text-sm text-error @xl:px-5">{t("Báo lại có thể thiếu mục: {e}", { e: error })}</li>}
        {items.map((l) => <LoopRow key={loopKey(l)} l={l} chat={chats?.find((c) => c.chat_id === l.chat_id)?.title} onDone={() => done(l)} />)}
      </ul>
    </section>
  );
}

const PENDING_CAP = 300; // storage.list_pending's limit: the newer tags past it are not listed (the sidebar counts all)

function LoopRow({ l, chat, onDone }: { l: LoopItem; chat?: string; onDone: () => void }) {
  const t = useT();
  // The text is read when shown (never stored in the browser); the user reads it here, so no AI consent check.
  const msg = useQuery({
    queryKey: ["message", l.chat_id, l.message_id, "read"],
    queryFn: ({ signal }) => getMessage(l.chat_id, l.message_id, { signal }),
    staleTime: 5 * 60_000,
  });
  const m = msg.data;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm @xl:px-5">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 gap-2 text-xs text-ink-3">
          <b className="font-mono font-bold text-ink">{l.ticket}</b><span className="shrink-0">{l.state}</span>{chat && <span className="truncate">{chat}</span>}
        </span>
        <span className="truncate text-ink-2">
          {m ? <>{!m.outgoing && m.sender_name && <b className="font-medium text-ink">{m.sender_name}: </b>}{m.text}</>
            : msg.isError ? <span className="text-error">{errorText(msg.error, {}, t("Không đọc được tin."))}</span>
            : <span className="text-ink-3">{t("Đang tải tin…")}</span>}
        </span>
      </span>
      <Button size="xs" variant="outline" onClick={() => void openReplyById(l.chat_id, l.message_id, `${l.ticket} đã chuyển ${l.state}, bạn kiểm tra lại giúp mình nhé.`)}>
        <Reply /> {t("Trả lời")}
      </Button>
      <Hint side="bottom" text={t("Bỏ qua, không báo lại tin này")}>
        <Button size="icon-xs" variant="ghost" aria-label={t("Bỏ qua")} onClick={onDone}><X /></Button>
      </Hint>
    </li>
  );
}

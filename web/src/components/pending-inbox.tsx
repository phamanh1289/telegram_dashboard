"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, Clock, Flame, type LucideIcon, Pin, RotateCw } from "lucide-react";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageItem } from "@/components/message-item";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Message, PendingItem } from "@/lib/api";
import { fold, msgKey, pendingQuery, useListShortcuts, useNow, useTasks, waitLabel } from "@/lib/inbox";
import { readOverdueHours } from "@/lib/prefs";
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
  const late = (p: PendingItem) => !p.message.pinned && waitLabel(p.message.date, now).overdue;
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
  const focused = useListShortcuts(items, onReply);
  useEffect(() => { if (itemsRef) itemsRef.current = items; }, [items, itemsRef]);
  const late = sections.find((s) => s.id === "late")?.rows.length ?? 0;

  return (
    <section aria-label={pinned ? "Tag đã ghim" : "Việc cần xử lý"} className="flex min-h-0 flex-col">
      <div className="grid shrink-0 gap-2 border-b px-3 py-2.5 md:px-5">
        <div className="flex min-h-8 items-center gap-2">
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
            <select aria-label="Lọc theo nhóm" value={group} onChange={(e) => setGroup(e.target.value)}
              className={cn("h-7 max-w-48 min-w-0 truncate rounded-md border border-rule bg-cotton px-2 text-xs", group && "border-hl text-hl-2")}>
              <option value="">Mọi nhóm ({found.length})</option>
              {groups.map(([id, g]) => <option key={id} value={id}>{g.title} ({g.n})</option>)}
            </select>
          )}
          <p className="ml-auto hidden shrink-0 items-center gap-3 text-xs text-ink-3 lg:flex">
            <span className="flex items-center gap-1"><Kbd>j</Kbd><Kbd>k</Kbd> chọn tin</span>
            <span className="flex items-center gap-1"><Kbd>Enter</Kbd> trả lời</span>
            <span className="flex items-center gap-1"><Kbd>x</Kbd> xong</span>
            <span className="flex items-center gap-1"><Kbd>?</Kbd> mọi phím tắt</span>
          </p>
        </div>
      </div>

      <div ref={box} className="min-h-0 flex-1 overflow-y-auto bg-paper-2">
        {q.isPending && <CardsSkeleton />}
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
        <div className="@container mx-auto grid max-w-4xl gap-5 px-3 py-4 md:px-5">
          {sections.map((s) => s.rows.length > 0 && (
            <section key={s.id} aria-labelledby={`pending-${s.id}`}>
              <h3 id={`pending-${s.id}`} className="sticky top-0 z-10 -mx-1 mb-1 flex items-baseline gap-2 bg-paper-2 px-1 py-2 text-sm">
                <s.icon className={cn("size-4 shrink-0 self-center", s.tone)} aria-hidden />
                <span className={cn("font-semibold", s.tone === "text-ink-2" ? "text-ink" : s.tone)}>{s.title}</span>
                <span className="rounded-full bg-paper-3 px-1.5 font-mono text-xs leading-5 text-ink-2 tabular-nums">{s.rows.length}</span>
                {s.note && <span className="truncate text-xs text-ink-3">{s.note}</span>}
              </h3>
              <ol className="grid gap-2.5">
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
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A key in a shortcut hint. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-sm border border-rule bg-cotton px-1 py-px text-[0.6875rem] text-ink-2">{children}</kbd>;
}

/** Loading rows in the shape of a group's message list: the wait, the sender, two lines of message. */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul aria-label="Đang tải…" className="@container divide-y divide-rule">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="grid gap-x-4 gap-y-2 px-4 py-4 @xl:grid-cols-[6.5rem_minmax(0,1fr)] @xl:px-5">
          <div className="flex gap-3 @xl:grid @xl:content-start @xl:gap-2"><Skeleton className="h-3.5 w-14" /><Skeleton className="h-3 w-10" /></div>
          <div className="grid content-start gap-2">
            <Skeleton className="h-3.5 w-48 max-w-full" />
            <Skeleton className="h-3.5 w-full max-w-xl" />
            <Skeleton className="h-3.5 max-w-md" style={{ width: `${70 - i * 10}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Loading cards in the shape of the to-do list: group and sender, two lines of message. */
function CardsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul aria-label="Đang tải…" className="mx-auto grid max-w-4xl gap-2.5 px-3 py-4 md:px-5">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="grid gap-2.5 rounded-[var(--radius-card)] border border-rule bg-cotton p-4">
          <div className="flex gap-2"><Skeleton className="h-5 w-24 rounded-full" /><Skeleton className="h-5 w-28" /><Skeleton className="h-5 w-16 rounded-full" /></div>
          <Skeleton className="h-3.5 w-full max-w-xl" />
          <Skeleton className="h-3.5 max-w-md" style={{ width: `${70 - i * 10}%` }} />
        </li>
      ))}
    </ul>
  );
}

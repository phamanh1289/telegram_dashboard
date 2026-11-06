"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowLeft, CheckCheck, Ellipsis, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageItem, revealMessage } from "@/components/message-item";
import { RowsSkeleton } from "@/components/pending-inbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { useChatMessages, type View } from "@/hooks/use-chat-messages";
import { api, ApiError, errorText, type Message } from "@/lib/api";
import { clearDrafts, markAllHandled, msgKey, smooth, toast, useListShortcuts, useNow, useTasks } from "@/lib/inbox";
import { clearLoopItems } from "@/lib/report-back";
import { dayLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/segmented";

export function MessageList({
  chatId,
  title,
  search,
  onBack,
  replyTo,
  onReply,
  range,
  onUseText,
  itemsRef,
  onDigest,
  focus,
  view: initialView,
}: {
  view?: View; // tab to open on (AI Agent "Mở nhóm": Done → Cả nhóm, else Chưa xử lý)
  focus?: string | null; // message id to scroll to and flash once loaded (e.g. "Mở nhóm" from an AI task)
  title: string; // the group's name, for the delete-data confirmation
  search: string; // the top bar's search box: in a group it searches this group's stored tags
  onUseText: (m: Message, text: string) => void;
  onDigest?: () => void; // open the AI summary of the whole conversation
  range: string;
  chatId: string;
  onBack: () => void;
  replyTo: string | null; // msgKey of the message being answered
  onReply: (m: Message) => void;
  itemsRef?: React.RefObject<Message[]>; // what is on screen, for "open the next tag"
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>(initialView ?? (focus ? "live" : "pending")); // the focused message may already be handled
  const pendingOnly = view === "pending";
  const live = view === "live" && !q;
  const [confirmAll, setConfirmAll] = useState(false);
  const markAll = useMutation({
    mutationFn: () => markAllHandled(chatId, range),
    onSuccess: () => setConfirmAll(false),
  });
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useChatMessages(chatId, q, range, view);
  // Cả nhóm leaves out tags (handled in Chưa / Đã xử lý), except the one opened here to be shown.
  const all = useMemo(
    () => (query.data ? [...query.data.pages].reverse().flatMap((p) => p.items) : [])
      .filter((m) => !live || !m.kept || m.message_id === focus),
    [query.data, live, focus],
  );
  // Sender filter, over the loaded pages ("Tải tin cũ hơn" brings in more). "" = everyone.
  // ponytail: client-side, so it only sees what is loaded; a server-side filter if long histories need it.
  const [sender, setSender] = useState("");
  const senders = useMemo(() => [...new Map(all.filter((m) => !m.deleted).map((m) => [who(m), m.outgoing ? "Bạn" : (m.sender_name ?? "Không rõ")])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "vi")), [all]);
  const items = useMemo(() => (sender ? all.filter((m) => !m.deleted && who(m) === sender) : all), [all, sender]);
  const days = useMemo(() => items.map((m) => dayLabel(m.date)), [items]); // day pills: Intl is too slow to run per row per render
  const now = useNow();
  const tasks = useTasks();
  const focused = useListShortcuts(items, onReply, !live, { initial: focus ? msgKey({ chat_id: chatId, message_id: focus }) : null });
  useEffect(() => { if (itemsRef) itemsRef.current = items; }, [items, itemsRef]);

  // Scroll: stick to bottom only when already there; keep position when older pages load.
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [far, setFar] = useState(false); // scrolled up more than a screen: offer the jump back down
  const anchor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
    } else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const loadOlder = () => {
    if (box.current) anchor.current = box.current.scrollHeight - box.current.scrollTop;
    // A failed page leaves the items as they were: drop the anchor, or the next refresh would jump to it.
    void query.fetchNextPage().then((r) => { if (r.isError) anchor.current = null; });
  };

  // Focus: page back until the message is loaded (at most 20 pages), then center and flash it (once).
  const sought = useRef(focus);
  const soughtPages = useRef(0);
  useEffect(() => {
    const id = sought.current;
    if (!id || query.isPending || query.isFetchingNextPage) return;
    if (query.isError) {
      sought.current = null;
      toast({ text: `Không tải được tin để tìm #${id}, thử lại sau` });
    } else if (revealMessage(box.current, id)) sought.current = null;
    else if (query.hasNextPage && soughtPages.current++ < 20) loadOlder();
    else {
      sought.current = null;
      toast({ text: `Không thấy tin #${id} trong nhóm (ngoài khoảng thời gian đang lọc?)` });
    }
  });

  const error = query.error instanceof ApiError ? query.error.code : query.error ? "error" : null;

  return (
    <section aria-label="Tin nhắn" className="flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại">
          <ArrowLeft />
        </Button>
        {/* While searching, results span every stored tag: no view is pressed. */}
        <Segmented id="tg-view" label="Lọc tin" value={q ? null : view} onChange={setView} items={[
          { value: "pending", label: "Chưa xử lý", title: "Tin tag bạn chưa xử lý" },
          { value: "done", label: "Đã xử lý", title: "Tin tag bạn đã xử lý" },
          { value: "live", label: "Cả nhóm", title: "Mọi tin trong nhóm, đọc trực tiếp từ Telegram (không lưu)" },
        ]} />
        <div className="ml-auto flex items-center gap-1">
        {(senders.length > 1 || sender) && (
          <select aria-label="Lọc theo người gửi" value={sender} onChange={(e) => setSender(e.target.value)}
            className={cn("h-[30px] max-w-40 min-w-0 truncate rounded-md border border-rule bg-cotton px-2 text-xs", sender && "border-hl text-hl-2")}>
            <option value="">Mọi người gửi</option>
            {senders.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
          </select>
        )}
        {!q && pendingOnly && items.length > 0 && (
          <Hint side="bottom" text="Đánh dấu mọi tin chưa xử lý trong nhóm này là đã xử lý (có Hoàn tác).">
            <Button size="xs" variant="outline" onClick={() => setConfirmAll(true)}>
              <CheckCheck /> Xong tất cả
            </Button>
          </Hint>
        )}
        {!q && onDigest && (
          <Hint side="bottom" text="AI tóm tắt hội thoại của nhóm: đã chốt gì, thay đổi gì, ảnh hưởng team nào, cần confirm gì.">
            <Button size="xs" variant="outline" onClick={onDigest}>
              <Sparkles /> Tóm tắt
            </Button>
          </Hint>
        )}
        <GroupMenu chatId={chatId} title={title} onPurged={onBack} />
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={box}
        data-testid="timeline"
        className="min-h-0 flex-1 overflow-y-auto bg-cotton"
        onScroll={(e) => {
          const el = e.currentTarget;
          const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
          atBottom.current = gap < 40;
          setFar(gap > el.clientHeight);
        }}
      >
        {query.hasNextPage && (
          <div className="border-b border-rule py-2 text-center">
            <Button size="xs" variant="ghost" onClick={loadOlder} aria-busy={query.isFetchingNextPage} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Đang tải…" : "Tải tin cũ hơn"}
            </Button>
          </div>
        )}
        {!q && !query.hasNextPage && query.isSuccess && (
          <p className="border-b border-rule px-5 py-2 text-center text-xs text-ink-3">
            {live ? "Đầu cuộc trò chuyện." : "Chỉ lưu tin tag/reply bạn (nạp lại 14 ngày gần nhất mỗi lần kết nối)."}
          </p>
        )}
        {query.isPending && <RowsSkeleton />}
        {error === "not_tracking" && <p className="px-5 py-6 text-sm text-ink-2">Nhóm không còn được theo dõi.</p>}
        {error && error !== "not_tracking" && (
          <div role="alert" className="grid justify-items-start gap-2 px-5 py-6 text-sm">
            <p className="text-error">{errorText(query.error, {}, "Không tải được tin nhắn.")}</p>
            <Button size="sm" variant="outline" aria-busy={query.isFetching} disabled={query.isFetching} onClick={() => void query.refetch()}>
              <RotateCw /> Thử lại
            </Button>
          </div>
        )}
        {query.isSuccess && items.length === 0 && (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center text-sm text-ink-2">
            {!q && pendingOnly && <CheckCheck className="size-5 text-ok" aria-hidden />}
            <p>{sender ? "Không có tin của người gửi này trong các tin đã tải." : q ? "Không có kết quả." : pendingOnly ? "Đã xử lý hết tin tag trong nhóm này." : view === "done" ? "Chưa có tin tag nào đã xử lý." : "Chưa có tin nào."}</p>
            {sender && <Button size="sm" variant="outline" onClick={() => setSender("")}>Bỏ lọc người gửi</Button>}
            {!sender && !q && pendingOnly && <Button size="sm" variant="outline" onClick={() => setView("live")}>Xem mọi tin trong nhóm</Button>}
          </div>
        )}
        <ol className="@container divide-y divide-rule">
          {items.map((m, i) => {
            const day = days[i];
            const newDay = i === 0 || days[i - 1] !== day;
            return (
            <Fragment key={m.message_id}>
            {/* Telegram's day pill: rides at the top while you scroll through that day. */}
            {newDay && (
              <li role="separator" aria-label={day} className="pointer-events-none sticky top-0 z-10 flex justify-center border-none! py-1.5">
                <span className="rounded-full bg-paper-2 px-2.5 text-xs leading-6 font-medium text-ink-2 shadow-pop">{day}</span>
              </li>
            )}
            <MessageItem
              head={newDay || items[i - 1]?.deleted || items[i - 1]?.sender_id !== m.sender_id || items[i - 1]?.outgoing !== m.outgoing}
              clock
              m={m}
              isReplyTarget={replyTo === msgKey(m)}
              now={now}
              focused={focused === msgKey(m)}
              tasks={tasks.get(msgKey(m))}
              onReply={onReply}
              onUseText={onUseText}
              live={live}
            />
            </Fragment>
            );
          })}
        </ol>
      </div>
      {far && (
        <Hint side="bottom" text="Xuống tin mới nhất">
          <Button size="icon" variant="outline" aria-label="Xuống tin mới nhất"
            className="absolute right-4 bottom-4 rounded-full shadow-pop animate-in fade-in-0 duration-(--dur-short)"
            onClick={() => box.current?.scrollTo({ top: box.current.scrollHeight, behavior: smooth() })}>
            <ArrowDown />
          </Button>
        </Hint>
      )}
      </div>
      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent>
          <DialogTitle>Đánh dấu tất cả là đã xử lý?</DialogTitle>
          <DialogDescription>
            {query.hasNextPage ? "Mọi" : `${items.length}`} tin chưa xử lý trong nhóm này
            {range ? " (trong khoảng ngày đang lọc)" : ""} sẽ chuyển sang “Đã xử lý”, không thả reaction. Hoàn tác ngay trên thông báo, hoặc mở lại từng tin ở tab Đã xử lý.
          </DialogDescription>
          {markAll.isError && <p role="alert" className="text-sm text-error">Không cập nhật được.</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Hủy</DialogClose>
            <Button aria-busy={markAll.isPending} disabled={markAll.isPending} onClick={() => markAll.mutate()}>
              <CheckCheck /> Xong tất cả
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** The group's "⋯" menu: actions on the whole group, away from the navigation (delete its stored data). */
function GroupMenu({ chatId, title, onPurged }: { chatId: string; title: string; onPurged: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const purge = useMutation({
    mutationFn: () => api<void>(`/chats/${encodeURIComponent(chatId)}/data`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["messages", chatId] });
      clearDrafts(chatId); // this browser's copies go with the group's data
      clearLoopItems(chatId);
      setConfirm(false);
      onPurged();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["chats"] }),
  });
  return (
    <>
      <Menu.Root>
        <Hint side="bottom" text="Thao tác với cả nhóm">
          <Menu.Trigger aria-label="Thao tác với nhóm" render={<Button size="icon-sm" variant="ghost" className="data-popup-open:bg-paper-3" />}>
            <Ellipsis />
          </Menu.Trigger>
        </Hint>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
            <Menu.Popup className="grid w-56 origin-(--transform-origin) gap-0.5 rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
              <Menu.Item onClick={() => setConfirm(true)}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-error outline-none select-none data-highlighted:bg-error-wash">
                <Trash2 className="size-4" aria-hidden /> Xóa dữ liệu nhóm…
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle>Xóa dữ liệu nhóm?</DialogTitle>
          <DialogDescription>
            Xóa tin đã lưu của “{title}” và nội dung chưa gửi trên máy này. Nhóm sẽ hiện lại khi có người tag bạn.
            Tin đang gửi có thể đã tới Telegram và không thu hồi được.
          </DialogDescription>
          {purge.isError && <p role="alert" className="text-sm text-error">Không xóa được dữ liệu nhóm. Thử lại.</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Hủy</DialogClose>
            <Button variant="destructive" className="bg-error-wash hover:bg-error-wash" aria-busy={purge.isPending} disabled={purge.isPending}
              onClick={() => purge.mutate()}>
              Xóa dữ liệu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One key per sender for the filter: "me" for your own messages, else the Telegram id (or the name). */
const who = (m: Message) => (m.outgoing ? "me" : (m.sender_id ?? m.sender_name ?? "?"));

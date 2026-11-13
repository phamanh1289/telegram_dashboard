"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowLeft, CheckCheck, Ellipsis, MessageSquare, RotateCw, Search, Sparkles, Trash2 } from "lucide-react";
import { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChats } from "@/components/chat-list";
import { MessageItem, revealMessage } from "@/components/message-item";
import { AiFetching, AllDone, useAiWait } from "@/components/ai/fetching";
import { Button } from "@/components/ui/button";
import { MENU_POPUP } from "@/components/ui/menu";
import { Dropdown } from "@/components/ui/dropdown";
import { Empty } from "@/components/ui/empty";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { useChatMessages, type View } from "@/hooks/use-chat-messages";
import { api, ApiError, errorText, type Message } from "@/lib/api";
import { clearDrafts, inQaPage, markAllHandled, msgKey, QaCodes, smooth, toast, useListShortcuts, useNow, useTasks } from "@/lib/inbox";
import { dayLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n";

export function MessageList({
  chatId,
  title,
  search,
  onBack,
  replyTo,
  onReply,
  range,
  rangeName,
  itemsRef,
  onDigest,
  focus,
  view: initialView,
}: {
  view?: View; // tab to open on (AI Agent "Mở nhóm": Done → Cả nhóm, else Chưa xử lý)
  focus?: string | null; // message id to scroll to and flash once loaded (e.g. "Mở nhóm" from an AI task)
  title: string; // the group's name, for the delete-data confirmation
  search: string; // the top bar's search box: in a group it searches this group's stored tags
  onDigest?: () => void; // open the AI summary of the whole conversation
  range: string;
  rangeName: string; // label of the day range picked in the top bar
  chatId: string;
  onBack: () => void;
  replyTo: string | null; // msgKey of the message being answered
  onReply: (m: Message) => void;
  itemsRef?: React.RefObject<Message[]>; // what is on screen, for "open the next tag"
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>(initialView ?? (focus ? "live" : "pending")); // the focused message may already be handled
  const pendingOnly = view === "pending";
  const live = view === "live" && !q;
  const [confirmAll, setConfirmAll] = useState(false);
  const { qaHidden } = useChats(range);
  const markAll = useMutation({
    mutationFn: () => markAllHandled(chatId, range, qaHidden.get(chatId)),
    onSuccess: () => setConfirmAll(false),
  });
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { query, pollError } = useChatMessages(chatId, q, range, view);
  // Cả nhóm leaves out tags (handled in Chưa / Đã xử lý); the tag views leave out those Q&A shows. Either way the one
  // opened here stays.
  const codes = use(QaCodes);
  const all = useMemo(
    () => (query.data ? [...query.data.pages].reverse().flatMap((p) => p.items) : [])
      .filter((m) => m.message_id === focus || (live ? !m.kept : !inQaPage(codes, m))),
    [query.data, live, focus, codes],
  );
  // Sender filter, over the loaded pages ("Tải tin cũ hơn" brings in more). "" = everyone.
  // ponytail: client-side, so it only sees what is loaded; a server-side filter if long histories need it.
  const [sender, setSender] = useState("");
  const you = t("Bạn"), unknown = t("Không rõ");
  const senders = useMemo(() => [...new Map(all.filter((m) => !m.deleted).map((m) => [who(m), m.outgoing ? you : (m.sender_name ?? unknown)])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "vi")), [all, you, unknown]);
  const items = useMemo(() => (sender ? all.filter((m) => !m.deleted && who(m) === sender) : all), [all, sender]);
  // Runs of one day (indexes into items), each its own block so its sticky pill only rides within that day.
  // Intl is too slow to run per row per render.
  const days = useMemo(() => {
    const out: { day: string; idx: number[] }[] = [];
    items.forEach((m, i) => {
      const day = dayLabel(m.date);
      if (out.at(-1)?.day === day) out.at(-1)!.idx.push(i);
      else out.push({ day, idx: [i] });
    });
    return out;
  }, [items]);
  const now = useNow();
  const tasks = useTasks();
  const focused = useListShortcuts(items, onReply, !live, { initial: focus ? msgKey({ chat_id: chatId, message_id: focus }) : null });
  useEffect(() => { if (itemsRef) itemsRef.current = items; }, [items, itemsRef]);

  // Scroll: stick to bottom only when already there; keep position when older pages load.
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [far, setFar] = useState(false); // scrolled up more than a screen: offer the jump back down
  const anchor = useRef<number | null>(null);
  const wait = useAiWait(query.isPending);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
    } else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  // Rows grow after the first paint (lazy photos, ticket / session chips): stay on the newest message while at the bottom.
  // Not while seeking a focused message: its reveal scroll would be pulled back down.
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = box.current, ol = list.current;
    if (!el || !ol || focus) return;
    const ro = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; });
    ro.observe(ol);
    return () => ro.disconnect();
  }, [focus]);

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
      toast({ text: t("Không tải được tin để tìm #{id}, thử lại sau", { id }) });
    } else if (revealMessage(box.current, id)) sought.current = null;
    else if (query.hasNextPage && soughtPages.current++ < 20) loadOlder();
    else {
      sought.current = null;
      toast({ text: t("Không thấy tin #{id} trong nhóm (ngoài khoảng thời gian đang lọc?)", { id }) });
    }
  });

  const error = query.error instanceof ApiError ? query.error.code : query.error ? "error" : null;

  return (
    <section aria-label={t("Tin nhắn")} className="flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label={t("Quay lại")}>
          <ArrowLeft />
        </Button>
        {/* While searching, results span every stored tag: no view is pressed. */}
        <Segmented id="tg-view" label={t("Lọc tin")} value={q ? null : view} onChange={setView} items={[
          { value: "pending", label: t("Chưa xử lý"), title: t("Tin tag bạn chưa xử lý") },
          { value: "done", label: t("Đã xử lý"), title: t("Tin tag bạn đã xử lý") },
          { value: "live", label: t("Cả nhóm"), title: t("Mọi tin trong nhóm, đọc trực tiếp từ Telegram (không lưu)") },
        ]} />
        <div className="ml-auto flex items-center gap-1">
        {(senders.length > 1 || sender) && (
          <Dropdown label={t("Lọc theo người gửi")} value={sender} onChange={setSender} className={cn("h-[30px] w-auto max-w-40", sender && "border-hl text-hl-2")}
            options={[{ value: "", label: t("Mọi người gửi") }, ...senders.map(([k, name]) => ({ value: k, label: name }))]} />
        )}
        {!q && !sender && pendingOnly && items.length > 0 && ( // it marks the whole group: not offered under a sender filter
          <Hint side="bottom" text={t("Đánh dấu mọi tin chưa xử lý trong nhóm này là đã xử lý (có Hoàn tác).")}>
            <Button size="xs" variant="outline" onClick={() => setConfirmAll(true)}>
              <CheckCheck /> {t("Xong tất cả")}
            </Button>
          </Hint>
        )}
        {!q && onDigest && (
          <Hint side="bottom" text={t("AI tóm tắt hội thoại của nhóm: đã chốt gì, thay đổi gì, ảnh hưởng team nào, cần confirm gì.")}>
            <Button size="xs" variant="outline" onClick={onDigest}>
              <Sparkles /> {t("Tóm tắt")}
            </Button>
          </Hint>
        )}
        <GroupMenu chatId={chatId} title={title} onPurged={onBack} />
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
      {pollError != null && (
        <p role="status" className="border-b bg-warn-wash px-5 py-1.5 text-xs text-ink-2">
          {t("Không cập nhật được tin mới: {error} Đang thử lại mỗi 10 giây.", { error: errorText(pollError, {}, t("lỗi kết nối.")) })}
        </p>
      )}
      {wait && <AiFetching kind="chat" cover lines={live ? [t("AI đang kết nối Telegram"), t("Đang đọc trực tiếp tin của nhóm"), t("Đang gom tin, reply, người gửi"), t("Sắp xong rồi")] : undefined} />}
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
              {query.isFetchingNextPage ? t("Đang tải…") : t("Tải tin cũ hơn")}
            </Button>
          </div>
        )}
        {!q && !query.hasNextPage && query.isSuccess && (
          <p className="border-b border-rule px-5 py-2 text-center text-xs text-ink-3">
            {live ? t("Đầu cuộc trò chuyện.") : range ? t("Đã hết tin tag/reply bạn trong “{range}”. Đổi khoảng ngày ở thanh trên để xem tin cũ hơn.", { range: rangeName })
              : t("Đã hết tin tag/reply bạn đã lưu (mỗi lần kết nối nạp lại 14 ngày gần nhất).")}
          </p>
        )}
        {error === "not_tracking" && <p className="px-5 py-6 text-sm text-ink-2">{t("Nhóm không còn được theo dõi.")}</p>}
        {error && error !== "not_tracking" && (
          <div role="alert" className="grid justify-items-start gap-2 px-5 py-6 text-sm">
            <p className="text-error">{errorText(query.error, {}, t("Không tải được tin nhắn."))}</p>
            <Button size="sm" variant="outline" aria-busy={query.isFetching} disabled={query.isFetching} onClick={() => void query.refetch()}>
              <RotateCw /> {t("Thử lại")}
            </Button>
          </div>
        )}
        {query.isSuccess && items.length === 0 && (sender ? (
          <Empty icon={<Search />} title={t("Không có tin của người gửi này trong các tin đã tải.")} className="py-20"
            action={<Button size="sm" variant="outline" onClick={() => setSender("")}>{t("Bỏ lọc người gửi")}</Button>} />
        ) : q ? (
          <Empty icon={<Search />} title={t("Không có kết quả.")} className="py-20" />
        ) : pendingOnly ? ( // same "all done" as Việc cần xử lý
          <Empty art={<AllDone className="mb-1" />} title={t("Xong hết rồi!")} className="py-20"
            action={<Button size="sm" variant="outline" onClick={() => setView("live")}>{t("Xem mọi tin trong nhóm")}</Button>}>
            {t("Đã xử lý hết tin tag trong nhóm này.")}
          </Empty>
        ) : (
          <Empty icon={view === "done" ? <CheckCheck /> : <MessageSquare />} title={view === "done" ? t("Chưa có tin tag nào đã xử lý.") : t("Chưa có tin nào.")} className="py-20" />
        ))}
        <ol ref={list} className="@container">
          {days.map(({ day, idx }) => (
          <li key={items[idx[0]].message_id} aria-label={day}>
            {/* Telegram's day pill: rides at the top while you scroll through that day, then leaves with it. */}
            <div role="separator" aria-label={day} className="pointer-events-none sticky top-0 z-10 flex justify-center py-1.5">
              <span className="rounded-full bg-paper-2 px-2.5 text-xs leading-6 font-medium text-ink-2 shadow-pop">{day}</span>
            </div>
            <ol className="zebra divide-y divide-rule border-t border-rule">
          {idx.map((i, k) => {
            const m = items[i];
            return (
            <MessageItem
              key={m.message_id}
              head={k === 0 || items[i - 1]?.deleted || items[i - 1]?.sender_id !== m.sender_id || items[i - 1]?.outgoing !== m.outgoing}
              clock
              m={m}
              isReplyTarget={replyTo === msgKey(m)}
              now={now}
              focused={focused === msgKey(m)}
              tasks={tasks.get(msgKey(m))}
              onReply={onReply}
              live={live}
            />
            );
          })}
            </ol>
          </li>
          ))}
        </ol>
      </div>
      {far && (
        <Hint side="bottom" text={t("Xuống tin mới nhất")}>
          <Button size="icon" variant="outline" aria-label={t("Xuống tin mới nhất")}
            className="absolute right-4 bottom-4 rounded-full shadow-pop animate-in fade-in-0 duration-(--dur-short)"
            onClick={() => box.current?.scrollTo({ top: box.current.scrollHeight, behavior: smooth() })}>
            <ArrowDown />
          </Button>
        </Hint>
      )}
      </div>
      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} tone="default" icon={CheckCheck}
        title={t("Đánh dấu tất cả là đã xử lý?")} confirmLabel={t("Xong tất cả")}
        description={query.hasNextPage
          ? (range ? t("Mọi tin chưa xử lý trong nhóm này (trong khoảng ngày đang lọc) sẽ chuyển sang “Đã xử lý”, không thả reaction. Hoàn tác ngay trên thông báo, hoặc mở lại từng tin ở tab Đã xử lý.")
            : t("Mọi tin chưa xử lý trong nhóm này sẽ chuyển sang “Đã xử lý”, không thả reaction. Hoàn tác ngay trên thông báo, hoặc mở lại từng tin ở tab Đã xử lý."))
          : (range ? t("{n} tin chưa xử lý trong nhóm này (trong khoảng ngày đang lọc) sẽ chuyển sang “Đã xử lý”, không thả reaction. Hoàn tác ngay trên thông báo, hoặc mở lại từng tin ở tab Đã xử lý.", { n: all.length })
            : t("{n} tin chưa xử lý trong nhóm này sẽ chuyển sang “Đã xử lý”, không thả reaction. Hoàn tác ngay trên thông báo, hoặc mở lại từng tin ở tab Đã xử lý.", { n: all.length }))}
        busy={markAll.isPending} error={markAll.isError && errorText(markAll.error, {}, t("Không cập nhật được."))} onConfirm={() => markAll.mutate()} />
    </section>
  );
}

/** The group's "⋯" menu: actions on the whole group, away from the navigation (delete its stored data). */
function GroupMenu({ chatId, title, onPurged }: { chatId: string; title: string; onPurged: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const purge = useMutation({
    mutationFn: () => api<void>(`/chats/${encodeURIComponent(chatId)}/data`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["messages", chatId] });
      clearDrafts(chatId); // this browser's copies go with the group's data (the server drops its Báo lại items)
      setConfirm(false);
      onPurged();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["chats"] }),
  });
  return (
    <>
      <Menu.Root>
        <Hint side="bottom" text={t("Thao tác với cả nhóm")}>
          <Menu.Trigger aria-label={t("Thao tác với nhóm")} render={<Button size="icon-sm" variant="ghost" className="data-popup-open:bg-paper-3" />}>
            <Ellipsis />
          </Menu.Trigger>
        </Hint>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
            <Menu.Popup className={cn(MENU_POPUP, "w-56")}>
              <Menu.Item onClick={() => setConfirm(true)}
                className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-error outline-none select-none data-highlighted:bg-error-wash">
                <Trash2 className="size-4" aria-hidden /> {t("Xóa dữ liệu nhóm…")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t("Xóa dữ liệu nhóm?")} confirmLabel={t("Xóa dữ liệu")}
        description={t("Xóa tin đã lưu của “{title}” và nội dung chưa gửi trên máy này. Nhóm sẽ hiện lại khi có người tag bạn. Tin đang gửi có thể đã tới Telegram và không thu hồi được.", { title })}
        busy={purge.isPending} error={purge.isError && t("Không xóa được dữ liệu nhóm. Thử lại.")} onConfirm={() => purge.mutate()} />
    </>
  );
}

/** One key per sender for the filter: "me" for your own messages, else the Telegram id (or the name). */
const who = (m: Message) => (m.outgoing ? "me" : (m.sender_id ?? m.sender_name ?? "?"));

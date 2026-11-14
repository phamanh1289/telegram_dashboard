"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, CheckCheck, ExternalLink, Globe, Hash, MessageCircleQuestion, MessageSquarePlus, MessagesSquare, MoreHorizontal, Pin, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { CommentDialog } from "@/features/telegram/components/composer-dialogs";
import { DeepPick } from "@/features/telegram/components/deep-think";
import { RemindSubmenu } from "@/features/telegram/components/remind";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { Kbd } from "@/shared/components/ui/kbd";
import { MENU_ACTION, MENU_ITEM, MENU_POPUP, MENU_SEP } from "@/shared/components/ui/menu";
import { errorText, type Message, statusQuery } from "@/shared/lib/api";
import { answerQa, dbId, openInTelegram, pin, setHandled, telegramLink } from "@/features/telegram/lib/inbox";
import { copyText, toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";
import { t, useT } from "@/shared/lib/i18n";
import { SnoozeMenu } from "@/features/telegram/components/message/snooze-menu";
import { AttachPick } from "@/features/telegram/components/message/attach";

/** Thin rule between action groups in the hover strip. */
const Sep = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-rule-2" />;

/** Hover strip, laid out right to left: the first child (Xong; Đối chiếu BE on your own / live messages) sits at the
 *  edge and the rest tuck behind it until the row is hovered or selected (globals.css; always shown per Settings and on
 *  touch screens); always in the tab order. Groups: Xong | Hoãn, Ngữ cảnh | AI | ⋯ (rarer actions, spelled out with
 *  their keys). Replying is a click on the row (or Enter / r). Negative margin so the 30px targets don't make the line taller. */
export function RowActions({ m, tag, liveSnooze, showContext, onToggleContext }: { m: Message; tag: boolean; liveSnooze: boolean; showContext: boolean; onToggleContext: () => void }) {
  const t = useT();
  const { done, pinned, mark, togglePin } = useTagMark(m);
  const [comment, setComment] = useState(false);
  const yt = useQuery({ ...statusQuery, staleTime: Infinity }).data?.youtrack_configured; // the shell keeps it fresh
  const link = telegramLink(m);
  const answers = !m.outgoing || (tag && !!yt); // the ⋯ menu's "answer it" group shows
  return (
    <div role="toolbar" aria-label={t("Thao tác tin #{id}", { id: m.message_id })} className="row-actions flex flex-row-reverse items-center gap-0.5 -my-1.5">
      {tag && (
        <>
          <Hint side="bottom" title={done ? t("Mở lại (x)") : t("Xong (x)")}
            text={done ? t("Đánh dấu chưa xử lý.") : t("Không cần trả lời / đã xử lý nơi khác; thả reaction trên Telegram. Không thả reaction: Shift+bấm (Shift+x) hoặc menu ⋯.")}>
            <Button type="button" size="xs" variant="ghost" aria-busy={mark.isPending} disabled={mark.isPending} aria-label={done ? t("Mở lại") : t("Xong")}
              className={cn("font-medium", !done && "text-ok hover:bg-ok-wash hover:text-ok")}
              onClick={(e) => mark.mutate({ handled: !done, react: !e.shiftKey })}>
              {done ? <RotateCcw /> : <CheckCheck />}<span className="row-label">{done ? t("Mở lại") : t("Xong")}</span>
            </Button>
          </Hint>
          <Sep />
          {!done && <SnoozeMenu ms={[m]} />}
          <Hint side="bottom" title={t("Ngữ cảnh")} text={t("Xem các tin trước / sau trong nhóm.")}>
            <Button type="button" size="icon-xs" variant="ghost" className={cn(showContext && "bg-paper-3 text-ink")}
              aria-label={t("Ngữ cảnh")} aria-expanded={showContext} onClick={onToggleContext}>
              <MessagesSquare />
            </Button>
          </Hint>
          <Sep />
        </>
      )}
      <DeepPick m={m} className="hover:bg-hl-wash hover:text-hl-2" />
      {/* Cả nhóm: hoãn keeps the message (backend), so it comes back as a tag. */}
      {liveSnooze && <SnoozeMenu ms={[m]} />}
      <AttachPick m={m} />
      <Hint side="bottom" title={t("Chép ID tin")} text={t("Chép ID {id}: dán vào ô nhắn của phiên AI (kể cả phiên đã Done) để đính kèm tin, hoặc dùng khi báo lỗi.", { id: dbId(m) })}>
        <Button type="button" size="icon-xs" variant="ghost" aria-label={t("Chép ID tin")}
          onClick={() => void copyText(dbId(m), t("Đã chép ID {id}, dán vào phiên AI để đính kèm", { id: dbId(m) }))}>
          <Hash />
        </Button>
      </Hint>
      <Sep />
      <Menu.Root>
        {/* Opens on hover (no Hint: the menu itself spells every action out); click / Enter still work. */}
        <Menu.Trigger aria-label={t("Thêm thao tác")} openOnHover delay={150} closeDelay={200} onClick={(e) => e.stopPropagation()}
          render={<Button type="button" size="icon-xs" variant="ghost" className="data-popup-open:bg-paper-3 data-popup-open:text-ink" />}>
          <MoreHorizontal />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
            {/* Portalled, but React events still bubble to the row: a click here must not open the reply panel. */}
            <Menu.Popup onClick={(e) => e.stopPropagation()} className={cn(MENU_POPUP, "w-72 text-sm")}>
              {/* Three groups by intent: this tag (state) | answer it | Telegram. A rule only between groups that show. */}
              {tag && !done && (
                <MoreItem icon={<Check />} keys="⇧X" disabled={mark.isPending} onClick={() => mark.mutate({ handled: true, react: false })}>{t("Xong, không thả reaction")}</MoreItem>
              )}
              {tag && (
                <MoreItem icon={<Pin className={cn(pinned && "fill-current")} />} keys="P" disabled={togglePin.isPending} onClick={() => togglePin.mutate()}>
                  {pinned ? t("Bỏ ghim") : t("Ghim lên đầu")}
                </MoreItem>
              )}
              {tag && done && <RemindSubmenu m={m} />}
              {tag && answers && <Menu.Separator className={MENU_SEP} />}
              {!m.outgoing && <MoreItem icon={<MessageCircleQuestion />} onClick={() => answerQa(m)}>{t("Trả lời bằng Q&A")}</MoreItem>}
              {tag && yt && <MoreItem icon={<MessageSquarePlus />} onClick={() => setComment(true)}>{t("Comment vào ticket YouTrack")}</MoreItem>}
              {(tag || answers) && <Menu.Separator className={MENU_SEP} />}
              <MoreItem icon={<ExternalLink />} keys="O" onClick={() => openInTelegram(m)}>{link.exact ? t("Mở trong Telegram") : t("Mở nhóm trên Telegram Web")}</MoreItem>
              {link.exact && <MoreItem icon={<Globe />} onClick={() => window.open(link.web, "_blank", "noreferrer")}>{t("Mở bằng Telegram Web")}</MoreItem>}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {comment && (
        <span className="contents" onClick={(e) => e.stopPropagation()}>
          <CommentDialog m={m} open onOpenChange={setComment} onDone={() => setComment(false)} />
        </span>
      )}
    </div>
  );
}

function MoreItem({ icon, keys, children, ...rest }: { icon: React.ReactNode; keys?: string; children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <Menu.Item {...rest} className={cn(MENU_ACTION, MENU_ITEM)}>
      {icon}<span className="min-w-0 flex-1 truncate">{children}</span>{keys && <Kbd>{keys}</Kbd>}
    </Menu.Item>
  );
}

/** Xong / pin state and mutations of one tag, for the hover strip and the reply panel header. */
function useTagMark(m: Message, onDone?: () => void) {
  // Local overrides keep the buttons right when `m` is a stale snapshot (reply panel). The handled override
  // only holds while m.handled is still what it was when we clicked, so an undo from the toast shows through.
  const [over, setOver] = useState<{ handled?: boolean; from?: boolean; pinned?: boolean }>({});
  // The server copy moved (SSE refresh, an undo): it wins over what we last clicked.
  const [seen, setSeen] = useState([m.handled, m.pinned]);
  if (seen[0] !== m.handled || seen[1] !== m.pinned) {
    setSeen([m.handled, m.pinned]);
    setOver({});
  }
  const done = over.handled !== undefined && over.from === m.handled ? over.handled : m.handled;
  const pinned = over.pinned ?? m.pinned;
  // Other changes come back through SSE, which refreshes lists and counts.
  const mark = useMutation({
    mutationFn: ({ handled, react = true }: { handled: boolean; react?: boolean }) => setHandled([m], handled, react),
    onSuccess: (_, { handled }) => {
      setOver((o) => ({ ...o, handled, from: m.handled }));
      if (handled) onDone?.();
    },
  });
  const togglePin = useMutation({
    mutationFn: () => pin(m, !pinned),
    onSuccess: () => setOver((o) => ({ ...o, pinned: !pinned })),
    onError: (e) => toast({ text: errorText(e, {}, pinned ? t("Không bỏ ghim được, thử lại") : t("Không ghim được, thử lại")) }),
  });
  return { done, pinned, mark, togglePin };
}

/** Xong / hoãn / ghim / ngữ cảnh as spelled-out buttons, in the reply panel header. */
export function MessageActions({
  m, showContext, onToggleContext, onDone,
}: {
  m: Message;
  showContext: boolean;
  onToggleContext: () => void;
  onDone?: () => void;
}) {
  const t = useT();
  const { done, pinned, mark, togglePin } = useTagMark(m, onDone);
  return (
    <>
      <Hint side="bottom" title={done ? t("Mở lại (x)") : t("Xong (x)")}
        text={done ? t("Đánh dấu chưa xử lý.") : t("Không cần trả lời / đã xử lý nơi khác; thả reaction trên Telegram. Không muốn thả reaction: Shift+bấm (Shift+x).")}>
        <Button type="button" size="xs" variant="ghost" className={cn(!done && "text-ok hover:bg-ok-wash hover:text-ok")} aria-busy={mark.isPending} disabled={mark.isPending}
          aria-label={done ? t("Mở lại") : t("Xong")}
          onClick={(e) => mark.mutate({ handled: !done, react: !e.shiftKey })}>
          {done ? <RotateCcw /> : <CheckCheck />}{done ? t("Mở lại") : t("Xong")}
        </Button>
      </Hint>
      {!done && <SnoozeMenu ms={[m]} label />}
      {(!done || pinned) && (
        <Hint side="bottom" title={pinned ? t("Bỏ ghim (p)") : t("Ghim (p)")} text={pinned ? t("Bỏ ghim tin này.") : t("Ghim lên đầu danh sách; giữ ở Tag đã ghim kể cả khi đã xử lý.")}>
          <Button type="button" size="xs" variant="ghost" className={cn(pinned && "text-ink")}
            disabled={togglePin.isPending} aria-label={pinned ? t("Bỏ ghim") : t("Ghim")} aria-pressed={pinned} onClick={() => togglePin.mutate()}>
            <Pin className={cn(pinned && "fill-current")} />{pinned ? t("Bỏ ghim") : t("Ghim")}
          </Button>
        </Hint>
      )}
      <Hint side="bottom" title={t("Ngữ cảnh")} text={t("Xem các tin trước / sau trong nhóm.")}>
        <Button type="button" size="xs" variant="ghost" className={cn(showContext && "bg-paper-3 text-ink")}
          aria-label={t("Ngữ cảnh")} aria-expanded={showContext} onClick={onToggleContext}>
          <MessagesSquare />{t("Ngữ cảnh")}
        </Button>
      </Hint>
      <Hint side="bottom" title={t("Trả lời bằng Q&A")} text={t("Trả lời ở trang Q&A: câu trả lời kèm mã #QA…, tin này đứng đầu một chuỗi Q&A để xem lại cả hỏi lẫn đáp. Tin đã nằm trong một chuỗi thì trả lời vào chuỗi đó, không thêm mã.")}>
        <Button type="button" size="xs" variant="ghost" onClick={() => answerQa(m)}><MessageCircleQuestion />Q&A</Button>
      </Hint>
    </>
  );
}

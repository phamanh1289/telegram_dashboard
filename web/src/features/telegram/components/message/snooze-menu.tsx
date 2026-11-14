"use client";

import { type InfiniteData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Repeat, Star, UserX } from "lucide-react";
import { AiBotIcon } from "@/shared/components/ai/chat";
import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { MENU_ITEM, MENU_POPUP } from "@/shared/components/ui/menu";
import { errorText, type Message, type MessagesPage } from "@/shared/lib/api";
import { autoSender, ignoreSender, prioritizeSender, PartialError, snooze, EVENT_SNOOZE_MS, ticketsIn } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { clockLabel, fromVnInput, snoozeChoices, timeLabel, vnInput } from "@/shared/lib/time";
import { useRole, usesCode } from "@/shared/lib/prefs";
import { ytProjectsQuery } from "@/features/youtrack/lib/yt";
import { cn } from "@/shared/lib/utils";
import { t, useT } from "@/shared/lib/i18n";

/** What a snooze waits for: a reply, a ticket done ("ticket:ABC-1"), or a time (the row's pill, the Hoãn button). */
export const snoozeHint = (m: Message) => m.snooze_on === "reply" ? t("Đang hoãn tới khi có người trả lời.")
  : m.snooze_on ? t("Đang hoãn tới khi {id} xong.", { id: m.snooze_on.slice(7) }) : t("Đang hoãn tới {time}.", { time: timeLabel(m.snoozed_until!, true) });

/** Hoãn: the tags leave the to-do list and come back on their own (pending lists refetch every minute). Presets in
 *  Vietnam time, a picked time, and (one tag) "Luôn bỏ qua {sender}". Also the multi-selection's Hoãn. */
export function SnoozeMenu({ ms, label, onDone }: { ms: Message[]; label?: boolean; onDone?: (failed: Message[]) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now()); // read when the menu opens: no per-row clock on long lists
  const one = ms.length === 1 ? ms[0] : null;
  const code = usesCode(useRole()); // QA / PO: no rules that run AI Agent sessions
  const snoozed = !!one?.snoozed_until && new Date(one.snoozed_until).getTime() > now;
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  // Tickets the tag names (known projects only), each a "until it is done" choice.
  const known = useQuery({ ...ytProjectsQuery, enabled: open }).data;
  const tickets = one ? ticketsIn(one.text, known) : [];
  const run = useMutation({
    mutationFn: (v: Date | null | { on: string }) => v instanceof Date || v === null ? snooze(ms, v) : snooze(ms, new Date(Date.now() + EVENT_SNOOZE_MS), v.on),
    onSuccess: () => {
      setOpen(false); onDone?.([]);
      // Cả nhóm hides kept messages: one snoozed from there is kept now, so it leaves that list at once.
      for (const m of ms) qc.setQueryData<InfiniteData<MessagesPage>>(["live", m.chat_id], (d) => d && { ...d,
        pages: d.pages.map((p) => ({ ...p, items: p.items.map((x) => x.message_id === m.message_id ? { ...x, kept: true } : x) })) });
    },
    onError: (e) => {
      if (e instanceof PartialError) { setOpen(false); onDone?.(e.failed); return; } // its toast said x/y
      toast({ text: errorText(e, {}, t("Không hoãn được, thử lại")) });
    },
  });
  const rule = useMutation({ mutationFn: (m: Message) => ignoreSender(m), onError: (e) => toast({ text: errorText(e, {}, t("Không thêm được quy tắc, thử lại")) }) });
  const prio = useMutation({ mutationFn: (m: Message) => prioritizeSender(m), onError: (e) => toast({ text: errorText(e, {}, t("Không thêm được quy tắc, thử lại")) }) });
  const auto = useMutation({ mutationFn: ([m, kind]: [Message, "relay" | "agent"]) => autoSender(m, kind),
    onError: (e) => toast({ text: errorText(e, { project_not_found: t("Dự án AI Agent không còn: chọn lại ở Giao AI Agent") }, t("Không thêm được quy tắc, thử lại")) }) });
  const pickCustom = () => {
    const at = custom && fromVnInput(custom);
    if (!at || at.getTime() <= Date.now()) return toast({ text: t("Chọn một lúc trong tương lai") });
    run.mutate(at);
  };
  return (
    <Menu.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setNow(Date.now()); }}>
      <Hint side="bottom" title={t("Hoãn (s: 1 giờ)")} text={snoozed ? snoozeHint(one!) : t("Ẩn khỏi Việc cần xử lý, tự hiện lại sau; hoặc luôn bỏ qua người gửi.")}>
        <Menu.Trigger aria-label={t("Hoãn")} onClick={(e) => e.stopPropagation()}
          render={<Button type="button" size={label ? "xs" : "icon-xs"} variant="ghost" className={cn(snoozed && "text-info", "hover:bg-info-wash hover:text-info data-popup-open:bg-info-wash data-popup-open:text-info")} />}>
          <AlarmClock />{label && t("Hoãn")}
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align={label ? "start" : "end"} className="z-50 outline-none">
          <Menu.Popup aria-label={t("Hoãn tới")} onClick={(e) => e.stopPropagation()} className={cn(MENU_POPUP, "w-56 text-xs")}>
            {snoozeChoices(now).map(({ label: text, at, clock }) => (
              <Menu.Item key={text} disabled={run.isPending} onClick={() => run.mutate(at)} className={cn("flex text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                {t(text)}<span className="ml-auto pl-2 font-mono text-ink-3 tabular-nums">{clock && clockLabel(at.toISOString())}</span>
              </Menu.Item>
            ))}
            <Menu.Item disabled={run.isPending} onClick={() => run.mutate({ on: "reply" })} className={cn("flex border-t text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
              {t("Tới khi có người trả lời")}
            </Menu.Item>
            {tickets.map((id) => (
              <Menu.Item key={id} disabled={run.isPending} onClick={() => run.mutate({ on: `ticket:${id}` })} className={cn("flex text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                {t("Tới khi {id} xong", { id })}
              </Menu.Item>
            ))}
            {/* Not a <form>: React submits bubble through the portal to the reply form around the header. */}
            <div className="grid gap-1 border-t px-2.5 pt-1.5 pb-1" onKeyDown={(e) => {
              if (e.key === "Escape" || e.key === "Tab") return; // still the menu's: close / move on
              e.stopPropagation(); // the menu's own typeahead / arrow keys stay out of the field
              if (e.key === "Enter") { e.preventDefault(); pickCustom(); }
            }}>
              <span className="text-ink-3">{t("Chọn giờ (giờ Việt Nam)")}</span>
              <span className="flex gap-1">
                <input type="datetime-local" aria-label={t("Hoãn tới lúc")} value={custom} min={vnInput(new Date(now))} onChange={(e) => setCustom(e.target.value)}
                  className="h-7 min-w-0 flex-1 rounded-[var(--radius-input)] border border-rule-2 bg-cotton px-1.5 text-xs text-ink" />
                <Button type="button" size="xs" variant="outline" disabled={!custom || run.isPending} onClick={pickCustom}>{t("Hoãn")}</Button>
              </span>
            </div>
            {snoozed && (
              <Menu.Item disabled={run.isPending} onClick={() => run.mutate(null)} className={cn("border-t text-ink-3 data-highlighted:text-ink", MENU_ITEM)}>
                {t("Bỏ hoãn")}
              </Menu.Item>
            )}
            {one?.sender_id && !one.outgoing && (
              <Menu.Item disabled={rule.isPending} onClick={() => rule.mutate(one)} className={cn("flex items-center gap-1.5 border-t text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                <UserX className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{t("Luôn bỏ qua {name}", { name: one.sender_name ?? t("người này") })}</span>
              </Menu.Item>
            )}
            {one?.sender_id && !one.outgoing && !one.priority && (
              <Menu.Item disabled={prio.isPending} onClick={() => prio.mutate(one)} className={cn("flex items-center gap-1.5 text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                <Star className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{t("Luôn ưu tiên {name}", { name: one.sender_name ?? t("người này") })}</span>
              </Menu.Item>
            )}
            {code && one?.sender_id && !one.outgoing && (<>
              <Hint side="right" text={t("Khi người này trả lời câu hỏi mà một phiên AI Agent đã gửi, phiên đó tự chạy tiếp với câu trả lời (được sửa code nếu phiên đã từng được cho sửa)")}>
                <Menu.Item disabled={auto.isPending} onClick={() => auto.mutate([one, "relay"])} className={cn("flex items-center gap-1.5 text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                  <Repeat className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{t("Tự chuyển trả lời của {name} vào phiên AI", { name: one.sender_name ?? t("người này") })}</span>
                </Menu.Item>
              </Hint>
              <Hint side="right" text={t("Mỗi tin mới của người này tự mở một phiên AI Agent chỉ đọc (phân tích, soạn câu hỏi) ở dự án bạn chọn gần nhất")}>
                <Menu.Item disabled={auto.isPending} onClick={() => auto.mutate([one, "agent"])} className={cn("flex items-center gap-1.5 text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                  <AiBotIcon className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{t("Luôn giao AI Agent cho tin của {name}", { name: one.sender_name ?? t("người này") })}</span>
                </Menu.Item>
              </Hint>
            </>)}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

"use client";

import { Menu } from "@base-ui/react/menu";
import { useMutation } from "@tanstack/react-query";
import { AlarmClockPlus, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Hint } from "@/shared/components/ui/hint";
import { MENU_ACTION, MENU_ITEM, MENU_POPUP } from "@/shared/components/ui/menu";
import { errorText, type Message } from "@/shared/lib/api";
import { type Key, t as tPlain, useT } from "@/shared/lib/i18n";
import { remind } from "@/features/telegram/lib/inbox";
import { toast } from "@/shared/lib/notifications";
import { clockLabel, snoozeChoices } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

// "Nhắc tôi kiểm tra lại": a tag you answered ("để mình check rồi báo") or marked done comes back to Việc cần xử lý at a
// time you pick (backend PUT …/remind: reopen + hide until then). Same times as Hoãn (lib/time snoozeChoices).

const ITEM = cn("flex text-ink-2 data-highlighted:text-ink", MENU_ITEM);

/** On a handled tag (row toolbar / ⋯ menu): pick when it comes back as a to-do. */
export function RemindMenu({ m, label }: { m: Message; label?: boolean }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now()); // read when the menu opens: no per-row clock
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: (at: Date) => remind(m, at),
    onSuccess: () => setOpen(false),
    onError: (e) => toast({ text: errorText(e, { message_not_found: tPlain("Tin này không còn được lưu") }, tPlain("Không đặt nhắc được, thử lại")) }),
  });
  return (
    <Menu.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setNow(Date.now()); }}>
      <Hint side="bottom" title={t("Nhắc lại sau")} text={t("Mở lại tin này thành việc cần xử lý vào lúc bạn chọn (vd đã hẹn “để mình check rồi báo”).")}>
        <Menu.Trigger aria-label={t("Nhắc lại sau")} onClick={(e) => e.stopPropagation()}
          render={<Button type="button" size={label ? "xs" : "icon-xs"} variant="ghost" className="hover:bg-info-wash hover:text-info data-popup-open:bg-info-wash data-popup-open:text-info" />}>
          <AlarmClockPlus />{label && t("Nhắc lại")}
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          <Menu.Popup aria-label={t("Nhắc lại lúc")} onClick={(e) => e.stopPropagation()} className={cn(MENU_POPUP, "w-52 text-xs")}>
            {snoozeChoices(now).map(({ label: text, at, clock }) => (
              <Menu.Item key={text} disabled={run.isPending} onClick={() => run.mutate(at)} className={ITEM}>
                {t(text)}<span className="ml-auto pl-2 font-mono text-ink-3 tabular-nums">{clock && clockLabel(at.toISOString())}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Inside a row's ⋯ menu (a handled tag): "Nhắc lại sau ›" with the same times, as a submenu of that menu. */
export function RemindSubmenu({ m }: { m: Message }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const run = useMutation({
    mutationFn: (at: Date) => remind(m, at),
    onError: (e) => toast({ text: errorText(e, { message_not_found: tPlain("Tin này không còn được lưu") }, tPlain("Không đặt nhắc được, thử lại")) }),
  });
  return (
    <Menu.SubmenuRoot onOpenChange={(o) => { if (o) setNow(Date.now()); }}>
      <Menu.SubmenuTrigger className={cn(MENU_ACTION, MENU_ITEM, "text-sm")}>
        <AlarmClockPlus /><span className="min-w-0 flex-1 truncate">{t("Nhắc lại sau…")}</span><ChevronRight />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} className="z-50 outline-none">
          <Menu.Popup aria-label={t("Nhắc lại lúc")} onClick={(e) => e.stopPropagation()} className={cn(MENU_POPUP, "w-52 text-xs")}>
            {snoozeChoices(now).map(({ label: text, at, clock }) => (
              <Menu.Item key={text} disabled={run.isPending} onClick={() => run.mutate(at)} className={ITEM}>
                {t(text)}<span className="ml-auto pl-2 font-mono text-ink-3 tabular-nums">{clock && clockLabel(at.toISOString())}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

/** The reply box: pick before Gửi; once the reply is sent the tag reopens at that time. "" = no reminder. */
export function RemindPick({ value, onChange, auto }: { value: string; onChange: (v: string) => void; auto?: boolean }) {
  const t = useT();
  const choices = snoozeChoices();
  const when = (k: Key) => (t.lang === "vi" ? t(k).toLowerCase() : t(k));
  return (
    <Hint side="bottom" text={auto ? t("Câu trả lời có hẹn làm tiếp (vd “để mình check rồi báo”), nên tự đặt nhắc lại. Đổi hoặc chọn Không nhắc nếu không cần.") : t("Gửi xong vẫn giữ tin này trong việc cần xử lý: nó hiện lại vào lúc bạn chọn để kiểm tra lại.")}>
      <span className="inline-flex">
        <Dropdown label={t("Nhắc lại sau khi gửi")} value={value} onChange={onChange}
          trigger={cn("flex h-7 items-center gap-1 rounded-full px-2 text-xs transition-colors duration-(--dur-micro) hover:bg-paper-3", value ? "bg-info-wash text-info" : "text-ink-3")}
          prefix={<AlarmClockPlus aria-hidden className="size-3.5 shrink-0" />}
          options={[{ value: "", label: t("Không nhắc") }, ...choices.map((c) => ({ value: c.label, label: t("Nhắc {when}", { when: when(c.label) }) }))]} />
      </span>
    </Hint>
  );
}

// "Lời hứa": a reply that promises a follow-up ("để mình check rồi báo", "chiều nay gửi") picks a reminder by itself;
// the most specific time wins. A RemindPick label, or "" when the text promises nothing.
const PROMISES: [RegExp, Key][] = [
  [/tuần sau|thứ hai tới|đầu tuần/i, "Thứ Hai 9:00"],
  [/\b(sáng |ngày )?mai\b/i, "Sáng mai 9:00"],
  [/chiều nay|trưa nay|trong hôm nay|cuối ngày|\beod\b/i, "14:00 hôm nay"],
  [/lát nữa|tí nữa|chút nữa|lát (mình|em|anh|chị|tôi)/i, "1 giờ"],
  [/để (mình|em|anh|chị|tôi|t) (check|kiểm tra|xem|hỏi|test|confirm|tìm)|(mình|em|anh|chị|tôi) (sẽ )?(báo|gửi|update) lại|(check|xem) (rồi|xong) báo/i, "3 giờ"],
];
export function promiseChoice(text: string, now = Date.now()) {
  const labels = new Set(snoozeChoices(now).map((c) => c.label));
  const hit = PROMISES.find(([re]) => re.test(text))?.[1] ?? "";
  return hit && !labels.has(hit) ? "3 giờ" : hit; // "14:00 hôm nay" once it has passed (labels are keys, never translated here)
}

/** The time a RemindPick value means now (its choices are relative: "1 giờ" counts from the send). */
export const remindAt = (v: string) => (v ? snoozeChoices().find((c) => c.label === v)?.at ?? null : null);

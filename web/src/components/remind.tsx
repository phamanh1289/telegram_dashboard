"use client";

import { Menu } from "@base-ui/react/menu";
import { useMutation } from "@tanstack/react-query";
import { AlarmClockPlus, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Hint } from "@/components/ui/hint";
import { errorText, type Message } from "@/lib/api";
import { remind, toast } from "@/lib/inbox";
import { clockLabel, snoozeChoices } from "@/lib/time";
import { cn } from "@/lib/utils";

// "Nhắc tôi kiểm tra lại": a tag you answered ("để mình check rồi báo") or marked done comes back to Việc cần xử lý at a
// time you pick (backend PUT …/remind: reopen + hide until then). Same times as Hoãn (lib/time snoozeChoices).

// Same look as the row menus in message-item.
const POPUP = "grid origin-(--transform-origin) gap-0.5 rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";
const ITEM = "flex cursor-default rounded-md px-2.5 py-1.5 text-ink-2 outline-none select-none data-highlighted:bg-paper-2 data-highlighted:text-ink";

/** On a handled tag (row toolbar / ⋯ menu): pick when it comes back as a to-do. */
export function RemindMenu({ m, label }: { m: Message; label?: boolean }) {
  const [now, setNow] = useState(() => Date.now()); // read when the menu opens: no per-row clock
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: (at: Date) => remind(m, at),
    onSuccess: () => setOpen(false),
    onError: (e) => toast({ text: errorText(e, { message_not_found: "Tin này không còn được lưu" }, "Không đặt nhắc được, thử lại") }),
  });
  return (
    <Menu.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setNow(Date.now()); }}>
      <Hint side="bottom" title="Nhắc lại sau" text="Mở lại tin này thành việc cần xử lý vào lúc bạn chọn (vd đã hẹn “để mình check rồi báo”).">
        <Menu.Trigger aria-label="Nhắc lại sau" onClick={(e) => e.stopPropagation()}
          render={<Button type="button" size={label ? "xs" : "icon-xs"} variant="ghost" className="hover:bg-info-wash hover:text-info data-popup-open:bg-info-wash data-popup-open:text-info" />}>
          <AlarmClockPlus />{label && "Nhắc lại"}
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          <Menu.Popup aria-label="Nhắc lại lúc" onClick={(e) => e.stopPropagation()} className={cn(POPUP, "w-52 text-xs")}>
            {snoozeChoices(now).map(({ label: text, at, clock }) => (
              <Menu.Item key={text} disabled={run.isPending} onClick={() => run.mutate(at)} className={ITEM}>
                {text}<span className="ml-auto pl-2 font-mono text-ink-3 tabular-nums">{clock && clockLabel(at.toISOString())}</span>
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
  const [now, setNow] = useState(() => Date.now());
  const run = useMutation({
    mutationFn: (at: Date) => remind(m, at),
    onError: (e) => toast({ text: errorText(e, { message_not_found: "Tin này không còn được lưu" }, "Không đặt nhắc được, thử lại") }),
  });
  return (
    <Menu.SubmenuRoot onOpenChange={(o) => { if (o) setNow(Date.now()); }}>
      <Menu.SubmenuTrigger className={cn(ITEM, "items-center gap-2.5 text-sm [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-3")}>
        <AlarmClockPlus /><span className="min-w-0 flex-1 truncate">Nhắc lại sau…</span><ChevronRight />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} className="z-50 outline-none">
          <Menu.Popup aria-label="Nhắc lại lúc" onClick={(e) => e.stopPropagation()} className={cn(POPUP, "w-52 text-xs")}>
            {snoozeChoices(now).map(({ label: text, at, clock }) => (
              <Menu.Item key={text} disabled={run.isPending} onClick={() => run.mutate(at)} className={ITEM}>
                {text}<span className="ml-auto pl-2 font-mono text-ink-3 tabular-nums">{clock && clockLabel(at.toISOString())}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

/** The reply box: pick before Gửi; once the reply is sent the tag reopens at that time. "" = no reminder. */
export function RemindPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const choices = snoozeChoices();
  return (
    <Hint side="bottom" text="Gửi xong vẫn giữ tin này trong việc cần xử lý: nó hiện lại vào lúc bạn chọn để kiểm tra lại.">
      <span className="inline-flex">
        <Dropdown label="Nhắc lại sau khi gửi" value={value} onChange={onChange}
          trigger={cn("flex h-7 items-center gap-1 rounded-full px-2 text-xs transition-colors duration-(--dur-micro) hover:bg-paper-3", value ? "bg-info-wash text-info" : "text-ink-3")}
          prefix={<AlarmClockPlus aria-hidden className="size-3.5 shrink-0" />}
          options={[{ value: "", label: "Không nhắc" }, ...choices.map((c) => ({ value: c.label, label: `Nhắc ${c.label.toLowerCase()}` }))]} />
      </span>
    </Hint>
  );
}

/** The time a RemindPick value means now (its choices are relative: "1 giờ" counts from the send). */
export const remindAt = (v: string) => (v ? snoozeChoices().find((c) => c.label === v)?.at ?? null : null);

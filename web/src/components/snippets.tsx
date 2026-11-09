"use client";

import { Menu } from "@base-ui/react/menu";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { getPref, onPrefs, readList, isString, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";

// Quick replies for the fixed phrases ("Đã nhận…", "Đã fix trên dev…"): no AI run, no quota. This browser only.
// `{tên}` becomes the sender's name, `{ticket}` the first ticket ID in the tag.

const KEY = "replySnippets";
const DEFAULTS = [
  "Mình nhận rồi nhé {tên}, để mình check rồi báo lại.",
  "{ticket} đã fix trên build dev, bạn test lại giúp mình nhé.",
  "Bạn gửi giúp mình bước tái hiện, build và thiết bị đang dùng để mình xem nhé.",
];
const read = () => readList(KEY, DEFAULTS, isString);
const save = (l: string[]) => setPref(KEY, JSON.stringify(l));
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(tên|ticket)\}/g, (_, k: string) => vars[k] ?? "").replace(/\s+([,.])/g, "$1").replace(/ {2,}/g, " ").trim();

const POPUP = "grid max-h-[min(60vh,24rem)] w-80 origin-(--transform-origin) grid-cols-[minmax(0,1fr)] gap-0.5 overflow-y-auto rounded-lg bg-cotton p-1 text-sm shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

/** The "Mẫu" button in the reply box (also "/" in an empty box): pick to insert; save the text being typed as a new one;
 *  remove one with its bin. */
export function Snippets({ open, onOpenChange, current, vars, onInsert }: {
  open: boolean; onOpenChange: (o: boolean) => void; current: string; vars: Record<string, string>; onInsert: (text: string) => void;
}) {
  useSyncExternalStore(onPrefs, () => getPref(KEY), () => null); // re-read when another tab / this menu changes them
  const list = read();
  const draft = current.trim();
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Hint side="bottom" title="Mẫu trả lời" text="Chèn câu trả lời hay dùng ({tên}, {ticket} tự điền). Gõ / ở ô trống để mở nhanh.">
        <Menu.Trigger aria-label="Mẫu trả lời"
          render={<Button type="button" size="xs" variant="ghost" className="text-ink-3 data-popup-open:bg-paper-3 data-popup-open:text-ink" />}>
          <MessageSquareText /> Mẫu
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50 outline-none">
          <Menu.Popup aria-label="Mẫu trả lời" className={POPUP}>
            {!list.length && <p className="px-2.5 py-2 text-xs text-ink-3">Chưa có mẫu nào.</p>}
            {list.map((s, i) => (
              <div key={`${i}:${s}`} className="group/s relative">
                <Menu.Item onClick={() => onInsert(fill(s, vars))}
                  className="cursor-default rounded-md py-1.5 pr-8 pl-2.5 text-ink-2 outline-none select-none data-highlighted:bg-paper-2 data-highlighted:text-ink">
                  <span className="line-clamp-2">{fill(s, vars)}</span>
                </Menu.Item>
                <button type="button" aria-label="Xóa mẫu" onClick={() => save(list.filter((_, k) => k !== i))}
                  className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded text-ink-3 opacity-0 transition-opacity duration-(--dur-micro) group-hover/s:opacity-100 hover:bg-error-wash hover:text-error focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            ))}
            <Menu.Item disabled={!draft || list.includes(draft)} onClick={() => save([...list, draft])}
              className={cn("mt-0.5 flex cursor-default items-center gap-2 rounded-md border-t px-2.5 pt-2 pb-1.5 text-xs text-hl-2 outline-none select-none data-disabled:text-ink-3 data-highlighted:bg-paper-2")}>
              <Plus className="size-3.5 shrink-0" aria-hidden />
              {draft ? "Lưu nội dung đang soạn làm mẫu" : "Soạn một câu rồi bấm đây để lưu làm mẫu"}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

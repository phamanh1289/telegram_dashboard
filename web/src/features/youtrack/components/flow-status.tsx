"use client";

import { X } from "lucide-react";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { Button } from "@/shared/components/ui/button";
import { useT } from "@/shared/lib/i18n";

// What the UI flow dialog shows around the map: its status chip, the busy card over the map, a centred message.

/** The head line of the dialog: what the file is now (one state, its colour, a hint on what to do next). */
export const STATUS = {
  running: { label: "Đang render", hint: "Lượt AI đang chạy, xem tiến độ bên dưới", tone: "bg-hl-wash text-hl-2" },
  interrupted: { label: "Bị gián đoạn", hint: "Bấm “Tiếp tục render” để chạy lại", tone: "bg-warn/15 text-warn" },
  failed: { label: "Lỗi render", hint: "Xem lý do ở thẻ lỗi, rồi bấm render để thử lại", tone: "bg-error/10 text-error" },
  unsaved: { label: "Chưa lưu", hint: "Sơ đồ chỉ nằm trong bản nháp, chưa lên ticket", tone: "bg-warn/15 text-warn" },
  edited: { label: "Chưa cập nhật", hint: "Có thay đổi chưa lên ticket; bấm Cập nhật để ghi", tone: "bg-warn/15 text-warn" },
  flow: { label: "Đã có sơ đồ", hint: "Kéo thả để sửa; lưu lên ticket bằng Cập nhật", tone: "bg-paper-3 text-ink-2" },
  empty: { label: "Chưa có", hint: "Chọn cách dựng ở giữa, rồi bấm nút bên dưới", tone: "bg-paper-3 text-ink-3" },
} as const;

/** The file being packed (download) or sent to the ticket (save): a card with the feature's scene and the step it is on,
 *  held AI_WAIT_MS so it is seen, over the middle of the map. Not a modal and click-through: the map stays editable while
 *  it uploads (those edits stay a draft over the saved file); nothing to stop (a save of unknown outcome must not be cut). */
/** `onStop`: Dừng; none while the step cannot be stopped (a save's upload): the button stays, greyed, with why. */
export function FlowBusy({ project, pending, kind, step, title, text, onStop }: { project: string; pending: boolean; kind: "flowHtml" | "flowSave"; step: string; title: string; text: string; onStop?: () => void }) {
  const t = useT();
  const show = useAiWait(pending);
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-4">
      <section role="status" aria-label={title} className="grid w-full max-w-md gap-2 rounded-lg bg-cotton p-5 shadow-pop animate-in fade-in-0 zoom-in-95 duration-(--dur-short)">
        <h3 className="text-base font-medium text-ink">{title}</h3>
        <p className="text-sm text-ink-2">{text}</p>
        <AiFetching kind={kind} project={project} lines={step ? [step] : undefined} className="min-h-72 py-2" />
        {pending && (
          <div className="pointer-events-auto flex items-center justify-end gap-3">
            {!onStop && <span className="text-xs text-ink-3">{t("Đang tải lên ticket: để chạy xong, dừng giữa chừng sẽ không rõ đã lưu hay chưa.")}</span>}
            <Button size="sm" variant="outline" disabled={!onStop} onClick={onStop}><X />{t("Dừng")}</Button>
          </div>
        )}
      </section>
    </div>
  );
}

export const Center = ({ children }: { children: React.ReactNode }) => (
  <div className="grid h-full w-full place-content-center justify-items-center gap-3 p-6 text-center">{children}</div>
);

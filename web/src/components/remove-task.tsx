"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ui/dialog";
import { api, errorText, type Task } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { sessionId } from "@/lib/inbox";

/** "Xóa phiên này?" then DELETE (a running session is stopped first): the session menu and the AI Agent list
 *  row's trash icon.
 *  Mounted only while asking; stays open on failure with the error. */
export function RemoveTask({ t, onClose }: { t: Task; onClose: () => void }) {
  const tt = useT();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api<void>(`/tasks/${t.id}`, { method: "DELETE" }),
    onSuccess: onClose,
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(); }} busy={remove.isPending} onConfirm={() => remove.mutate()}
      error={remove.isError && errorText(remove.error, {}, tt("Xóa thất bại, thử lại."))} title={tt("Xóa phiên này?")} confirmLabel={tt("Xóa phiên")}
      description={t.running ? tt("Phiên đang chạy sẽ bị dừng rồi xóa. Không hoàn tác được.") : tt("Phiên biến khỏi danh sách AI Agent. Không hoàn tác được.")}
      items={[{ id: t.id, tag: sessionId(t), label: t.title || t.message_text || t.prompt }]} />
  );
}

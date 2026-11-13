"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clearDrafts } from "@/lib/inbox";

/** "Xóa dữ liệu nhóm?" then DELETE: the group page's ⋯ menu and Cài đặt › Dữ liệu's per-group list. Mounted only while
 *  asking; stays open on failure with the error. */
export function PurgeChat({ chatId, title, onClose, onPurged }: { chatId: string; title: string; onClose: () => void; onPurged?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const purge = useMutation({
    mutationFn: () => api<void>(`/chats/${encodeURIComponent(chatId)}/data`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["messages", chatId] });
      clearDrafts(chatId); // this browser's copies go with the group's data (the server drops its Báo lại items)
      onClose();
      onPurged?.();
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["chats"] }), qc.invalidateQueries({ queryKey: ["data"] })]),
  });
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(); }} title={t("Xóa dữ liệu nhóm?")} confirmLabel={t("Xóa dữ liệu")}
      description={t("Xóa tin đã lưu của “{title}” và nội dung chưa gửi trên máy này. Nhóm sẽ hiện lại khi có người tag bạn. Tin đang gửi có thể đã tới Telegram và không thu hồi được.", { title })}
      busy={purge.isPending} error={purge.isError && t("Không xóa được dữ liệu nhóm. Thử lại.")} onConfirm={() => purge.mutate()} />
  );
}

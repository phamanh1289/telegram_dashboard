"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/shared/components/ui/dialog";
import { api } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { clearDrafts } from "@/features/telegram/lib/inbox";

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
    onSettled: () => Promise.all([["chats"], ["data"], ["tasks"]].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(); }} title={t("Xóa dữ liệu nhóm?")} confirmLabel={t("Xóa dữ liệu")}
      description={t("Xóa tin đã lưu của “{title}”, nội dung chưa gửi và mọi phiên AI có tin của nhóm này (kể cả phiên trích thêm nhóm khác; phiên đang chạy bị dừng) trên máy này. Nhóm sẽ hiện lại khi có người tag bạn. Tin đang gửi có thể đã tới Telegram và không thu hồi được.", { title })}
      busy={purge.isPending} error={purge.isError && t("Không xóa được dữ liệu nhóm. Thử lại.")} onConfirm={() => purge.mutate()} />
  );
}

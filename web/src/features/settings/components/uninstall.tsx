"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Row } from "@/features/settings/components/parts";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { api, ApiError, errorText, updateStateQuery } from "@/shared/lib/api";
import { tMaybe, useT } from "@/shared/lib/i18n";

/** Packaged installs only (a git checkout is the user's own folder): the server logs Telegram out, stops, and a detached
 *  shell deletes the install, its data and launchers once it has exited (backend uninstall.py). */
export function UninstallRow() {
  const t = useT();
  const packaged = useQuery({ ...updateStateQuery, retry: false }).data?.packaged;
  const [ask, setAsk] = useState(false);
  const run = useMutation({
    mutationFn: () => api<{ telegram: boolean }>("/uninstall", { method: "POST", json: { confirm: "uninstall" } }),
  });
  if (!packaged) return null;
  const items = [
    { id: "tg", label: t("Phiên đăng nhập Telegram (đăng xuất khỏi Telegram)") },
    { id: "data", label: t("Dữ liệu: tin đã lưu, nháp, quy tắc, phiên AI, cài đặt, log") },
    { id: "app", label: t("App Radar, lệnh myradar, shortcut") },
    { id: "token", label: t("Mã mở khóa API (~/.telegram_dashboard)") },
  ];
  return <>
    <Row label={t("Gỡ bỏ ứng dụng")} desc={t("Xóa Radar và toàn bộ dữ liệu của nó khỏi máy này, đăng xuất phiên Telegram. Không hoàn tác được.")}>
      <Button variant="destructive" size="sm" onClick={() => { run.reset(); setAsk(true); }}><Trash2 aria-hidden />{t("Gỡ bỏ ứng dụng")}</Button>
    </Row>
    <ConfirmDialog open={ask && !run.isSuccess} onOpenChange={setAsk} title={t("Gỡ bỏ Radar khỏi máy này?")}
      description={t("Xóa vĩnh viễn những mục dưới đây, không khôi phục được. Muốn cài lại mà giữ dữ liệu thì chép thư mục data ra chỗ khác trước. AI CLI (Claude Code, Codex, Antigravity) và gói npm cài global không bị đụng tới.")}
      items={items} confirmLabel={run.isPending ? t("Đang gỡ…") : t("Gỡ bỏ")} busy={run.isPending}
      error={run.isError ? (run.error instanceof ApiError && run.error.detail ? tMaybe(run.error.detail) : errorText(run.error, {}, t("Không gỡ được, thử lại."))) : undefined} onConfirm={() => run.mutate()} />
    {/* the server is gone: nothing on this page works any more, so this stays up */}
    <Dialog open={run.isSuccess}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <div className="flex gap-3.5">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-ok-wash text-ok [&_svg]:size-5"><CircleCheck /></span>
          <DialogHeader className="min-w-0 flex-1 pt-0.5">
            <DialogTitle className="pr-0">{t("Đã gỡ Radar")}</DialogTitle>
            <DialogDescription>
              {t("Server đã tắt và đang xóa file. Đóng tab này; macOS: đóng luôn cửa sổ Terminal của server.")}
              {run.data && !run.data.telegram && <> {t("Chưa đăng xuất được Telegram: vào app Telegram › Settings › Devices, kết thúc phiên của Radar.")}</>}
            </DialogDescription>
          </DialogHeader>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

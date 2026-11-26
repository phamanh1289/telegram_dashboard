"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Segmented } from "@/shared/components/ui/segmented";
import { api, errorText, statusQuery } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";

const DAYS = [1, 3, 7, 14, 30] as const; // backend caps at bridge.BACKFILL_MAX

/** After a fresh sign-in the first tag scan waits (status detail "backfill_choice") until this says how far back it
 *  reads. Mounted by the inbox and by Cài đặt › Tài khoản Telegram (both sign-in places); no dismiss: one click starts. */
export function ScanPicker() {
  const t = useT();
  const qc = useQueryClient();
  const asking = useQuery({ ...statusQuery, staleTime: Infinity, select: (s) => s.state === "connected" && s.detail === "backfill_choice" }).data ?? false;
  const [days, setDays] = useState<number>(14);
  const start = useRef<HTMLButtonElement>(null); // first focus: not the 1-day chip, whose ring reads as a second pick
  const scan = useMutation({
    mutationFn: () => api("/telegram/scan", { method: "POST", json: { days } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["status"] }),
  });
  return (
    <Dialog open={asking}>
      <DialogContent showCloseButton={false} initialFocus={start} className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Quét tin tag từ mốc nào?")}</DialogTitle>
          <DialogDescription>{t("App tìm lại các tin tag bạn trong mọi nhóm, tính từ mốc này. Tin tag mới vẫn hiện ngay khi có.")}</DialogDescription>
        </DialogHeader>
        <Segmented id="scan-days" variant="card" label={t("Quét tin tag từ mốc nào?")} value={days} onChange={setDays}
          className="flex flex-wrap" items={DAYS.map((n) => ({ value: n, label: t("{n} ngày", { n }) }))} />
        {scan.isError && <p role="alert" className="text-xs text-error">{errorText(scan.error, {}, t("Không thực hiện được, thử lại."))}</p>}
        <DialogFooter className="border-t-0 bg-transparent pt-0">
          <Button ref={start} aria-busy={scan.isPending} disabled={scan.isPending} onClick={() => scan.mutate()}>
            {scan.isPending ? t("Đang bắt đầu…") : t("Bắt đầu quét")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

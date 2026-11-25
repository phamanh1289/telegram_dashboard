"use client";

import { CalendarCheck, ClipboardList, FlaskConical } from "lucide-react";
import { useT } from "@/shared/lib/i18n";
import { saveYtRole, YT_ROLES, type YtRole } from "@/shared/lib/prefs";

const ROLE_ICON: Record<YtRole, typeof CalendarCheck> = { dev: CalendarCheck, qa: FlaskConical, po: ClipboardList };

/** No role yet (first visit, or after "Bỏ chọn vai trò"): Telegram and YouTrack ask which role the app works for, before anything loads. */
export function RolePicker() {
  const t = useT();
  return (
    <main className="grid place-items-center px-4 py-10">
      <div className="grid w-full max-w-3xl gap-5">
        <div className="grid gap-1 text-center">
          <h1 className="text-xl font-bold">{t("Bạn làm vai trò nào?")}</h1>
          <p className="text-sm text-ink-2">{t("Trang chủ YouTrack, Dashboard, cách AI tóm tắt / soạn câu hỏi và gợi ý của Trợ lý biết tuốt sẽ theo vai trò này; tính năng đọc code (AI Agent) chỉ có với Dev. Đổi bất cứ lúc nào trong Cài đặt › Chung.")}</p>
        </div>
        <div role="radiogroup" aria-label={t("Vai trò")} className="grid gap-3 sm:grid-cols-3">
          {YT_ROLES.map(([r, name, what]) => {
            const Icon = ROLE_ICON[r];
            return (
              <button key={r} type="button" role="radio" aria-checked={false} onClick={() => saveYtRole(r)}
                className="grid content-start justify-items-start gap-2 rounded-[var(--radius-card)] border border-rule bg-cotton p-4 text-left shadow-stock transition-colors duration-(--dur-micro) hover:border-hl hover:bg-hl-wash">
                <span className="grid size-9 place-items-center rounded-full bg-hl-wash text-hl-2"><Icon className="size-5" aria-hidden /></span>
                <b className="text-base">{t(name)}</b>
                <span className="text-sm text-ink-2">{t(what)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

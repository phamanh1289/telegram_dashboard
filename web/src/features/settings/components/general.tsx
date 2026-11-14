"use client";

import { Check } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Card, picked, quietBtn, Row } from "@/features/settings/components/parts";
import { Segmented } from "@/shared/components/ui/segmented";
import { Textarea } from "@/shared/components/ui/textarea";
import { type Key, type Lang, saveLang, useT } from "@/shared/lib/i18n";
import { getPref, INTRO_MAX, onPrefs, PLATFORMS, readIntro, readPlatform, readYtRole, saveYtRole, setPref, YT_ROLES, type YtRole } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

/** Only what every module reads: who you are (role, platform, intro for the AI) and the language. */
export function GeneralGroup() {
  const t = useT();
  // Live: the top bar's language button changes it too.
  const lang = useSyncExternalStore(onPrefs, () => (getPref("lang") as Lang | null) ?? "system", () => "system" as const);
  const [platform, setPlatform] = useState(readPlatform);
  return <>
    <Card title="Vai trò" info="Telegram và YouTrack theo vai trò này: trang chủ, Dashboard, góc nhìn của AI khi tóm tắt và tạo ticket. QA, PO không dùng AI Agent nên không cần thư mục code.">
      <RoleSection />
    </Card>
    <Card title="Ngôn ngữ">
      <Row label={<span className="font-normal text-ink-3">{t("Theo máy: Tiếng Việt khi máy dùng tiếng Việt, còn lại English.")}</span>}>
        <Segmented id="set-lang" variant="card" label={t("Ngôn ngữ")} value={lang} onChange={(v) => saveLang(v === "system" ? null : v)}
          items={[{ value: "system", label: t("Theo máy") }, { value: "vi", label: "Tiếng Việt" }, { value: "en", label: "English" }]} />
      </Row>
    </Card>
    <Card title="Giới thiệu bản thân cho AI" info="AI phía Telegram (tóm tắt, soạn nháp, Briefing, tạo ticket từ tin, Đối chiếu BE, AI Agent) đọc phần này để biết bạn làm gì, rành gì, cần gì. Chưa có thì AI phải đoán, dễ lan man và lệch chuyên môn. Bên YouTrack dùng Instructions cho AI riêng (Cài đặt › YouTrack). Lưu trên trình duyệt này.">
      <IntroSection />
      <Row label={t("Tóm tắt theo nền tảng")} desc={t("AI tập trung vào phần việc của nền tảng này khi tóm tắt và soạn nháp.")} stack>
        <Segmented id="set-platform" variant="card" label={t("Tóm tắt theo nền tảng")} value={platform} onChange={(v) => { setPlatform(v); setPref("aiPlatform", v); }}
          items={PLATFORMS.map(([value, name]) => ({ value, label: t(name) }))} />
      </Row>
    </Card>
  </>;
}

/** The role (Telegram + YouTrack): pick one, or clear it so the YouTrack page asks again. */
function RoleSection() {
  const t = useT();
  const [role, setRole] = useState(readYtRole);
  const pick = (r: YtRole | null) => { setRole(r); saveYtRole(r); };
  return (
    <div className="grid gap-2.5 pt-1">
      <div role="radiogroup" aria-label={t("Vai trò")} className="grid gap-2 sm:grid-cols-3">
        {YT_ROLES.map(([r, name, what]) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => pick(r)}
            className={cn("grid content-start gap-1 rounded-lg border p-3 text-left", picked(role === r))}>
            <span className="flex items-center justify-between gap-2 text-sm font-bold">
              {t(name)}
              <span aria-hidden className={cn("grid size-4 place-items-center rounded-full border", role === r ? "border-hl bg-hl text-hl-ink" : "border-rule-2")}>
                {role === r && <Check className="size-3" />}
              </span>
            </span>
            <span className="text-xs leading-relaxed text-ink-3">{t(what)}</span>
          </button>
        ))}
      </div>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        {role ? t("Xóa thì trang YouTrack sẽ hỏi lại; Telegram tạm coi như Dev.") : t("Chưa chọn: Telegram coi như Dev, mở YouTrack sẽ hỏi bạn chọn.")}
        {role && <button type="button" className={quietBtn} onClick={() => pick(null)}>{t("Bỏ chọn vai trò")}</button>}
      </span>
    </div>
  );
}

const INTRO_EXAMPLE: Key = "Ví dụ:\nTôi là Android dev (Kotlin, Jetpack Compose, MVVM), team Mobile dự án Bán V2.\nRành: code app, API client. Không rành: BE, Web.\nMuốn AI tập trung: việc phía Android phải làm, câu hỏi cho BE theo từng field.\nBỏ qua phần iOS/Web trừ khi ảnh hưởng tới Android.";

/** Saved as you type (this browser); the counter and the "not written yet" nudge follow it. */
function IntroSection() {
  const t = useT();
  const [text, setText] = useState(readIntro);
  return (
    <div className="grid gap-2 pt-1 pb-3">
      <Textarea aria-label={t("Giới thiệu bản thân cho AI")} rows={5} maxLength={INTRO_MAX} value={text} placeholder={t(INTRO_EXAMPLE)} className="text-sm md:text-sm"
        onChange={(e) => { setText(e.target.value); setPref("aiIntro", e.target.value.trim() ? e.target.value : null); }} />
      <span className="flex items-center justify-between gap-3 text-xs text-ink-3">
        {text.trim() ? <span className="flex items-center gap-1 text-ok"><Check className="size-3.5" aria-hidden /> {t("Đã lưu, AI dùng từ lần chạy kế tiếp")}</span>
          : <span className="text-signal-2">{t("Chưa có: AI phải đoán bạn làm gì.")}</span>}
        <span className="font-mono tabular-nums">{text.length}/{INTRO_MAX}</span>
      </span>
    </div>
  );
}

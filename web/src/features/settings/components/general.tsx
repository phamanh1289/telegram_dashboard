"use client";

import { Apple, Check, Globe, Layers, Monitor, Smartphone, TabletSmartphone } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Card, PickPill, picked, quietBtn, Row } from "@/features/settings/components/parts";
import { Segmented } from "@/shared/components/ui/segmented";
import { Textarea } from "@/shared/components/ui/textarea";
import { CharCount } from "@/shared/components/ui/char-count";
import { type Key, type Lang, saveLang, useT } from "@/shared/lib/i18n";
import { getPref, INTRO_MAX, onPrefs, type Platform, PLATFORMS, readIntro, readPlatform, readYtRole, saveYtRole, setPref, useRole, YT_ROLES, type YtRole } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

const PLATFORM_ICONS: Record<Platform, typeof Globe> = { android: Smartphone, ios: Apple, web: Globe, mobile: TabletSmartphone, any: Layers };
/** A language's chip mark: its code in a small outlined box (one globe on every chip would say nothing). */
const LangTag = ({ children }: { children: string }) => <span aria-hidden className="rounded-sm border border-current px-0.5 text-2xs leading-none font-bold">{children}</span>;

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
          items={[{ value: "system", label: <><Monitor className="size-3.5" aria-hidden />{t("Theo máy")}</> }, { value: "vi", label: <><LangTag>VI</LangTag>Tiếng Việt</> }, { value: "en", label: <><LangTag>EN</LangTag>English</> }]} />
      </Row>
    </Card>
    <Card title="Giới thiệu bản thân cho AI" info="AI phía Telegram (tóm tắt, soạn nháp, Briefing, tạo ticket từ tin, Đối chiếu BE, AI Agent) đọc phần này để biết bạn làm gì, rành gì, cần gì. Chưa có thì AI phải đoán, dễ lan man và lệch chuyên môn. Bên YouTrack dùng Instructions cho AI riêng (Cài đặt › YouTrack). Lưu trên trình duyệt này.">
      <IntroSection platform={platform} />
      <Row label={t("Tóm tắt theo nền tảng")} desc={t("Dev: nền tảng bạn code, AI bỏ phần chỉ liên quan nền tảng khác. QA/QC, PO/PM: chọn Mobile (Android + iOS) hoặc Tất cả, AI báo tình trạng từng nền tảng (xong, chưa test, đang chậm).")} stack>
        <Segmented id="set-platform" variant="card" label={t("Tóm tắt theo nền tảng")} value={platform} onChange={(v) => { setPlatform(v); setPref("aiPlatform", v); }}
          items={PLATFORMS.map(([value, name]) => { const Icon = PLATFORM_ICONS[value]; return { value, label: <><Icon className="size-3.5" aria-hidden />{t(name)}</> }; })} />
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
            <PickPill id="set-role" on={role === r} className="rounded-lg" />
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

// What the AI needs to know, per role (and a dev's platform): the placeholder is the template to fill in.
const INTRO_APP: Key = "Ví dụ:\nTôi là Android dev (Kotlin, Jetpack Compose, MVVM), team Mobile dự án Bán V2.\nRành: code app, API client. Không rành: BE, Web.\nMuốn AI tập trung: việc phía Android phải làm, câu hỏi cho BE theo từng field.\nBỏ qua phần iOS/Web trừ khi ảnh hưởng tới Android.";
const INTRO_WEB: Key = "Ví dụ:\nTôi là FE web (React, Next.js, TypeScript), làm web admin dự án Bán V2.\nRành: UI web, gọi API, state. Không rành: app mobile, BE.\nMuốn AI tập trung: màn web phải làm, trình duyệt / responsive, câu hỏi cho BE theo từng field.\nBỏ qua phần Android/iOS trừ khi ảnh hưởng tới web.";
const INTRO_QA: Key = "Ví dụ:\nTôi là QC dự án Bán V2, test app Android + iOS và web admin.\nMôi trường: build staging qua Firebase / TestFlight; web trên Chrome, Safari.\nThiết bị: Samsung A54 (Android 14), iPhone 13 (iOS 17).\nMuốn AI tập trung: lỗi gặp phải và kết quả đúng, bước tái hiện, môi trường; nền tảng nào lỗi, nền tảng nào chưa test; vùng cần test lại.\nBỏ qua: chi tiết code, tên API / field trừ khi cần ghi vào bug.";
const INTRO_PO: Key = "Ví dụ:\nTôi là PO dự án Bán V2 (app Android, iOS và web admin), phụ trách module Đơn hàng, Thanh toán.\nTôi chốt: phạm vi, ưu tiên, tiêu chí nghiệm thu; khách hàng / BA chốt nghiệp vụ.\nMốc: sprint 2 tuần, release thứ Năm.\nMuốn AI tập trung: việc chờ tôi chốt, ảnh hưởng tới người dùng và doanh thu, deadline, tiến độ từng nền tảng, rủi ro trễ release.\nBỏ qua: chi tiết kỹ thuật, trừ khi làm đổi phạm vi hoặc thời gian.";
const introExample = (role: YtRole | null, platform: Platform): Key =>
  role === "qa" ? INTRO_QA : role === "po" ? INTRO_PO : platform === "web" ? INTRO_WEB : INTRO_APP;

/** Saved as you type (this browser); the counter and the "not written yet" nudge follow it. */
function IntroSection({ platform }: { platform: Platform }) {
  const t = useT();
  const role = useRole();
  const [text, setText] = useState(readIntro);
  return (
    <div className="grid gap-2 pt-1 pb-3">
      <Textarea aria-label={t("Giới thiệu bản thân cho AI")} rows={5} maxLength={INTRO_MAX} value={text} placeholder={t(introExample(role, platform))} className="text-sm md:text-sm"
        onChange={(e) => { setText(e.target.value); setPref("aiIntro", e.target.value.trim() ? e.target.value : null); }} />
      <span className="flex items-center justify-between gap-3 text-xs text-ink-3">
        {text.trim() ? <span className="flex items-center gap-1 text-ok"><Check className="size-3.5" aria-hidden /> {t("Đã lưu, AI dùng từ lần chạy kế tiếp")}</span>
          : <span className="text-signal-2">{t("Chưa có: AI phải đoán bạn làm gì.")}</span>}
        <CharCount n={text.length} max={INTRO_MAX} />
      </span>
    </div>
  );
}

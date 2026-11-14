"use client";

import { Card, Row, Switch, usePrivacy } from "@/features/settings/components/parts";
import { AiAccounts, PrefsSection, useAiPrefs } from "@/shared/components/ai";
import { PROVIDERS } from "@/shared/components/ai/prefs";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { useT } from "@/shared/lib/i18n";
import { saveQuotaAgent, useQuotaAgent } from "@/shared/lib/prefs";

export function AiGroup() {
  const t = useT();
  const { p, used, info } = useAiPrefs();
  const quotaAgent = useQuotaAgent();
  const privacy = usePrivacy();
  return <>
    {p && (
      <Card title="Model và effort" info="Một danh sách gồm model của mọi AI (Claude, Codex, Antigravity): chọn model của AI nào thì việc đó chạy bằng AI ấy, không cần đổi AI trước. Riêng cho Telegram và YouTrack; mỗi AI giữ lựa chọn riêng, áp dụng từ lần chạy kế tiếp. Model mạnh hơn và effort cao hơn thì chậm hơn, tốn hạn mức hơn.">
        <PrefsSection plain />
      </Card>
    )}
    <Card title="Tài khoản" info="Mỗi CLI tự giữ đăng nhập và token trên máy này; trang chỉ đọc ai đang đăng nhập. Chi tiết: hạn mức, usage và lịch sử chạy.">
      <AiAccounts />
      <Row label={t("Hạn mức trên thanh trên cùng")} desc={t("AI có hạn mức (Phiên 5 giờ, 7 ngày) hiện ở góc phải thanh trên cùng. Tự động: AI đang chạy việc hằng ngày ở trang đang mở. Đổi nhanh được ngay trong nút đó.")}>
        <Dropdown label={t("AI hiện hạn mức trên thanh trên cùng")} className="w-44" value={quotaAgent} onChange={saveQuotaAgent}
          options={[{ value: "", label: t("Tự động"), hint: t("Theo trang đang mở") }, ...PROVIDERS.map((id) => ({ value: id, label: info(id)?.name ?? id }))]} />
      </Row>
    </Card>
    <Card title="Quyền riêng tư">
      <p className="py-2 text-xs text-ink-2">
        {t("Tin nhắn của người khác (nhóm Telegram) và nội dung ticket được gửi tới AI của model đang chọn ({ai}) khi bạn dùng tóm tắt, soạn nháp, Briefing, Q&A, YouTrack AI hay AI Agent; nhà cung cấp xử lý theo điều khoản của họ.", { ai: p ? used().map((id) => info(id)?.name ?? id).join(", ") : "Claude" })}
      </p>
      {privacy.p && (
        <Row label={t("Ẩn SĐT / email khi gửi AI")} desc={t("Thay số điện thoại và email trong tin nhắn, ticket, nội dung link bằng [SĐT] / [email] trước khi gửi (nháp, tóm tắt, Briefing, Q&A, YouTrack AI). Lời dặn bạn tự gõ cho AI Agent gửi nguyên văn.")}>
          <Switch label={t("Ẩn SĐT / email khi gửi AI")} checked={privacy.p.redact} disabled={privacy.busy} onChange={(v) => privacy.set({ redact: v })} />
        </Row>
      )}
    </Card>
  </>;
}

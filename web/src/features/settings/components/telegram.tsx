"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { AUTO_BRIEF } from "@/features/telegram/components/briefing-page";
import { RulesSection } from "@/features/telegram/components/tools-menu";
import { Card, linkCls, quietBtn, Row, StatusLine, Switch, tMap, usePrivacy, useStatus } from "@/features/settings/components/parts";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Segmented } from "@/shared/components/ui/segmented";
import { api, errorText } from "@/shared/lib/api";
import { type Key, useT } from "@/shared/lib/i18n";
import { applyRowActions, getPref, onPrefs, OVERDUE_CHOICES, QA_REMIND_CHOICES, qaRemindLabel, readNotify, readOverdueHours, readQaAnswerBy, readRowActions, setPref, useQaRemind } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";

/** Telegram-only preferences: the account, the queue, notifications, Q&A, Briefing, rules, local data. */
export function TelegramGroup() {
  const t = useT();
  const privacy = usePrivacy();
  const [overdue, setOverdue] = useState(readOverdueHours);
  const qaRemind = useQaRemind();
  const qaAnswerBy = useSyncExternalStore(onPrefs, readQaAnswerBy, () => "tagged" as const);
  const [rowActions, setRowActions] = useState(readRowActions);
  const [autoBrief, setAutoBrief] = useState(() => getPref(AUTO_BRIEF) !== "0");
  const [notify, setNotify] = useState(readNotify);
  const [notifyNote, setNotifyNote] = useState("");
  async function toggleNotify(on: boolean) {
    if (on) {
      if (typeof Notification === "undefined") return setNotifyNote(t("Trình duyệt này không hỗ trợ thông báo."));
      const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (p !== "granted") return setNotifyNote(t("Trình duyệt đang chặn thông báo cho trang này; bật lại trong quyền của trang."));
    }
    setNotifyNote("");
    setNotify(on);
    setPref("notify", on ? "1" : "0");
  }

  return <>
    <Card title="Tài khoản Telegram" info="API ID/Hash và phiên đăng nhập chỉ lưu trên máy này (thư mục data/).">
      <TelegramSection />
    </Card>

    <Card title="Hàng chờ">
      <Row label={t("Ngưỡng quá hạn")} desc={t("Tin tag chờ lâu hơn ngưỡng này hiện màu hổ phách.")} stack>
        <Segmented id="set-overdue" variant="card" label={t("Ngưỡng quá hạn")} value={overdue} onChange={(v) => { setOverdue(v); setPref("overdueHours", String(v)); }}
          items={OVERDUE_CHOICES.map((h) => ({ value: h, label: t("{n} giờ", { n: h }) }))} />
      </Row>
      <Row label={t("Nút thao tác trên tin")} desc={t("Hoãn, ngữ cảnh, Đối chiếu BE, đính kèm, chép ID và menu ⋯. Màn hình cảm ứng luôn hiện.")} stack>
        <Segmented id="set-row-actions" variant="card" label={t("Nút thao tác trên tin")} value={rowActions} onChange={(v) => { setRowActions(v); applyRowActions(v); }}
          items={[{ value: "hover", label: t("Khi rê vào nút Xong") }, { value: "always", label: t("Luôn hiện") }]} />
      </Row>
    </Card>

    <Card title="Thông báo">
      <Row label={t("Thông báo khi có tag mới")} desc={notifyNote ? <span role="alert" className="text-warn">{notifyNote}</span> : t("Khi tab đang ẩn: tag mới, và câu hỏi Q&A của bạn quá ngưỡng nhắc mà chưa ai trả lời. Giữ luồng cập nhật chạy nền.")}>
        <Switch label={t("Thông báo khi có tag mới")} checked={notify} onChange={(v) => void toggleNotify(v)} />
      </Row>
      {privacy.p && (
        <Row label={t("Hiện nội dung tin trong thông báo macOS")} desc={t("Banner macOS khi có tag mới hoặc ticket YouTrack mới giao cho bạn (cả trên màn hình khóa, Notification Center). Tắt: chỉ hiện nhóm và người gửi / mã ticket.")}>
          <Switch label={t("Hiện nội dung tin trong thông báo macOS")} checked={privacy.p.notify_preview} disabled={privacy.busy} onChange={(v) => privacy.set({ notify_preview: v })} />
        </Row>
      )}
    </Card>

    <Card title="Q&A">
      <Row label={t("Nhắc câu hỏi Q&A chưa ai trả lời")} desc={t("Câu hỏi bạn đăng ở Q&A mà chưa ai trả lời sau khoảng này (tính từ tin cuối của bạn trong chuỗi): trang Q&A báo và cho nhắc lại ngay trong nhóm. Đổi nhanh được ở trang Q&A.")} stack>
        <Segmented id="set-qa-remind" variant="card" label={t("Nhắc câu hỏi Q&A chưa ai trả lời")} value={qaRemind} onChange={(v) => setPref("qaRemindMins", String(v))}
          items={QA_REMIND_CHOICES.map((m) => ({ value: m, label: qaRemindLabel(m) }))} />
      </Row>
      <Row label={t("Câu hỏi Q&A tính là đã trả lời khi")} desc={t("“Người được tag”: chỉ khi chính người câu hỏi tag (@tên) trả lời; câu không tag ai thì ai trả lời cũng tính. Chốt câu trả lời thì luôn tính là xong.")} stack>
        <Segmented id="set-qa-answer-by" variant="card" label={t("Câu hỏi Q&A tính là đã trả lời khi")} value={qaAnswerBy} onChange={(v) => setPref("qaAnswerBy", v)}
          items={[{ value: "any", label: t("Bất kỳ ai khác trả lời") }, { value: "tagged", label: t("Người được tag trả lời") }]} />
      </Row>
    </Card>

    <Card title="Briefing">
      <Row label={t("Tự tóm tắt Briefing")} desc={t("Khi app đang mở, nhóm có tin mới được tóm tắt nền tối đa 2 giờ một lần, mở Briefing là có sẵn. Tắt: chỉ tóm tắt khi bạn bấm.")}>
        <Switch label={t("Tự tóm tắt Briefing")} checked={autoBrief} onChange={(v) => { setAutoBrief(v); setPref(AUTO_BRIEF, v ? null : "0"); }} />
      </Row>
    </Card>

    <Card advanced title="Luôn bỏ qua" info="Người gửi (thêm bằng ô Tên người gửi ở đây, hoặc “Luôn bỏ qua …” trong menu Hoãn của một tin) và từ khóa: tag khớp tự sang Đã xử lý, không báo; tin của người gửi trong danh sách không vào tóm tắt Briefing / Digest. Bấm × trên chip để nhận thông báo lại; tag đã dọn trước đó không tự mở lại.">
      <RulesSection />
    </Card>

  </>;
}

const TG_ERRORS: Record<string, Key> = {
  phone_invalid: "Số điện thoại không hợp lệ (ghi kèm mã nước, vd. +84…).",
  api_invalid: "API ID/Hash sai, kiểm tra lại trên my.telegram.org.",
  code_invalid: "Mã không đúng.",
  code_expired: "Mã đã hết hạn, gửi lại mã mới.",
  code_not_sent: "Gửi mã trước đã.",
  password_invalid: "Mật khẩu 2FA không đúng.",
  flood_wait: "Telegram tạm chặn vì thử nhiều lần, đợi một lúc rồi thử lại.",
  telegram_not_configured: "Lưu API ID/Hash trước.",
};

/** API ID/Hash from my.telegram.org, then phone → code → 2FA: the whole Telegram setup without .env or a terminal. */
function TelegramSection() {
  const t = useT();
  const qc = useQueryClient();
  const status = useStatus().data;
  const [editApi, setEditApi] = useState(false);
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "password">("phone");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["status"] });
  const saveApi = useMutation({
    mutationFn: () => api("/telegram/app", { method: "PUT", json: { api_id: Number(apiId), api_hash: apiHash.trim().toLowerCase() } }),
    onSuccess: () => { setEditApi(false); setApiHash(""); setStep("phone"); refresh(); },
  });
  const sendCode = useMutation({
    mutationFn: () => api("/telegram/code", { method: "POST", json: { phone: phone.trim() } }),
    onSuccess: () => { setCode(""); setStep("code"); },
  });
  const signIn = useMutation({
    mutationFn: () => api<{ password_required: boolean }>("/telegram/sign-in", { method: "POST", json: step === "password" ? { password } : { code: code.trim() } }),
    onSuccess: (r) => { if (r.password_required) setStep("password"); else { setPassword(""); refresh(); } },
  });
  if (!status) return <div className="pt-1"><StatusLine tone="idle">{t("Đang kiểm tra…")}</StatusLine></div>;
  const err = saveApi.error ?? sendCode.error ?? signIn.error;
  const errLine = err && <p role="alert" className="text-xs text-error">{errorText(err, tMap(t, TG_ERRORS), t("Không thực hiện được, thử lại."))}</p>;

  if (editApi || !status.telegram_api_id) {
    return (
      <form className="grid gap-2.5 pt-1" onSubmit={(e) => { e.preventDefault(); saveApi.mutate(); }}>
        <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className={linkCls}>
          {t("Lấy API ID/Hash tại my.telegram.org → API development tools")} <ExternalLink className="size-3" aria-hidden />
        </a>
        <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Input aria-label="API ID" placeholder="API ID" inputMode="numeric" maxLength={12}
            value={apiId} onChange={(e) => setApiId(e.target.value.replace(/\D/g, ""))} />
          <Input aria-label="API Hash" type="password" autoComplete="off" placeholder={t("API Hash (32 ký tự)")} maxLength={32}
            value={apiHash} onChange={(e) => setApiHash(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" aria-busy={saveApi.isPending} disabled={saveApi.isPending || !apiId || !/^[0-9a-fA-F]{32}$/.test(apiHash.trim())}>
            {saveApi.isPending ? t("Đang lưu…") : t("Lưu")}
          </Button>
          {editApi && <Button type="button" size="sm" variant="ghost" onClick={() => setEditApi(false)}>{t("Hủy")}</Button>}
        </div>
        {errLine}
      </form>
    );
  }

  const changeApi = <button type="button" className={quietBtn} onClick={() => { setApiId(String(status.telegram_api_id)); setEditApi(true); }}>{t("Đổi API ID/Hash")}</button>;
  if (status.state === "degraded") {
    return (
      <div className="grid gap-1.5 pt-1">
        <StatusLine tone="warn">{t("Không kết nối được tới Telegram")}{status.detail ? ` (${status.detail})` : ""}</StatusLine>
        <p className="text-xs text-ink-3">{t("Mạng có thể đang chặn Telegram: bật VPN, app sẽ tự thử lại.")}</p>
        {changeApi}
      </div>
    );
  }
  if (status.state !== "login_required") {
    const ok = status.state === "connected";
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <StatusLine tone={ok ? "ok" : "idle"}>{ok ? <>{t("Đã đăng nhập")}{status.telegram_me && <b className="ml-1 font-bold">{status.telegram_me}</b>}</> : t("Đang kết nối Telegram…")}</StatusLine>
        {changeApi}
      </div>
    );
  }
  return (
    <form className="grid gap-2.5 pt-1" onSubmit={(e) => { e.preventDefault(); if (step === "phone") sendCode.mutate(); else signIn.mutate(); }}>
      <StatusLine tone="warn">{t("Chưa đăng nhập Telegram")}</StatusLine>
      <ol aria-label={t("Các bước đăng nhập")} className="flex gap-1.5 text-xs text-ink-3">
        {(["phone", "code", "password"] as const).map((s, i) => (
          <li key={s} className={cn("rounded-full px-2 py-0.5", step === s ? "bg-hl-wash font-medium text-hl-2" : "bg-paper-2")}>{i + 1}. {{ phone: t("Số điện thoại"), code: t("Mã"), password: "2FA" }[s]}</li>
        ))}
      </ol>
      {step === "phone" ? (
        <div className="flex gap-2">
          <Input aria-label={t("Số điện thoại")} type="tel" autoComplete="tel" placeholder="+84 9xx xxx xxx" maxLength={20}
            value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button type="submit" variant="outline" aria-busy={sendCode.isPending} disabled={sendCode.isPending || !/^\+?[0-9 ]{6,20}$/.test(phone.trim())}>
            {sendCode.isPending ? t("Đang gửi…") : t("Gửi mã")}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {step === "code"
            ? <Input aria-label={t("Mã đăng nhập")} inputMode="numeric" autoComplete="one-time-code" placeholder={t("Mã Telegram vừa gửi")} maxLength={8} autoFocus
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            : <Input aria-label={t("Mật khẩu 2FA")} type="password" autoComplete="current-password" placeholder={t("Mật khẩu 2FA")} maxLength={256} autoFocus
                value={password} onChange={(e) => setPassword(e.target.value)} />}
          <Button type="submit" variant="outline" aria-busy={signIn.isPending} disabled={signIn.isPending || (step === "code" ? code.length < 3 : !password)}>
            {signIn.isPending ? t("Đang đăng nhập…") : t("Đăng nhập")}
          </Button>
        </div>
      )}
      {step !== "phone" && <button type="button" className={quietBtn} onClick={() => { signIn.reset(); setStep("phone"); }}>{t("Đổi số / gửi lại mã")}</button>}
      {step === "phone" && changeApi}
      {errLine}
    </form>
  );
}

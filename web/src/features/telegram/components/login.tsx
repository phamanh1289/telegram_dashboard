"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, RotateCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { linkCls, quietBtn, StatusLine, tMap, useStatus } from "@/features/settings/components/parts";
import { TopBar } from "@/app/_components/shell";
import { LoginStage, type Mood } from "@/shared/components/login-stage";
import { Button } from "@/shared/components/ui/button";
import { CodeInput } from "@/shared/components/ui/code-input";
import { Input, SecretInput } from "@/shared/components/ui/input";
import { api, errorText } from "@/shared/lib/api";
import type { components } from "@/shared/lib/api.generated";
import { type Key, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

type CodeSent = components["schemas"]["TelegramCodeSent"];
type Step = "api" | "phone" | "code" | "password";

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
export const HAPPY_MS = 1200; // the mascot waves before the tab swaps the card for what comes next (App holds it)
const STEP_FADE = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.18 } };

/** API ID/Hash from my.telegram.org, then phone → code → 2FA: the whole Telegram setup without .env or a terminal.
 *  The Telegram tab shows it alone before login (with `onMood` driving its mascot); Cài đặt shows it to switch accounts. */
export function TelegramLogin({ onMood, onDone }: { onMood?: (m: Mood) => void; onDone?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const sq = useStatus();
  const status = sq.data;
  const [editApi, setEditApi] = useState(false);
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "password">("phone");
  const [done, setDone] = useState(false); // tab only: signed in, the card says so while the mascot waves (Cài đặt follows status)
  const [shown, setShown] = useState(false); // the secret field's eye: the mascot peeks instead of covering its eyes
  const mood = (m: Mood) => onMood?.(m);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["status"] });
  const busy = { onMutate: () => mood("busy"), onError: () => mood("no") };
  const saveApi = useMutation({
    mutationFn: () => api("/telegram/app", { method: "PUT", json: { api_id: Number(apiId), api_hash: apiHash.trim().toLowerCase() } }),
    ...busy,
    onSuccess: () => { setEditApi(false); setApiHash(""); setStep("phone"); setShown(false); mood("idle"); refresh(); },
  });
  const sendCode = useMutation({
    mutationFn: () => api<CodeSent>("/telegram/code", { method: "POST", json: { phone: phone.trim() } }),
    ...busy,
    onSuccess: () => { setCode(""); setStep("code"); mood("idle"); },
  });
  const signIn = useMutation({
    mutationFn: (typed?: string) => api<{ password_required: boolean }>("/telegram/sign-in", { method: "POST", json: step === "password" ? { password } : { code: (typed ?? code).trim() } }),
    ...busy,
    onSuccess: (r) => {
      if (r.password_required) { setShown(false); setStep("password"); mood("idle"); return; }
      setPassword("");
      if (onMood) { setDone(true); mood("happy"); }
      onDone?.(); // the tab keeps this card up for HAPPY_MS, however soon the status read says connected
      refresh();
    },
  });
  // the eyes: shut while a secret field has focus, half open while its eye shows the text
  const secret = {
    onFocus: () => mood(shown ? "peek" : "shy"),
    onBlur: () => mood("idle"),
    onReveal: (on: boolean) => { setShown(on); mood(on ? "peek" : "shy"); },
  };
  if (!status) return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {sq.isError ? <StatusLine tone="error">{errorText(sq.error, {}, t("Không đọc được trạng thái Telegram."))}</StatusLine>
        : <StatusLine tone="idle">{t("Đang kiểm tra…")}</StatusLine>}
      {sq.isError && <Button size="xs" variant="outline" aria-busy={sq.isFetching} disabled={sq.isFetching} onClick={() => void sq.refetch()}><RotateCw /> {t("Thử lại")}</Button>}
    </div>
  );
  const err = saveApi.error ?? sendCode.error ?? signIn.error;
  const errLine = err && <p role="alert" className="text-xs text-error">{errorText(err, tMap(t, TG_ERRORS), t("Không thực hiện được, thử lại."))}</p>;

  if (editApi || !status.telegram_api_id) {
    return (
      <form className="grid gap-2.5 pt-1" onSubmit={(e) => { e.preventDefault(); saveApi.mutate(); }}>
        <Steps at="api" />
        <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className={linkCls}>
          {t("Lấy API ID/Hash tại my.telegram.org → API development tools")} <ExternalLink className="size-3" aria-hidden />
        </a>
        <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Input aria-label="API ID" placeholder="API ID" inputMode="numeric" maxLength={12}
            value={apiId} onChange={(e) => setApiId(e.target.value.replace(/\D/g, ""))} />
          <SecretInput aria-label="API Hash" autoComplete="off" placeholder={t("API Hash (32 ký tự)")} maxLength={32}
            value={apiHash} onChange={(e) => setApiHash(e.target.value)} {...secret} />
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
  if (status.state !== "login_required" || done) {
    const ok = status.state === "connected" || done;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <StatusLine tone={ok ? "ok" : "idle"}>{ok ? <>{t("Đã đăng nhập")}{status.telegram_me && <b className="ml-1 font-bold">{status.telegram_me}</b>}</> : t("Đang kết nối Telegram…")}</StatusLine>
        {changeApi}
      </div>
    );
  }
  const via = sendCode.data?.via;
  return (
    <form className="grid gap-2.5 pt-1" onSubmit={(e) => { e.preventDefault(); if (step === "phone") sendCode.mutate(); else signIn.mutate(undefined); }}>
      <StatusLine tone="warn">{t("Chưa đăng nhập Telegram")}</StatusLine>
      <Steps at={step} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} {...STEP_FADE} className="grid gap-2">
          {step === "phone" && (
            <div className="flex gap-2">
              <Input aria-label={t("Số điện thoại")} type="tel" autoComplete="tel" placeholder="+84 9xx xxx xxx" maxLength={20}
                value={phone} onChange={(e) => setPhone(e.target.value)} />
              <Button type="submit" variant="outline" aria-busy={sendCode.isPending} disabled={sendCode.isPending || !/^\+?[0-9 ]{6,20}$/.test(phone.trim())}>
                {sendCode.isPending ? t("Đang gửi…") : t("Gửi mã")}
              </Button>
            </div>
          )}
          {step === "code" && <>
            {via === "app" && <p className="text-xs text-ink-2">{t("Mã gửi vào app Telegram trên điện thoại / máy khác (không phải SMS)")}</p>}
            {via === "sms" && <p className="text-xs text-ink-2">{t("Mã gửi qua SMS")}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <CodeInput label={t("Mã đăng nhập")} length={sendCode.data?.length} autoFocus value={code} onChange={setCode}
                onComplete={(v) => !signIn.isPending && signIn.mutate(v)} />
              <Button type="submit" variant="outline" aria-busy={signIn.isPending} disabled={signIn.isPending || code.length < 3}>
                {signIn.isPending ? t("Đang đăng nhập…") : t("Đăng nhập")}
              </Button>
            </div>
          </>}
          {step === "password" && (
            <div className="flex gap-2">
              <SecretInput aria-label={t("Mật khẩu 2FA")} autoComplete="current-password" placeholder={t("Mật khẩu 2FA")} maxLength={256} autoFocus
                value={password} onChange={(e) => setPassword(e.target.value)} {...secret} />
              <Button type="submit" variant="outline" aria-busy={signIn.isPending} disabled={signIn.isPending || !password}>
                {signIn.isPending ? t("Đang đăng nhập…") : t("Đăng nhập")}
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {step !== "phone" && <button type="button" className={quietBtn} onClick={() => { signIn.reset(); setShown(false); setStep("phone"); mood("idle"); }}>{t("Đổi số / gửi lại mã")}</button>}
      {step === "phone" && changeApi}
      {errLine}
    </form>
  );
}

/** The Telegram tab before login: the sign-in card alone, its mascot following what is typed. */
export function TelegramLoginPage({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const [mood, setMood] = useState<Mood>("idle");
  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <div className="sticky top-0 z-30"><TopBar module="telegram" /></div>
      <LoginStage mood={mood} title={t("Kết nối Telegram")} sub={t("Đăng nhập một lần, phiên chỉ lưu trên máy này.")}>
        <TelegramLogin onMood={setMood} onDone={onDone} />
      </LoginStage>
    </div>
  );
}

/** API → Số điện thoại → Mã (→ 2FA, only once Telegram asks for it): done steps get a tick, the current one the wash. */
function Steps({ at }: { at: Step }) {
  const t = useT();
  const order: Step[] = ["api", "phone", "code", "password"];
  const label: Record<Step, string> = { api: "API", phone: t("Số điện thoại"), code: t("Mã"), password: "2FA" };
  const now = order.indexOf(at);
  return (
    <ol aria-label={t("Các bước đăng nhập")} className="flex flex-wrap gap-1.5 text-xs text-ink-3">
      <AnimatePresence initial={false}>
        {order.filter((s) => s !== "password" || at === "password").map((s, i) => (
          <motion.li key={s} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            aria-current={i === now ? "step" : undefined}
            className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors duration-(--dur-short)",
              i === now ? "bg-hl-wash font-medium text-hl-2" : i < now ? "bg-ok-wash text-ok" : "bg-paper-2")}>
            {i < now ? <Check className="size-3" aria-hidden /> : <span>{i + 1}.</span>}{label[s]}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

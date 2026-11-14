"use client";

import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { api, ApiError } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";

/** Shown when the local API answers `auth_required` (auth.py): this browser has no token cookie yet. */
export function AuthGate() {
  const t = useT();
  const [token, setToken] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth", { method: "POST", json: { token: token.trim() } });
      location.reload();
    } catch (err) {
      setBad(err instanceof ApiError && err.code === "auth_invalid");
      setBusy(false);
    }
  };
  return (
    <div role="dialog" aria-modal aria-labelledby="auth-gate-title" className="fixed inset-0 z-[100] grid place-items-center bg-paper/95 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="grid w-full max-w-md gap-3 rounded-lg bg-cotton p-5 text-sm text-ink shadow-pop">
        <h1 id="auth-gate-title" className="flex items-center gap-2 text-base font-bold text-ink"><LockKeyhole className="size-4 text-hl" aria-hidden /> {t("Trình duyệt này chưa được mở khóa")}</h1>
        <p className="text-ink-2">
          {t("Để chương trình khác trên máy (kể cả AI agent) không gọi được dashboard thay bạn, mỗi trình duyệt cần mở app một lần bằng link có mã.")}{" "}
          {t.n("Mở lại bằng {app}, hoặc gõ {installed} (bản cài) / {git} (bản git).", {
            app: <b>Start Dashboard</b>,
            installed: <code className="font-mono text-xs">myradar open</code>,
            git: <code className="font-mono text-xs">uv run python -m telegram_dashboard open</code>,
          })}
        </p>
        <label className="grid gap-1.5 text-ink-2">
          {t.n("Hoặc dán mã trong file {file}:", { file: <code className="font-mono text-xs">~/.telegram_dashboard/api_token</code> })}
          <Input value={token} onChange={(e) => { setToken(e.target.value); setBad(false); }} autoComplete="off" spellCheck={false} aria-invalid={bad || undefined} className="font-mono" />
        </label>
        {bad && <p role="alert" className="text-xs text-error">{t("Mã không đúng.")}</p>}
        <Button type="submit" size="sm" className="justify-self-end" disabled={!token.trim() || busy}>{t("Mở khóa")}</Button>
      </form>
    </div>
  );
}

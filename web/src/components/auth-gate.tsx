"use client";

import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** Shown when the local API answers `auth_required` (auth.py): this browser has no token cookie yet. */
export function AuthGate() {
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
        <h1 id="auth-gate-title" className="flex items-center gap-2 text-base font-semibold text-ink"><LockKeyhole className="size-4 text-hl" aria-hidden /> Trình duyệt này chưa được mở khóa</h1>
        <p className="text-ink-2">
          Để chương trình khác trên máy (kể cả AI agent) không gọi được dashboard thay bạn, mỗi trình duyệt cần mở app một lần bằng link có mã.
          Mở lại bằng <b>Start Dashboard</b>, hoặc gõ <code className="font-mono text-xs">mydashboard open</code> (bản cài) /{" "}
          <code className="font-mono text-xs">uv run python -m telegram_dashboard open</code> (bản git).
        </p>
        <label className="grid gap-1.5 text-ink-2">
          Hoặc dán mã trong file <code className="font-mono text-xs">~/.telegram_dashboard/api_token</code>:
          <Input value={token} onChange={(e) => { setToken(e.target.value); setBad(false); }} autoComplete="off" spellCheck={false} aria-invalid={bad || undefined} className="font-mono" />
        </label>
        {bad && <p role="alert" className="text-xs text-error">Mã không đúng.</p>}
        <Button type="submit" size="sm" className="justify-self-end" disabled={!token.trim() || busy}>Mở khóa</Button>
      </form>
    </div>
  );
}

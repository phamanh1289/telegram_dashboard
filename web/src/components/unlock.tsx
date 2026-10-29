"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

export function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/unlock", { method: "POST", json: { code } });
      setCode("");
      onUnlocked();
    } catch (err) {
      if (err instanceof ApiError && err.code === "rate_limited")
        setError(`Thử quá nhiều lần, chờ ${err.retryAfter ?? 60} giây.`);
      else if (err instanceof ApiError && err.code === "invalid_origin")
        setError("Hãy mở bằng http://127.0.0.1 (không dùng localhost).");
      else setError("Mã không đúng.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} className="grid w-full max-w-sm gap-3 rounded-xl border p-6">
        <h1 className="text-lg font-semibold">Mở khóa dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Nhập mã mở khóa in ở terminal khi chạy server.
        </p>
        <Input
          aria-label="Mã mở khóa"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !code}>
          Mở khóa
        </Button>
      </form>
    </main>
  );
}

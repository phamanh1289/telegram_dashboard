"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RotateCw } from "lucide-react";
import { useState } from "react";
import { linkCls, StatusLine, tMap } from "@/features/settings/components/parts";
import { yt } from "@/features/youtrack/lib/yt";
import { TopBar } from "@/app/_components/shell";
import { LoginStage, type Mood } from "@/shared/components/login-stage";
import { Button } from "@/shared/components/ui/button";
import { Input, SecretInput } from "@/shared/components/ui/input";
import { api, errorText } from "@/shared/lib/api";
import { type Key, useT } from "@/shared/lib/i18n";

const YT_ERRORS: Record<string, Key> = {
  youtrack_unauthorized: "Token sai, đã thu hồi hoặc không đủ quyền.",
  youtrack_unreachable: "Không kết nối được YouTrack ở URL này.",
};

const HAPPY_MS = 1200; // the mascot waves before the tab swaps the card for the tickets

/** Paste a permanent token (made on the YouTrack profile page); the server checks it before keeping it. Connected: the form
 *  folds away. The YouTrack tab shows it alone while there is no token (with `onMood` driving its mascot); Cài đặt shows
 *  it to switch URL / token. */
export function YtConnect({ onMood }: { onMood?: (m: Mood) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["yt", "config"], queryFn: yt.config, staleTime: Infinity });
  const [shown, setShown] = useState(false); // the token's eye: the mascot peeks instead of covering its eyes
  const mood = (m: Mood) => onMood?.(m);
  const [url, setUrl] = useState<string | null>(null); // null: still showing the server's URL
  const [token, setToken] = useState("");
  const [edit, setEdit] = useState(false);
  const base = (url ?? cfg.data?.base ?? "").trim().replace(/\/+$/, "");
  const save = useMutation({
    mutationFn: () => api<{ login: string; name: string }>("/youtrack/auth", { method: "PUT", json: { url: base, token: token.trim() } }),
    onMutate: () => mood("busy"),
    onError: () => mood("no"),
    onSuccess: () => {
      setToken("");
      setEdit(false);
      const swap = () => {
        void qc.invalidateQueries({ queryKey: ["status"] });
        // projects/me/issues of the old token (or sample data) are cached forever; config is watched, so it reloads in place
        qc.removeQueries({ queryKey: ["yt"], predicate: (q) => q.queryKey[1] !== "config" });
        void qc.invalidateQueries({ queryKey: ["yt", "config"] });
      };
      if (!onMood) return swap();
      mood("happy");
      setTimeout(swap, HAPPY_MS);
    },
  });
  if (!cfg.data) return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <StatusLine tone={cfg.isError ? "error" : "idle"}>{cfg.isError ? errorText(cfg.error, {}, t("Không đọc được cấu hình YouTrack")) : t("Đang kiểm tra…")}</StatusLine>
      {cfg.isError && <Button size="xs" variant="outline" aria-busy={cfg.isFetching} disabled={cfg.isFetching} onClick={() => void cfg.refetch()}><RotateCw /> {t("Thử lại")}</Button>}
    </div>
  );
  const live = !cfg.data.mock;
  const validUrl = /^https?:\/\/\S+$/.test(base);
  return (
    <div className="grid gap-2.5 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusLine tone={live ? "ok" : "warn"}>
          {save.isSuccess ? (onMood ? t("Xin chào {name}", { name: save.data.name }) : <>{t("Đã kết nối:")} <b className="font-bold">{save.data.name}</b></>) : live ? <>{t("Đang dùng")} <span className="font-mono text-xs">{cfg.data.base}</span></> : t("Chưa kết nối YouTrack")}
        </StatusLine>
        {live && !edit && <Button size="sm" variant="outline" onClick={() => setEdit(true)}>{t("Đổi URL / token")}</Button>}
      </div>
      {(!live || edit) && (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Input aria-label="URL YouTrack" placeholder="https://youtrack.example.com" inputMode="url" maxLength={200}
            value={url ?? cfg.data.base} onChange={(e) => setUrl(e.target.value)} />
          <div className="flex gap-2">
            <SecretInput aria-label={t("Token YouTrack")} autoComplete="off" placeholder={cfg.data.hint ?? "perm-…"} maxLength={500}
              value={token} onChange={(e) => setToken(e.target.value)} onFocus={() => mood(shown ? "peek" : "shy")} onBlur={() => mood("idle")}
              onReveal={(on) => { setShown(on); mood(on ? "peek" : "shy"); }} />
            <Button type="submit" aria-busy={save.isPending} disabled={save.isPending || !validUrl || token.trim().length < 8}>
              {save.isPending ? t("Đang kiểm tra…") : cfg.data.hint ? t("Cập nhật") : t("Lưu")}
            </Button>
            {edit && <Button type="button" variant="ghost" onClick={() => setEdit(false)}>{t("Hủy")}</Button>}
          </div>
          <ol className="grid list-decimal gap-1 pl-4 text-xs text-ink-2">
            <li>{validUrl
              ? <a href={`${base}/users/me?tab=account-security`} target="_blank" rel="noreferrer" className={linkCls}>
                  {t("Tạo token trên YouTrack (Hồ sơ → Account Security → New token)")} <ExternalLink className="size-3" aria-hidden />
                </a>
              : t("Nhập URL YouTrack ở trên, link mở trang tạo token sẽ hiện ở đây")}</li>
            <li>{t("Bấm \"New token…\", Scope chọn YouTrack, bấm Create rồi Copy token (bắt đầu bằng perm-)")}</li>
            <li>{t("Dán token vào ô Token YouTrack rồi bấm Lưu")}</li>
          </ol>
        </form>
      )}
      {save.isError && <p role="alert" className="text-xs text-error">{errorText(save.error, tMap(t, YT_ERRORS), t("Không lưu được. Kiểm tra URL (bắt đầu bằng https://) và token."))}</p>}
    </div>
  );
}

/** The YouTrack tab with no token: the token card alone, its mascot following what is typed. */
export function YtConnectPage() {
  const t = useT();
  const [mood, setMood] = useState<Mood>("idle");
  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <div className="sticky top-0 z-30"><TopBar module="youtrack" /></div>
      <LoginStage mood={mood} title={t("Kết nối YouTrack")} sub={t("Dán token cá nhân, chỉ lưu trên máy này.")}>
        <YtConnect onMood={setMood} />
      </LoginStage>
    </div>
  );
}

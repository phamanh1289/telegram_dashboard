"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, Download, Lightbulb, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Row, StatusLine, Switch, waitRestart } from "@/features/settings/components/parts";
import { AiFetching, UpdateHero } from "@/shared/components/ai/fetching";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/shared/components/ui/dialog";
import { Hint } from "@/shared/components/ui/hint";
import { api, ApiError, errorText } from "@/shared/lib/api";
import { type Key, t as tPlain, tMaybe, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";

type UpdateInfo = { branch: string; current: string; behind: number; dirty: boolean; auto: boolean; error?: string; updated?: boolean; commits: { sha: string; subject: string; when: string }[] };

/** git fetch on open; "Cập nhật" pulls, rebuilds, restarts the server, then reloads this page. */
export function UpdateSection() {
  const t = useT();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["update"], retry: false,
    queryFn: async ({ signal }) => { const r = await api<UpdateInfo>("/update", { signal }); void qc.invalidateQueries({ queryKey: ["update-state"] }); return r; }, staleTime: 60_000 });
  const [restarting, setRestarting] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const [ask, setAsk] = useState(false);
  const run = useMutation({
    mutationFn: () => api<UpdateInfo>("/update", { method: "POST" }),
    onSuccess: async (r) => {
      if (!r.updated) { setAsk(false); return void qc.invalidateQueries({ queryKey: ["update"] }); }
      setRestarting(true);
      setRestartFailed(false);
      if (await waitRestart()) return;
      setRestarting(false); // a minute without the server: say so instead of spinning forever
      setRestartFailed(true);
      setAsk(false);
    },
  });
  const auto = useMutation({
    mutationFn: (on: boolean) => api("/update/auto", { method: "PUT", json: { on } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["update"] }),
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không đổi được tự cập nhật, thử lại")) }),
  });
  const d = info.data;
  // The updater's `detail` is fixed Vietnamese text from the server (English in en/common.ts): translated when known.
  const err = (e: unknown) => (e instanceof ApiError && ((e.detail && tMaybe(e.detail)) || t("Cập nhật lỗi ({code}).", { code: e.code }))) || t("Không kết nối được GitHub.");
  const busy = run.isPending || restarting;
  const latest = d?.commits[0]?.sha ?? "";
  const release = d?.branch === "GitHub Releases";
  return <>
    <div className="grid gap-2.5 py-3 first:pt-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusLine tone={info.isFetching ? "idle" : !d ? "error" : d.behind ? "warn" : "ok"}>
          {info.isFetching ? t("Đang kiểm tra…") : !d ? t("Chưa kiểm tra được") : d.behind ? t.n("Có {n} bản mới trên {branch}", { n: <b className="font-bold">{d.behind}</b>, branch: d.branch }) : <>{t("Đã mới nhất")} <span className="font-mono text-xs text-ink-3">{d.current} · {d.branch}</span></>}
        </StatusLine>
        <div className="flex gap-2">
          <Hint side="bottom" text={t("Kiểm tra lại bản mới trên GitHub")}>
            <Button variant="ghost" size="icon-sm" aria-label={t("Kiểm tra")} disabled={info.isFetching || run.isPending} onClick={() => void info.refetch()}>
              <RotateCw className={cn(info.isFetching && "animate-spin")} />
            </Button>
          </Hint>
          <Button size="sm" aria-busy={run.isPending || restarting} disabled={!d?.behind || d.dirty || busy} onClick={() => { run.reset(); setAsk(true); }}>
            {restarting ? t("Đang khởi động lại…") : run.isPending ? t("Đang cập nhật…") : t("Cập nhật")}
          </Button>
        </div>
      </div>
      {!!d?.commits.length && (
        <ul className="grid max-h-40 gap-px overflow-y-auto rounded-md bg-paper-2 p-1 text-xs shadow-groove">
          {d.commits.map((c) => (
            <li key={c.sha} className="flex gap-2 rounded px-2 py-1 hover:bg-cotton">
              <span className="shrink-0 font-mono text-hl-2">{c.sha}</span><span className="min-w-0 flex-1 truncate text-ink-2">{c.subject}</span><span className="shrink-0 text-ink-3">{c.when}</span>
            </li>
          ))}
        </ul>
      )}
      {d?.error && !run.isPending && <p role="alert" className="text-xs text-warn">{t("Lần tự cập nhật gần nhất lỗi:")} {tMaybe(d.error)}</p>}
      {d?.dirty && <p className="text-xs text-warn">{t("Thư mục app có file đã sửa tay: không tự cập nhật được, dùng git.")}</p>}
      {(info.isError || (run.isError && !ask)) && <p role="alert" className="text-xs text-error">{err(info.error ?? run.error)}</p>}
      {restartFailed && <p role="alert" className="text-xs text-error">{t("Đã cập nhật nhưng server chưa chạy lại sau 1 phút: mở lại app (Start Dashboard) rồi tải lại trang.")}</p>}
    </div>
    {d && (
      <UpdateDialog open={ask} onOpenChange={setAsk} info={d} latest={latest} release={release} phase={restarting ? "restart" : run.isPending ? "install" : "idle"}
        error={run.isError ? err(run.error) : undefined} onConfirm={() => run.mutate()} />
    )}
    {d && (
      <Row label={t("Tự động cập nhật")} desc={t("Server kiểm tra mỗi giờ (tắt thì chỉ hiện chấm trên nút Cài đặt). Bật: có bản mới thì tự cập nhật, khởi động lại server và tải lại trang; bỏ qua khi đang có task AI Agent.")}>
        <Switch label={t("Tự động cập nhật")} checked={auto.isPending ? !!auto.variables : d.auto} disabled={auto.isPending} onChange={(v) => auto.mutate(v)} />
      </Row>
    )}
  </>;
}

type UpdatePhase = "idle" | "install" | "restart";
type Tip = { area: string; title: string; what: string };

/** While the update runs: how long it has been, and a tip from the user guide every 6s (loaded only now: the guide catalog is big). */
function WaitTips() {
  const tl = useT();
  const [tips, setTips] = useState<Tip[]>([]);
  const [sec, setSec] = useState(0);
  useEffect(() => {
    void (tl.lang === "en" ? import("@/shared/lib/guide/en") : import("@/shared/lib/guide/vi"))
      .then((m) => setTips((m.default as Tip[]).filter((t) => t.title && t.what).sort(() => Math.random() - 0.5)));
  }, [tl.lang]);
  useEffect(() => {
    const t = setInterval(() => setSec((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const tip = tips[Math.floor(sec / 6) % (tips.length || 1)];
  return (
    <div className="grid gap-1.5 rounded-lg border border-rule bg-paper-2 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-ink-3">
        <Lightbulb aria-hidden className="size-3.5 text-warn" />{tl("Trong lúc chờ, bạn có biết")}
        <span className="ml-auto font-mono tabular-nums">{String(Math.floor(sec / 60)).padStart(2, "0")}:{String(sec % 60).padStart(2, "0")}</span>
      </div>
      {tip ? (
        <div key={tip.title} className="grid min-h-14 gap-0.5 animate-in fade-in-0 slide-in-from-right-3 duration-(--dur-short)">
          <span className="text-2xs text-hl-2">{tip.area}</span>
          <span className="text-sm font-medium text-ink">{tip.title}</span>
          <span className="line-clamp-2 text-xs text-ink-2">{tip.what}</span>
        </div>
      ) : <div className="min-h-14" />}
    </div>
  );
}

/** Hero first: GitHub → robot → app (at rest), versions, what's new folded; once confirmed the same hero runs (AI pulls
 *  the release) over a stepper of the two phases the server really reports (install, restart). */
function UpdateDialog({ open, onOpenChange, info: d, latest, release, phase, error, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; info: UpdateInfo; latest: string; release: boolean
  phase: UpdatePhase; error?: string; onConfirm: () => void
}) {
  const t = useT();
  const busy = phase !== "idle";
  const stages: [Key, UpdatePhase][] = [["Kéo & cài bản mới", "install"], ["Khởi động lại", "restart"], ["Tải lại trang", "idle"]];
  const at = stages.findIndex(([, p]) => p === phase);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent showCloseButton={!busy} className="gap-5 sm:max-w-md">
        <div className="-mx-(--dlg-p) -mt-(--dlg-p) grid justify-items-center bg-radial-[at_50%_70%] from-hl-wash to-transparent to-70% px-(--dlg-p) pt-6">
          {busy
            ? <AiFetching kind={phase === "restart" ? "restart" : "update"} project={latest} className="min-h-0 py-0" />
            : <UpdateHero className="animate-in fade-in-0 zoom-in-95 duration-(--dur-short)" />}
        </div>
        <div className="grid justify-items-center gap-1.5 text-center">
          <div className="flex items-center gap-2.5 font-mono text-lg">
            <span className="text-ink-3">{d.current}</span>
            <ArrowRight aria-hidden className="size-4 text-ink-3" />
            <span className="font-bold text-ink">{latest}</span>
          </div>
          <DialogTitle className="pr-0">{busy ? t.n("Đang cập nhật lên {v}", { v: <span className="font-mono">{latest}</span> }) : t("Có {n} bản mới trên GitHub", { n: d.behind })}</DialogTitle>
          <DialogDescription>{busy ? t("Giữ trang này mở, xong sẽ tự tải lại.") : release ? t("Tải gói đã ký từ GitHub Releases, kiểm checksum + chữ ký rồi mới cài.") : t("git pull từ {branch}, build lại khi cần.", { branch: d.branch })}</DialogDescription>
        </div>
        {busy ? <>
          <ol className="flex items-start">
            {stages.map(([label], i) => {
              const done = i < at, now = i === at;
              return (
                <li key={label} className="relative grid flex-1 justify-items-center gap-1.5 text-center">
                  {i > 0 && <span aria-hidden className={cn("absolute top-3 right-[calc(50%+1rem)] left-[calc(-50%+1rem)] h-px", done || now ? "bg-hl" : "bg-rule")} />}
                  <span className={cn("relative grid size-6 place-items-center rounded-full border text-2xs font-bold [&_svg]:size-3.5",
                    done ? "border-ok bg-ok text-cotton" : now ? "border-hl bg-hl-wash text-hl-2" : "border-rule bg-cotton text-ink-3")}>
                    {done ? <Check /> : now ? <Loader2 className="animate-spin" /> : i + 1}
                  </span>
                  <span className={cn("text-xs", now ? "font-medium text-ink" : "text-ink-3")}>{t(label)}</span>
                </li>
              );
            })}
          </ol>
          <WaitTips />
        </> : <div className="grid gap-2">
          {!!d.commits.length && (
            <details className="group rounded-lg border border-rule">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-2 select-none hover:bg-paper-2 [&::-webkit-details-marker]:hidden">
                <ChevronDown aria-hidden className="size-4 -rotate-90 text-ink-3 transition-transform group-open:rotate-0" />
                {t("Có gì mới")} <span className="text-ink-3">({d.commits.length})</span>
              </summary>
              <ul className="grid max-h-36 grid-cols-1 overflow-y-auto border-t border-rule py-1 text-xs">
                {d.commits.map((c, i) => (
                  <li key={c.sha} className="flex items-center gap-2.5 px-3 py-1.5">
                    <span className={cn("shrink-0 font-mono", i ? "text-ink-3" : "text-hl-2")}>{c.sha}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{c.subject}</span>
                    <span className="shrink-0 text-ink-3 tabular-nums">{c.when}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Hint text={t("Server chạy code cũ tới khi khởi động lại, nên luôn khởi động lại sau khi cài; đang có task AI Agent thì đợi task xong.")}>
            <p tabIndex={0} className="flex w-fit items-center gap-2 rounded px-3 text-xs text-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-hl"><RotateCw aria-hidden className="size-3.5" />{t("Tự khởi động lại server sau khi cài")}</p>
          </Hint>
          {error && <p role="alert" className="flex gap-2 rounded-lg bg-error-wash px-3 py-2 text-xs text-error"><TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />{error}</p>}
        </div>}
        <DialogFooter className="border-t-0 bg-transparent pt-0 sm:justify-stretch [&>*]:sm:flex-1">
          <DialogClose disabled={busy} render={<Button variant="outline" />}>{t("Hủy")}</DialogClose>
          <Button aria-busy={busy} disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            {phase === "restart" ? t("Đang khởi động lại…") : busy ? t("Đang cập nhật…") : error ? t("Thử lại") : t("Cập nhật lên {v}", { v: latest })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

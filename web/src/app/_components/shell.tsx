"use client";

import { BookOpenText, Bug, ExternalLink, Moon, RotateCw, Send, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, ViewTransition } from "react";
import { AiQuota } from "@/shared/components/ai";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { errorText, isOffline, OFFLINE_TEXT, statusQuery, updateStateQuery } from "@/shared/lib/api";
import { saveLang, t as tPlain, useT } from "@/shared/lib/i18n";
import { Told } from "@/features/telegram/lib/inbox";
import { useWaitingCount } from "@/features/telegram/lib/qa";
import { useNow } from "@/shared/hooks/use-now";
import { toast, type ToastMsg } from "@/shared/lib/notifications";
import { applyTheme, readTheme, useRole } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { useFreshTickets, useMyTickets, useWatchGlobal } from "@/features/youtrack/lib/watch";
import { needOf, skipAskKey, skipNeedKey } from "@/features/youtrack/lib/yt-stats";
import { useDone } from "@/features/telegram/lib/follow";
import { useAsked } from "@/features/youtrack/lib/trace";
import { Pill } from "@/shared/components/ui/segmented";
import { WarnBar } from "@/shared/components/ui/warn-bar";
import { Hint } from "@/shared/components/ui/hint";
import { prefillReport } from "@/features/settings/lib/contact-prefill";
import { RestartPrompt } from "@/features/settings/components/update";
import { GuideBot, type Module } from "@/app/_components/guide";
import { YtLogo } from "@/shared/components/yt-logo";
import { note } from "@/features/youtrack/components/watch";
import { useWaitNudge } from "@/features/telegram/components/briefing/waits";

// Chrome shared by the modules (Telegram, YouTrack, Tài liệu) and Settings: the top bar and the toast.

// label: a key of t(); "Telegram" / "YouTrack" are names and stay the same in English
const MODULES = [
  ["telegram", "/", "Telegram", Send, "Chuyển sang Telegram Inbox"],
  ["youtrack", "/youtrack/", "YouTrack", YtLogo, "Chuyển sang YouTrack"],
  ["docs", "/docs/", "Tài liệu", BookOpenText, "Chuyển sang Tài liệu"],
] as const;

/** For the YouTrack switch while elsewhere (same cache key as the YouTrack page): `fresh` = open tickets newly given to me
 *  since I was last there (red count), `risk` = mine that need attention now (amber, when nothing is new): at risk,
 *  waiting on my define / confirm (PO), or with a comment asking me, each ticket once. */
function useYtBadge(on: boolean) {
  const t = useT();
  const { me, rows, project } = useMyTickets(on);
  const now = useNow();
  const role = useRole(); // "me" = my tickets + those I QC; QA counts the QC ones, PO all of them, Dev the assigned ones
  const fresh = useFreshTickets(!on).filter((id) => rows.some((i) => i.id === id && !i.resolved));
  const asked = useAsked(project, role === "po", on && !!me, true).data; // unreadable: counted as none (Hôm nay says the error)
  const [done] = useDone(); // "Bỏ qua" on Hôm nay takes a row off the count too
  const risk = [...new Map([
    ...rows.flatMap((i): [string, string][] => { const r = needOf(role, i, me, now); return r && !done.has(skipNeedKey(i, r)) ? [[i.id, `${i.id}: ${r}`]] : []; }),
    ...(asked ?? []).filter(({ ticket: i, ask }) => !done.has(skipAskKey(i.id, ask.created)))
      .map(({ ticket: i }): [string, string] => [i.id, `${i.id}: ${t("hỏi bạn trong bình luận")}`]),
  ]).values()];
  return { fresh, risk };
}

const list = (xs: string[]) => `${xs.slice(0, 5).join(", ")}${xs.length > 5 ? "…" : ""}`;

function SwitchBadge({ n, label, className }: { n: number; label: string; className?: string }) {
  return <span className={cn("rounded-full bg-badge px-1.5 font-mono text-2xs leading-[18px] text-white tabular-nums", className)}>{n > 99 ? "99+" : n}<span className="sr-only"> {label}</span></span>;
}

/** New commits on GitHub (server checks hourly), and a reload once the server restarted on a new version. */
function useUpdateState() {
  const q = useQuery({ ...updateStateQuery, refetchInterval: 60_000, retry: false });
  const first = useRef<string | null>(null);
  const v = q.data?.version;
  const waiting = !!q.data?.pending; // installed, not restarted: the old server still answers, keep its UI
  useEffect(() => {
    if (!v) return;
    if (first.current === null) first.current = v;
    else if (first.current !== v && !waiting) location.reload(); // auto-update pulled and restarted: load the new UI
  }, [v, waiting]);
  return q.data?.behind ?? 0;
}

/** The local dashboard not answering: the shared /status read failed with fetch's TypeError. Any page may ask (the
 *  Telegram inbox hides its own stream banner then); the shell's `useDashboardWatch` keeps the read going. */
export function useDashboardDown() {
  return isOffline(useQuery({ ...statusQuery, staleTime: Infinity }).error);
}

/** One watch for every page (in the top bar): /status re-read every 15s, every 5s while the dashboard is down, and on
 *  coming back to the window (one local query, nothing per row), so an idle page notices too; another read failing the
 *  same way asks /status at once; once it answers again, what failed meanwhile is read again. */
function useDashboardWatch() {
  const qc = useQueryClient();
  const st = useQuery({ ...statusQuery, refetchInterval: (q) => (q.state.status === "error" ? 5000 : 15000), refetchOnWindowFocus: true });
  const down = isOffline(st.error);
  useEffect(() => qc.getQueryCache().subscribe((e) => {
    if (e.type === "updated" && e.action.type === "error" && isOffline(e.action.error) && e.query.queryKey[0] !== "status")
      void qc.invalidateQueries({ queryKey: statusQuery.queryKey }, { cancelRefetch: false });
  }), [qc]);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !down) void qc.invalidateQueries();
    was.current = down;
  }, [down, qc]);
  return { down, checking: st.isFetching, retry: () => void qc.invalidateQueries() };
}

/** Module switch left; AI quota, guide, theme and the shared settings right. */
/** `onClose`: Settings only, its leave (the closing animation, then back): the gear clicked again runs it. */
export function TopBar({ module, children, onClose }: { module: Module; children?: React.ReactNode; onClose?: () => void }) {
  const t = useT();
  const { fresh, risk } = useYtBadge(module !== "youtrack");
  const tg = useWaitingCount(module !== "telegram"); // tags waiting on me ("Việc cần xử lý › Đang chờ")
  // New tickets for me and new "Báo lại" items (queued by the server's watch), on every page.
  useWatchGlobal((id, text) => { toast({ text: `${id}: ${text}` }); note(id, text); });
  useWaitNudge(true); // Chờ bổ sung waiting over 3 days: once a day, on every page
  const behind = useUpdateState();
  const server = useDashboardWatch();
  // "Theo hệ thống": follow the OS when it flips while the page is open.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (readTheme() === "system") applyTheme("system", false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <div className="relative col-span-full flex h-11 items-center gap-2 border-b bg-paper-2 px-2 sm:px-3">
      {children}
      <nav aria-label={t("Chuyển module")} className="flex gap-0.5 rounded-[var(--radius-card)] bg-paper-3 p-0.5 shadow-groove">
        {/* Module switch: each tab and the pill keep a name across pages, so the pill slides while the tabs move with it
            (a badge shows only on the other modules, shifting them); globals.css sets the timing and layering. */}
        {MODULES.map(([id, href, label, Icon, title]) => id === module ? (
          <ViewTransition key={id} name={`module-${id}`} default="module-tab">
            <span aria-current="page" className="relative flex h-8 items-center gap-2 px-2.5 text-sm font-medium text-hl-ink">
              <ViewTransition name="module-pill"><span aria-hidden className="absolute inset-0 rounded-[var(--radius-input)] bg-hl" /></ViewTransition>
              <Icon className="relative size-4 shrink-0" aria-hidden /><span className="relative max-sm:sr-only">{t(label)}</span>
            </span>
          </ViewTransition>
        ) : (
          <ViewTransition key={id} name={`module-${id}`} default="module-tab"><Hint side="bottom" title={t(label)} text={[t(title),
            id === "telegram" && tg ? t("{n} tin tag đang chờ bạn", { n: tg }) : "",
            id === "youtrack" && fresh.length ? t("{n} ticket mới giao cho bạn: {list}", { n: fresh.length, list: list(fresh) }) : "",
            id === "youtrack" && risk.length ? t("{n} ticket cần xử lý ngay: {list}", { n: risk.length, list: list(risk) }) : ""].filter(Boolean).join(". ")}><Link href={href}
            className="flex h-8 items-center gap-2 rounded-[var(--radius-input)] px-2.5 text-sm font-medium text-ink-3 no-underline transition-colors duration-(--dur-micro) hover:text-ink">
            <Icon className="size-4 shrink-0" aria-hidden /><span className="max-sm:sr-only">{t(label)}</span>
            {/* New on the other module: red count; with nothing new, YouTrack's "needs you" amber. */}
            {id === "telegram" && tg > 0 && <SwitchBadge n={tg} label={t("tin tag đang chờ bạn")} />}
            {id === "youtrack" && (fresh.length > 0 ? <SwitchBadge n={fresh.length} label={t("ticket mới giao cho bạn")} />
              : risk.length > 0 && <SwitchBadge n={risk.length} label={t("ticket cần xử lý ngay")} className="bg-signal" />)}
          </Link></Hint></ViewTransition>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        {/* Tài liệu: the default (telegram) scope, the closest one */}
        <AiQuota scope={module === "youtrack" ? "youtrack" : "telegram"} />
        <GuideBot module={module} />
        <Hint side="bottom" title={t("Giao diện")} text={t("Đổi giao diện sáng / tối.")}><Button size="icon-sm" variant="ghost" aria-label={t("Đổi giao diện sáng / tối")}
          onClick={() => applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}>
          <Moon className="dark:hidden" /><Sun className="hidden dark:block" />
        </Button></Hint>
        <Hint side="bottom" title={t("Ngôn ngữ")} text={t("Đổi ngôn ngữ Tiếng Việt / English.")}><Button size="icon-sm" variant="ghost" aria-label={t("Đổi ngôn ngữ Tiếng Việt / English")}
          onClick={() => saveLang(t.lang === "vi" ? "en" : "vi")}>
          <span className="text-xs font-medium">{t.lang.toUpperCase()}</span>
        </Button></Hint>
        <Hint side="bottom" title={t("Cài đặt")} text={behind ? t("Có {n} bản cập nhật: mở Cài đặt › Cập nhật.", { n: behind }) : t("Telegram, YouTrack, AI, giao diện, cập nhật.")}><Link href={behind ? "/settings/#github" : "/settings/"} aria-current={module === "settings" ? "page" : undefined}
          // A second click closes Settings, like its "Quay lại".
          onClick={onClose && ((e) => { e.preventDefault(); onClose(); })}
          className={buttonVariants({ size: "icon-sm", variant: module === "settings" ? "secondary" : "ghost", className: "relative" })}
          aria-label={behind ? t("Cài đặt (có {n} bản cập nhật)", { n: behind }) : t("Cài đặt")}
          >
          <Settings />
          {behind > 0 && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-hl ring-2 ring-paper-2" />}
        </Link></Hint>
      </div>
      <RestartPrompt />
      {/* over the top of the page, under the bar: no page's layout moves for it */}
      <WarnBar open={server.down} className="absolute inset-x-0 top-full z-60"
        action={<Button size="xs" variant="outline" aria-busy={server.checking} onClick={server.retry}><RotateCw /> {t("Thử lại")}</Button>}>
        {OFFLINE_TEXT()}
      </WarnBar>
    </div>
  );
}

/** Sliding highlight behind the active Telegram sidebar item (views and groups share it), the same spring as YouTrack's nav. */
export function NavPill() {
  return <Pill id="tg-nav" className="inset-0 rounded-[var(--radius-input)] bg-hl-wash" />;
}

/** One toast at a time (lib/inbox `toast`); one with an undo stays longer and answers z. At most one button: with both
 *  an action and an undo, the action gets the button and the undo stays on z (said in the text). */
export function Toaster() {
  const t = useT();
  const router = useRouter();
  const [flash, setFlash] = useState<(ToastMsg & { id: number }) | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => setFlash({ ...(e as CustomEvent<ToastMsg>).detail, id: Date.now() });
    addEventListener("toast", onToast);
    return () => removeEventListener("toast", onToast);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), flash.undo || flash.action || flash.failure ? 6000 : 3000);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "z" || !flash.undo || e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      e.preventDefault();
      undo();
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", onKey); };
  }, [flash]); // eslint-disable-line react-hooks/exhaustive-deps
  function undo() {
    const run = flash?.undo;
    if (!run) return;
    setFlash(null);
    Promise.resolve(run()).then(() => toast({ text: tPlain("Đã hoàn tác") }), (e) => toast({ text: e instanceof Told ? e.message : errorText(e, {}, tPlain("Không hoàn tác được")) }));
  }
  if (!flash) return null;
  return (
    <div key={flash.id} role="status" className={cn("fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-md bg-board py-1.5 pr-1.5 pl-4 text-sm font-medium text-board-type shadow-pop animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short) ease-(--ease-out)", !flash.undo && !flash.action && !flash.failure && "pr-4")}>
      <span className="py-1">{flash.text}{flash.undo && flash.action && <span className="font-normal opacity-80"> {t("(z: hoàn tác)")}</span>}</span>
      {flash.undo && !flash.action && (
        <button type="button" onClick={undo} aria-keyshortcuts="z"
          className="rounded-[var(--radius-input)] px-2.5 py-1 font-bold underline decoration-board-type/40 underline-offset-4 transition-colors duration-(--dur-micro) hover:bg-board-type/15 hover:decoration-board-type">
          {t("Hoàn tác")}
        </button>
      )}
      {flash.action && (
        <button type="button" onClick={() => { setFlash(null); flash.action!.run(); }}
          className="flex items-center gap-1 rounded-[var(--radius-input)] px-2.5 py-1 font-bold underline decoration-board-type/40 underline-offset-4 transition-colors duration-(--dur-micro) hover:bg-board-type/15 hover:decoration-board-type">
          <ExternalLink className="size-3.5" aria-hidden /> {flash.action.label}
        </button>
      )}
      {flash.failure && !flash.undo && !flash.action && (
        <button type="button" onClick={() => {
          prefillReport(flash.text, flash.failure!);
          setFlash(null);
          if (location.pathname.startsWith("/settings")) location.hash = "contact"; // the page follows hashchange
          else router.push("/settings/#contact");
        }} className="flex items-center gap-1 rounded-[var(--radius-input)] px-2.5 py-1 font-bold underline decoration-board-type/40 underline-offset-4 transition-colors duration-(--dur-micro) hover:bg-board-type/15 hover:decoration-board-type">
          <Bug className="size-3.5" aria-hidden /> {t("Báo lỗi này")}
        </button>
      )}
    </div>
  );
}

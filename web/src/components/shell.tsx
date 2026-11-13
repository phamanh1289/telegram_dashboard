"use client";

import { ExternalLink, Moon, Send, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, ViewTransition } from "react";
import { AiQuota } from "@/components/ai";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, errorText } from "@/lib/api";
import { saveLang, t as tPlain, useT } from "@/lib/i18n";
import { toast, type ToastMsg, Told, useNow, useWaitingCount } from "@/lib/inbox";
import { applyTheme, readTheme, useRole } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { riskOf, useFreshTickets, useMyTickets, useWatchGlobal } from "@/lib/yt";
import { Pill } from "@/components/ui/segmented";
import { Hint } from "@/components/ui/hint";
import { GuideBot } from "@/components/guide";
import { YtLogo } from "@/components/yt-logo";
import { note } from "@/components/yt/watch";

// Chrome shared by the Telegram and YouTrack modules: the top bar and the toast.

const MODULES = [
  ["telegram", "/", "Telegram", Send, "Chuyển sang Telegram Inbox"],
  ["youtrack", "/youtrack/", "YouTrack", YtLogo, "Chuyển sang YouTrack"],
] as const;

/** For the YouTrack switch while elsewhere (same cache key as the YouTrack page): `fresh` = open tickets newly given to me
 *  since I was last there (red count), `risk` = mine that need attention now (amber, when nothing is new). */
function useYtBadge(on: boolean) {
  const { me, rows } = useMyTickets(on);
  const now = useNow();
  const role = useRole(); // "me" = my tickets + those I QC; QA counts the QC ones, PO all of them, Dev the assigned ones
  const fresh = useFreshTickets(!on).filter((id) => rows.some((i) => i.id === id && !i.resolved));
  const risk = rows.flatMap((i) => { const r = (role === "po" || (role === "qa" ? i.qc : i.assignee) === me) ? riskOf(i, now) : null; return r ? [`${i.id}: ${r}`] : []; });
  return { fresh, risk };
}

/** Tags waiting on me ("Việc cần xử lý › Đang chờ"), for a red count on the Telegram switch while elsewhere. */
function useTgBadge(on: boolean) {
  const n = useWaitingCount();
  return on ? n : 0;
}

const list = (xs: string[]) => `${xs.slice(0, 5).join(", ")}${xs.length > 5 ? "…" : ""}`;

function SwitchBadge({ n, label, className }: { n: number; label: string; className?: string }) {
  return <span className={cn("rounded-full bg-badge px-1.5 font-mono text-2xs leading-[18px] text-white tabular-nums", className)}>{n > 99 ? "99+" : n}<span className="sr-only"> {label}</span></span>;
}

/** New commits on GitHub (server checks hourly), and a reload once the server restarted on a new version. */
function useUpdateState() {
  const q = useQuery({
    queryKey: ["update-state"], refetchInterval: 60_000, retry: false,
    queryFn: ({ signal }) => api<{ version: string; behind: number }>("/update/state", { signal }),
  });
  const first = useRef<string | null>(null);
  const v = q.data?.version;
  useEffect(() => {
    if (!v) return;
    if (first.current === null) first.current = v;
    else if (first.current !== v) location.reload(); // auto-update pulled and restarted: load the new UI
  }, [v]);
  return q.data?.behind ?? 0;
}

/** Module switch left; AI quota, guide, theme and the shared settings right. */
export function TopBar({ module, children }: { module: "telegram" | "youtrack" | "settings"; children?: React.ReactNode }) {
  const t = useT();
  const { fresh, risk } = useYtBadge(module !== "youtrack");
  const tg = useTgBadge(module !== "telegram");
  // New tickets for me and new "Báo lại" items (queued by the server's watch), on every page.
  useWatchGlobal((id, text) => { toast({ text: `${id}: ${text}` }); note(id, text); });
  const behind = useUpdateState();
  const router = useRouter();
  // "Theo hệ thống": follow the OS when it flips while the page is open.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (readTheme() === "system") applyTheme("system", false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <div className="col-span-full flex h-11 items-center gap-2 border-b bg-paper-2 px-2 sm:px-3">
      {children}
      <nav aria-label={t("Chuyển module")} className="flex gap-0.5 rounded-[var(--radius-card)] bg-paper-3 p-0.5 shadow-groove">
        {MODULES.map(([id, href, label, Icon, title]) => id === module ? (
          // Shared across both pages: on a module switch React morphs the pill and crossfades the rest (globals.css sets the timing).
          <ViewTransition key={id} name="module-pill">
            <span aria-current="page" className="flex h-8 items-center gap-2 rounded-[var(--radius-input)] bg-hl px-2.5 text-sm font-medium text-hl-ink">
              <Icon className="size-4 shrink-0" aria-hidden /><span className="max-sm:sr-only">{label}</span>
            </span>
          </ViewTransition>
        ) : (
          <Hint key={id} side="bottom" title={label} text={[t(title),
            id === "telegram" && tg ? t("{n} tin tag đang chờ bạn", { n: tg }) : "",
            id === "youtrack" && fresh.length ? t("{n} ticket mới giao cho bạn: {list}", { n: fresh.length, list: list(fresh) }) : "",
            id === "youtrack" && risk.length ? t("{n} ticket cần xử lý ngay: {list}", { n: risk.length, list: list(risk) }) : ""].filter(Boolean).join(". ")}><Link href={href}
            className="flex h-8 items-center gap-2 rounded-[var(--radius-input)] px-2.5 text-sm font-medium text-ink-3 no-underline transition-colors duration-(--dur-micro) hover:text-ink">
            <Icon className="size-4 shrink-0" aria-hidden /><span className="max-sm:sr-only">{label}</span>
            {/* New on the other module: red count; with nothing new, YouTrack's "needs you" amber. */}
            {id === "telegram" && tg > 0 && <SwitchBadge n={tg} label={t("tin tag đang chờ bạn")} />}
            {id === "youtrack" && (fresh.length > 0 ? <SwitchBadge n={fresh.length} label={t("ticket mới giao cho bạn")} />
              : risk.length > 0 && <SwitchBadge n={risk.length} label={t("ticket cần xử lý ngay")} className="bg-signal" />)}
          </Link></Hint>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1">
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
          onClick={module === "settings" ? (e) => { e.preventDefault(); if (history.length > 1) router.back(); else router.push("/"); } : undefined}
          className={buttonVariants({ size: "icon-sm", variant: module === "settings" ? "secondary" : "ghost", className: "relative" })}
          aria-label={behind ? t("Cài đặt (có {n} bản cập nhật)", { n: behind }) : t("Cài đặt")}
          >
          <Settings />
          {behind > 0 && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-hl ring-2 ring-paper-2" />}
        </Link></Hint>
      </div>
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
  const [flash, setFlash] = useState<(ToastMsg & { id: number }) | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => setFlash({ ...(e as CustomEvent<ToastMsg>).detail, id: Date.now() });
    addEventListener("toast", onToast);
    return () => removeEventListener("toast", onToast);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), flash.undo || flash.action ? 6000 : 3000);
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
    <div key={flash.id} role="status" className={cn("fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-md bg-board py-1.5 pr-1.5 pl-4 text-sm font-medium text-board-type shadow-pop animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short) ease-(--ease-out)", !flash.undo && !flash.action && "pr-4")}>
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
    </div>
  );
}

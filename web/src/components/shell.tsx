"use client";

import { ListChecks, Moon, Send, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ClaudeQuota } from "@/components/claude";
import { Button } from "@/components/ui/button";
import { toast, type ToastMsg } from "@/lib/inbox";
import { applyTheme, readTheme } from "@/lib/prefs";
import { cn } from "@/lib/utils";

// Chrome shared by the Telegram and YouTrack modules: the top bar and the toast.

const MODULES = [
  ["telegram", "/", "Telegram", Send, "Chuyển sang Telegram Inbox"],
  ["youtrack", "/youtrack/", "YouTrack", ListChecks, "Chuyển sang YouTrack"],
] as const;

/** Module switch left; Claude quota, theme and the shared settings right. */
export function TopBar({ module, onSettings, children }: { module: "telegram" | "youtrack"; onSettings: () => void; children?: React.ReactNode }) {
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
      <nav aria-label="Chuyển module" className="flex gap-0.5 rounded-[var(--radius-card)] bg-paper-3 p-0.5 shadow-groove">
        {MODULES.map(([id, href, label, Icon, title]) => id === module ? (
          <span key={id} aria-current="page" className="flex h-8 items-center gap-2 rounded-[var(--radius-input)] bg-hl px-2.5 text-sm font-medium text-hl-ink">
            <Icon className="size-4 shrink-0" aria-hidden />{label}
          </span>
        ) : (
          <Link key={id} href={href} title={title}
            className="flex h-8 items-center gap-2 rounded-[var(--radius-input)] px-2.5 text-sm font-medium text-ink-3 no-underline transition-colors duration-(--dur-micro) hover:text-ink">
            <Icon className="size-4 shrink-0" aria-hidden />{label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <ClaudeQuota />
        <Button size="icon-sm" variant="ghost" aria-label="Đổi giao diện sáng / tối" title="Đổi giao diện sáng / tối"
          onClick={() => applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}>
          <Moon className="dark:hidden" /><Sun className="hidden dark:block" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Cài đặt chung" title="Cài đặt chung: giao diện, Claude, YouTrack, kết nối" onClick={onSettings}>
          <Settings />
        </Button>
      </div>
    </div>
  );
}

/** One toast at a time (lib/inbox `toast`); one with an undo stays longer and answers z. */
export function Toaster() {
  const [flash, setFlash] = useState<(ToastMsg & { id: number }) | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => setFlash({ ...(e as CustomEvent<ToastMsg>).detail, id: Date.now() });
    addEventListener("toast", onToast);
    return () => removeEventListener("toast", onToast);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.undo ? 6000 : 3000);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "z" || !flash.undo || e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      e.preventDefault();
      undo();
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); };
  });
  function undo() {
    const run = flash?.undo;
    if (!run) return;
    setFlash(null);
    Promise.resolve(run()).then(() => toast({ text: "Đã hoàn tác" }), () => toast({ text: "Không hoàn tác được" }));
  }
  if (!flash) return null;
  return (
    <div key={flash.id} role="status" className={cn("fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-md bg-board py-1.5 pr-1.5 pl-4 text-sm font-medium text-board-type shadow-pop animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short) ease-(--ease-out)", !flash.undo && "pr-4")}>
      <span className="py-1">{flash.text}</span>
      {flash.undo && (
        <button type="button" onClick={undo} title="Hoàn tác (z)"
          className="rounded-[var(--radius-input)] px-2.5 py-1 font-semibold underline decoration-board-type/40 underline-offset-4 transition-colors duration-(--dur-micro) hover:bg-board-type/15 hover:decoration-board-type">
          Hoàn tác
        </button>
      )}
    </div>
  );
}

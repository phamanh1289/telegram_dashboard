"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, LayoutDashboard, ListChecks, Menu, Monitor, Printer, RotateCw, Sun, Users, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SharedSettingsDialog } from "@/components/settings";
import { Toaster, TopBar } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { api, type Status } from "@/lib/api";
import { toast } from "@/lib/inbox";
import { getPref, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { shortName, shortSp, TIER_LABEL, UNASSIGNED } from "@/lib/yt";
import { Avatar, MultiSelect } from "./bits";
import { DashboardPage } from "./dashboard";
import { DevHome, LeadHome } from "./home";
import { Sheet } from "./sheet";
import { ANDROID_TEAM, type Mode, type Page, useYt, YtProvider } from "./state";
import { TicketsPage } from "./tickets";

const noop = () => () => {};
export function YouTrackApp() {
  // State starts from the URL and localStorage: render in the browser only (the static export prerenders an empty shell).
  const client = useSyncExternalStore(noop, () => true, () => false);
  return client ? <YtProvider><Shell /></YtProvider> : null;
}

const PAGES: Record<Mode, [Page, string, typeof ListChecks][]> = {
  dev: [["home", "Hôm nay", CalendarCheck], ["tickets", "Ticket", ListChecks], ["dash", "Dashboard", LayoutDashboard]],
  lead: [["home", "Brief", Sun], ["dash", "Dashboard", LayoutDashboard], ["tickets", "Ticket", ListChecks]],
};

function Shell() {
  const y = useYt();
  const status = useQuery({ queryKey: ["status"], queryFn: ({ signal }) => api<Status>("/status", { signal }), retry: 1 });
  const [shared, setShared] = useState({ open: false, key: 0 });
  const [collapsed, setCollapsed] = useState(() => getPref("ytSide") === "1");
  const [menu, setMenu] = useState(false);
  const pages = PAGES[y.mode];
  const title = pages.find(([p]) => p === y.page)?.[1] ?? "";

  // TV: full screen, no chrome, bigger type; leaving full screen (Esc) leaves TV mode too
  useEffect(() => {
    const off = () => { if (!document.fullscreenElement) y.setTv(false); };
    document.addEventListener("fullscreenchange", off);
    return () => document.removeEventListener("fullscreenchange", off);
  }, [y]);
  useEffect(() => { document.documentElement.style.fontSize = y.tv ? "125%" : ""; }, [y.tv]);
  function tv() {
    y.setTv(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
    toast({ text: "Chế độ TV, nhấn Esc để thoát" });
  }
  const go = (p: Page) => { y.setPage(p); setMenu(false); };

  return (
    <div className={cn("grid min-h-dvh grid-rows-[auto_minmax(0,1fr)]", y.dense && "yt-dense")}>
      {!y.tv && (
        <div className="yt-noprint sticky top-0 z-30">
          <TopBar module="youtrack" onSettings={() => setShared((s) => ({ open: true, key: s.key + 1 }))}>
            <Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="Menu" onClick={() => setMenu(true)}><Menu /></Button>
          </TopBar>
        </div>
      )}
      <div className={cn("grid min-h-0", !y.tv && (collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[15rem_minmax(0,1fr)]"), "transition-[grid-template-columns] duration-(--dur-short)")}>
        {!y.tv && (
          <>
            {menu && <div aria-hidden className="fixed inset-0 z-40 bg-(--scrim) md:hidden" onClick={() => setMenu(false)} />}
            <aside className={cn("yt-noprint fixed inset-y-0 left-0 z-50 flex w-60 flex-col gap-1 border-r bg-paper-2 p-3 transition-transform duration-(--dur-short) md:sticky md:top-11 md:z-0 md:h-[calc(100dvh-2.75rem)] md:w-auto md:translate-x-0",
              menu ? "translate-x-0 shadow-pop" : "-translate-x-full")}>
              <div className="mb-2 flex min-h-10 items-center gap-3 px-1">
                <button type="button" onClick={() => { setPref("ytSide", collapsed ? "0" : "1"); setCollapsed(!collapsed); }} title="Thu gọn / mở rộng menu"
                  className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-input)] bg-board text-board-type max-md:pointer-events-none"><ListChecks className="size-4" aria-hidden /></button>
                <span className={cn("grid leading-tight whitespace-nowrap", collapsed && "md:hidden")}><span className="text-sm font-semibold">YouTrack</span><span className="text-xs text-ink-3">{y.project}</span></span>
                <Button size="icon-xs" variant="ghost" className="ml-auto md:hidden" aria-label="Đóng menu" onClick={() => setMenu(false)}><X /></Button>
              </div>
              <ModeSwitch collapsed={collapsed} />
              <nav aria-label="Trang" className="mt-2 grid gap-1">
                {pages.map(([p, label, Icon]) => (
                  <button key={p} type="button" aria-current={y.page === p ? "page" : undefined} onClick={() => go(p)} title={label}
                    className={cn("relative flex min-h-9 items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-left text-sm font-medium transition-colors duration-(--dur-micro)",
                      y.page === p ? "text-hl-2" : "text-ink-3 hover:bg-paper-3 hover:text-ink")}>
                    {y.page === p && <motion.span layoutId="yt-nav" className="absolute inset-0 rounded-[var(--radius-input)] bg-hl-wash" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                    <Icon className="relative size-5 shrink-0" aria-hidden /><span className={cn("relative", collapsed && "md:hidden")}>{label}</span>
                  </button>
                ))}
              </nav>
              <div className="mt-auto grid gap-1 border-t pt-2">
                <button type="button" onClick={tv} title="Toàn màn hình, chữ lớn, ẩn menu (Esc để thoát)" className="flex min-h-9 items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
                  <Monitor className="size-5 shrink-0" /><span className={cn(collapsed && "md:hidden")}>Chế độ TV</span></button>
                <button type="button" onClick={() => print()} title="In hoặc lưu PDF trang đang xem" className="flex min-h-9 items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
                  <Printer className="size-5 shrink-0" /><span className={cn(collapsed && "md:hidden")}>In / PDF</span></button>
                {y.me && <div className="flex items-center gap-2 px-1.5 pt-1 text-sm" title={y.me}><Avatar name={y.me} /><span className={cn("truncate", collapsed && "md:hidden")}>{y.me}</span></div>}
              </div>
            </aside>
          </>
        )}

        <main className="min-w-0 px-3 pb-10 sm:px-5">
          <Header title={title} />
          {y.config?.mock && (
            <p role="alert" className="mb-3 rounded-md bg-warn-wash px-3 py-2 text-sm">Đang dùng dữ liệu MOCK. Dán token YouTrack trong Cài đặt chung › YouTrack để xem dữ liệu thật.</p>
          )}
          {(y.configError || y.issues.isError) && (
            <div role="alert" className="mb-3 flex items-center gap-3 rounded-md bg-error-wash px-3 py-2 text-sm text-error">
              <span className="flex-1">Lỗi: {((y.configError ?? y.issues.error) as Error).message}</span>
              <Button size="sm" variant="outline" onClick={y.refresh}><RotateCw /> Thử lại</Button>
            </div>
          )}
          <FilterChips />
          <AnimatePresence mode="wait">
            <motion.div key={`${y.mode}:${y.page}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              {y.page === "tickets" ? <TicketsPage /> : y.page === "dash" ? <DashboardPage /> : y.mode === "dev" ? <DevHome /> : <LeadHome />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Sheet />
      <Toaster />
      {status.data && <SharedSettingsDialog key={`shared${shared.key}`} open={shared.open} onOpenChange={(open) => setShared((s) => ({ ...s, open }))} status={status.data} />}
    </div>
  );
}

/** Lead / Dev: same data, a different home page and default scope. */
function ModeSwitch({ collapsed }: { collapsed: boolean }) {
  const y = useYt();
  const modes = [["dev", "Dev", CalendarCheck, "Việc của tôi: hôm nay làm gì, ticket của tôi"], ["lead", "Lead", Users, "Cả team: brief, rủi ro, tiến độ sprint"]] as const;
  return (
    <div role="radiogroup" aria-label="Chế độ" className={cn("grid grid-cols-2 gap-0.5 rounded-[var(--radius-card)] bg-paper-3 p-0.5 shadow-groove", collapsed && "md:grid-cols-1")}>
      {modes.map(([m, label, Icon, title]) => (
        <button key={m} type="button" role="radio" aria-checked={y.mode === m} title={title} onClick={() => y.mode !== m && y.setMode(m)}
          className={cn("relative flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-input)] text-sm font-medium transition-colors duration-(--dur-micro)", y.mode === m ? "text-hl-ink" : "text-ink-3 hover:text-ink")}>
          {y.mode === m && <motion.span layoutId="yt-mode" className="absolute inset-0 rounded-[var(--radius-input)] bg-hl" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <Icon className="relative size-4" aria-hidden /><span className={cn("relative", collapsed && "md:hidden")}>{label}</span>
        </button>
      ))}
    </div>
  );
}

function Header({ title }: { title: string }) {
  const y = useYt();
  const a = y.filters.assignee, android = [...new Set([y.me, ...ANDROID_TEAM].filter((n): n is string => !!n))];
  const scope = !a.length ? "team" : a.length === 1 && a[0] === y.me ? "me" : a.length === android.length && android.every((n) => a.includes(n)) ? "android" : "";
  const scopes = [["me", "My task"], ["android", "Android team"], ["team", "All"]] as const;
  const updated = y.issues.dataUpdatedAt ? new Date(y.issues.dataUpdatedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "--:--";
  return (
    <header className="yt-noprint sticky top-11 z-20 -mx-3 mb-3 flex flex-wrap items-center gap-2 bg-paper/90 px-3 py-2.5 backdrop-blur sm:-mx-5 sm:px-5">
      <h1 className="mr-auto text-lg font-semibold">{title}</h1>
      <div role="group" aria-label="Phạm vi" className="flex gap-0.5 rounded-[var(--radius-card)] bg-paper-3 p-0.5 shadow-groove max-sm:order-last max-sm:w-full" title="My task: ticket bạn được assign hoặc làm QC · Android team · tất cả">
        {scopes.map(([s, l]) => (
          <button key={s} type="button" aria-pressed={scope === s} disabled={s !== "team" && !y.me}
            onClick={() => y.setFilters({ assignee: s === "team" ? [] : s === "android" ? android : [y.me!] })}
            className={cn("relative h-7 rounded-[var(--radius-input)] px-2.5 text-xs font-medium whitespace-nowrap transition-colors max-sm:flex-1", scope === s ? "text-hl-ink" : "text-ink-3 hover:text-ink disabled:opacity-50")}>
            {scope === s && <motion.span layoutId="yt-scope" className="absolute inset-0 rounded-[var(--radius-input)] bg-hl" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative">{l}</span>
          </button>
        ))}
      </div>
      <select value={y.project} onChange={(e) => y.setProject(e.target.value)} aria-label="Project" title="Project" className="h-[30px] max-w-44 rounded-md border border-rule bg-cotton px-2 text-[0.8125rem]">
        {(y.projects.length ? y.projects : [{ shortName: y.project, name: y.project }]).map((p) => <option key={p.shortName} value={p.shortName} title={p.name}>{p.shortName} ({p.name})</option>)}
      </select>
      <MultiSelect label="Sprint" all="Tất cả sprint" options={y.sprintOptions} value={y.filters.sprint} onChange={(sprint) => y.setFilters({ sprint })} render={shortSp} />
      <MultiSelect label="Người" all="Tất cả người" options={y.peopleOptions} value={a} onChange={(assignee) => y.setFilters({ assignee })} render={shortName} />
      <Button size="sm" variant="outline" onClick={y.refresh} aria-busy={y.issues.isFetching} title={`Cập nhật lúc ${updated} · tự làm mới mỗi phút · bấm để làm mới ngay`}>
        <RotateCw className={cn(y.issues.isFetching && "animate-spin")} /> {y.issues.isFetching ? "Đang tải…" : updated}
      </Button>
    </header>
  );
}

/** The active Sprint / Người / Priority / Type / tier filters as removable chips. */
function FilterChips() {
  const y = useYt();
  const f = y.filters;
  const chips: [string, string, () => void][] = [
    ...f.sprint.map((v) => ["Sprint", shortSp(v), () => y.setFilters({ sprint: f.sprint.filter((x) => x !== v) })] as [string, string, () => void]),
    ...(f.assignee.length === 1 && f.assignee[0] === y.me ? [] : f.assignee).map((v) => ["Người", v === UNASSIGNED ? v : shortName(v), () => y.setFilters({ assignee: f.assignee.filter((x) => x !== v) })] as [string, string, () => void]),
    ...(y.page === "tickets" ? [...f.priority.map((v) => ["Priority", v, () => y.setFilters({ priority: f.priority.filter((x) => x !== v) })] as [string, string, () => void]),
      ...f.type.map((v) => ["Type", v, () => y.setFilters({ type: f.type.filter((x) => x !== v) })] as [string, string, () => void])] : []),
    ...(f.tier != null ? [["Tầng", TIER_LABEL[f.tier], () => y.setFilters({ tier: null })] as [string, string, () => void]] : []),
  ];
  if (!chips.length) return null;
  return (
    <div className="yt-noprint mb-3 flex flex-wrap items-center gap-1.5">
      <AnimatePresence initial={false}>
        {chips.map(([k, v, rm]) => (
          <motion.button layout key={k + v} type="button" onClick={rm} title="Gỡ bộ lọc" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-hl-wash px-2.5 text-xs text-hl-2 hover:bg-hl-wash/70">
            <span className="text-ink-3">{k}</span>{v}<X className="size-3" />
          </motion.button>
        ))}
      </AnimatePresence>
      {chips.length > 1 && <button type="button" onClick={() => y.setFilters({ sprint: [], assignee: [], priority: [], type: [], tier: null })} className="text-xs text-ink-3 hover:text-ink">Xóa tất cả</button>}
    </div>
  );
}

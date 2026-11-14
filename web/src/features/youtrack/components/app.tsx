"use client";

import { Plus, CalendarCheck, Rocket, History, ClipboardList, FlaskConical, LayoutDashboard, ListChecks, Menu, RotateCw, Search, Sparkles, UserPlus, UserSearch, X } from "lucide-react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Toaster, TopBar } from "@/app/_components/shell";
import { YtLogo } from "@/shared/components/yt-logo";
import { Button } from "@/shared/components/ui/button";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { fmtClock, type Key, tMaybe, useT } from "@/shared/lib/i18n";
import { goKey, typing } from "@/features/telegram/lib/inbox";
import { useNow } from "@/shared/hooks/use-now";
import { fold } from "@/shared/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { ShortcutList, YT_KEYS } from "@/shared/components/shortcuts";
import { getPref, saveYtRole, setPref, YT_ROLES } from "@/shared/lib/prefs";
import { cn, durShort } from "@/shared/lib/utils";
import { AI_MAX, QUICK, rank, riskOf, shortName, shortSp, TIER_LABEL, UNASSIGNED } from "@/features/youtrack/lib/yt";
import { useAiWait } from "@/shared/components/ai/fetching";
import { Avatar, MultiSelect, POP, YtFetching } from "./bits";
import { DashboardPage } from "./dashboard";
import { DevHome, PoHome, QaHome } from "./home";
import { CreateTicket } from "./create";
import { Palette } from "./palette";
import { useWatch, WatchBell } from "./watch";
import { Sheet } from "./sheet";
import { type Mode, type Page, type Scope, useYt, YtProvider } from "./state";
import { PeoplePage } from "./people";
import { HistoryPage } from "./history";
import { TicketsPage } from "./tickets";
import { ReleasePage } from "./release";
import { Pill } from "@/shared/components/ui/segmented";
import { Hint } from "@/shared/components/ui/hint";
import { AiPlug } from "@/shared/components/ai-plug";

const noop = () => () => {};
const G_PAGES: Record<string, Page> = { h: "home", t: "tickets", d: "dash", r: "release", p: "people", a: "ai" };
export function YouTrackApp() {
  // State starts from the URL and localStorage: render in the browser only (the static export prerenders an empty shell).
  const client = useSyncExternalStore(noop, () => true, () => false);
  return client ? <YtProvider><Shell /></YtProvider> : null;
}

const PAGES: Record<Mode, [Page, Key, typeof ListChecks][]> = {
  dev: [["home", "Hôm nay", CalendarCheck], ["tickets", "Ticket", ListChecks], ["dash", "Dashboard", LayoutDashboard], ["release", "Release", Rocket], ["people", "Thành viên", UserSearch]],
  qa: [["home", "Kiểm thử", FlaskConical], ["tickets", "Ticket", ListChecks], ["dash", "Dashboard", LayoutDashboard], ["release", "Release", Rocket], ["people", "Thành viên", UserSearch]],
  po: [["home", "Tổng quan", ClipboardList], ["dash", "Dashboard", LayoutDashboard], ["release", "Release", Rocket], ["people", "Thành viên", UserSearch], ["tickets", "Ticket", ListChecks]],
};
/** What each sidebar page is for, in its hover hint ("home" per role). */
const PAGE_HINT: Record<string, Key> = {
  dev: "Việc của bạn hôm nay: ticket đang làm, tới hạn, cần chú ý.",
  qa: "Ticket chờ test và kết quả kiểm thử gần đây.",
  po: "Tình hình project cho PO: tiến độ, rủi ro, việc cần quyết.",
  tickets: "Danh sách ticket: lọc, tìm, chọn nhiều ticket để hỏi AI.",
  dash: "Biểu đồ và số liệu project; bấm AI trên mỗi thẻ để hỏi về số liệu đó.",
  people: "Tải việc và ticket của từng thành viên.",
  release: "Theo dõi go-live: đặt ngày release, truy vết ticket, bug, liên kết của sprint phát hành thành bảng báo cáo.",
  ai: "Các phiên đã hỏi AI (ticket, dashboard, thành viên): đọc lại và hỏi tiếp ngay tại đây.",
};

function Shell() {
  const y = useYt();
  const t = useT();
  const [collapsed, setCollapsed] = useState(() => getPref("ytSide") === "1");
  const { asideRef, mainRef, markSlide } = useSideSlide(collapsed);
  // first load and a scope / project not warmed yet: the AI fetch scene; the AI chat page keeps its thread, dimmed under a bar
  const wait = useAiWait(y.issues.isPending || (y.issues.isPlaceholderData && y.page !== "ai"));
  const dim = y.issues.isPlaceholderData && !wait;
  const [menu, setMenu] = useState(false);
  const [pal, setPal] = useState(false);
  const [keys, setKeys] = useState(false); // the "?" shortcut sheet
  // ⌘K palette, "?" shortcut sheet, g then h/t/d/r/p/a: the pages (as Telegram's g-keys)
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); setPal((o) => !o); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "j" && y.aiOn) { // ⌘J: AI over the open tickets in view, risky / high priority first
      e.preventDefault();
      const at = Date.now(), ids = y.rows.filter((i) => !i.resolved).sort((a, b) => +!riskOf(a, at) - +!riskOf(b, at) || rank(a) - rank(b) || b.updated - a.updated).slice(0, AI_MAX).map((i) => i.id);
      if (ids.length) y.setSheet({ kind: "work", title: t("Hỏi AI về phạm vi đang xem (⌘J)"), ids });
      return;
    }
    if (typing(e)) return;
    if (e.key === "?") { e.preventDefault(); setKeys(true); return; }
    if (e.key === "g") { goKey.arm(); return; }
    const to = G_PAGES[e.key];
    if (to && (to !== "ai" || y.aiOn) && goKey.take()) { e.preventDefault(); y.setPage(to); }
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => onKey(e);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);
  useWatch();
  // No YouTrack token yet (the server answers empty "mock" lists): go to its setup in Settings, like Telegram does before login.
  const router = useRouter();
  const mock = !!y.config?.mock;
  useEffect(() => { if (mock) router.replace("/settings/#youtrack"); }, [mock, router]);
  const pages = y.aiOn ? [...PAGES[y.mode], ["ai", "Lịch sử AI", History] as (typeof PAGES)[Mode][number]] : PAGES[y.mode];
  const now = useNow(); // badge on the home page: my risky tickets (Dev), the ones I test (QA), the team's (PO)
  const risk = y.rows.filter((i) => (y.mode === "po" || (y.mode === "qa" ? i.qc : i.assignee) === y.me) && riskOf(i, now)).length;
  const title = pages.find(([p]) => p === y.page)?.[1];

  const go = (p: Page) => { y.setPage(p); setMenu(false); };
  // collapsing keeps the labels: the narrowing aside clips them while they fade, so nothing pops or jumps
  const fade = cn("whitespace-nowrap transition-opacity duration-(--dur-short)", collapsed && "md:opacity-0");

  // no role yet: ask first (nothing is loaded until then)
  if (!y.role) return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <div className="sticky top-0 z-30"><TopBar module="youtrack" /></div>
      <RolePicker />
    </div>
  );

  return (
    <div className={cn("grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]", y.dense && "yt-dense")}>
      <div className="yt-noprint sticky top-0 z-30">
          <TopBar module="youtrack">
            <Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="Menu" onClick={() => setMenu(true)}><Menu /></Button>
          </TopBar>
      </div>
      <div className={cn("grid min-h-0 grid-cols-[minmax(0,1fr)]", collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[15rem_minmax(0,1fr)]")}>
          <>
            {menu && <div aria-hidden className="fixed inset-0 z-40 bg-(--scrim) md:hidden" onClick={() => setMenu(false)} />}
            <aside ref={asideRef} className={cn("yt-noprint fixed inset-y-0 left-0 z-50 flex w-60 flex-col gap-1 overflow-x-clip border-r bg-paper-2 p-3 transition-transform duration-(--dur-short) md:sticky md:top-11 md:z-10 md:h-[calc(100dvh-2.75rem)] md:w-auto md:translate-x-0",
              menu ? "translate-x-0 shadow-pop" : "-translate-x-full")}>
              <div className="mb-2 flex min-h-10 items-center gap-3 px-1">
                <Hint text={t("Thu gọn / mở rộng menu")}><button type="button" onClick={() => { markSlide(); setPref("ytSide", collapsed ? "0" : "1"); setCollapsed(!collapsed); }} aria-label={t("Thu gọn / mở rộng menu")} aria-expanded={!collapsed}
                  className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-input)] max-md:pointer-events-none"><YtLogo className="size-8" /></button></Hint>
                <span className={cn("grid leading-tight", fade)}><span className="text-sm font-bold">YouTrack</span><span className="text-xs text-ink-3">{y.projects.find((p) => p.shortName === y.project)?.name ?? y.project}</span></span>
                <Button size="icon-xs" variant="ghost" className="ml-auto md:hidden" aria-label={t("Đóng menu")} onClick={() => setMenu(false)}><X /></Button>
              </div>
              {/* project and role rarely change: they sit here, not in the page header; the role stays in sight and switches in place */}
              <div className={cn("mb-2 grid gap-1.5", collapsed && "md:hidden")}>
                <Dropdown label="Project" value={y.project} onChange={y.setProject} className="text-sm" prefix={<span className="shrink-0 font-normal text-ink-3">Project</span>}
                  options={(y.projects.length ? y.projects : [{ shortName: y.project, name: y.project }]).map((p) => ({ value: p.shortName, label: p.shortName, hint: p.name }))} />
                <Dropdown label={t("Vai trò hiện tại")} value={y.mode} onChange={(r) => y.setMode(r as Mode)} className="text-sm" prefix={<span className="shrink-0 font-normal text-ink-3">{t("Vai trò")}</span>}
                  options={YT_ROLES.map(([r, name]) => ({ value: r, label: t(name), hint: t("Trang chủ: {x}", { x: t(PAGES[r][0][1]) }) }))} />
              </div>
              <nav aria-label={t("Trang")} className="mt-2 grid grid-cols-1 gap-1">
                {pages.map(([p, label, Icon]) => (
                  <Hint key={p} title={t(label)} text={`${PAGE_HINT[p === "home" ? y.mode : p] ? t(PAGE_HINT[p === "home" ? y.mode : p]) : ""}${p === "home" && risk > 0 ? ` ${t("{n} ticket cần xử lý ngay (quá hạn, tới hạn, blocked, đứng lâu).", { n: risk })}` : ""}`}><button type="button" aria-current={y.page === p ? "page" : undefined} onClick={() => go(p)} aria-label={t(label)}
                    className={cn("relative flex min-h-9 items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-left text-sm font-medium transition-colors duration-(--dur-micro)",
                      y.page === p ? "text-hl-2" : "text-ink-3 hover:bg-paper-3 hover:text-ink")}>
                    {y.page === p && <Pill id="yt-nav" className="inset-0 rounded-[var(--radius-input)] bg-hl-wash" />}
                    <Icon className="relative size-5 shrink-0" aria-hidden /><span className={cn("relative flex-1", fade)}>{t(label)}</span>
                    {p === "home" && risk > 0 && <span
                      className={cn("relative rounded-full bg-signal px-1.5 font-mono text-xs leading-[18px] text-white tabular-nums", collapsed && "md:absolute md:top-0.5 md:right-0.5")}>{risk}<span className="sr-only"> {t("ticket cần xử lý ngay")}</span></span>}
                  </button></Hint>
                ))}
              </nav>
              {!y.config?.mock && (
                <Hint text={t("Tạo ticket mới, AI soạn từ ghi chú thô")}><button type="button" onClick={() => { setMenu(false); y.setNewTicket(""); }} aria-label={t("Tạo ticket")}
                  className="mt-1 flex min-h-9 items-center gap-3 rounded-[var(--radius-input)] border border-dashed border-rule-2 px-2.5 text-sm text-ink-2 hover:bg-paper-3 hover:text-ink">
                  <Plus className="size-5 shrink-0" aria-hidden /><span className={fade}>{t("Tạo ticket")}</span></button></Hint>
              )}
              <div className="mt-auto border-t pt-2"><YtPlug fade={fade} /></div>
            </aside>
          </>

        {/* AI history is a chat: on wide screens the page fits the viewport and only its panes scroll */}
        <main ref={mainRef} className={cn("min-w-0 px-3 pb-10 sm:px-5", y.page === "ai" && "lg:flex lg:h-[calc(100dvh-2.75rem)] lg:flex-col lg:pb-4",
          // tickets: from md up the page fits the viewport, so header, filters and bulk bar stay put and only the table scrolls
          y.page === "tickets" && "md:flex md:h-[calc(100dvh-2.75rem)] md:flex-col md:pb-4",
          // the wait scene fills what is left under the header, so it sits in the middle of the screen
          wait && "flex h-[calc(100dvh-2.75rem)] flex-col")}>
          <Header title={title ? t(title) : ""} onPalette={() => setPal(true)} />
          {(y.configError || y.issues.isError || y.sinceError) && (() => {
            const e = (y.configError ?? (y.issues.isError ? y.issues.error : y.sinceError)) as Error, text = t(loadError(e));
            return (
              <div role="alert" className="mb-3 flex items-center gap-3 rounded-md bg-error-wash px-3 py-2 text-sm text-error">
                <span className="grid flex-1 gap-0.5">{text}{e.message !== text && <span className="text-xs opacity-80">{t("Chi tiết: {e}", { e: e.message })}</span>}</span>
                <Button size="sm" variant="outline" onClick={y.refresh}><RotateCw /> {t("Thử lại")}</Button>
              </div>
            );
          })()}
          <FilterChips />
            <AnimatePresence>
              {dim && (
                <motion.div key="bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="sticky top-[var(--yt-top)] z-10 -mt-3 mb-2.5 h-0.5">
                  <div className="h-full overflow-hidden rounded-full bg-paper-3">
                    <motion.div className="h-full w-1/3 rounded-full bg-hl" animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} />
                  </div>
                  <motion.div role="status" initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}
                    className="absolute inset-x-0 top-3 mx-auto flex w-fit items-center gap-2 rounded-full bg-cotton whitespace-nowrap px-3 py-1.5 text-xs font-medium text-ink-2 shadow-pop">
                    {t(y.scope === "group" && !y.group.length ? "Đang tải tất cả ticket" : "Đang tải ticket")}
                    <span aria-hidden className="flex gap-0.5">{[0, 1, 2].map((i) => <span key={i} className="ai-dot size-1 rounded-full bg-hl-2" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            <motion.div key={`${y.mode}:${y.page}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: dim ? 0.55 : 1, y: 0 }} transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
              aria-busy={dim} className={cn(y.page === "ai" && "relative lg:min-h-0 lg:flex-1", y.page === "tickets" && "md:flex md:min-h-0 md:flex-1 md:flex-col", y.page === "ai" && !dim && "ai-in", wait && "flex min-h-0 flex-1 flex-col", dim && "shimmer pointer-events-none select-none")}>
              {wait ? <YtFetching kind={y.page === "ai" ? "sessions" : undefined} /> : y.page === "tickets" ? <TicketsPage /> : y.page === "dash" ? <DashboardPage /> : y.page === "release" ? <ReleasePage /> : y.page === "people" ? <PeoplePage /> : y.page === "ai" && y.aiOn ? <HistoryPage /> : y.mode === "dev" ? <DevHome /> : y.mode === "qa" ? <QaHome /> : <PoHome />}
            </motion.div>
        </main>
      </div>
      <Sheet />
      <Palette open={pal} onClose={() => setPal(false)} />
      <Dialog open={keys} onOpenChange={setKeys}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>{t("Phím tắt YouTrack")}</DialogTitle>
          <div className="grid max-h-[70vh] gap-x-8 gap-y-5 overflow-y-auto md:grid-cols-2">
            {YT_KEYS.map(([name, list]) => (
              <section key={name} aria-label={t(name)} className="grid content-start gap-1">
                <h3 className="text-xs font-bold text-ink-3">{t(name)}</h3>
                <ShortcutList list={list} />
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <CreateTicket />
      <Toaster />
    </div>
  );
}

/** Sidebar collapse without animating the grid: the columns change once, then only the aside's width animates and the page
 *  slides on the compositor (transform), so a heavy page (the ticket table) is laid out once instead of on every frame. */
function useSideSlide(collapsed: boolean) {
  const aside = useRef<HTMLElement>(null), main = useRef<HTMLElement>(null), from = useRef(0);
  useLayoutEffect(() => {
    const a = aside.current, m = main.current, w0 = from.current;
    from.current = 0;
    if (!a || !m || !w0 || w0 === a.offsetWidth || matchMedia("(prefers-reduced-motion: reduce)").matches) return; // first render, mobile drawer, TV
    const css = getComputedStyle(document.documentElement);
    const opt = { duration: durShort(), easing: css.getPropertyValue("--ease-in-out").trim() || "ease-in-out" };
    a.animate([{ width: `${w0}px` }, { width: `${a.offsetWidth}px` }], opt);
    // clip only while sliding: a permanent clip would cut off a ticket table wider than the page
    const g = m.parentElement!, slide = m.animate([{ transform: `translateX(${w0 - a.offsetWidth}px)` }, { transform: "none" }], opt);
    g.style.overflowX = "clip";
    slide.onfinish = slide.oncancel = () => { g.style.overflowX = ""; };
  }, [collapsed]);
  return { asideRef: aside, mainRef: main, markSlide: () => { from.current = aside.current?.offsetWidth ?? 0; } };
}

const ROLE_ICON: Record<Mode, typeof ListChecks> = { dev: CalendarCheck, qa: FlaskConical, po: ClipboardList };

/** First visit (or after "Xóa vai trò"): the page asks which role it should work for. */
function RolePicker() {
  const t = useT();
  return (
    <main className="grid place-items-center px-4 py-10">
      <div className="grid w-full max-w-3xl gap-5">
        <div className="grid gap-1 text-center">
          <h1 className="text-xl font-bold">{t("Bạn dùng YouTrack với vai trò nào?")}</h1>
          <p className="text-sm text-ink-2">{t("Trang chủ, góc nhìn Ticket, Dashboard và AI (cả tóm tắt bên Telegram) sẽ theo vai trò này. Đổi bất cứ lúc nào ở ô Vai trò trên thanh bên, hoặc xóa trong Cài đặt › Chung.")}</p>
        </div>
        <div role="radiogroup" aria-label={t("Vai trò")} className="grid gap-3 sm:grid-cols-3">
          {YT_ROLES.map(([r, name, what]) => {
            const Icon = ROLE_ICON[r];
            return (
              <button key={r} type="button" role="radio" aria-checked={false} onClick={() => saveYtRole(r)}
                className="grid content-start justify-items-start gap-2 rounded-[var(--radius-card)] border border-rule bg-cotton p-4 text-left shadow-stock transition-colors duration-(--dur-micro) hover:border-hl hover:bg-hl-wash">
                <span className="grid size-9 place-items-center rounded-full bg-hl-wash text-hl-2"><Icon className="size-5" aria-hidden /></span>
                <b className="text-base">{t(name)}</b>
                <span className="text-sm text-ink-2">{t(what)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

/** A failed YouTrack load in words the user can act on; the raw reason stays as a secondary line. */
function loadError(e: Error): Key {
  const m = e.message;
  if (e.name === "TypeError" || /failed to fetch|load failed|networkerror/i.test(m)) return "Không liên lạc được dashboard local. Kiểm tra app còn chạy rồi thử lại.";
  if (/\b(401|403)\b|unauthori|forbidden|token/i.test(m)) return "YouTrack từ chối token. Kiểm tra lại token trong Cài đặt › YouTrack.";
  if (/\bHTTP 5\d\d\b|timeout|timed out|unavailable/i.test(m)) return "YouTrack không phản hồi hoặc đang lỗi. Thử lại sau ít phút.";
  return "Không tải được dữ liệu YouTrack.";
}

function Header({ title, onPalette }: { title: string; onPalette: () => void }) {
  const y = useYt();
  // sticky table headers sit right under this bar, which wraps on narrow screens
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--yt-top", `${44 + el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const a = y.filters.assignee, { scope } = y;
  const [open, setOpen] = useState<Scope | null>(null); // the preset whose member editor is open
  const t = useT();
  const scopes = [["me", "Của tôi"], ["team", "Team"], ["group", "Nhóm chọn"]] as const;
  // fetch status read here, not through the provider (it does not re-render on it): re-renders on each fetch start / end
  const fetching = useIsFetching({ queryKey: ["yt", "issues", y.project] }) > 0;
  const at = useQueryClient().getQueryState(y.issuesKey)?.dataUpdatedAt;
  const updated = at ? fmtClock(at) : "--:--";
  return (
    <header ref={ref} className="yt-noprint sticky top-11 z-20 -mx-3 mb-3 flex flex-wrap items-center gap-2 bg-paper/90 px-3 py-2.5 backdrop-blur sm:-mx-5 sm:px-5">
      <h1 className="mr-auto text-lg font-bold">{title}</h1>
      <Hint side="bottom" text={t("Của tôi: ticket bạn được assign hoặc làm QC. Team: bạn và thành viên đã thêm. Nhóm chọn: những người bạn chọn (chưa chọn ai: tất cả mọi người).")}><div role="group" aria-label={t("Phạm vi")} className="flex gap-0.5 rounded-[var(--radius-card)] bg-paper-3 p-0.5 shadow-groove max-sm:order-last max-sm:w-full">
        {scopes.map(([s, l]) => {
          const on = scope === s, team = s !== "me", n = s === "team" ? y.team.length : y.group.length;
          const btn = (
            <button type="button" aria-pressed={on} disabled={s !== "group" && !y.me}
              // the active My team / Group tab opens its member editor (the popover trigger): the people live on the tab, not in a second dropdown
              onClick={team && on ? undefined : () => { y.setScope(s); setOpen(null); }}
              className={cn("relative flex h-7 w-full items-center justify-center gap-1 rounded-[var(--radius-input)] px-2.5 text-xs font-medium whitespace-nowrap transition-colors max-sm:flex-1", on ? "text-hl-ink" : "text-ink-3 hover:text-ink disabled:opacity-50")}>
              {on && <Pill id="yt-scope" className="inset-0 rounded-[var(--radius-input)] bg-hl" />}
              <span className="relative">{t(l)}</span>
              {team && n > 0 && <span className={cn("relative rounded-full px-1.5 text-2xs tabular-nums", on ? "bg-hl-ink/15" : "bg-paper-2")}>{n}</span>}
              {team && on && <><UserPlus className="relative size-3.5" aria-hidden /><span className="sr-only">, {t("sửa thành viên")}</span></>}
            </button>
          );
          return (
            <div key={s} className={cn("relative", team && "max-sm:flex-1")}>
              {team ? (
                <BasePopover.Root open={open === s && on} onOpenChange={(o) => setOpen(o && on ? s : null)}>
                  <BasePopover.Trigger render={btn} />
                  <BasePopover.Portal>
                    <BasePopover.Positioner sideOffset={6} align="start" className="z-40 outline-none">
                      <BasePopover.Popup aria-label={t(s === "team" ? "Team của tôi" : "Nhóm chọn")} className={cn(POP, "p-1")}><TeamMenu group={s === "group"} /></BasePopover.Popup>
                    </BasePopover.Positioner>
                  </BasePopover.Portal>
                </BasePopover.Root>
              ) : btn}
            </div>
          );
        })}
      </div></Hint>
      {/* fixed widths: a label that changes with the filter must not re-wrap the bar (the page jumps) */}
      <MultiSelect label="Sprint" all={t("Tất cả sprint")} options={y.sprintOptions} value={y.filters.sprint} onChange={(sprint) => y.setFilters({ sprint })} render={shortSp} className="w-36" />
      <MultiSelect label={t("Người")} all={t("Tất cả người")} options={y.peopleOptions} value={a} onChange={(assignee) => y.setFilters({ assignee })} render={shortName} className="w-36" />
      <Hint side="bottom" text={t("Mở ticket, chuyển trang, hỏi AI, lọc bằng AI (⌘K)")}><Button size="sm" variant="outline" onClick={onPalette} aria-label={t(y.aiOn ? "Tìm, hỏi AI" : "Tìm")} className="text-ink-3">
        {y.aiOn ? <Sparkles className="text-hl-2" /> : <Search />}<span className="max-xl:hidden">{t(y.aiOn ? "Tìm, hỏi AI" : "Tìm")}</span><kbd className="font-mono text-xs max-lg:hidden">⌘K</kbd>
      </Button></Hint>
      <WatchBell />
      <Hint side="bottom" text={t("Cập nhật lúc {h}, tự làm mới mỗi phút. Bấm để làm mới ngay.", { h: updated })}><Button size="sm" variant="outline" onClick={y.refresh} aria-busy={fetching} aria-label={t("Làm mới")} className="tabular-nums">
        <RotateCw className={cn(fetching && "animate-spin")} /><span className="max-xl:hidden">{updated}</span>
      </Button></Hint>
    </header>
  );
}

/** "My team" members: me (fixed) + people I add; "Group": only the people I add (none = everyone). Saved for next time.
 *  Avatars and a remove ✕ per row so it reads as editing a group, not as the Người filter's checkboxes. */
function TeamMenu({ group }: { group: boolean }) {
  const y = useYt();
  const t = useT();
  const [q, setQ] = useState("");
  const list = group ? y.group : y.members, set = group ? y.setGroup : y.setMembers;
  const add = y.peopleOptions.filter((n) => n !== UNASSIGNED && (group || n !== y.me) && !list.includes(n) && (!q || fold(n).includes(fold(q))));
  const row = "flex items-center gap-2 rounded px-2 py-1.5 text-sm";
  return (
    <>
      <div className="px-2 pt-1.5 pb-1"><p className="text-sm font-bold">{t(group ? "Nhóm chọn" : "Team của tôi")}</p><p className="text-xs text-ink-3">{t(group ? "Tab Nhóm chọn lọc ticket của các thành viên này; chưa chọn ai thì hiện tất cả." : "Tab Team lọc ticket của cả team.")} {t("Lưu cho lần sau.")}</p></div>
      <div className="grid max-h-44 overflow-y-auto">
        {!group && y.me && <div className={row}><Avatar name={y.me} /><span className="flex-1 truncate">{y.me}</span><span className="text-xs text-ink-3">{t("Bạn")}</span></div>}
        <AnimatePresence initial={false}>
          {list.map((n) => (
            <motion.div key={n} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className={cn(row, "group hover:bg-paper-2")}>
              <Avatar name={n} /><span className="flex-1 truncate">{n}</span>
              <button type="button" onClick={() => set(list.filter((x) => x !== n))} aria-label={t(group ? "Bỏ {n} khỏi group" : "Bỏ {n} khỏi team", { n })} className="rounded p-0.5 text-ink-3 hover:bg-paper-3 hover:text-error"><X className="size-3.5" /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-1 border-t border-rule pt-1">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Thêm thành viên…")} aria-label={t(group ? "Tìm người để thêm vào group" : "Tìm người để thêm vào team")}
          className="m-1 h-8 w-[calc(100%-0.5rem)] rounded-md border border-rule bg-paper px-2 text-sm focus:border-hl" />
        <div className="grid max-h-44 overflow-y-auto">
          {add.map((n) => (
            <button key={n} type="button" onClick={() => { set([...list, n]); setQ(""); }} className={cn(row, "text-left text-ink-2 hover:bg-paper-2 hover:text-ink")}>
              <Plus className="size-4 text-ink-3" /><Avatar name={n} className="size-5 text-2xs" /><span className="truncate">{n}</span>
            </button>
          ))}
          {!add.length && <p className="px-2 py-1.5 text-xs text-ink-3">{t(q ? "Không tìm thấy" : "Đã thêm hết mọi người")}</p>}
        </div>
      </div>
    </>
  );
}

/** The active Sprint / Người / Priority / Type / tier filters as removable chips. */
function FilterChips() {
  const y = useYt();
  const t = useT();
  const f = y.filters;
  const chips: [string, string, () => void][] = [
    ...f.sprint.map((v) => ["Sprint", shortSp(v), () => y.setFilters({ sprint: f.sprint.filter((x) => x !== v) })] as [string, string, () => void]),
    ...(y.scope ? [] : f.assignee).map((v) => [t("Người"), v === UNASSIGNED ? v : shortName(v), () => y.setFilters({ assignee: f.assignee.filter((x) => x !== v) })] as [string, string, () => void]),
    ...(y.page === "tickets" ? [...f.state.map((v) => ["State", v, () => y.setFilters({ state: f.state.filter((x) => x !== v) })] as [string, string, () => void]),
      ...f.priority.map((v) => ["Priority", v, () => y.setFilters({ priority: f.priority.filter((x) => x !== v) })] as [string, string, () => void]),
      ...f.type.map((v) => ["Type", v, () => y.setFilters({ type: f.type.filter((x) => x !== v) })] as [string, string, () => void])] : []),
    ...(f.tier != null ? [[t("Tầng"), tMaybe(TIER_LABEL[f.tier]), () => y.setFilters({ tier: null })] as [string, string, () => void]] : []),
    ...(f.quick && QUICK[f.quick] ? [[t("Lọc"), tMaybe(QUICK[f.quick].label), () => y.setFilters({ quick: null })] as [string, string, () => void]] : []),
  ];
  if (!chips.length) return null;
  return (
    <div className="yt-noprint mb-3 flex flex-wrap items-center gap-1.5">
      <AnimatePresence initial={false}>
        {chips.map(([k, v, rm]) => (
          <motion.button layout key={k + v} type="button" onClick={rm} aria-label={t("Gỡ bộ lọc {k} {v}", { k, v })} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-hl-wash px-2.5 text-xs text-hl-2 hover:bg-hl-wash/70">
            <span className="text-ink-3">{k}</span>{v}<X className="size-3" />
          </motion.button>
        ))}
      </AnimatePresence>
      {chips.length > 1 && <button type="button" onClick={() => y.setFilters({ sprint: [], ...(y.scope ? {} : { assignee: [] }), state: [], priority: [], type: [], tier: null, quick: null })} className="text-xs text-ink-3 hover:text-ink">{t("Xóa tất cả")}</button>}
    </div>
  );
}

/** Sidebar footer: the AI robot plugged into YouTrack (no token: unplugged, opens Settings; load failed: dropped). */
function YtPlug({ fade }: { fade: string }) {
  const y = useYt();
  const t = useT();
  const failed = !!y.configError || (y.issues.isError && !y.issues.data);
  const pose = y.config?.mock || failed ? "off" : y.issues.data ? "on" : "try";
  const [title, sub] = y.config?.mock ? [t("Chưa kết nối YouTrack"), t("Bấm để thêm token")]
    : failed ? [t("Mất kết nối YouTrack"), t("Không gọi được YouTrack, đang thử lại")]
    : pose === "try" ? [t("Đang kết nối YouTrack…"), t("Đang tải ticket")]
    : [t("Đã kết nối YouTrack"), y.me ? t("Bạn: {x}", { x: y.me }) : t("Cập nhật mỗi phút")];
  return (
    <AiPlug testId="yt" icon={<YtLogo className="size-6" />} sock="bg-paper-3" textClass={fade} pose={pose} live={!y.issues.isError}
      title={title} sub={sub} subWarn={pose === "off"} href={y.config?.mock ? "/settings/#youtrack" : undefined}
      hint={{ title: t("Kết nối YouTrack"), text: pose === "on" ? t("Đã kết nối {x}, ticket tự làm mới mỗi phút.", { x: y.config?.base ?? "YouTrack" }) : sub }} />
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ExternalLink, GitBranch, Info, Keyboard, Monitor, Moon, RotateCw, Search, Send, SlidersHorizontal, Sparkles, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AiAccounts, ModelEffortPicker, PrefsSection, type Provider, useAccounts, useAiPrefs } from "@/components/ai";
import { TopBar } from "@/components/shell";
import { YtLogo } from "@/components/yt-logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Pill, Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { PromptManager } from "@/components/yt/prompts";
import { WorkflowSection } from "@/components/yt/workflow";
import { api, ApiError, errorText, statusQuery } from "@/lib/api";
import { clearDrafts, fold, toast } from "@/lib/inbox";
import { ACCENTS, applyRowActions, applyTheme, INTRO_MAX, type Look, onPrefs, OVERDUE_CHOICES, PLATFORMS, readIntro, readLook, readNotify, readOverdueHours, readPlatform, readReportAt, readRowActions, readTheme, readYtRole, type ReportAt, saveLook, saveReportAt, saveYtRole, setPref, type ThemePref, type UiStyle, YT_ROLES, type YtRole } from "@/lib/prefs";
import { clearLoopItems } from "@/lib/report-back";
import { cn } from "@/lib/utils";
import { yt } from "@/lib/yt";

type GroupId = "general" | "telegram" | "youtrack" | "ai" | "github" | "shortcuts";
/** id, name, the nav's one-liner, the page's lead. */
const GROUPS: [GroupId, string, React.ComponentType<{ className?: string }>, string, string][] = [
  ["general", "Chung", SlidersHorizontal, "Vai trò, giao diện", "Vai trò và giao diện, dùng cho cả Telegram lẫn YouTrack. Lưu trên trình duyệt này."],
  ["telegram", "Telegram", Send, "Tài khoản, AI, hàng chờ", "Tài khoản lưu trên máy này (data/); các mục khác lưu trên trình duyệt này."],
  ["youtrack", "YouTrack", YtLogo, "Kết nối, AI, workflow", "Kết nối, hướng dẫn cho AI, kho prompt, workflow và báo cáo release."],
  ["ai", "AI", Sparkles, "CLI, model, tài khoản", "CLI nào chạy các tính năng AI, model/effort cho từng loại việc và tài khoản của từng CLI."],
  ["github", "Cập nhật", GitBranch, "Bản mới từ GitHub", "Lấy bản mới từ GitHub rồi khởi động lại server."],
  ["shortcuts", "Phím tắt", Keyboard, "Inbox và YouTrack", "Phím một chữ không chạy khi đang gõ trong ô nhập. Bấm ? trong Inbox để mở nhanh."],
];

function useStatus() {
  // No event stream on this page: poll until Telegram settles, so "Đang kết nối…" turns into the result by itself.
  return useQuery({ ...statusQuery, refetchInterval: (q) => (q.state.data?.state === "connected" ? false : 2000) });
}

/** The settings page (/settings/#group): every module's settings, one group at a time. */
export function SettingsPage() {
  const [tab, setTab] = useState<GroupId | null>(null); // null until the hash is read (static export: no location on the server)
  // Layout effect, not effect: runs after Next has pushed the new URL and re-renders before paint, so neither the first frame nor the module crossfade shows an empty page.
  useLayoutEffect(() => {
    const read = () => setTab((GROUPS.find(([id]) => `#${id}` === location.hash)?.[0]) ?? "general");
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);
  const [, label, Icon, , lead] = GROUPS.find(([id]) => id === (tab ?? "general"))!;
  const [switched, setSwitched] = useState(false); // group switches get their own quick rise; opening the page uses .page-in on the whole body
  const pick = (id: GroupId) => { history.replaceState(null, "", `#${id}`); setTab(id); setSwitched(true); scrollTo({ top: 0 }); };
  const [ytView, setYtView] = useState<YtView>("connect");
  // A search hit: open its group (and YouTrack sub-view), then bring its card into view and flash it.
  const [jump, setJump] = useState<{ card?: string; at: number } | null>(null);
  const go = (e: Entry) => {
    history.replaceState(null, "", `#${e.g}`);
    setTab(e.g);
    setSwitched(true);
    if (e.view) setYtView(e.view);
    setJump({ card: e.card, at: Date.now() });
  };
  useEffect(() => {
    if (!jump) return;
    const el = jump.card ? document.querySelector<HTMLElement>(`main section[aria-label="${CSS.escape(jump.card)}"]`) : null;
    if (!el) return void scrollTo({ top: 0 });
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.dataset.flash = "";
    const t = setTimeout(() => delete el.dataset.flash, 1600);
    return () => { clearTimeout(t); delete el.dataset.flash; };
  }, [jump]);
  const router = useRouter();
  const back = () => (history.length > 1 ? router.back() : router.push("/"));
  // A dot on the groups that need a look: Telegram not signed in / offline, YouTrack on sample data.
  const st = useStatus().data;
  const attention: Partial<Record<GroupId, string>> = st ? {
    ...(st.state !== "connected" && st.state !== "connecting" && { telegram: "Telegram chưa kết nối" }),
    ...(!st.youtrack_configured && { youtrack: "Chưa có token YouTrack" }),
  } : {};
  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <div className="sticky top-0 z-30"><TopBar module="settings" /></div>
      <div className="page-in mx-auto grid w-full max-w-5xl grid-cols-1 content-start gap-6 px-4 py-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10 md:py-10">
        <nav aria-label="Mục cài đặt" className="sticky top-11 z-20 -mx-4 -mt-6 grid min-w-0 content-start gap-3 bg-paper px-4 pt-6 pb-2 md:top-[calc(2.75rem+2.5rem)] md:m-0 md:self-start md:bg-transparent md:p-0">
          <button type="button" onClick={back} className="flex w-fit items-center gap-1.5 text-sm text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Quay lại
          </button>
          <h1 className="text-xl font-semibold tracking-tight">Cài đặt</h1>
          <SettingsSearch onGo={go} />
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:grid md:gap-0.5 md:overflow-visible md:px-0">
            {GROUPS.map(([id, name, NavIcon, short]) => {
              const on = tab === id;
              return (
                <a key={id} href={`#${id}`} aria-current={on ? "page" : undefined} onClick={(e) => { e.preventDefault(); pick(id); }}
                  className={cn("group relative flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 no-underline transition-colors duration-(--dur-micro)", !on && "hover:bg-paper-3")}>
                  {on && <Pill id="settings-nav" className="inset-0 rounded-lg bg-hl-wash" />}
                  <span className={cn("relative grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-(--dur-micro)", on ? "bg-hl text-hl-ink" : "bg-paper-2 text-ink-3 shadow-groove group-hover:text-ink")}>
                    <NavIcon className="size-4" aria-hidden />
                  </span>
                  <span className="relative grid min-w-0">
                    <span className={cn("text-sm", on ? "font-semibold text-hl-2" : "font-medium text-ink-2 group-hover:text-ink")}>{name}</span>
                    <span className="hidden truncate text-xs text-ink-3 md:block">{short}</span>
                  </span>
                  {attention[id] && <span role="img" aria-label={attention[id]} className="relative ml-auto size-2 shrink-0 rounded-full bg-signal" />}
                </a>
              );
            })}
          </div>
        </nav>

        <main key={tab ?? ""} className={cn("grid min-w-0 content-start gap-4", switched && "animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short) ease-(--ease-out) motion-reduce:animate-none")}>
          <header className={cn("mb-1 flex items-start gap-3", !tab && "invisible")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-hl-wash text-hl-2"><Icon className="size-5" aria-hidden /></span>
            <span className="grid gap-0.5">
              <h2 className="text-lg leading-tight font-semibold">{label}</h2>
              <p className="text-sm text-ink-3">{lead}</p>
            </span>
          </header>
          {tab === "general" && <GeneralGroup />}
          {tab === "telegram" && <TelegramGroup />}
          {tab === "youtrack" && <YouTrackGroup view={ytView} setView={setYtView} />}
          {tab === "ai" && <AiGroup />}
          {tab === "github" && <Card title="Cập nhật app" info="Bản cài: tải gói mới từ GitHub Releases. Bản git: git pull, build lại giao diện (cần quyền đọc repo)."><UpdateSection /></Card>}
          {tab === "shortcuts" && <ShortcutsGroup />}
        </main>
      </div>
    </div>
  );
}

// ---- search -------------------------------------------------------------------------------------

/** One findable setting: its name, group, the card holding it (scrolled to), YouTrack's sub-view, extra words to match. */
type Entry = { t: string; g: GroupId; card?: string; view?: YtView; k?: string };
const ENTRIES: Entry[] = [
  { t: "Vai trò Dev, QA/QC, PO/PM", g: "general", card: "Vai trò", k: "role" },
  { t: "Chế độ màu sáng / tối", g: "general", card: "Giao diện", k: "theme dark light he thong" },
  { t: "Phong cách giao diện", g: "general", card: "Giao diện", k: "don gian mac dinh ruc ro style" },
  { t: "Màu chủ đạo và gradient", g: "general", card: "Giao diện", k: "accent hue mau" },
  { t: "Tài khoản Telegram, API ID/Hash", g: "telegram", card: "Tài khoản Telegram", k: "dang nhap login so dien thoai 2fa ma" },
  { t: "Giới thiệu bản thân cho AI", g: "telegram", card: "Giới thiệu bản thân cho AI", k: "intro toi la ai" },
  { t: "Tóm tắt theo nền tảng", g: "telegram", card: "AI cho Telegram", k: "android ios mobile platform" },
  { t: "Model và effort cho Briefing, Digest", g: "telegram", card: "AI cho Telegram", k: "tom tat nhom" },
  { t: "Ngưỡng quá hạn", g: "telegram", card: "Hàng chờ và thông báo", k: "overdue gio cho lau" },
  { t: "Thông báo khi có tag mới", g: "telegram", card: "Hàng chờ và thông báo", k: "notification bao" },
  { t: "Nút thao tác trên tin", g: "telegram", card: "Hàng chờ và thông báo", k: "ghim ngu canh mo telegram hover" },
  { t: "Xóa nháp và danh sách Báo lại", g: "telegram", card: "Dữ liệu trên trình duyệt này", k: "draft du lieu" },
  { t: "Tài khoản YouTrack, URL và token", g: "youtrack", card: "Tài khoản YouTrack", view: "connect", k: "ket noi" },
  { t: "Báo cáo release tự động", g: "youtrack", card: "Báo cáo release", view: "connect", k: "report lich hang ngay" },
  { t: "Instructions cho AI (YouTrack)", g: "youtrack", card: "Instructions cho AI", view: "ai", k: "huong dan notes team" },
  { t: "Kho prompt", g: "youtrack", card: "Kho prompt", view: "ai", k: "ghim phien ai" },
  { t: "Workflow State", g: "youtrack", card: "Workflow", view: "workflow", k: "luong mui ten board" },
  { t: "Dùng AI nào: Claude, Codex, Antigravity", g: "ai", card: "Dùng AI nào", k: "provider cli" },
  { t: "Model và effort", g: "ai", card: "Model và effort", k: "tom tat soan nhap task agent briefing thu model" },
  { t: "Model và effort cho AI YouTrack", g: "youtrack", card: "Model và effort", view: "ai", k: "model effort youtrack doc code ticket" },
  { t: "Tự hạ model khi gần hết hạn mức", g: "ai", card: "Model và effort", k: "fallback quota" },
  { t: "Tài khoản CLI AI", g: "ai", card: "Tài khoản", k: "dang nhap usage history claude codex antigravity" },
  { t: "Cập nhật app từ GitHub", g: "github", card: "Cập nhật app", k: "update phien ban moi" },
  { t: "Tự động cập nhật", g: "github", card: "Cập nhật app", k: "auto update" },
  { t: "Phím tắt Telegram Inbox và YouTrack", g: "shortcuts", k: "keyboard shortcut" },
];
const GROUP_NAME = Object.fromEntries(GROUPS.map(([id, name]) => [id, name])) as Record<GroupId, string>;
const INDEX = ENTRIES.map((e) => ({ e, hay: fold(`${e.t} ${e.card ?? ""} ${GROUP_NAME[e.g]} ${e.k ?? ""}`) }));

/** Find a setting by name across every group; Enter / click opens it. "/" focuses the box. */
function SettingsSearch({ onGo }: { onGo: (e: Entry) => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      box.current?.focus();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  const words = fold(q).split(/\s+/).filter(Boolean);
  const hits = words.length ? INDEX.filter((x) => words.every((w) => x.hay.includes(w))).map((x) => x.e).slice(0, 8) : [];
  const cur = Math.min(at, Math.max(0, hits.length - 1));
  const pick = (e: Entry) => { onGo(e); setQ(""); box.current?.blur(); };
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
      <Input ref={box} role="combobox" aria-label="Tìm cài đặt" aria-autocomplete="list" aria-expanded={open && words.length > 0} aria-controls="settings-search-list"
        aria-activedescendant={open && hits.length ? `settings-hit-${cur}` : undefined} placeholder="Tìm cài đặt…" value={q} className="h-8 pr-7 pl-8"
        onChange={(e) => { setQ(e.target.value); setAt(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, Math.min(hits.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)))); }
          else if (e.key === "Enter" && hits[cur]) { e.preventDefault(); pick(hits[cur]); }
          else if (e.key === "Escape") { if (q) setQ(""); else e.currentTarget.blur(); }
        }} />
      {!q && <kbd aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-rule bg-paper-2 px-1 font-mono text-[0.625rem] text-ink-3">/</kbd>}
      {open && words.length > 0 && (
        <ul id="settings-search-list" role="listbox" aria-label="Kết quả tìm cài đặt"
          className="absolute inset-x-0 top-full z-40 mt-1 grid max-h-80 overflow-y-auto rounded-lg bg-cotton p-1 shadow-pop animate-in fade-in-0 zoom-in-95 duration-(--dur-micro) motion-reduce:animate-none">
          {hits.map((e, i) => (
            <li key={e.t} id={`settings-hit-${i}`} role="option" aria-selected={i === cur}
              onMouseDown={(ev) => ev.preventDefault()} onMouseEnter={() => setAt(i)} onClick={() => pick(e)}
              className={cn("grid cursor-pointer gap-0.5 rounded-md px-2.5 py-1.5", i === cur && "bg-paper-2")}>
              <span className="text-sm text-ink">{e.t}</span>
              <span className="truncate text-xs text-ink-3">{GROUP_NAME[e.g]}{e.card && ` › ${e.card}`}</span>
            </li>
          ))}
          {!hits.length && <li className="px-2.5 py-2 text-sm text-ink-3">Không có cài đặt nào khớp “{q.trim()}”.</li>}
        </ul>
      )}
    </div>
  );
}

// ---- building blocks ----------------------------------------------------------------------------

/** A settings card: title (+ the long explanation behind the bulb), an optional action on the right, then its rows. */
function Card({ title, info, action, children }: { title: string; info?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid scroll-mt-24 rounded-[var(--radius-card)] border border-rule bg-cotton shadow-stock outline-offset-2 data-flash:outline-2 data-flash:outline-hl">
      <header className="flex min-h-11 items-center gap-1.5 px-4 pt-3 sm:px-5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {info && <InfoHint title={title} text={info} />}
        {action && <span className="ml-auto flex items-center gap-2">{action}</span>}
      </header>
      <div className="grid divide-y divide-rule px-4 pb-4 sm:px-5">{children}</div>
    </section>
  );
}

function InfoHint({ title, text }: { title: string; text: string }) {
  return (
    <Hint side="bottom" title={title} text={text}>
      <button type="button" aria-label={`Giải thích: ${title}`} className="grid size-6 place-items-center rounded-full text-ink-3 transition-colors duration-(--dur-micro) hover:bg-paper-2 hover:text-ink">
        <Info className="size-3.5" aria-hidden />
      </button>
    </Hint>
  );
}

/** One setting: name and a short line on the left, its control on the right (`stack`: the control below, full width). */
function Row({ label, desc, children, stack, htmlFor }: { label: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode; stack?: boolean; htmlFor?: string }) {
  const Name = htmlFor ? "label" : "span";
  return (
    <div className={cn("grid gap-2.5 py-3 first:pt-1 last:pb-0", !stack && "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6")}>
      <span className="grid gap-0.5">
        <Name htmlFor={htmlFor} className="text-sm font-medium text-ink">{label}</Name>
        {desc && <span className="text-xs leading-relaxed text-ink-3">{desc}</span>}
      </span>
      {children !== undefined && <div className={cn("min-w-0", !stack && "sm:justify-self-end")}>{children}</div>}
    </div>
  );
}

/** A status line with a coloured dot (the word carries the meaning, the dot only repeats it). */
function StatusLine({ tone, children }: { tone: "ok" | "warn" | "idle" | "error"; children: React.ReactNode }) {
  const dot = { ok: "bg-ok", warn: "bg-signal", idle: "bg-ink-3 animate-pulse", error: "bg-error" }[tone];
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
      <span className={cn("min-w-0", tone === "ok" ? "text-ink" : tone === "error" ? "text-error" : tone === "warn" ? "text-signal-2" : "text-ink-3")}>{children}</span>
    </span>
  );
}

const linkCls = "inline-flex w-fit items-center gap-1 text-xs text-hl-2 underline decoration-hl underline-offset-[3px]";
const quietBtn = "w-fit text-xs text-ink-3 underline underline-offset-[3px] hover:text-ink";

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative block h-5 w-9 shrink-0 rounded-full transition-colors duration-(--dur-short) disabled:cursor-not-allowed disabled:opacity-40", checked ? "bg-hl" : "bg-paper-3 shadow-groove")}>
      <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-cotton shadow-stock transition-transform duration-(--dur-short) ease-(--ease-out)", checked && "translate-x-4")} />
    </button>
  );
}

// ---- Chung --------------------------------------------------------------------------------------

const THEMES = [["light", "Sáng", Sun], ["dark", "Tối", Moon], ["system", "Theo hệ thống", Monitor]] as const;

function GeneralGroup() {
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  return <>
    <Card title="Vai trò" info="Telegram và YouTrack theo vai trò này: trang chủ, Dashboard, góc nhìn của AI khi tóm tắt và tạo ticket. QA, PO không dùng AI Agent nên không cần thư mục code.">
      <RoleSection />
    </Card>
    <Card title="Giao diện">
      <Row label="Chế độ màu" stack>
        <Segmented id="set-theme" variant="card" label="Giao diện" value={theme} onChange={(v) => { setTheme(v); applyTheme(v); }}
          items={THEMES.map(([v, name, ThemeIcon]) => ({ value: v, label: <><ThemeIcon className="size-3.5" aria-hidden />{name}</> }))} />
      </Row>
      <LookSection />
    </Card>
  </>;
}

/** The role (Telegram + YouTrack): pick one, or clear it so the YouTrack page asks again. */
function RoleSection() {
  const [role, setRole] = useState(readYtRole);
  const pick = (r: YtRole | null) => { setRole(r); saveYtRole(r); };
  return (
    <div className="grid gap-2.5 pt-1">
      <div role="radiogroup" aria-label="Vai trò" className="grid gap-2 sm:grid-cols-3">
        {YT_ROLES.map(([r, name, what]) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => pick(r)}
            className={cn("grid content-start gap-1 rounded-lg border p-3 text-left transition-[background-color,border-color] duration-(--dur-micro)", role === r ? "border-hl bg-hl-wash" : "border-rule hover:border-rule-2 hover:bg-paper-2")}>
            <span className="flex items-center justify-between gap-2 text-sm font-semibold">
              {name}
              <span aria-hidden className={cn("grid size-4 place-items-center rounded-full border", role === r ? "border-hl bg-hl text-hl-ink" : "border-rule-2")}>
                {role === r && <Check className="size-3" />}
              </span>
            </span>
            <span className="text-xs leading-relaxed text-ink-3">{what}</span>
          </button>
        ))}
      </div>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        {role ? "Xóa thì trang YouTrack sẽ hỏi lại; Telegram tạm coi như Dev." : "Chưa chọn: Telegram coi như Dev, mở YouTrack sẽ hỏi bạn chọn."}
        {role && <button type="button" className={quietBtn} onClick={() => pick(null)}>Bỏ chọn vai trò</button>}
      </span>
    </div>
  );
}

const STYLES: { value: UiStyle; label: React.ReactNode; hint: string }[] = [
  { value: "simple", label: "Đơn giản", hint: "Phẳng, màu dịu, không gradient, chuyển động nhanh gọn." },
  { value: "default", label: "Mặc định", hint: "Cân bằng: nền ấm nhẹ, bóng mềm, màu nhấn rõ." },
  { value: "vivid", label: <>Rực rỡ <span className="rounded-sm bg-hl-wash px-1 text-[10px] font-semibold text-hl-2">Pro</span></>,
    hint: "Màu đậm hơn, nền loang theo màu của bạn, nút phát sáng, chuyển động nảy; bật gradient thì màu chạy chậm." },
];
const WHEEL = `linear-gradient(to right in oklch, ${Array.from({ length: 37 }, (_, i) => `oklch(66% 0.17 ${i * 10})`).join()})`;
const swatch = (h: number) => `oklch(58% 0.13 ${h})`;

/** Each member's look, saved in this browser and applied in every open tab (the boot script in app/layout.tsx). */
function LookSection() {
  const [look, setLook] = useState<Look>(readLook);
  const set = (patch: Partial<Look>) => { const next = { ...look, ...patch }; setLook(next); saveLook(next); };
  const simple = look.style === "simple";
  return <>
    <Row label="Phong cách" desc={STYLES.find((o) => o.value === look.style)?.hint} stack>
      <Segmented id="set-style" variant="card" label="Phong cách" value={look.style} onChange={(style) => set({ style })} items={STYLES} />
    </Row>
    <Row label="Màu chủ đạo" desc={look.hue >= 60 && look.hue <= 100 ? <span className="text-warn">Gần màu hổ phách dùng cho tin “cần bạn” (quá hạn), dễ lẫn.</span> : undefined} stack>
      <div className="grid gap-2.5">
        <div role="radiogroup" aria-label="Màu có sẵn" className="flex flex-wrap gap-1.5">
          {ACCENTS.map(([h, name]) => (
            <Hint key={h} side="bottom" text={name}><button type="button" role="radio" aria-checked={look.hue === h} aria-label={name} onClick={() => set({ hue: h })}
              className={cn("grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-cotton transition-shadow duration-(--dur-micro)",
                look.hue === h ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-rule-2")}
              style={{ background: swatch(h) }}>
              {look.hue === h && <Check className="size-3.5 text-white" aria-hidden />}
            </button></Hint>
          ))}
        </div>
        <HueSlider label="Kéo để chọn màu chủ đạo" value={look.hue} onChange={(hue) => set({ hue })} />
      </div>
    </Row>
    <Row label="Gradient" desc={simple ? "Phong cách Đơn giản không dùng gradient." : "Nút, tab đang mở, chip chọn phối từ màu chủ đạo sang màu thứ hai."}>
      <Switch label="Gradient" checked={look.gradient && !simple} disabled={simple} onChange={(gradient) => set({ gradient })} />
    </Row>
    {look.gradient && !simple && (
      <div className="grid gap-2 py-3 last:pb-0">
        <HueSlider label="Kéo để chọn màu thứ hai của gradient" value={look.hue2} onChange={(hue2) => set({ hue2 })} />
        <div aria-hidden className="h-7 rounded-md" style={{ background: `linear-gradient(120deg, ${swatch(look.hue)}, ${swatch(look.hue2)})` }} />
      </div>
    )}
  </>;
}

function HueSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <input type="range" min={0} max={359} step={1} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}
      className="hue-range" style={{ "--track": WHEEL, "--thumb": swatch(value) } as React.CSSProperties} />
  );
}

// ---- Telegram -----------------------------------------------------------------------------------

/** Telegram-only preferences: account, who you are for the AI, Briefing's model, the queue. */
function TelegramGroup() {
  const [overdue, setOverdue] = useState(readOverdueHours);
  const [rowActions, setRowActions] = useState(readRowActions);
  const [platform, setPlatform] = useState(readPlatform);
  const [notify, setNotify] = useState(readNotify);
  const [notifyNote, setNotifyNote] = useState("");
  async function toggleNotify(on: boolean) {
    if (on) {
      if (typeof Notification === "undefined") return setNotifyNote("Trình duyệt này không hỗ trợ thông báo.");
      const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (p !== "granted") return setNotifyNote("Trình duyệt đang chặn thông báo cho trang này; bật lại trong quyền của trang.");
    }
    setNotifyNote("");
    setNotify(on);
    setPref("notify", on ? "1" : "0");
  }

  return <>
    <Card title="Tài khoản Telegram" info="API ID/Hash và phiên đăng nhập chỉ lưu trên máy này (thư mục data/).">
      <TelegramSection />
    </Card>

    <Card title="Giới thiệu bản thân cho AI" info="AI phía Telegram (tóm tắt, soạn nháp, Briefing, tạo ticket từ tin, Đối chiếu BE, AI Agent) đọc phần này để biết bạn làm gì, rành gì, cần gì. Chưa có thì AI phải đoán, dễ lan man và lệch chuyên môn. Bên YouTrack dùng Instructions cho AI riêng (Cài đặt › YouTrack). Lưu trên trình duyệt này.">
      <IntroSection />
    </Card>

    <Card title="AI cho Telegram">
      <Row label="Tóm tắt theo nền tảng" desc="AI tập trung vào phần việc của nền tảng này khi tóm tắt và soạn nháp." stack>
        <Segmented id="set-platform" variant="card" label="Tóm tắt theo nền tảng" value={platform} onChange={(v) => { setPlatform(v); setPref("aiPlatform", v); }}
          items={PLATFORMS.map(([value, name]) => ({ value, label: name }))} />
      </Row>
      <Row label="Model cho Briefing và Digest" desc="Riêng cho tóm tắt cả nhóm. “Như tóm tắt”: dùng model/effort của tóm tắt, soạn nháp (Cài đặt › AI)." stack>
        <ModelEffortPicker kind="brief" variant="full" />
      </Row>
    </Card>

    <Card title="Hàng chờ và thông báo">
      <Row label="Ngưỡng quá hạn" desc="Tin tag chờ lâu hơn ngưỡng này hiện màu hổ phách." stack>
        <Segmented id="set-overdue" variant="card" label="Ngưỡng quá hạn" value={overdue} onChange={(v) => { setOverdue(v); setPref("overdueHours", String(v)); }}
          items={OVERDUE_CHOICES.map((h) => ({ value: h, label: `${h} giờ` }))} />
      </Row>
      <Row label="Thông báo khi có tag mới" desc={notifyNote ? <span role="alert" className="text-warn">{notifyNote}</span> : "Khi tab đang ẩn; giữ luồng cập nhật chạy nền."}>
        <Switch label="Thông báo khi có tag mới" checked={notify} onChange={(v) => void toggleNotify(v)} />
      </Row>
      <Row label="Nút thao tác trên tin" desc="Ghim, ngữ cảnh, mở Telegram. Màn hình cảm ứng luôn hiện." stack>
        <Segmented id="set-row-actions" variant="card" label="Nút thao tác trên tin" value={rowActions} onChange={(v) => { setRowActions(v); applyRowActions(v); }}
          items={[{ value: "hover", label: "Khi rê vào nút Xong" }, { value: "always", label: "Luôn hiện" }]} />
      </Row>
    </Card>

    <Card title="Dữ liệu trên trình duyệt này">
      <Row label="Nháp và danh sách Báo lại" desc="Chỉ lưu trên máy này; tin đã xử lý tự xóa nháp của nó.">
        <Button type="button" size="sm" variant="outline"
          onClick={() => { clearDrafts(); clearLoopItems(); toast({ text: "Đã xóa nháp và danh sách Báo lại trên máy này" }); }}>
          Xóa nháp
        </Button>
      </Row>
    </Card>
  </>;
}

const INTRO_EXAMPLE = "Ví dụ:\nTôi là Android dev (Kotlin, Jetpack Compose, MVVM), team Mobile dự án Bán V2.\nRành: code app, API client. Không rành: BE, Web.\nMuốn AI tập trung: việc phía Android phải làm, câu hỏi cho BE theo từng field.\nBỏ qua phần iOS/Web trừ khi ảnh hưởng tới Android.";

/** Saved as you type (this browser); the counter and the "not written yet" nudge follow it. */
function IntroSection() {
  const [text, setText] = useState(readIntro);
  return (
    <div className="grid gap-2 pt-1">
      <Textarea aria-label="Giới thiệu bản thân cho AI" rows={5} maxLength={INTRO_MAX} value={text} placeholder={INTRO_EXAMPLE} className="text-sm md:text-sm"
        onChange={(e) => { setText(e.target.value); setPref("aiIntro", e.target.value.trim() ? e.target.value : null); }} />
      <span className="flex items-center justify-between gap-3 text-xs text-ink-3">
        {text.trim() ? <span className="flex items-center gap-1 text-ok"><Check className="size-3.5" aria-hidden /> Đã lưu, AI dùng từ lần chạy kế tiếp</span>
          : <span className="text-signal-2">Chưa có: AI phải đoán bạn làm gì.</span>}
        <span className="font-mono tabular-nums">{text.length}/{INTRO_MAX}</span>
      </span>
    </div>
  );
}

const TG_ERRORS: Record<string, string> = {
  phone_invalid: "Số điện thoại không hợp lệ (ghi kèm mã nước, vd. +84…).",
  api_invalid: "API ID/Hash sai, kiểm tra lại trên my.telegram.org.",
  code_invalid: "Mã không đúng.",
  code_expired: "Mã đã hết hạn, gửi lại mã mới.",
  code_not_sent: "Gửi mã trước đã.",
  password_invalid: "Mật khẩu 2FA không đúng.",
  flood_wait: "Telegram tạm chặn vì thử nhiều lần, đợi một lúc rồi thử lại.",
  telegram_not_configured: "Lưu API ID/Hash trước.",
};

/** API ID/Hash from my.telegram.org, then phone → code → 2FA: the whole Telegram setup without .env or a terminal. */
function TelegramSection() {
  const qc = useQueryClient();
  const status = useStatus().data;
  const [editApi, setEditApi] = useState(false);
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "password">("phone");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["status"] });
  const saveApi = useMutation({
    mutationFn: () => api("/telegram/app", { method: "PUT", json: { api_id: Number(apiId), api_hash: apiHash.trim().toLowerCase() } }),
    onSuccess: () => { setEditApi(false); setApiHash(""); setStep("phone"); refresh(); },
  });
  const sendCode = useMutation({
    mutationFn: () => api("/telegram/code", { method: "POST", json: { phone: phone.trim() } }),
    onSuccess: () => { setCode(""); setStep("code"); },
  });
  const signIn = useMutation({
    mutationFn: () => api<{ password_required: boolean }>("/telegram/sign-in", { method: "POST", json: step === "password" ? { password } : { code: code.trim() } }),
    onSuccess: (r) => { if (r.password_required) setStep("password"); else { setPassword(""); refresh(); } },
  });
  if (!status) return <div className="pt-1"><StatusLine tone="idle">Đang kiểm tra…</StatusLine></div>;
  const err = saveApi.error ?? sendCode.error ?? signIn.error;
  const errLine = err && <p role="alert" className="text-xs text-error">{errorText(err, TG_ERRORS, "Không thực hiện được, thử lại.")}</p>;

  if (editApi || !status.telegram_api_id) {
    return (
      <form className="grid gap-2.5 pt-1" onSubmit={(e) => { e.preventDefault(); saveApi.mutate(); }}>
        <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className={linkCls}>
          Lấy API ID/Hash tại my.telegram.org → API development tools <ExternalLink className="size-3" aria-hidden />
        </a>
        <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Input aria-label="API ID" placeholder="API ID" inputMode="numeric" maxLength={12}
            value={apiId} onChange={(e) => setApiId(e.target.value.replace(/\D/g, ""))} />
          <Input aria-label="API Hash" type="password" autoComplete="off" placeholder="API Hash (32 ký tự)" maxLength={32}
            value={apiHash} onChange={(e) => setApiHash(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" aria-busy={saveApi.isPending} disabled={saveApi.isPending || !apiId || !/^[0-9a-fA-F]{32}$/.test(apiHash.trim())}>
            {saveApi.isPending ? "Đang lưu…" : "Lưu"}
          </Button>
          {editApi && <Button type="button" size="sm" variant="ghost" onClick={() => setEditApi(false)}>Hủy</Button>}
        </div>
        {errLine}
      </form>
    );
  }

  const changeApi = <button type="button" className={quietBtn} onClick={() => { setApiId(String(status.telegram_api_id)); setEditApi(true); }}>Đổi API ID/Hash</button>;
  if (status.state === "degraded") {
    return (
      <div className="grid gap-1.5 pt-1">
        <StatusLine tone="warn">Không kết nối được tới Telegram{status.detail ? ` (${status.detail})` : ""}</StatusLine>
        <p className="text-xs text-ink-3">Mạng có thể đang chặn Telegram: bật VPN, app sẽ tự thử lại.</p>
        {changeApi}
      </div>
    );
  }
  if (status.state !== "login_required") {
    const ok = status.state === "connected";
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <StatusLine tone={ok ? "ok" : "idle"}>{ok ? <>Đã đăng nhập{status.telegram_me && <b className="ml-1 font-semibold">{status.telegram_me}</b>}</> : "Đang kết nối Telegram…"}</StatusLine>
        {changeApi}
      </div>
    );
  }
  return (
    <form className="grid gap-2.5 pt-1" onSubmit={(e) => { e.preventDefault(); if (step === "phone") sendCode.mutate(); else signIn.mutate(); }}>
      <StatusLine tone="warn">Chưa đăng nhập Telegram</StatusLine>
      <ol aria-label="Các bước đăng nhập" className="flex gap-1.5 text-xs text-ink-3">
        {(["phone", "code", "password"] as const).map((s, i) => (
          <li key={s} className={cn("rounded-full px-2 py-0.5", step === s ? "bg-hl-wash font-medium text-hl-2" : "bg-paper-2")}>{i + 1}. {{ phone: "Số điện thoại", code: "Mã", password: "2FA" }[s]}</li>
        ))}
      </ol>
      {step === "phone" ? (
        <div className="flex gap-2">
          <Input aria-label="Số điện thoại" type="tel" autoComplete="tel" placeholder="+84 9xx xxx xxx" maxLength={20}
            value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button type="submit" variant="outline" aria-busy={sendCode.isPending} disabled={sendCode.isPending || !/^\+?[0-9 ]{6,20}$/.test(phone.trim())}>
            {sendCode.isPending ? "Đang gửi…" : "Gửi mã"}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {step === "code"
            ? <Input aria-label="Mã đăng nhập" inputMode="numeric" autoComplete="one-time-code" placeholder="Mã Telegram vừa gửi" maxLength={8} autoFocus
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            : <Input aria-label="Mật khẩu 2FA" type="password" autoComplete="current-password" placeholder="Mật khẩu 2FA" maxLength={256} autoFocus
                value={password} onChange={(e) => setPassword(e.target.value)} />}
          <Button type="submit" variant="outline" aria-busy={signIn.isPending} disabled={signIn.isPending || (step === "code" ? code.length < 3 : !password)}>
            {signIn.isPending ? "Đang đăng nhập…" : "Đăng nhập"}
          </Button>
        </div>
      )}
      {step !== "phone" && <button type="button" className={quietBtn} onClick={() => { signIn.reset(); setStep("phone"); }}>Đổi số / gửi lại mã</button>}
      {step === "phone" && changeApi}
      {errLine}
    </form>
  );
}

// ---- YouTrack -----------------------------------------------------------------------------------

type YtView = "connect" | "ai" | "workflow";
const YT_VIEWS: { value: YtView; label: string; title: string }[] = [
  { value: "connect", label: "Kết nối và báo cáo", title: "Token YouTrack, báo cáo release tự động" },
  { value: "ai", label: "AI và prompt", title: "Model và effort, instructions cho AI theo vai trò, kho prompt" },
  { value: "workflow", label: "Workflow", title: "Luồng State cho từng project và vai trò" },
];

function YouTrackGroup({ view, setView }: { view: YtView; setView: (v: YtView) => void }) {
  const role = useSyncExternalStore(onPrefs, readYtRole, () => null);
  const roleName = YT_ROLES.find(([r]) => r === role)?.[1];
  const { p } = useAiPrefs();
  return <>
    <Segmented id="set-yt-view" variant="card" label="Nhóm cài đặt YouTrack" value={view} onChange={setView} items={YT_VIEWS} />
    {view === "connect" && <>
      <Card title="Tài khoản YouTrack" info="Token chỉ lưu trên máy này (thư mục data/), dùng cho trang YouTrack và nút tạo issue.">
        <YouTrackSection />
      </Card>
      <Card title="Báo cáo release" info="AI tự viết báo cáo (kịp release không, bàn giao QC, stuck, kết quả test, việc trễ, quá tải, bug) theo vai trò và project đang chọn bên trang YouTrack. Chạy khi trang YouTrack đang mở; lỡ giờ thì tạo lúc mở lại trong ngày. Xuất MD / PDF / CSV ở card Báo cáo.">
        <ReportSection />
      </Card>
    </>}
    {view === "ai" && <>
      {p && (
        <Card title="Model và effort" info="Cho các tính năng AI YouTrack, của AI đang dùng (Cài đặt › AI). Để “Như Telegram” thì dùng lựa chọn tương ứng bên Telegram. Áp dụng từ lần chạy kế tiếp.">
          <PrefsSection provider={p.provider} scope="youtrack" fixed plain />
        </Card>
      )}
      <Card title="Instructions cho AI" action={roleName && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs text-ink-2 shadow-groove">Vai trò: <b className="font-semibold">{roleName}</b></span>}
        info="Hướng dẫn riêng của team cho vai trò đang chọn (Cài đặt › Chung), AI làm theo ở mọi tính năng YouTrack (phiên AI, test case, triage, báo cáo, tạo ticket…), trừ lọc ticket. Lưu trên máy này (data/).">
        <NotesSection role={role} />
      </Card>
      <Card title="Kho prompt" info="Prompt cho phiên AI YouTrack, dùng chung cả team (data/). Ghim tối đa 5 làm nút cho từng vai trò và số ticket; mặc định 4 prompt có sẵn theo vai trò. Prompt có sẵn xóa được, khôi phục ở cuối danh sách.">
        <div className="pt-1"><PromptManager role={role ?? "dev"} /></div>
      </Card>
    </>}
    {view === "workflow" && (
      <Card title="Workflow" info="Luồng State cho từng project và vai trò đang chọn (Cài đặt › Chung): Dev, QA, PO mỗi vai trò một luồng, dùng chung cả team (data/). Kéo ô để di chuyển, kéo chấm tròn sang ô khác để nối mũi tên, bấm mũi tên rồi Delete (hoặc ×) để xóa; × ở góc ô để ẩn state khỏi workflow, hiện lại ở dòng Đã ẩn. Bật Áp dụng thì menu State và kéo thả trên Board chỉ cho đi theo mũi tên; YouTrack vẫn kiểm tra luồng của nó.">
        <div className="pt-1"><WorkflowSection /></div>
      </Card>
    )}
  </>;
}

const YT_ERRORS: Record<string, string> = {
  youtrack_unauthorized: "Token sai, đã thu hồi hoặc không đủ quyền.",
  youtrack_unreachable: "Không kết nối được YouTrack ở URL này.",
};

/** Paste a permanent token (made on the YouTrack profile page); the server checks it before keeping it. Connected: the form folds away. */
function YouTrackSection() {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["yt-config"],
    queryFn: ({ signal }) => api<{ base: string; mock: boolean; hint: string | null }>("/yt/config", { signal }),
  });
  const [url, setUrl] = useState<string | null>(null); // null: still showing the server's URL
  const [token, setToken] = useState("");
  const [edit, setEdit] = useState(false);
  const base = (url ?? cfg.data?.base ?? "").trim().replace(/\/+$/, "");
  const save = useMutation({
    mutationFn: () => api<{ login: string; name: string }>("/youtrack/auth", { method: "PUT", json: { url: base, token: token.trim() } }),
    onSuccess: () => {
      setToken("");
      setEdit(false);
      void qc.invalidateQueries({ queryKey: ["yt-config"] });
      void qc.invalidateQueries({ queryKey: ["status"] });
      qc.removeQueries({ queryKey: ["yt"] }); // projects/me/issues of the old token (or sample data) are cached forever
    },
  });
  if (!cfg.data) return <div className="pt-1"><StatusLine tone={cfg.isError ? "error" : "idle"}>{cfg.isError ? "Không đọc được cấu hình YouTrack" : "Đang kiểm tra…"}</StatusLine></div>;
  const live = !cfg.data.mock;
  const validUrl = /^https?:\/\/\S+$/.test(base);
  return (
    <div className="grid gap-2.5 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusLine tone={live ? "ok" : "warn"}>
          {save.isSuccess ? <>Đã kết nối: <b className="font-semibold">{save.data.name}</b></> : live ? <>Đang dùng <span className="font-mono text-xs">{cfg.data.base}</span></> : "Chưa có token, trang YouTrack đang hiện dữ liệu mẫu"}
        </StatusLine>
        {live && !edit && <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Đổi URL / token</Button>}
      </div>
      {(!live || edit) && (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Input aria-label="URL YouTrack" placeholder="https://youtrack.example.com" inputMode="url" maxLength={200}
            value={url ?? cfg.data.base} onChange={(e) => setUrl(e.target.value)} />
          <div className="flex gap-2">
            <Input aria-label="Token YouTrack" type="password" autoComplete="off" placeholder={cfg.data.hint ?? "perm-…"} maxLength={500}
              value={token} onChange={(e) => setToken(e.target.value)} />
            <Button type="submit" aria-busy={save.isPending} disabled={save.isPending || !validUrl || token.trim().length < 8}>
              {save.isPending ? "Đang kiểm tra…" : cfg.data.hint ? "Cập nhật" : "Lưu"}
            </Button>
            {edit && <Button type="button" variant="ghost" onClick={() => setEdit(false)}>Hủy</Button>}
          </div>
          {validUrl && (
            <a href={`${base}/users/me?tab=account-security`} target="_blank" rel="noreferrer" className={linkCls}>
              Tạo token trên YouTrack (Hồ sơ → Account Security → New token) <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </form>
      )}
      {save.isError && <p role="alert" className="text-xs text-error">{errorText(save.error, YT_ERRORS, "Không lưu được. Kiểm tra URL (bắt đầu bằng https://) và token.")}</p>}
    </div>
  );
}

const NOTES_HINT: Record<YtRole, string> = {
  qa: "Vd.\n- Test case dạng bảng: ID | Tiền điều kiện | Bước | Kết quả mong đợi | Mức ưu tiên\n- Luôn kiểm cả iOS và Android; môi trường dev rồi staging\n- Khi phân tích bug: nêu mức ảnh hưởng người dùng và vùng regression\n- Viết test case bằng tiếng Việt, tên màn hình giữ tiếng Anh",
  dev: "Vd.\n- Khi chia task: ước lượng theo giờ, tách FE / BE\n- Standup ngắn, tối đa 5 dòng",
  po: "Vd.\n- Báo cáo cho khách hàng: tránh thuật ngữ kỹ thuật\n- Luôn nêu rủi ro về deadline trước",
};

/** Team instructions per role, kept on the server; this box edits the role picked in Chung. */
function NotesSection({ role }: { role: YtRole | null }) {
  const q = useQuery({ queryKey: ["yt", "notes"], queryFn: () => yt.notes() });
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ role: YtRole; text: string } | null>(null); // null: showing the saved text
  const save = useMutation({
    mutationFn: (text: string) => yt.setNotes({ ...q.data!, [role!]: text }),
    onSuccess: (d) => { qc.setQueryData(["yt", "notes"], d); setEdit(null); },
  });
  if (!role) return <p className="pt-1 text-sm text-ink-3">Chọn vai trò ở Cài đặt › Chung trước.</p>;
  if (!q.data) return (
    <p className="flex items-center gap-2 pt-1 text-sm text-ink-3">
      {q.isError ? <>Không tải được: {(q.error as Error).message} <Button size="xs" variant="outline" onClick={() => void q.refetch()}><RotateCw /> Thử lại</Button></> : "Đang tải…"}
    </p>
  );
  const draft = edit?.role === role ? edit.text : null; // an edit belongs to the role it was typed for
  const text = draft ?? q.data[role];
  const name = YT_ROLES.find(([r]) => r === role)?.[1];
  return (
    <form className="grid gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); save.mutate(text.trim()); }}>
      <Textarea rows={6} maxLength={4000} value={text} onChange={(e) => setEdit({ role, text: e.target.value })} aria-label={`Instructions cho AI, vai trò ${name}`} placeholder={NOTES_HINT[role]} className="text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={draft === null || save.isPending}>Lưu</Button>
        {draft !== null && <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>Hủy</Button>}
        <span className="ml-auto font-mono text-xs text-ink-3 tabular-nums">{text.length}/4000</span>
      </div>
      {save.isError && <p role="alert" className="text-xs text-error">Không lưu được: {(save.error as Error).message}</p>}
    </form>
  );
}

const WEEK = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** When the YouTrack release report writes itself (per browser); the report follows the role and the project on the YouTrack page. */
function ReportSection() {
  const [v, setV] = useState(readReportAt);
  const set = (next: Partial<ReportAt>) => { const n = { ...v, ...next }; setV(n); saveReportAt(n); };
  return <>
    <Row label="Tự tạo báo cáo" desc="Theo vai trò và project đang chọn bên trang YouTrack.">
      <Switch label="Tự tạo báo cáo" checked={v.on} onChange={(on) => set({ on })} />
    </Row>
    {v.on && (
      <Row label="Lịch" stack>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Ngày tạo báo cáo" className="flex flex-wrap gap-1">
            {WEEK.map((d, k) => {
              const on = v.days.includes(k);
              return <Button key={d} type="button" size="xs" variant={on ? "default" : "outline"} aria-pressed={on} className="w-9"
                onClick={() => set({ days: on ? v.days.filter((x) => x !== k) : [...v.days, k].sort() })}>{d}</Button>;
            })}
          </div>
          <span className="text-xs text-ink-3">lúc</span>
          <Input aria-label="Giờ tạo báo cáo" type="time" className="h-8 w-28" value={v.time} onChange={(e) => /^\d\d:\d\d$/.test(e.target.value) && set({ time: e.target.value })} />
        </div>
      </Row>
    )}
  </>;
}

// ---- AI -----------------------------------------------------------------------------------------

function AiGroup() {
  const { p } = useAiPrefs();
  return <>
    <Card title="Dùng AI nào" info="Áp dụng cho mọi tính năng AI: tóm tắt, soạn nháp, Briefing, Digest, YouTrack, Task và AI Agent. Mỗi AI giữ model và effort riêng, đổi qua lại không mất lựa chọn.">
      <ProviderSection />
    </Card>
    {p && (
      <Card title="Model và effort" info="Của AI đang dùng, riêng cho Telegram và YouTrack; mỗi AI giữ lựa chọn riêng, áp dụng từ lần chạy kế tiếp. Model mạnh hơn và effort cao hơn thì chậm hơn, tốn hạn mức hơn.">
        <PrefsSection provider={p.provider} plain />
      </Card>
    )}
    <Card title="Tài khoản" info="Mỗi CLI tự giữ đăng nhập và token trên máy này; trang chỉ đọc ai đang đăng nhập. Chi tiết: hạn mức, usage và lịch sử chạy.">
      <AiAccounts />
    </Card>
  </>;
}

/** Which CLI runs every AI feature (drafts, summaries, Digest, YouTrack, tasks, AI Agent); saved in data/claude.json. */
function ProviderSection() {
  const { p, set, info, name } = useAiPrefs();
  const accounts = useAccounts();
  if (!p) return null;
  const ready = (v: Provider) => accounts[v].installed && accounts[v].loggedIn;
  const items = (["claude", "codex", "antigravity"] as const).map((v) => ({
    value: v, label: <span className={cn(!ready(v) && "opacity-50")}>{info(v)?.name ?? v}</span>,
  }));
  return (
    <div className="grid gap-2 pt-1">
      <Segmented id="set-provider" variant="card" label="AI cho mọi tính năng" value={p.provider} onChange={(v) => set({ provider: v })} items={items} />
      {!accounts[p.provider].checking && !ready(p.provider) && <span className="text-xs text-warn">{name} chưa cài hoặc chưa đăng nhập: lần chạy sẽ lỗi.</span>}
      <p className="text-xs text-ink-3">Task đang dở tiếp tục bằng AI đã bắt đầu nó.</p>
    </div>
  );
}

// ---- Cập nhật -----------------------------------------------------------------------------------

type UpdateInfo = { branch: string; current: string; behind: number; dirty: boolean; auto: boolean; updated?: boolean; commits: { sha: string; subject: string; when: string }[] };

/** git fetch on open; "Cập nhật" pulls, rebuilds, restarts the server, then reloads this page. */
function UpdateSection() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["update"], retry: false,
    queryFn: async ({ signal }) => { const r = await api<UpdateInfo>("/update", { signal }); void qc.invalidateQueries({ queryKey: ["update-state"] }); return r; }, staleTime: 60_000 });
  const [restarting, setRestarting] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const run = useMutation({
    mutationFn: () => api<UpdateInfo>("/update", { method: "POST" }),
    onSuccess: async (r) => {
      if (!r.updated) return void qc.invalidateQueries({ queryKey: ["update"] });
      setRestarting(true);
      setRestartFailed(false);
      await new Promise((ok) => setTimeout(ok, 2000));
      for (let i = 0; i < 60; i++) {
        if (await fetch("/health", { cache: "no-store" }).then((x) => x.ok, () => false)) return location.reload();
        await new Promise((ok) => setTimeout(ok, 1000));
      }
      setRestarting(false); // a minute without the server: say so instead of spinning forever
      setRestartFailed(true);
    },
  });
  const auto = useMutation({
    mutationFn: (on: boolean) => api("/update/auto", { method: "PUT", json: { on } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["update"] }),
  });
  const d = info.data;
  const err = (e: unknown) => (e instanceof ApiError && e.detail) || "Không kết nối được GitHub.";
  return <>
    <div className="grid gap-2.5 py-3 first:pt-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusLine tone={info.isFetching ? "idle" : !d ? "error" : d.behind ? "warn" : "ok"}>
          {info.isFetching ? "Đang kiểm tra…" : !d ? "Chưa kiểm tra được" : d.behind ? <>Có <b className="font-semibold">{d.behind}</b> bản mới trên {d.branch}</> : <>Đã mới nhất <span className="font-mono text-xs text-ink-3">{d.current} · {d.branch}</span></>}
        </StatusLine>
        <div className="flex gap-2">
          <Hint side="bottom" text="Kiểm tra lại bản mới trên GitHub">
            <Button variant="ghost" size="icon-sm" aria-label="Kiểm tra" disabled={info.isFetching || run.isPending} onClick={() => void info.refetch()}>
              <RotateCw className={cn(info.isFetching && "animate-spin")} />
            </Button>
          </Hint>
          <Button size="sm" aria-busy={run.isPending || restarting} disabled={!d?.behind || d.dirty || run.isPending || restarting} onClick={() => run.mutate()}>
            {restarting ? "Đang khởi động lại…" : run.isPending ? "Đang cập nhật…" : "Cập nhật"}
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
      {d?.dirty && <p className="text-xs text-warn">Thư mục app có file đã sửa tay: không tự cập nhật được, dùng git.</p>}
      {(info.isError || run.isError) && <p role="alert" className="text-xs text-error">{err(info.error ?? run.error)}</p>}
      {restartFailed && <p role="alert" className="text-xs text-error">Đã cập nhật nhưng server chưa chạy lại sau 1 phút: mở lại app (Start Dashboard) rồi tải lại trang.</p>}
    </div>
    {d && (
      <Row label="Tự động cập nhật" desc="Server kiểm tra mỗi giờ (tắt thì chỉ hiện chấm trên nút Cài đặt). Bật: có bản mới thì tự cập nhật, khởi động lại server và tải lại trang; bỏ qua khi đang có task AI Agent.">
        <Switch label="Tự động cập nhật" checked={auto.isPending ? !!auto.variables : d.auto} disabled={auto.isPending} onChange={(v) => auto.mutate(v)} />
      </Row>
    )}
  </>;
}

// ---- Phím tắt -----------------------------------------------------------------------------------

function Keycap({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid h-6 min-w-6 place-items-center rounded-md border border-rule-2 border-b-2 bg-cotton px-1.5 font-mono text-[0.6875rem] font-medium text-ink shadow-stock">{children}</kbd>;
}
const k = (...keys: string[]) => <span className="inline-flex items-center gap-1">{keys.map((x, i) => <Keycap key={i}>{x}</Keycap>)}</span>;
const plus = (...parts: React.ReactNode[]) => <span className="inline-flex items-center gap-1">{parts.map((x, i) => <span key={i} className="inline-flex items-center gap-1">{i > 0 && <span className="text-ink-3">+</span>}{x}</span>)}</span>;
const or = (...parts: React.ReactNode[]) => <span className="inline-flex items-center gap-1">{parts.map((x, i) => <span key={i} className="inline-flex items-center gap-1">{i > 0 && <span className="text-ink-3">/</span>}{x}</span>)}</span>;
const MOD_KEY = "⌘/Ctrl";

type Shortcut = [React.ReactNode, string];
type ShortcutGroup = [string, Shortcut[]];

const TG_KEYS: ShortcutGroup[] = [
  ["Di chuyển", [
    [or(k("j"), k("k")), "Chọn tin dưới / trên (màn rộng, khi đang trả lời: sang tin đó luôn)"],
    [plus(k("Alt"), or(k("↑"), k("↓"))), "Sang tag trước / kế (khi đang trả lời)"],
    [<span key="g" className="inline-flex items-center gap-1">{k("g")}<span className="text-ink-3">rồi</span>{or(k("i"), k("p"), k("a"), k("b"))}</span>, "Đi tới Việc cần xử lý / Tag đã ghim / AI Agent / Briefing"],
    [k("/"), "Tìm kiếm"],
    [plus(k(MOD_KEY), k("K")), "Lệnh nhanh: nhóm, trang, ticket, phiên AI, tìm tin"],
  ]],
  ["Xử lý tin", [
    [k("x"), "Xong / mở lại tin đang chọn"],
    [plus(k("Shift"), k("x")), "Xong, không thả reaction trên Telegram"],
    [k("s"), "Hoãn tin đang chọn 1 giờ"],
    [k("p"), "Ghim / bỏ ghim tin đang chọn"],
    [k("o"), "Mở tin đang chọn trong Telegram"],
    [or(k("Space"), plus(k("Shift"), <span key="c" className="text-xs text-ink-2">bấm</span>)), "Chọn nhiều tin, rồi Xong / Hoãn / Ghim cả loạt"],
    [k("z"), "Hoàn tác thao tác vừa làm"],
  ]],
  ["Trả lời", [
    [or(k("Enter"), k("r")), "Trả lời tin đang chọn"],
    [k("a"), "Nhập yêu cầu cho AI (khi đang trả lời)"],
    [plus(k(MOD_KEY), k("Enter")), "Gửi trả lời"],
    [k("Esc"), "Bỏ chọn nhiều tin, rồi đóng trả lời (nháp được giữ lại)"],
  ]],
  ["Trợ giúp", [
    [k("?"), "Mở bảng phím tắt"],
    [k("F1"), "Mở hướng dẫn"],
  ]],
];

const YT_KEYS: ShortcutGroup[] = [
  ["Di chuyển", [
    [plus(k(MOD_KEY), k("K")), "Lệnh nhanh"],
    [k("/"), "Tìm ticket"],
    [or(k("j"), k("k")), "Chọn ticket dưới / trên"],
    [k("Enter"), "Mở ticket đang chọn"],
  ]],
  ["Chọn và trợ giúp", [
    [k("x"), "Chọn / bỏ chọn ticket (chọn nhiều)"],
    [k("Esc"), "Xóa ô tìm, rồi bỏ chọn các ticket"],
    [k("F1"), "Mở hướng dẫn"],
  ]],
];

function ShortcutsGroup() {
  const [find, setFind] = useState("");
  const [app, setApp] = useState<"tg" | "yt">("tg");
  const f = fold(find.trim());
  const groups = (app === "tg" ? TG_KEYS : YT_KEYS)
    .map(([name, list]): ShortcutGroup => [name, list.filter(([, what]) => !f || fold(what).includes(f) || fold(name).includes(f))])
    .filter(([, list]) => list.length);
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <Segmented id="set-keys-app" label="Phím tắt của" value={app} onChange={setApp} items={[{ value: "tg", label: "Telegram Inbox" }, { value: "yt", label: "YouTrack" }]} />
      <label className="relative ml-auto w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input aria-label="Tìm phím tắt" placeholder="Tìm: hoãn, ghim, gửi…" value={find} onChange={(e) => setFind(e.target.value)} className="h-8 pl-8" />
      </label>
    </div>
    {groups.length ? (
      <div className="grid gap-4">
        {groups.map(([name, list]) => (
          <Card key={name} title={name}><ShortcutList list={list} /></Card>
        ))}
      </div>
    ) : <p className="py-6 text-center text-sm text-ink-3">Không có phím tắt nào khớp “{find}”.</p>}
  </>;
}

function ShortcutList({ list }: { list: Shortcut[] }) {
  return (
    <dl className="grid">
      {list.map(([keys, what]) => (
        <div key={what} className="flex items-center justify-between gap-4 border-t border-rule py-2 first:border-0 first:pt-1">
          <dt className="text-sm text-ink-2">{what}</dt>
          <dd className="shrink-0">{keys}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The Inbox's "?" sheet: the Telegram groups, two columns on a wide screen. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogTitle>Phím tắt</DialogTitle>
        <div className="grid max-h-[70vh] gap-x-8 gap-y-5 overflow-y-auto md:grid-cols-2">
          {TG_KEYS.map(([name, list]) => (
            <section key={name} aria-label={name} className="grid content-start gap-1">
              <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{name}</h3>
              <ShortcutList list={list} />
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

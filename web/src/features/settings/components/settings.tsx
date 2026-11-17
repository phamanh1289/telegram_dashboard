"use client";

import { ArrowLeft, Database, GitBranch, Keyboard, Palette, Search, Send, SlidersHorizontal, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Toaster, TopBar } from "@/app/_components/shell";
import { AiGroup } from "@/features/settings/components/ai";
import { BotSection } from "@/features/settings/components/bot";
import { DataGroup } from "@/features/settings/components/data";
import { GeneralGroup } from "@/features/settings/components/general";
import { LookSection } from "@/features/settings/components/look";
import { Card, useStatus } from "@/features/settings/components/parts";
import { ShortcutsGroup } from "@/features/settings/components/shortcuts";
import { TelegramGroup } from "@/features/settings/components/telegram";
import { UpdateSection } from "@/features/settings/components/update";
import { YouTrackGroup, type YtView } from "@/features/settings/components/youtrack";
import { AiBotIcon } from "@/shared/components/ai/chat";
import { Input } from "@/shared/components/ui/input";
import { Pill } from "@/shared/components/ui/segmented";
import { YtLogo } from "@/shared/components/yt-logo";
import { type Key, tr, useT } from "@/shared/lib/i18n";
import { cn, fold } from "@/shared/lib/utils";

type GroupId = "general" | "look" | "bot" | "telegram" | "youtrack" | "ai" | "data" | "shortcuts" | "github";
type Section = "me" | "services" | "system";
const SECTIONS: [Section, Key][] = [["me", "Cá nhân"], ["services", "Dịch vụ"], ["system", "Hệ thống"]];
/** id, name, icon, the nav's one-liner, the page's lead, the nav section. Chung holds only what every module reads. */
const GROUPS: [GroupId, Key, React.ComponentType<{ className?: string }>, Key, Key, Section][] = [
  ["general", "Chung", SlidersHorizontal, "Vai trò, ngôn ngữ, về bạn", "Bạn là ai và dùng ngôn ngữ nào: Telegram, YouTrack và AI cùng theo. Lưu trên trình duyệt này.", "me"],
  ["look", "Giao diện", Palette, "Màu, chữ, linh vật", "Sáng / tối, phong cách, font, màu chủ đạo và linh vật AI; khung xem trước đổi theo ngay. Lưu trên trình duyệt này.", "me"],
  ["bot", "Trợ lý biết tuốt", AiBotIcon, "Bot hướng dẫn, F1", "Bot nổi ở góc màn hình: hỏi gì về app cũng được, nó chỉ cách làm rồi dẫn bạn tới tận nơi (F1). Lưu trên trình duyệt này.", "me"],
  ["telegram", "Telegram", Send, "Tài khoản, hàng chờ, Q&A", "Tài khoản lưu trên máy này (data/); các mục khác lưu trên trình duyệt này.", "services"],
  ["youtrack", "YouTrack", YtLogo, "Kết nối, prompt, workflow", "Kết nối, hướng dẫn cho AI, kho prompt, workflow và báo cáo release.", "services"],
  ["ai", "AI", Sparkles, "Model, tài khoản CLI", "CLI nào chạy các tính năng AI, model/effort cho từng loại việc và tài khoản của từng CLI.", "services"],
  ["data", "Dữ liệu", Database, "Dung lượng, dọn dẹp", "Những gì app lưu trên máy này và trình duyệt này: mỗi phần chiếm bao nhiêu, xóa từng phần khi cần.", "system"],
  ["shortcuts", "Phím tắt", Keyboard, "Inbox và YouTrack", "Phím một chữ không chạy khi đang gõ trong ô nhập. Bấm ? trong Inbox để mở nhanh.", "system"],
  ["github", "Cập nhật", GitBranch, "Bản mới từ GitHub", "Lấy bản mới từ GitHub rồi khởi động lại server.", "system"],
];

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
  const t = useT();
  const docTitle = `${t("Cài đặt")} · Radar`; // app/settings/page.tsx sets no title, so Next leaves this one alone
  useEffect(() => { document.title = docTitle; }, [docTitle]);
  const [, label, Icon, , lead] = GROUPS.find(([id]) => id === (tab ?? "general"))!;
  const pick = (id: GroupId) => { history.replaceState(null, "", `#${id}`); setTab(id); scrollTo({ top: 0 }); };
  const [ytView, setYtView] = useState<YtView>("connect");
  // A search hit: open its group (and YouTrack sub-view), then bring its card into view and flash it.
  const [jump, setJump] = useState<{ card?: string; at: number } | null>(null);
  const go = (e: Entry) => {
    history.replaceState(null, "", `#${e.g}`);
    setTab(e.g);
    if (e.view) setYtView(e.view);
    setJump({ card: e.card, at: Date.now() });
  };
  useEffect(() => {
    if (!jump) return;
    const el = jump.card ? document.querySelector<HTMLElement>(`main section[data-card="${CSS.escape(jump.card)}"]`) : null;
    if (!el) return void scrollTo({ top: 0 });
    el.querySelector<HTMLButtonElement>(":scope > header button[aria-expanded=false]")?.click(); // a folded advanced card opens
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
    ...(st.state !== "connected" && st.state !== "connecting" && { telegram: t("Telegram chưa kết nối") }),
    ...(!st.youtrack_configured && { youtrack: t("Chưa có token YouTrack") }),
  } : {};
  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <div className="sticky top-0 z-30"><TopBar module="settings" /></div>
      <div className="grid w-full grid-cols-1 content-start gap-6 px-4 py-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10 md:px-8 md:py-10 xl:px-12">
        <nav aria-label={t("Mục cài đặt")} className="page-in sticky top-11 z-20 -mx-4 -mt-6 grid min-w-0 content-start gap-3 bg-paper px-4 pt-6 pb-2 md:top-[calc(2.75rem+2.5rem)] md:m-0 md:self-start md:bg-transparent md:p-0">
          <button type="button" onClick={back} className="flex w-fit items-center gap-1.5 text-sm text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> {t("Quay lại")}
          </button>
          <h1 className="text-xl font-bold tracking-tight">{t("Cài đặt")}</h1>
          <SettingsSearch onGo={go} />
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:grid md:gap-4 md:overflow-visible md:px-0">
            {SECTIONS.map(([sec, secName]) => (
            <div key={sec} role="group" aria-label={t(secName)} className="flex shrink-0 gap-1 md:grid md:gap-0.5">
              <span className="hidden px-2 pb-1 text-2xs font-medium tracking-wide text-ink-3 uppercase md:block">{t(secName)}</span>
            {GROUPS.filter((g) => g[5] === sec).map(([id, name, NavIcon, short]) => {
              const on = tab === id;
              return (
                <a key={id} href={`#${id}`} aria-current={on ? "page" : undefined} onClick={(e) => { e.preventDefault(); pick(id); }}
                  className={cn("group relative flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 no-underline transition-colors duration-(--dur-micro)", !on && "hover:bg-paper-3")}>
                  {on && <Pill id="settings-nav" className="inset-0 rounded-lg bg-hl-wash" />}
                  <span className={cn("relative grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-(--dur-micro)", on ? "bg-hl text-hl-ink" : "bg-paper-2 text-ink-3 shadow-groove group-hover:text-ink")}>
                    <NavIcon className="size-4" aria-hidden />
                  </span>
                  <span className="relative grid min-w-0">
                    <span className={cn("text-sm", on ? "font-bold text-hl-2" : "font-medium text-ink-2 group-hover:text-ink")}>{t(name)}</span>
                    <span className="hidden truncate text-xs text-ink-3 md:block">{t(short)}</span>
                  </span>
                  {attention[id] && <span role="img" aria-label={attention[id]} className="relative ml-auto size-2 shrink-0 rounded-full bg-signal" />}
                </a>
              );
            })}
            </div>
            ))}
          </div>
        </nav>

        <main key={tab ?? ""} className="rise-in grid min-w-0 content-start gap-4">
          <header className={cn("mb-1 flex items-start gap-3", !tab && "invisible")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-hl-wash text-hl-2"><Icon className="size-5" aria-hidden /></span>
            <span className="grid gap-0.5">
              <h2 className="text-lg leading-tight font-bold">{t(label)}</h2>
              <p className="text-sm text-ink-3">{t(lead)}</p>
            </span>
          </header>
          {tab === "general" && <GeneralGroup />}
          {tab === "look" && <LookSection />}
          {tab === "bot" && <BotSection />}
          {tab === "telegram" && <TelegramGroup />}
          {tab === "youtrack" && <YouTrackGroup view={ytView} setView={setYtView} />}
          {tab === "ai" && <AiGroup />}
          {tab === "github" && <Card title="Cập nhật app" info="Bản cài: tải gói mới từ GitHub Releases. Bản git: git pull, build lại giao diện (cần quyền đọc repo)."><UpdateSection /></Card>}
          {tab === "data" && <DataGroup />}
          {tab === "shortcuts" && <ShortcutsGroup />}
        </main>
      </div>
      <Toaster />
    </div>
  );
}

// ---- search -------------------------------------------------------------------------------------

/** One findable setting: its name, group, the card holding it (scrolled to), YouTrack's sub-view, extra words to match. */
type Entry = { t: Key; g: GroupId; card?: Key; view?: YtView; k?: string };
const ENTRIES: Entry[] = [
  { t: "Vai trò Dev, QA/QC, PO/PM", g: "general", card: "Vai trò", k: "role" },
  { t: "Ngôn ngữ Tiếng Việt / English", g: "general", card: "Ngôn ngữ", k: "language lang vietnamese tieng anh" },
  { t: "Giới thiệu bản thân cho AI", g: "general", card: "Giới thiệu bản thân cho AI", k: "intro toi la ai" },
  { t: "Tóm tắt theo nền tảng", g: "general", card: "Giới thiệu bản thân cho AI", k: "android ios mobile platform" },
  { t: "Chế độ màu sáng / tối", g: "look", card: "Chủ đề và chữ", k: "theme dark light he thong" },
  { t: "Phong cách giao diện", g: "look", card: "Chủ đề và chữ", k: "don gian mac dinh ruc ro style font chu co chu" },
  { t: "Màu chủ đạo và gradient", g: "look", card: "Màu sắc", k: "accent hue mau do dam pha san" },
  { t: "Linh vật AI (icon robot)", g: "look", card: "Linh vật AI", k: "robot icon mascot loading anh avatar rồng cú cáo dragon owl fox vai trò role" },
  { t: "Trợ lý biết tuốt (bot nổi)", g: "bot", card: "Hiển thị", k: "bot huong dan guide help f1 kich thuoc size goc canh mep neo vi tri an hien cach hien thi noi co dinh ben phai thanh cong cu" },
  { t: "Model cho trợ lý", g: "bot", card: "Cách trả lời", k: "bot doc code model effort" },
  { t: "Tài khoản Telegram, API ID/Hash", g: "telegram", card: "Tài khoản Telegram", k: "dang nhap login so dien thoai 2fa ma" },
  { t: "Ngưỡng quá hạn", g: "telegram", card: "Hàng chờ", k: "overdue gio cho lau" },
  { t: "Nút thao tác trên tin", g: "telegram", card: "Hàng chờ", k: "ghim ngu canh mo telegram hover" },
  { t: "Thông báo khi có tag mới", g: "telegram", card: "Thông báo", k: "notification bao" },
  { t: "Hiện nội dung tin trong thông báo macOS", g: "telegram", card: "Thông báo", k: "notification banner preview man hinh khoa" },
  { t: "Nhắc câu hỏi Q&A chưa ai trả lời", g: "telegram", card: "Q&A", k: "qa remind nhac lai phut canh bao" },
  { t: "Câu hỏi Q&A tính là đã trả lời khi", g: "telegram", card: "Q&A", k: "qa tag nguoi duoc hoi tra loi" },
  { t: "Tự tóm tắt Briefing", g: "telegram", card: "Briefing", k: "tu dong nen briefing auto" },
  { t: "Luôn bỏ qua người gửi / từ khóa", g: "telegram", card: "Luôn bỏ qua", k: "tat bat lai thong bao mute quy tac rule tu danh dau da xu ly" },
  { t: "Xóa nháp và danh sách Báo lại", g: "data", card: "Dữ liệu trên trình duyệt này", k: "draft du lieu" },
  { t: "Tài khoản YouTrack, URL và token", g: "youtrack", card: "Tài khoản YouTrack", view: "connect", k: "ket noi" },
  { t: "Báo cáo release tự động", g: "youtrack", card: "Báo cáo release", view: "connect", k: "report lich hang ngay" },
  { t: "Instructions cho AI (YouTrack)", g: "youtrack", card: "Instructions cho AI", view: "ai", k: "huong dan notes team" },
  { t: "Kho prompt", g: "youtrack", card: "Kho prompt", view: "ai", k: "ghim phien ai" },
  { t: "Workflow State", g: "youtrack", card: "Workflow", view: "workflow", k: "luong mui ten board" },
  { t: "Model và effort (Claude, Codex, Antigravity)", g: "ai", card: "Model và effort", k: "dung ai nao provider cli tom tat soan nhap task agent thu model" },
  { t: "Model và effort cho Briefing, Digest", g: "ai", card: "Model và effort", k: "tom tat nhom briefing digest" },
  { t: "Model và effort cho AI YouTrack", g: "ai", card: "Model và effort", k: "model effort youtrack doc code ticket" },
  { t: "Tự hạ model khi gần hết hạn mức", g: "ai", card: "Model và effort", k: "fallback quota" },
  { t: "Tài khoản CLI AI", g: "ai", card: "Tài khoản", k: "dang nhap usage history claude codex antigravity han muc thanh tren cung" },
  { t: "Ẩn SĐT / email khi gửi AI", g: "ai", card: "Quyền riêng tư", k: "privacy redact so dien thoai email" },
  { t: "Cập nhật app từ GitHub", g: "github", card: "Cập nhật app", k: "update phien ban moi" },
  { t: "Tự động cập nhật", g: "github", card: "Cập nhật app", k: "auto update" },
  { t: "Dung lượng dữ liệu trên máy", g: "data", card: "Dung lượng", k: "database db sqlite mb dung luong disk storage o dia" },
  { t: "Xóa tin cũ, phiên AI đã xong, ảnh, log", g: "data", card: "Dọn trong database", k: "don dep clear clean xoa tin cu anh log lich su phien" },
  { t: "Dung lượng tin theo từng nhóm", g: "data", card: "Tin theo nhóm", k: "xoa du lieu nhom group purge" },
  { t: "Phím tắt Telegram Inbox và YouTrack", g: "shortcuts", k: "keyboard shortcut" },
];
const GROUP_NAME = Object.fromEntries(GROUPS.map(([id, name]) => [id, name])) as Record<GroupId, Key>;
// Both languages are searchable whichever one is on: the Vietnamese key and its English text.
const both = (k?: Key) => (k ? `${k} ${tr("en", k)}` : "");
const INDEX = ENTRIES.map((e) => ({ e, hay: fold(`${both(e.t)} ${both(e.card)} ${both(GROUP_NAME[e.g])} ${e.k ?? ""}`) }));

/** Find a setting by name across every group; Enter / click opens it. "/" focuses the box. */
function SettingsSearch({ onGo }: { onGo: (e: Entry) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
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
      <Input ref={box} role="combobox" aria-label={t("Tìm cài đặt")} aria-autocomplete="list" aria-expanded={open && words.length > 0} aria-controls="settings-search-list"
        aria-activedescendant={open && hits.length ? `settings-hit-${cur}` : undefined} placeholder={t("Tìm cài đặt…")} value={q} className="h-8 pr-7 pl-8"
        onChange={(e) => { setQ(e.target.value); setAt(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, Math.min(hits.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)))); }
          else if (e.key === "Enter" && hits[cur]) { e.preventDefault(); pick(hits[cur]); }
          else if (e.key === "Escape") { if (q) setQ(""); else e.currentTarget.blur(); }
        }} />
      {!q && <kbd aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-rule bg-paper-2 px-1 font-mono text-2xs text-ink-3">/</kbd>}
      {open && words.length > 0 && (
        <ul id="settings-search-list" role="listbox" aria-label={t("Kết quả tìm cài đặt")}
          className="absolute inset-x-0 top-full z-40 mt-1 grid max-h-80 overflow-y-auto rounded-lg bg-cotton p-1 shadow-pop animate-in fade-in-0 zoom-in-95 duration-(--dur-micro) motion-reduce:animate-none">
          {hits.map((e, i) => (
            <li key={e.t} id={`settings-hit-${i}`} role="option" aria-selected={i === cur}
              onMouseDown={(ev) => ev.preventDefault()} onMouseEnter={() => setAt(i)} onClick={() => pick(e)}
              className={cn("grid cursor-pointer gap-0.5 rounded-md px-2.5 py-1.5", i === cur && "bg-paper-2")}>
              <span className="text-sm text-ink">{t(e.t)}</span>
              <span className="truncate text-xs text-ink-3">{t(GROUP_NAME[e.g])}{e.card && ` › ${t(e.card)}`}</span>
            </li>
          ))}
          {!hits.length && <li className="px-2.5 py-2 text-sm text-ink-3">{t("Không có cài đặt nào khớp “{q}”.", { q: q.trim() })}</li>}
        </ul>
      )}
    </div>
  );
}

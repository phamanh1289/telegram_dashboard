"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ExternalLink, GitBranch, Keyboard, ListChecks, Monitor, Moon, Send, SlidersHorizontal, Sparkles, Sun, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AiAccounts, type Provider, useAccounts, useAiPrefs } from "@/components/ai";
import { Kbd } from "@/components/pending-inbox";
import { RulesSection } from "@/components/tools-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TopBar } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { api, ApiError, errorText, type Status } from "@/lib/api";
import { ACCENTS, applyRowActions, applyTheme, OVERDUE_CHOICES, PLATFORMS, readComposerAiOpen, readDigestTeams, readPlatform, readRowActions, saveDigestTeams, readNotify, onPrefs, readOverdueHours, readReportAt, readTemplates, type ReportAt, saveReportAt, readLook, readTheme, readYtRole, saveLook, saveYtRole, setPref, YT_ROLES, type YtRole, type Look, type UiStyle, saveTemplates, type ThemePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { yt } from "@/lib/yt";
import { Textarea } from "@/components/ui/textarea";
import { PromptManager } from "@/components/yt/prompts";

const THEMES = [["light", "Sáng", Sun], ["dark", "Tối", Moon], ["system", "Theo hệ thống", Monitor]] as const;

type GroupId = "general" | "telegram" | "youtrack" | "ai" | "github" | "shortcuts";
const GROUPS: [GroupId, string, typeof Send, string][] = [
  ["general", "Chung", SlidersHorizontal, "Vai trò và giao diện, dùng cho cả Telegram lẫn YouTrack. Lưu trên trình duyệt này."],
  ["telegram", "Telegram", Send, "Tài khoản lưu trên máy này (data/); các mục khác lưu trên trình duyệt này."],
  ["youtrack", "YouTrack", ListChecks, "Kết nối, hướng dẫn cho AI, kho prompt và báo cáo release."],
  ["ai", "AI", Sparkles, "CLI nào chạy các tính năng AI, tài khoản của từng CLI và quyền đọc tin."],
  ["github", "GitHub", GitBranch, "Cập nhật app từ repo GitHub."],
  ["shortcuts", "Phím tắt", Keyboard, "Phím tắt trong Telegram Inbox."],
];

/** The settings page (/settings/#group): every module's settings, one group at a time. */
export function SettingsPage() {
  const [tab, setTab] = useState<GroupId | null>(null); // null until the hash is read (static export: no location on the server)
  useEffect(() => {
    const read = () => setTab((GROUPS.find(([id]) => `#${id}` === location.hash)?.[0]) ?? "general");
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);
  const cur = GROUPS.find(([id]) => id === (tab ?? "general"))!;
  const pick = (id: GroupId) => { history.replaceState(null, "", `#${id}`); setTab(id); scrollTo({ top: 0 }); };
  const router = useRouter();
  const back = () => (history.length > 1 ? router.back() : router.push("/"));
  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <div className="sticky top-0 z-30"><TopBar module="settings" /></div>
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 content-start gap-6 px-4 py-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10 md:py-10">
        <nav aria-label="Mục cài đặt" className="grid min-w-0 content-start gap-3 md:sticky md:top-[calc(2.75rem+2.5rem)]">
          <button type="button" onClick={back} className="flex w-fit items-center gap-1.5 text-sm text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Quay lại
          </button>
          <h1 className="text-xl font-semibold tracking-tight">Cài đặt</h1>
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:grid md:overflow-visible md:px-0">
            {GROUPS.map(([id, label, Icon]) => (
              <a key={id} href={`#${id}`} aria-current={tab === id ? "page" : undefined} onClick={(e) => { e.preventDefault(); pick(id); }}
                className={cn("flex min-h-9 shrink-0 items-center gap-2.5 rounded-[var(--radius-input)] px-2.5 text-sm font-medium no-underline transition-[background-color,color] duration-(--dur-micro)",
                  tab === id ? "bg-hl-wash font-semibold text-hl-2" : "text-ink-3 hover:bg-paper-3 hover:text-ink")}>
                <Icon className="size-4 shrink-0" aria-hidden />{label}
              </a>
            ))}
          </div>
        </nav>

        <main className="grid min-w-0 content-start gap-4">
          <header className={cn("grid gap-1", !tab && "invisible")}>
            <h2 className="text-lg font-semibold">{cur[1]}</h2>
            <p className="text-sm text-ink-3">{cur[3]}</p>
          </header>
          {tab === "general" && <GeneralGroup />}
          {tab === "telegram" && <TelegramGroup />}
          {tab === "youtrack" && <>
            <Section title="Tài khoản YouTrack" hint="Token chỉ lưu trên máy này (thư mục data/), dùng cho trang YouTrack và nút tạo issue.">
              <YouTrackSection />
            </Section>
            <Section title="Instructions cho AI" hint="Hướng dẫn riêng của team cho vai trò đang chọn (mục Chung), AI làm theo ở mọi tính năng YouTrack (phiên AI, test case, triage, báo cáo, tạo ticket…), trừ lọc ticket. Lưu trên máy này (data/).">
              <NotesSection />
            </Section>
            <Section title="Kho prompt" hint="Prompt cho phiên AI YouTrack, dùng chung cả team (data/). Ghim tối đa 5 làm nút cho từng vai trò và số ticket; mặc định 4 prompt có sẵn theo vai trò. Prompt có sẵn xóa được, khôi phục ở cuối danh sách.">
              <PromptManager role={readYtRole() ?? "dev"} />
            </Section>
            <Section title="Báo cáo release" hint="AI tự viết báo cáo (kịp release không, bàn giao QC, stuck, kết quả test, việc trễ, quá tải, bug) theo vai trò và project đang chọn bên trang YouTrack. Chạy khi trang YouTrack đang mở; lỡ giờ thì tạo lúc mở lại trong ngày. Xuất MD / PDF / CSV ở card Báo cáo.">
              <ReportSection />
            </Section>
          </>}
          {tab === "ai" && <>
            <Section title="Tài khoản" hint="Mỗi CLI tự giữ đăng nhập và token trên máy này; trang chỉ đọc ai đang đăng nhập.">
              <AiAccounts />
            </Section>
            <ProviderSection />
            <ConsentSection />
          </>}
          {tab === "github" && (
            <Section title="Cập nhật" hint="Lấy bản mới từ GitHub (git pull), build lại giao diện rồi khởi động lại server. Máy cần quyền đọc repo (SSH key hoặc đăng nhập git).">
              <UpdateSection />
            </Section>
          )}
          {tab === "shortcuts" && <Section title="Telegram Inbox" hint="Bấm ? trong Inbox để mở nhanh bảng này."><ShortcutList /></Section>}
        </main>
      </div>
    </div>
  );
}

function GeneralGroup() {
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  return <>
    <Section title="Vai trò" hint="Telegram và YouTrack theo vai trò này: trang chủ, Dashboard, góc nhìn của AI khi tóm tắt và tạo ticket. QA, PO không dùng AI Agent nên không cần thư mục code.">
      <RoleSection />
    </Section>
    <Section title="Giao diện">
      <Segmented label="Giao diện" value={theme} onChange={(v) => { setTheme(v); applyTheme(v); }}
        options={THEMES.map(([v, label, Icon]) => ({ value: v, label: <><Icon className="size-3.5" aria-hidden />{label}</> }))} />
      <LookSection />
    </Section>
  </>;
}

/** Which CLI runs every AI feature (drafts, summaries, Digest, YouTrack, tasks, AI Agent); saved in data/claude.json. */
function ProviderSection() {
  const { p, set, info, name } = useAiPrefs();
  const accounts = useAccounts();
  if (!p) return null;
  const ready = (v: Provider) => accounts[v].installed && accounts[v].loggedIn;
  const options = (["claude", "codex", "antigravity"] as const).map((v) => ({
    value: v, label: <span className={cn(!ready(v) && "opacity-50")}>{info(v)?.name ?? v}</span>,
  }));
  return (
    <Section title="Dùng AI nào" hint="Áp dụng cho mọi tính năng AI: tóm tắt, soạn nháp, Digest, YouTrack, Task và AI Agent. Mỗi AI giữ model và effort riêng, đổi qua lại không mất lựa chọn; chỉnh ở Chi tiết của từng AI.">
      <Segmented label="AI cho mọi tính năng" value={p.provider} onChange={(v) => set({ provider: v })} options={options} />
      {!accounts[p.provider].checking && !ready(p.provider) && <span className="text-xs text-warn">{name} chưa cài hoặc chưa đăng nhập: lần chạy sẽ lỗi.</span>}
      <p className="text-xs text-ink-3">Task đang dở tiếp tục bằng AI đã bắt đầu nó.</p>
    </Section>
  );
}

type UpdateInfo = { branch: string; current: string; behind: number; dirty: boolean; auto: boolean; updated?: boolean; commits: { sha: string; subject: string; when: string }[] };

/** git fetch on open; "Cập nhật" pulls, rebuilds, restarts the server, then reloads this page. */
function UpdateSection() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["update"], retry: false,
    queryFn: async ({ signal }) => { const r = await api<UpdateInfo>("/update", { signal }); void qc.invalidateQueries({ queryKey: ["update-state"] }); return r; }, staleTime: 60_000 });
  const [restarting, setRestarting] = useState(false);
  const run = useMutation({
    mutationFn: () => api<UpdateInfo>("/update", { method: "POST" }),
    onSuccess: async (r) => {
      if (!r.updated) return void qc.invalidateQueries({ queryKey: ["update"] });
      setRestarting(true);
      await new Promise((ok) => setTimeout(ok, 2000));
      for (let i = 0; i < 60; i++) {
        if (await fetch("/health", { cache: "no-store" }).then((x) => x.ok, () => false)) return location.reload();
        await new Promise((ok) => setTimeout(ok, 1000));
      }
    },
  });
  const auto = useMutation({
    mutationFn: (on: boolean) => api("/update/auto", { method: "PUT", json: { on } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["update"] }),
  });
  const d = info.data;
  const err = (e: unknown) => (e instanceof ApiError && e.detail) || "Không kết nối được GitHub.";
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span className={cn(d?.behind ? "text-hl-2" : "text-ink-3")}>
          {info.isFetching ? "Đang kiểm tra…" : !d ? "" : d.behind ? `Có ${d.behind} bản mới trên ${d.branch}` : `Đã mới nhất (${d.current} · ${d.branch})`}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={info.isFetching || run.isPending} onClick={() => void info.refetch()}>Kiểm tra</Button>
          <Button size="sm" aria-busy={run.isPending || restarting} disabled={!d?.behind || d.dirty || run.isPending || restarting} onClick={() => run.mutate()}>
            {restarting ? "Đang khởi động lại…" : run.isPending ? "Đang cập nhật…" : "Cập nhật"}
          </Button>
        </div>
      </div>
      {!!d?.commits.length && (
        <ul className="grid max-h-32 gap-0.5 overflow-y-auto text-xs text-ink-3">
          {d.commits.map((c) => <li key={c.sha} className="truncate"><span className="font-mono">{c.sha}</span> {c.subject} · {c.when}</li>)}
        </ul>
      )}
      {d?.dirty && <p className="text-xs text-warn">Thư mục app có file đã sửa tay: không tự cập nhật được, dùng git.</p>}
      {(info.isError || run.isError) && <p role="alert" className="text-xs text-error">{err(info.error ?? run.error)}</p>}
      {d && (
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="grid gap-0.5">
            <span>Tự động cập nhật</span>
            <span className="text-xs text-ink-3">Server kiểm tra mỗi giờ (tắt thì chỉ hiện chấm trên nút Cài đặt). Bật: có bản mới thì tự cập nhật, khởi động lại server và tải lại trang; bỏ qua khi đang có task AI Agent.</span>
          </span>
          <Switch label="Tự động cập nhật" checked={auto.isPending ? !!auto.variables : d.auto} disabled={auto.isPending} onChange={(v) => auto.mutate(v)} />
        </label>
      )}
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

/** Each member's look, saved in this browser and applied in every open tab (public/design/look.js). */
function LookSection() {
  const [look, setLook] = useState<Look>(readLook);
  const set = (patch: Partial<Look>) => { const next = { ...look, ...patch }; setLook(next); saveLook(next); };
  const simple = look.style === "simple";
  return (
    <>
      <Segmented label="Phong cách" value={look.style} onChange={(style) => set({ style })} options={STYLES} />
      <p className="-mt-1 text-xs text-ink-3">{STYLES.find((o) => o.value === look.style)?.hint}</p>

      <div className="mt-1 grid gap-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span>Màu chủ đạo</span>
          <div role="radiogroup" aria-label="Màu có sẵn" className="flex gap-1.5">
            {ACCENTS.map(([h, label]) => (
              <button key={h} type="button" role="radio" aria-checked={look.hue === h} aria-label={label} title={label} onClick={() => set({ hue: h })}
                className={cn("grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-cotton transition-shadow duration-(--dur-micro)",
                  look.hue === h ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-rule-2")}
                style={{ background: swatch(h) }}>
                {look.hue === h && <Check className="size-3.5 text-white" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
        <HueSlider label="Kéo để chọn màu chủ đạo" value={look.hue} onChange={(hue) => set({ hue })} />
        {look.hue >= 60 && look.hue <= 100 && <p className="text-xs text-warn">Gần màu hổ phách dùng cho tin “cần bạn” (quá hạn), dễ lẫn.</p>}
      </div>

      <div className="mt-1 grid gap-2 text-sm">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="grid gap-0.5">
            <span>Gradient</span>
            <span className="text-xs text-ink-3">{simple ? "Phong cách Đơn giản không dùng gradient." : "Nút, tab đang mở, chip chọn phối từ màu chủ đạo sang màu thứ hai."}</span>
          </span>
          <Switch label="Gradient" checked={look.gradient && !simple} disabled={simple} onChange={(gradient) => set({ gradient })} />
        </label>
        {look.gradient && !simple && <>
          <HueSlider label="Kéo để chọn màu thứ hai của gradient" value={look.hue2} onChange={(hue2) => set({ hue2 })} />
          <div aria-hidden className="h-7 rounded-md" style={{ background: `linear-gradient(120deg, ${swatch(look.hue)}, ${swatch(look.hue2)})` }} />
        </>}
      </div>
    </>
  );
}

function HueSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <input type="range" min={0} max={359} step={1} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}
      className="hue-range" style={{ "--track": WHEEL, "--thumb": swatch(value) } as React.CSSProperties} />
  );
}

/** Telegram-only preferences (account, queue, replies, digest, templates, auto-handle rules). */
function TelegramGroup() {
  const [overdue, setOverdue] = useState(readOverdueHours);
  const [rowActions, setRowActions] = useState(readRowActions);
  const [aiOpen, setAiOpen] = useState(readComposerAiOpen);
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

  return (
    <>

        <Section title="Tài khoản Telegram" hint="API ID/Hash và phiên đăng nhập chỉ lưu trên máy này (thư mục data/).">
          <TelegramSection />
        </Section>
        <Section title="Hàng chờ" hint="Tin tag chờ lâu hơn ngưỡng này hiện màu hổ phách (quá hạn).">
          <Segmented label="Ngưỡng quá hạn" value={overdue} onChange={(v) => { setOverdue(v); setPref("overdueHours", String(v)); }}
            options={OVERDUE_CHOICES.map((h) => ({ value: h, label: `${h} giờ` }))} />
          <label className="mt-1 flex cursor-pointer items-center justify-between gap-4 text-sm">
            <span className="grid gap-0.5">
              <span>Thông báo khi có tag mới</span>
              <span className="text-xs text-ink-3">Khi tab đang ẩn; giữ luồng cập nhật chạy nền.</span>
            </span>
            <Switch label="Thông báo khi có tag mới" checked={notify} onChange={(v) => void toggleNotify(v)} />
          </label>
          {notifyNote && <p role="alert" className="text-xs text-warn">{notifyNote}</p>}
          <span className="mt-1 grid gap-1.5 text-sm">
            <span className="grid gap-0.5">
              <span>Nút thao tác trên tin</span>
              <span className="text-xs text-ink-3">Ghim, ngữ cảnh, mở Telegram. Màn hình cảm ứng luôn hiện.</span>
            </span>
            <Segmented label="Nút thao tác trên tin" value={rowActions} onChange={(v) => { setRowActions(v); applyRowActions(v); }}
              options={[{ value: "hover", label: "Khi rê vào nút Xong" }, { value: "always", label: "Luôn hiện" }]} />
          </span>
        </Section>

        <Section title="Trả lời">
          <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
            <span>Mở sẵn Tóm tắt khi soạn trả lời</span>
            <Switch label="Mở sẵn Tóm tắt khi soạn trả lời" checked={aiOpen} onChange={(v) => { setAiOpen(v); setPref("composerAiOpen", v ? "1" : "0"); }} />
          </label>
          <span className="mt-1 grid gap-1.5 text-sm">
            <span>Tóm tắt theo nền tảng</span>
            <Segmented label="Tóm tắt theo nền tảng" value={platform} onChange={(v) => { setPlatform(v); setPref("aiPlatform", v); }}
              options={PLATFORMS.map(([value, label]) => ({ value, label }))} />
          </span>
        </Section>

        <Section title="Tóm tắt nhóm" hint="Team mà Digest xét ảnh hưởng, cách nhau bằng dấu phẩy (tối đa 10).">
          <Input aria-label="Team cho Digest" defaultValue={readDigestTeams().join(", ")} maxLength={330}
            onChange={(e) => saveDigestTeams(e.target.value.split(",").map((t) => t.trim().slice(0, 30)).filter(Boolean).slice(0, 10))} />
        </Section>

        <Section title="Mẫu trả lời nhanh" hint="Hiện dưới ô trả lời; bấm để chèn vào nội dung.">
          <TemplatesSection />
        </Section>

        <Section title="Tự đánh dấu “đã xử lý”">
          <RulesSection />
        </Section>

    </>
  );
}

const YT_ERRORS: Record<string, string> = {
  youtrack_unauthorized: "Token sai, đã thu hồi hoặc không đủ quyền.",
  youtrack_unreachable: "Không kết nối được YouTrack ở URL này.",
};

/** The role (Telegram + YouTrack): pick one, or clear it so the YouTrack page asks again. */
function RoleSection() {
  const [role, setRole] = useState(readYtRole);
  const pick = (r: YtRole | null) => { setRole(r); saveYtRole(r); };
  return <>
    <div role="radiogroup" aria-label="Vai trò" className="grid gap-1.5">
      {YT_ROLES.map(([r, name, what]) => (
        <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => pick(r)}
          className={cn("grid gap-0.5 rounded-md border px-3 py-2 text-left transition-colors duration-(--dur-micro)", role === r ? "border-hl bg-hl-wash" : "border-rule hover:bg-paper-2")}>
          <span className="flex items-center gap-1.5 text-sm font-medium">{name}{role === r && <Check className="size-3.5 text-hl-2" aria-hidden />}</span>
          <span className="text-xs text-ink-3">{what}</span>
        </button>
      ))}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={!role} onClick={() => pick(null)}><Trash2 /> Xóa vai trò</Button>
      <span className="text-xs text-ink-3">{role ? "Xóa thì trang YouTrack sẽ hỏi lại; Telegram tạm coi như Dev." : "Chưa chọn: Telegram coi như Dev, mở YouTrack sẽ hỏi bạn chọn."}</span>
    </div>
  </>;
}

/** Paste a permanent token (made on the YouTrack profile page); the server checks it before keeping it. */
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

function useStatus() {
  return useQuery({ queryKey: ["status"], queryFn: ({ signal }) => api<Status>("/status", { signal }) });
}

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
  if (!status) return null;
  const err = saveApi.error ?? sendCode.error ?? signIn.error;
  const errLine = err && <p role="alert" className="text-xs text-error">{errorText(err, TG_ERRORS, "Không thực hiện được, thử lại.")}</p>;

  if (editApi || !status.telegram_api_id) {
    return (
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); saveApi.mutate(); }}>
        <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs text-hl-2 underline decoration-hl underline-offset-[3px]">
          Lấy API ID/Hash tại my.telegram.org → API development tools <ExternalLink className="size-3" aria-hidden />
        </a>
        <div className="flex gap-2">
          <Input aria-label="API ID" placeholder="API ID" inputMode="numeric" maxLength={12} className="w-32"
            value={apiId} onChange={(e) => setApiId(e.target.value.replace(/\D/g, ""))} />
          <Input aria-label="API Hash" type="password" autoComplete="off" placeholder="API Hash (32 ký tự)" maxLength={32}
            value={apiHash} onChange={(e) => setApiHash(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" aria-busy={saveApi.isPending} disabled={saveApi.isPending || !apiId || !/^[0-9a-fA-F]{32}$/.test(apiHash.trim())}>
            {saveApi.isPending ? "Đang lưu…" : "Lưu"}
          </Button>
          {editApi && <Button type="button" variant="ghost" onClick={() => setEditApi(false)}>Hủy</Button>}
        </div>
        {errLine}
      </form>
    );
  }

  const changeApi = <button type="button" className="w-fit text-xs text-ink-3 underline underline-offset-[3px] hover:text-ink" onClick={() => { setApiId(String(status.telegram_api_id)); setEditApi(true); }}>Đổi API ID/Hash</button>;
  if (status.state !== "login_required") {
    const label = status.state === "connected" ? `Đã đăng nhập${status.telegram_me ? `: ${status.telegram_me}` : ""}` : "Đang kết nối Telegram…";
    return <div className="grid gap-1"><p className={cn("text-sm", status.state === "connected" ? "text-ok" : "text-ink-3")}>{label}</p>{changeApi}</div>;
  }
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (step === "phone") sendCode.mutate(); else signIn.mutate(); }}>
      <p className="text-sm text-warn">Chưa đăng nhập Telegram.</p>
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
      {step !== "phone" && <button type="button" className="w-fit text-xs text-ink-3 underline underline-offset-[3px] hover:text-ink" onClick={() => setStep("phone")}>Đổi số / gửi lại mã</button>}
      {step === "phone" && changeApi}
      {errLine}
    </form>
  );
}

/** Per-message consent before AI reads Telegram text (Telegram API Terms); off only for personal use. Saved in data/config.json. */
function ConsentSection() {
  const qc = useQueryClient();
  const status = useStatus().data;
  const save = useMutation({
    mutationFn: (on: boolean) => api("/settings/consent", { method: "PUT", json: { ai_require_consent: on } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["status"] }),
  });
  if (!status) return null;
  return (
    <Section title="Quyền đọc tin">
      <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
        <span className="grid gap-0.5">
          <span>Hỏi trước khi AI đọc tin Telegram</span>
          <span className="text-xs text-ink-3">Tắt chỉ khi dùng cá nhân: AI được đọc tin xung quanh và các tin bạn từng gửi để viết nháp đúng giọng.</span>
        </span>
        <Switch label="Hỏi trước khi AI đọc tin Telegram" checked={status.ai_require_consent} disabled={save.isPending} onChange={(v) => save.mutate(v)} />
      </label>
    </Section>
  );
}

function YouTrackSection() {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["yt-config"],
    queryFn: ({ signal }) => api<{ base: string; mock: boolean; hint: string | null }>("/yt/config", { signal }),
  });
  const [url, setUrl] = useState<string | null>(null); // null: still showing the server's URL
  const [token, setToken] = useState("");
  const base = (url ?? cfg.data?.base ?? "").trim().replace(/\/+$/, "");
  const save = useMutation({
    mutationFn: () => api<{ login: string; name: string }>("/youtrack/auth", { method: "PUT", json: { url: base, token: token.trim() } }),
    onSuccess: () => {
      setToken("");
      void qc.invalidateQueries({ queryKey: ["yt-config"] });
      void qc.invalidateQueries({ queryKey: ["status"] });
    },
  });
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className={cn("text-sm", save.isSuccess || cfg.data?.mock === false ? "text-ok" : "text-ink-3")}>
        {save.isSuccess ? `Đã kết nối: ${save.data.name}` : cfg.data?.mock === false ? `Đang dùng ${cfg.data.base}` : "Chưa có token, trang YouTrack đang hiện dữ liệu mẫu."}
      </p>
      <Input aria-label="URL YouTrack" placeholder="https://youtrack.example.com" inputMode="url" maxLength={200}
        value={url ?? cfg.data?.base ?? ""} onChange={(e) => setUrl(e.target.value)} />
      <div className="flex gap-2">
        <Input aria-label="Token YouTrack" type="password" autoComplete="off" placeholder={cfg.data?.hint ?? "perm-…"} maxLength={500}
          value={token} onChange={(e) => setToken(e.target.value)} />
        <Button type="submit" variant="outline" aria-busy={save.isPending} disabled={save.isPending || !/^https?:\/\/\S+$/.test(base) || token.trim().length < 8}>
          {save.isPending ? "Đang kiểm tra…" : cfg.data?.hint ? "Cập nhật" : "Lưu"}
        </Button>
      </div>
      {/^https?:\/\/\S+$/.test(base) && (
        <a href={`${base}/users/me?tab=account-security`} target="_blank" rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs text-hl-2 underline decoration-hl underline-offset-[3px]">
          Tạo token trên YouTrack (Hồ sơ → Account Security → New token) <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
      {save.isError && <p role="alert" className="text-xs text-error">{errorText(save.error, YT_ERRORS, "Không lưu được. Kiểm tra URL (bắt đầu bằng https://) và token.")}</p>}
    </form>
  );
}

const NOTES_HINT: Record<YtRole, string> = {
  qa: "Vd.\n- Test case dạng bảng: ID | Tiền điều kiện | Bước | Kết quả mong đợi | Mức ưu tiên\n- Luôn kiểm cả iOS và Android; môi trường dev rồi staging\n- Khi phân tích bug: nêu mức ảnh hưởng người dùng và vùng regression\n- Viết test case bằng tiếng Việt, tên màn hình giữ tiếng Anh",
  dev: "Vd.\n- Khi chia task: ước lượng theo giờ, tách FE / BE\n- Standup ngắn, tối đa 5 dòng",
  po: "Vd.\n- Báo cáo cho khách hàng: tránh thuật ngữ kỹ thuật\n- Luôn nêu rủi ro về deadline trước",
};

/** Team instructions per role, kept on the server; this box edits the role picked above. */
function NotesSection() {
  const role = useSyncExternalStore(onPrefs, readYtRole, () => null);
  const q = useQuery({ queryKey: ["yt", "notes"], queryFn: () => yt.notes() });
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ role: YtRole; text: string } | null>(null); // null: showing the saved text
  const save = useMutation({
    mutationFn: (text: string) => yt.setNotes({ ...q.data!, [role!]: text }),
    onSuccess: (d) => { qc.setQueryData(["yt", "notes"], d); setEdit(null); },
  });
  if (!role) return <p className="text-sm text-ink-3">Chọn vai trò ở trên trước.</p>;
  if (!q.data) return <p className="text-sm text-ink-3">{q.isError ? `Không tải được: ${(q.error as Error).message}` : "Đang tải…"}</p>;
  const draft = edit?.role === role ? edit.text : null; // an edit belongs to the role it was typed for
  const text = draft ?? q.data[role];
  const name = YT_ROLES.find(([r]) => r === role)?.[1];
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(text.trim()); }}>
      <Textarea rows={6} maxLength={4000} value={text} onChange={(e) => setEdit({ role, text: e.target.value })} aria-label={`Instructions cho AI, vai trò ${name}`} placeholder={NOTES_HINT[role]} className="text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={draft === null || save.isPending}>Lưu</Button>
        {draft !== null && <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>Hủy</Button>}
        <span className="text-xs text-ink-3">Đang áp dụng cho: <b className="text-ink-2">{name}</b> · {text.length}/4000</span>
      </div>
      {save.isError && <p role="alert" className="text-xs text-error">Không lưu được: {(save.error as Error).message}</p>}
    </form>
  );
}

const WEEK = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** When the YouTrack release report writes itself (per browser); the report follows the role above and the project on the left. */
function ReportSection() {
  const [v, setV] = useState(readReportAt);
  const set = (next: Partial<ReportAt>) => { const n = { ...v, ...next }; setV(n); saveReportAt(n); };
  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.on} onChange={(e) => set({ on: e.target.checked })} /> Tự tạo báo cáo mỗi ngày</label>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Ngày tạo báo cáo" className="flex flex-wrap gap-1">
          {WEEK.map((d, k) => {
            const on = v.days.includes(k);
            return <Button key={d} type="button" size="xs" variant={on ? "default" : "outline"} aria-pressed={on} disabled={!v.on}
              onClick={() => set({ days: on ? v.days.filter((x) => x !== k) : [...v.days, k].sort() })}>{d}</Button>;
          })}
        </div>
        <Input aria-label="Giờ tạo báo cáo" type="time" className="h-8 w-28" disabled={!v.on} value={v.time} onChange={(e) => /^\d\d:\d\d$/.test(e.target.value) && set({ time: e.target.value })} />
      </div>
    </div>
  );
}

function TemplatesSection() {
  const [list, setList] = useState(readTemplates);
  const [draft, setDraft] = useState("");
  const update = (next: string[]) => {
    setList(next);
    saveTemplates(next);
  };
  return (
    <div className="grid gap-2">
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        const t = draft.trim();
        if (t && !list.includes(t)) update([...list, t]);
        setDraft("");
      }}>
        <Input aria-label="Mẫu trả lời mới" placeholder="Ví dụ: Em nhận nhé, chiều nay em xử lý" value={draft} maxLength={1000}
          onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" variant="outline" disabled={!draft.trim()}>Thêm</Button>
      </form>
      {list.length > 0 && (
        <ul className="grid divide-y divide-rule border-y border-rule text-sm">
          {list.map((t) => (
            <li key={t} className="flex min-h-10 items-center gap-3 py-1 animate-in fade-in-0 duration-(--dur-short)">
              <span className="min-w-0 flex-1 truncate text-ink" title={t}>{t}</span>
              <Button size="icon-xs" variant="ghost" className="hover:bg-error-wash hover:text-error" aria-label={`Xóa mẫu “${t}”`}
                onClick={() => update(list.filter((x) => x !== t))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SHORTCUTS: [React.ReactNode, string][] = [
  [<><Kbd>j</Kbd> / <Kbd>k</Kbd></>, "Chọn tin dưới / trên"],
  [<Kbd key="r">r</Kbd>, "Trả lời tin đang chọn"],
  [<Kbd key="x">x</Kbd>, "Xong / mở lại tin đang chọn"],
  [<Kbd key="z">z</Kbd>, "Hoàn tác thao tác vừa làm"],
  [<Kbd key="a">a</Kbd>, "Nhập yêu cầu cho AI (khi đang trả lời)"],
  [<Kbd key="/">/</Kbd>, "Tìm kiếm"],
  [<><Kbd>⌘</Kbd>/<Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd></>, "Gửi trả lời"],
  [<Kbd key="esc">Esc</Kbd>, "Đóng trả lời, thoát chế độ chọn"],
  [<Kbd key="?">?</Kbd>, "Mở bảng này"],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Phím tắt</DialogTitle>
        <ShortcutList />
      </DialogContent>
    </Dialog>
  );
}

function ShortcutList() {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-2.5 text-sm">
      {SHORTCUTS.map(([keys, what]) => (
        <div key={what} className="contents">
          <dt className="whitespace-nowrap text-ink-3">{keys}</dt>
          <dd className="text-ink-2">{what}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-[var(--radius-card)] border border-rule bg-cotton p-4 shadow-stock sm:p-5">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Pill segmented control; the active segment slides between options. */
function Segmented<T extends string | number>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className="relative grid w-full auto-cols-fr grid-flow-col rounded-md bg-paper-2 p-0.5 text-xs shadow-groove">
      <span aria-hidden className="absolute inset-y-0.5 left-0.5 rounded-[5px] bg-cotton shadow-stock transition-transform duration-(--dur-short) ease-(--ease-out)"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${i * 100}%)` }} />
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={cn("relative flex h-7 items-center justify-center gap-1.5 rounded-[5px] px-2 transition-colors duration-(--dur-micro)",
            o.value === value ? "font-medium text-ink" : "text-ink-3 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-(--dur-short) disabled:cursor-not-allowed disabled:opacity-40", checked ? "bg-hl" : "bg-paper-3 shadow-groove")}>
      <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-cotton shadow-stock transition-transform duration-(--dur-short) ease-(--ease-out)", checked && "translate-x-4")} />
    </button>
  );
}

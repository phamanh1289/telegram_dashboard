"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown, ExternalLink, Gauge, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Kbd } from "@/components/pending-inbox";
import { RulesSection } from "@/components/tools-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { StreamState } from "@/hooks/use-events";
import { api, ApiError, type ClaudeAccount, type ClaudePrefs, type Status } from "@/lib/api";
import { ACCENTS, applyRowActions, applyTheme, OVERDUE_CHOICES, PLATFORMS, readComposerAiOpen, readDigestTeams, readPlatform, readRowActions, saveDigestTeams, readNotify, readOverdueHours, readTemplates, readLook, readTheme, saveLook, type Look, type UiStyle, saveTemplates, type ThemePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const THEMES = [["light", "Sáng", Sun], ["dark", "Tối", Moon], ["system", "Theo hệ thống", Monitor]] as const;

const save = (key: string, value: string) => {
  try { localStorage[key] = value; } catch {}
  dispatchEvent(new Event("prefs")); // wait labels re-render with the new threshold
};

/** Settings both modules use (theme, Claude, YouTrack token, connections); YouTrack opens it via /?settings=shared. */
export function SharedSettingsDialog({ open, onOpenChange, status, stream }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: Status;
  stream: StreamState;
}) {
  // Read on mount; the parent remounts this (key) each time it opens, so the values are fresh.
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Cài đặt chung</DialogTitle>
        <DialogDescription className="-mt-2">Dùng chung cho Telegram và YouTrack.</DialogDescription>

        <Section title="Giao diện">
          <Segmented label="Giao diện" value={theme} onChange={(v) => { setTheme(v); applyTheme(v); }}
            options={THEMES.map(([v, label, Icon]) => ({ value: v, label: <><Icon className="size-3.5" aria-hidden />{label}</> }))} />
          <LookSection />
        </Section>

        <Section title="Tài khoản Claude" hint="Tài khoản, hạn mức, model và effort cho mọi tính năng AI.">
          <ClaudeSection />
        </Section>

        <Section title="YouTrack" hint="Token chỉ lưu trên máy này (thư mục data/), dùng cho trang YouTrack và nút tạo issue.">
          <YouTrackSection />
        </Section>

        <Section title="Kết nối">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-ink-3">Telegram</dt>
            <dd className={status.state === "connected" ? "text-ok" : "text-warn"}>{status.state === "connected" ? "Đã kết nối" : status.detail || status.state}</dd>
            <dt className="text-ink-3">Cập nhật trực tiếp</dt>
            <dd className={stream === "open" ? "text-ok" : "text-warn"}>{stream === "open" ? "Đang chạy" : stream === "connecting" ? "Đang nối lại…" : "Tạm dừng"}</dd>
            <dt className="text-ink-3">AI</dt>
            <dd className={status.ai_configured ? "text-ok" : "text-ink-3"}>{status.ai_configured ? "Đã cấu hình" : "Chưa cấu hình"}</dd>
            <dt className="text-ink-3">YouTrack</dt>
            <dd className={status.youtrack_configured ? "text-ok" : "text-ink-3"}>{status.youtrack_configured ? "Đã cấu hình" : "Chưa cấu hình (dán token ở mục YouTrack; tạo issue cần thêm YOUTRACK_PROJECT)"}</dd>
          </dl>
        </Section>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Đóng</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STYLES: { value: UiStyle; label: React.ReactNode; hint: string }[] = [
  { value: "simple", label: "Đơn giản", hint: "Phẳng, màu dịu, không gradient, chuyển động nhanh gọn." },
  { value: "default", label: "Mặc định", hint: "Cân bằng: nền ấm nhẹ, bóng mềm, màu nhấn rõ." },
  { value: "vivid", label: <>Rực rỡ <span className="rounded-sm bg-hl-wash px-1 text-[10px] font-semibold text-hl-2">Pro</span></>,
    hint: "Màu đậm hơn, nền loang theo màu của bạn, nút phát sáng, chuyển động nảy; bật gradient thì màu chạy chậm." },
];
const WHEEL = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => `oklch(62% 0.14 ${i * 30})`).join()})`;
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

/** Telegram-only preferences (queue, replies, digest, templates, auto-handle rules). */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Read on mount; the parent remounts this (key) each time it opens, so the values are fresh.
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
    save("notify", on ? "1" : "0");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Cài đặt Telegram</DialogTitle>
        <DialogDescription className="-mt-2">Chỉ cho Telegram, lưu trên trình duyệt này. Giao diện, Claude, YouTrack ở Cài đặt chung (góc trên phải).</DialogDescription>

        <Section title="Hàng chờ" hint="Tin tag chờ lâu hơn ngưỡng này hiện màu hổ phách (quá hạn).">
          <Segmented label="Ngưỡng quá hạn" value={overdue} onChange={(v) => { setOverdue(v); save("overdueHours", String(v)); }}
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
            <Switch label="Mở sẵn Tóm tắt khi soạn trả lời" checked={aiOpen} onChange={(v) => { setAiOpen(v); save("composerAiOpen", v ? "1" : "0"); }} />
          </label>
          <span className="mt-1 grid gap-1.5 text-sm">
            <span>Tóm tắt theo nền tảng</span>
            <Segmented label="Tóm tắt theo nền tảng" value={platform} onChange={(v) => { setPlatform(v); save("aiPlatform", v); }}
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

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Đóng</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PLANS: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };

function planLabel(a: ClaudeAccount) {
  const plan = PLANS[a.subscriptionType ?? ""] ?? a.subscriptionType ?? a.authMethod ?? "—";
  const tier = /max_(\d+x)/.exec(a.rate_tier ?? "")?.[1];
  return tier ? `${plan} · hạn mức Max ${tier}` : plan;
}

const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false }) : null;

/** One shared query; each viewer sets its own poll (react-query runs the shortest). Paused in hidden tabs. */
function useClaudeAccount(every: number | false = false) {
  return useQuery({
    queryKey: ["claude-account"],
    queryFn: ({ signal }) => api<ClaudeAccount>("/claude/account", { signal }),
    refetchInterval: (q) => (q.state.data?.login_pending ? 2000 : every), // 2s until the browser finishes
  });
}

const meterTone = (pct: number) => (pct >= 90 ? "bg-error" : pct >= 70 ? "bg-warn" : "bg-hl");

/** Time until a window resets: a day or more in days, under a day in hours, under an hour in minutes. */
function resetIn(iso: string | null | undefined, now: number) {
  if (!iso) return null;
  const min = Math.max(0, (Date.parse(iso) - now) / 60_000);
  return min >= 1440 ? `${Math.floor(min / 1440)} ngày` : min >= 60 ? `${Math.floor(min / 60)} giờ` : `${Math.ceil(min)} phút`;
}

/** Wall clock that ticks each minute, so countdowns move between polls. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Top-bar pill: % used and time to reset per window, refreshed every 5 minutes; opens the Claude page. */
export function ClaudeQuota() {
  const [open, setOpen] = useState(false);
  const { data: a } = useClaudeAccount(5 * 60_000);
  const now = useNow();
  if (!a) return null;
  const top = Math.max(0, ...a.usage.map((u) => u.percent));
  const summary = a.loggedIn
    ? a.usage.map((u) => `${u.label}: ${Math.round(u.percent)}%${u.resets_at ? `, đặt lại sau ${resetIn(u.resets_at, now)} (${when(u.resets_at)})` : ""}`).join("\n") || "Claude: đã đăng nhập"
    : "Claude chưa đăng nhập";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={summary} aria-label={`Hạn mức Claude. ${summary}`}
        className="flex h-8 items-center gap-2 rounded-[var(--radius-input)] px-2 text-xs text-ink-3 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
        <Gauge aria-hidden className={cn("size-4 shrink-0", !a.loggedIn || top >= 90 ? "text-error" : top >= 70 ? "text-warn" : "text-ok")} />
        {a.loggedIn && a.usage.length ? (
          a.usage.slice(0, 2).map((u) => (
            <span key={u.label} className="hidden items-center gap-1.5 whitespace-nowrap sm:flex">
              <span className="font-medium text-ink-2">{u.label}</span>
              <span aria-hidden className="h-1 w-8 overflow-hidden rounded-full bg-paper-3">
                <span className={cn("block h-full rounded-full", meterTone(u.percent))} style={{ width: `${Math.min(100, u.percent)}%` }} />
              </span>
              <span className="font-mono tabular-nums text-ink-2">{Math.round(u.percent)}%</span>
              {u.resets_at && <span>· {resetIn(u.resets_at, now)}</span>}
            </span>
          ))
        ) : (
          <span className={cn("hidden whitespace-nowrap font-medium sm:inline", !a.loggedIn && "text-warn")}>{a.loggedIn ? "Claude" : "Claude chưa đăng nhập"}</span>
        )}
      </button>
      {open && <ClaudeDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

/** One line in Settings; the full account, quota, login and model/effort live in the dialog. */
function ClaudeSection() {
  const [open, setOpen] = useState(false);
  const { data: a, isError } = useClaudeAccount();
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate">
        {isError ? <span className="text-error">Không chạy được lệnh <code>claude</code></span>
          : !a ? <span className="text-ink-3">Đang kiểm tra…</span>
          : a.loggedIn ? <><span className="text-ok">{a.email ?? "Đã đăng nhập"}</span><span className="text-ink-3"> · {planLabel(a)}</span></>
          : <span className="text-warn">Chưa đăng nhập</span>}
      </span>
      <Button variant="outline" onClick={() => setOpen(true)}>Chi tiết</Button>
      {open && <ClaudeDialog open={open} onOpenChange={setOpen} />}
    </div>
  );
}

/** `claude auth login` opens Anthropic's sign-in in the browser; the CLI keeps the token, never this page. */
function ClaudeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const acc = useClaudeAccount(60_000); // live while the page is open
  const now = useNow();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["claude-account"] });
  const login = useMutation({ mutationFn: () => api<{ url: string | null }>("/claude/login", { method: "POST" }), onSettled: refresh });
  const logout = useMutation({ mutationFn: () => api("/claude/logout", { method: "POST" }), onSettled: refresh });
  const [confirmOut, setConfirmOut] = useState(false);
  const [code, setCode] = useState("");
  const paste = useMutation({
    mutationFn: () => api("/claude/login/code", { method: "POST", json: { code: code.trim() } }),
    onSuccess: () => setCode(""),
    onSettled: refresh,
  });
  const a = acc.data;
  const url = a?.login_url ?? login.data?.url;
  const rows: [string, React.ReactNode][] = a?.loggedIn ? [
    ["Tổ chức", a.orgName],
    ["Loại tổ chức", a.org_type?.replace(/^claude_/, "")],
    ["Dùng thêm", a.extra_usage == null ? null : a.extra_usage ? "Bật" : "Tắt"],
    ["Đăng nhập qua", a.authMethod],
    ["Tạo tài khoản", a.created_at && new Date(a.created_at).toLocaleDateString("vi-VN")],
  ] : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A detail page sliding in from the right; head and foot stay put, only the body scrolls. */}
      <DialogContent className="top-0 right-0 left-auto flex h-dvh max-h-none max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 ease-(--ease-out) sm:max-w-md data-open:zoom-in-100 data-open:slide-in-from-right data-closed:zoom-out-100 data-closed:slide-out-to-right">
        <header className="grid gap-1 border-b border-rule px-5 pt-5 pb-4">
          <DialogTitle>Tài khoản Claude</DialogTitle>
          <DialogDescription className="text-xs text-ink-3">Đăng nhập của Claude Code CLI trên máy này; mọi tính năng AI chạy bằng tài khoản này.</DialogDescription>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto overscroll-contain px-5 py-5">
          {acc.isError ? <p role="alert" className="text-sm text-error">Không chạy được lệnh <code>claude</code> trên máy này.</p>
            : !a ? <div role="status" aria-label="Đang kiểm tra…" className="grid gap-3"><Skeleton className="h-14" /><Skeleton className="h-20" /></div> : (
            <div className="grid gap-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
              <div className="grid gap-4 rounded-lg bg-cotton p-4 shadow-stock">
                {a.loggedIn ? (
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-hl-wash text-lg font-semibold text-hl-ink">
                      {(a.name ?? a.email ?? "?").trim()[0]?.toUpperCase()}
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-semibold text-ink">{a.name ?? a.email}</span>
                      {a.name && <span className="truncate text-xs text-ink-3">{a.email}</span>}
                    </span>
                    <span className="grid shrink-0 justify-items-end gap-0.5 text-xs">
                      <span className="rounded-full bg-hl-wash px-2 py-0.5 font-medium text-hl-ink">{planLabel(a)}</span>
                      {a.subscription_status && (
                        <span className={a.subscription_status === "active" ? "text-ok" : "text-ink-3"}>
                          {a.subscription_status === "active" ? "Đang hoạt động" : a.subscription_status}
                        </span>
                      )}
                    </span>
                  </div>
                ) : <p className="text-sm text-warn">Chưa đăng nhập, các tính năng AI sẽ không chạy.</p>}

                {rows.some(([, v]) => v) && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-md bg-paper-2 p-3 text-xs">
                    {rows.filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="grid min-w-0 gap-0.5"><dt className="text-ink-3">{k}</dt><dd className="truncate text-ink">{v}</dd></div>
                    ))}
                  </dl>
                )}

                {a.usage.length > 0 && (
                  <ul aria-label="Hạn mức đã dùng" className="grid grid-cols-2 gap-3">
                    {a.usage.map((u) => {
                      const pct = Math.min(100, Math.max(0, u.percent));
                      return (
                        <li key={u.label} className="grid content-start gap-2 rounded-md bg-paper-2 p-3">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-medium text-ink-2">{u.label}</span>
                            <span className="font-mono text-xl font-semibold text-ink tabular-nums">{Math.round(pct)}%</span>
                          </span>
                          <span role="meter" aria-label={`Hạn mức ${u.label}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
                            className="h-1.5 overflow-hidden rounded-full bg-paper-3">
                            <span className={cn("block h-full origin-left rounded-full transition-transform duration-500 ease-(--ease-out)", meterTone(pct))} style={{ transform: `scaleX(${pct / 100})` }} />
                          </span>
                          <span className="grid gap-0.5 text-xs text-ink-3">
                            <span>Còn <span className="font-medium text-ink-2 tabular-nums">{100 - Math.round(pct)}%</span></span>
                            {u.resets_at && <span>Đặt lại sau <span className="font-medium text-ink-2">{resetIn(u.resets_at, now)}</span></span>}
                            {u.resets_at && <span>lúc {when(u.resets_at)}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" aria-busy={login.isPending} disabled={login.isPending || a.login_pending} onClick={() => login.mutate()}>
                    {a.login_pending ? "Đang chờ trình duyệt…" : a.loggedIn ? "Đổi tài khoản" : "Đăng nhập Claude"}
                  </Button>
                  {a.loggedIn && (
                    <Button variant="ghost" size="sm" className="hover:bg-error-wash hover:text-error" disabled={logout.isPending}
                      onClick={() => (confirmOut ? logout.mutate() : setConfirmOut(true))} onBlur={() => setConfirmOut(false)}>
                      {confirmOut ? "Bấm lần nữa để đăng xuất" : "Đăng xuất"}
                    </Button>
                  )}
                </div>
                {a.login_pending && (
                  <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); paste.mutate(); }}>
                    <p className="text-xs text-ink-3">
                      Hoàn tất đăng nhập ở tab trình duyệt vừa mở.{url && <> Không thấy tab? <a href={url} target="_blank" rel="noreferrer" className="text-hl-2 underline decoration-hl underline-offset-[3px]">Mở trang đăng nhập</a>, rồi dán mã trang đó hiện ra vào đây.</>}
                    </p>
                    <div className="flex gap-2">
                      <Input aria-label="Mã đăng nhập Claude" autoComplete="off" placeholder="Mã dạng code#state" maxLength={1000}
                        value={code} onChange={(e) => setCode(e.target.value)} />
                      <Button type="submit" variant="outline" disabled={paste.isPending || code.trim().length < 8}>{paste.isPending ? "Đang xác nhận…" : "Xác nhận"}</Button>
                    </div>
                  </form>
                )}
                {paste.isError && <p role="alert" className="text-xs text-error">Mã không hợp lệ hoặc đã hết hạn. Bấm đăng nhập lại.</p>}
                {(login.isError || logout.isError) && <p role="alert" className="text-xs text-error">Không chạy được lệnh claude. Thử lại sau.</p>}
              </div>
            </div>
          )}

          <ClaudePrefsSection />
        </div>

        <DialogFooter className="mx-0 mb-0">
          <DialogClose render={<Button variant="outline" />}>Đóng</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MODELS = [
  { value: "haiku", label: "Haiku", hint: "Nhanh, tiết kiệm hạn mức" },
  { value: "sonnet", label: "Sonnet", hint: "Cân bằng tốc độ và chất lượng" },
  { value: "opus", label: "Opus", hint: "Suy luận sâu, chậm hơn" },
  { value: "fable", label: "Fable", hint: "Mạnh nhất, tốn hạn mức nhất" },
];
const EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
];

/** Model + effort for each kind of claude run; saved on the server (data/claude.json), used from the next run. */
function useClaudePrefs() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["claude-prefs"], queryFn: ({ signal }) => api<ClaudePrefs>("/claude/prefs", { signal }) });
  const save = useMutation({
    mutationFn: (next: ClaudePrefs) => api<ClaudePrefs>("/claude/prefs", { method: "PUT", json: next }),
    onMutate: (next) => qc.setQueryData(["claude-prefs"], next),
    onError: () => void qc.invalidateQueries({ queryKey: ["claude-prefs"] }),
  });
  const p = prefs.data;
  return { p, save, set: (patch: Partial<ClaudePrefs>) => p && save.mutate({ ...p, ...patch }) };
}

/** Model + effort dropdowns inline (reply panel, AI Agent); the same saved prefs as the Claude dialog. */
export function ModelEffortPicker({ task = false, className }: { task?: boolean; className?: string }) {
  const { p, set } = useClaudePrefs();
  if (!p) return null;
  const [m, e, what] = task ? (["task_model", "task_effort", "Task và AI Agent"] as const) : (["model", "effort", "tóm tắt và soạn nháp"] as const);
  return (
    <span role="group" aria-label={`Model và effort cho ${what}`} title={`Model và effort cho ${what} (lưu chung với Cài đặt → Tài khoản Claude)`}
      className={cn("grid w-56 grid-cols-2 gap-1.5", className)}>
      <Dropdown label={`Model cho ${what}`} value={p[m]} onChange={(v) => set({ [m]: v })} options={MODELS} />
      <Dropdown label={`Effort cho ${what}`} value={p[e]} onChange={(v) => set({ [e]: v as ClaudePrefs["effort"] })} options={EFFORTS} />
    </span>
  );
}

function ClaudePrefsSection() {
  const { p, save, set } = useClaudePrefs();
  if (!p) return null;
  const groups = [
    ["Tóm tắt, soạn nháp, Digest", "Chạy thường xuyên, nên chọn model nhanh.", "model", "effort"],
    ["Task và AI Agent", "Đọc code và lập kế hoạch, cần model mạnh hơn.", "task_model", "task_effort"],
  ] as const;
  return (
    <section className="grid gap-2.5">
      <h3 className="text-[0.8125rem] font-semibold text-ink-2">Model và effort</h3>
      <ul className="grid divide-y divide-rule rounded-lg bg-cotton shadow-stock">
        {groups.map(([title, hint, m, e]) => (
          <li key={m} className="grid gap-3 p-4">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium text-ink">{title}</span>
              <span className="text-xs text-ink-3">{hint}</span>
            </span>
            <span className="grid grid-cols-2 gap-2">
              <Dropdown label={`Model cho ${title}`} value={p[m]} onChange={(v) => set({ [m]: v })} options={MODELS} />
              <Dropdown label={`Effort cho ${title}`} value={p[e]} onChange={(v) => set({ [e]: v as ClaudePrefs["effort"] })} options={EFFORTS} />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3">Model mạnh hơn và effort cao hơn thì chậm hơn, tốn hạn mức hơn. Áp dụng từ lần chạy kế tiếp.</p>
      {save.isError && <p role="alert" className="text-xs text-error">Không lưu được lựa chọn. Thử lại.</p>}
    </section>
  );
}

/** Compact select: the popup scales in from the trigger, the chosen item carries a check. */
function Dropdown({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
}) {
  return (
    <Select.Root items={options} value={value} onValueChange={(v) => v != null && onChange(v)}>
      <Select.Trigger aria-label={label}
        className="group flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-[var(--radius-input)] border border-rule-2 bg-cotton pr-2 pl-2.5 text-xs font-medium text-ink transition-[background-color,border-color] duration-(--dur-micro) hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus) data-popup-open:border-hl">
        <Select.Value className="truncate" placeholder="Chọn" />
        <Select.Icon><ChevronDown aria-hidden className="size-3.5 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) group-data-popup-open:rotate-180" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-50 outline-none">
          <Select.Popup className="max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {options.map((o) => (
              <Select.Item key={o.value} value={o.value}
                className="grid cursor-default grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 rounded-md py-1.5 pr-2 pl-2.5 text-sm text-ink outline-none select-none data-highlighted:bg-paper-2">
                <span className="grid">
                  <Select.ItemText className="font-medium">{o.label}</Select.ItemText>
                  {o.hint && <span className="text-xs whitespace-nowrap text-ink-3">{o.hint}</span>}
                </span>
                <Select.ItemIndicator><Check aria-hidden className="size-4 text-hl" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

const YT_ERRORS: Record<string, string> = {
  youtrack_unauthorized: "Token sai, đã thu hồi hoặc không đủ quyền.",
  youtrack_unreachable: "Không kết nối được YouTrack ở URL này.",
};

/** Paste a permanent token (made on the YouTrack profile page); the server checks it before keeping it. */
function YouTrackSection() {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["yt-config"],
    queryFn: ({ signal }) => api<{ base: string; mock: boolean }>("/yt/config", { signal }),
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
  const err = save.error instanceof ApiError ? YT_ERRORS[save.error.code] : null;
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className={cn("text-sm", save.isSuccess || cfg.data?.mock === false ? "text-ok" : "text-ink-3")}>
        {save.isSuccess ? `Đã kết nối: ${save.data.name}` : cfg.data?.mock === false ? `Đang dùng ${cfg.data.base}` : "Chưa có token, trang YouTrack đang hiện dữ liệu mẫu."}
      </p>
      <Input aria-label="URL YouTrack" placeholder="https://youtrack.example.com" inputMode="url" maxLength={200}
        value={url ?? cfg.data?.base ?? ""} onChange={(e) => setUrl(e.target.value)} />
      <div className="flex gap-2">
        <Input aria-label="Token YouTrack" type="password" autoComplete="off" placeholder="perm-…" maxLength={500}
          value={token} onChange={(e) => setToken(e.target.value)} />
        <Button type="submit" variant="outline" aria-busy={save.isPending} disabled={save.isPending || !/^https?:\/\/\S+$/.test(base) || token.trim().length < 8}>
          {save.isPending ? "Đang kiểm tra…" : "Lưu"}
        </Button>
      </div>
      {/^https?:\/\/\S+$/.test(base) && (
        <a href={`${base}/users/me?tab=account-security`} target="_blank" rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs text-hl-2 underline decoration-hl underline-offset-[3px]">
          Tạo token trên YouTrack (Hồ sơ → Account Security → New token) <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
      {save.isError && <p role="alert" className="text-xs text-error">{err ?? "Không lưu được. Kiểm tra URL (bắt đầu bằng https://) và token."}</p>}
    </form>
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
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-2.5 text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what} className="contents">
              <dt className="whitespace-nowrap text-ink-3">{keys}</dt>
              <dd className="text-ink-2">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2.5 border-t border-rule pt-4">
      <h3 className="text-[0.8125rem] font-semibold text-ink-2">{title}</h3>
      {hint && <p className="-mt-1.5 text-xs text-ink-3">{hint}</p>}
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

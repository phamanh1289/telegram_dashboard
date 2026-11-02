"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import { ClaudeSection } from "@/components/claude";
import { Kbd } from "@/components/pending-inbox";
import { RulesSection } from "@/components/tools-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StreamState } from "@/hooks/use-events";
import { api, errorText, type Status } from "@/lib/api";
import { ACCENTS, applyRowActions, applyTheme, OVERDUE_CHOICES, PLATFORMS, readComposerAiOpen, readDigestTeams, readPlatform, readRowActions, saveDigestTeams, readNotify, readOverdueHours, readTemplates, readLook, readTheme, saveLook, setPref, type Look, type UiStyle, saveTemplates, type ThemePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const THEMES = [["light", "Sáng", Sun], ["dark", "Tối", Moon], ["system", "Theo hệ thống", Monitor]] as const;

/** Settings both modules use (theme, Claude, YouTrack token, connections); YouTrack opens it via /?settings=shared. */
export function SharedSettingsDialog({ open, onOpenChange, status, stream }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: Status;
  stream?: StreamState; // the YouTrack page has no live stream
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
            {stream && <>
              <dt className="text-ink-3">Cập nhật trực tiếp</dt>
              <dd className={stream === "open" ? "text-ok" : "text-warn"}>{stream === "open" ? "Đang chạy" : stream === "connecting" ? "Đang nối lại…" : "Tạm dừng"}</dd>
            </>}
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
    setPref("notify", on ? "1" : "0");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Cài đặt Telegram</DialogTitle>
        <DialogDescription className="-mt-2">Chỉ cho Telegram, lưu trên trình duyệt này. Giao diện, Claude, YouTrack ở Cài đặt chung (góc trên phải).</DialogDescription>

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

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Đóng</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      {save.isError && <p role="alert" className="text-xs text-error">{errorText(save.error, YT_ERRORS, "Không lưu được. Kiểm tra URL (bắt đầu bằng https://) và token.")}</p>}
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

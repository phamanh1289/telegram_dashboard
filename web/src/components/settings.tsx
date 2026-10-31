"use client";

import { Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import { Kbd } from "@/components/pending-inbox";
import { RulesSection } from "@/components/tools-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StreamState } from "@/hooks/use-events";
import type { Status } from "@/lib/api";
import { applyTheme, OVERDUE_CHOICES, PLATFORMS, readComposerAiOpen, readPlatform, readNotify, readOverdueHours, readTemplates, readTheme, saveTemplates, type ThemePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const THEMES = [["light", "Sáng", Sun], ["dark", "Tối", Moon], ["system", "Theo hệ thống", Monitor]] as const;

/** Every per-browser preference plus the auto-handle rules and the connection state, in one dialog. */
export function SettingsDialog({ open, onOpenChange, status, stream }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: Status;
  stream: StreamState;
}) {
  // Read on mount; the parent remounts this (key) each time it opens, so the values are fresh.
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const [overdue, setOverdue] = useState(readOverdueHours);
  const [aiOpen, setAiOpen] = useState(readComposerAiOpen);
  const [platform, setPlatform] = useState(readPlatform);
  const save = (key: string, value: string) => {
    try { localStorage[key] = value; } catch {}
    dispatchEvent(new Event("prefs")); // wait labels re-render with the new threshold
  };
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
        <DialogTitle>Cài đặt</DialogTitle>
        <DialogDescription className="-mt-2">Lưu trên trình duyệt này; giao diện dùng chung với YouTrack.</DialogDescription>

        <Section title="Giao diện">
          <Segmented label="Giao diện" value={theme} onChange={(v) => { setTheme(v); applyTheme(v); }}
            options={THEMES.map(([v, label, Icon]) => ({ value: v, label: <><Icon className="size-3.5" aria-hidden />{label}</> }))} />
        </Section>

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
        </Section>

        <Section title="Trả lời">
          <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
            <span>Mở sẵn Trợ lý khi soạn trả lời</span>
            <Switch label="Mở sẵn Trợ lý khi soạn trả lời" checked={aiOpen} onChange={(v) => { setAiOpen(v); save("composerAiOpen", v ? "1" : "0"); }} />
          </label>
          <span className="mt-1 grid gap-1.5 text-sm">
            <span>Trợ lý phân tích theo nền tảng</span>
            <Segmented label="Trợ lý phân tích theo nền tảng" value={platform} onChange={(v) => { setPlatform(v); save("aiPlatform", v); }}
              options={PLATFORMS.map(([value, label]) => ({ value, label }))} />
          </span>
        </Section>

        <Section title="Mẫu trả lời nhanh" hint="Hiện dưới ô trả lời; bấm để chèn vào nội dung.">
          <TemplatesSection />
        </Section>

        <Section title="Tự đánh dấu “đã xử lý”">
          <RulesSection />
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
            <dd className={status.youtrack_configured ? "text-ok" : "text-ink-3"}>{status.youtrack_configured ? "Đã cấu hình" : "Chưa cấu hình (cần YOUTRACK_URL, YOUTRACK_TOKEN, YOUTRACK_PROJECT)"}</dd>
          </dl>
        </Section>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Đóng</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-(--dur-short)", checked ? "bg-hl" : "bg-paper-3 shadow-groove")}>
      <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-cotton shadow-stock transition-transform duration-(--dur-short) ease-(--ease-out)", checked && "translate-x-4")} />
    </button>
  );
}

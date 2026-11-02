"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown, Gauge } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ClaudeAccount, type ClaudePrefs } from "@/lib/api";
import { byUnit, dayLabel, timeLabel, useNow } from "@/lib/inbox";
import { cn } from "@/lib/utils";

// Claude Code CLI account, quota pill and the model/effort prefs every AI feature runs with.

const PLANS: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };

function planLabel(a: ClaudeAccount) {
  const plan = PLANS[a.subscriptionType ?? ""] ?? a.subscriptionType ?? a.authMethod ?? "—";
  const tier = /max_(\d+x)/.exec(a.rate_tier ?? "")?.[1];
  return tier ? `${plan} · hạn mức Max ${tier}` : plan;
}

/** One shared query; each viewer sets its own poll (react-query runs the shortest). Paused in hidden tabs. */
function useClaudeAccount(every: number | false = false) {
  return useQuery({
    queryKey: ["claude-account"],
    queryFn: ({ signal }) => api<ClaudeAccount>("/claude/account", { signal }),
    refetchInterval: (q) => (q.state.data?.login_pending ? 2000 : every), // 2s until the browser finishes
  });
}

const meterTone = (pct: number) => (pct >= 90 ? "bg-error" : pct >= 70 ? "bg-warn" : "bg-hl");

/** Time until a window resets, in its largest whole unit ("3 giờ"). */
const resetIn = (iso: string, now: number) => byUnit(Math.ceil(Math.max(0, (Date.parse(iso) - now) / 60_000))).join(" ");

/** Top-bar pill: % used and time to reset per window, refreshed every 5 minutes; opens the Claude page. */
export function ClaudeQuota() {
  const [open, setOpen] = useState(false);
  const { data: a } = useClaudeAccount(5 * 60_000);
  const now = useNow();
  if (!a) return null;
  const top = Math.max(0, ...a.usage.map((u) => u.percent));
  const summary = a.loggedIn
    ? a.usage.map((u) => `${u.label}: ${Math.round(u.percent)}%${u.resets_at ? `, đặt lại sau ${resetIn(u.resets_at, now)} (${timeLabel(u.resets_at, true)})` : ""}`).join("\n") || "Claude: đã đăng nhập"
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
export function ClaudeSection() {
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
    ["Tạo tài khoản", a.created_at && dayLabel(a.created_at)],
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
                            {u.resets_at && <span>lúc {timeLabel(u.resets_at, true)}</span>}
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
// "" = the CLI's own default; the rest step up in cost.
const EFFORTS = [
  { value: "", label: "Mặc định" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
] as const satisfies readonly { value: ClaudePrefs["effort"]; label: string }[];

/** Model + effort for each kind of claude run; saved on the server (data/claude.json), used from the next run. */
function useClaudePrefs() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["claude-prefs"], queryFn: ({ signal }) => api<ClaudePrefs>("/claude/prefs", { signal }) });
  const save = useMutation({
    scope: { id: "claude-prefs" }, // one PUT at a time: a dragged slider must not land its steps out of order
    mutationFn: (next: ClaudePrefs) => api<ClaudePrefs>("/claude/prefs", { method: "PUT", json: next }),
    onMutate: (next) => qc.setQueryData(["claude-prefs"], next),
    onError: () => void qc.invalidateQueries({ queryKey: ["claude-prefs"] }),
  });
  const p = prefs.data;
  return { p, isError: prefs.isError, save, set: (patch: Partial<ClaudePrefs>) => p && save.mutate({ ...p, ...patch }) };
}

/** Model + effort inline (reply panel, AI Agent); the same saved prefs as the Claude dialog. */
export function ModelEffortPicker({ task = false, className }: { task?: boolean; className?: string }) {
  const { p, isError, save, set } = useClaudePrefs();
  if (!p) return isError ? <span role="alert" className={cn("text-xs text-error", className)}>Không đọc được model/effort</span> : null;
  const [m, e, what] = task ? (["task_model", "task_effort", "Task và AI Agent"] as const) : (["model", "effort", "tóm tắt và soạn nháp"] as const);
  return (
    <span role="group" aria-label={`Model và effort cho ${what}`} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      <span className="w-32"><Dropdown label={`Model cho ${what}`} value={p[m]} onChange={(v) => set({ [m]: v })} options={MODELS} /></span>
      <EffortSlider label={`Effort cho ${what}`} value={p[e]} onChange={(v) => set({ [e]: v })} className="w-28" />
      {save.isError && <span role="alert" className="text-xs text-error">Không lưu được, thử lại</span>}
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
            <span className="grid items-center gap-2 sm:grid-cols-2">
              <Dropdown label={`Model cho ${title}`} value={p[m]} onChange={(v) => set({ [m]: v })} options={MODELS} />
              <EffortSlider label={`Effort cho ${title}`} value={p[e]} onChange={(v) => set({ [e]: v })} className="flex-1" />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3">Model mạnh hơn và effort cao hơn thì chậm hơn, tốn hạn mức hơn. Áp dụng từ lần chạy kế tiếp.</p>
      {save.isError && <p role="alert" className="text-xs text-error">Không lưu được lựa chọn. Thử lại.</p>}
    </section>
  );
}

// Effort steps: neutral for the CLI default, then green (fast, cheap) → amber → red (slow, costly); the track past the thumb is dimmed.
const EFFORT_TINT = ["var(--color-ink-3)", "var(--color-ok)", "color-mix(in oklch, var(--color-ok), var(--color-warn))", "var(--color-warn)",
  "color-mix(in oklch, var(--color-warn), var(--color-error))", "var(--color-error)"];

function EffortSlider({ label, value, onChange, className }: {
  label: string; value: ClaudePrefs["effort"]; onChange: (v: ClaudePrefs["effort"]) => void; className?: string;
}) {
  const i = Math.max(0, EFFORTS.findIndex((o) => o.value === value)); // the type covers every step
  const pct = (i / (EFFORTS.length - 1)) * 100;
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
      Effort
      <input type="range" min={0} max={EFFORTS.length - 1} step={1} value={i} aria-label={label} aria-valuetext={EFFORTS[i].label}
        onChange={(ev) => onChange(EFFORTS[Number(ev.target.value)].value)}
        className={cn("hue-range", className)} style={{
          "--track": `linear-gradient(to right, transparent ${pct}%, color-mix(in oklch, var(--color-paper-2) 80%, transparent) ${pct}%), linear-gradient(to right, ${EFFORT_TINT.join(", ")})`,
          "--thumb": EFFORT_TINT[i],
        } as React.CSSProperties} />
      <span className="w-16 shrink-0 font-medium text-ink">{EFFORTS[i].label}</span>
    </label>
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

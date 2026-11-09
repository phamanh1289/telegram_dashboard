"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChartColumn, Copy, ExternalLink, Gauge, History, Play, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dropdown } from "@/components/ui/dropdown";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DIALOG_SHEET } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Pill, Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { type AiCatalogEntry, api, errorText } from "@/lib/api";
import { copyText, useNow } from "@/lib/inbox";
import { dayLabel, timeLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import { card, type Effort, EFFORT_LABELS, meterTone, planName, planTier, type Provider, PROVIDERS, resetIn, sectionHead, useAccounts, useAiPrefs, useClaudeAccount, useRecheck } from "@/components/ai/prefs";
import { HistoryTab, Quota, secs, UsageTab } from "@/components/ai/usage";

// The AI CLIs (Claude, Codex, Antigravity) in one place: which one runs every AI feature, what each offers (the backend's
// catalog), each CLI's own model/effort, every CLI's login in one shape, the top-bar pill, the account page.
// Shared hooks live in ai/prefs.ts, the Usage / History tabs in ai/usage.tsx.

export { type AccountView, type Provider, useAccounts, useAiPrefs } from "@/components/ai/prefs";

/** Top-bar pill for the AI in use: its quota windows (Antigravity: the model group picked), else its name and login state; opens its account page. */
export function AiQuota({ scope = "telegram" }: { scope?: AiScope }) {
  const [open, setOpen] = useState(false);
  const { provider, name, p } = useAiPrefs();
  const acc = useAccounts(5 * 60_000)[provider];
  const now = useNow();
  if (acc.checking) return null;
  const group = /^(claude|gpt)/.test(p?.by.antigravity?.model ?? "") ? "Claude & GPT" : "Gemini";
  const usage = !acc.loggedIn ? [] : provider === "antigravity" ? acc.usage.filter((u) => u.label.endsWith(group)) : acc.usage;
  const top = Math.max(0, ...usage.map((u) => u.percent));
  const bad = !acc.installed || !acc.loggedIn;
  const summary = !acc.installed ? `${name} chưa cài` : !acc.loggedIn ? `${name} chưa đăng nhập`
    : usage.map((u) => `${u.label}: ${Math.round(u.percent)}%${u.resets_at ? `, đặt lại sau ${resetIn(u.resets_at, now)} (${timeLabel(u.resets_at, true)})` : ""}`).join("; ")
      || `${name}: ${acc.email ?? "đã đăng nhập"}`;
  return (
    <>
      <Hint side="bottom" title={`AI đang dùng: ${name}`} text={`${summary}. Bấm để xem tài khoản và hạn mức.`}>
      <button type="button" onClick={() => setOpen(true)} aria-label={`AI đang dùng: ${name}. ${summary}`}
        className="flex h-8 items-center gap-2 rounded-[var(--radius-input)] px-2 text-xs text-ink-3 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
        <Gauge aria-hidden className={cn("size-4 shrink-0", bad || top >= 90 ? "text-error" : top >= 70 ? "text-warn" : "text-ok")} />
        {usage.length ? (
          usage.slice(0, 2).map((u) => (
            <span key={u.label} className="hidden items-center gap-1.5 whitespace-nowrap sm:flex">
              <span className="font-medium text-ink-2">{u.label.split(" · ")[0]}</span>
              <span aria-hidden className="h-1 w-8 overflow-hidden rounded-full bg-paper-3">
                <span className={cn("block h-full rounded-full", meterTone(u.percent))} style={{ width: `${Math.min(100, u.percent)}%` }} />
              </span>
              <span className="font-mono tabular-nums text-ink-2">{Math.round(u.percent)}%</span>
              {u.resets_at && <span>{resetIn(u.resets_at, now)}</span>}
            </span>
          ))
        ) : (
          <span className={cn("hidden whitespace-nowrap font-medium sm:inline", bad && "text-warn")}>{bad ? summary : name}</span>
        )}
      </button>
      </Hint>
      {open && <AiDialog provider={provider} scope={scope} open={open} onOpenChange={setOpen} />}
    </>
  );
}

/** Settings › AI › Tài khoản: one line per CLI; its account, model/effort and log open in its AI page. */
export function AiAccounts() {
  const [open, setOpen] = useState<Provider | null>(null);
  const { provider, info } = useAiPrefs();
  const accounts = useAccounts(15_000);
  const recheck = useRecheck();
  return (
    <>
      {PROVIDERS.map((id) => {
        const a = accounts[id];
        const name = info(id)?.name ?? id;
        const dot = a.checking || a.pending ? "bg-ink-3 animate-pulse" : a.installed && a.loggedIn ? "bg-ok" : "bg-signal";
        return (
          <div key={id} className="grid gap-2 py-3 first:pt-1 last:pb-0">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper-2 text-sm font-semibold text-ink-2 shadow-groove">{name[0]}</span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  {name} CLI
                  {id === provider && <span className="rounded-full bg-ok-wash px-1.5 text-[0.6875rem] leading-5 font-medium text-ok">Đang dùng</span>}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
                  <span className="min-w-0 truncate">
                    {a.checking ? <span className="text-ink-3">Đang kiểm tra…</span>
                      : !a.installed ? <span className="text-signal-2">Chưa cài</span>
                      : a.loggedIn ? <><span className="text-ink-2">{a.email ?? "Đã đăng nhập"}</span>{a.plan && <span className="text-ink-3"> · {a.plan}</span>}</>
                      : a.pending ? <span className="text-ink-3">Đang chờ đăng nhập…</span>
                      : <span className="text-signal-2">Chưa đăng nhập</span>}
                  </span>
                </span>
              </span>
              {!a.checking && (a.installed
                ? <Button size="sm" variant={a.loggedIn ? "ghost" : "outline"} onClick={() => setOpen(id)}>{a.loggedIn ? "Chi tiết" : "Đăng nhập"}</Button>
                : <Button size="sm" variant="outline" onClick={recheck}>Đã cài, kiểm tra lại</Button>)}
            </div>
            {!a.checking && !a.installed && a.install && <div className="pl-12"><InstallCmd cmd={a.install} /></div>}
          </div>
        );
      })}
      {open && <AiDialog provider={open} open onOpenChange={(o) => !o && setOpen(null)} />}
    </>
  );
}

/** An install command with a copy button; run it in Terminal, then check again. */
export function InstallCmd({ cmd }: { cmd: string }) {
  return (
    <span className="flex items-center gap-1 rounded-md bg-paper-2 py-0.5 pr-0.5 pl-2 shadow-groove">
      <code className="min-w-0 flex-1 truncate text-xs">{cmd}</code>
      <Hint side="bottom" text="Copy lệnh cài, dán vào Terminal">
        <Button size="icon-xs" variant="ghost" aria-label="Copy lệnh cài" onClick={() => void copyText(cmd, "Đã copy lệnh cài")}>
          <Copy />
        </Button>
      </Hint>
    </span>
  );
}

const TABS = [["account", "Tài khoản", UserRound], ["usage", "Usage", ChartColumn], ["history", "History", History]] as const;
type Tab = (typeof TABS)[number][0];

/** One CLI's page: its account and model/effort, its quota and run report, and the history of every run. */
function AiDialog({ provider, scope, open, onOpenChange }: { provider: Provider; scope?: AiScope; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { provider: picked, info } = useAiPrefs();
  const [tab, setTab] = useState<Tab>("account");
  const [days, setDays] = useState<number>(7); // shared by Usage and History
  const name = info(provider)?.name ?? "AI";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A detail page sliding in from the right; head and foot stay put, only the body scrolls. */}
      <DialogContent className={cn(DIALOG_SHEET, "ai-in")}>
        <header className="grid gap-3 border-b border-rule bg-paper-2 px-5 pt-5">
          <span className="grid gap-1 pr-8">
            <DialogTitle className="flex items-center gap-2">
              Tài khoản {name}
              {provider === picked && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-medium text-ok">Đang dùng</span>}
            </DialogTitle>
            <DialogDescription className="text-xs text-ink-2">
              {provider === picked ? `Đăng nhập của ${name} CLI trên máy này; mọi tính năng AI đang chạy bằng ${name}.`
                : `Đăng nhập của ${name} CLI trên máy này. Đang dùng ${info(picked)?.name ?? "AI khác"}; đổi ở Cài đặt › AI › Dùng AI nào.`}
            </DialogDescription>
          </span>
          <span role="tablist" aria-label="Mục" className="flex gap-5 text-sm">
            {TABS.map(([k, label, Icon]) => (
              <button key={k} type="button" role="tab" id={`ai-tab-${k}`} aria-selected={tab === k} aria-controls="ai-tabpanel" onClick={() => setTab(k)}
                className={cn("relative flex items-center gap-1.5 pb-2.5 font-medium transition-colors duration-(--dur-micro)", tab === k ? "text-ink" : "text-ink-3 hover:text-ink")}>
                {tab === k && <Pill id="ai-tab" className="inset-x-0 bottom-0 h-0.5 rounded-full bg-hl" />}
                <Icon aria-hidden className="size-4" />
                {label}
              </button>
            ))}
          </span>
        </header>

        <div key={tab} role="tabpanel" id="ai-tabpanel" aria-labelledby={`ai-tab-${tab}`}
          className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto overscroll-contain px-5 py-5 animate-in fade-in-0 duration-(--dur-short)">
          {tab === "usage" ? <UsageTab provider={provider} days={days} setDays={setDays} />
            : tab === "history" ? <HistoryTab days={days} setDays={setDays} />
            : <>
              {provider === "claude" ? <ClaudeAccountCard /> : <CliAccountCard provider={provider} />}
              <PrefsSection provider={provider} scope={scope} />
            </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Avatar and who is signed in, the plan badges under it, the account actions on the right. */
function Identity({ name, email, actions, children }: { name?: string | null; email?: string | null; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-hl-wash text-lg font-semibold text-hl-2">
        {(name ?? email ?? "?").trim()[0]?.toUpperCase()}
      </span>
      <span className="grid min-w-0 flex-1 gap-1.5">
        <span className="grid">
          <span className="truncate font-semibold text-ink">{name ?? email ?? "Đã đăng nhập"}</span>
          {name && email && <span className="truncate text-xs text-ink-2">{email}</span>}
        </span>
        {children && <span className="flex flex-wrap items-center gap-1.5 text-xs">{children}</span>}
      </span>
      {actions && <span className="flex shrink-0 gap-1 max-sm:basis-full max-sm:pl-14">{actions}</span>}
    </div>
  );
}

/** The plan and organisation facts, label over value, in a compact grid. */
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter((r) => r[1] != null && r[1] !== "");
  if (!shown.length) return null;
  return (
    <section aria-label="Gói và tổ chức" className="grid gap-2.5">
      <h3 className={sectionHead}>Gói và tổ chức</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
        {shown.map(([k, v]) => (
          <div key={k} className="grid min-w-0 gap-0.5">
            <dt className="text-ink-3">{k}</dt>
            <dd className="truncate font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// The account card: who and which plan, then the quota left, then the plan's facts, a rule between each part.
const accountCard = cn(card, "gap-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short) [&>*+*]:border-t [&>*+*]:border-rule [&>*+*]:pt-4");
const badge = "rounded-full bg-hl-wash px-2 py-0.5 font-medium whitespace-nowrap text-hl-2";
const status = (s: string) => (
  <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", s === "active" ? "text-ok" : "text-ink-2")}>
    <span aria-hidden className={cn("size-1.5 rounded-full", s === "active" ? "bg-ok" : "bg-ink-3")} />
    {s === "active" ? "Đang hoạt động" : s}
  </span>
);

/** `claude auth login` opens Anthropic's sign-in in the browser; the CLI keeps the token, never this page. */
function ClaudeAccountCard() {
  const qc = useQueryClient();
  const acc = useClaudeAccount(60_000); // live while the page is open
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
  if (acc.isError) return <p role="alert" className="text-sm text-error">{errorText(acc.error, {}, "Không chạy được lệnh claude trên máy này.")}</p>;
  if (!a) return <div role="status" aria-label="Đang kiểm tra…" className="grid gap-3"><Skeleton className="h-48" /><Skeleton className="h-40" /></div>;
  const url = a.login_url ?? login.data?.url;
  const tier = planTier(a);
  const loginBtn = (
    <Button variant={a.loggedIn ? "outline" : "default"} size="sm" aria-busy={login.isPending} disabled={login.isPending || a.login_pending} onClick={() => login.mutate()}>
      {a.login_pending ? "Đang chờ trình duyệt…" : a.loggedIn ? "Đổi tài khoản" : "Đăng nhập Claude"}
    </Button>
  );
  return (
    <section aria-label="Tài khoản" className={accountCard}>
      <div className="grid gap-3">
        {a.loggedIn ? (
          <Identity name={a.name} email={a.email} actions={<>
            {loginBtn}
            <Button variant="ghost" size="sm" className="hover:bg-error-wash hover:text-error" disabled={logout.isPending}
              onClick={() => (confirmOut ? logout.mutate() : setConfirmOut(true))} onBlur={() => setConfirmOut(false)}>
              {confirmOut ? "Bấm lần nữa để đăng xuất" : "Đăng xuất"}
            </Button>
          </>}>
            <span className={badge}>{planName(a)}{tier && <> · <span className="font-mono">{tier}</span></>}</span>
            {a.subscription_status && status(a.subscription_status)}
          </Identity>
        ) : (
          <div className="grid justify-items-start gap-3">
            <span className="grid gap-1">
              <span className="font-semibold text-ink">Chưa đăng nhập</span>
              <span className="text-xs text-ink-2">Đăng nhập để dùng Claude cho tóm tắt, soạn nháp, Digest, YouTrack và AI Agent.</span>
            </span>
            {loginBtn}
          </div>
        )}
        {a.login_pending && (
          <form className="grid gap-2 rounded-md bg-paper-2 p-3" onSubmit={(e) => { e.preventDefault(); paste.mutate(); }}>
            <p className="text-xs text-ink-2">
              Hoàn tất đăng nhập ở tab trình duyệt vừa mở.{url && <> Không thấy tab? <a href={url} target="_blank" rel="noreferrer" className="text-hl-2 underline decoration-hl underline-offset-[3px]">Mở trang đăng nhập</a>, rồi dán mã trang đó hiện ra vào đây.</>}
            </p>
            <div className="flex gap-2">
              <Input aria-label="Mã đăng nhập Claude" autoComplete="off" placeholder="Mã dạng code#state" maxLength={1000}
                value={code} onChange={(e) => setCode(e.target.value)} />
              <Button type="submit" variant="outline" disabled={paste.isPending || code.trim().length < 8}>{paste.isPending ? "Đang xác nhận…" : "Xác nhận"}</Button>
            </div>
          </form>
        )}
        {paste.isError && <p role="alert" className="text-xs text-error">{errorText(paste.error, {
          claude_login_timeout: "Claude chưa xác nhận mã sau một lúc chờ. Bấm đăng nhập lại.",
          claude_login_not_started: "Phiên đăng nhập đã đóng (ví dụ sau khi khởi động lại). Bấm đăng nhập lại.",
        }, "Mã không hợp lệ hoặc đã hết hạn. Bấm đăng nhập lại.")}</p>}
        {(login.isError || logout.isError) && <p role="alert" className="text-xs text-error">{errorText(login.error ?? logout.error, {}, "Không chạy được lệnh claude. Thử lại sau.")}</p>}
      </div>
      {a.loggedIn && <Quota provider="claude" />}
      {a.loggedIn && <Facts rows={[
        ["Gói", tier ? `${planName(a)}, hạn mức Max ${tier}` : planName(a)],
        ["Dùng thêm ngoài hạn mức", a.extra_usage == null ? null : a.extra_usage ? "Bật" : "Tắt"],
        ["Tổ chức", a.orgName],
        ["Loại tổ chức", a.org_type?.replace(/^claude_/, "")],
        ["Đăng nhập qua", a.authMethod],
        ["Tạo tài khoản", a.created_at && dayLabel(a.created_at)],
      ]} />}
    </section>
  );
}

/** Codex: `codex login` opens the browser. Antigravity: a Terminal on an interactive `agy`, which signs in with Google on first run. */
function CliAccountCard({ provider }: { provider: Provider }) {
  const { info } = useAiPrefs();
  const a = useAccounts(15_000)[provider];
  const recheck = useRecheck();
  const login = useMutation({ mutationFn: () => api<{ url: string | null }>(`/ai/${provider}/login`, { method: "POST" }), onSettled: recheck });
  const logout = useMutation({ mutationFn: () => api(`/ai/${provider}/logout`, { method: "POST" }), onSettled: recheck });
  const name = info(provider)?.name ?? provider;
  if (a.checking) return <div role="status" aria-label="Đang kiểm tra…"><Skeleton className="h-40" /></div>;
  return (
    <section aria-label="Tài khoản" className={accountCard}>
      <div className="grid gap-3">
        {a.loggedIn ? (
          <Identity email={a.email} actions={provider === "codex" && (
            <Button variant="ghost" size="sm" className="hover:bg-error-wash hover:text-error" disabled={logout.isPending} onClick={() => logout.mutate()}>Đăng xuất</Button>
          )}>
            {a.plan && <span className={badge}>{a.plan}</span>}
          </Identity>
        ) : (
          <div className="grid justify-items-start gap-3">
            <span className="grid gap-1">
              <span className="font-semibold text-ink">{a.installed ? "Chưa đăng nhập" : `Chưa cài ${name} CLI`}</span>
              <span className="text-xs text-ink-2">{a.installed ? `Đăng nhập để dùng ${name} cho tóm tắt, soạn nháp, Digest, YouTrack và AI Agent.` : "Cài bằng lệnh dưới trong Terminal, rồi kiểm tra lại."}</span>
            </span>
            {!a.installed && <InstallCmd cmd={a.install} />}
            {!a.installed ? <Button variant="outline" size="sm" onClick={recheck}>Đã cài, kiểm tra lại</Button> : (
              <Button size="sm" aria-busy={login.isPending} disabled={login.isPending || a.pending} onClick={() => login.mutate()}>
                {a.pending ? "Đang chờ trình duyệt…" : `Đăng nhập ${name}`}
              </Button>
            )}
          </div>
        )}
        {a.pending && a.url && (
          <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs text-hl-2 underline decoration-hl underline-offset-[3px]">
            Trình duyệt không tự mở? Mở trang đăng nhập <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        {provider === "antigravity" && a.installed && !a.loggedIn && (
          <p className="text-xs text-ink-3">Đăng nhập mở Terminal chạy <code>agy</code>; đăng nhập Google trong trình duyệt, xong thì đóng Terminal.</p>
        )}
        {provider === "antigravity" && a.loggedIn && <p className="text-xs text-ink-3">Đổi tài khoản: gõ <code>/logout</code> trong <code>agy</code> rồi đăng nhập lại.</p>}
        {(login.isError || logout.isError) && <p role="alert" className="text-xs text-error">Không chạy được lệnh {provider}. Thử lại sau.</p>}
      </div>
      {a.loggedIn && <Quota provider={provider} />}
    </section>
  );
}

const THRESHOLDS = [70, 80, 90, 95].map((n) => ({ value: String(n), label: `${n}%` }));

/** Which saved picks a run uses: model key, effort key, name, why. */
export type RunKind = "chat" | "brief" | "task" | "yt" | "yt_task";
const KINDS = {
  chat: ["model", "effort", "Tóm tắt, soạn nháp", "Chạy thường xuyên: nên chọn model nhanh."],
  brief: ["brief_model", "brief_effort", "Briefing và Digest", "Đọc nhiều tin một lần. “Như tóm tắt”: dùng lựa chọn dòng trên."],
  task: ["task_model", "task_effort", "Task và AI Agent", "Đọc code, lập kế hoạch: cần model mạnh."],
  yt: ["yt_model", "yt_effort", "Hỏi AI, báo cáo, soạn ticket", "AI YouTrack hằng ngày: hỏi, báo cáo, lọc và soạn ticket."],
  yt_task: ["yt_task_model", "yt_task_effort", "Đọc code, nhiều ticket", "AI YouTrack đọc code dự án hoặc trên 10 ticket một lần: cần model mạnh."],
} as const;
/** What "" means for a kind when it is not the CLI default: [label, hint] (Briefing and YouTrack fall back to a Telegram row). */
const INHERITS: Partial<Record<RunKind, readonly [string, string]>> = {
  brief: ["Như tóm tắt", "Dùng lựa chọn của tóm tắt, soạn nháp"],
  yt: ["Như Telegram", "Dùng lựa chọn của tóm tắt, soạn nháp"],
  yt_task: ["Như Telegram", "Dùng lựa chọn của Task và AI Agent"],
};
/** The module whose runs a picks list sets: Telegram's or YouTrack's AI features. */
export type AiScope = "telegram" | "youtrack";
const SCOPES: Record<AiScope, RunKind[]> = { telegram: ["chat", "brief", "task"], youtrack: ["yt", "yt_task"] };

/** One CLI's model dropdown and effort slider, both from its catalog entry (no efforts: the CLI takes none, no slider).
 *  `inherit`: what "" means here when it is not the CLI default (Briefing: the "chat" picks). `bare`: no "Effort" caption (a table with a header). */
export function Picks({ c, label, model, effort, onModel, onEffort, modelClass, effortClass, inherit, bare, variant = "full" }: {
  c: AiCatalogEntry; label: string; model: string; effort: Effort;
  onModel: (v: string) => void; onEffort: (v: Effort) => void; modelClass?: string; effortClass?: string; inherit?: readonly [string, string]; bare?: boolean;
  variant?: EffortVariant;
}) {
  // A saved id the CLI no longer lists still shows, so the dropdown never looks empty.
  let models = c.models.some((o) => o.value === model) ? c.models : [...c.models, { value: model, label: model, hint: "Không còn trong danh sách của CLI" }];
  if (inherit) models = models.map((o) => (o.value === "" ? { ...o, label: inherit[0], hint: inherit[1] } : o));
  return (
    <>
      <span className={modelClass}><Dropdown label={`Model ${c.name} cho ${label}`} value={model} onChange={onModel} options={models} /></span>
      {c.efforts.length > 0 && <EffortSlider label={`Effort ${c.name} cho ${label}`} steps={c.efforts} value={effort} onChange={onEffort} className={effortClass} inherit={inherit?.[0]} bare={bare} variant={variant} />}
    </>
  );
}

/** Model + effort of the AI in use, inline (reply panel, AI Agent, Briefing); the same saved picks as its AI page.
 *  Short (the effort's name only) by default, for prompt boxes; `variant="full"` adds the slider (settings). */
export function ModelEffortPicker({ kind = "chat", compact = false, className, variant = "short" }: {
  kind?: RunKind; compact?: boolean; className?: string; variant?: EffortVariant;
}) {
  const { p, isError, save, provider, info, picks, setPicks } = useAiPrefs();
  const c = info(provider);
  if (!p || !c) return isError ? <span role="alert" className={cn("text-xs text-error", className)}>Không đọc được model/effort</span> : null;
  const [m, e, what] = KINDS[kind];
  const k = picks();
  return (
    <span role="group" aria-label={`${c.name}: model và effort cho ${what}`} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {!compact && <span className="text-xs font-medium text-ink-3">{c.name}</span>}
      <Picks c={c} label={what} model={k[m]} effort={k[e]} onModel={(v) => setPicks(provider, { [m]: v })} onEffort={(v) => setPicks(provider, { [e]: v })}
        modelClass={compact ? "w-28" : "w-32"} effortClass={compact ? "w-20" : "w-28"} inherit={INHERITS[kind]} variant={variant} />
      {save.isError && <span role="alert" className="text-xs text-error">Không lưu được, thử lại</span>}
    </span>
  );
}

// Each run kind on one row: what it is on the left, model and effort on the right in aligned columns.
const PICK_ROW = "grid items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_25rem]";
const PICK_COLS = "grid grid-cols-[8.25rem_minmax(0,1fr)] items-center gap-2";

/** One CLI's model + effort for each kind of run of one module (kept per CLI), and Claude's step-down near the quota.
 *  `scope`: which module's runs it opens on; a Telegram / YouTrack switch moves between them unless `fixed`.
 *  `plain`: rows only, for a host card (Settings). */
export function PrefsSection({ provider, plain = false, scope: initial = "telegram", fixed = false }: {
  provider: Provider; plain?: boolean; scope?: AiScope; fixed?: boolean;
}) {
  const { p, save, set, provider: picked, info, picks, setPicks } = useAiPrefs();
  const [scope, setScope] = useState<AiScope>(initial);
  const c = info(provider);
  if (!p || !c) return null;
  const k = picks(provider);
  const pad = plain ? "py-3 first:pt-1" : "px-4 py-3";
  const tabs = !fixed && (
    <Segmented id={`ai-scope-${plain ? "plain" : "page"}`} label="Model và effort cho module" value={scope} onChange={setScope}
      items={[{ value: "telegram", label: "Telegram", title: "Tóm tắt, soạn nháp, Briefing, Digest, Task, AI Agent" },
        { value: "youtrack", label: "YouTrack", title: "AI YouTrack: hỏi, báo cáo, soạn ticket, đọc code" }]} />
  );
  return (
    <section className="grid gap-2.5">
      {!plain ? (
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex items-center gap-3">
            <h3 className={sectionHead}>Model và effort</h3>
            {tabs}
          </span>
          <span className="text-xs text-ink-3">Áp dụng từ lần chạy kế tiếp</span>
        </span>
      ) : tabs && <span className="flex">{tabs}</span>}
      <ul key={scope} className={cn("grid divide-y divide-rule animate-in fade-in-0 duration-(--dur-short)", !plain && "rounded-lg bg-cotton shadow-stock")}>
        <li aria-hidden className={cn(PICK_ROW, "hidden py-2 text-[0.6875rem] text-ink-3 sm:grid", !plain && "px-4")}>
          <span>Dùng cho</span>
          <span className={PICK_COLS}><span>Model</span>{c.efforts.length > 0 && <span>Effort</span>}</span>
        </li>
        {SCOPES[scope].map((kind) => { const [m, e, title, hint] = KINDS[kind]; return (
          <li key={m} className={cn(PICK_ROW, pad)}>
            <span className="grid min-w-0 gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-ink">
                {title}
                {provider === picked && <TestRun kind={kind} />}
              </span>
              <span className="text-xs text-ink-3">{hint}</span>
            </span>
            <span className={PICK_COLS}>
              <Picks c={c} label={title} model={k[m]} effort={k[e]} onModel={(v) => setPicks(provider, { [m]: v })} onEffort={(v) => setPicks(provider, { [e]: v })}
                bare inherit={INHERITS[kind]} />
            </span>
          </li>
        ); })}
        {c.quota && <li className={cn(PICK_ROW, pad)}>
          <label className={cn("flex items-start gap-3", !p.fallback && "sm:col-span-2")}>
            <Checkbox className="mt-0.5" checked={p.fallback} onCheckedChange={(v) => set({ fallback: !!v })} />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium text-ink">Tự hạ model khi gần hết hạn mức</span>
              <span className="text-xs text-ink-3">Chạm ngưỡng (mọi module): việc nhẹ chạy Haiku; Task, AI Agent, AI YouTrack đọc code chạy Sonnet.</span>
            </span>
          </label>
          {p.fallback && (
            <span className={cn(PICK_COLS, "text-xs text-ink-3 animate-in fade-in-0 duration-(--dur-short)")}>
              <Dropdown label="Ngưỡng tự hạ model" value={String(p.fallback_at)} onChange={(v) => set({ fallback_at: Number(v) })} options={THRESHOLDS} />
              <span>ngưỡng hạn mức</span>
            </span>
          )}
        </li>}
      </ul>
      <p className="text-xs text-ink-3">
        {c.efforts.length ? "Model mạnh hơn, effort cao hơn: chậm hơn và tốn hạn mức hơn." : `${c.name} CLI không có tùy chọn effort.`} Mỗi AI giữ lựa chọn riêng.
      </p>
      {save.isError && <p role="alert" className="text-xs text-error">Không lưu được lựa chọn. Thử lại.</p>}
    </section>
  );
}

const THUMB = 20; // px, the drawn thumb (.effort --t)

/** How an effort pick shows: "full" = slider + the level's name (settings, the AI page); "short" = the name only, a click
 *  lists the levels (inside prompt boxes, where room is tight). */
export type EffortVariant = "full" | "short";

/** Stepped slider in the accent: drag it freely, it glides to the nearest step on release (only then saved); arrows step it.
 *  Drawn by `.effort` (globals.css); a native range underneath keeps the keyboard and a11y. `short`: the level chip alone. */
function EffortSlider({ label, steps, value, onChange, className, inherit, bare, variant = "full" }: {
  label: string; steps: Effort[]; value: Effort; onChange: (v: Effort) => void; className?: string; inherit?: string; bare?: boolean;
  variant?: EffortVariant;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // free position (0…last) while the pointer holds it
  const i = Math.max(0, steps.indexOf(value)); // a step this CLI doesn't take reads as its default
  const last = Math.max(1, steps.length - 1);
  const pos = drag ?? i;
  const near = Math.round(pos);
  const name = (v: Effort) => (v === "" && inherit ? inherit : EFFORT_LABELS[v]);
  const at = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left - THUMB / 2) / (r.width - THUMB))) * last;
  };
  const drop = () => {
    if (drag == null) return;
    setDrag(null);
    if (steps[Math.round(drag)] !== value) onChange(steps[Math.round(drag)]);
  };
  // The level's name, deepening with it like the fill; a click lists every level to pick one without sliding.
  const chip = (
    <Dropdown label={`${label}: chọn mức`} value={steps[near]} onChange={(v) => onChange(v as Effort)}
      options={steps.map((v) => ({ value: v, label: name(v) }))}
      trigger={cn("flex h-7 shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-full pr-1.5 pl-2 text-xs font-medium whitespace-nowrap transition-[background-color,box-shadow] duration-(--dur-short) hover:shadow-groove data-popup-open:shadow-groove",
        variant === "short" ? "min-w-[4.5rem]" : "w-[6.5rem]", steps[near] !== "" ? "text-hl-2" : "bg-paper-3 text-ink-2")}
      style={steps[near] !== "" ? { background: `color-mix(in oklch, var(--color-hl) ${Math.round((near / last) * 30)}%, var(--color-hl-wash))` } : undefined} />
  );
  if (variant === "short") return chip;
  return (
    <span className="flex min-w-0 items-center gap-2.5 text-xs text-ink-3">
      {!bare && <span aria-hidden>Effort</span>}
      <span className={cn("effort", className)} data-drag={drag != null || undefined} style={{ "--pct": pos / last } as React.CSSProperties}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          input.current?.focus({ preventScroll: true });
          setDrag(at(e));
        }}
        onPointerMove={(e) => drag != null && setDrag(at(e))} onPointerUp={drop} onPointerCancel={() => setDrag(null)}>
        {/* Dots on the inner steps only: the track's ends already mark the first and last. */}
        {steps.map((v, k) => k > 0 && k < last && <span key={v} aria-hidden className="effort-tick" data-on={k <= pos || undefined} style={{ "--k": k / last } as React.CSSProperties} />)}
        <span aria-hidden className="effort-thumb" />
        <input ref={input} type="range" min={0} max={steps.length - 1} step={1} value={i} aria-label={label} aria-valuetext={name(steps[i])}
          onChange={(ev) => onChange(steps[Number(ev.target.value)])} />
      </span>
      {chip}
    </span>
  );
}

/** One tiny run on the AI in use and the group's model: does it answer, how fast. It lands in the run log too. */
function TestRun({ kind }: { kind: RunKind }) {
  const qc = useQueryClient();
  const t = useMutation({
    mutationFn: () => api<{ text: string; ms: number }>("/ai/test", { method: "POST", json: { task: kind === "task" || kind === "yt_task", brief: kind === "brief", yt: kind.startsWith("yt") } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["ai-runs"] }),
  });
  return (
    <span className="flex items-center gap-1.5 text-xs font-normal">
      <Hint side="bottom" text="Chạy một câu hỏi nhỏ bằng model này: có trả lời không, nhanh chậm thế nào">
        <Button variant="ghost" size="xs" className="h-6 px-1.5 text-ink-3" aria-busy={t.isPending} disabled={t.isPending} onClick={() => t.mutate()}>
          <Play aria-hidden className={cn("size-3", t.isPending && "animate-pulse")} />{t.isPending ? "Đang thử…" : "Thử"}
        </Button>
      </Hint>
      <span aria-live="polite" className="animate-in fade-in-0 duration-(--dur-short)">
        {t.isError ? <span className="text-error">{errorText(t.error, {}, "Không chạy được, xem tab History.")}</span>
          : t.data && <span className="text-ok">✓ <span className="font-mono tabular-nums">{secs(t.data.ms)}</span></span>}
      </span>
    </span>
  );
}

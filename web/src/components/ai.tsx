"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Select } from "@base-ui/react/select";
import { ChartColumn, Check, ChevronDown, Copy, ExternalLink, Gauge, History, UserRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { type AiCatalogEntry, api, errorText } from "@/lib/api";
import { copyText, dayLabel, timeLabel, useNow } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { type Effort, EFFORT_LABELS, meterTone, planName, planTier, type Provider, PROVIDERS, resetIn, sectionHead, useAccounts, useAiPrefs, useClaudeAccount, useRecheck } from "@/components/ai/prefs";
import { HistoryTab, secs, UsageTab } from "@/components/ai/usage";

// The AI CLIs (Claude, Codex, Antigravity) in one place: which one runs every AI feature, what each offers (the backend's
// catalog), each CLI's own model/effort, every CLI's login in one shape, the top-bar pill, the account page.
// Shared hooks live in ai/prefs.ts, the Usage / History tabs in ai/usage.tsx.

export { type AccountView, type Provider, useAccounts, useAiPrefs } from "@/components/ai/prefs";

/** Top-bar pill for the AI in use: its quota windows (Antigravity: the model group picked), else its name and login state; opens its account page. */
export function AiQuota() {
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
      {open && <AiDialog provider={provider} open={open} onOpenChange={setOpen} />}
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
        return (
          <div key={id} className="grid gap-1">
            <span className="text-xs font-medium text-ink-2">{info(id)?.name ?? id} CLI{id === provider && <span className="ml-2 font-normal text-ok">đang dùng</span>}</span>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {a.checking ? <span className="text-ink-3">Đang kiểm tra…</span>
                  : !a.installed ? <span className="text-warn">Chưa cài</span>
                  : a.loggedIn ? <><span className="text-ok">{a.email ?? "Đã đăng nhập"}</span>{a.plan && <span className="text-ink-3">, {a.plan}</span>}</>
                  : a.pending ? <span className="text-ink-3">Đang chờ đăng nhập…</span>
                  : <span className="text-warn">Chưa đăng nhập</span>}
              </span>
              {!a.checking && (a.installed
                ? <Button variant="outline" onClick={() => setOpen(id)}>{a.loggedIn ? "Chi tiết" : "Đăng nhập"}</Button>
                : <Button variant="outline" onClick={recheck}>Đã cài, kiểm tra lại</Button>)}
            </div>
            {!a.checking && !a.installed && a.install && <InstallCmd cmd={a.install} />}
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
function AiDialog({ provider, open, onOpenChange }: { provider: Provider; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { provider: picked, info } = useAiPrefs();
  const [tab, setTab] = useState<Tab>("account");
  const [days, setDays] = useState<number>(7); // shared by Usage and History
  const name = info(provider)?.name ?? "AI";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A detail page sliding in from the right; head and foot stay put, only the body scrolls. */}
      <DialogContent className="top-0 right-0 left-auto flex h-dvh max-h-none max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none bg-paper p-0 ease-(--ease-out) sm:max-w-2xl data-open:zoom-in-100 data-open:slide-in-from-right data-closed:zoom-out-100 data-closed:slide-out-to-right">
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
              <PrefsSection provider={provider} />
              {provider === "claude" && <ClaudeDetails />}
            </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Avatar, who is signed in, then the plan badges. */
function Identity({ name, email, children }: { name?: string | null; email?: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
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
    </div>
  );
}

const card = "grid gap-4 rounded-lg bg-cotton p-4 shadow-stock";
const badge = "rounded-full bg-hl-wash px-2 py-0.5 font-medium text-hl-2";

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
  if (acc.isError) return <p role="alert" className="text-sm text-error">Không chạy được lệnh <code>claude</code> trên máy này.</p>;
  if (!a) return <div role="status" aria-label="Đang kiểm tra…" className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-32" /></div>;
  const url = a.login_url ?? login.data?.url;
  const tier = planTier(a);
  return (
    <div className="grid gap-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
      <section aria-label="Tài khoản" className={card}>
        {a.loggedIn ? (
          <Identity name={a.name} email={a.email}>
            <span className={badge}>{planName(a)}</span>
            {tier && <span className="rounded-full bg-paper-3 px-2 py-0.5 font-medium text-ink">Hạn mức Max <span className="font-mono">{tier}</span></span>}
            {a.subscription_status && (
              <span className={cn("px-1", a.subscription_status === "active" ? "text-ok" : "text-ink-2")}>
                {a.subscription_status === "active" ? "Đang hoạt động" : a.subscription_status}
              </span>
            )}
          </Identity>
        ) : (
          <div className="grid gap-1">
            <p className="font-semibold text-ink">Chưa đăng nhập</p>
            <p className="text-xs text-ink-2">Đăng nhập để dùng Claude cho tóm tắt, soạn nháp, Digest, YouTrack và AI Agent.</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-rule pt-3">
          <Button variant={a.loggedIn ? "outline" : "default"} size="sm" aria-busy={login.isPending} disabled={login.isPending || a.login_pending} onClick={() => login.mutate()}>
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
        {paste.isError && <p role="alert" className="text-xs text-error">Mã không hợp lệ hoặc đã hết hạn. Bấm đăng nhập lại.</p>}
        {(login.isError || logout.isError) && <p role="alert" className="text-xs text-error">Không chạy được lệnh claude. Thử lại sau.</p>}
      </section>
    </div>
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
  if (a.checking) return <div role="status" aria-label="Đang kiểm tra…"><Skeleton className="h-24" /></div>;
  return (
    <div className="grid gap-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
    <section aria-label="Tài khoản" className={card}>
      {a.loggedIn ? (
        <Identity email={a.email}>{a.plan && <span className={badge}>{a.plan}</span>}</Identity>
      ) : (
        <div className="grid gap-1">
          <p className="font-semibold text-ink">{a.installed ? "Chưa đăng nhập" : `Chưa cài ${name} CLI`}</p>
          <p className="text-xs text-ink-2">{a.installed ? `Đăng nhập để dùng ${name} cho tóm tắt, soạn nháp, Digest, YouTrack và AI Agent.` : "Cài bằng lệnh dưới trong Terminal, rồi kiểm tra lại."}</p>
        </div>
      )}
      {!a.installed && <InstallCmd cmd={a.install} />}
      <div className="flex flex-wrap gap-2 border-t border-rule pt-3">
        {!a.installed ? <Button variant="outline" size="sm" onClick={recheck}>Đã cài, kiểm tra lại</Button>
          : !a.loggedIn ? (
            <Button size="sm" aria-busy={login.isPending} disabled={login.isPending || a.pending} onClick={() => login.mutate()}>
              {a.pending ? "Đang chờ trình duyệt…" : `Đăng nhập ${name}`}
            </Button>
          ) : provider === "codex" && (
            <Button variant="ghost" size="sm" className="hover:bg-error-wash hover:text-error" disabled={logout.isPending} onClick={() => logout.mutate()}>Đăng xuất</Button>
          )}
      </div>
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
    </section>
    </div>
  );
}

/** The organisation side of the Claude account, from Anthropic's account API. */
function ClaudeDetails() {
  const { data: a } = useClaudeAccount();
  const rows = (a?.loggedIn ? [
    ["Tổ chức", a.orgName],
    ["Loại tổ chức", a.org_type?.replace(/^claude_/, "")],
    ["Dùng thêm ngoài hạn mức", a.extra_usage == null ? null : a.extra_usage ? "Bật" : "Tắt"],
    ["Đăng nhập qua", a.authMethod],
    ["Tạo tài khoản", a.created_at && dayLabel(a.created_at)],
  ] : []).filter((r): r is [string, string] => !!r[1]);
  if (!rows.length) return null;
  return (
    <section className="grid gap-2.5">
      <h3 className={sectionHead}>Chi tiết tài khoản</h3>
      <dl className="grid divide-y divide-rule rounded-lg bg-cotton px-4 text-sm shadow-stock">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-ink-2">{k}</dt>
            <dd className="min-w-0 truncate text-right text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const THRESHOLDS = [70, 80, 90, 95].map((n) => ({ value: String(n), label: `${n}%` }));

/** One CLI's model dropdown and effort slider, both from its catalog entry (no efforts: the CLI takes none, no slider). */
export function Picks({ c, label, model, effort, onModel, onEffort, modelClass, effortClass }: {
  c: AiCatalogEntry; label: string; model: string; effort: Effort;
  onModel: (v: string) => void; onEffort: (v: Effort) => void; modelClass?: string; effortClass?: string;
}) {
  // A saved id the CLI no longer lists still shows, so the dropdown never looks empty.
  const models = c.models.some((o) => o.value === model) ? c.models : [...c.models, { value: model, label: model, hint: "Không còn trong danh sách của CLI" }];
  return (
    <>
      <span className={modelClass}><Dropdown label={`Model ${c.name} cho ${label}`} value={model} onChange={onModel} options={models} /></span>
      {c.efforts.length > 0 && <EffortSlider label={`Effort ${c.name} cho ${label}`} steps={c.efforts} value={effort} onChange={onEffort} className={effortClass} />}
    </>
  );
}

/** Model + effort of the AI in use, inline (reply panel, AI Agent); the same saved picks as its AI page. */
export function ModelEffortPicker({ task = false, compact = false, className }: { task?: boolean; compact?: boolean; className?: string }) {
  const { p, isError, save, provider, info, picks, setPicks } = useAiPrefs();
  const c = info(provider);
  if (!p || !c) return isError ? <span role="alert" className={cn("text-xs text-error", className)}>Không đọc được model/effort</span> : null;
  const [m, e, what] = task ? (["task_model", "task_effort", "Task và AI Agent"] as const) : (["model", "effort", "tóm tắt và soạn nháp"] as const);
  const k = picks();
  return (
    <span role="group" aria-label={`${c.name}: model và effort cho ${what}`} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {!compact && <span className="text-xs font-medium text-ink-3">{c.name}</span>}
      <Picks c={c} label={what} model={k[m]} effort={k[e]} onModel={(v) => setPicks(provider, { [m]: v })} onEffort={(v) => setPicks(provider, { [e]: v })}
        modelClass={compact ? "w-24" : "w-32"} effortClass={compact ? "w-20" : "w-28"} />
      {save.isError && <span role="alert" className="text-xs text-error">Không lưu được, thử lại</span>}
    </span>
  );
}

/** One CLI's model + effort for each kind of run (kept per CLI), and Claude's step-down near the quota. */
function PrefsSection({ provider }: { provider: Provider }) {
  const { p, save, set, provider: picked, info, picks, setPicks } = useAiPrefs();
  const c = info(provider);
  if (!p || !c) return null;
  const k = picks(provider);
  const groups = [
    ["Tóm tắt, soạn nháp, Digest", "Chạy thường xuyên, nên chọn model nhanh.", "model", "effort"],
    ["Task và AI Agent", "Đọc code, lập kế hoạch, và AI YouTrack đọc trên 10 ticket: cần model mạnh hơn.", "task_model", "task_effort"],
  ] as const;
  return (
    <section className="grid gap-2.5">
      <h3 className={sectionHead}>Model và effort</h3>
      <ul className="grid divide-y divide-rule rounded-lg bg-cotton shadow-stock">
        {groups.map(([title, hint, m, e]) => (
          <li key={m} className="grid gap-3 p-4">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium text-ink">{title}</span>
              <span className="text-xs text-ink-2">{hint}</span>
            </span>
            <span className="grid items-center gap-2 sm:grid-cols-2">
              <Picks c={c} label={title} model={k[m]} effort={k[e]} onModel={(v) => setPicks(provider, { [m]: v })} onEffort={(v) => setPicks(provider, { [e]: v })} effortClass="flex-1" />
            </span>
            {provider === picked && <TestRun task={m === "task_model"} />}
          </li>
        ))}
        {c.quota && <li className="grid gap-3 p-4">
          <label className="flex items-start gap-3">
            <Checkbox className="mt-0.5" checked={p.fallback} onCheckedChange={(v) => set({ fallback: !!v })} />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium text-ink">Tự hạ model khi gần hết hạn mức</span>
              <span className="text-xs text-ink-2">Khi một cửa sổ hạn mức chạm ngưỡng: tóm tắt, soạn nháp, Digest chạy Haiku; Task và AI Agent chạy Sonnet.</span>
            </span>
          </label>
          {p.fallback && (
            <span className="flex items-center gap-2 pl-7 text-xs text-ink-3">
              Ngưỡng
              <span className="w-24">
                <Dropdown label="Ngưỡng tự hạ model" value={String(p.fallback_at)} onChange={(v) => set({ fallback_at: Number(v) })} options={THRESHOLDS} />
              </span>
            </span>
          )}
        </li>}
      </ul>
      <p className="text-xs text-ink-2">
        {c.efforts.length ? "Model mạnh hơn và effort cao hơn thì chậm hơn, tốn hạn mức hơn." : `${c.name} CLI không có tùy chọn effort.`} Mỗi AI giữ lựa chọn riêng; áp dụng từ lần chạy kế tiếp.
      </p>
      {save.isError && <p role="alert" className="text-xs text-error">Không lưu được lựa chọn. Thử lại.</p>}
    </section>
  );
}

/** Stepped slider in the accent colour over the CLI's own steps: a native range for input and a11y, drawn by `.effort` (globals.css). */
function EffortSlider({ label, steps, value, onChange, className }: {
  label: string; steps: Effort[]; value: Effort; onChange: (v: Effort) => void; className?: string;
}) {
  const i = Math.max(0, steps.indexOf(value)); // a step this CLI doesn't take reads as its default
  const last = Math.max(1, steps.length - 1);
  return (
    <label className="flex min-w-0 items-center gap-2.5 text-xs text-ink-3">
      Effort
      <span className={cn("effort", className)} style={{ "--pct": i / last } as React.CSSProperties}>
        {steps.map((v, k) => <span key={v} aria-hidden className="effort-tick" data-on={k <= i || undefined} style={{ "--k": k / last } as React.CSSProperties} />)}
        <span aria-hidden className="effort-thumb" />
        <input type="range" min={0} max={steps.length - 1} step={1} value={i} aria-label={label} aria-valuetext={EFFORT_LABELS[steps[i]]}
          onChange={(ev) => onChange(steps[Number(ev.target.value)])} />
      </span>
      <span className="w-16 shrink-0 font-medium text-ink">{EFFORT_LABELS[steps[i]]}</span>
    </label>
  );
}

const DEFAULT = "\u0000default"; // Select reads "" as nothing chosen; "" (the CLI default) is a real choice here

/** Compact select: the popup scales in from the trigger, the chosen item carries a check. */
function Dropdown({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
}) {
  const enc = (v: string) => (v === "" ? DEFAULT : v);
  const items = options.map((o) => ({ ...o, value: enc(o.value) }));
  return (
    <Select.Root items={items} value={enc(value)} onValueChange={(v) => v != null && onChange(v === DEFAULT ? "" : v)}>
      <Select.Trigger aria-label={label}
        className="group flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-[var(--radius-input)] border border-rule-2 bg-cotton pr-2 pl-2.5 text-xs font-medium text-ink transition-[background-color,border-color] duration-(--dur-micro) hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus) data-popup-open:border-hl">
        <Select.Value className="truncate" placeholder="Chọn" />
        <Select.Icon><ChevronDown aria-hidden className="size-3.5 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) group-data-popup-open:rotate-180" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-50 outline-none">
          <Select.Popup className="max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {items.map((o) => (
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

/** One tiny run on the AI in use and the group's model: does it answer, how fast. It lands in the run log too. */
function TestRun({ task }: { task: boolean }) {
  const qc = useQueryClient();
  const t = useMutation({
    mutationFn: () => api<{ text: string; ms: number }>("/ai/test", { method: "POST", json: { task } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["ai-runs"] }),
  });
  return (
    <span className="flex items-center gap-2 text-xs">
      <Button variant="outline" size="sm" aria-busy={t.isPending} disabled={t.isPending} onClick={() => t.mutate()}>{t.isPending ? "Đang thử…" : "Thử model"}</Button>
      <span aria-live="polite">
        {t.isError ? <span className="text-error">{errorText(t.error, {}, "Không chạy được, xem tab History.")}</span>
          : t.data && <span className="text-ok">Trả lời sau <span className="font-mono tabular-nums">{secs(t.data.ms)}</span></span>}
      </span>
    </span>
  );
}

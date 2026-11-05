"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Select } from "@base-ui/react/select";
import { ChartColumn, Check, ChevronDown, CircleAlert, Copy, Download, ExternalLink, Gauge, History, RefreshCw, Search, UserRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type AiAccount, type AiCatalogEntry, type AiPicks, type AiPrefs, type AiRun, api, type ClaudeAccount, errorText } from "@/lib/api";
import { byUnit, clockLabel, dayLabel, timeLabel, useNow } from "@/lib/inbox";
import { cn, downloadCsv } from "@/lib/utils";
import { copyText } from "@/lib/yt";
import { Pill, Segmented } from "@/components/ui/segmented";

// The AI CLIs (Claude, Codex, Antigravity) in one place: which one runs every AI feature, what each offers (the backend's
// catalog), each CLI's own model/effort, every CLI's login in one shape, the top-bar pill, the account page, the run log.

export type Provider = AiPrefs["provider"];
type Effort = AiPicks["effort"];
const PROVIDERS: Provider[] = ["claude", "codex", "antigravity"];
const NO_PICKS: AiPicks = { model: "", effort: "", task_model: "", task_effort: "" };
const EFFORT_LABELS: Record<Effort, string> = { "": "Mặc định", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

/** Which CLI runs every AI feature, what each CLI offers, and each CLI's own picks (kept when switching): every AI surface reads this. */
export function useAiPrefs() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["ai-prefs"], queryFn: ({ signal }) => api<AiPrefs>("/ai/prefs", { signal }) });
  const catalog = useQuery({ queryKey: ["ai-catalog"], queryFn: ({ signal }) => api<AiCatalogEntry[]>("/ai/catalog", { signal }), staleTime: 5 * 60_000 });
  const save = useMutation({
    scope: { id: "ai-prefs" }, // one PUT at a time: a dragged slider must not land its steps out of order
    mutationFn: (next: AiPrefs) => api<AiPrefs>("/ai/prefs", { method: "PUT", json: next }),
    onMutate: (next) => qc.setQueryData(["ai-prefs"], next),
    onError: () => void qc.invalidateQueries({ queryKey: ["ai-prefs"] }),
  });
  const p = prefs.data;
  const provider = p?.provider ?? "claude";
  const info = (id: Provider) => catalog.data?.find((c) => c.id === id);
  return {
    p, provider, save, isError: prefs.isError || catalog.isError,
    info, name: info(provider)?.name ?? "AI",
    picks: (id: Provider = provider) => p?.by[id] ?? NO_PICKS,
    set: (patch: Partial<AiPrefs>) => p && save.mutate({ ...p, ...patch }),
    setPicks: (id: Provider, patch: Partial<AiPicks>) => p && save.mutate({ ...p, by: { ...p.by, [id]: { ...(p.by[id] ?? NO_PICKS), ...patch } } }),
  };
}

const PLANS: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };
const OTHER_PLANS: Record<string, string> = { plus: "Plus", pro: "Pro", team: "Team", business: "Business", enterprise: "Enterprise", free: "Free" };

const planName = (a: ClaudeAccount) => PLANS[a.subscriptionType ?? ""] ?? a.subscriptionType ?? a.authMethod ?? "—";
const planTier = (a: ClaudeAccount) => /max_(\d+x)/.exec(a.rate_tier ?? "")?.[1];

function planLabel(a: ClaudeAccount) {
  const tier = planTier(a);
  return tier ? `${planName(a)}, hạn mức Max ${tier}` : planName(a);
}

// The backend's short window labels (kept short for the top-bar pill), spelled out for the account page.
/** "5h" / "1w", optionally "· <models>" ("1w · Opus", "5h · Gemini"), as a row title. */
const windowName = (label: string) => label.replace(/^5h/, "Phiên 5 giờ").replace(/^1w/, "7 ngày").replace(" · ", ", ");

const sectionHead = "text-[0.8125rem] font-semibold text-ink";

/** One shared query; each viewer sets its own poll (react-query runs the shortest). Paused in hidden tabs. */
function useClaudeAccount(every: number | false = false) {
  return useQuery({
    queryKey: ["claude-account"],
    queryFn: ({ signal }) => api<ClaudeAccount>("/claude/account", { signal }),
    refetchInterval: (q) => (q.state.data?.login_pending ? 2000 : every), // 2s until the browser finishes
  });
}

/** Codex and Antigravity logins: checked every `every` ms, every 2s while a started login waits for the browser. */
function useOtherAccounts(every: number | false = false) {
  return useQuery({
    queryKey: ["ai-accounts"],
    queryFn: ({ signal }) => api<AiAccount[]>("/ai/accounts", { signal }),
    refetchInterval: (q) => (q.state.data?.some((a) => a.login_pending) ? 2000 : every),
  });
}

/** One CLI's login in one shape, whichever CLI it is. */
export type AccountView = {
  checking: boolean; installed: boolean; loggedIn: boolean; email?: string | null; plan?: string | null;
  pending: boolean; url?: string | null; install: string; usage: ClaudeAccount["usage"]; usage_at?: string | null;
};

/** Every CLI's login, keyed by CLI. */
export function useAccounts(every: number | false = false): Record<Provider, AccountView> {
  const c = useClaudeAccount(every);
  const o = useOtherAccounts(every);
  const { info } = useAiPrefs();
  const other = (id: Provider): AccountView => {
    const a = o.data?.find((x) => x.provider === id);
    return {
      checking: !a && !o.isError, installed: !!a?.installed, loggedIn: !!a?.loggedIn, email: a?.email,
      plan: a && (OTHER_PLANS[a.plan ?? ""] ?? a.plan ?? a.method), pending: !!a?.login_pending, url: a?.login_url, install: a?.install ?? info(id)?.install ?? "",
      usage: a?.usage ?? [], usage_at: a?.usage_at,
    };
  };
  return {
    claude: {
      checking: !c.data && !c.isError, installed: !c.isError, loggedIn: !!c.data?.loggedIn, email: c.data?.email,
      plan: c.data && planLabel(c.data), pending: !!c.data?.login_pending, url: c.data?.login_url, install: info("claude")?.install ?? "",
      usage: c.data?.usage ?? [], usage_at: c.data?.usage_at,
    },
    codex: other("codex"),
    antigravity: other("antigravity"),
  };
}

/** Read every login (and Codex's model list) again, e.g. after installing a CLI. */
function useRecheck() {
  const qc = useQueryClient();
  return () => { for (const k of ["claude-account", "ai-accounts", "ai-catalog"]) void qc.invalidateQueries({ queryKey: [k] }); };
}

const meterTone = (pct: number) => (pct >= 90 ? "bg-error" : pct >= 70 ? "bg-warn" : "bg-hl");

/** Time until a window resets, in its largest whole unit ("3 giờ"). */
const resetIn = (iso: string, now: number) => byUnit(Math.ceil(Math.max(0, (Date.parse(iso) - now) / 60_000))).join(" ");

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
    : usage.map((u) => `${u.label}: ${Math.round(u.percent)}%${u.resets_at ? `, đặt lại sau ${resetIn(u.resets_at, now)} (${timeLabel(u.resets_at, true)})` : ""}`).join("\n")
      || `${name}: ${acc.email ?? "đã đăng nhập"}`;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={summary} aria-label={`AI đang dùng: ${name}. ${summary}`}
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
              {u.resets_at && <span>· {resetIn(u.resets_at, now)}</span>}
            </span>
          ))
        ) : (
          <span className={cn("hidden whitespace-nowrap font-medium sm:inline", bad && "text-warn")}>{bad ? summary : name}</span>
        )}
      </button>
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
            <span className="text-xs font-medium text-ink-2">{info(id)?.name ?? id} CLI{id === provider && <span className="font-normal text-ok"> · đang dùng</span>}</span>
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
      <Button size="icon-xs" variant="ghost" aria-label="Copy lệnh cài" title="Copy lệnh cài" onClick={() => void copyText(cmd, "Đã copy lệnh cài")}>
        <Copy />
      </Button>
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

/** Where a window ends up at this pace: % at reset, or how soon it runs out first. Null too early in the window to tell. */
function forecast(label: string, pct: number, resetsAt: string, now: number) {
  if (pct >= 100) return { text: "Đã hết, chờ đặt lại", warn: true };
  const len = label.startsWith("5h") ? 5 * 3_600_000 : 7 * 86_400_000;
  const left = Date.parse(resetsAt) - now;
  const elapsed = len - left;
  if (pct <= 0 || left <= 0 || elapsed < len * 0.05) return null;
  const atReset = pct + (pct / elapsed) * left;
  if (atReset < 100) return { text: `Theo tốc độ này: khoảng ${Math.round(atReset)}% lúc đặt lại`, warn: atReset >= 85 };
  const mins = Math.ceil(((100 - pct) / pct) * elapsed / 60_000);
  return { text: `Theo tốc độ này sẽ hết sau ${byUnit(mins).join(" ")}, trước khi đặt lại`, warn: true };
}

/** One row per window: how much is used, how much is left, when it resets, where this pace lands. `provider`: whose plan (Claude's carries the model fallback). */
function QuotaSection({ usage, at, provider = "claude" }: { usage: ClaudeAccount["usage"]; at?: string | null; provider?: Provider }) {
  const now = useNow();
  const qc = useQueryClient();
  const { p } = useAiPrefs();
  const refresh = useMutation({
    mutationFn: () => provider === "claude"
      ? api<ClaudeAccount>("/claude/refresh", { method: "POST" }).then((a) => qc.setQueryData(["claude-account"], a))
      : api<AiAccount[]>("/ai/accounts?fresh=true").then((a) => qc.setQueryData(["ai-accounts"], a)),
  });
  const peak = Math.max(0, ...usage.map((u) => u.percent));
  return (
    <section className="grid gap-2.5">
      <span className="flex items-center justify-between gap-3">
        <h3 className={sectionHead}>Hạn mức</h3>
        <span className="flex items-center gap-1 text-xs text-ink-3">
          {at && <span title={timeLabel(at, true)}>Cập nhật {timeLabel(at).split(",")[0]}</span>}
          <Button variant="ghost" size="sm" aria-label="Đọc lại hạn mức" title="Đọc lại hạn mức ngay" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw aria-hidden className={cn("size-3.5", refresh.isPending && "animate-spin")} />
          </Button>
        </span>
      </span>
      {provider === "claude" && p?.provider === "claude" && p.fallback && peak >= p.fallback_at && (
        <p role="status" className="rounded-md bg-warn/10 px-3 py-2 text-xs text-ink">
          Đã chạm ngưỡng {p.fallback_at}%: tóm tắt/nháp đang chạy Haiku, Task và AI Agent chạy Sonnet.
        </p>
      )}
      <ul className="grid divide-y divide-rule rounded-lg bg-cotton shadow-stock">
        {usage.map((u) => {
          const pct = Math.round(Math.min(100, Math.max(0, u.percent)));
          const name = windowName(u.label);
          const fc = u.resets_at ? forecast(u.label, u.percent, u.resets_at, now) : null;
          return (
            <li key={u.label} className="grid gap-2 p-4">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink">{name}</span>
                <span className="text-xs text-ink-2">
                  đã dùng <span className={cn("font-mono text-lg font-semibold tabular-nums", pct >= 90 ? "text-error" : "text-ink")}>{pct}%</span>
                </span>
              </span>
              <span role="meter" aria-label={`Hạn mức ${name}`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                className="h-2 overflow-hidden rounded-full bg-rule-2/45">
                <span className={cn("block h-full origin-left rounded-full transition-transform duration-500 ease-(--ease-out)", meterTone(pct))} style={{ transform: `scaleX(${pct / 100})` }} />
              </span>
              <span className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-ink-2">
                <span>Còn <span className="font-mono font-medium text-ink tabular-nums">{100 - pct}%</span></span>
                {u.resets_at && (
                  <span title={timeLabel(u.resets_at, true)}>
                    Đặt lại sau <span className="font-medium text-ink">{resetIn(u.resets_at, now)}</span>, lúc {timeLabel(u.resets_at)}
                  </span>
                )}
              </span>
              {fc && <span className={cn("text-xs", fc.warn ? "text-error" : "text-ink-3")}>{fc.text}</span>}
            </li>
          );
        })}
      </ul>
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

const FEATURES: Record<string, string> = {
  draft: "Soạn nháp", ticket: "Ticket", summary: "Tóm tắt", digest: "Digest", youtrack: "YouTrack", agent: "AI Agent", test: "Thử model", ai: "Khác",
};
const PERIODS = [[1, "24 giờ"], [7, "7 ngày"], [30, "30 ngày"]] as const;

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} giây`;
const usd = (c: number) => `$${c.toFixed(c < 1 ? 3 : 2)}`;
const kilo = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const tokens = (r: AiRun) => r.input_tokens + r.output_tokens + r.cache_read + r.cache_write;
const vnDay = (t: number | string) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }); // 2026-11-02

type Totals = { n: number; failed: number; tokens: number; cost: number; ms: number };
function totals(rows: AiRun[]): Totals {
  return rows.reduce((t, r) => ({ n: t.n + 1, failed: t.failed + (r.ok ? 0 : 1), tokens: t.tokens + tokens(r), cost: t.cost + (r.cost ?? 0), ms: t.ms + r.ms }),
    { n: 0, failed: 0, tokens: 0, cost: 0, ms: 0 });
}
function groupBy(rows: AiRun[], key: (r: AiRun) => string) {
  const m = new Map<string, AiRun[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m].map(([k, rs]) => [k, totals(rs)] as const).sort((a, b) => b[1].cost - a[1].cost || b[1].n - a[1].n);
}

function useRuns(days: number) {
  return useQuery({
    queryKey: ["ai-runs", days],
    queryFn: ({ signal }) => api<AiRun[]>(`/ai/runs?days=${days}`, { signal }),
    refetchInterval: 60_000,
  });
}

/** Section head with the period switch (and any extra tools) on the right. */
function PeriodHead({ title, days, setDays, children }: { title: string; days: number; setDays: (d: number) => void; children?: React.ReactNode }) {
  return (
    <span className="flex flex-wrap items-center justify-between gap-2">
      <h3 className={sectionHead}>{title}</h3>
      <span className="flex items-center gap-1">
        <Segmented id={`period-${title}`} label="Khoảng thời gian" value={days} onChange={setDays}
          items={PERIODS.map(([d, label]) => ({ value: d, label }))} />
        {children}
      </span>
    </span>
  );
}

const emptyRuns = (days: number) => (
  <p className="rounded-lg bg-cotton p-4 text-sm text-ink-2 shadow-stock">
    Chưa có lần chạy nào trong {PERIODS.find(([d]) => d === days)?.[1]}. Mỗi lần tóm tắt, soạn nháp, Digest, YouTrack AI hay AI Agent chạy sẽ được ghi ở đây.
  </p>
);

/** This CLI's live quota (Claude: from its account API; others: from their CLI). */
function LiveQuota({ provider }: { provider: Provider }) {
  const a = useAccounts(60_000)[provider];
  if (a.checking) return <Skeleton className="h-32" />;
  if (!a.loggedIn || !a.usage.length) return null;
  return <QuotaSection usage={a.usage} at={a.usage_at} provider={provider} />;
}

/** Quota on top, then the report of every AI run in the period (any CLI). */
function UsageTab({ provider, days, setDays }: { provider: Provider; days: number; setDays: (d: number) => void }) {
  const runs = useRuns(days);
  const rows = runs.data ?? [];
  const sum = totals(rows);
  return (
    <>
      <LiveQuota provider={provider} />
      <section className="grid gap-2.5">
        <PeriodHead title="Báo cáo" days={days} setDays={setDays} />
        {runs.isError ? <p role="alert" className="text-sm text-error">Không đọc được lịch sử chạy.</p>
          : !runs.data ? <Skeleton className="h-40" />
          : !rows.length ? emptyRuns(days)
          : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ["Request", String(sum.n), sum.failed ? `${sum.failed} lỗi` : "không lỗi"],
                  ["Token", kilo(sum.tokens), `TB ${kilo(Math.round(sum.tokens / sum.n))}/request`],
                  ["Chi phí quy đổi", usd(sum.cost), "nếu trả theo API"],
                  ["Thời gian TB", secs(sum.ms / sum.n), `tổng ${byUnit(Math.round(sum.ms / 60_000)).join(" ")}`],
                ] as const).map(([k, v, hint]) => (
                  <div key={k} className="grid gap-0.5 rounded-lg bg-cotton p-3 shadow-stock">
                    <dt className="text-xs text-ink-2">{k}</dt>
                    <dd className="font-mono text-lg font-semibold text-ink tabular-nums">{v}</dd>
                    <dd className={cn("text-xs", k === "Request" && sum.failed ? "text-error" : "text-ink-3")}>{hint}</dd>
                  </div>
                ))}
              </dl>
              {days > 1 && <DayBars rows={rows} days={days} />}
              <div className="grid gap-2 sm:grid-cols-2">
                <Breakdown title="Theo tính năng" groups={groupBy(rows, (r) => FEATURES[r.feature] ?? r.feature)} total={sum} />
                <Breakdown title="Theo model" groups={groupBy(rows, (r) => r.model)} total={sum} />
              </div>
              <p className="text-xs text-ink-2">Chi phí quy đổi là giá token nếu trả theo API, không phải tiền bị trừ: gói Pro/Max tính theo hạn mức.</p>
            </>
          )}
      </section>
    </>
  );
}

const PAGE = 50;

/** Each request in the period, newest first: search and filter, grouped by Vietnam day, a row opens its full detail. CSV exports what the filter shows. */
function HistoryTab({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  const runs = useRuns(days);
  const [feature, setFeature] = useState<string | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const all = runs.data ?? [];
  const needle = q.trim().toLowerCase();
  const rows = all.filter((r) => (!feature || r.feature === feature) && (!failedOnly || !r.ok)
    && (!needle || [r.model, r.effort, FEATURES[r.feature] ?? r.feature, r.error ?? ""].some((v) => v.toLowerCase().includes(needle))));
  const counts = groupBy(all, (r) => r.feature);
  const failed = all.filter((r) => !r.ok).length;
  const sum = totals(rows);
  const today = vnDay(useNow());
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setLimit(PAGE); setOpen(null); };
  const exportRows = () => downloadCsv([
    ["Thời gian", "Tính năng", "Model", "Effort", "Tự hạ model", "Thành công", "Lỗi", "Thời gian chạy (ms)", "Input", "Output", "Đọc cache", "Ghi cache", "Chi phí quy đổi (USD)", "5h % sau", "7 ngày % sau"],
    ...rows.map((r) => [r.at, FEATURES[r.feature] ?? r.feature, r.model, r.effort, r.fallback ? "có" : "", r.ok ? "có" : "không", r.error ?? "", r.ms,
      r.input_tokens, r.output_tokens, r.cache_read, r.cache_write, r.cost ?? "", r.quota["5h"] ?? "", r.quota["1w"] ?? ""]),
  ], `ai-runs-${days}d.csv`);
  const chip = (on: boolean, tone = "bg-ink text-paper") => cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors duration-(--dur-micro) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus)",
    on ? tone : "bg-paper-3 text-ink-2 hover:text-ink");

  return (
    <section className="grid gap-3">
      <PeriodHead title="Lịch sử chạy" days={days} setDays={filter(setDays)}>
        <Button variant="ghost" size="sm" aria-label="Xuất CSV những dòng đang hiện" title="Xuất CSV những dòng đang hiện" disabled={!rows.length} onClick={exportRows}><Download aria-hidden className="size-3.5" /></Button>
      </PeriodHead>

      {runs.isError ? <p role="alert" className="text-sm text-error">Không đọc được lịch sử chạy.</p>
        : !runs.data ? <div role="status" aria-label="Đang tải…" className="grid gap-2"><Skeleton className="h-9" /><Skeleton className="h-60" /></div>
        : !all.length ? emptyRuns(days)
        : (
          <>
            <div className="grid gap-2">
              <label className="relative block">
                <span className="sr-only">Tìm request</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
                <Input type="search" placeholder="Tìm theo model, tính năng, lỗi…" className="pl-8" value={q} onChange={(e) => filter(setQ)(e.target.value)} />
              </label>
              <span role="group" aria-label="Lọc theo tính năng" className="flex flex-wrap gap-1.5 text-xs">
                <button type="button" aria-pressed={!feature} className={chip(!feature)} onClick={() => filter(setFeature)(null)}>
                  Tất cả <span className="font-mono tabular-nums opacity-70">{all.length}</span>
                </button>
                {counts.map(([f, t]) => (
                  <button key={f} type="button" aria-pressed={feature === f} className={chip(feature === f)} onClick={() => filter(setFeature)(feature === f ? null : f)}>
                    {FEATURES[f] ?? f} <span className="font-mono tabular-nums opacity-70">{t.n}</span>
                  </button>
                ))}
                {failed > 0 && (
                  <button type="button" aria-pressed={failedOnly} className={cn(chip(failedOnly, "bg-error text-paper"), !failedOnly && "bg-error-wash text-error")} onClick={() => filter(setFailedOnly)(!failedOnly)}>
                    <CircleAlert aria-hidden className="size-3.5" />Chỉ lỗi <span className="font-mono tabular-nums opacity-70">{failed}</span>
                  </button>
                )}
              </span>
            </div>

            <p aria-live="polite" className="text-xs text-ink-2">
              {rows.length === all.length ? `${all.length} request` : `${rows.length} / ${all.length} request khớp`}
              {rows.length > 0 && <> · <span className="font-mono tabular-nums">{kilo(sum.tokens)}</span> token · <span className="font-mono tabular-nums">{usd(sum.cost)}</span></>}
            </p>

            {!rows.length ? (
              <div className="grid justify-items-start gap-2 rounded-lg bg-cotton p-4 text-sm text-ink-2 shadow-stock">
                Không có request nào khớp bộ lọc.
                <Button variant="outline" size="sm" onClick={() => { setQ(""); setFeature(null); setFailedOnly(false); }}>Xoá bộ lọc</Button>
              </div>
            ) : (
              <div className="grid gap-4">
                {groupRows(rows.slice(0, limit)).map(([d, rs]) => {
                  const t = totals(rows.filter((r) => vnDay(r.at) === d));
                  return (
                    <section key={d} aria-label={`${weekday(d)} ${dm(d)}`} className="grid gap-1.5">
                      <h4 className="sticky -top-5 z-10 -mx-5 flex items-baseline justify-between gap-3 bg-paper/95 px-5 py-1.5 text-xs backdrop-blur-sm">
                        <span className="font-semibold text-ink first-letter:uppercase">{d === today ? "Hôm nay" : weekday(d)}, {dm(d)}</span>
                        <span className="font-mono text-ink-3 tabular-nums">{t.n} · {kilo(t.tokens)} · {usd(t.cost)}</span>
                      </h4>
                      <ul className="grid divide-y divide-rule overflow-hidden rounded-lg bg-cotton shadow-stock">
                        {rs.map((r, i) => {
                          const id = r.at + i;
                          return <RunRow key={id} r={r} open={open === id} onToggle={() => setOpen(open === id ? null : id)} />;
                        })}
                      </ul>
                    </section>
                  );
                })}
                {rows.length > limit && (
                  <Button variant="outline" size="sm" className="justify-self-center" onClick={() => setLimit(limit + PAGE)}>
                    Xem thêm {Math.min(PAGE, rows.length - limit)} request <span className="text-ink-3">(còn {rows.length - limit})</span>
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-ink-3">Chi phí quy đổi là giá token nếu trả theo API, không phải tiền bị trừ. “Nhập lại”: lấy từ transcript của Claude CLI, trước khi có log này.</p>
          </>
        )}
    </section>
  );
}

/** One request: a summary line that opens its tokens, quota after the run and the error, if any. */
function RunRow({ r, open, onToggle }: { r: AiRun; open: boolean; onToggle: () => void }) {
  const detail = ([
    ["Input", kilo(r.input_tokens)], ["Output", kilo(r.output_tokens)], ["Đọc cache", kilo(r.cache_read)], ["Ghi cache", kilo(r.cache_write)],
    ["Effort", r.effort ? EFFORT_LABELS[r.effort as Effort] ?? r.effort : null], ["Lượt", r.turns ? String(r.turns) : null],
    ["Hạn mức 5h sau", r.quota["5h"] != null ? `${Math.round(r.quota["5h"])}%` : null], ["Hạn mức 7 ngày sau", r.quota["1w"] != null ? `${Math.round(r.quota["1w"])}%` : null],
  ] as [string, string | null][]).filter((x): x is [string, string] => x[1] != null);
  return (
    <li className={cn(!r.ok && "bg-error-wash/40")}>
      <button type="button" aria-expanded={open} onClick={onToggle}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2 text-left text-xs transition-colors duration-(--dur-micro) hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-focus)">
        <span className="flex items-center gap-2">
          <span aria-label={r.ok ? "Thành công" : "Lỗi"} className={cn("size-2 rounded-full", r.ok ? "bg-ok" : "bg-error")} />
          <span className="font-mono text-ink-2 tabular-nums" title={timeLabel(r.at, true)}>{clockLabel(r.at)}</span>
        </span>
        <span className="grid min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-ink">{FEATURES[r.feature] ?? r.feature}</span>
            {r.fallback && <span className="shrink-0 rounded bg-warn/15 px-1 text-ink">hạ model</span>}
            {r.imported && <span className="shrink-0 rounded bg-paper-3 px-1 text-ink-3">nhập lại</span>}
          </span>
          <span className="truncate text-ink-3">{r.model.replace(/^claude-/, "")}{!r.ok && r.error && <span className="text-error"> · {r.error}</span>}</span>
        </span>
        <span className="grid text-right font-mono tabular-nums">
          <span className="text-ink">{kilo(tokens(r))}</span>
          <span className="text-ink-3">{r.cost == null ? "—" : usd(r.cost)}</span>
        </span>
        <span className="flex items-center gap-1.5 font-mono text-ink-2 tabular-nums">
          {(r.ms / 1000).toFixed(1)}s
          <ChevronDown aria-hidden className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out)", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-rule bg-paper-2/60 px-3 py-3 text-xs animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short)">
          {!r.ok && r.error && <p role="alert" className="rounded-md bg-error-wash px-2.5 py-2 break-words text-error">{r.error}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {detail.map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className="font-mono font-medium text-ink tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-ink-3">{timeLabel(r.at, true)} · model <span className="font-mono">{r.model}</span></p>
        </div>
      )}
    </li>
  );
}

/** Rows (newest first) into Vietnam days, keeping order. */
function groupRows(rows: AiRun[]) {
  const m = new Map<string, AiRun[]>();
  for (const r of rows) m.set(vnDay(r.at), [...(m.get(vnDay(r.at)) ?? []), r]);
  return [...m];
}

/** Requests and cost per Vietnam day across the period, oldest on the left. */
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
const weekday = (d: string) => new Date(`${d}T12:00:00+07:00`).toLocaleDateString("vi-VN", { weekday: "long", timeZone: "Asia/Ho_Chi_Minh" });

/** Requests per Vietnam day across the period, oldest on the left; hover or focus a bar for that day's full report. */
function DayBars({ rows, days }: { rows: AiRun[]; days: number }) {
  const now = useNow();
  const byDay = new Map<string, AiRun[]>();
  for (const r of rows) byDay.set(vnDay(r.at), [...(byDay.get(vnDay(r.at)) ?? []), r]);
  const list = Array.from({ length: days }, (_, i) => vnDay(now - (days - 1 - i) * 86_400_000)).map((d) => [d, byDay.get(d) ?? []] as const);
  const top = Math.max(1, ...list.map(([, rs]) => rs.length));
  const week = days <= 7; // few enough bars to label each one
  return (
    <figure className="grid gap-1.5 rounded-lg bg-cotton p-3 shadow-stock">
      <figcaption className="text-xs text-ink-2">Request mỗi ngày</figcaption>
      <div className={cn("flex items-end", week ? "h-24 gap-2" : "h-20 gap-0.5")}>
        {list.map(([d, rs], k) => {
          const t = totals(rs);
          const label = `${weekday(d)} ${dm(d)}: ${t.n ? `${t.n} request, ${kilo(t.tokens)} token, ${usd(t.cost)}` : "không chạy"}`;
          return (
            <span key={d} tabIndex={0} aria-label={label}
              className="group relative flex h-full flex-1 flex-col items-center justify-end gap-0.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus)">
              {week && t.n > 0 && <span className="font-mono text-[0.6875rem] text-ink-2 tabular-nums">{t.n}</span>}
              <span className={cn("block w-full rounded-t-sm transition-opacity duration-(--dur-micro) group-hover:opacity-80", t.failed ? "bg-warn" : "bg-hl", !t.n && "bg-rule-2/45")}
                style={{ height: t.n ? `${Math.max(4, (t.n / top) * 100)}%` : "2px" }} />
              <DayTip day={d} rows={rs} t={t} align={k < 2 ? "left-0" : k > list.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2"} />
            </span>
          );
        })}
      </div>
      {week ? (
        <span className="flex gap-2 font-mono text-[0.6875rem] text-ink-3 tabular-nums">
          {list.map(([d], k) => <span key={d} className="flex-1 text-center">{k === list.length - 1 ? "Hôm nay" : dm(d)}</span>)}
        </span>
      ) : (
        <span className="flex justify-between font-mono text-[0.6875rem] text-ink-3 tabular-nums">
          <span>{dm(list[0][0])}</span><span>Hôm nay</span>
        </span>
      )}
    </figure>
  );
}

/** The bar's popover: that day's totals, then requests per feature and per model. */
function DayTip({ day, rows, t, align }: { day: string; rows: AiRun[]; t: Totals; align: string }) {
  const line = (k: string, v: string, tone?: string) => (
    <span key={k} className="flex justify-between gap-4"><span className="text-ink-2">{k}</span><span className={cn("font-mono tabular-nums", tone ?? "text-ink")}>{v}</span></span>
  );
  return (
    <span role="tooltip"
      className={cn("pointer-events-none absolute top-full z-20 mt-2 grid w-56 gap-1.5 rounded-lg bg-cotton p-3 text-left text-xs opacity-0 shadow-pop transition-[opacity,transform] duration-(--dur-short) ease-(--ease-out) -translate-y-1 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100", align)}>
      <span className="font-semibold text-ink first-letter:uppercase">{weekday(day)}, {dm(day)}</span>
      {!t.n ? <span className="text-ink-3">Không có request</span> : (
        <>
          <span className="grid gap-0.5">
            {line("Request", String(t.n))}
            {t.failed > 0 && line("Lỗi", String(t.failed), "text-error")}
            {line("Token", kilo(t.tokens))}
            {line("Chi phí quy đổi", usd(t.cost))}
            {line("Thời gian TB", secs(t.ms / t.n))}
          </span>
          {([["Theo tính năng", (r: AiRun) => FEATURES[r.feature] ?? r.feature], ["Theo model", (r: AiRun) => r.model.replace(/^claude-/, "")]] as const).map(([title, key]) => (
            <span key={title} className="grid gap-0.5 border-t border-rule pt-1.5">
              <span className="text-ink-3">{title}</span>
              {groupBy(rows, key).map(([k, g]) => line(k, `${g.n} · ${usd(g.cost)}`))}
            </span>
          ))}
        </>
      )}
    </span>
  );
}

function Breakdown({ title, groups, total }: { title: string; groups: (readonly [string, Totals])[]; total: Totals }) {
  return (
    <div className="grid content-start gap-2 rounded-lg bg-cotton p-3 shadow-stock">
      <h4 className="text-xs text-ink-2">{title}</h4>
      <ul className="grid gap-2">
        {groups.map(([k, t]) => {
          const share = total.cost > 0 ? t.cost / total.cost : t.n / total.n;
          return (
            <li key={k} className="grid gap-1 text-xs">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-ink">{k.replace(/^claude-/, "")}</span>
                <span className="shrink-0 font-mono text-ink-2 tabular-nums">{t.n} · {kilo(t.tokens)} · {usd(t.cost)}</span>
              </span>
              <span aria-hidden className="h-1 overflow-hidden rounded-full bg-rule-2/45">
                <span className="block h-full rounded-full bg-hl" style={{ width: `${Math.round(share * 100)}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

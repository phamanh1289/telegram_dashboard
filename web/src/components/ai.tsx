"use client";

import { Popover } from "@base-ui/react/popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChartColumn, Copy, Cpu, ExternalLink, History, Play, SlidersHorizontal, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CHIP, Dropdown } from "@/components/ui/dropdown";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DIALOG_SHEET } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Pill, Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { type AiCatalogEntry, api, errorText } from "@/lib/api";
import { type Key, tMaybe, useT } from "@/lib/i18n";
import { copyText, useNow } from "@/lib/inbox";
import { saveQuotaAgent, useQuotaAgent } from "@/lib/prefs";
import { timeLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import { BASE, card, type Effort, effortLabel, KEYS, meterTone, planName, planTier, type Provider, PROVIDERS, resetIn, ringTone, type RunKind, sectionHead, useAccounts, useAiPrefs, useClaudeAccount, useRecheck, windowName } from "@/components/ai/prefs";
import { AgentIcon } from "@/components/ai/agent-icon";
import { AiBot } from "@/components/ai/chat";
import { AIS, HistoryTab, Quota, ResetTicket, secs, UsageTab } from "@/components/ai/usage";

// The AI CLIs (Claude, Codex, Antigravity) in one place: one model list over every CLI's models per kind of run (the
// pick's CLI runs it), what each offers (the backend's catalog), each CLI's own model/effort, every CLI's login in one shape, the top-bar pill, the account page.
// Shared hooks live in ai/prefs.ts, the Usage / History tabs in ai/usage.tsx.

export { type AccountView, type Provider, type RunKind, useAccounts, useAiPrefs } from "@/components/ai/prefs";

/** A quota window's share used as a ring that fills up (amber from 70% used, red from 90%), its short name and the % used. */
function QuotaRing({ label, percent }: { label: string; percent: number }) {
  const used = Math.round(Math.min(100, Math.max(0, percent)));
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <svg viewBox="0 0 20 20" aria-hidden className={cn("size-4 shrink-0 -rotate-90", ringTone(used))}>
        <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="3" className="stroke-rule-2/60" />
        {used > 0 && <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="3" stroke="currentColor" strokeLinecap="round" pathLength={100}
          strokeDasharray={`${used} 100`} className="transition-[stroke-dasharray] duration-500 ease-(--ease-out)" />}
      </svg>
      <span className="text-ink-3">{label.split(" · ")[0]}</span>
      <span className={cn("font-mono font-bold tabular-nums", used >= 90 ? "text-error" : "text-ink")}>{used}%</span>
    </span>
  );
}

/** Top-bar pill: the quota used of the AI picked to show here (Cài đặt › AI, or the switch in its popover; "Tự động" = the
 *  one the module's everyday runs use: Telegram drafts, YouTrack light runs). Antigravity: the model group that kind picks.
 *  Opens a popover with every window, the switch and the way to the account page. */
export function AiQuota({ scope = "telegram" }: { scope?: AiScope }) {
  const t = useT();
  const [pop, setPop] = useState(false);
  const [page, setPage] = useState(false);
  const { on, info, p } = useAiPrefs();
  const kind = scope === "youtrack" ? "yt" : "chat";
  const pick = useQuotaAgent();
  const auto = on(kind);
  const provider = PROVIDERS.find((id) => id === pick) ?? auto;
  const name = info(provider)?.name ?? "AI";
  const acc = useAccounts(5 * 60_000)[provider];
  const now = useNow();
  if (acc.checking) return null;
  const group = /^(claude|gpt)/.test(p?.by.antigravity?.[KEYS[kind][0]] ?? "") ? "Claude & GPT" : "Gemini";
  const usage = !acc.loggedIn ? [] : provider === "antigravity" ? acc.usage.filter((u) => u.label.endsWith(group)) : acc.usage;
  const peak = Math.max(0, ...usage.map((u) => u.percent));
  const bad = !acc.installed || !acc.loggedIn;
  const summary = !acc.installed ? t("{name} chưa cài", { name }) : !acc.loggedIn ? t("{name} chưa đăng nhập", { name })
    : usage.map((u) => `${windowName(u.label)}: ${t("đã dùng {n}%", { n: Math.round(Math.min(100, Math.max(0, u.percent))) })}${u.resets_at ? t(", đặt lại sau {span} ({time})", { span: resetIn(u.resets_at, now), time: timeLabel(u.resets_at, true) }) : ""}`).join("; ")
      || `${name}: ${acc.email ?? t("đã đăng nhập")}`;
  const openPage = () => { setPop(false); setPage(true); };
  return (
    <>
      <Popover.Root open={pop} onOpenChange={setPop}>
        <Hint side="bottom" title={t("Hạn mức AI: {name}", { name })} text={t("{summary}. Bấm để xem chi tiết hoặc đổi AI hiện ở đây.", { summary })}>
          <Popover.Trigger aria-label={`${t("Hạn mức AI: {name}", { name })}. ${summary}`}
            className="flex h-8 items-center gap-2.5 rounded-[var(--radius-input)] pr-2 pl-1.5 text-xs text-ink-3 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink data-popup-open:bg-paper-3">
            <span className="relative shrink-0">
              <AgentIcon provider={provider} className="agent-still size-5" />
              <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-paper-2", bad ? "bg-warn" : meterTone(peak), usage.length && "sm:hidden")} />
            </span>
            {usage.length ? (
              usage.slice(0, 2).map((u) => (
                <span key={u.label} className="hidden items-center gap-1.5 sm:flex">
                  <QuotaRing label={u.label} percent={u.percent} />
                  {u.resets_at && <span className="hidden whitespace-nowrap lg:inline">· {resetIn(u.resets_at, now)}</span>}
                </span>
              ))
            ) : (
              <span className={cn("hidden whitespace-nowrap font-medium sm:inline", bad ? "text-warn" : "text-ink-2")}>{bad ? summary : name}</span>
            )}
          </Popover.Trigger>
        </Hint>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="end" className="z-40 outline-none">
            <Popover.Popup aria-label={t("Hạn mức AI")}
              className="grid w-[22rem] max-w-[calc(100vw-2rem)] origin-(--transform-origin) grid-cols-1 gap-3 rounded-lg bg-cotton p-3 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
              <header className="flex items-center gap-2.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-paper-2 shadow-groove"><AgentIcon provider={provider} className="size-8" /></span>
                <span className="grid min-w-0 gap-0.5">
                  <Popover.Title className="text-sm font-bold text-ink">{name}</Popover.Title>
                  <span className={cn("truncate text-xs", bad ? "text-warn" : "text-ink-3")}>
                    {bad ? summary : [acc.email ?? t("Đã đăng nhập"), acc.plan].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </header>
              <Segmented id="quota-agent" label={t("AI hiện hạn mức trên thanh trên cùng")} variant="card" value={pick === provider ? pick : ""} onChange={saveQuotaAgent}
                items={[
                  { value: "", label: t("Tự động"), title: t("Theo AI đang chạy việc hằng ngày ở trang này ({name})", { name: info(auto)?.name ?? auto }) },
                  ...AIS.map(([id, short]) => ({ value: id as string, title: t("Luôn hiện hạn mức của {name}", { name: info(id)?.name ?? short }),
                    label: <><AgentIcon provider={id} className="agent-still size-3.5" />{short}</> })),
                ]} />
              {acc.loggedIn && <Quota provider={provider} />}
              <Button size="sm" variant="outline" onClick={openPage}>{acc.loggedIn ? t("Tài khoản, usage và lịch sử") : bad && acc.installed ? t("Đăng nhập") : t("Mở trang AI")}</Button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {page && <AiDialog scope={scope} open onOpenChange={setPage} />}
    </>
  );
}

/** Settings › AI › Tài khoản: one line per CLI; its account, model/effort and log open in its AI page. */
export function AiAccounts() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { used, info } = useAiPrefs();
  const inUse = used();
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
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper-2 shadow-groove"><AgentIcon provider={id} className="size-7" /></span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  {name} CLI
                  {inUse.includes(id) && <span className="rounded-full bg-ok-wash px-1.5 text-2xs leading-5 font-medium text-ok">{t("Đang dùng")}</span>}
                  <ResetTicket provider={id} />
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
                  <span className="min-w-0 truncate">
                    {a.checking ? <span className="text-ink-3">{t("Đang kiểm tra…")}</span>
                      : !a.installed ? <span className="text-signal-2">{t("Chưa cài")}</span>
                      : a.loggedIn ? <><span className="text-ink-2">{a.email ?? t("Đã đăng nhập")}</span>{a.plan && <span className="text-ink-3"> · {a.plan}</span>}</>
                      : a.pending ? <span className="text-ink-3">{t("Đang chờ đăng nhập…")}</span>
                      : <span className="text-signal-2">{t("Chưa đăng nhập")}</span>}
                  </span>
                </span>
              </span>
              {!a.checking && (a.installed
                ? <Button size="sm" variant={a.loggedIn ? "ghost" : "outline"} onClick={() => setOpen(true)}>{a.loggedIn ? t("Chi tiết") : t("Đăng nhập")}</Button>
                : <Button size="sm" variant="outline" onClick={recheck}>{t("Đã cài, kiểm tra lại")}</Button>)}
            </div>
            {!a.checking && !a.installed && a.install && <div className="pl-12"><InstallCmd cmd={a.install} /></div>}
          </div>
        );
      })}
      {open && <AiDialog open onOpenChange={setOpen} />}
    </>
  );
}

/** An install command with a copy button; run it in Terminal, then check again. */
export function InstallCmd({ cmd }: { cmd: string }) {
  const t = useT();
  return (
    <span className="flex items-center gap-1 rounded-md bg-paper-2 py-0.5 pr-0.5 pl-2 shadow-groove">
      <code className="min-w-0 flex-1 truncate text-xs">{cmd}</code>
      <Hint side="bottom" text={t("Copy lệnh cài, dán vào Terminal")}>
        <Button size="icon-xs" variant="ghost" aria-label={t("Copy lệnh cài")} onClick={() => void copyText(cmd, t("Đã copy lệnh cài"))}>
          <Copy />
        </Button>
      </Hint>
    </span>
  );
}

const TABS = [["overview", "Tổng quan", UserRound], ["models", "Model", SlidersHorizontal], ["usage", "Usage", ChartColumn], ["history", "History", History]] as const;
type Tab = (typeof TABS)[number][0];

/** The AI page: every CLI's login, quota and runs on one page (Tổng quan), model/effort per kind of run, the run report,
 *  and the history of every run. */
function AiDialog({ scope, open, onOpenChange }: { scope?: AiScope; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { used } = useAiPrefs();
  const inUse = used();
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState<number>(7); // shared by Usage and History
  const toModels = () => setTab("models");
  // The CLIs some run uses first, then the rest, in the usual order.
  const order = [...PROVIDERS].sort((x, y) => Number(inUse.includes(y)) - Number(inUse.includes(x)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A detail page sliding in from the right; head and foot stay put, only the body scrolls. */}
      <DialogContent className={cn(DIALOG_SHEET, "ai-in")}>
        <header className="grid gap-3 border-b border-rule bg-paper-2 px-5 pt-5">
          <span className="flex items-center gap-3 pr-8">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-hl-wash shadow-groove"><AiBot className="agent size-8" /></span>
            <span className="grid min-w-0 gap-0.5">
              <DialogTitle>{t("Tài khoản AI")}</DialogTitle>
              <DialogDescription className="text-xs text-ink-2">{t("Đăng nhập, hạn mức và việc từng AI CLI đang chạy trên máy này.")}</DialogDescription>
            </span>
          </span>
          <span role="tablist" aria-label={t("Mục")} className="flex gap-5 overflow-x-auto text-sm whitespace-nowrap [scrollbar-width:none]">
            {TABS.map(([k, label, Icon]) => (
              <button key={k} type="button" role="tab" id={`ai-tab-${k}`} aria-selected={tab === k} aria-controls="ai-tabpanel" onClick={() => setTab(k)}
                className={cn("relative flex items-center gap-1.5 pb-2.5 font-medium transition-colors duration-(--dur-micro)", tab === k ? "text-ink" : "text-ink-3 hover:text-ink")}>
                {tab === k && <Pill id="ai-tab" className="inset-x-0 bottom-0 h-0.5 rounded-full bg-hl" />}
                <Icon aria-hidden className="size-4" />
                {label === "Tổng quan" ? t(label) : label}
              </button>
            ))}
          </span>
        </header>

        <div key={tab} role="tabpanel" id="ai-tabpanel" aria-labelledby={`ai-tab-${tab}`}
          className={cn("grid min-h-0 flex-1 content-start overflow-y-auto overscroll-contain px-5 py-5 animate-in fade-in-0 duration-(--dur-short)", tab === "overview" ? "gap-3" : "gap-6")}>
          {tab === "usage" ? <UsageTab days={days} setDays={setDays} />
            : tab === "history" ? <HistoryTab days={days} setDays={setDays} />
            : tab === "models" ? <PrefsSection scope={scope} />
            : order.map((id) => (id === "claude" ? <ClaudeAccountCard key={id} onEdit={toModels} /> : <CliAccountCard key={id} provider={id} onEdit={toModels} />))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const planBadge = "rounded-full bg-hl-wash px-1.5 text-2xs leading-5 font-medium whitespace-nowrap text-hl-2";

/** One CLI as a card: its mascot, name and who is signed in (or why not), its account actions on the right; under it,
 *  a rule between each, its login steps, quota left and the runs it does. */
function AgentCard({ provider, line, tone, badges, actions, children }: {
  provider: Provider; line: React.ReactNode; tone: "ok" | "off" | "wait"; badges?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  const t = useT();
  const { used, info } = useAiPrefs();
  const name = info(provider)?.name ?? provider;
  return (
    <section aria-label={name} className={cn(card, "@container gap-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short) [&>*+*]:border-t [&>*+*]:border-rule [&>*+*]:pt-3")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-paper-2 shadow-groove"><AgentIcon provider={provider} className="size-8" /></span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink">
            {name}
            {used().includes(provider) && <span className="rounded-full bg-ok/15 px-1.5 text-2xs leading-5 font-medium whitespace-nowrap text-ok">{t("Đang dùng")}</span>}
            {badges}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-ok" : tone === "wait" ? "animate-pulse bg-ink-3" : "bg-signal")} />
            <span className="truncate">{line}</span>
          </span>
        </span>
        {actions && <span className="flex shrink-0 items-center gap-1 @max-md:basis-full @max-md:pl-13">{actions}</span>}
      </div>
      {children}
    </section>
  );
}

/** The kinds of run this CLI does, each with its model / effort; the slider button opens the Model tab. Nothing when it runs none. */
function UsedFor({ provider, onEdit }: { provider: Provider; onEdit: () => void }) {
  const t = useT();
  const { p, on, info, picks } = useAiPrefs();
  const c = info(provider);
  if (!p || !c) return null;
  const k = picks(provider);
  const kinds = (Object.keys(KINDS) as RunKind[]).filter((kind) => on(kind) === provider);
  if (!kinds.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 text-ink-3">{t("Dùng cho")}</span>
      {kinds.map((kind) => {
        const model = k[KEYS[kind][0]] || k[KEYS[BASE[kind]][0]]; // "": the base kind's pick
        const effort = k[KEYS[kind][1]] || k[KEYS[BASE[kind]][1]];
        return (
          <span key={kind} className="rounded-md bg-paper-2 px-2 py-0.5 text-ink shadow-groove">
            {t(KINDS[kind][0])}
            <span className="text-ink-3"> · {tMaybe(c.models.find((o) => o.value === model)?.label ?? (model || "Mặc định"))}{stepsOf(c, model).length > 0 && ` · ${effortLabel(effort)}`}</span>
          </span>
        );
      })}
      <Hint side="bottom" text={t("Đổi model / effort ở tab Model")}>
        <Button variant="ghost" size="icon-xs" aria-label={t("Đổi model")} onClick={onEdit}><SlidersHorizontal aria-hidden /></Button>
      </Hint>
    </div>
  );
}

const logoutClass = "hover:bg-error-wash hover:text-error";

/** `claude auth login` opens Anthropic's sign-in in the browser; the CLI keeps the token, never this page. */
function ClaudeAccountCard({ onEdit }: { onEdit: () => void }) {
  const t = useT();
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
  if (acc.isError) return <AgentCard provider="claude" tone="off" line={<span role="alert" className="text-error">{errorText(acc.error, {}, t("Không chạy được lệnh claude trên máy này."))}</span>} />;
  if (!a) return <AgentCard provider="claude" tone="wait" line={t("Đang kiểm tra…")}><Skeleton className="h-12" /></AgentCard>;
  const url = a.login_url ?? login.data?.url;
  const tier = planTier(a);
  return (
    <AgentCard provider="claude" tone={a.loggedIn ? "ok" : a.login_pending ? "wait" : "off"}
      line={a.loggedIn ? [a.name, a.email].filter(Boolean).join(" · ") || t("Đã đăng nhập") : a.login_pending ? t("Đang chờ đăng nhập…") : t("Chưa đăng nhập")}
      badges={a.loggedIn && <span className={planBadge}>{planName(a)}{tier && <> · <span className="font-mono">{tier}</span></>}</span>}
      actions={<>
        <Button variant={a.loggedIn ? "outline" : "default"} size="sm" aria-busy={login.isPending} disabled={login.isPending || a.login_pending} onClick={() => login.mutate()}>
          {a.login_pending ? t("Đang chờ trình duyệt…") : a.loggedIn ? t("Đổi tài khoản") : t("Đăng nhập")}
        </Button>
        {a.loggedIn && (
          <Button variant="ghost" size="sm" className={logoutClass} disabled={logout.isPending}
            onClick={() => (confirmOut ? logout.mutate() : setConfirmOut(true))} onBlur={() => setConfirmOut(false)}>
            {confirmOut ? t("Bấm lần nữa để đăng xuất") : t("Đăng xuất")}
          </Button>
        )}
      </>}>
      {(a.login_pending || paste.isError || login.isError || logout.isError) && (
        <div className="grid gap-2">
          {a.login_pending && (
            <form className="grid gap-2 rounded-md bg-paper-2 p-3" onSubmit={(e) => { e.preventDefault(); paste.mutate(); }}>
              <p className="text-xs text-ink-2">
                {t("Hoàn tất đăng nhập ở tab trình duyệt vừa mở.")}{url && <> {t.n("Không thấy tab? {link}, rồi dán mã trang đó hiện ra vào đây.", {
                  link: <a href={url} target="_blank" rel="noreferrer" className="text-hl-2 underline decoration-hl underline-offset-[3px]">{t("Mở trang đăng nhập")}</a> })}</>}
              </p>
              <div className="flex gap-2">
                <Input aria-label={t("Mã đăng nhập Claude")} autoComplete="off" placeholder={t("Mã dạng code#state")} maxLength={1000}
                  value={code} onChange={(e) => setCode(e.target.value)} />
                <Button type="submit" variant="outline" disabled={paste.isPending || code.trim().length < 8}>{paste.isPending ? t("Đang xác nhận…") : t("Xác nhận")}</Button>
              </div>
            </form>
          )}
          {paste.isError && <p role="alert" className="text-xs text-error">{errorText(paste.error, {
            claude_login_timeout: t("Claude chưa xác nhận mã sau một lúc chờ. Bấm đăng nhập lại."),
            claude_login_not_started: t("Phiên đăng nhập đã đóng (ví dụ sau khi khởi động lại). Bấm đăng nhập lại."),
          }, t("Mã không hợp lệ hoặc đã hết hạn. Bấm đăng nhập lại."))}</p>}
          {(login.isError || logout.isError) && <p role="alert" className="text-xs text-error">{errorText(login.error ?? logout.error, {}, t("Không chạy được lệnh claude. Thử lại sau."))}</p>}
        </div>
      )}
      {a.loggedIn && <Quota provider="claude" />}
      <UsedFor provider="claude" onEdit={onEdit} />
    </AgentCard>
  );
}

/** Codex: `codex login` opens the browser. Antigravity: a Terminal on an interactive `agy`, which signs in with Google on first run. */
function CliAccountCard({ provider, onEdit }: { provider: Provider; onEdit: () => void }) {
  const t = useT();
  const { info } = useAiPrefs();
  const a = useAccounts(15_000)[provider];
  const recheck = useRecheck();
  const login = useMutation({ mutationFn: () => api<{ url: string | null }>(`/ai/${provider}/login`, { method: "POST" }), onSettled: recheck });
  const logout = useMutation({ mutationFn: () => api(`/ai/${provider}/logout`, { method: "POST" }), onSettled: recheck });
  const name = info(provider)?.name ?? provider;
  if (a.checking) return <AgentCard provider={provider} tone="wait" line={t("Đang kiểm tra…")}><Skeleton className="h-12" /></AgentCard>;
  const notes = [
    !a.installed && <InstallCmd key="install" cmd={a.install} />,
    a.pending && a.url && (
      <a key="url" href={a.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs text-hl-2 underline decoration-hl underline-offset-[3px]">
        {t("Trình duyệt không tự mở? Mở trang đăng nhập")} <ExternalLink className="size-3" aria-hidden />
      </a>
    ),
    provider === "antigravity" && a.installed && !a.loggedIn && (
      <p key="agy" className="text-xs text-ink-3">{t.n("Đăng nhập mở Terminal chạy {agy}; đăng nhập Google trong trình duyệt, xong thì đóng Terminal.", { agy: <code>agy</code> })}</p>
    ),
    (login.isError || logout.isError) && <p key="err" role="alert" className="text-xs text-error">{t("Không chạy được lệnh {cmd}. Thử lại sau.", { cmd: provider })}</p>,
  ].filter(Boolean);
  return (
    <AgentCard provider={provider} tone={a.installed && a.loggedIn ? "ok" : a.pending ? "wait" : "off"}
      line={!a.installed ? t("Chưa cài {name} CLI: chạy lệnh dưới trong Terminal", { name }) : a.loggedIn ? a.email ?? t("Đã đăng nhập") : a.pending ? t("Đang chờ đăng nhập…") : t("Chưa đăng nhập")}
      badges={a.loggedIn && a.plan && <span className={planBadge}>{a.plan}</span>}
      actions={!a.installed ? <Button variant="outline" size="sm" onClick={recheck}>{t("Đã cài, kiểm tra lại")}</Button>
        : !a.loggedIn ? <Button size="sm" aria-busy={login.isPending} disabled={login.isPending || a.pending} onClick={() => login.mutate()}>{a.pending ? t("Đang chờ trình duyệt…") : t("Đăng nhập")}</Button>
        : provider === "codex" ? <Button variant="ghost" size="sm" className={logoutClass} disabled={logout.isPending} onClick={() => logout.mutate()}>{t("Đăng xuất")}</Button>
        : <Hint side="bottom" text={t("Gõ /logout trong agy (Terminal) rồi đăng nhập lại.")}><span tabIndex={0} className="text-xs text-ink-3 underline decoration-dotted underline-offset-[3px]">{t("Đổi tài khoản?")}</span></Hint>}>
      {notes.length > 0 && <div className="grid justify-items-start gap-2">{notes}</div>}
      {a.loggedIn && <Quota provider={provider} />}
      <UsedFor provider={provider} onEdit={onEdit} />
    </AgentCard>
  );
}

const THRESHOLDS = [70, 80, 90, 95].map((n) => ({ value: String(n), label: `${n}%` }));

/** Each kind of run: name, why. */
const KINDS = {
  chat: ["Tóm tắt, soạn nháp", "Chạy thường xuyên: nên chọn model nhanh."],
  brief: ["Briefing và Digest", "Đọc nhiều tin một lần. “Như tóm tắt”: dùng lựa chọn dòng trên."],
  task: ["Task và AI Agent", "Đọc code, lập kế hoạch: cần model mạnh."],
  yt: ["Hỏi AI, báo cáo, soạn ticket", "AI YouTrack hằng ngày: hỏi, báo cáo, lọc và soạn ticket."],
  yt_task: ["Đọc code, nhiều ticket", "AI YouTrack đọc code dự án hoặc trên 10 ticket một lần: cần model mạnh."],
  guide: ["Trợ lý biết tuốt", "Bot nổi trả lời cách dùng app. “Như tóm tắt”: dùng lựa chọn của tóm tắt, soạn nháp."],
} as const satisfies Record<RunKind, readonly [Key, Key]>;
/** What "" means for a kind when it is not the CLI default: [label, hint] (Briefing and YouTrack fall back to a Telegram row). */
const INHERITS: Partial<Record<RunKind, readonly [Key, Key]>> = {
  brief: ["Như tóm tắt", "Dùng lựa chọn của tóm tắt, soạn nháp"],
  yt: ["Như Telegram", "Dùng lựa chọn của tóm tắt, soạn nháp"],
  yt_task: ["Như Telegram", "Dùng lựa chọn của Task và AI Agent"],
  guide: ["Như tóm tắt", "Dùng lựa chọn của tóm tắt, soạn nháp"],
};
/** The module whose runs a picks list sets: Telegram's or YouTrack's AI features. */
export type AiScope = "telegram" | "youtrack";
const SCOPES: Record<AiScope, RunKind[]> = { telegram: ["chat", "brief", "task"], youtrack: ["yt", "yt_task"] };

/** The effort levels a model takes: its own when the CLI lists them per model (Codex, opencodex routes), else the CLI's. */
const stepsOf = (c: AiCatalogEntry, model: string) => c.models.find((o) => o.value === model)?.efforts ?? c.efforts;

/** One CLI's model dropdown and effort slider, both from its catalog entry (no efforts: the model takes none, no slider).
 *  `inherit`: what "" means here when it is not the CLI default (Briefing: the "chat" picks). `bare`: no "Effort" caption (a table with a header).
 *  `chip`: pills sized for a prompt box's tool row. */
export function Picks({ c, label, model, effort, onModel, onEffort, modelClass, effortClass, inherit, bare, variant = "full", chip }: {
  c: AiCatalogEntry; label: string; model: string; effort: Effort;
  onModel: (v: string) => void; onEffort: (v: Effort) => void; modelClass?: string; effortClass?: string; inherit?: readonly [string, string]; bare?: boolean;
  variant?: EffortVariant; chip?: boolean;
}) {
  const t = useT();
  // A saved id the CLI no longer lists still shows, so the dropdown never looks empty.
  let models = c.models.map((o) => ({ ...o, label: tMaybe(o.label), hint: o.hint && tMaybe(o.hint), group: o.group || undefined }));
  if (!models.some((o) => o.value === model)) models.push({ value: model, label: model, hint: t("Không còn trong danh sách của CLI"), group: undefined });
  if (inherit) models = models.map((o) => (o.value === "" ? { ...o, label: inherit[0], hint: inherit[1] } : o));
  const steps = stepsOf(c, model);
  return (
    <>
      <span className={modelClass}><Dropdown label={t("Model {name} cho {label}", { name: c.name, label })} value={model} onChange={onModel} options={models}
        {...chip && { trigger: CHIP, prefix: <Cpu aria-hidden className="size-3.5 shrink-0 text-ink-3" /> }} /></span>
      {steps.length > 0 && <EffortSlider label={t("Effort {name} cho {label}", { name: c.name, label })} steps={steps} value={effort} onChange={onEffort} className={effortClass} inherit={inherit?.[0]} bare={bare} variant={variant} />}
    </>
  );
}

/** One kind of run's model over every CLI's models, grouped by CLI and, for models a proxy routes (opencodex), by their
 *  provider (picking one picks the CLI that runs it), and the effort levels that model takes (none: no slider). The same saved picks everywhere: prompt boxes, Settings, the AI page. */
function KindPicks({ kind, modelClass, effortClass, bare, variant = "full", chip }: {
  kind: RunKind; modelClass?: string; effortClass?: string; bare?: boolean; variant?: EffortVariant; chip?: boolean;
}) {
  const t = useT();
  const { catalog, on, info, modelOf, setModel, picks, setPicks } = useAiPrefs();
  const id = on(kind), c = info(id);
  if (!catalog || !c) return null;
  const from = INHERITS[kind], inherit = from && ([t(from[0]), t(from[1])] as const);
  const label = t(KINDS[kind][0]), value = modelOf(kind), e = KEYS[kind][1];
  // "" of another kind is its base kind's pick, not a CLI default: those kinds list models only.
  const models = [
    ...(inherit ? [{ value: "", label: inherit[0], hint: inherit[1] }] : []),
    ...catalog.flatMap((x) => x.models.filter((o) => !inherit || o.value)
      .map((o) => ({ ...o, label: tMaybe(o.label), hint: o.hint && tMaybe(o.hint), value: `${x.id}:${o.value}`, group: o.group ? `${x.name} · ${o.group}` : x.name }))),
  ];
  // A saved id the CLI no longer lists still shows, so the dropdown never looks empty.
  if (!models.some((o) => o.value === value)) models.push({ value, label: `${c.name} · ${value.slice(value.indexOf(":") + 1) || t("Mặc định")}`, hint: t("Không còn trong danh sách của CLI") });
  const k = picks(id), steps = stepsOf(c, k[KEYS[kind][0]] || k[KEYS[BASE[kind]][0]]); // "": the base kind's model runs
  return (
    <>
      <span className={modelClass}><Dropdown label={t("Model cho {label}", { label })} value={value} onChange={(v) => setModel(kind, v)} options={models}
        {...chip && { trigger: CHIP, prefix: <Cpu aria-hidden className="size-3.5 shrink-0 text-ink-3" /> }} /></span>
      {steps.length > 0 && <EffortSlider label={t("Effort {name} cho {label}", { name: c.name, label })} steps={steps} value={k[e]} onChange={(v) => setPicks(id, { [e]: v })}
        className={effortClass} inherit={inherit?.[0]} bare={bare} variant={variant} />}
    </>
  );
}

/** Model + effort of one kind of run, inline (reply panel, AI Agent, Briefing); the same saved picks as Settings › AI.
 *  Short (the effort's name only) by default, for prompt boxes; `variant="full"` adds the slider (settings).
 *  `compact`: pills sized for a prompt box's tool row. */
export function ModelEffortPicker({ kind = "chat", compact = false, className, variant = "short" }: {
  kind?: RunKind; compact?: boolean; className?: string; variant?: EffortVariant;
}) {
  const t = useT();
  const { p, catalog, isError, save } = useAiPrefs();
  if (!p || !catalog) return isError ? <span role="alert" className={cn("text-xs text-error", className)}>{t("Không đọc được model/effort")}</span> : null;
  return (
    <span role="group" aria-label={t("Model và effort cho {label}", { label: t(KINDS[kind][0]) })} className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5", compact && "gap-x-1.5", className)}>
      <KindPicks kind={kind} modelClass={compact ? "flex min-w-0 max-w-36" : "w-44"} effortClass={compact ? "w-20" : "w-28"} variant={variant} chip={compact} />
      {save.isError && <span role="alert" className="text-xs text-error">{t("Không lưu được, thử lại")}</span>}
    </span>
  );
}

// Each run kind on one row: what it is on the left, model and effort on the right in aligned columns.
const PICK_ROW = "grid items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_28rem]";
const PICK_COLS = "grid grid-cols-[11rem_minmax(0,1fr)] items-center gap-2";

/** Model + effort for each kind of run of one module, from every CLI's models (the pick's CLI runs it; each CLI keeps
 *  its own picks), and Claude's step-down near the quota. `scope`: which module's runs it opens on; a Telegram / YouTrack
 *  switch moves between them unless `fixed`. `plain`: rows only, for a host card (Settings). */
export function PrefsSection({ plain = false, scope: initial = "telegram", fixed = false }: {
  plain?: boolean; scope?: AiScope; fixed?: boolean;
}) {
  const t = useT();
  const { p, catalog, save, set, used, info } = useAiPrefs();
  const accounts = useAccounts();
  const [scope, setScope] = useState<AiScope>(initial);
  if (!p || !catalog) return null;
  const inUse = used();
  const broken = inUse.filter((id) => !accounts[id].checking && !(accounts[id].installed && accounts[id].loggedIn));
  const pad = plain ? "py-3 first:pt-1" : "px-4 py-3";
  const tabs = !fixed && (
    <Segmented id={`ai-scope-${plain ? "plain" : "page"}`} label={t("Model và effort cho module")} value={scope} onChange={setScope}
      items={[{ value: "telegram", label: "Telegram", title: t("Tóm tắt, soạn nháp, Briefing, Digest, Task, AI Agent") },
        { value: "youtrack", label: "YouTrack", title: t("AI YouTrack: hỏi, báo cáo, soạn ticket, đọc code") }]} />
  );
  return (
    <section className="grid gap-2.5">
      {!plain ? (
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex items-center gap-3">
            <h3 className={sectionHead}>{t("Model và effort")}</h3>
            {tabs}
          </span>
          <span className="text-xs text-ink-3">{t("Áp dụng từ lần chạy kế tiếp")}</span>
        </span>
      ) : tabs && <span className="flex">{tabs}</span>}
      <ul key={scope} className={cn("grid divide-y divide-rule animate-in fade-in-0 duration-(--dur-short)", !plain && "rounded-lg bg-cotton shadow-stock")}>
        <li aria-hidden className={cn(PICK_ROW, "hidden py-2 text-2xs text-ink-3 sm:grid", !plain && "px-4")}>
          <span>{t("Dùng cho")}</span>
          <span className={PICK_COLS}><span>Model</span><span>Effort</span></span>
        </li>
        {SCOPES[scope].map((kind) => { const [title, hint] = KINDS[kind]; return (
          <li key={kind} className={cn(PICK_ROW, pad)}>
            <span className="grid min-w-0 gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-ink">
                {t(title)}
                <TestRun kind={kind} />
              </span>
              <span className="text-xs text-ink-3">{t(hint)}</span>
            </span>
            <span className={PICK_COLS}><KindPicks kind={kind} bare /></span>
          </li>
        ); })}
        {inUse.includes("claude") && <li className={cn(PICK_ROW, pad)}>
          <label className={cn("flex items-start gap-3", !p.fallback && "sm:col-span-2")}>
            <Checkbox className="mt-0.5" checked={p.fallback} onCheckedChange={(v) => set({ fallback: !!v })} />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium text-ink">{t("Tự hạ model khi gần hết hạn mức")}</span>
              <span className="text-xs text-ink-3">{t("Chạm ngưỡng (mọi module): việc nhẹ chạy Haiku; Task, AI Agent, AI YouTrack đọc code chạy Sonnet.")}</span>
            </span>
          </label>
          {p.fallback && (
            <span className={cn(PICK_COLS, "text-xs text-ink-3 animate-in fade-in-0 duration-(--dur-short)")}>
              <Dropdown label={t("Ngưỡng tự hạ model")} value={String(p.fallback_at)} onChange={(v) => set({ fallback_at: Number(v) })} options={THRESHOLDS} />
              <span>{t("ngưỡng hạn mức")}</span>
            </span>
          )}
        </li>}
      </ul>
      {broken.length > 0 && <p className="text-xs text-warn">{t("{names} chưa cài hoặc chưa đăng nhập: lần chạy dùng model đó sẽ lỗi.", { names: broken.map((id) => info(id)?.name ?? id).join(", ") })}</p>}
      <p className="text-xs text-ink-3">
        {t("Chọn model của AI nào thì việc đó chạy bằng AI ấy; mỗi AI giữ lựa chọn riêng. Model mạnh hơn, effort cao hơn: chậm hơn, tốn hạn mức hơn. Task đang dở tiếp tục bằng AI đã bắt đầu nó.")}
      </p>
      {save.isError && <p role="alert" className="text-xs text-error">{t("Không lưu được lựa chọn. Thử lại.")}</p>}
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
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // free position (0…last) while the pointer holds it
  const i = Math.max(0, steps.indexOf(value)); // a step this CLI doesn't take reads as its default
  const last = Math.max(1, steps.length - 1);
  const pos = drag ?? i;
  const near = Math.round(pos);
  const name = (v: Effort) => (v === "" && inherit ? inherit : effortLabel(v));
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
    <Dropdown label={t("{label}: chọn mức", { label })} value={steps[near]} onChange={(v) => onChange(v as Effort)}
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
  const t = useT();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api<{ text: string; ms: number }>("/ai/test", { method: "POST", json: { task: kind === "task" || kind === "yt_task", brief: kind === "brief", yt: kind.startsWith("yt"), guide: kind === "guide" } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["ai-runs"] }),
  });
  return (
    <span className="flex items-center gap-1.5 text-xs font-normal">
      <Hint side="bottom" text={t("Chạy một câu hỏi nhỏ bằng model này: có trả lời không, nhanh chậm thế nào")}>
        <Button variant="ghost" size="xs" className="h-6 px-1.5 text-ink-3" aria-busy={run.isPending} disabled={run.isPending} onClick={() => run.mutate()}>
          <Play aria-hidden className={cn("size-3", run.isPending && "animate-pulse")} />{run.isPending ? t("Đang thử…") : t("Thử")}
        </Button>
      </Hint>
      <span aria-live="polite" className="animate-in fade-in-0 duration-(--dur-short)">
        {run.isError ? <span className="text-error">{errorText(run.error, {}, t("Không chạy được, xem tab History."))}</span>
          : run.data && <span className="text-ok">✓ <span className="font-mono tabular-nums">{secs(run.data.ms)}</span></span>}
      </span>
    </span>
  );
}

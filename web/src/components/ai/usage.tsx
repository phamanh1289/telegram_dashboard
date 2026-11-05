"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleAlert, Download, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { type AiAccount, type AiRun, api, type ClaudeAccount } from "@/lib/api";
import { byUnit, clockLabel, dm, timeLabel, useNow } from "@/lib/inbox";
import { cn, downloadCsv } from "@/lib/utils";
import { type Effort, EFFORT_LABELS, meterTone, type Provider, resetIn, sectionHead, useAccounts, useAiPrefs, windowName } from "@/components/ai/prefs";

// The AI page's Usage and History tabs: live quota, the run report and every run in the period.

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
          <Hint side="bottom" text="Đọc lại hạn mức ngay">
            <Button variant="ghost" size="sm" aria-label="Đọc lại hạn mức" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              <RefreshCw aria-hidden className={cn("size-3.5", refresh.isPending && "animate-spin")} />
            </Button>
          </Hint>
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

const FEATURES: Record<string, string> = {
  draft: "Soạn nháp", ticket: "Ticket", summary: "Tóm tắt", digest: "Digest", youtrack: "YouTrack", agent: "AI Agent", test: "Thử model", ai: "Khác",
};
const PERIODS = [[1, "24 giờ"], [7, "7 ngày"], [30, "30 ngày"]] as const;

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} giây`;
const usd = (c: number) => `$${c.toFixed(c < 1 ? 3 : 2)}`;
const kilo = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const tokens = (r: AiRun) => r.input_tokens + r.output_tokens + r.cache_read + r.cache_write;
// One formatter each: building an Intl formatter per call (per row, per day) was the History tab's main cost.
const VN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
const VN_WEEKDAY = new Intl.DateTimeFormat("vi-VN", { weekday: "long", timeZone: "Asia/Ho_Chi_Minh" });
const vnDay = (t: number | string) => VN_DAY.format(new Date(t)); // 2026-11-02
const weekday = (d: string) => VN_WEEKDAY.format(new Date(`${d}T12:00:00+07:00`));

type Totals = { n: number; failed: number; tokens: number; cost: number; ms: number };
function totals(rows: AiRun[]): Totals {
  return rows.reduce((t, r) => ({ n: t.n + 1, failed: t.failed + (r.ok ? 0 : 1), tokens: t.tokens + tokens(r), cost: t.cost + (r.cost ?? 0), ms: t.ms + r.ms }),
    { n: 0, failed: 0, tokens: 0, cost: 0, ms: 0 });
}
/** Rows by key, keeping order. */
function bucket(rows: AiRun[], key: (r: AiRun) => string) {
  const m = new Map<string, AiRun[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}
function groupBy(rows: AiRun[], key: (r: AiRun) => string) {
  return [...bucket(rows, key)].map(([k, rs]) => [k, totals(rs)] as const).sort((a, b) => b[1].cost - a[1].cost || b[1].n - a[1].n);
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
export function UsageTab({ provider, days, setDays }: { provider: Provider; days: number; setDays: (d: number) => void }) {
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
export function HistoryTab({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  const runs = useRuns(days);
  const [feature, setFeature] = useState<string | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(() => runs.data ?? [], [runs.data]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!feature || r.feature === feature) && (!failedOnly || !r.ok)
    && (!needle || [r.model, r.effort, FEATURES[r.feature] ?? r.feature, r.error ?? ""].some((v) => v.toLowerCase().includes(needle)))), [all, feature, failedOnly, needle]);
  const counts = useMemo(() => groupBy(all, (r) => r.feature), [all]);
  const failed = all.filter((r) => !r.ok).length;
  const sum = totals(rows);
  const byDay = useMemo(() => byVnDay(rows), [rows]); // a day's totals count every matching row, not just the shown page
  const shown = useMemo(() => [...byVnDay(rows.slice(0, limit))], [rows, limit]);
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
        <Hint side="bottom" text="Xuất CSV những dòng đang hiện">
          <Button variant="ghost" size="sm" aria-label="Xuất CSV những dòng đang hiện" disabled={!rows.length} onClick={exportRows}><Download aria-hidden className="size-3.5" /></Button>
        </Hint>
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

            <p aria-live="polite" className="flex flex-wrap gap-x-3 text-xs text-ink-2">
              <span>{rows.length === all.length ? `${all.length} request` : `${rows.length} / ${all.length} request khớp`}</span>
              {rows.length > 0 && <><span><span className="font-mono tabular-nums">{kilo(sum.tokens)}</span> token</span><span className="font-mono tabular-nums">{usd(sum.cost)}</span></>}
            </p>

            {!rows.length ? (
              <div className="grid justify-items-start gap-2 rounded-lg bg-cotton p-4 text-sm text-ink-2 shadow-stock">
                Không có request nào khớp bộ lọc.
                <Button variant="outline" size="sm" onClick={() => { setQ(""); setFeature(null); setFailedOnly(false); }}>Xoá bộ lọc</Button>
              </div>
            ) : (
              <div className="grid gap-4">
                {shown.map(([d, rs]) => {
                  const t = totals(byDay.get(d) ?? rs);
                  return (
                    <section key={d} aria-label={`${weekday(d)} ${dm(d)}`} className="grid gap-1.5">
                      <h4 className="sticky -top-5 z-10 -mx-5 flex items-baseline justify-between gap-3 bg-paper/95 px-5 py-1.5 text-xs backdrop-blur-sm">
                        <span className="font-semibold text-ink first-letter:uppercase">{d === today ? "Hôm nay" : weekday(d)}, {dm(d)}</span>
                        <span className="flex gap-2 font-mono text-ink-3 tabular-nums"><span>{t.n} request</span><span>{kilo(t.tokens)}</span><span>{usd(t.cost)}</span></span>
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
          <span className="truncate text-ink-3">{r.model.replace(/^claude-/, "")}{!r.ok && r.error && <span className="text-error">, {r.error}</span>}</span>
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
          <p className="flex flex-wrap gap-x-3 text-ink-3"><span>{timeLabel(r.at, true)}</span><span>model <span className="font-mono">{r.model}</span></span></p>
        </div>
      )}
    </li>
  );
}

/** Rows (newest first) into Vietnam days, keeping order. */
const byVnDay = (rows: AiRun[]) => bucket(rows, (r) => vnDay(r.at));

/** Requests per Vietnam day across the period, oldest on the left; hover or focus a bar for that day's full report. */
function DayBars({ rows, days }: { rows: AiRun[]; days: number }) {
  const now = useNow();
  const byDay = useMemo(() => byVnDay(rows), [rows]);
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
              {groupBy(rows, key).map(([k, g]) => line(k, `${g.n} request, ${usd(g.cost)}`))}
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
                <span className="flex shrink-0 gap-2 font-mono text-ink-2 tabular-nums"><span>{t.n}</span><span>{kilo(t.tokens)}</span><span>{usd(t.cost)}</span></span>
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

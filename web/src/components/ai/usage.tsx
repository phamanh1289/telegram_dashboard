"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { type AiAccount, type AiRun, api, type ClaudeAccount } from "@/lib/api";
import { useNow } from "@/lib/inbox";
import { byUnit, clockLabel, dm, timeLabel } from "@/lib/time";
import { cn, downloadCsv } from "@/lib/utils";
import { card, type Effort, EFFORT_LABELS, meterTone, type Provider, resetIn, sectionHead, useAccounts, useAiPrefs, windowName } from "@/components/ai/prefs";

// The AI page's live quota (account and Usage tabs), the Usage report and the History of every run in the period.

/** Every quota window of this CLI as a tile: what is left and when it resets. Nothing when it reports none. */
export function Quota({ provider }: { provider: Provider }) {
  const a = useAccounts(60_000)[provider];
  const now = useNow();
  const qc = useQueryClient();
  const { p } = useAiPrefs();
  const refresh = useMutation({
    mutationFn: () => provider === "claude"
      ? api<ClaudeAccount>("/claude/refresh", { method: "POST" }).then((x) => qc.setQueryData(["claude-account"], x))
      : api<AiAccount[]>("/ai/accounts?fresh=true").then((x) => qc.setQueryData(["ai-accounts"], x)),
  });
  if (a.checking) return <Skeleton className="h-28" />;
  const stale = a.usage_error === "no_token";
  if (!a.loggedIn || (!a.usage.length && !stale)) return null;
  const peak = Math.max(0, ...a.usage.map((u) => u.percent));
  return (
    <section aria-label="Hạn mức còn lại" className="grid gap-2.5">
      <span className="flex items-center justify-between gap-3">
        <h3 className={sectionHead}>Hạn mức còn lại</h3>
        <span className="flex items-center gap-1 text-xs text-ink-3">
          {a.usage_at && <span>Cập nhật {timeLabel(a.usage_at)}</span>}
          <Hint side="bottom" text="Đọc lại hạn mức ngay">
            <Button variant="ghost" size="icon-xs" aria-label="Đọc lại hạn mức" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              <RefreshCw aria-hidden className={cn(refresh.isPending && "animate-spin")} />
            </Button>
          </Hint>
        </span>
      </span>
      {stale && (
        <p role="status" className="rounded-md bg-warn-wash px-3 py-2 text-xs text-ink">
          Token đăng nhập của Claude CLI đã hết hạn, nên {a.usage.length ? "đây là số liệu lần đọc cuối" : "chưa đọc được hạn mức"}.
          CLI tự làm mới token mỗi lần chạy: bấm <RefreshCw aria-label="Đọc lại" className="inline size-3 align-[-2px]" /> để chạy một câu hỏi nhỏ bằng Haiku rồi đọc lại.
        </p>
      )}
      {provider === "claude" && p?.fallback && peak >= p.fallback_at && (
        <p role="status" className="rounded-md bg-warn-wash px-3 py-2 text-xs text-ink">
          Đã chạm ngưỡng {p.fallback_at}%: tóm tắt/nháp đang chạy Haiku, Task và AI Agent chạy Sonnet.
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {a.usage.map((u) => {
          const used = Math.round(Math.min(100, Math.max(0, u.percent)));
          const left = 100 - used;
          const name = windowName(u.label);
                    return (
            <li key={u.label} className="grid content-start gap-2 rounded-lg bg-paper-2 p-3 shadow-groove">
              <span className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium text-ink-2">{name}</span>
                {u.resets_at && <span className="shrink-0 text-ink-3">đặt lại sau <span className="font-medium text-ink">{resetIn(u.resets_at, now)}</span></span>}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className={cn("font-mono text-2xl leading-none font-semibold tabular-nums", left <= 10 ? "text-error" : "text-ink")}>{left}%</span>
                <span className="text-xs text-ink-3">còn lại</span>
              </span>
              <span role="meter" aria-label={`Còn lại, ${name}`} aria-valuenow={left} aria-valuemin={0} aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-rule-2/45">
                <span className={cn("block h-full origin-left rounded-full transition-transform duration-500 ease-(--ease-out)", meterTone(used))} style={{ transform: `scaleX(${left / 100})` }} />
              </span>
              <span className="flex flex-wrap justify-between gap-x-2 text-xs text-ink-3">
                <span>Đã dùng <span className="font-mono tabular-nums text-ink-2">{used}%</span></span>
                {u.resets_at && <span>lúc {timeLabel(u.resets_at)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const FEATURES: Record<string, string> = {
  draft: "Soạn nháp", ticket: "Ticket", summary: "Tóm tắt", digest: "Digest", youtrack: "YouTrack", agent: "AI Agent", links: "Tóm tắt link", test: "Thử model", ai: "Khác",
};
const feat = (f: string) => FEATURES[f] ?? f;
const shortModel = (m: string) => m.replace(/^claude-/, "");
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
const HOUR = 3_600_000;

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
/** Rows (newest first) into Vietnam days, keeping order. */
const byVnDay = (rows: AiRun[]) => bucket(rows, (r) => vnDay(r.at));

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

const periodName = (days: number) => PERIODS.find(([d]) => d === days)?.[1];
const emptyRuns = (days: number) => (
  <p className={cn(card, "gap-1 text-sm text-ink-2")}>
    <span className="font-medium text-ink">Chưa có request nào trong {periodName(days)}</span>
    <span className="text-xs">Mỗi lần tóm tắt, soạn nháp, Digest, YouTrack AI hay AI Agent chạy sẽ được ghi ở đây.</span>
  </p>
);
const runsError = <p role="alert" className="text-sm text-error">Không đọc được lịch sử chạy.</p>;

/** Live quota, then the period's report: totals, a bar per day (per hour for 24h), and the split by feature and model. */
export function UsageTab({ provider, days, setDays }: { provider: Provider; days: number; setDays: (d: number) => void }) {
  const runs = useRuns(days);
  const rows = runs.data ?? [];
  const sum = totals(rows);
  return (
    <>
      <div className={card}><Quota provider={provider} /></div>
      <section className="grid gap-2.5">
        <PeriodHead title="Báo cáo" days={days} setDays={setDays} />
        {runs.isError ? runsError
          : !runs.data ? <div role="status" aria-label="Đang tải…" className="grid gap-2"><Skeleton className="h-16" /><Skeleton className="h-36" /></div>
          : !rows.length ? emptyRuns(days)
          : (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-rule shadow-stock sm:grid-cols-4">
                {([
                  ["Request", String(sum.n), sum.failed ? `${sum.failed} lỗi` : "không lỗi"],
                  ["Token", kilo(sum.tokens), `TB ${kilo(Math.round(sum.tokens / sum.n))} / request`],
                  ["Chi phí quy đổi", usd(sum.cost), "nếu trả theo API"],
                  ["Thời gian TB", secs(sum.ms / sum.n), `tổng ${byUnit(Math.round(sum.ms / 60_000)).join(" ")}`],
                ] as const).map(([k, v, hint]) => (
                  <div key={k} className="grid content-start gap-0.5 bg-cotton px-3 py-2.5">
                    <dt className="text-xs text-ink-3">{k}</dt>
                    <dd className="font-mono text-lg leading-tight font-semibold text-ink tabular-nums">{v}</dd>
                    <dd className={cn("text-xs", k === "Request" && sum.failed ? "text-error" : "text-ink-3")}>{hint}</dd>
                  </div>
                ))}
              </dl>
              <Bars rows={rows} days={days} />
              <div className="grid gap-2 sm:grid-cols-2">
                <Breakdown title="Theo tính năng" groups={groupBy(rows, (r) => feat(r.feature))} total={sum} />
                <Breakdown title="Theo model" groups={groupBy(rows, (r) => shortModel(r.model))} total={sum} />
              </div>
              <p className="text-xs text-ink-3">Chi phí quy đổi là giá token nếu trả theo API, không phải tiền bị trừ: gói Pro/Max/Team tính theo hạn mức.</p>
            </>
          )}
      </section>
    </>
  );
}

/** Requests per slot, oldest on the left: one per Vietnam day, or one per hour for the 24h period. Failed runs stack on top in red;
 *  hover or focus a bar for a one-line summary. */
function Bars({ rows, days }: { rows: AiRun[]; days: number }) {
  const now = useNow();
  const hourly = days === 1;
  const slots = useMemo(() => {
    const by = hourly ? bucket(rows, (r) => String(Math.floor(Date.parse(r.at) / HOUR))) : byVnDay(rows);
    const h0 = Math.floor(now / HOUR);
    return hourly
      ? Array.from({ length: 24 }, (_, i) => {
        const h = h0 - 23 + i;
        const at = clockLabel(new Date(h * HOUR).toISOString());
        return { key: String(h), label: at, long: `${at}–${clockLabel(new Date((h + 1) * HOUR).toISOString())}`, t: totals(by.get(String(h)) ?? []) };
      })
      : Array.from({ length: days }, (_, i) => { const d = vnDay(now - (days - 1 - i) * 86_400_000); return { key: d, label: dm(d), long: `${weekday(d)}, ${dm(d)}`, t: totals(by.get(d) ?? []) }; });
  }, [rows, days, hourly, now]);
  const top = Math.max(1, ...slots.map((s) => s.t.n));
  const few = slots.length <= 7; // few enough bars to label each one
  const ends = [0, Math.floor(slots.length / 2), slots.length - 1];
  return (
    <figure className={cn(card, "gap-2 p-3")}>
      <figcaption className="flex items-center justify-between gap-2 text-xs text-ink-2">
        Request mỗi {hourly ? "giờ" : "ngày"}
        <span className="flex gap-3 text-ink-3">
          <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-sm bg-hl" />Thành công</span>
          <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-sm bg-error" />Lỗi</span>
        </span>
      </figcaption>
      <div className={cn("flex h-24 items-end", few ? "gap-2" : "gap-0.5")}>
        {slots.map(({ key, long, t }, k) => {
          const summary = t.n ? `${t.n} request · ${usd(t.cost)}${t.failed ? ` · ${t.failed} lỗi` : ""}` : "Không có request";
          return (
            <span key={key} tabIndex={0} aria-label={`${long}: ${summary}`}
              className="group relative flex h-full flex-1 flex-col items-center justify-end rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus)">
              {few && t.n > 0 && <span className="mb-0.5 font-mono text-[0.6875rem] text-ink-2 tabular-nums">{t.n}</span>}
              {t.n ? (
                <span className="flex w-full max-w-9 flex-col overflow-hidden rounded-t-sm transition-opacity duration-(--dur-micro) group-hover:opacity-75" style={{ height: `${Math.max(6, (t.n / top) * 100)}%` }}>
                  {t.failed > 0 && <span className="bg-error" style={{ flex: t.failed }} />}
                  <span className="bg-hl" style={{ flex: t.n - t.failed }} />
                </span>
              ) : <span className="h-0.5 w-full rounded-full bg-rule-2/60" />}
              <span role="tooltip"
                className={cn("pointer-events-none absolute bottom-full z-20 mb-1.5 grid w-max gap-0.5 rounded-md bg-ink px-2 py-1 text-[0.6875rem] text-paper opacity-0 shadow-pop transition-[opacity,transform] duration-(--dur-short) ease-(--ease-out) translate-y-1 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
                  k < 2 ? "left-0" : k > slots.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2")}>
                <span className="font-semibold first-letter:uppercase">{long}</span>
                <span className="font-mono tabular-nums opacity-85">{summary}</span>
              </span>
            </span>
          );
        })}
      </div>
      <span className={cn("flex font-mono text-[0.6875rem] text-ink-3 tabular-nums", few ? "gap-2" : "justify-between")}>
        {few ? slots.map((s, k) => <span key={s.key} className="flex-1 text-center">{k === slots.length - 1 ? "Hôm nay" : s.label}</span>)
          : ends.map((k) => <span key={k}>{k === slots.length - 1 ? (hourly ? "Bây giờ" : "Hôm nay") : slots[k].label}</span>)}
      </span>
    </figure>
  );
}

/** Share of the period per group (by cost, by count when every run is free): name, requests, cost. */
function Breakdown({ title, groups, total }: { title: string; groups: (readonly [string, Totals])[]; total: Totals }) {
  return (
    <div className={cn(card, "content-start gap-2.5 p-3")}>
      <h4 className="text-xs text-ink-2">{title}</h4>
      <ul className="grid gap-2.5">
        {groups.map(([k, t]) => {
          const share = total.cost > 0 ? t.cost / total.cost : t.n / total.n;
          return (
            <li key={k} className="grid gap-1 text-xs">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{k}</span>
                <span className="shrink-0 font-mono text-ink-3 tabular-nums">{t.n} req</span>
                <span className="w-14 shrink-0 text-right font-mono text-ink tabular-nums">{usd(t.cost)}</span>
              </span>
              <span aria-hidden className="h-1 overflow-hidden rounded-full bg-rule-2/45">
                <span className="block h-full origin-left rounded-full bg-hl transition-transform duration-500 ease-(--ease-out)" style={{ transform: `scaleX(${share})` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PAGE = 50;
const ROW = "grid grid-cols-[2.75rem_minmax(0,1fr)_3.25rem_3.75rem_2.75rem_0.875rem] items-center gap-x-2";

/** Each request in the period, newest first: search, feature and error filters, grouped by Vietnam day; a row opens its detail. CSV exports what the filter shows. */
export function HistoryTab({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  const runs = useRuns(days);
  const [feature, setFeature] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(() => runs.data ?? [], [runs.data]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!feature || r.feature === feature) && (!failedOnly || !r.ok)
    && (!needle || [r.model, r.effort, feat(r.feature), r.error ?? ""].some((v) => v.toLowerCase().includes(needle)))), [all, feature, failedOnly, needle]);
  const counts = useMemo(() => groupBy(all, (r) => r.feature), [all]);
  const failed = all.filter((r) => !r.ok).length;
  const sum = totals(rows);
  const byDay = useMemo(() => byVnDay(rows), [rows]); // a day's totals count every matching row, not just the shown page
  const shown = useMemo(() => [...byVnDay(rows.slice(0, limit))], [rows, limit]);
  const today = vnDay(useNow());
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setLimit(PAGE); setOpen(null); };
  const clear = () => { setQ(""); setFeature(""); setFailedOnly(false); };
  const exportRows = () => downloadCsv([
    ["Thời gian", "Tính năng", "Model", "Effort", "Tự hạ model", "Thành công", "Lỗi", "Thời gian chạy (ms)", "Input", "Output", "Đọc cache", "Ghi cache", "Chi phí quy đổi (USD)", "5h % sau", "7 ngày % sau"],
    ...rows.map((r) => [r.at, feat(r.feature), r.model, r.effort, r.fallback ? "có" : "", r.ok ? "có" : "không", r.error ?? "", r.ms,
      r.input_tokens, r.output_tokens, r.cache_read, r.cache_write, r.cost ?? "", r.quota["5h"] ?? "", r.quota["1w"] ?? ""]),
  ], `ai-runs-${days}d.csv`);

  return (
    <section className="grid gap-3">
      <PeriodHead title="Lịch sử chạy" days={days} setDays={filter(setDays)}>
        <Hint side="bottom" text="Xuất CSV những dòng đang hiện">
          <Button variant="ghost" size="icon-xs" aria-label="Xuất CSV những dòng đang hiện" disabled={!rows.length} onClick={exportRows}><Download aria-hidden /></Button>
        </Hint>
      </PeriodHead>

      {runs.isError ? runsError
        : !runs.data ? <div role="status" aria-label="Đang tải…" className="grid gap-2"><Skeleton className="h-8" /><Skeleton className="h-64" /></div>
        : !all.length ? emptyRuns(days)
        : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-44 flex-1">
                <span className="sr-only">Tìm request</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
                <Input type="search" placeholder="Tìm model, tính năng, lỗi…" className="h-8 pl-8 text-xs" value={q} onChange={(e) => filter(setQ)(e.target.value)} />
              </label>
              <span className="w-40">
                <Dropdown label="Lọc theo tính năng" value={feature} onChange={filter(setFeature)}
                  options={[{ value: "", label: `Mọi tính năng · ${all.length}` }, ...counts.map(([f, t]) => ({ value: f, label: `${feat(f)} · ${t.n}` }))]} />
              </span>
              {failed > 0 && (
                <Segmented id="history-status" label="Trạng thái" value={failedOnly ? "failed" : "all"} onChange={(v) => filter(setFailedOnly)(v === "failed")}
                  items={[{ value: "all", label: "Tất cả" }, { value: "failed", label: `Chỉ lỗi · ${failed}` }]} />
              )}
            </div>

            <p aria-live="polite" className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
              <span className="text-ink-2">{rows.length === all.length ? `${all.length} request` : `${rows.length} / ${all.length} request khớp`}</span>
              {rows.length > 0 && <>·<span className="font-mono tabular-nums">{kilo(sum.tokens)} token</span>·<span className="font-mono tabular-nums">{usd(sum.cost)}</span></>}
            </p>

            {!rows.length ? (
              <div className={cn(card, "justify-items-start gap-2 text-sm text-ink-2")}>
                Không có request nào khớp bộ lọc.
                <Button variant="outline" size="sm" onClick={clear}>Xoá bộ lọc</Button>
              </div>
            ) : (
              <div className="grid gap-3">
                <div aria-hidden className={cn(ROW, "px-3 text-[0.6875rem] text-ink-3")}>
                  <span>Giờ</span><span>Tính năng · model</span><span className="text-right">Token</span><span className="text-right">Chi phí</span><span className="text-right">Chạy</span><span />
                </div>
                {shown.map(([d, rs]) => {
                  const t = totals(byDay.get(d) ?? rs);
                  return (
                    <section key={d} aria-label={`${weekday(d)} ${dm(d)}`} className="grid gap-1">
                      <h4 className="sticky -top-5 z-10 -mx-5 flex items-baseline justify-between gap-3 bg-paper/95 px-5 py-1.5 text-xs backdrop-blur-sm">
                        <span className="font-semibold text-ink first-letter:uppercase">{d === today ? "Hôm nay" : weekday(d)}, {dm(d)}</span>
                        <span className="font-mono text-ink-3 tabular-nums">{t.n} req · {usd(t.cost)}</span>
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
                    Xem thêm {Math.min(PAGE, rows.length - limit)} <span className="text-ink-3">(còn {rows.length - limit})</span>
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

/** One request on one line (time, status, feature and model, tokens, cost, duration); opens its tokens, quota after the run and the error. */
function RunRow({ r, open, onToggle }: { r: AiRun; open: boolean; onToggle: () => void }) {
  const detail = ([
    ["Input", kilo(r.input_tokens)], ["Output", kilo(r.output_tokens)], ["Đọc cache", kilo(r.cache_read)], ["Ghi cache", kilo(r.cache_write)],
    ["Effort", r.effort ? EFFORT_LABELS[r.effort as Effort] ?? r.effort : null], ["Lượt", r.turns ? String(r.turns) : null],
    ["5h sau", r.quota["5h"] != null ? `${Math.round(r.quota["5h"])}%` : null], ["7 ngày sau", r.quota["1w"] != null ? `${Math.round(r.quota["1w"])}%` : null],
  ] as [string, string | null][]).filter((x): x is [string, string] => x[1] != null);
  return (
    <li className={cn(!r.ok && "bg-error-wash/40")}>
      <button type="button" aria-expanded={open} onClick={onToggle}
        className={cn(ROW, "w-full px-3 py-2 text-left text-xs transition-colors duration-(--dur-micro) hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-focus)")}>
        <span className="font-mono text-ink-2 tabular-nums">{clockLabel(r.at)}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-label={r.ok ? "Thành công" : "Lỗi"} className={cn("size-1.5 shrink-0 rounded-full", r.ok ? "bg-ok" : "bg-error")} />
          <span className="shrink-0 font-medium text-ink">{feat(r.feature)}</span>
          <span className="min-w-0 truncate text-ink-3">{r.ok ? shortModel(r.model) : <span className="text-error">{r.error ?? "Lỗi"}</span>}</span>
          {r.fallback && <span className="shrink-0 rounded bg-warn-wash px-1 text-ink">hạ model</span>}
          {r.imported && <span className="shrink-0 rounded bg-paper-3 px-1 text-ink-3">nhập lại</span>}
        </span>
        <span className="text-right font-mono text-ink tabular-nums">{kilo(tokens(r))}</span>
        <span className="text-right font-mono text-ink-2 tabular-nums">{r.cost == null ? "—" : usd(r.cost)}</span>
        <span className="text-right font-mono text-ink-2 tabular-nums">{(r.ms / 1000).toFixed(1)}s</span>
        <ChevronDown aria-hidden className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out)", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-2.5 border-t border-rule bg-paper-2/60 px-3 py-2.5 text-xs animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short)">
          {!r.ok && r.error && <p role="alert" className="rounded-md bg-error-wash px-2.5 py-2 break-words text-error">{r.error}</p>}
          <dl className="grid grid-cols-4 gap-x-4 gap-y-2">
            {detail.map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className="font-mono font-medium text-ink tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="flex flex-wrap gap-x-3 text-ink-3"><span>{timeLabel(r.at, true)}</span><span className="font-mono">{r.model}</span></p>
        </div>
      )}
    </li>
  );
}

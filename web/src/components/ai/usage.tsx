"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, RefreshCw, RotateCcw } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { AgentIcon } from "@/components/ai/agent-icon";
import { AiFetching, useAiWait } from "@/components/ai/fetching";
import { Skeleton } from "@/components/ui/skeleton";
import { type AiAccount, type AiRun, api, type ClaudeAccount } from "@/lib/api";
import { fmtDate, type Key, t, tMaybe, useT } from "@/lib/i18n";
import { useNow } from "@/lib/inbox";
import { byUnit, clockLabel, dm, timeLabel } from "@/lib/time";
import { cn, downloadCsv } from "@/lib/utils";
import { card, type Effort, effortLabel, meterTone, type Provider, resetIn, sectionHead, useAccounts, useAiPrefs, windowName } from "@/components/ai/prefs";

// The AI page's live quota (each CLI's card in Tổng quan), the Usage report and the History of every run in the period.

/** Every quota window of this CLI, one line each: left %, a meter, when it resets (hover: the exact time). Nothing when it reports none. */
export function Quota({ provider }: { provider: Provider }) {
  const t = useT();
  const a = useAccounts(60_000)[provider];
  const now = useNow();
  const qc = useQueryClient();
  const { p } = useAiPrefs();
  const refresh = useMutation({
    mutationFn: () => provider === "claude"
      ? api<ClaudeAccount>("/claude/refresh", { method: "POST" }).then((x) => qc.setQueryData(["claude-account"], x))
      : api<AiAccount[]>("/ai/accounts?fresh=true").then((x) => qc.setQueryData(["ai-accounts"], x)),
  });
  if (a.checking) return <Skeleton className="h-12" />;
  const stale = a.usage_error === "no_token";
  if (!a.loggedIn || (!a.usage.length && !stale)) return null;
  const peak = Math.max(0, ...a.usage.map((u) => u.percent));
  return (
    <section aria-label={t("Hạn mức còn lại")} className="grid gap-2">
      <span className="flex items-center justify-between gap-3 text-xs text-ink-3">
        <span>{t("Hạn mức còn lại")}</span>
        <span className="flex items-center gap-1">
          {a.usage_at && <span>{t("Cập nhật {time}", { time: clockLabel(a.usage_at) })}</span>}
          <Hint side="bottom" text={t("Đọc lại hạn mức ngay")}>
            <Button variant="ghost" size="icon-xs" aria-label={t("Đọc lại hạn mức")} disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              <RefreshCw aria-hidden className={cn(refresh.isPending && "animate-spin")} />
            </Button>
          </Hint>
        </span>
      </span>
      {stale && (
        <p role="status" className="rounded-md bg-warn-wash px-3 py-2 text-xs text-ink">
          {a.usage.length ? t("Token đăng nhập của Claude CLI đã hết hạn, nên đây là số liệu lần đọc cuối.") : t("Token đăng nhập của Claude CLI đã hết hạn, nên chưa đọc được hạn mức.")}{" "}
          {t.n("CLI tự làm mới token mỗi lần chạy: bấm {icon} để chạy một câu hỏi nhỏ bằng Haiku rồi đọc lại.", { icon: <RefreshCw aria-label={t("Đọc lại")} className="inline size-3 align-[-2px]" /> })}
        </p>
      )}
      {provider === "claude" && p?.fallback && peak >= p.fallback_at && (
        <p role="status" className="rounded-md bg-warn-wash px-3 py-2 text-xs text-ink">
          {t("Đã chạm ngưỡng {n}%: tóm tắt/nháp đang chạy Haiku, Task và AI Agent chạy Sonnet.", { n: p.fallback_at })}
        </p>
      )}
      <ul className="grid gap-1.5">
        {a.usage.map((u) => {
          const used = Math.round(Math.min(100, Math.max(0, u.percent)));
          const left = 100 - used;
          const name = windowName(u.label);
          return (
            <li key={u.label} className="grid grid-cols-[minmax(0,9.5rem)_minmax(3rem,1fr)_2.75rem_4.5rem] items-center gap-x-3 text-xs">
              <span className="truncate text-ink-2">{name}</span>
              <span role="meter" aria-label={t("Còn lại, {name}", { name })} aria-valuenow={left} aria-valuemin={0} aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-rule-2/45">
                <span className={cn("block h-full origin-left rounded-full transition-transform duration-500 ease-(--ease-out)", meterTone(used))} style={{ transform: `scaleX(${left / 100})` }} />
              </span>
              <span className={cn("text-right font-mono font-bold tabular-nums", left <= 10 ? "text-error" : "text-ink")}>{left}%</span>
              {u.resets_at ? (
                <Hint side="bottom" text={t("Đặt lại lúc {time} {day}", { time: clockLabel(u.resets_at), day: dm(vnDay(u.resets_at)) })}>
                  <span tabIndex={0} aria-label={t("Đặt lại sau {span}", { span: resetIn(u.resets_at, now) })} className="flex items-center justify-end gap-1 truncate text-ink-3"><RotateCcw aria-hidden className="size-3 shrink-0" />{resetIn(u.resets_at, now)}</span>
                </Hint>
              ) : <span />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const FEATURES: Record<string, Key> = { draft: "Soạn nháp", answer: "Trả lời từ code", summary: "Tóm tắt", links: "Tóm tắt link", test: "Thử model", ai: "Khác" };
const NAMES: Record<string, string> = { ticket: "Ticket", digest: "Digest", youtrack: "YouTrack", agent: "AI Agent" };
/** A feature's name in the current language (call from a component that uses `useT`). */
const feat = (f: string) => (FEATURES[f] ? t(FEATURES[f]) : NAMES[f] ?? f);
/** The backend logs a run without a model pick as "mặc định": translated like the catalog's fixed texts. */
const shortModel = (m: string) => tMaybe(m.replace(/^claude-/, ""));
const PERIODS = [[1, "24 giờ"], [7, "7 ngày"], [30, "30 ngày"]] as const;

export const secs = (ms: number) => t("{n} giây", { n: (ms / 1000).toFixed(1) });
const usd = (c: number) => `$${c.toFixed(c < 1 ? 3 : 2)}`;
const kilo = (n: number) => (n >= 1e9 ? t("{n} tỷ", { n: (n / 1e9).toFixed(2) }) : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const tokens = (r: AiRun) => r.input_tokens + r.output_tokens + r.cache_read + r.cache_write;
// One formatter each: building an Intl formatter per call (per row, per day) was the History tab's main cost.
const VN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
const vnDay = (at: number | string) => VN_DAY.format(new Date(at)); // 2026-11-02
/** The weekday of a Vietnam day, in the current language (render-time: the caller uses `useT`). */
const weekday = (d: string) => fmtDate(`${d}T12:00:00+07:00`, { weekday: "long" });
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
  const t = useT();
  return (
    <span className="flex flex-wrap items-center justify-between gap-2">
      <h3 className={sectionHead}>{title}</h3>
      <span className="flex items-center gap-1">
        <Segmented id={`period-${title}`} label={t("Khoảng thời gian")} value={days} onChange={setDays}
          items={PERIODS.map(([d, label]) => ({ value: d, label: t(label) }))} />
        {children}
      </span>
    </span>
  );
}

// Render-time helpers: plain `t`, their callers use `useT` (so they follow a language switch).
const periodName = (days: number) => { const p = PERIODS.find(([d]) => d === days)?.[1]; return p ? t(p) : ""; };
const emptyRuns = (days: number) => (
  <p className={cn(card, "gap-1 text-sm text-ink-2")}>
    <span className="font-medium text-ink">{t("Chưa có request nào trong {period}", { period: periodName(days) })}</span>
    <span className="text-xs">{t("Mỗi lần tóm tắt, soạn nháp, Digest, YouTrack AI hay AI Agent chạy sẽ được ghi ở đây.")}</span>
  </p>
);
const runsError = () => <p role="alert" className="text-sm text-error">{t("Không đọc được lịch sử chạy.")}</p>;

/** The period's report: totals, a bar per day (per hour for 24h), and the split by feature and model. */
export function UsageTab({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  const t = useT();
  const runs = useRuns(days);
  const wait = useAiWait(!runs.data && !runs.isError);
  const rows = runs.data ?? [];
  const sum = totals(rows);
  return (
    <>
      <section className="grid gap-2.5">
        <PeriodHead title={t("Báo cáo")} days={days} setDays={setDays} />
        {runs.isError ? runsError()
          : wait ? <AiFetching kind="runs" className="min-h-[40vh]" />
          : !rows.length ? emptyRuns(days)
          : (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-rule shadow-stock sm:grid-cols-4">
                {([
                  ["Request", String(sum.n), sum.failed ? t("{n} lỗi", { n: sum.failed }) : t("không lỗi")],
                  ["Token", kilo(sum.tokens), t("TB {n} / request", { n: kilo(Math.round(sum.tokens / sum.n)) })],
                  [t("Chi phí quy đổi"), usd(sum.cost), t("nếu trả theo API")],
                  [t("Thời gian TB"), secs(sum.ms / sum.n), t("tổng {span}", { span: byUnit(Math.round(sum.ms / 60_000)).join(" ") })],
                ] as const).map(([k, v, hint], i) => (
                  <div key={i} className="grid content-start gap-0.5 bg-cotton px-3 py-2.5">
                    <dt className="text-xs text-ink-3">{k}</dt>
                    <dd className="font-mono text-lg leading-tight font-bold text-ink tabular-nums">{v}</dd>
                    <dd className={cn("text-xs", i === 0 && sum.failed ? "text-error" : "text-ink-3")}>{hint}</dd>
                  </div>
                ))}
              </dl>
              <Bars rows={rows} days={days} />
              <div className="grid gap-2 sm:grid-cols-2">
                <Breakdown title={t("Theo tính năng")} groups={groupBy(rows, (r) => feat(r.feature))} total={sum} />
                <Breakdown title={t("Theo model")} groups={groupBy(rows, (r) => shortModel(r.model))} total={sum} />
              </div>
              <p className="text-xs text-ink-3">{t("Chi phí quy đổi là giá token nếu trả theo API, không phải tiền bị trừ: gói Pro/Max/Team tính theo hạn mức.")}</p>
            </>
          )}
      </section>
    </>
  );
}

/** Requests per slot, oldest on the left: one per Vietnam day, or one per hour for the 24h period. Failed runs stack on top in red;
 *  hover or focus a bar for a one-line summary. */
function Bars({ rows, days }: { rows: AiRun[]; days: number }) {
  const t = useT();
  const now = useNow();
  const hourly = days === 1;
  const slots = useMemo(() => {
    const by = hourly ? bucket(rows, (r) => String(Math.floor(Date.parse(r.at) / HOUR))) : byVnDay(rows);
    const h0 = Math.floor(now / HOUR);
    return hourly
      ? Array.from({ length: 24 }, (_, i) => {
        const h = h0 - 23 + i;
        const at = clockLabel(new Date(h * HOUR).toISOString());
        return { key: String(h), label: at, long: `${at}–${clockLabel(new Date((h + 1) * HOUR).toISOString())}`, tot: totals(by.get(String(h)) ?? []) };
      })
      : Array.from({ length: days }, (_, i) => { const d = vnDay(now - (days - 1 - i) * 86_400_000); return { key: d, label: dm(d), long: `${weekday(d)}, ${dm(d)}`, tot: totals(by.get(d) ?? []) }; });
  }, [rows, days, hourly, now, t.lang]); // eslint-disable-line react-hooks/exhaustive-deps -- t.lang: the weekday names
  const top = Math.max(1, ...slots.map((s) => s.tot.n));
  const few = slots.length <= 7; // few enough bars to label each one
  const ends = [0, Math.floor(slots.length / 2), slots.length - 1];
  return (
    <figure className={cn(card, "gap-2 p-3")}>
      <figcaption className="flex items-center justify-between gap-2 text-xs text-ink-2">
        {hourly ? t("Request mỗi giờ") : t("Request mỗi ngày")}
        <span className="flex gap-3 text-ink-3">
          <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-sm bg-hl" />{t("Thành công")}</span>
          <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-sm bg-error" />{t("Lỗi")}</span>
        </span>
      </figcaption>
      <div className={cn("flex h-24 items-end", few ? "gap-2" : "gap-0.5")}>
        {slots.map(({ key, long, tot }, k) => {
          const summary = tot.n ? `${tot.n} request · ${usd(tot.cost)}${tot.failed ? ` · ${t("{n} lỗi", { n: tot.failed })}` : ""}` : t("Không có request");
          return (
            <span key={key} tabIndex={0} aria-label={`${long}: ${summary}`}
              className="group relative flex h-full flex-1 flex-col items-center justify-end rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus)">
              {few && tot.n > 0 && <span className="mb-0.5 font-mono text-2xs text-ink-2 tabular-nums">{tot.n}</span>}
              {tot.n ? (
                <span className="flex w-full max-w-9 flex-col overflow-hidden rounded-t-sm transition-opacity duration-(--dur-micro) group-hover:opacity-75" style={{ height: `${Math.max(6, (tot.n / top) * 100)}%` }}>
                  {tot.failed > 0 && <span className="bg-error" style={{ flex: tot.failed }} />}
                  <span className="bg-hl" style={{ flex: tot.n - tot.failed }} />
                </span>
              ) : <span className="h-0.5 w-full rounded-full bg-rule-2/60" />}
              <span role="tooltip"
                className={cn("pointer-events-none absolute bottom-full z-20 mb-1.5 grid w-max gap-0.5 rounded-md bg-ink px-2 py-1 text-2xs text-paper opacity-0 shadow-pop transition-[opacity,transform] duration-(--dur-short) ease-(--ease-out) translate-y-1 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
                  k < 2 ? "left-0" : k > slots.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2")}>
                <span className="font-bold first-letter:uppercase">{long}</span>
                <span className="font-mono tabular-nums opacity-85">{summary}</span>
              </span>
            </span>
          );
        })}
      </div>
      <span className={cn("flex font-mono text-2xs text-ink-3 tabular-nums", few ? "gap-2" : "justify-between")}>
        {few ? slots.map((s, k) => <span key={s.key} className="flex-1 text-center">{k === slots.length - 1 ? t("Hôm nay") : s.label}</span>)
          : ends.map((k) => <span key={k}>{k === slots.length - 1 ? (hourly ? t("Bây giờ") : t("Hôm nay")) : slots[k].label}</span>)}
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

const SIZES = [50, 100, 200, 500] as const;
const ROW = "grid grid-cols-[2.75rem_minmax(0,1fr)_3.25rem_3.75rem_2.75rem_0.875rem] items-center gap-x-2";
/** Each CLI with its short name (filters, the top-bar switch). */
export const AIS = [["claude", "Claude"], ["codex", "Codex"], ["antigravity", "Agy"]] as const;

/** Each request in the period, newest first, by AI (Claude / Codex / Agy), a page at a time, grouped by Vietnam day; a row
 *  opens its detail. The head (period, AI, page size, columns) and each day's line stay pinned while the list scrolls. */
export function HistoryTab({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  const t = useT();
  const runs = useRuns(days);
  const wait = useAiWait(!runs.data && !runs.isError);
  const [ai, setAi] = useState<Provider | "">("");
  const [size, setSize] = useState<number>(SIZES[0]);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [headH, setHeadH] = useState(0);
  const head = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = head.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeadH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [runs.data]);
  const all = useMemo(() => runs.data ?? [], [runs.data]);
  const rows = useMemo(() => (ai ? all.filter((r) => r.provider === ai) : all), [all, ai]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages - 1);
  const sum = totals(rows);
  const byDay = useMemo(() => byVnDay(rows), [rows]); // a day's totals count all its rows, not just this page's
  const shown = useMemo(() => [...byVnDay(rows.slice(at * size, (at + 1) * size))], [rows, at, size]);
  const today = vnDay(useNow());
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); setOpen(null); };
  const go = (n: number) => { setPage(n); setOpen(null); document.getElementById("ai-tabpanel")?.scrollTo({ top: 0 }); };
  const exportRows = () => downloadCsv([
    [t("Thời gian"), "AI", t("Tính năng"), t("Dự án (ngoài app)"), "Model", "Effort", t("Tự hạ model"), t("Thành công"), t("Lỗi"), t("Thời gian chạy (ms)"), "Input", "Output",
      t("Đọc cache"), t("Ghi cache"), t("Chi phí quy đổi (USD)"), t("5h % sau"), t("7 ngày % sau")],
    ...rows.map((r) => [r.at, r.provider, feat(r.feature), r.project, r.model, r.effort, r.fallback ? t("có") : "", r.ok ? t("có") : t("không"), r.error ?? "", r.ms,
      r.input_tokens, r.output_tokens, r.cache_read, r.cache_write, r.cost ?? "", r.quota["5h"] ?? "", r.quota["1w"] ?? ""]),
  ], `ai-runs-${days}d.csv`);
  const count = (id: Provider) => all.filter((r) => r.provider === id).length;

  return (
    <section className="grid gap-3" style={{ "--hist-h": `${headH}px` } as React.CSSProperties}>
      <div ref={head} className="sticky -top-5 z-20 -mx-5 -mt-5 grid gap-2.5 border-b border-rule bg-paper/95 px-5 pt-5 pb-2 backdrop-blur-sm">
        <PeriodHead title={t("Lịch sử chạy")} days={days} setDays={reset(setDays)}>
          <Hint side="bottom" text={t("Xuất CSV những dòng của AI đang chọn")}>
            <Button variant="ghost" size="icon-xs" aria-label={t("Xuất CSV những dòng của AI đang chọn")} disabled={!rows.length} onClick={exportRows}><Download aria-hidden /></Button>
          </Hint>
        </PeriodHead>
        {runs.data && all.length > 0 && <>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <Segmented id="history-ai" label={t("Lọc theo AI")} value={ai} onChange={reset(setAi)}
              items={[{ value: "" as Provider | "", label: `${t("Tất cả")} · ${all.length}` },
                ...AIS.map(([id, name]) => ({ value: id as Provider | "", label: (
                  <span className="flex items-center gap-1"><AgentIcon provider={id} className="agent-still size-3.5" />{name} · {count(id)}</span>
                ) }))]} />
            <span className="flex items-center gap-1.5 text-xs text-ink-3">
              {t("Mỗi trang")}
              <Segmented id="history-size" label={t("Số dòng mỗi trang")} value={size} onChange={reset(setSize)} items={SIZES.map((n) => ({ value: n, label: String(n) }))} />
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
            <span className="text-ink-2">{rows.length} request</span>
            {rows.length > 0 && <>·<span className="font-mono tabular-nums">{kilo(sum.tokens)} token</span>·<span className="font-mono tabular-nums">{usd(sum.cost)}</span></>}
          </span>
          {rows.length > 0 && (
            <div aria-hidden className={cn(ROW, "px-3 text-2xs text-ink-3")}>
              <span>{t("Giờ")}</span><span>{t("Tính năng · model")}</span><span className="text-right">Token</span><span className="text-right">{t("Chi phí")}</span><span className="text-right">{t("Chạy")}</span><span />
            </div>
          )}
        </>}
      </div>

      {runs.isError ? runsError()
        : wait || !runs.data ? <AiFetching kind="runs" className="min-h-[40vh]" />
        : !all.length ? emptyRuns(days)
        : !rows.length ? <p className={cn(card, "text-sm text-ink-2")}>{t("{ai} chưa chạy request nào trong {period}.", { ai: AIS.find(([id]) => id === ai)?.[1] ?? "", period: periodName(days) })}</p>
        : (
          <>
            {shown.map(([d, rs]) => {
              const tot = totals(byDay.get(d) ?? rs);
              return (
                <section key={d} aria-label={`${weekday(d)} ${dm(d)}`} className="grid gap-1">
                  <h4 className="sticky z-10 -mx-5 flex items-baseline justify-between gap-3 bg-paper/95 px-5 py-1.5 text-xs backdrop-blur-sm" style={{ top: "calc(var(--hist-h) - 1.25rem)" }}>
                    <span className="font-bold text-ink first-letter:uppercase">{d === today ? t("Hôm nay") : weekday(d)}, {dm(d)}</span>
                    <span className="font-mono text-ink-3 tabular-nums">{tot.n} req · {usd(tot.cost)}</span>
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
            {pages > 1 && (
              <nav aria-label={t("Phân trang")} className="flex items-center justify-between gap-2 text-xs text-ink-3">
                <span className="font-mono tabular-nums">{at * size + 1}–{Math.min(rows.length, (at + 1) * size)} / {rows.length}</span>
                <span className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-xs" aria-label={t("Trang đầu")} disabled={at === 0} onClick={() => go(0)}><ChevronsLeft aria-hidden /></Button>
                  <Button variant="ghost" size="icon-xs" aria-label={t("Trang trước")} disabled={at === 0} onClick={() => go(at - 1)}><ChevronLeft aria-hidden /></Button>
                  <span className="px-1.5 font-mono text-ink-2 tabular-nums">{at + 1} / {pages}</span>
                  <Button variant="ghost" size="icon-xs" aria-label={t("Trang sau")} disabled={at >= pages - 1} onClick={() => go(at + 1)}><ChevronRight aria-hidden /></Button>
                  <Button variant="ghost" size="icon-xs" aria-label={t("Trang cuối")} disabled={at >= pages - 1} onClick={() => go(pages - 1)}><ChevronsRight aria-hidden /></Button>
                </span>
              </nav>
            )}
            <p className="text-xs text-ink-3">{t("Chi phí quy đổi là giá token nếu trả theo API, không phải tiền bị trừ. “Nhập lại”: lấy từ transcript trước khi có log này. Dòng có tên dự án: request gõ trong Claude Code / Claude Desktop / Codex trên máy này, đọc từ transcript của chúng (chỉ số liệu, không đọc nội dung); chưa có chi phí quy đổi.")}</p>
          </>
        )}
    </section>
  );
}

/** One request on one line (time, status, feature and model, tokens, cost, duration); opens its tokens, quota after the run and the error. */
function RunRow({ r, open, onToggle }: { r: AiRun; open: boolean; onToggle: () => void }) {
  const t = useT();
  const detail = ([
    ["Input", kilo(r.input_tokens)], ["Output", kilo(r.output_tokens)], [t("Đọc cache"), kilo(r.cache_read)], [t("Ghi cache"), kilo(r.cache_write)],
    ["Effort", r.effort ? effortLabel(r.effort as Effort) ?? r.effort : null], [t("Lượt"), r.turns ? String(r.turns) : null],
    [t("5h sau"), r.quota["5h"] != null ? `${Math.round(r.quota["5h"])}%` : null], [t("7 ngày sau"), r.quota["1w"] != null ? `${Math.round(r.quota["1w"])}%` : null],
  ] as [string, string | null][]).filter((x): x is [string, string] => x[1] != null);
  return (
    <li className={cn(!r.ok && "bg-error-wash/40")}>
      <button type="button" aria-expanded={open} onClick={onToggle}
        className={cn(ROW, "w-full px-3 py-2 text-left text-xs transition-colors duration-(--dur-micro) hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-focus)")}>
        <span className="font-mono text-ink-2 tabular-nums">{clockLabel(r.at)}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-label={r.ok ? t("Thành công") : t("Lỗi")} className={cn("size-1.5 shrink-0 rounded-full", r.ok ? "bg-ok" : "bg-error")} />
          <AgentIcon provider={r.provider as Provider} className="agent-still size-4 shrink-0" />
          <span className="shrink-0 font-medium text-ink">{feat(r.feature)}</span>
          <span className="min-w-0 truncate text-ink-3">{r.ok ? shortModel(r.model) : <span className="text-error">{r.error ?? t("Lỗi")}</span>}</span>
          {r.fallback && <span className="shrink-0 rounded bg-warn-wash px-1 text-ink">{t("hạ model")}</span>}
          {r.imported && <span className="shrink-0 rounded bg-paper-3 px-1 text-ink-3">{t("nhập lại")}</span>}
          {r.external && r.project && <span className="min-w-0 shrink truncate rounded bg-info-wash px-1 text-info">{r.project}</span>}
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
          <p className="flex flex-wrap gap-x-3 text-ink-3"><span>{timeLabel(r.at, true)}</span><span className="font-mono">{tMaybe(r.model)}</span></p>
        </div>
      )}
    </li>
  );
}

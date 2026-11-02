"use client";

import { AlertTriangle, FileText, MessageCircleQuestion, ScrollText, Sparkles } from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useNow } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { dm, fmt, QUICK, shortName, shortSp, stateColor, type Ticket, yt } from "@/lib/yt";
import { AGE, dashStats, reportData, type Stats } from "@/lib/yt-stats";
import { AiBox, Card, MultiSelect, Person, StatePill, useAi } from "./bits";
import { useYt } from "./state";
import { aiReview } from "./tickets";

// The bento dashboard: what needs someone first, then sprint figures, speed, load, bugs. Every number opens its tickets.

export function useStats() {
  const y = useYt();
  const agingSet = useMemo(() => new Set(y.agingStates), [y.agingStates]);
  const now = useNow();
  const d = useMemo(() => dashStats({
    rows: y.rows, f: y.filters, sprints: y.sprints, latestSprint: y.sprintOptions[0] ?? null, range: y.range,
    hist: y.config?.hist ?? 0, aging: agingSet, since: y.since, now,
  }), [y.rows, y.filters, y.sprints, y.sprintOptions, y.range, y.config?.hist, agingSet, y.since, now]);
  const { loadSince } = y;
  useEffect(() => { if (d.aging.need.length) loadSince(d.aging.need); }, [d.aging.need, loadSince]);
  return d;
}

/** Open the tickets behind a number. */
const useDrill = (d: Stats) => {
  const y = useYt();
  return (key: string, arg?: string) => { const r = d.detail(key, arg); if (r) y.setSheet({ kind: "list", title: r[0], rows: r[1] }); };
};

export function DashboardPage() {
  const y = useYt();
  const d = useStats();
  const drill = useDrill(d);
  return (
    <div className="grid grid-cols-12 gap-3">
      <Section title="Cần xử lý" />
      <Card title="Cần chú ý" meta="ticket đang mở" className="col-span-12 lg:col-span-5"><Attention d={d} /></Card>
      <Card title="Cảnh báo ticket kéo dài" className="col-span-12 lg:col-span-7"><Aging d={d} /></Card>

      <Section title="Tổng quan sprint">
        {y.aiOn && <DashAi d={d} />}
      </Section>
      <Kpis d={d} />
      <Card title="Tiến độ sprint" meta="vạch dọc = thời gian đã qua" className="col-span-12 lg:col-span-6"><Progress d={d} /></Card>
      <Card title="Burndown sprint" className="col-span-12 lg:col-span-6"
        meta={<span className="flex gap-3"><Lg c="var(--color-hl)">thực tế</Lg><Lg c="var(--color-ink-3)" dash>lý tưởng</Lg><Lg c="var(--color-hl-2)" dash>dự báo</Lg></span>}><Burn d={d} /></Card>

      <Section title="Tốc độ" />
      <Card title="Velocity" meta={d.vel.avg == null ? "" : `TB ${fmt(d.vel.avg)} ticket / sprint`} className="col-span-12 lg:col-span-6">
        <HBars rows={d.vel.rows.map((r) => ({ label: <>{shortSp(r.name)}{r.running && <span className="text-ink-3"> (đang chạy)</span>}</>, v: r.n, c: r.running ? "var(--color-ink-3)" : "var(--color-hl)", on: () => drill("vel", r.name) }))} empty="Chưa có sprint có ngày bắt đầu / kết thúc." />
      </Card>
      <Card title="Lead time" meta={`${fmt(d.lead.n)} ticket, ${d.days.length} ngày qua`} onMeta={() => drill("lead")} className="col-span-12 lg:col-span-6"><Lead d={d} /></Card>

      <Section title="Tải công việc & luồng làm việc" />
      <Card title="Công việc đang làm" className="col-span-12 md:col-span-6 xl:col-span-4"
        meta={<label className="flex items-center gap-1">ngưỡng WIP <select value={y.wip} onChange={(e) => y.setWip(+e.target.value)} className="h-6 rounded border border-rule bg-cotton px-1">{[2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>}>
        <Wip d={d} />
      </Card>
      <Card title="Chờ QC theo người" className="col-span-12 md:col-span-6 xl:col-span-4">
        <HBars rows={d.qcLoad.map(([n, c]) => ({ label: n === "Chưa có QC" ? n : <Person name={n} />, v: c, c: "var(--color-hl)", on: () => drill("qcl", n) }))} empty="Không có ticket chờ QC." />
      </Card>
      <Card title="Ticket đang mở theo state" className="col-span-12 xl:col-span-4">
        <HBars rows={d.dist.map(([s, n]) => ({ label: s, v: n, c: stateColor(s), on: () => drill("dist", s) }))} empty="Không có ticket mở." />
      </Card>
      <Card title="Ticket xong mỗi ngày" className="col-span-12 lg:col-span-6"
        meta={<select value={y.range} onChange={(e) => y.setRange(+e.target.value)} aria-label="Khoảng thời gian biểu đồ" className="h-6 rounded border border-rule bg-cotton px-1">{[7, 14, 30].map((n) => <option key={n} value={n}>{n} ngày</option>)}</select>}>
        <Columns days={d.days} series={[{ v: d.thru, c: "var(--color-hl)", on: (k) => drill("thru", String(k)) }]} /><BulkNote d={d} />
      </Card>
      <Card title="Ticket chuyển sprint nhiều lần" meta={`${fmt(d.carry.length)} ticket`} onMeta={() => drill("carry")} className="col-span-12 lg:col-span-6"><Carry d={d} /></Card>

      <Section title="Bug" />
      <Card title="Bug trong sprint" className="col-span-12 md:col-span-4">
        <button type="button" onClick={() => drill("bugs")} className="grid justify-items-start gap-2 text-left">
          <span className="flex items-baseline gap-2"><b className="font-mono text-3xl tabular-nums"><Count n={d.bug.sp} /></b><span className="text-sm text-ink-3">bug trong sprint</span></span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
            <Lg c="var(--color-error)">Đang mở <b>{fmt(d.bug.spOpen)}</b></Lg><Lg c="var(--color-ink-3)">Đã xong <b>{fmt(d.bug.sp - d.bug.spOpen)}</b></Lg>
            <span className="text-ink-3">Mở toàn project: {fmt(d.bug.open)}</span>
          </span>
        </button>
      </Card>
      <Card title="Bug mới và đã sửa" meta={<span className="flex gap-3"><Lg c="var(--color-error)">mới</Lg><Lg c="var(--color-ink-3)">đã sửa</Lg></span>} className="col-span-12 md:col-span-8">
        <Columns days={d.days} series={[{ v: d.bugNew, c: "var(--color-error)", on: (k) => drill("bugnew", String(k)) }, { v: d.bugFix, c: "var(--color-ink-3)", on: (k) => drill("bugfix", String(k)) }]} />
      </Card>
      <Card title="Bug của user" meta={<span className="flex gap-3"><Lg c="var(--color-error)">mở</Lg><Lg c="var(--color-ink-3)">xong</Lg></span>} className="col-span-12">
        <Stack rows={d.bug.spUser.map(([n, [o, x]]) => ({ label: n === "Chưa assign" ? n : <Person name={n} />, parts: [[o, "var(--color-error)"], [x, "var(--color-ink-3)"]], text: `${o}${x ? ` / ${x}` : ""}`, on: () => drill("bugu", n) }))} empty="Sprint này chưa có bug." />
      </Card>

      <Section title="Khác" />
      <Card title="Chưa sẵn sàng vào sprint" meta={`${fmt(d.ready.n)} ticket mở`} className="col-span-12 lg:col-span-6">
        <HBars max={d.ready.n} rows={d.ready.rows.map(([l, n]) => ({ label: l, v: n, c: n ? "var(--color-warn)" : "var(--color-ok)", on: () => drill("ready", l) }))} empty="" />
      </Card>
      <Card title="Bug so với Feature" meta="xong trong sprint" className="col-span-12 lg:col-span-6"><Mix d={d} /></Card>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="col-span-12 mt-3 flex flex-wrap items-center gap-2 first:mt-0">
    <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h2>
    {children && <div className="ml-auto flex flex-wrap gap-1.5">{children}</div>}
  </div>
);
const Lg = ({ c, dash, children }: { c: string; dash?: boolean; children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1"><u className={cn("inline-block h-0.5 w-3 no-underline", dash && "bg-[length:4px_2px] bg-repeat-x")}
    style={dash ? { backgroundImage: `linear-gradient(90deg, ${c} 50%, transparent 50%)` } : { background: c }} />{children}</span>
);

/** Counts from the previous value to the new one. */
function Count({ n, suffix = "" }: { n: number | null; suffix?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => fmt(Math.round(v)) + suffix);
  useEffect(() => { if (n != null) { const c = animate(mv, n, { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }); return () => c.stop(); } }, [n, mv]);
  return n == null ? <>—</> : <motion.span>{text}</motion.span>;
}

const SEV = { bad: 0, warn: 1 };
function Attention({ d }: { d: Stats }) {
  const drill = useDrill(d);
  const ranked = [...d.attn].sort((a, b) => +!a.n - +!b.n || SEV[a.sev] - SEV[b.sev] || b.n - a.n);
  return (
    <div className="grid gap-1.5">
      {ranked.map(({ q, sev, n }) => (
        <motion.button layout key={q} type="button" onClick={() => drill("q", q)} title="Xem danh sách ticket"
          className={cn("flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors duration-(--dur-micro)",
            !n ? "bg-paper-2 text-ink-3" : sev === "bad" ? "bg-error-wash text-error hover:bg-error-wash/70" : "bg-warn-wash text-warn hover:bg-warn-wash/70")}>
          <span className={cn(n && "font-medium")}>{QUICK[q].label}</span><b className="font-mono tabular-nums">{fmt(n)}</b>
        </motion.button>
      ))}
    </div>
  );
}

function Aging({ d }: { d: Stats }) {
  const y = useYt();
  const drill = useDrill(d);
  const { rows, need, states } = d.aging, bad = rows.filter((x) => x.d > AGE.bad).length, SHOW = 8;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect label="State" all="Chọn state" search={false} options={states.map(([s]) => s)} value={y.agingStates} onChange={y.setAgingStates} />
        <button type="button" onClick={() => drill("aging")} className="flex gap-1.5 text-xs">
          <span className="rounded-full bg-error-wash px-2 py-0.5 font-medium text-error">{bad} đỏ</span>
          <span className="rounded-full bg-warn-wash px-2 py-0.5 font-medium text-warn">{rows.length - bad} vàng</span>
        </button>
        <span className="text-xs text-ink-3">Ở cùng state từ {AGE.warn} ngày: vàng, quá {AGE.bad} ngày: đỏ</span>
      </div>
      <TicketRows rows={rows.slice(0, SHOW).map(({ i, d: age }) => ({ i, right: <Age days={age} /> }))} all={rows.map((r) => r.i)}
        more={rows.length > SHOW ? () => drill("aging") : undefined} moreN={rows.length - SHOW}
        empty={need.length && y.sinceBusy ? "Đang tải thời gian đổi state…" : "Không có ticket nào ở state này quá ngưỡng."} />
    </div>
  );
}
const Age = ({ days }: { days: number }) => {
  const bad = days > AGE.bad;
  return <span className={cn("inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap", bad ? "font-semibold text-error" : "text-warn")}>{bad && <AlertTriangle className="size-3" />}{days.toFixed(1)} ngày</span>;
};

/** Compact ticket rows (aging, carry-over): id + who, state, a right-hand figure. */
function TicketRows({ rows, all, empty, more, moreN }: { rows: { i: Ticket; right: React.ReactNode }[]; all: Ticket[]; empty: string; more?: () => void; moreN?: number }) {
  const y = useYt();
  if (!rows.length) return <p className="text-sm text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-rule">
      {rows.map(({ i, right }) => (
        <li key={i.id}>
          <button type="button" onClick={() => y.openTicket(i.id, all)} className="grid w-full grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-left hover:bg-paper-2">
            <span className="grid"><b className="font-mono text-xs">{i.id}</b><span className="truncate text-xs text-ink-3">{i.assignee ? shortName(i.assignee) : "Chưa assign"}</span></span>
            <span className="min-w-0 truncate"><StatePill state={i.state} /></span>
            {right}
          </button>
        </li>
      ))}
      {more && <li><button type="button" onClick={more} className="w-full py-1.5 text-left text-xs text-ink-3 hover:text-ink">… và {moreN} ticket nữa, xem tất cả</button></li>}
    </ul>
  );
}

function Kpis({ d }: { d: Stats }) {
  const drill = useDrill(d);
  const delta = d.per.prev && d.prevTotal ? Math.round((d.total - d.prevTotal) / d.prevTotal * 100) : null;
  const cards: [string, number | null, string, string, React.ReactNode?][] = [
    ["Ticket trong sprint", d.total, "", "total", <span key="s" className="flex flex-wrap gap-x-2 text-xs text-ink-3"><span>{d.per.label}</span>
      {d.per.prev && <span>trước: {shortSp(d.per.prev)} ({fmt(d.prevTotal)})</span>}{delta != null && <span>{delta > 0 ? "+" : delta < 0 ? "−" : ""}{Math.abs(delta)}%</span>}</span>],
    ["Đang làm", d.doing, "", "doing"], ["Chờ QC", d.qc, "", "qc"], ["Tỉ lệ xong sprint", d.doneRate, "%", "rate"],
  ];
  return (
    <div className="col-span-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(([l, v, s, k, extra]) => (
        <motion.button key={k} type="button" onClick={() => drill(k)} whileHover={{ y: -2 }} title="Xem danh sách ticket"
          className="grid content-start justify-items-start gap-1 rounded-[var(--radius-card)] bg-cotton p-4 text-left shadow-stock">
          <span className="text-xs text-ink-3">{l}</span><b className="font-mono text-3xl font-medium tabular-nums"><Count n={v} suffix={s} /></b>{extra}
        </motion.button>
      ))}
    </div>
  );
}

function Progress({ d }: { d: Stats }) {
  const drill = useDrill(d);
  if (!d.prog.length) return <p className="text-sm text-ink-3">Không có dữ liệu sprint</p>;
  return (
    <div className="grid gap-4">
      {d.prog.map((r) => {
        const p = r.t ? Math.round(r.d / r.t * 100) : 0, w = (n: number) => (r.t ? n / r.t * 100 : 0);
        const diff = r.time == null ? null : p - r.time;
        const st = p === 100 && r.t ? ["ok", "Hoàn thành"] : diff == null ? null : diff >= 0 ? ["ok", "Đúng tiến độ"] : diff > -15 ? ["warn", "Hơi chậm"] : ["bad", "Chậm tiến độ"];
        return (
          <button key={r.name} type="button" onClick={() => drill("sp", r.name)} className="grid gap-1.5 text-left" title="Xem danh sách ticket của sprint này">
            <span className="flex justify-between text-sm"><span className="font-medium">{r.name}</span><span className="font-mono text-xs text-ink-2 tabular-nums">{r.d}/{r.t} · {p}%</span></span>
            <span className="relative flex h-2.5 overflow-hidden rounded-full bg-paper-3">
              {[[r.d, "var(--color-ok)"], [r.qc, "var(--st-qc)"], [r.doing, "var(--st-doing)"]].map(([n, c], k) => (
                <motion.i key={k} className="h-full" style={{ background: c as string }} initial={{ width: 0 }} animate={{ width: `${w(n as number)}%` }} transition={{ duration: 0.5, delay: k * 0.05 }} />
              ))}
              {r.time != null && <u className="absolute inset-y-[-2px] w-0.5 bg-ink" style={{ left: `${r.time}%` }} title={`Thời gian sprint đã qua ${r.time}%`} />}
            </span>
            <span className="flex flex-wrap justify-between gap-2 text-xs text-ink-3">
              <span className="flex flex-wrap gap-x-3"><Lg c="var(--color-ok)">Xong {r.d}</Lg><Lg c="var(--st-qc)">QC {r.qc}</Lg><Lg c="var(--st-doing)">Đang làm {r.doing}</Lg><Lg c="var(--color-rule-2)">Todo {r.todo}</Lg></span>
              <span className="flex gap-2">
                {r.left != null && <span>{r.left ? `còn ${r.left} ngày` : "đã kết thúc"}</span>}
                {st && <span className={cn("rounded-full px-2 font-medium", st[0] === "ok" ? "bg-ok-wash text-ok" : st[0] === "warn" ? "bg-warn-wash text-warn" : "bg-error-wash text-error")}>{st[1]}</span>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Burn({ d }: { d: Stats }) {
  const b = d.burn;
  if (!b) return <p className="text-sm text-ink-3">Chưa có ticket hoặc ngày bắt đầu/kết thúc của sprint.</p>;
  const W = 600, H = 200, L = 30, R = 10, T = 12, B = 24;
  const x = (k: number) => L + (W - L - R) * (b.n > 1 ? k / (b.n - 1) : 0), yv = (v: number) => T + (H - T - B) * (1 - v / b.total);
  const last = b.actual.length - 1, end = b.n - 1, left = last >= 0 ? b.actual[last] : 0, pk = b.proj == null ? null : Math.min(b.proj, end);
  const pts = b.actual.map((v, k) => `${x(k).toFixed(1)},${yv(v).toFixed(1)}`).join(" ");
  const note = last < 0 || !left ? (left === 0 && last >= 0 ? <span><b>Đã xong hết</b> ticket của sprint</span> : null)
    : b.proj == null ? <span>Chưa đóng được ticket nào, <b>chưa dự báo được</b></span>
    : b.proj <= end ? <span>Dự báo xong: <b>{dm(b.start + Math.ceil(b.proj) * 864e5)}</b>, kịp sprint</span>
    : <span>Cuối sprint dự kiến còn <b>~{Math.round(left - b.rate * (end - last))} ticket</b></span>;
  return (
    <div className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Burndown: còn ${left} / ${b.total} ticket`} className="w-full text-[11px]">
        <g stroke="var(--color-rule)"><line x1={L} x2={W - R} y1={yv(0)} y2={yv(0)} /><line x1={L} x2={L} y1={T} y2={yv(0)} /></g>
        <g fill="var(--color-ink-3)">
          <text x={L - 4} y={T + 4} textAnchor="end">{b.total}</text><text x={L - 4} y={yv(0) + 4} textAnchor="end">0</text>
          <text x={L} y={H - 6}>{dm(b.start)}</text><text x={W - R} y={H - 6} textAnchor="end">{dm(b.start + end * 864e5)}</text>
        </g>
        <line x1={x(0)} y1={yv(b.total)} x2={x(end)} y2={yv(0)} stroke="var(--color-ink-3)" strokeDasharray="4 4" />
        {pk != null && last >= 0 && last < end && left > 0 && <line x1={x(last)} y1={yv(left)} x2={x(pk)} y2={yv(Math.max(0, left - b.rate * (pk - last)))} stroke="var(--color-hl-2)" strokeDasharray="4 4" strokeWidth={2} />}
        {last >= 0 && <>
          <motion.polyline points={pts} fill="none" stroke="var(--color-hl)" strokeWidth={2.5} strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
          <circle cx={x(last)} cy={yv(left)} r={4} fill="var(--color-hl)" />
          <text x={x(last)} y={yv(left) - 8} textAnchor="middle" fill="var(--color-ink)">{left}</text>
        </>}
      </svg>
      <div className="flex flex-wrap gap-x-4 text-xs text-ink-2">{note}{b.added > 0 && <span>+<b>{b.added}</b> ticket thêm sau khi sprint bắt đầu</span>}</div>
    </div>
  );
}

function Columns({ days, series }: { days: number[]; series: { v: number[]; c: string; on: (k: number) => void }[] }) {
  const W = 600, H = 170, L = 6, B = 22, T = 16, max = Math.max(1, ...series.flatMap((s) => s.v)), gw = (W - L * 2) / days.length, bw = gw * 0.7 / series.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" className="w-full text-[11px]">
      <line x1={L} x2={W - L} y1={H - B} y2={H - B} stroke="var(--color-rule)" />
      {days.map((t, k) => (
        <g key={t}>
          {series.map((s, si) => {
            const v = s.v[k], h = (H - B - T) * v / max, xx = L + k * gw + gw * 0.15 + si * bw;
            return v ? (
              <g key={si} className="cursor-pointer" onClick={() => s.on(k)}>
                <motion.rect x={xx} width={bw - 1} rx={2} fill={s.c} initial={{ y: H - B, height: 0 }} animate={{ y: H - B - h, height: h }} transition={{ duration: 0.4, delay: k * 0.01 }} className="hover:opacity-80" />
                <text x={xx + bw / 2} y={H - B - h - 3} textAnchor="middle" fill="var(--color-ink-2)">{v}</text>
              </g>
            ) : null;
          })}
          <text x={L + k * gw + gw / 2} y={H - 6} textAnchor="middle" fill="var(--color-ink-3)">{new Date(t).getDate()}</text>
        </g>
      ))}
    </svg>
  );
}

type Bar = { label: React.ReactNode; v: number; c: string; on: () => void };
function HBars({ rows, empty, max }: { rows: Bar[]; empty: string; max?: number }) {
  const m = max ?? Math.max(0, ...rows.map((r) => r.v));
  return <Stack rows={rows.map((r) => ({ label: r.label, parts: [[r.v, r.c]], text: String(r.v), on: r.on }))} max={m} empty={empty} />;
}
function Stack({ rows, empty, max }: { rows: { label: React.ReactNode; parts: [number, string][]; text: string; on: () => void }[]; empty: string; max?: number }) {
  const m = Math.max(1, max ?? Math.max(0, ...rows.map((r) => r.parts.reduce((s, [n]) => s + n, 0))));
  if (!rows.length) return empty ? <p className="text-sm text-ink-3">{empty}</p> : null;
  return (
    <div className="grid gap-1">
      {rows.map((r, k) => (
        <button key={k} type="button" onClick={r.on} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2.5rem] items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-paper-2">
          <span className="min-w-0 truncate">{r.label}</span>
          <span className="flex h-2 overflow-hidden rounded-full bg-paper-3">
            {r.parts.map(([n, c], j) => <motion.i key={j} className="h-full" style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${n / m * 100}%` }} transition={{ duration: 0.45 }} />)}
          </span>
          <em className="text-right font-mono text-xs text-ink-2 not-italic tabular-nums">{r.text}</em>
        </button>
      ))}
    </div>
  );
}

const ddays = (n: number | null) => (n == null ? "—" : n < 1 ? "< 1 ngày" : `${n.toFixed(n < 10 ? 1 : 0)} ngày`);
const KIND: Record<string, [string, string]> = { bug: ["Bug", "var(--color-error)"], feat: ["Feature", "var(--st-dev)"], task: ["Task khác", "var(--color-ink-3)"] };
function Lead({ d }: { d: Stats }) {
  const drill = useDrill(d);
  const l = d.lead;
  if (!l.n) return <><p className="text-sm text-ink-3">Chưa có ticket xong trong khoảng này.</p><BulkNote d={d} /></>;
  const max = Math.max(0, ...l.kinds.map((k) => k[1] || 0));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-6"><span><b className="font-mono text-2xl">{ddays(l.med)}</b><span className="text-sm text-ink-3"> trung vị</span></span>
        <span className="text-sm text-ink-3">85% xong trong <b className="font-mono text-base text-ink">{ddays(l.p85)}</b></span></div>
      <Stack max={max} empty="" rows={l.kinds.filter((k) => k[2]).map(([k, m, n]) => ({ label: <>{KIND[k][0]} <span className="text-ink-3">({n})</span></>, parts: [[m ?? 0, KIND[k][1]]], text: ddays(m), on: () => drill("lead") }))} />
      <BulkNote d={d} />
    </div>
  );
}
const BulkNote = ({ d }: { d: Stats }) => (d.bulk.length ? <p className="text-xs text-ink-3">Bỏ qua {d.bulk.map(([t, n]) => `${fmt(n)} ticket đóng hàng loạt ngày ${dm(t)}`).join(", ")}</p> : null);

function Wip({ d }: { d: Stats }) {
  const y = useYt();
  const drill = useDrill(d);
  if (!d.wip.length) return <p className="text-sm text-ink-3">Không có ticket đang làm.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-ink-3"><tr><th className="py-1 font-medium">Người</th><th className="font-medium">Đang làm</th><th className="font-medium">Blocked</th></tr></thead>
      <tbody>
        {d.wip.map(([p, [n, b]]) => (
          <tr key={p} tabIndex={0} onClick={() => drill("wip", p)} onKeyDown={(e) => { if (e.key === "Enter") drill("wip", p); }} className="cursor-pointer border-t border-rule hover:bg-paper-2">
            <td className="py-1.5">{p === "Chưa assign" ? p : <Person name={p} />}</td>
            <td><span className={cn("inline-flex items-center gap-1 font-mono", n > y.wip && "font-semibold text-error")}>{n}{n > y.wip && <span className="inline-flex items-center gap-0.5 font-sans text-xs"><AlertTriangle className="size-3" />vượt ngưỡng</span>}</span></td>
            <td>{b ? <span className="font-mono font-semibold text-error">{b}</span> : <span className="font-mono text-ink-3">0</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Carry({ d }: { d: Stats }) {
  const drill = useDrill(d);
  return (
    <TicketRows rows={d.carry.slice(0, 8).map((i) => ({ i, right: <span className={cn("inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap", i.sprints.length > 2 ? "font-semibold text-error" : "text-warn")}>{i.sprints.length > 2 && <AlertTriangle className="size-3" />}{i.sprints.length} sprints</span> }))}
      all={d.carry} more={d.carry.length > 8 ? () => drill("carry") : undefined} moreN={d.carry.length - 8} empty="Không có ticket nào bị chuyển sprint nhiều lần." />
  );
}

function Mix({ d }: { d: Stats }) {
  const drill = useDrill(d);
  const { mix: mx, mixPrev: mp } = d;
  if (!mx.n) return <p className="text-sm text-ink-3">Chưa có ticket xong trong sprint.</p>;
  const pc = (v: number) => Math.round(v / mx.n * 100);
  const prevBug = mp.n ? mp.m.bug / mp.n : 0, bugDelta = prevBug ? Math.round((mx.m.bug / mx.n - prevBug) / prevBug * 100) : null;
  return (
    <div className="grid gap-3">
      <div className="flex h-3 overflow-hidden rounded-full">
        {(["bug", "feat", "task"] as const).map((k) => <motion.i key={k} className="h-full" style={{ background: KIND[k][1] }} initial={{ width: 0 }} animate={{ width: `${pc(mx.m[k])}%` }} transition={{ duration: 0.5 }} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(["bug", "feat", "task"] as const).map((k) => (
          <button key={k} type="button" onClick={() => drill("mix", k)} className="hover:text-hl-2">
            <Lg c={KIND[k][1]}>{KIND[k][0]} <b>{fmt(mx.m[k])}</b> <span className="text-ink-3">{pc(mx.m[k])}%</span>
              {k === "bug" && bugDelta != null && <small className={cn("ml-1", bugDelta > 0 ? "text-error" : "text-ok")}>{bugDelta > 0 ? "+" : "−"}{Math.abs(bugDelta)}%</small>}</Lg>
          </button>
        ))}
      </div>
    </div>
  );
}

/** AI over the dashboard: sprint report, review of the open tickets, release notes, a question about the numbers. */
function DashAi({ d }: { d: Stats }) {
  const y = useYt();
  const [ask, setAsk] = useState(false);
  const panel = (title: string, label: string, run: (sig: AbortSignal) => Promise<{ text: string }>) => y.setSheet({ kind: "ai", title, label, run });
  return (
    <>
      <Button size="sm" variant="outline" title="AI viết báo cáo tiến độ, rủi ro, đề xuất từ số liệu dashboard (không gửi nội dung ticket)"
        onClick={() => panel(`Báo cáo sprint · ${d.per.label}`, "AI đang viết báo cáo", (sig) => yt.aiData("report", reportData(d, y.wip), sig))}><FileText /> Báo cáo sprint</Button>
      <Button size="sm" variant="outline" title="AI đọc chi tiết + bình luận + tin Telegram của các ticket đang mở trong sprint"
        onClick={() => aiReview(y, d.sprintOpen.map((i) => i.id), `${d.per.label} (ticket đang mở)`)}><Sparkles /> Rà soát ticket</Button>
      <Button size="sm" variant="outline" title="AI viết release notes từ các ticket đã xong trong sprint đang xem"
        onClick={() => d.doneRows.length ? panel(`Release notes · ${d.per.label}`, "AI đang viết release notes", (sig) => yt.aiData("notes", d.doneRows.slice(0, 300).map((i) => ({ id: i.id, type: i.type, summary: i.summary })), sig)) : toast({ text: "Sprint đang xem chưa có ticket xong" })}>
        <ScrollText /> Release notes</Button>
      <Button size="sm" variant="outline" aria-pressed={ask} onClick={() => setAsk(!ask)} title="Hỏi AI về số liệu dashboard"><MessageCircleQuestion /> Hỏi AI</Button>
      {ask && <AskAi d={d} />}
    </>
  );
}

/** "Sprint này ai đang quá tải?": answered from the dashboard numbers only. */
export function AskAi({ d, className }: { d: Stats; className?: string }) {
  const y = useYt();
  const ai = useAi();
  const [q, setQ] = useState("");
  function go() {
    const question = q.trim();
    if (!question) return;
    void ai.run({ label: "AI đang trả lời", run: (sig) => yt.aiData("ask", reportData(d, y.wip), sig, question) });
  }
  return (
    <div className={cn("grid w-full gap-2", className)}>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) go(); }} maxLength={500}
          placeholder="Hỏi về số liệu: vd. ai đang quá tải? ticket nào có nguy cơ trễ?" aria-label="Câu hỏi cho AI"
          className="h-9 flex-1 rounded-md border border-hl/40 bg-hl-wash/30 px-3 text-sm outline-none focus:border-hl" />
        <Button onClick={go} disabled={!q.trim() || ai.s.status === "busy"}>Hỏi</Button>
      </div>
      <AiBox ai={ai} />
    </div>
  );
}

export { Attention, Aging, Kpis, Wip };

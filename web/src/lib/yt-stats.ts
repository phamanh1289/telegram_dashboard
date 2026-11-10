// Dashboard numbers for the YouTrack module (pure, no DOM); ported from public/yt/js/stats.js.
import { fmtDay, type Key, t, tMaybe } from "@/lib/i18n";
import { bucket, byAs, bySp, DAY, type Filters, QUICK, shortSp, type Sprint, tagsOf, type Ticket } from "@/lib/yt";

export const AGE = { warn: 2, bad: 3 }; // days a ticket may sit in a watched state: > warn amber, > bad red
const ATTN = [["blocked", "bad"], ["critical", "bad"], ["overdue", "bad"], ["unassigned", "warn"], ["noest", "warn"], ["stale", "warn"]] as const;
const up = (s: string | null | undefined) => String(s || "—").toUpperCase();
const inSet = (set: Set<string>) => (i: Ticket) => i.sprints.some((s) => set.has(s));
const isBug = (i: Ticket) => i.type === "Bug";
export const kindOf = (i: Ticket) => (isBug(i) ? "bug" : ["Story", "Improvement", "Feature"].includes(i.type ?? "") ? "feat" : "task");
const day0 = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const lastDays = (n: number, now: number) => Array.from({ length: n }, (_, k) => day0(now) - (n - 1 - k) * DAY);
const perDay = (days: number[], rows: Ticket[], key: "resolved" | "created") => days.map((d) => rows.filter((i) => (i[key] ?? 0) >= d && (i[key] ?? 0) < d + DAY).length);
const pct = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
const BULK = 150; // ponytail: fixed threshold (team's normal max ≈ 50/day); make it relative to the median day if real days get close

export type StatsInput = {
  rows: Ticket[];
  f: Pick<Filters, "sprint" | "assignee" | "tier">;
  sprints: Map<string, Sprint>;
  latestSprint: string | null; // latest-used sprint name, when no dates are known
  range: number;
  hist: number;
  aging: Set<string>; // watched states, upper-case
  since: (i: Ticket) => number | null;
  now: number;
};

/** Sprints the KPIs are measured on: the selected ones, else the running one (else the latest started); prev = the one before. */
export function period({ sprints, f, latestSprint, now }: Pick<StatsInput, "sprints" | "f" | "latestSprint" | "now">) {
  const byStart = [...sprints].sort((a, b) => a[1].start - b[1].start);
  let names = [...f.sprint];
  if (!names.length) {
    const cur = byStart.filter(([, d]) => d.start <= now && now < d.finish + DAY);
    names = (cur.length ? cur : byStart.filter(([, d]) => d.start <= now).slice(-1)).map(([n]) => n);
    if (!names.length && latestSprint) names = [latestSprint];
  }
  const first = Math.min(...names.map((n) => sprints.get(n)?.start ?? Infinity));
  const prev = !names.length ? null : byStart.filter(([n, d]) => d.start < first && !names.includes(n)).slice(-1)[0]?.[0] ?? null;
  return { set: new Set(names), label: names.map(shortSp).join(", ") || "—", prev };
}

export function dashStats(x: StatsInput) {
  const { rows, f, sprints, now } = x;
  const as = byAs(f), sp = bySp(f);
  const per = period(x);
  const lens = (i: Ticket) => f.tier == null || bucket(i) === f.tier; // the tier narrows the KPI row, progress and WIP only
  const open = rows.filter((i) => !i.resolved && sp(i) && as(i));
  const openL = open.filter(lens);
  const cohort = rows.filter((i) => inSet(per.set)(i) && as(i) && lens(i));
  const work = [...openL, ...cohort.filter((i) => i.resolved)];
  const done = cohort.filter((i) => i.resolved);
  const bugs = rows.filter((i) => isBug(i) && as(i));
  const spBugs = bugs.filter(inSet(per.set));
  const openBugs = bugs.filter((i) => !i.resolved);
  const modOf = (i: Ticket) => tagsOf(i)[0] || "Không module";
  const days = lastDays(x.range, now);

  // bulk clean-ups (hundreds of old tickets closed on one day) would swamp lead time, velocity and the per-day chart
  const perDayDone = new Map<number, number>();
  for (const i of rows) if (i.resolved) perDayDone.set(day0(i.resolved), (perDayDone.get(day0(i.resolved)) || 0) + 1);
  const bulk = new Map([...perDayDone].filter(([, n]) => n >= BULK));
  const real = (i: Ticket) => !i.resolved || !bulk.has(day0(i.resolved));
  const recent = rows.filter((i) => i.resolved && i.resolved >= days[0] && as(i) && real(i));

  // tickets sitting in a watched state for too long; need = watched ones whose state-entry time is not loaded yet
  const agingRows: { i: Ticket; d: number }[] = [], need: Ticket[] = [], stCount: Record<string, number> = {};
  for (const i of open) {
    stCount[up(i.state)] = (stCount[up(i.state)] || 0) + 1;
    if (!x.aging.has(up(i.state))) continue;
    const t = x.since(i);
    if (t == null) need.push(i);
    else if ((now - t) / DAY >= AGE.warn) agingRows.push({ i, d: (now - t) / DAY });
  }
  for (const s of x.aging) stCount[s] ||= 0;
  agingRows.sort((a, b) => b.d - a.d);

  const carry = open.filter((i) => i.sprints.length >= 2).sort((a, b) => b.sprints.length - a.sprints.length || a.updated - b.updated);
  const finished = (set: Set<string>) => rows.filter((i) => i.resolved && inSet(set)(i) && as(i));
  const mixOf = (set: Set<string>) => { const m = { bug: 0, feat: 0, task: 0 }, r = finished(set); for (const i of r) m[kindOf(i)]++; return { m, n: r.length }; };

  // sprint progress, each measured sprint split by workflow bucket next to how much of its time has passed
  const prog = [...per.set].map((name) => {
    const r = { name, t: 0, todo: 0, doing: 0, qc: 0, d: 0, time: null as number | null, left: null as number | null, start: 0 };
    for (const i of cohort) if (i.sprints.includes(name)) { r.t++; r[(["todo", "doing", "qc", "d"] as const)[bucket(i)]]++; }
    const dt = sprints.get(name), len = dt ? dt.finish + DAY - dt.start : 0;
    if (dt && len > 0) {
      r.time = Math.max(0, Math.min(100, Math.round((now - dt.start) / len * 100)));
      r.left = Math.max(0, Math.ceil((dt.finish + DAY - now) / DAY));
      r.start = dt.start;
    }
    return r;
  }).sort((a, b) => a.start - b.start);

  // burndown of the measured sprint(s), with a forecast from the pace so far
  const burn = (() => {
    const bRows = rows.filter((i) => inSet(per.set)(i) && as(i));
    const ds = [...per.set].map((n) => sprints.get(n)).filter((d): d is Sprint => !!d);
    if (!ds.length || !bRows.length) return null;
    const start = day0(Math.min(...ds.map((d) => d.start))), n = Math.min(60, Math.round((day0(Math.max(...ds.map((d) => d.finish))) - start) / DAY) + 1), actual: number[] = [];
    for (let k = 0; k < n && start + k * DAY <= now; k++) actual.push(bRows.filter((i) => !i.resolved || i.resolved >= start + (k + 1) * DAY).length);
    const last = actual.length - 1, rate = last > 0 ? (actual[0] - actual[last]) / last : 0;
    return { start, n, total: bRows.length, actual, rate, proj: rate > 0 ? last + actual[last] / rate : null, added: bRows.filter((i) => i.created >= start + DAY).length };
  })();

  const vel = (() => {
    const from = x.hist ? now - x.hist * DAY : -Infinity;
    const sps = [...sprints.values()].filter((d) => d.start <= now && d.start >= from).sort((a, b) => a.start - b.start).slice(-6);
    const vr = sps.map((d) => ({ name: d.name, n: rows.filter((i) => i.resolved && real(i) && i.sprints.includes(d.name) && as(i)).length, running: now < d.finish + DAY }));
    const closed = vr.filter((r) => !r.running);
    return { rows: vr, avg: closed.length ? Math.round(closed.reduce((s, r) => s + r.n, 0) / closed.length) : null };
  })();

  const lead = (() => {
    const d = (i: Ticket) => (i.resolved! - i.created) / DAY, all = recent.map(d).sort((a, b) => a - b);
    const kinds = (["bug", "feat", "task"] as const).map((k) => { const a = recent.filter((i) => kindOf(i) === k).map(d).sort((p, q) => p - q); return [k, pct(a, 0.5), a.length] as const; });
    return { n: all.length, med: pct(all, 0.5), p85: pct(all, 0.85), kinds };
  })();

  const wip = Object.entries(openL.reduce<Record<string, [number, number]>>((acc, i) => {
    if (bucket(i) !== 1) return acc;
    const r = (acc[i.assignee || "Chưa assign"] ||= [0, 0]);
    r[0]++;
    if (up(i.state) === "BLOCKED") r[1]++;
    return acc;
  }, {})).sort((a, b) => b[1][0] - a[1][0]);

  const tally = (list: Ticket[], key: (i: Ticket) => string | null) => { const c: Record<string, number> = {}; for (const i of list) { const k = key(i); if (k) c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const bugUser = Object.entries(spBugs.reduce<Record<string, [number, number]>>((acc, i) => { (acc[i.assignee || "Chưa assign"] ||= [0, 0])[i.resolved ? 1 : 0]++; return acc; }, {}))
    .sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]) || b[1][0] - a[1][0]);
  const MISSING: Record<string, (i: Ticket) => boolean> = { "Chưa assign": (i) => !i.assignee, "Chưa có QC": (i) => !i.qc, "Chưa có priority": (i) => !i.priority, "Chưa có sprint": (i) => !i.sprints.length };
  const thruRows = rows.filter((i) => as(i) && real(i));

  /** The tickets behind a number: [title, rows]. */
  const detail = (key: string, arg = ""): [string, Ticket[]] | null => {
    const who = (a: string) => (i: Ticket) => (a === "Chưa assign" ? !i.assignee : i.assignee === a);
    const inDay = (list: Ticket[], k: "resolved" | "created", t: number) => list.filter((i) => (i[k] ?? 0) >= t && (i[k] ?? 0) < t + DAY);
    const dl = (at: number) => fmtDay(at);
    const R: Record<string, () => [string, Ticket[]]> = {
      total: () => [t("Ticket trong sprint: {s}", { s: per.label }), cohort],
      doing: () => [t("Đang làm"), work.filter((i) => bucket(i) === 1)],
      qc: () => [t("Chờ QC"), work.filter((i) => bucket(i) === 2)],
      rate: () => [t("Đã xong: {s} ({a}/{b})", { s: per.label, a: done.length, b: cohort.length }), done],
      q: () => [tMaybe(QUICK[arg].label), open.filter((i) => QUICK[arg].fn(i, now))],
      sp: () => [`Sprint ${arg}`, cohort.filter((i) => i.sprints.includes(arg))],
      wip: () => [t("Đang làm: {x}", { x: tMaybe(arg) }), openL.filter((i) => bucket(i) === 1 && who(arg)(i))],
      bugs: () => [t("Bug trong sprint: {s}", { s: per.label }), [...spBugs].sort((a, b) => +!!a.resolved - +!!b.resolved)],
      bugu: () => [`Bug: ${tMaybe(arg)}, ${per.label}`, spBugs.filter(who(arg))],
      qcl: () => [t("Chờ QC: {x}", { x: tMaybe(arg) }), open.filter((i) => bucket(i) === 2 && (i.qc || "Chưa có QC") === arg)],
      dist: () => [`State ${arg}`, open.filter((i) => up(i.state) === arg)],
      ready: () => [t("Ticket mở: {x}", { x: tMaybe(arg) }), open.filter(MISSING[arg])],
      mix: () => [t("Xong trong sprint: {x}", { x: arg === "task" ? t("Task khác") : arg === "bug" ? "Bug" : "Feature" }), finished(per.set).filter((i) => kindOf(i) === arg)],
      thru: () => [t("Ticket xong ngày {d}", { d: dl(days[+arg]) }), inDay(thruRows, "resolved", days[+arg])],
      bugnew: () => [t("Bug mới ngày {d}", { d: dl(days[+arg]) }), inDay(bugs, "created", days[+arg])],
      bugfix: () => [t("Bug đã sửa ngày {d}", { d: dl(days[+arg]) }), inDay(bugs, "resolved", days[+arg])],
      aging: () => [t("Ticket ở state quá ngưỡng"), agingRows.map((r) => r.i)],
      vel: () => [t("Xong trong sprint {x}", { x: arg }), rows.filter((i) => i.resolved && real(i) && i.sprints.includes(arg) && as(i))],
      lead: () => [t("Lead time: xong trong {n} ngày qua (lâu nhất trước)", { n: days.length }), recent.slice().sort((a, b) => b.resolved! - b.created - (a.resolved! - a.created))],
      carry: () => [t("Ticket chuyển sprint nhiều lần"), carry],
      bugp: () => [t("Bug đang mở: {x}", { x: arg }), openBugs.filter((i) => (i.priority || "—") === arg)],
      bugm: () => [t("Bug đang mở: {x}", { x: tMaybe(arg) }), openBugs.filter((i) => modOf(i) === arg)],
    };
    return R[key]?.() ?? null;
  };

  return {
    per,
    detail,
    total: cohort.length,
    prevTotal: per.prev ? rows.filter((i) => i.sprints.includes(per.prev!) && as(i) && lens(i)).length : 0,
    doing: work.filter((i) => bucket(i) === 1).length,
    qc: work.filter((i) => bucket(i) === 2).length,
    doneRate: cohort.length ? Math.round(done.length / cohort.length * 100) : null,
    doneRows: done,
    sprintRows: cohort,
    sprintOpen: cohort.filter((i) => !i.resolved),
    prog,
    attn: ATTN.filter(([q]) => q !== "noest" || rows.some((i) => i.estimate != null)).map(([q, sev]) => ({ q, sev, n: open.filter((i) => QUICK[q].fn(i, now)).length })),
    wip,
    aging: { rows: agingRows, need, states: Object.entries(stCount).sort((a, b) => b[1] - a[1]) },
    bug: { sp: spBugs.length, spOpen: spBugs.filter((i) => !i.resolved).length, open: bugs.filter((i) => !i.resolved).length, spUser: bugUser },
    burn,
    days,
    thru: perDay(days, thruRows, "resolved"),
    bulk: [...bulk].filter(([d]) => d >= days[0]),
    bugNew: perDay(days, bugs, "created"),
    bugFix: perDay(days, bugs, "resolved"),
    dist: tally(open, (i) => up(i.state)),
    qcLoad: tally(open.filter((i) => bucket(i) === 2), (i) => i.qc || "Chưa có QC"),
    bugPrio: tally(openBugs, (i) => i.priority || "—"),
    bugMod: tally(openBugs, modOf),
    ready: { n: open.length, rows: Object.entries(MISSING).map(([l, fn]) => [l as Key, open.filter(fn).length] as const) },
    carry,
    mix: mixOf(per.set),
    mixPrev: per.prev ? mixOf(new Set([per.prev])) : { m: { bug: 0, feat: 0, task: 0 }, n: 0 },
    vel,
    lead,
  };
}
export type Stats = ReturnType<typeof dashStats>;

/** What the AI sprint report reads: computed numbers only, no ticket text beyond titles. */
export function reportData(d: Stats, wipLimit: number) {
  const brief = (i: Ticket) => ({ id: i.id, summary: i.summary, state: i.state, assignee: i.assignee });
  return {
    sprint: d.per.label, previousSprint: d.per.prev, tickets: d.total, doing: d.doing, waitingQc: d.qc, doneRatePct: d.doneRate,
    sprints: d.prog.map((r) => ({ name: r.name, total: r.t, todo: r.todo, doing: r.doing, qc: r.qc, done: r.d, timeElapsedPct: r.time, daysLeft: r.left })),
    burndown: d.burn && { total: d.burn.total, left: d.burn.actual.at(-1), closedPerDay: +d.burn.rate.toFixed(2), sprintDays: d.burn.n, dayAllDone: d.burn.proj == null ? null : Math.ceil(d.burn.proj), addedAfterStart: d.burn.added },
    attention: Object.fromEntries(d.attn.map((a) => [QUICK[a.q].label, a.n])),
    wipLimit, wip: d.wip.map(([p, [n, b]]) => ({ person: p, doing: n, blocked: b })),
    aging: d.aging.rows.slice(0, 15).map(({ i, d: days }) => ({ ...brief(i), daysInState: +days.toFixed(1) })),
    carriedOver: d.carry.slice(0, 15).map((i) => ({ ...brief(i), sprints: i.sprints.length })),
    bugs: { inSprint: d.bug.sp, openInSprint: d.bug.spOpen, openInProject: d.bug.open },
    qcLoad: Object.fromEntries(d.qcLoad), openByState: Object.fromEntries(d.dist),
    velocityAvgPerSprint: d.vel.avg, leadTimeDays: { median: d.lead.med, p85: d.lead.p85 },
  };
}

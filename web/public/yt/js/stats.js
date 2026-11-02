/* ---------- Dashboard numbers (pure over state, no DOM) ---------- */
import { DAY, shortSp } from './util.js';
import { S, aging, sel, msItems, sprintDates } from './state.js';
import { BUCKET, QUICK } from './ticket.js';
import { byAs, bySp } from './query.js';

const ATTN = [['blocked', 'bad'], ['critical', 'bad'], ['overdue', 'bad'], ['unassigned', 'warn'], ['noest', 'warn']];
export const AGE = { warn: 2, bad: 3 }; // days a ticket may sit untouched while being worked / tested: > warn = amber, > bad = red
const inSet = (set) => (i) => i.sprints.some((s) => set.has(s));
const isBug = (i) => i.type === 'Bug';

// sprints the KPIs / progress / bugs are measured on: the selected ones, else the sprint running now (else the latest started); prev = the sprint before
export function period(now) {
  const byStart = [...sprintDates].sort((a, b) => a[1].start - b[1].start);
  let names = [...sel.sprint];
  if (!names.length) {
    const cur = byStart.filter(([, d]) => d.start <= now && now < d.finish + DAY);
    names = (cur.length ? cur : byStart.filter(([, d]) => d.start <= now).slice(-1)).map(([n]) => n);
    if (!names.length && msItems.sprint[0]) names = [msItems.sprint[0]]; // no dates available: latest-used sprint
  }
  const first = Math.min(...names.map((n) => sprintDates.get(n)?.start ?? Infinity));
  const prev = !names.length ? null : byStart.filter(([n, d]) => d.start < first && !names.includes(n)).slice(-1)[0]?.[0] ?? null;
  return { set: new Set(names), label: names.map(shortSp).join(', ') || '—', prev };
}

// sprint progress: each measured sprint split by workflow bucket, next to how much of its time has passed
function progressRows(tickets, per, now) {
  return [...per.set].map((name) => {
    const r = { name, t: 0, todo: 0, doing: 0, qc: 0, d: 0 };
    for (const i of tickets) if (i.sprints.includes(name)) { r.t++; r[['todo', 'doing', 'qc', 'd'][BUCKET(i)]]++; }
    const dt = sprintDates.get(name), len = dt ? dt.finish + DAY - dt.start : 0;
    r.time = len > 0 ? Math.max(0, Math.min(100, Math.round((now - dt.start) / len * 100))) : null; // % of the sprint's time elapsed
    r.left = len > 0 ? Math.max(0, Math.ceil((dt.finish + DAY - now) / DAY)) : null;
    r.start = dt?.start ?? 0;
    return r;
  }).sort((a, b) => a.start - b.start);
}

// work in progress per person: [doing, blocked]
function wipRows(open) {
  const rows = {};
  for (const i of open) {
    if (BUCKET(i) !== 1) continue;
    const r = (rows[i.assignee || 'Chưa assign'] ||= [0, 0]);
    r[0]++;
    if (String(i.state || '').toUpperCase() === 'BLOCKED') r[1]++;
  }
  return Object.entries(rows).sort((a, b) => b[1][0] - a[1][0]);
}

// tickets sitting in a watched state for longer than the thresholds, oldest first; need = watched tickets whose state-entry time is not loaded yet
const up = (s) => String(s || '—').toUpperCase();
function agingRows(open, now) {
  const rows = [], need = [];
  for (const i of open) {
    if (!aging.states.has(up(i.state))) continue;
    const e = aging.since.get(i.id);
    if (e && e.u === i.updated) { const d = (now - e.t) / DAY; if (d >= AGE.warn) rows.push({ i, d }); } else need.push(i);
  }
  const counts = {};
  for (const i of open) counts[up(i.state)] = (counts[up(i.state)] || 0) + 1;
  for (const s of aging.states) counts[s] ||= 0;
  return { rows: rows.sort((a, b) => b.d - a.d), need, states: Object.entries(counts).sort((a, b) => b[1] - a[1]) };
}

// bugs per person: [[name, open, done]] biggest first
function bugsByUser(bugs) {
  const rows = {};
  for (const i of bugs) (rows[i.assignee || 'Chưa assign'] ||= [0, 0])[i.resolved ? 1 : 0]++;
  return Object.entries(rows).sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1]) || b[1][0] - a[1][0]);
}

const day0 = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };

// bulk clean-ups (hundreds of old tickets closed on one day) would swamp lead time, velocity and the per-day chart: those days are left out
const BULK = 150; // ponytail: fixed threshold (team's normal max ≈ 50/day); make it relative to the median day if real days ever get close
let bulk = new Map(); // day start -> tickets resolved that day, only days >= BULK
const bulkDays = (rows) => { const c = new Map(); for (const i of rows) if (i.resolved) { const k = day0(i.resolved); c.set(k, (c.get(k) || 0) + 1); } return new Map([...c].filter(([, n]) => n >= BULK)); };
const real = (i) => !i.resolved || !bulk.has(day0(i.resolved));
const lastDays = (n, now) => Array.from({ length: n }, (_, k) => day0(now) - (n - 1 - k) * DAY); // start of each of the last n days, oldest first
const perDay = (days, rows, key) => days.map((d) => rows.filter((i) => i[key] >= d && i[key] < d + DAY).length);

// burndown of the measured sprint(s): tickets not yet resolved at the end of each day so far, against the straight line to 0
function burndown(rows, per, now) {
  const ds = [...per.set].map((n) => sprintDates.get(n)).filter(Boolean);
  if (!ds.length || !rows.length) return null;
  const start = day0(Math.min(...ds.map((d) => d.start))), n = Math.min(60, Math.round((day0(Math.max(...ds.map((d) => d.finish))) - start) / DAY) + 1), actual = [];
  for (let k = 0; k < n && start + k * DAY <= now; k++) actual.push(rows.filter((i) => !i.resolved || i.resolved >= start + (k + 1) * DAY).length);
  // forecast from the pace so far (tickets closed per day); added = scope creep, tickets created after the sprint's first day
  const last = actual.length - 1, rate = last > 0 ? (actual[0] - actual[last]) / last : 0;
  const proj = rate > 0 ? last + actual[last] / rate : null; // day index the line reaches 0
  return { start, n, total: rows.length, actual, rate, proj, added: rows.filter((i) => i.created >= start + DAY).length };
}

// tickets resolved per sprint, the last 6 sprints that have started (only those inside the server's history window)
function velocity(now) {
  const from = S.cfg.hist ? now - S.cfg.hist * DAY : -Infinity;
  const sp = [...sprintDates.values()].filter((d) => d.start <= now && d.start >= from).sort((a, b) => a.start - b.start).slice(-6);
  const rows = sp.map((d) => ({ name: d.name, n: S.full.filter((i) => i.resolved && real(i) && i.sprints.includes(d.name) && byAs(i)).length, running: now < d.finish + DAY }));
  const closed = rows.filter((r) => !r.running);
  return { rows, avg: closed.length ? Math.round(closed.reduce((s, r) => s + r.n, 0) / closed.length) : null };
}

// lead time = created -> resolved, in days, of tickets resolved in the chart range; median, P85 and per kind
const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
function leadTime(rows) {
  const d = (i) => (i.resolved - i.created) / DAY, all = rows.map(d).sort((a, b) => a - b);
  const kinds = ['bug', 'feat', 'task'].map((k) => { const a = rows.filter((i) => kindOf(i) === k).map(d).sort((x, y) => x - y); return [k, pct(a, 0.5), a.length]; });
  return { n: all.length, med: pct(all, 0.5), p85: pct(all, 0.85), kinds };
}

// state -> tickets (open work only), biggest workflow step last
function stateDist(open) {
  const c = {};
  for (const i of open) c[up(i.state)] = (c[up(i.state)] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}

// open tickets waiting for QC, per QC person
function qcLoad(open) {
  const c = {};
  for (const i of open) if (BUCKET(i) === 2) c[i.qc || 'Chưa có QC'] = (c[i.qc || 'Chưa có QC'] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}

// bug vs feature among tickets finished in the given sprint(s)
const kindOf = (i) => (isBug(i) ? 'bug' : ['Story', 'Improvement', 'Feature'].includes(i.type) ? 'feat' : 'task');
const finished = (set) => S.full.filter((i) => i.resolved && inSet(set)(i) && byAs(i));
function mixOf(set) {
  const m = { bug: 0, feat: 0, task: 0 }, r = finished(set);
  for (const i of r) m[kindOf(i)]++;
  return { m, n: r.length };
}

// the tickets behind each dashboard number (what the detail panel lists); `last` = inputs of the latest dashStats()
let last = null;
const MISSING = { 'Chưa assign': (i) => !i.assignee, 'Chưa có QC': (i) => !i.qc, 'Chưa có priority': (i) => !i.priority, 'Chưa có sprint': (i) => !i.sprints.length };
const dayLabel = (t) => new Date(t).toLocaleDateString('vi-VN');
export function detail(key, arg) {
  if (!last) return null;
  const { now, per, open, openL, cohort, work, done, bugs, spBugs, days, aging: ag, carry, recent } = last, lbl = per.label;
  const who = (a) => (i) => (a === 'Chưa assign' ? !i.assignee : i.assignee === a);
  const inDay = (rows, k, t) => rows.filter((i) => i[k] >= t && i[k] < t + DAY);
  const R = {
    total: () => [`Ticket trong sprint · ${lbl}`, cohort],
    doing: () => ['Đang làm', work.filter((i) => BUCKET(i) === 1)],
    qc: () => ['Chờ QC', work.filter((i) => BUCKET(i) === 2)],
    rate: () => [`Đã xong · ${lbl} (${done.length}/${cohort.length})`, done],
    q: () => [QUICK[arg].label, open.filter((i) => QUICK[arg].fn(i, now))],
    sp: () => [`Sprint ${arg}`, cohort.filter((i) => i.sprints.includes(arg))],
    wip: () => [`Đang làm · ${arg}`, openL.filter((i) => BUCKET(i) === 1 && who(arg)(i))],
    bugs: () => [`Bug trong sprint · ${lbl}`, [...spBugs].sort((a, b) => !!a.resolved - !!b.resolved)],
    bugu: () => [`Bug · ${arg} · ${lbl}`, spBugs.filter(who(arg))],
    qcl: () => [`Chờ QC · ${arg}`, open.filter((i) => BUCKET(i) === 2 && (i.qc || 'Chưa có QC') === arg)],
    dist: () => [`State ${arg}`, open.filter((i) => up(i.state) === arg)],
    ready: () => [`Ticket mở · ${arg}`, open.filter(MISSING[arg])],
    mix: () => [`Xong trong sprint · ${{ bug: 'Bug', feat: 'Feature', task: 'Task khác' }[arg]}`, finished(per.set).filter((i) => kindOf(i) === arg)],
    thru: () => [`Ticket xong ngày ${dayLabel(days[+arg])}`, inDay(S.full.filter((i) => byAs(i) && real(i)), 'resolved', days[+arg])],
    bugnew: () => [`Bug mới ngày ${dayLabel(days[+arg])}`, inDay(bugs, 'created', days[+arg])],
    bugfix: () => [`Bug đã sửa ngày ${dayLabel(days[+arg])}`, inDay(bugs, 'resolved', days[+arg])],
    aging: () => ['Ticket ở state quá ngưỡng', ag.rows.map((x) => x.i)],
    vel: () => [`Xong trong sprint ${arg}`, S.full.filter((i) => i.resolved && real(i) && i.sprints.includes(arg) && byAs(i))],
    lead: () => [`Lead time · xong trong ${days.length} ngày qua (lâu nhất trước)`, recent.slice().sort((a, b) => (b.resolved - b.created) - (a.resolved - a.created))],
    carry: () => ['Ticket chuyển sprint nhiều lần', carry],
  }[key];
  const r = R?.();
  return r && { title: r[0], rows: r[1] };
}

export function dashStats(now) {
  const per = period(now);
  // the tier filter narrows the KPI row, sprint progress and WIP table; the attention strip, aging, bugs and mix always show the whole picture
  const lens = (i) => S.tier == null || BUCKET(i) === S.tier;
  const open = S.full.filter((i) => !i.resolved && bySp(i) && byAs(i)); // every open ticket, whatever its age
  const openL = open.filter(lens);
  const cohort = S.full.filter((i) => inSet(per.set)(i) && byAs(i) && lens(i)); // tickets of the measured sprint(s)
  const work = [...openL, ...cohort.filter((i) => i.resolved)]; // open work (any age) + done tickets of the measured sprint(s)
  const done = cohort.filter((i) => i.resolved);
  const bugs = S.full.filter((i) => isBug(i) && byAs(i));
  const spBugs = bugs.filter(inSet(per.set));
  const days = lastDays(S.range, now), aging_ = agingRows(open, now), carry = open.filter((i) => i.sprints.length >= 2).sort((a, b) => b.sprints.length - a.sprints.length || a.updated - b.updated);
  bulk = bulkDays(S.full);
  const recent = S.full.filter((i) => i.resolved && i.resolved >= days[0] && byAs(i) && real(i)); // resolved within the chart range, bulk days left out
  last = { now, per, open, openL, cohort, work, done, bugs, spBugs, days, aging: aging_, carry, recent };
  return {
    per,
    total: cohort.length,
    prevTotal: per.prev ? S.full.filter((i) => i.sprints.includes(per.prev) && byAs(i) && lens(i)).length : 0,
    doing: work.filter((i) => BUCKET(i) === 1).length,
    qc: work.filter((i) => BUCKET(i) === 2).length,
    doneRate: cohort.length ? Math.round(done.length / cohort.length * 100) : null,
    doneRows: done, // AI release notes
    sprintOpen: cohort.filter((i) => !i.resolved), // AI review
    prog: progressRows(cohort, per, now),
    attn: ATTN.filter(([q]) => q !== 'noest' || S.full.some((i) => i.estimate != null)) // project without an Estimation field: the tile would flag everything
      .map(([q, sev]) => ({ q, sev, n: open.filter((i) => QUICK[q].fn(i, now)).length })),
    wip: wipRows(openL),
    aging: aging_,
    bug: { sp: spBugs.length, spOpen: spBugs.filter((i) => !i.resolved).length, open: bugs.filter((i) => !i.resolved).length, spUser: bugsByUser(spBugs) },
    burn: burndown(S.full.filter((i) => inSet(per.set)(i) && byAs(i)), per, now),
    days,
    thru: perDay(days, S.full.filter((i) => byAs(i) && real(i)), 'resolved'),
    bulk: [...bulk].filter(([d]) => d >= days[0]), // [[day, count]] left out of the charts in range
    bugNew: perDay(days, bugs, 'created'),
    bugFix: perDay(days, bugs, 'resolved'),
    dist: stateDist(open),
    qcLoad: qcLoad(open),
    ready: { n: open.length, rows: [['Chưa assign', open.filter((i) => !i.assignee).length], ['Chưa có QC', open.filter((i) => !i.qc).length], ['Chưa có priority', open.filter((i) => !i.priority).length], ['Chưa có sprint', open.filter((i) => !i.sprints.length).length]] },
    carry,
    mix: mixOf(per.set),
    mixPrev: per.prev ? mixOf(new Set([per.prev])) : { m: { bug: 0 }, n: 0 },
    vel: velocity(now),
    lead: leadTime(recent),
  };
}

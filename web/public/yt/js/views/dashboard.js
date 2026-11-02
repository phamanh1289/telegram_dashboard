/* ---------- Dashboard page (bento): KPIs, attention strip, sprint progress, aging alerts, work in progress, bugs, bug/feature mix ---------- */
import { $, esc, fmt, shortName, shortSp, reduce, toast } from '../util.js';
import { T, aging } from '../state.js';
import { loadSince, sinceLoading } from '../since.js';
import { QUICK, stateColor } from '../ticket.js';
import { AGE, dashStats } from '../stats.js';
import { morph, syncMix } from '../morph.js';
import { yt } from '../api.js';
import { dlt, person, stateSelect } from './cells.js';
import { ALERT } from './active.js';
import { openPanel } from '../ui/drawer.js';
import { aiInto, aiOn } from '../ui/ai.js';

const kpiPrev = []; // last value shown per KPI card, so numbers count from there

function renderKpis(d) {
  const sub = `<small class="sub"><span>${esc(d.per.label)}</span>${d.per.prev ? `<span>trước: ${esc(shortSp(d.per.prev))} (${fmt(d.prevTotal)})</span>` : ''}${dlt(d.total, d.prevTotal, null)}</small>`;
  const cards = [ // label, value, unit, detail key, extra html
    ['Ticket trong sprint', d.total, '', 'total', sub], ['Đang làm', d.doing, '', 'doing'],
    ['Chờ QC', d.qc, '', 'qc'], ['Tỉ lệ xong sprint', d.doneRate, '%', 'rate'],
  ];
  morph($('kpis'), cards.map(([l, v, s, b, extra]) => `<div class="kpi" role="button" tabindex="0" data-dd="${b}" title="Xem danh sách ticket"><span class="kl">${l}</span><b${v == null ? '>—' : ` data-n="${v}" data-s="${s}">0${s}`}</b>${extra || ''}</div>`).join(''));
  document.querySelectorAll('#kpis b[data-n]').forEach(countUp);
}

function countUp(el) { // count from the previous value to the new one
  const idx = [...$('kpis').children].indexOf(el.closest('.kpi')), to = +el.dataset.n, s = el.dataset.s, from = kpiPrev[idx] ?? 0;
  kpiPrev[idx] = to;
  if (reduce || from === to) { el.textContent = fmt(to) + s; return; }
  const t0 = performance.now();
  const step = (t) => { const p = Math.max(0, Math.min(1, (t - t0) / 600)); el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - p) ** 3))) + s; if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => { el.textContent = fmt(to) + s; }, 700); // final value even if the tab was in the background and rAF paused
}

// sprint progress: done / QC / doing segments, with a marker for how much of the sprint's time has passed
function renderSprints(d) {
  morph($('sprints'), d.prog.map((r) => {
    const p = r.t ? Math.round(r.d / r.t * 100) : 0, w = (n) => (r.t ? n / r.t * 100 : 0);
    const diff = r.time == null ? null : p - r.time;
    const st = p === 100 && r.t ? ['ok', 'Hoàn thành'] : diff == null ? null : diff >= 0 ? ['ok', 'Đúng tiến độ'] : diff > -15 ? ['warn', 'Hơi chậm'] : ['bad', 'Chậm tiến độ'];
    const time = r.time == null ? '' : `<u class="tm" style="left:${r.time}%" title="Thời gian sprint đã qua ${r.time}%"></u>`;
    return `<div class="spr" role="button" tabindex="0" data-sp="${esc(r.name)}" data-dd="sp:${esc(r.name)}" title="Xem danh sách ticket của sprint này">` +
      `<div class="row"><span>${esc(r.name)}</span><em><span>${r.d}/${r.t}</span><span>${p}%</span></em></div>` +
      `<div class="stack">${time}<i style="width:${w(r.d)}%;background:var(--ok)"></i><i style="width:${w(r.qc)}%;background:var(--qc)"></i><i style="width:${w(r.doing)}%;background:var(--open)"></i></div>` +
      `<div class="row leg"><span><span><u style="--sc:var(--ok)"></u>Xong ${r.d}</span><span><u style="--sc:var(--qc)"></u>QC ${r.qc}</span><span><u style="--sc:var(--open)"></u>Đang làm ${r.doing}</span><span><u style="--sc:var(--chart-soft)"></u>Todo ${r.todo}</span></span>` +
      `<span>${r.left != null ? `<span>${r.left ? `còn ${r.left} ngày` : 'đã kết thúc'}</span>` : ''}${r.time != null ? `<span>thời gian ${r.time}%</span>` : ''}${st ? `<span class="pill ${st[0]}">${st[1]}</span>` : ''}</span></div></div>`;
  }).join('') || '<em class="mut">Không có dữ liệu sprint</em>', { key: (el, i) => el.dataset.sp ?? 'i' + i });
}

// needs attention: a ranked list (anything above 0 first, the red ones before amber, then by count), neutral at 0
const SEV = { bad: 0, warn: 1 };
function renderAttn(d) {
  const ranked = [...d.attn].sort((a, b) => !a.n - !b.n || SEV[a.sev] - SEV[b.sev] || b.n - a.n);
  morph($('attn'), ranked.map(({ q, sev, n }) =>
    `<button type="button" class="att${n ? ' hot ' + sev : ''}" data-dd="q:${q}" title="Xem danh sách ticket"><span>${esc(QUICK[q].label)}</span><b>${fmt(n)}</b></button>`).join(''), { key: (el) => el.dataset.dd });
}

function renderWip(d) {
  $('wipSel').value = T.wip;
  morph($('wip'), '<tr><th>Người</th><th>Đang làm</th><th>Blocked</th></tr>' +
    (d.wip.map(([p, r]) =>
      `<tr class="wr" tabindex="0" data-who="${esc(p)}" data-dd="wip:${esc(p)}"><td>${p === 'Chưa assign' ? p : person(p)}</td><td><span class="wip${r[0] > T.wip ? ' bad' : ''}">${r[0]}${r[0] > T.wip ? ` <span class="wo">${ALERT}vượt ngưỡng</span>` : ''}</span></td><td>${r[1] ? `<span class="wip bad">${r[1]}</span>` : 0}</td></tr>`).join('')
      || '<tr><td colspan="3" class="mut">Không có ticket đang làm.</td></tr>'));
}

// tickets sitting in a watched state: amber from AGE.warn days, red above AGE.bad, counted from the last State change
function renderAging(d) {
  const { rows, need, states } = d.aging, bad = rows.filter((x) => x.d > AGE.bad).length, SHOW = 8;
  loadSince(need);
  $('agn').innerHTML = `<span class="pill bad">${bad} đỏ</span> <span class="pill warn">${rows.length - bad} vàng</span>`;
  const html = states.map(([s, c]) => `<label><input type="checkbox" value="${esc(s)}"${aging.states.has(s) ? ' checked' : ''}> ${esc(s)} <span class="mut">${c}</span></label>`).join('');
  if ($('agList')._h !== html) { $('agList').innerHTML = html; $('agList')._h = html; }
  const n = aging.states.size;
  $('agst').querySelector('summary').textContent = n === 0 ? 'Chọn state' : n <= 2 ? [...aging.states].join(', ') : `${n} state`;
  morph($('aging'), '<tr><th>Ticket</th><th>State</th><th>Ở state</th></tr>' +
    (rows.slice(0, SHOW).map(({ i, d: age }) => {
      const lv = age > AGE.bad ? 'bad' : 'warn';
      return `<tr class="ag ${lv}" tabindex="0" data-id="${esc(i.id)}"><td class="agt"><b>${esc(i.id)}</b><span>${esc(i.assignee ? shortName(i.assignee) : 'Chưa assign')}</span></td><td>${stateSelect(i)}</td><td><span class="age ${lv}">${lv === 'bad' ? ALERT : ''}${age.toFixed(1)} ngày</span></td></tr>`;
    }).join('') + (rows.length > SHOW ? `<tr class="more" data-dd="aging"><td colspan="3" class="mut">… và ${rows.length - SHOW} ticket nữa, xem tất cả</td></tr>` : '') + (need.length && sinceLoading() ? '<tr><td colspan="3" class="mut">Đang tải thời gian đổi state…</td></tr>' : '')
      || '<tr><td colspan="3" class="mut">Không có ticket nào ở state này quá ngưỡng.</td></tr>'));
}

// horizontal bars per person: [[name, open, done]] (done is 0 for the open-only chart)
function bars(rows, empty) {
  const max = Math.max(1, ...rows.map(([, [o, x]]) => o + x));
  return rows.map(([n, [o, x]]) => `<div class="hb" data-k="${esc(n)}" data-dd="bugu:${esc(n)}" tabindex="0" role="button"><span class="hn">${n === 'Chưa assign' ? n : person(n)}</span><div class="stack"><i style="width:${o / max * 100}%;background:var(--bad)"></i><i style="width:${x / max * 100}%;background:var(--fixed)"></i></div><em>${o}${x ? ` / ${x}` : ''}</em></div>`).join('') || `<span class="mut">${empty}</span>`;
}

function renderBugs(d) {
  const b = d.bug;
  $('bugTot').innerHTML = `<div class="big"><b>${fmt(b.sp)}</b><span>bug trong sprint</span></div>` +
    `<div class="mixleg"><span><u style="--sc:var(--bad)"></u>Đang mở <b>${fmt(b.spOpen)}</b></span><span><u style="--sc:var(--fixed)"></u>Đã xong <b>${fmt(b.sp - b.spOpen)}</b></span><span class="mut">${esc(d.per.label)}</span><span class="mut">Mở toàn project: ${fmt(b.open)}</span></div>`;
  morph($('bugSp'), bars(b.spUser, 'Sprint này chưa có bug.'));
}

function renderMix({ mix: mx, mixPrev: mp }) {
  const pc = (v) => (mx.n ? Math.round(v / mx.n * 100) : 0);
  const seg = [['bug', 'Bug', 'var(--bad)'], ['feat', 'Feature', 'var(--feat)'], ['task', 'Task khác', 'var(--mut)']];
  morph($('mix'), mx.n
    ? `<div class="mixbar" data-k="bar">${seg.map(([k, , c]) => `<i style="width:${pc(mx.m[k])}%;background:${c}"></i>`).join('')}</div>` +
      `<div class="mixleg" data-k="leg">${seg.map(([k, l, c]) => `<span data-dd="mix:${k}" tabindex="0" role="button"><u style="--sc:${c}"></u>${l} <b>${fmt(mx.m[k])}</b><span class="mut">${pc(mx.m[k])}%</span>${k === 'bug' ? dlt(mx.m.bug / mx.n, mp.n ? mp.m.bug / mp.n : 0, false) : ''}</span>`).join('')}</div>`
    : '<span class="mut">Chưa có ticket xong trong sprint.</span>', { sync: syncMix });
}

const dm = (t) => { const x = new Date(t); return `${x.getDate()}/${x.getMonth() + 1}`; };

// grouped columns per day: series = [[values, colour, detail key]]; a column with tickets opens their list
function colChart(days, series) {
  const W = 600, H = 170, L = 6, B = 22, T = 16, max = Math.max(1, ...series.flatMap(([v]) => v)), gw = (W - L * 2) / days.length, bw = gw * 0.7 / series.length;
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img"><line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}"/>` + days.map((t, k) =>
    series.map(([v, c, dd], s) => {
      const h = (H - B - T) * v[k] / max, x = L + k * gw + gw * 0.15 + s * bw;
      return `<rect x="${x}" y="${H - B - h}" width="${bw - 1}" height="${h}" rx="2" fill="${c}"${v[k] ? ` data-dd="${dd}:${k}" class="dd"` : ''}/>${v[k] ? `<text x="${x + bw / 2}" y="${H - B - h - 3}" text-anchor="middle">${v[k]}</text>` : ''}`;
    }).join('') + `<text x="${L + k * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${new Date(t).getDate()}</text>`).join('') + '</svg>';
}

// remaining tickets per day (solid) against the straight line from all tickets to zero (dashed)
function renderBurn({ burn: b }) {
  if (!b) { $('burn').innerHTML = '<span class="mut">Chưa có ticket hoặc ngày bắt đầu/kết thúc của sprint.</span>'; return; }
  const W = 600, H = 200, L = 30, R = 10, T = 12, B = 24, x = (k) => L + (W - L - R) * (b.n > 1 ? k / (b.n - 1) : 0), y = (v) => T + (H - T - B) * (1 - v / b.total);
  const pts = b.actual.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`), last = b.actual.length - 1;
  // forecast: the pace so far, drawn to the day it reaches 0 or to the sprint's last day (whichever comes first)
  const end = b.n - 1, left = last >= 0 ? b.actual[last] : 0, pk = b.proj == null ? null : Math.min(b.proj, end);
  const proj = pk != null && last >= 0 && last < end && left > 0 ? `<line class="proj" x1="${x(last)}" y1="${y(left)}" x2="${x(pk)}" y2="${y(Math.max(0, left - b.rate * (pk - last)))}"/>` : '';
  const note = last < 0 || !left ? (left === 0 && last >= 0 ? '<span><b>Đã xong hết</b> ticket của sprint</span>' : '')
    : b.proj == null ? '<span>Chưa đóng được ticket nào — <b>chưa dự báo được</b></span>'
    : b.proj <= end ? `<span>Dự báo xong: <b>${dm(b.start + Math.ceil(b.proj) * 864e5)}</b>, kịp sprint</span>`
    : `<span>Cuối sprint dự kiến còn <b>~${Math.round(left - b.rate * (end - last))} ticket</b></span>`;
  $('burn').innerHTML = `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Burndown: còn ${left} / ${b.total} ticket"><line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/><line x1="${L}" x2="${L}" y1="${T}" y2="${y(0)}"/>` + proj +
    `<text x="${L - 4}" y="${T + 4}" text-anchor="end">${b.total}</text><text x="${L - 4}" y="${y(0) + 4}" text-anchor="end">0</text>` +
    `<text x="${L}" y="${H - 6}">${dm(b.start)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${dm(b.start + (b.n - 1) * 864e5)}</text>` +
    `<line class="ideal" x1="${x(0)}" y1="${y(b.total)}" x2="${x(b.n - 1)}" y2="${y(0)}"/>` +
    (pts.length ? `<polyline class="act" points="${pts.join(' ')}"/><circle cx="${x(last)}" cy="${y(b.actual[last])}" r="4"/><text x="${x(last)}" y="${y(b.actual[last]) - 8}" text-anchor="middle">${b.actual[last]}</text>` : '') + '</svg>' +
    `<div class="bnote">${note}${b.added ? `<span>+<b>${b.added}</b> ticket thêm sau khi sprint bắt đầu</span>` : ''}</div>`;
}

// tickets resolved per sprint, the running one in a lighter colour
function renderVel({ vel: v }) {
  $('veln').textContent = v.avg == null ? '' : `TB ${fmt(v.avg)} ticket / sprint`;
  const max = Math.max(0, ...v.rows.map((r) => r.n));
  $('vel').innerHTML = hbar(v.rows.map((r) => [esc(shortSp(r.name)) + (r.running ? ' <span class="mut">(đang chạy)</span>' : ''), r.n, r.running ? 'var(--chart-ref)' : 'var(--chart-main)', 'vel:' + r.name]), max, 'Chưa có sprint có ngày bắt đầu / kết thúc.');
}

const KIND = { bug: ['Bug', 'var(--bad)'], feat: ['Feature', 'var(--feat)'], task: ['Task khác', 'var(--mut)'] };
const dd = (n) => (n == null ? '—' : n < 1 ? '< 1 ngày' : `${n.toFixed(n < 10 ? 1 : 0)} ngày`);
// days left out because hundreds of tickets were closed at once (clean-up, not real work)
const bulkNote = (b) => (b.length ? `<div class="bnote">Bỏ qua ${b.map(([t, n]) => `<b>${fmt(n)}</b> ticket đóng hàng loạt ngày ${dm(t)}`).join(', ')}</div>` : '');

function renderLead({ lead: l, days, bulk }) {
  $('leadn').textContent = `${fmt(l.n)} ticket, ${days.length} ngày qua`;
  if (!l.n) { $('lead').innerHTML = '<span class="mut">Chưa có ticket xong trong khoảng này.</span>' + bulkNote(bulk); return; }
  const max = Math.max(0, ...l.kinds.map((k) => k[1] || 0));
  $('lead').innerHTML = `<div class="lt"><div><b>${dd(l.med)}</b><span> trung vị</span></div><div><span>85% xong trong </span><b class="p85">${dd(l.p85)}</b></div></div>` +
    '<div class="hbs">' + l.kinds.filter((k) => k[2]).map(([k, m, n]) => `<div class="hb" data-dd="lead" tabindex="0" role="button"><span class="hn">${KIND[k][0]} <span class="mut">(${n})</span></span><div class="stack"><i style="width:${max ? m / max * 100 : 0}%;background:${KIND[k][1]}"></i></div><em>${dd(m)}</em></div>`).join('') + '</div>' + bulkNote(bulk);
}

// one horizontal bar per row: [label html, value, colour, detail key:arg]
const hbar = (rows, max, empty) => rows.map(([l, v, c, dd]) => `<div class="hb" data-dd="${esc(dd)}" tabindex="0" role="button"><span class="hn">${l}</span><div class="stack"><i style="width:${max ? v / max * 100 : 0}%;background:${c}"></i></div><em>${v}</em></div>`).join('') || `<span class="mut">${empty}</span>`;

function renderMore(d) {
  $('thru').innerHTML = colChart(d.days, [[d.thru, 'var(--chart-main)', 'thru']]) + bulkNote(d.bulk);
  $('flow').innerHTML = colChart(d.days, [[d.bugNew, 'var(--bad)', 'bugnew'], [d.bugFix, 'var(--fixed)', 'bugfix']]);
  $('dist').innerHTML = hbar(d.dist.map(([s, n]) => [esc(s), n, stateColor(s), 'dist:' + s]), Math.max(0, ...d.dist.map((x) => x[1])), 'Không có ticket mở.');
  $('qcl').innerHTML = hbar(d.qcLoad.map(([n, c]) => [n === 'Chưa có QC' ? n : person(n), c, 'var(--chart-main)', 'qcl:' + n]), Math.max(0, ...d.qcLoad.map((x) => x[1])), 'Không có ticket chờ QC.');
  $('rdn').textContent = `${fmt(d.ready.n)} ticket mở`;
  $('ready').innerHTML = hbar(d.ready.rows.map(([l, n]) => [l, n, n ? 'var(--warn)' : 'var(--ok)', 'ready:' + l]), d.ready.n, '');
  $('cn').textContent = `${fmt(d.carry.length)} ticket`;
  morph($('carry'), '<tr><th>Ticket</th><th>State</th><th>Sprint đã qua</th></tr>' +
    (d.carry.slice(0, 8).map((i) => `<tr class="ag${i.sprints.length > 2 ? ' bad' : ' warn'}" tabindex="0" data-id="${esc(i.id)}"><td class="agt"><b>${esc(i.id)}</b><span>${esc(i.assignee ? shortName(i.assignee) : 'Chưa assign')}</span></td><td>${stateSelect(i)}</td><td><span class="age ${i.sprints.length > 2 ? 'bad' : 'warn'}">${i.sprints.length > 2 ? ALERT : ''}${i.sprints.length} sprints</span></td></tr>`).join('') + (d.carry.length > 8 ? `<tr class="more" data-dd="carry"><td colspan="3" class="mut">… và ${d.carry.length - 8} ticket nữa, xem tất cả</td></tr>` : '')
      || '<tr><td colspan="3" class="mut">Không có ticket nào bị chuyển sprint nhiều lần.</td></tr>'));
}

// ---- AI over the dashboard: a sprint report from the computed numbers (no ticket text), release notes from the tickets done
let lastD = null;
const brief = (i) => ({ id: i.id, summary: i.summary, state: i.state, assignee: i.assignee });
const reportData = (d) => ({
  sprint: d.per.label, previousSprint: d.per.prev, tickets: d.total, doing: d.doing, waitingQc: d.qc, doneRatePct: d.doneRate,
  sprints: d.prog.map((r) => ({ name: r.name, total: r.t, todo: r.todo, doing: r.doing, qc: r.qc, done: r.d, timeElapsedPct: r.time, daysLeft: r.left })),
  burndown: d.burn && { total: d.burn.total, left: d.burn.actual.at(-1), closedPerDay: +d.burn.rate.toFixed(2), sprintDays: d.burn.n, dayAllDone: d.burn.proj == null ? null : Math.ceil(d.burn.proj), addedAfterStart: d.burn.added },
  attention: Object.fromEntries(d.attn.map((a) => [QUICK[a.q].label, a.n])),
  wipLimit: T.wip, wip: d.wip.map(([p, [n, b]]) => ({ person: p, doing: n, blocked: b })),
  aging: d.aging.rows.slice(0, 15).map(({ i, d: days }) => ({ ...brief(i), daysInState: +days.toFixed(1) })),
  carriedOver: d.carry.slice(0, 15).map((i) => ({ ...brief(i), sprints: i.sprints.length })),
  bugs: { inSprint: d.bug.sp, openInSprint: d.bug.spOpen, openInProject: d.bug.open },
  velocityAvgPerSprint: d.vel.avg, leadTimeDays: { median: d.lead.med, p85: d.lead.p85 },
});
function aiPanel(title, label, kind, data) {
  openPanel(title, '<div id="dai"></div>');
  aiInto($('dai'), label, (sig) => yt.aiData(kind, data, sig));
}
export function initDashAi() {
  $('aiRep').onclick = () => lastD && aiPanel(`Báo cáo sprint · ${lastD.per.label}`, 'AI đang viết báo cáo', 'report', reportData(lastD));
  $('aiNotes').onclick = () => {
    if (!lastD) return;
    if (!lastD.doneRows.length) { toast('Sprint đang xem chưa có ticket xong'); return; }
    aiPanel(`Release notes · ${lastD.per.label}`, 'AI đang viết release notes', 'notes', lastD.doneRows.slice(0, 300).map((i) => ({ id: i.id, type: i.type, summary: i.summary })));
  };
}

export function renderDashboard(now) {
  const d = lastD = dashStats(now);
  $('aibar').hidden = !aiOn();
  renderKpis(d); renderSprints(d); renderAttn(d); renderWip(d); renderAging(d); renderBugs(d); renderMix(d); renderBurn(d); renderVel(d); renderLead(d); renderMore(d);
}

/* ---------- Ticket active page: state chips, quick filters, ticket table (flat or grouped, columns chosen by the user), empty state ---------- */
import { $, DAY, ago, esc, fmt, hue, shortSp, swap } from '../util.js';
import { CAP, S, flt, folded, hiddenCols, picked, stateSel } from '../state.js';
import { COLS, PCOL, TINT, isFresh, lastSp, rank, stateColor, stateIcon, titleOf, typeColor } from '../ticket.js';
import { activePool, fltCount, groupRows, hasFilters, stateCounts, visibleRows } from '../query.js';
import { morph } from '../morph.js';
import { person, stateSelect } from './cells.js';
import { renderBulk } from '../ui/stateChange.js';

const dueCell = (t, now) => { // overdue = red, due within 2 days = amber
  if (!t) return '<td class="mut">—</td>';
  const lv = t < now ? 'bad' : t - now < 2 * DAY ? 'warn' : '';
  return `<td><span class="due ${lv}" title="${esc(new Date(t).toLocaleString('vi-VN'))}">${lv === 'bad' ? '⚠ ' : ''}${new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span></td>`;
};

// one renderer per column key (id and summary are always shown)
const CELL = {
  id: (i) => `<td class="idc"><a target="_blank" href="${esc(S.cfg.base)}/issue/${esc(i.id)}">${esc(i.id)}</a>${isFresh(i) ? '<span class="nw" title="Cập nhật sau lần bạn xem trước"></span>' : ''}<span class="cp"><button data-cp="id" title="Copy ID" aria-label="Copy ID">⧉</button><button data-cp="link" title="Copy link" aria-label="Copy link">🔗</button></span></td>`,
  summary: (i) => { const t = titleOf(i); return `<td class="sm">${t.tags.length ? `<div class="tags">${t.tags.map((x) => `<span class="tag" style="--h:${hue(x)}">${esc(x)}</span>`).join('')}</div>` : ''}<div class="ttl" title="${esc(i.summary)}">${esc(t.rest)}</div></td>`; },
  type: (i) => `<td><span class="tyc${i.type === 'Bug' ? ' bug' : ''}" style="--sc:${typeColor(i.type)}"><i></i>${esc(i.type || '—')}</span></td>`,
  due: (i, now) => dueCell(i.due, now),
  updated: (i) => `<td class="upd" title="${esc(new Date(i.updated).toLocaleString('vi-VN'))}">${ago(i.updated)}</td>`,
  state: (i) => `<td>${stateSelect(i)}</td>`,
  priority: (i) => { const col = PCOL[i.priority], r = rank(i); return `<td>${col ? `<span class="pr-t${r < 3 ? ' hi' : ''}${r === 0 ? ' c0' : ''}" style="--c:${col}" aria-label="${esc(i.priority)} ưu tiên"><span class="pdot" style="--c:${col}"></span>${esc(i.priority)}</span>` : '—'}</td>`; },
  assignee: (i) => `<td>${person(i.assignee)}</td>`,
  qc: (i) => `<td>${person(i.qc)}</td>`,
  sprint: (i) => `<td>${i.sprints.length ? `<span class="sp" title="${esc(i.sprints.join(', '))}">${esc(shortSp(lastSp(i)))}${i.sprints.length > 1 ? `<small>+${i.sprints.length - 1}</small>` : ''}</span>` : '—'}</td>`,
};

export const colsNow = () => COLS.map(([k]) => k).filter((k) => !hiddenCols.has(k));

function rowHtml(i, now, cols) {
  const r = rank(i), col = PCOL[i.priority], hi = S.hiOn && TINT[r] && !i.resolved; // resolved tickets stay grey, no priority tint
  const cls = [hi ? 'pr' : '', picked.has(i.id) ? 'picked' : '', i.resolved ? 'resolved' : ''].filter(Boolean).join(' ');
  return `<tr data-id="${esc(i.id)}" tabindex="0"${cls ? ` class="${cls}"` : ''}${hi ? ` style="--pc:${col};--a:${TINT[r]}%"` : ''}>` +
    `<td class="ck"><input type="checkbox" data-pick${picked.has(i.id) ? ' checked' : ''} aria-label="Chọn ${esc(i.id)}"></td>${cols.map((k) => CELL[k](i, now)).join('')}</tr>`;
}

const theadHtml = (cols, rows) => '<tr><th class="ck"><input type="checkbox" data-pickall' + (rows.length && rows.every((i) => picked.has(i.id)) ? ' checked' : '') + ' aria-label="Chọn tất cả ticket đang hiện"></th>' + COLS.filter(([k]) => cols.includes(k)).map(([k, l]) => `<th data-k="${k}" tabindex="0"${S.sort.k === k ? ` aria-sort="${S.sort.d === 'asc' ? 'ascending' : 'descending'}"` : ''}>${l}${S.sort.k === k ? `<span class="ar">${S.sort.d === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`).join('') + '</tr>';

const groupHtml = (k, items, now, cols) => `<tr class="grp${folded.has(k) ? ' folded' : ''}" tabindex="0" data-g="${esc(k)}" aria-expanded="${!folded.has(k)}"><td colspan="${cols.length + 1}"><span class="car">▾</span>${esc(k)}<b>${items.length}</b></td></tr>` +
  (folded.has(k) ? '' : items.map((i) => rowHtml(i, now, cols)).join(''));

const chipsHtml = (pool) => `<button class="chip${stateSel.size ? '' : ' on'}" aria-pressed="${!stateSel.size}" data-s="">Tất cả <b>${fmt(pool.length)}</b></button>` +
  stateCounts(pool).map(([s, c]) => `<button class="chip${stateSel.has(s) ? ' on' : ''}" aria-pressed="${stateSel.has(s)}" data-s="${esc(s)}"><span class="sc" style="--sc:${stateColor(s)}">${stateIcon(s)}</span>${esc(s)}<b>${fmt(c)}</b></button>`).join('');

// priority / type chips (like State): options come from the loaded open tickets (selected ones stay listed), "Tất cả" clears
function fillFlt(id, key, colorOf, sortFn) {
  const cnt = {};
  for (const i of activePool($('qs').value, key)) { const v = (key === 'priority' ? i.priority : i.type) || '—'; cnt[v] = (cnt[v] || 0) + 1; }
  const total = Object.values(cnt).reduce((a, b) => a + b, 0);
  const names = [...new Set([...Object.keys(cnt), ...flt[key]])].sort(sortFn(cnt));
  morph($(id), `<button class="chip${flt[key].size ? '' : ' on'}" aria-pressed="${!flt[key].size}" data-f="">Tất cả <b>${fmt(total)}</b></button>` +
    names.map((n) => `<button class="chip${flt[key].has(n) ? ' on' : ''}" aria-pressed="${flt[key].has(n)}" data-f="${esc(n)}"><i style="--sc:${colorOf(n)}"></i>${esc(n)}<b>${fmt(cnt[n] || 0)}</b></button>`).join(''), { key: (el) => el.dataset.f });
}

// nothing to show: explain why, offer to clear filters, and a global lookup by ticket ID (works for tickets outside the loaded data)
function renderEmpty(isEmpty) {
  if (isEmpty && $('empty').hidden) swap($('empty'));
  $('empty').hidden = !isEmpty;
  if (!isEmpty) return;
  const q = $('qs').value.trim();
  $('emsg').textContent = q ? `Không tìm thấy ticket nào khớp "${q}" trong dữ liệu đã tải.` : 'Không có ticket active.';
  $('eclr').hidden = !(hasFilters() || stateSel.size || fltCount());
  if (document.activeElement !== $('gid') && !$('gid').dataset.t) $('gid').value = /^([A-Za-z][A-Za-z0-9_]*-)?\d+$/.test(q) ? q : '';
}

export function renderActive(now) {
  const pool = activePool($('qs').value), cols = colsNow();
  morph($('chips'), chipsHtml(pool), { key: (el) => el.dataset.s });
  fillFlt('fpri', 'priority', (n) => PCOL[n] || 'var(--mut)', () => (a, b) => rank({ priority: a }) - rank({ priority: b }) || a.localeCompare(b));
  fillFlt('ftype', 'type', (n) => typeColor(n), (cnt) => (a, b) => (cnt[b] || 0) - (cnt[a] || 0));
  const act = S.shown = visibleRows(pool), g = $('grp').value;
  const ids = new Set(act.map((i) => i.id)); for (const id of picked) if (!ids.has(id)) picked.delete(id); // a ticket filtered out is no longer ticked
  renderBulk();
  $('acount').textContent = `(${fmt(act.length)})${act.length > S.cap ? ` · hiện ${fmt(S.cap)} đầu` : ''}`;
  $('more').hidden = act.length <= S.cap; $('more').textContent = `Hiện thêm ${fmt(Math.min(CAP, act.length - S.cap))} ticket`;
  const shown = act.slice(0, S.cap);
  const body = g === 'none' ? shown.map((i) => rowHtml(i, now, cols)).join('') : groupRows(shown, g).map(([k, items]) => groupHtml(k, items, now, cols)).join('');
  morph($('atable'), body ? theadHtml(cols, shown) + body : '');
  const th = $('atable').querySelector('th'); if (th) document.documentElement.style.setProperty('--th', th.offsetHeight + 'px'); // group rows stick right under the header row
  renderEmpty(!body);
}

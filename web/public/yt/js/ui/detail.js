/* ---------- Dashboard tiles: click anything with data-dd="key[:arg]" to list the tickets behind that number ---------- */
import { $, esc, fmt, shortName, when } from '../util.js';
import { titleOf } from '../ticket.js';
import { detail } from '../stats.js';
import { stateSelect } from '../views/cells.js';
import { openDrawer, openPanel } from './drawer.js';

const MAX = 300;

const row = (i) => `<tr data-id="${esc(i.id)}" tabindex="0"><td class="agt"><b>${esc(i.id)}</b><span>${esc(i.assignee ? shortName(i.assignee) : 'Chưa assign')}</span></td>` +
  `<td class="dttl">${esc(titleOf(i).rest)}</td><td>${stateSelect(i)}</td><td class="mut">${esc(i.priority || '—')}</td><td class="mut">${when(i.updated)}</td></tr>`;

let listed = []; // tickets in the open panel: the drawer's prev / next walk them

export function initDetail() {
  document.querySelector('.bento').addEventListener('click', (e) => {
    const el = e.target.closest('[data-dd]'); if (!el) return;
    const [key, ...arg] = el.dataset.dd.split(':'), d = detail(key, arg.join(':'));
    if (!d) return;
    listed = d.rows.slice(0, MAX);
    openPanel(d.title, `<div class="mut dcount">${fmt(d.rows.length)} ticket${d.rows.length > MAX ? ` · hiện ${MAX} đầu` : ''}</div>` + (d.rows.length
      ? `<div class="scroll"><table class="dl2"><tr><th>Ticket</th><th>Tiêu đề</th><th>State</th><th>Priority</th><th>Cập nhật</th></tr>${d.rows.slice(0, MAX).map(row).join('')}</table></div>`
      : '<i>Không có ticket nào.</i>'));
  });
  $('dbody').addEventListener('click', (e) => { const r = e.target.closest('tr[data-id]'); if (r && !e.target.closest('a,select')) openDrawer(r.dataset.id, listed); });
}

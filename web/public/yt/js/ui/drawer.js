/* ---------- ticket detail drawer (view only; assignee editable): meta, description, links, comments, prev / next ticket ---------- */
import { $, EASE, esc, reduce, when } from '../util.js';
import { S, loginOf } from '../state.js';
import { detail } from '../api.js';
import { findIssue } from '../query.js';
import { md } from '../markdown.js';
import { stateSelect } from '../views/cells.js';
import { hideTip } from './tooltip.js';

let opener = null; // element to give focus back to when the drawer closes
let nav = [], cur = null; // ids the prev / next buttons walk through (the list the ticket was opened from)
const isOpen = () => $('drawer').classList.contains('open');

function show() {
  if (!isOpen()) opener = document.activeElement; // opening a ticket from a list keeps the original opener
  $('drawer').inert = false; $('dim').classList.add('open'); $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('dclose').focus();
}
const paintNav = () => { const k = nav.indexOf(cur); $('dprev').disabled = k <= 0; $('dnext').disabled = k < 0 || k >= nav.length - 1; $('drawer').querySelector('.dnav').hidden = k < 0; };

// same panel, showing a list instead of one ticket (the tickets behind a dashboard tile)
export function openPanel(title, html) {
  hideTip();
  cur = null; paintNav();
  $('dtitle').textContent = title; $('dbody').innerHTML = html;
  $('drawer').classList.add('wide');
  show();
}

const assigneeSelect = (i) => {
  const login = i.assigneeLogin ?? (i.assignee ? loginOf.get(i.assignee) ?? '' : '');
  return `<select class="asel" data-sid="${esc(i.id)}" data-cur="${esc(login)}" aria-label="Đổi assignee ${esc(i.id)}"><option value="${esc(login)}" selected>${esc(i.assignee || 'Chưa assign')}</option></select>`;
};
const linksHtml = (links) => !links?.length ? '' : '<h4>Liên kết</h4><div class="lk">' + links.flatMap((l) => l.issues.map((x) =>
  `<div><em>${esc(l.rel)}</em><a href="#" data-open="${esc(x.id)}"${x.resolved ? ' class="done"' : ''}>${esc(x.id)}</a><span>${esc(x.summary || '')}</span></div>`)).join('') + '</div>';

// list = rows the ticket was opened from (table / dashboard panel), so prev / next walk the same order
export async function openDrawer(id, list = null, keep = false) {
  hideTip();
  if (!keep) nav = list ? list.map((x) => x.id) : [];
  cur = id; paintNav();
  let i = findIssue(id); const ext = !i; // ext = found by the global ID search, not in the loaded data: /api/issue returns the full row too
  if (ext) { try { const d = await detail(id); if (d.summary) i = d; } catch {} }
  $('dtitle').innerHTML = `<a target="_blank" href="${esc(S.cfg.base)}/issue/${esc(id)}" title="Mở trên YouTrack">${esc(id)}<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>`;
  const meta = !i ? [] : [['State', stateSelect(i)], ['Assignee', assigneeSelect(i)], ['Priority', esc(i.priority || '—')],
    ['QC', esc(i.qc || '—')], ['Sprint', esc(i.sprints.join(', ') || '—')], ...(i.due ? [['Hạn', when(i.due)]] : []), ['Tạo', when(i.created)], ['Cập nhật', when(i.updated)]];
  const top = (ext ? `<div class="mut">Ticket ngoài dữ liệu đã tải${i ? '' : ', hiển thị rút gọn, mở YouTrack để xem đầy đủ'}</div>` : '') +
    `<h3>${esc(i ? i.summary : id)}</h3><div class="meta">${meta.map(([k, v]) => `<span>${k}</span><div>${v}</div>`).join('')}`;
  $('dbody').innerHTML = top + '<span>Reporter</span><div>…</div></div><h4>Mô tả</h4><div class="desc">Đang tải…</div>';
  $('drawer').classList.remove('wide');
  show();
  try {
    const d = await detail(id);
    if (!isOpen() || cur !== id) return;
    $('dbody').innerHTML = top + `<span>Reporter</span><div>${esc(d.reporter || '—')}</div></div>` +
      `<h4>Mô tả</h4><div class="desc">${d.description ? md(d.description) : '<i>Không có mô tả</i>'}</div>` + linksHtml(d.links) +
      `<h4>Bình luận (${d.comments.length})</h4>` +
      (d.comments.map((c) => `<div class="cm"><small><span>${esc(c.author || '—')}</span><time>${when(c.created)}</time></small>${md(c.text)}</div>`).join('') || '<i>Chưa có bình luận</i>');
    if (!reduce) [...$('dbody').children].forEach((el, k) => el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: Math.min(k, 8) * 30, easing: EASE, fill: 'backwards' }));
  } catch (e) { $('dbody').querySelector('.desc').textContent = 'Không tải được chi tiết: ' + e.message; }
}

// step through the list the drawer was opened from: +1 next, -1 previous
export function stepDrawer(d) {
  const k = nav.indexOf(cur);
  if (!isOpen() || k < 0 || !nav[k + d]) return;
  openDrawer(nav[k + d], null, true);
}

export function closeDrawer() {
  const was = isOpen();
  $('dim').classList.remove('open'); $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); $('drawer').inert = true;
  if (was) { opener?.focus?.(); opener = null; }
}

export function initDrawer() {
  $('dim').onclick = $('dclose').onclick = closeDrawer;
  $('dprev').onclick = () => stepDrawer(-1);
  $('dnext').onclick = () => stepDrawer(1);
  $('dbody').addEventListener('click', (e) => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); openDrawer(a.dataset.open); } });
}

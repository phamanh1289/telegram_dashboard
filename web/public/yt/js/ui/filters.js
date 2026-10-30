/* ---------- Sprint / Người multi-selects, filter chips, and every "click a widget to filter" handler ---------- */
import { $, esc, lsSet, norm, reduce } from '../util.js';
import { S, ME, ANDROID_TEAM, T, aging, flt, msItems, sel, stateSel } from '../state.js';
import { render } from '../render.js';
import { LBL, MS } from '../views/cells.js';
import { filtersChanged } from '../data.js';
import { openDrawer } from './drawer.js';

const IDS = ['sprint', 'assignee'];

function closeMs(d) { // dropdown: fade out, then close
  if (!d.open || d._c) return;
  if (reduce) { d.open = false; return; }
  d._c = 1;
  d.querySelector('.opts').animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 130, easing: 'ease-in' }).onfinish = () => { d.open = false; d._c = 0; };
}

export function msLabel(id) {
  const n = sel[id].size;
  $(id).querySelector('summary').textContent = n === 0 ? MS[id][0] : n <= 2 ? [...sel[id]].map(LBL[id]).join(', ') : `${MS[id][1]}: ${n} đã chọn`;
}
export const msLabelAll = () => IDS.forEach(msLabel);

export function msFill(id, items) {
  items = msItems[id] = [...new Set([...items, ...sel[id]])]; // keep saved picks even when the loaded data has none of them
  $(id).querySelector('.list').innerHTML = '<button class="clr">Bỏ chọn tất cả</button>' +
    items.map((v) => `<label><input type="checkbox" value="${esc(v)}" ${sel[id].has(v) ? 'checked' : ''}> ${esc(v)}</label>`).join('');
  msLabel(id);
}
const msRefill = () => IDS.forEach((id) => msFill(id, msItems[id]));

export function initMultiSelects() {
  for (const id of IDS) {
    const d = $(id), msq = d.querySelector('.msq');
    msq.addEventListener('input', () => {
      const t = norm(msq.value);
      d.querySelectorAll('.list label').forEach((l) => (l.hidden = !norm(l.textContent).includes(t)));
    });
    d.querySelector('summary').addEventListener('click', (e) => { if (d.open) { e.preventDefault(); closeMs(d); } });
    d.addEventListener('toggle', () => { if (d.open) { msq.value = ''; msq.dispatchEvent(new Event('input')); msq.focus(); } });
    d.addEventListener('change', (e) => { if (e.target.type !== 'checkbox') return; sel[id][e.target.checked ? 'add' : 'delete'](e.target.value); msLabel(id); filtersChanged(); });
    d.addEventListener('click', (e) => {
      if (!e.target.classList.contains('clr')) return;
      sel[id].clear(); d.querySelectorAll('input').forEach((c) => (c.checked = false)); msLabel(id); filtersChanged();
    });
  }
  document.addEventListener('click', (e) => document.querySelectorAll('.ms[open]').forEach((d) => { if (!d.contains(e.target)) closeMs(d); }));
  msLabelAll();
}

export function initFilterBar() {
  $('fchips').addEventListener('click', (e) => {
    const b = e.target.closest('.fc'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'tier' || k === '*') S.tier = null;
    if (k === 'priority' || k === 'type') flt[k].delete(b.dataset.v);
    if (k === '*') { flt.priority.clear(); flt.type.clear(); }
    if (k !== 'tier' && k !== 'priority' && k !== 'type') for (const id of k === '*' ? IDS : [k]) { k === '*' ? sel[id].clear() : sel[id].delete(b.dataset.v); msFill(id, msItems[id]); }
    filtersChanged();
  });
  $('scope').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.s === 'team') sel.assignee.clear();
    else if (ME.name) sel.assignee = new Set(b.dataset.s === 'android' ? [ME.name, ...ANDROID_TEAM] : [ME.name]);
    msFill('assignee', msItems.assignee); filtersChanged();
  });
  $('eclr').onclick = () => { $('qs').value = ''; S.tier = null; stateSel.clear(); flt.priority.clear(); flt.type.clear(); sel.sprint.clear(); sel.assignee.clear(); msRefill(); filtersChanged(); };
  $('wipSel').onchange = () => { T.wip = +$('wipSel').value; lsSet('ytWip', T.wip); render(); };
  $('rangeSel').value = S.range;
  $('rangeSel').onchange = () => { S.range = +$('rangeSel').value; lsSet('ytRange', S.range); render(); };
  $('agst').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    aging.states[e.target.checked ? 'add' : 'delete'](e.target.value);
    lsSet('ytAgSt', JSON.stringify([...aging.states])); render();
  });
  for (const id of ['aging', 'carry']) $(id).addEventListener('click', (e) => { const r = e.target.closest('tr[data-id]'); if (r && !e.target.closest('a,select')) openDrawer(r.dataset.id); });
}

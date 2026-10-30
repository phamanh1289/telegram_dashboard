/* ---------- Ticket active toolbar + table interactions: state chips, search, sort, group, copy, highlight, density, bulk pick, open drawer ---------- */
import { $, copy, lsGet, lsSet } from '../util.js';
import { CAP, S, flt, folded, hiddenCols, picked, stateSel } from '../state.js';
import { COLS } from '../ticket.js';
import { render } from '../render.js';
import { openDrawer } from './drawer.js';
import { exportCsv } from '../export.js';
import { colsNow } from '../views/active.js';

const paintHi = () => { $('hi').classList.toggle('on', S.hiOn); $('hi').setAttribute('aria-pressed', S.hiOn); };
const paintRes = () => { $('res').classList.toggle('on', S.showRes); $('res').setAttribute('aria-pressed', S.showRes); };
const paintDense = () => { const on = document.body.classList.contains('dense'); $('dense').classList.toggle('on', on); $('dense').setAttribute('aria-pressed', on); };

export function initTable() {
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (!b.dataset.s) stateSel.clear(); else stateSel.has(b.dataset.s) ? stateSel.delete(b.dataset.s) : stateSel.add(b.dataset.s);
    S.cap = CAP; render();
  });
  for (const [id, key] of [['fpri', 'priority'], ['ftype', 'type']]) $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (!b.dataset.f) flt[key].clear(); else flt[key].has(b.dataset.f) ? flt[key].delete(b.dataset.f) : flt[key].add(b.dataset.f);
    S.cap = CAP; render();
  });
  $('fcolsList').innerHTML = COLS.filter(([k]) => k !== 'id' && k !== 'summary').map(([k, l]) => `<label><input type="checkbox" value="${k}"${hiddenCols.has(k) ? '' : ' checked'}> ${l}</label>`).join('');
  $('fcols').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    hiddenCols[e.target.checked ? 'delete' : 'add'](e.target.value); lsSet('ytColsOff', JSON.stringify([...hiddenCols])); render();
  });
  $('more').onclick = () => { S.cap += CAP; render(); };
  $('csv').onclick = () => exportCsv(S.shown, $('project').value, colsNow());
  $('grp').onchange = () => { folded.clear(); S.cap = CAP; render(); };
  paintHi();
  paintRes();
  $('res').onclick = () => { S.showRes = !S.showRes; paintRes(); lsSet('ytRes', S.showRes ? '1' : '0'); S.cap = CAP; render(); };
  $('hi').onclick = () => { S.hiOn = !S.hiOn; paintHi(); lsSet('ytHi', S.hiOn ? '1' : '0'); render(); };
  document.body.classList.toggle('dense', lsGet('ytDense') === '1'); paintDense();
  $('dense').onclick = () => { lsSet('ytDense', document.body.classList.toggle('dense') ? '1' : '0'); paintDense(); };
  let qt; $('qs').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { S.cap = CAP; render(); }, 120); };

  $('atable').addEventListener('click', (e) => {
    if (e.target.matches('[data-pickall]')) { // tick / untick every row on screen
      const rows = S.shown.slice(0, S.cap);
      rows.forEach((i) => (e.target.checked ? picked.add(i.id) : picked.delete(i.id))); render(); return;
    }
    if (e.target.matches('[data-pick]')) { const id = e.target.closest('tr').dataset.id; e.target.checked ? picked.add(id) : picked.delete(id); render(); return; }
    if (e.target.closest('td.ck')) { e.target.closest('td.ck').querySelector('input').click(); return; } // a miss next to the box still ticks it
    const th = e.target.closest('th[data-k]');
    if (th) { const k = th.dataset.k; S.sort = S.sort.k === k ? { k, d: S.sort.d === 'asc' ? 'desc' : 'asc' } : { k, d: 'asc' }; render(); return; }
    const g = e.target.closest('tr.grp');
    if (g) { folded.has(g.dataset.g) ? folded.delete(g.dataset.g) : folded.add(g.dataset.g); render(); return; }
    const cp = e.target.closest('[data-cp]');
    if (cp) { const id = cp.closest('tr').dataset.id; cp.dataset.cp === 'id' ? copy(id, `Đã copy ${id}`) : copy(`${S.cfg.base}/issue/${id}`, `Đã copy link ${id}`); return; }
    const tr = e.target.closest('tr[data-id]');
    if (tr && !e.target.closest('a,select,input')) openDrawer(tr.dataset.id, S.shown);
  });
}

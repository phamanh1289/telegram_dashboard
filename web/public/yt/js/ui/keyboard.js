/* ---------- keyboard: Enter / Space on click-only widgets, Tab trap in the drawer, Ctrl/⌘ K or / search, j / k rows, x tick, Esc ---------- */
import { $ } from '../util.js';
import { S } from '../state.js';
import { filtersChanged } from '../data.js';
import { render } from '../render.js';
import { closeDrawer, stepDrawer } from './drawer.js';
import { setView } from './sidebar.js';

const CLICKABLE = 'tr[data-id],tr.grp,[data-dd],#upd,th[data-k]';
const typing = (t) => t.matches?.('input,textarea,select,[contenteditable]');

function trapTab(e) {
  const f = [...$('drawer').querySelectorAll('a[href],button:not(:disabled),select,textarea')].filter((x) => x.offsetParent);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (!$('drawer').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

const search = () => { closeDrawer(); if (S.view !== 'active') { setView('active'); filtersChanged(); } $('qs').focus(); $('qs').select(); };

// j / k: next / previous ticket row in Ticket active (focus moves, Enter opens it)
function moveRow(d) {
  const rows = [...$('atable').querySelectorAll('tr[data-id]')];
  if (!rows.length) return;
  const k = rows.indexOf(document.activeElement?.closest?.('tr[data-id]'));
  const r = rows[k < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, k + d))];
  r.focus(); r.scrollIntoView({ block: 'nearest' });
}

export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.(CLICKABLE)) { e.preventDefault(); e.target.click(); }
    else if (e.key === 'Tab' && $('drawer').classList.contains('open')) trapTab(e);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search(); return; }
    if (e.key === 'Escape') {
      if (document.activeElement === $('qs') && $('qs').value) { $('qs').value = ''; render(); }
      else if ($('drawer').classList.contains('open')) closeDrawer();
      else if (document.body.classList.contains('tv')) document.body.classList.remove('tv');
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const open = $('drawer').classList.contains('open');
    if (e.key === '/') { e.preventDefault(); search(); }
    else if (e.key === 'j' || e.key === 'k') { e.preventDefault(); const d = e.key === 'j' ? 1 : -1; open ? stepDrawer(d) : S.view === 'active' && moveRow(d); }
    else if (e.key === 'x' && !open) document.activeElement?.closest?.('#atable tr[data-id]')?.querySelector('[data-pick]')?.click();
  });
}

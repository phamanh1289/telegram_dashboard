/* ---------- header filter chips + "mine / team" toggle ---------- */
import { $, esc } from '../util.js';
import { S, ME, ANDROID_TEAM, flt, sel } from '../state.js';
import { TIER_LABEL } from '../ticket.js';
import { hasFilters } from '../query.js';
import { morph, fcKey } from '../morph.js';
import { LBL, MS } from './cells.js';

const chip = (k, label, text, v = '') => `<button class="fc" data-k="${k}"${v && ` data-v="${esc(v)}"`} title="Gỡ bộ lọc"><span>${label}</span>${esc(text)}<b>✕</b></button>`;

export function renderFilterBar() {
  const fl = S.view === 'active' ? [['priority', 'Priority'], ['type', 'Type']].flatMap(([k, l]) => [...flt[k]].map((v) => chip(k, l, v, v))).join('') : ''; // priority / type apply to Ticket active only
  const html = ['sprint', 'assignee'].flatMap((k) => [...sel[k]].map((v) => chip(k, MS[k][1], LBL[k](v), v))).join('') + fl +
    (S.tier != null ? chip('tier', 'Tầng', TIER_LABEL[S.tier]) : '') +
    (hasFilters() || fl ? '<button class="fc all" data-k="*">Xóa tất cả</button>' : '');
  morph($('fchips'), html, { key: fcKey });
  const a = sel.assignee, android = [ME.name, ...ANDROID_TEAM];
  const mode = !a.size ? 'team' : a.size === 1 && a.has(ME.name) ? 'me' : a.size === new Set(android).size && android.every((n) => a.has(n)) ? 'android' : '';
  document.querySelectorAll('#scope button').forEach((b) => { b.classList.toggle('on', b.dataset.s === mode); b.setAttribute('aria-pressed', b.dataset.s === mode); });
}

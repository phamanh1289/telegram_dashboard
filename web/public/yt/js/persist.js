/* ---------- persisted filters (localStorage) + shareable URL ---------- */
import { $, lsGet, lsSet } from './util.js';
import { MOCK, S, defaultWho, flt, qp, sel, stateSel } from './state.js';
import { GROUPS, KEYS } from './ticket.js';
import { msLabelAll } from './ui/filters.js';

const KEY = 'ytFilters';
const FILTER_PARAMS = ['sprint', 'assignee', 'state', 'group', 'sort', 'everyone', 'tier', 'priority', 'type', 'q'];

function syncUrl(s) {
  const p = new URLSearchParams();
  if ($('project').value) p.set('project', $('project').value);
  for (const k of ['sprint', 'assignee', 'state', 'priority', 'type']) s[k].forEach((v) => p.append(k, v));
  if (s.q) p.set('q', s.q);
  if (!s.assignee.length) p.set('everyone', '1'); // no Người filter = everyone's tickets (default is just the current user)
  if (s.tier != null) p.set('tier', s.tier);
  if (s.group !== 'sprint') p.set('group', s.group);
  if (MOCK) p.set('mock', '1');
  if (s.sort !== 'priority:asc') p.set('sort', s.sort);
  if (S.view === 'dash') p.set('view', 'dash');
  try { history.replaceState(null, '', '?' + p); } catch {}
}

export function saveFilters() {
  const s = { v: 3, state: [...stateSel], sprint: [...sel.sprint], assignee: [...sel.assignee], group: $('grp').value, sort: S.sort.k + ':' + S.sort.d, tier: S.tier,
    priority: [...flt.priority], type: [...flt.type], q: $('qs').value.trim() };
  if (!MOCK) lsSet(KEY, JSON.stringify({ ...s, tier: null, q: '', priority: undefined, type: undefined })); // tier and search live in the URL only; priority / type have their own key
  lsSet('ytFlt', JSON.stringify({ priority: [...flt.priority], type: [...flt.type] }));
  syncUrl(s);
}

// saved/URL assignee choice: array (empty = everyone) or undefined = nothing chosen yet -> default to the current user
export function savedFilters() {
  if (FILTER_PARAMS.some((k) => qp.has(k)))
    return { sprint: qp.getAll('sprint'), assignee: qp.has('assignee') ? qp.getAll('assignee') : qp.has('everyone') ? [] : undefined, state: qp.getAll('state'), group: qp.get('group'), sort: qp.get('sort'), tier: qp.get('tier'),
      priority: qp.getAll('priority'), type: qp.getAll('type'), q: qp.get('q') };
  if (MOCK) return {};
  try { const s = JSON.parse(localStorage[KEY] || '{}'); if (s.v !== 3) delete s.assignee; return s; } catch { return {}; } // older saves never chose an assignee
}

export function restoreFilters() {
  const s = savedFilters();
  stateSel.clear(); (s.state || []).forEach((x) => stateSel.add(x));
  try { const f = s.priority ? s : JSON.parse(lsGet('ytFlt') || '{}'); for (const k of ['priority', 'type']) flt[k] = new Set(f[k] || []); } catch {} // a shared link / saved view wins over this browser's last choice
  if (s.q) $('qs').value = s.q;
  sel.sprint = new Set(s.sprint || []);
  S.tier = ['0', '1', '2'].includes(String(s.tier)) ? +s.tier : null;
  sel.assignee = new Set(s.assignee ?? defaultWho());
  if (s.group === 'none' || GROUPS[s.group]) $('grp').value = s.group;
  const [k, d] = String(s.sort || '').split(':');
  if (KEYS[k] && (d === 'asc' || d === 'desc')) S.sort = { k, d };
  msLabelAll();
}

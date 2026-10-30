/* ---------- filtering / sorting / grouping of the Ticket active table (pure over state, no DOM) ---------- */
import { norm } from './util.js';
import { S, flt, sel, sprintDates, stateSel } from './state.js';
import { BUCKET, GROUPS, cmp } from './ticket.js';

export const byAs = (i) => !sel.assignee.size || sel.assignee.has(i.assignee || 'Unassigned');
export const bySp = (i) => !sel.sprint.size || i.sprints.some((s) => sel.sprint.has(s));
// skip = the dropdown whose chips are being counted: its own choice does not narrow its counts (same as State)
const byFlt = (i, skip) => (skip === 'priority' || !flt.priority.size || flt.priority.has(i.priority || '—')) && (skip === 'type' || !flt.type.size || flt.type.has(i.type || '—')); // Ticket active only
export const fltCount = () => flt.priority.size + flt.type.size;
export const hasFilters = () => !!(sel.sprint.size || sel.assignee.size || S.tier != null);
export const findIssue = (id) => S.all.find((x) => x.id === id);

const hit = (i, terms) => { i._s ??= norm(`${i.id} ${i.summary} ${i.assignee || ''} ${i.qc || ''} ${i.state || ''}`); return terms.every((t) => i._s.includes(t)); };

// tickets matching sprint / assignee / priority / type / search text / tier filters (+ resolved ones when shown)
export function activePool(text, skip = null) {
  const terms = norm(text).split(/\s+/).filter(Boolean);
  return S.all.filter((i) => (S.showRes || !i.resolved) && bySp(i) && byAs(i) && byFlt(i, skip) && hit(i, terms) && (S.tier == null || BUCKET(i) === S.tier));
}

// state chips: count per state (selected states stay listed even at 0), biggest first
export function stateCounts(pool) {
  const counts = {};
  for (const i of pool) counts[i.state || '—'] = (counts[i.state || '—'] || 0) + 1;
  for (const s of stateSel) counts[s] ||= 0;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export const visibleRows = (pool) => pool.filter((i) => !stateSel.size || stateSel.has(i.state || '—')).sort(cmp);

// newest sprint first: by start date when known, else by the "Tuần N - Tn" name (month, then week), else by name
const spWeek = (n) => { const m = /Tuần\s*(\d+)\s*-\s*T(\d+)/i.exec(n); return m ? +m[2] * 100 + +m[1] : null; };
const spNewer = (a, b) => {
  const da = sprintDates.get(a)?.start, db = sprintDates.get(b)?.start;
  if (da != null && db != null && da !== db) return db - da;
  const wa = spWeek(a), wb = spWeek(b);
  return wa != null && wb != null && wa !== wb ? wb - wa : b.localeCompare(a, 'vi', { numeric: true });
};

// [[groupKey, tickets]] ordered: sprint newest first (no sprint last), others by size (biggest first)
export function groupRows(rows, g) {
  const groups = new Map();
  for (const i of rows) { const k = GROUPS[g](i); (groups.get(k) || groups.set(k, []).get(k)).push(i); }
  const bySprint = (a, b) => (a[0] === 'Không sprint') - (b[0] === 'Không sprint') || spNewer(a[0], b[0]);
  return [...groups].sort(g === 'sprint' ? bySprint : (a, b) => b[1].length - a[1].length);
}

/* ---------- Ticket active: "AI lọc" box, a sentence becomes the regular filters (state / priority / type / người / sprint / search) ---------- */
import { $, toast } from '../util.js';
import { ME, S, flt, msItems, sel, stateSel } from '../state.js';
import { yt } from '../api.js';
import { period } from '../stats.js';
import { filtersChanged } from '../data.js';
import { msFill } from './filters.js';
import { aiOn } from './ai.js';

const uniq = (k) => [...new Set(S.all.map((i) => i[k]).filter(Boolean))];

async function run() {
  const box = $('aiq'), text = box.value.trim();
  if (!text || box.disabled) return;
  const opts = { state: uniq('state'), priority: uniq('priority'), type: uniq('type'), assignee: msItems.assignee, sprint: msItems.sprint.slice(0, 40),
    me: ME.name, current_sprint: [...period(Date.now()).set][0] || null };
  box.disabled = true;
  try {
    const r = await yt.aiFilter(text, opts);
    const pick = (k) => (Array.isArray(r[k]) ? r[k] : []).filter((v) => opts[k].includes(v)); // only values the table knows
    stateSel.clear(); pick('state').forEach((v) => stateSel.add(v));
    flt.priority = new Set(pick('priority')); flt.type = new Set(pick('type'));
    sel.assignee = new Set(pick('assignee')); sel.sprint = new Set(pick('sprint'));
    $('qs').value = typeof r.q === 'string' ? r.q.slice(0, 100) : '';
    S.tier = null;
    msFill('assignee', msItems.assignee); msFill('sprint', msItems.sprint);
    filtersChanged();
    box.value = '';
    toast('AI đã đặt bộ lọc, xem các chip bên dưới');
  } catch (e) { toast('AI lọc lỗi: ' + e.message); }
  finally { box.disabled = false; }
}

export function initAiFilter() {
  $('aiq').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(); } });
}
export const showAiFilter = () => { $('aiq').hidden = !aiOn(); }; // config arrives after the UI is wired: checked on every render

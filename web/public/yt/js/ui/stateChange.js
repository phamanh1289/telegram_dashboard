/* ---------- change a ticket's assignee from the table, the drawer or the bulk bar; every change can be undone from the toast ---------- */
import { $, esc, toast } from '../util.js';
import { loginOf, picked, store } from '../state.js';
import { forgetDetail, yt } from '../api.js';
import { render } from '../render.js';
import { getPeople } from '../data.js';
import { findIssue } from '../query.js';
import { aiOn, aiTickets } from './ai.js';

const UNASSIGNED = ''; // option value for "Chưa assign"

const peopleOptions = (cur) => `<option value="${UNASSIGNED}"${cur ? '' : ' selected'}>Chưa assign</option>` +
  getPeople().map((p) => `<option value="${esc(p.login)}"${p.login === cur ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
const fillAsel = (s) => {
  if (s.dataset.f || !getPeople().length) return;
  s.dataset.f = 1;
  const cur = s.dataset.cur;
  s.innerHTML = (cur && !getPeople().some((p) => p.login === cur) ? `<option value="${esc(cur)}" selected>${esc(s.options[s.selectedIndex]?.text || cur)}</option>` : '') + peopleOptions(cur);
};

// write the server's answer into every loaded copy of the ticket (Active and Dashboard stores)
function patch(id, r) {
  for (const st of Object.values(store)) { const row = st.rows.get(id); if (row) { Object.assign(row, r); delete row._s; } }
  forgetDetail(id);
}
const loginOfRow = (i) => i?.assigneeLogin ?? (i?.assignee ? loginOf.get(i.assignee) ?? null : null);
const nameOf = (login) => (login ? getPeople().find((p) => p.login === login)?.name ?? login : null);

async function writeAssignee(id, login) {
  const r = await yt.setAssignee(id, login || null);
  patch(id, { assignee: r.assignee !== undefined && r.assignee !== login ? r.assignee : nameOf(login), assigneeLogin: login || null, updated: r.updated ?? Date.now() });
  document.querySelectorAll(`select.asel[data-sid="${CSS.escape(id)}"]`).forEach((x) => { x.dataset.cur = login || ''; x.value = login || ''; });
}

// apply the assignee to many tickets one by one; the toast offers to put every changed ticket back
async function apply(ids, login, prevOf = (id) => loginOfRow(findIssue(id))) {
  const done = [], fail = [];
  for (const id of ids) {
    const prev = prevOf(id);
    if (prev === login) continue;
    try { await writeAssignee(id, login); done.push([id, prev]); } catch (e) { fail.push(`${id}: ${e.message}`); }
  }
  render();
  const label = nameOf(login) || 'Chưa assign';
  if (fail.length) toast(`Lỗi ${fail.length} ticket — ${fail[0]}`);
  else if (done.length) toast(`${done.length === 1 ? done[0][0] : done.length + ' ticket'} → ${label}`, { label: 'Hoàn tác', fn: () => undo(done) });
  else toast('Không có gì thay đổi');
  return done.length;
}
async function undo(list) {
  try { for (const [id, prev] of list) await writeAssignee(id, prev); toast('Đã hoàn tác'); }
  catch (e) { toast('Không hoàn tác được: ' + e.message); }
  render();
}

async function onSelect(s) {
  const value = s.value, prev = s.dataset.cur;
  if (value === prev) return;
  s.disabled = true;
  s.value = prev; // apply() repaints every copy once the server agreed
  await apply([s.dataset.sid], value, () => prev); // the select knows the value even for tickets outside the loaded data
  s.disabled = false;
}

// bulk bar: ticked rows in Ticket active
export function renderBulk() {
  const n = picked.size;
  $('bulk').hidden = !n;
  if (!n) return;
  $('bn').textContent = `${n} ticket đã chọn`;
  $('bai').hidden = !aiOn();
  const as = '<option value="-">Assignee: giữ nguyên</option>' + peopleOptions('-');
  if ($('bas')._h !== as) { $('bas').innerHTML = as; $('bas')._h = as; $('bas').value = '-'; }
}

export function initStateChange() {
  document.addEventListener('pointerdown', (e) => { if (e.target.classList?.contains('asel')) fillAsel(e.target); }, true);
  document.addEventListener('focusin', (e) => { if (e.target.classList?.contains('asel')) fillAsel(e.target); });
  document.addEventListener('change', (e) => { if (e.target.classList?.contains('asel')) onSelect(e.target); });

  $('bai').onclick = () => aiTickets([...picked], `${picked.size} ticket đã chọn`);
  $('bclr').onclick = () => { picked.clear(); render(); };
  $('bapply').onclick = async () => {
    const as = $('bas').value;
    if (as === '-') { toast('Chọn assignee cần đổi'); return; }
    $('bapply').disabled = true;
    try {
      if (await apply([...picked], as)) { picked.clear(); $('bas').value = '-'; render(); }
    } finally { $('bapply').disabled = false; }
  };
}

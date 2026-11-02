/* ---------- loading, per-assignee fetching, auto refresh ---------- */
import { $, lsSet } from './util.js';
import { CAP, MOCK, ME, PERIOD, S, defaultWho, loadSeen, loginOf, mkStore, picked, saveSeen, sel, sprintDates, stateSel, store } from './state.js';
import { resetDetails, yt } from './api.js';
import { render } from './render.js';
import { msFill } from './ui/filters.js';
import { busyUi, say } from './ui/status.js';

let people = [], busy = false, redo = false, fetching = false, gen = 0; // gen bumps when the project changes: answers of an older project are dropped
let stamp = '', next = Date.now() + PERIOD * 1000;

// 'all' = open tickets + those resolved within the history window (Ticket active shows resolved ones greyed out, Dashboard needs them too)
export const scopeNow = () => 'all';
const keyOf = (n) => (n === 'Unassigned' ? 'unassigned' : n === ME.name ? 'me' : loginOf.get(n) || n);
export const fetchRows = (scope, project = $('project').value, who = null) => yt.issues(project, scope, who);

export const getPeople = () => people; // [{ login, name }] of the current project (assignee dropdowns)
export function loadPeople(project) {
  people = []; loginOf.clear();
  return (S.peopleP = yt.people(project).then((l) => { people = l; l.forEach((p) => loginOf.set(p.name, p.login)); return l; }).catch(() => []));
}

// assignee keys still to fetch for the current Người filter: [] = nothing, null = everyone
function missingKeys(scope) {
  const st = store[scope];
  if (st.everyone) return [];
  if (MOCK || !sel.assignee.size) return null;
  return [...sel.assignee].map(keyOf).filter((k) => !st.who.has(k));
}
const needsFetch = () => { const m = missingKeys(scopeNow()); return m === null || m.length > 0; };

// fetch whatever the current filter needs but has not been loaded yet, and merge it into the store
async function ensure(scope, pre) {
  const st = store[scope], g = gen;
  if ([...sel.assignee].some((n) => n !== 'Unassigned' && n !== ME.name && !loginOf.has(n))) await S.peopleP; // need name -> login first
  if (g !== gen) return;
  const miss = missingKeys(scope);
  if (miss === null) { const rows = await fetchRows(scope); if (g !== gen) return; st.rows = new Map(rows.map((r) => [r.id, r])); st.everyone = true; }
  else if (miss.length) {
    const usePre = pre && miss.length === 1 && miss[0] === 'me'; // the early request only covers the current user
    const rows = await (usePre ? pre : fetchRows(scope, $('project').value, miss));
    if (g !== gen) return;
    for (const r of rows) st.rows.set(r.id, r);
    miss.forEach((k) => st.who.add(k));
  }
  S.all = [...st.rows.values()];
  if (scope === 'all') S.full = S.all;
}

export function refreshMs() {
  const lastUse = {};
  for (const i of S.all) for (const s of i.sprints) lastUse[s] = Math.max(lastUse[s] || 0, i.updated);
  msFill('sprint', Object.keys(lastUse).sort((a, b) => lastUse[b] - lastUse[a]));
  const names = people.length ? people.map((p) => p.name) : [...new Set(S.all.map((i) => i.assignee).filter(Boolean))];
  msFill('assignee', ['Unassigned', ...names.sort((a, b) => a.localeCompare(b, 'vi'))]);
}

// Người / Sprint / state filter changed: show what is loaded right away, then fetch other assignees' tickets if they were added
export async function filtersChanged() {
  S.cap = CAP; render();
  if (fetching || busy) return;
  fetching = true;
  const g = gen;
  try {
    while (g === gen && needsFetch()) {
      busyUi(true, { text: 'Đang tải thêm…', logo: false });
      await ensure(scopeNow());
      if (g !== gen) break; // project changed: load() takes over
      refreshMs(); render();
    }
  } catch (e) { say('Lỗi: ' + e.message); }
  finally { fetching = false; busyUi(false, { logo: false }); tick(); }
}

export async function load(silent, pre) {
  if (busy) { redo = true; return; } // asked while loading (e.g. project switch): run again right after
  busy = true; say('');
  let ok = true;
  const g = gen;
  busyUi(true, { text: 'Đang tải…', body: !silent });
  try {
    resetDetails();
    store.active = mkStore(); store.all = mkStore(); // a refresh re-fetches only the assignees the filter needs
    if (scopeNow() !== 'all') S.full = null;
    const sprints = yt.sprints($('project').value).then((l) => { if (g === gen) { sprintDates.clear(); l.forEach((p) => sprintDates.set(p.name, p)); } }).catch(() => {});
    await Promise.all([ensure(scopeNow(), pre), sprints]);
    if (g !== gen) return; // project changed meanwhile: the queued reload (finally) shows the right one
    refreshMs();
    render();
    stamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (MOCK) say('Đang xem dữ liệu MẪU để kiểm tra màu — bỏ ?mock=1 trên URL để quay lại dữ liệu thật.');
    else if (S.cfg.mock) say('Đang dùng dữ liệu MOCK. Dán token YouTrack trong Cài đặt (Telegram Inbox) để xem dữ liệu thật.');
  } catch (e) { ok = false; say('Lỗi: ' + e.message); }
  finally {
    busy = false; next = Date.now() + PERIOD * 1000;
    busyUi(false);
    tick(); setTimeout(() => document.body.classList.remove('boot'), 1500);
    if (redo) { redo = false; load(); }
    else if (ok && S.view === 'dash' && !S.full) load(); // Dashboard was opened while another load was running
  }
}

export function tick() {
  if (busy) return;
  const left = Math.max(0, Math.ceil((next - Date.now()) / 1000));
  if (!left) return document.hidden ? undefined : load(true); // background tab: wait until it is visible again
  $('updt').textContent = 'Làm mới';
  $('upd').title = `Cập nhật lúc ${stamp || '--:--'} · bấm để làm mới ngay`;
  $('upd').style.setProperty('--p', (1 - left / PERIOD) * 100); // the pill's border fills up until the next auto refresh
}

export function switchProject() {
  const p = $('project').value;
  lsSet('project', p);
  saveSeen(); loadSeen(p);
  gen++; S.full = null; S.all = []; stateSel.clear(); picked.clear();
  store.active = mkStore(); store.all = mkStore();
  sel.sprint.clear(); sel.assignee = new Set(defaultWho());
  msFill('sprint', []); msFill('assignee', []);
  loadPeople(p).then(refreshMs);
  load();
}

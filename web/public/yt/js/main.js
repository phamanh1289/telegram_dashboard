/* ---------- bootstrap: wire the UI, read config / projects / me, then load the first page of data ---------- */
import { $, esc, lsGet } from './util.js';
import { MOCK, ME, S, T, loadSeen, qp, saveSeen } from './state.js';
import { yt } from './api.js';
import { fetchRows, load, loadPeople, refreshMs, switchProject, tick } from './data.js';
import { restoreFilters, savedFilters } from './persist.js';
import { say } from './ui/status.js';
import { initTheme } from './ui/theme.js';
import { initSidebar, setView, showUser } from './ui/sidebar.js';
import { initFilterBar, initMultiSelects } from './ui/filters.js';
import { initTable } from './ui/table.js';
import { initTooltip } from './ui/tooltip.js';
import { initDrawer } from './ui/drawer.js';
import { initDetail } from './ui/detail.js';
import { initGlobalFind } from './ui/globalFind.js';
import { initKeyboard } from './ui/keyboard.js';
import { initStateChange } from './ui/stateChange.js';

const wireUi = () => [initTheme, initSidebar, initMultiSelects, initFilterBar, initTable, initTooltip, initDrawer, initDetail, initGlobalFind, initKeyboard, initStateChange].forEach((f) => f());

const fillProjects = (ps, wanted) => {
  $('project').innerHTML = ps.map((p) => `<option value="${esc(p.shortName)}" title="${esc(p.name)}">${esc(p.shortName)} · ${esc(p.name)}</option>`).join('');
  $('project').value = ps.some((p) => p.shortName === wanted) ? wanted : (ps.find((p) => p.shortName === 'VA') ? 'VA' : ps[0]?.shortName);
};

export async function boot() {
  wireUi();
  try {
    setView(S.view);
    // start the current user's tickets request at once, in parallel with config/projects/me (only when no other assignee was chosen before)
    const p0 = qp.get('project') || lsGet('project') || 'VA';
    const early = !MOCK && savedFilters().assignee === undefined ? fetchRows('all', p0, ['me']) : null;
    early?.catch(() => {});
    loadPeople(p0);
    let ps, me;
    [S.cfg, ps, me] = await Promise.all([yt.config(), yt.projects(), yt.me()]);
    Object.assign(T, S.cfg.t); // team thresholds from the server (.env YT_WIP / YT_STALE / YT_DEAD)
    T.wip = +lsGet('ytWip') || T.wip; // WIP threshold is picked on the Dashboard (2-5), default 3
    ME.name = me.name;
    if (ME.name) showUser(ME.name);
    fillProjects(ps, p0);
    loadSeen($('project').value);
    addEventListener('pagehide', saveSeen); // closing the tab = everything on screen has been seen
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveSeen(); });
    if ($('project').value !== p0) loadPeople($('project').value);
    $('project').onchange = switchProject;
    restoreFilters();
    S.peopleP.then(() => { if (S.all.length) refreshMs(); });
    $('brand').onclick = $('upd').onclick = () => load();
    setInterval(tick, 1000);
    load(false, early && $('project').value === p0 ? early : null);
  } catch (e) { say('Lỗi: ' + e.message); document.body.classList.remove('loading'); }
}

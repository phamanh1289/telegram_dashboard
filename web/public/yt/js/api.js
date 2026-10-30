/* ---------- server API (+ mock fallbacks) and the ticket-detail cache ---------- */
import { MOCK } from './state.js';
import { mockDetail, mockPeople, mockRows, mockSprints } from './mock.js';

const enc = encodeURIComponent;

export async function api(p, o) {
  const r = await fetch(p, o), j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

const mockOr = (mock, real) => (MOCK ? Promise.resolve(mock()) : real());

export const yt = {
  config: () => api('/api/yt/config'),
  projects: () => api('/api/yt/projects'),
  me: () => mockOr(() => ({ name: null }), () => api('/api/yt/me').catch(() => ({ name: null }))),
  people: (project) => mockOr(mockPeople, () => api('/api/yt/people?project=' + enc(project))),
  sprints: (project) => mockOr(mockSprints, () => api('/api/yt/sprints?project=' + enc(project))),
  // who = list of 'me' | 'unassigned' | login to fetch only those assignees' tickets; null = everyone
  issues: (project, scope, who) => mockOr(() => mockRows(scope), () => api(`/api/yt/issues?project=${enc(project)}&scope=${scope}` + (who ? `&who=${enc(who.join(','))}` : ''))),
  // items = 'id@updated' -> { id: ms the ticket entered its current state }
  since: (items) => mockOr(() => Object.fromEntries(items.map((s) => s.split('@'))), () => api('/api/yt/statesince?items=' + enc(items.join(',')))),
  setAssignee: (id, login) => mockOr(() => ({ id, assignee: login, updated: Date.now() }), () => post('assignee', { id, login })),
};
function post(kind, body) { return api('/api/yt/issue/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

const detCache = new Map(); // id -> Promise of {description, reporter, comments}
export const resetDetails = () => detCache.clear();
export const forgetDetail = (id) => detCache.delete(id);
export const detail = (id) => {
  if (MOCK) return Promise.resolve(mockDetail());
  if (!detCache.has(id)) detCache.set(id, api('/api/yt/issue?id=' + enc(id)).catch((e) => { detCache.delete(id); throw e; }));
  return detCache.get(id);
};

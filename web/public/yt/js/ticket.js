/* ---------- ticket domain rules: title parsing, state / priority colours, workflow buckets, sorting, grouping ---------- */
import { DAY, norm } from './util.js';
import { S, seen } from './state.js';

// every [...] pair in the title becomes a chip (a one-letter prefix such as "C-" is dropped: [C-Agent] -> Agent); the title itself is shown in full
const TAGRE = /\[([^\]]+)\]/g;
export const titleOf = (i) => i._t ??= (() => {
  const s = i.summary || '';
  return { tags: [...s.matchAll(TAGRE)].map((x) => x[1].trim().replace(/^[A-Za-z]-(?=\S)/, '')).filter(Boolean), rest: s };
})();

// state -> colour by tier: slate = not started, blue = working, violet = with QC, teal = built on dev / waiting release, pink = design, green = done, red = blocked (amber is reserved for warnings)
// colours are CSS variables (--st-*), so each theme supplies its own shade
const [S_TODO, S_DOING, S_QC, S_DEV, S_DESIGN, S_DONE, S_BLOCK] = ['todo', 'doing', 'qc', 'dev', 'design', 'done', 'block'].map((k) => `var(--st-${k})`);
const SC = { 'OPENED': S_TODO, 'TO DO': S_TODO, 'IN PROGRESS': S_DOING, 'DESIGN IN PROCESS': S_DESIGN, 'READY FOR TEST': S_QC,
  'QC - QA': S_QC, 'BUILT ON DEV': S_DEV, 'DONE ON DEV': S_DEV, 'WAITING TO RELEASE': S_DEV, 'BLOCKED': S_BLOCK,
  'ASSIGN TO DESIGN': S_DESIGN, 'CONFIRM DESIGN': S_DESIGN, 'ASSIGN TO DEFINE': S_DESIGN, 'DEFINITION IN PROCESS': S_DESIGN, 'CONFIRM DEFINITION': S_DESIGN,
  'QC': S_QC, 'TODO': S_TODO, 'ON HOLD': S_BLOCK, 'DEVELOPMENT APPROVED': S_TODO, 'DONE': S_DONE, 'DONE ON PROD': S_DONE, 'CLOSED': S_DONE };
const SEM = { 'DONE': 'ok', 'DONE ON PROD': 'ok', 'CLOSED': 'ok', 'BLOCKED': 'bad', 'ON HOLD': 'bad' }; // success / danger badges use the shared semantic backgrounds
const up = (s) => String(s || '').toUpperCase();
export const stateColor = (s) => SC[up(s)] || S_TODO;
export const semOf = (s) => SEM[up(s)] || '';

// small outline icon per state (replaces the colour dot); colour comes from --sc
const SI = {
  todo: '<circle cx="12" cy="12" r="9"/>', doing: '<path d="M8 5l11 7-11 7z"/>', design: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  define: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>', qc: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  dev: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>', release: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', block: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  hold: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>', done: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>', reopen: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/>',
};
const SK = { 'OPENED': 'todo', 'TO DO': 'todo', 'TODO': 'todo', 'DEVELOPMENT APPROVED': 'todo', 'IN PROGRESS': 'doing', 'DESIGN IN PROCESS': 'design', 'ASSIGN TO DESIGN': 'design', 'CONFIRM DESIGN': 'design',
  'ASSIGN TO DEFINE': 'define', 'DEFINITION IN PROCESS': 'define', 'CONFIRM DEFINITION': 'define', 'READY FOR TEST': 'qc', 'QC - QA': 'qc', 'QC': 'qc', 'BUILT ON DEV': 'dev', 'DONE ON DEV': 'dev',
  'WAITING TO RELEASE': 'release', 'BLOCKED': 'block', 'ON HOLD': 'hold', 'DONE': 'done', 'DONE ON PROD': 'done', 'CLOSED': 'done', 'REOPENED': 'reopen' };
export const stateIcon = (s) => `<svg class="si" viewBox="0 0 24 24" aria-hidden="true">${SI[SK[up(s)] || 'todo']}</svg>`;

// type -> colour: Bug red; the rest by kind and level (Epic > Story/Feature > Improvement > Task > Sub-task), unknown types stay neutral
const TC = { 'EPIC': 'epic', 'STORY': 'feat', 'USER STORY': 'feat', 'FEATURE': 'feat', 'IMPROVEMENT': 'impr', 'ENHANCEMENT': 'impr', 'TASK': 'task', 'SUB-TASK': 'sub', 'SUBTASK': 'sub', 'SUB TASK': 'sub' };
export const typeColor = (t) => (up(t) === 'BUG' ? 'var(--bad)' : TC[up(t)] ? `var(--ty-${TC[up(t)]})` : 'var(--mut)');

// priority -> colour, row tint % (shown while "Highlight High+" is on), rank (high = strong background and sorted first)
export const PCOL = { Critical: 'var(--p-crit)', Highest: 'var(--p-highest)', High: 'var(--p-high)', Medium: 'var(--p-med)', Low: 'var(--p-low)', Lowest: 'var(--p-lowest)' };
const RANK = { Critical: 0, Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5 };
export const TINT = [16, 12, 8];
export const rank = (i) => RANK[i.priority] ?? 6;

// Dashboard "Cần chú ý" tiles only (the Ticket active quick filters were removed)
export const QUICK = {
  blocked: { label: 'Blocked', fn: (i) => up(i.state) === 'BLOCKED' },
  critical: { label: 'Critical / Highest', fn: (i) => rank(i) <= 1 },
  overdue: { label: 'Quá hạn', fn: (i, now) => !!i.due && i.due < now },
  unassigned: { label: 'Chưa assign', fn: (i) => !i.assignee },
  noest: { label: 'Trong sprint, chưa estimate', fn: (i) => i.sprints.length > 0 && i.estimate == null },
};
export const isFresh = (i) => seen.t > 0 && i.updated > seen.t;

// workflow buckets: 0 todo/opened · 1 being worked on · 2 with QC / waiting for test · 3 done
const QC_ST = new Set(['READY FOR TEST', 'QC - QA', 'QC', 'BUILT ON DEV', 'DONE ON DEV', 'WAITING TO RELEASE']);
const DOING_ST = new Set(['IN PROGRESS', 'DESIGN IN PROCESS', 'CONFIRM DESIGN', 'ASSIGN TO DESIGN', 'BLOCKED']);
export const BUCKET = (i) => { const s = up(i.state); return i.resolved ? 3 : QC_ST.has(s) ? 2 : DOING_ST.has(s) ? 1 : 0; };
export const TIER_LABEL = ['Todo / Opened', 'Đang làm', 'QC / Chờ test'];

// table columns, sort keys, grouping
export const COLS = [['id', 'ID'], ['type', 'Type'], ['summary', 'Tiêu đề'], ['state', 'State'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['qc', 'QC'], ['sprint', 'Sprint'], ['due', 'Hạn'], ['updated', 'Cập nhật']];
export const lastSp = (i) => i.sprints[i.sprints.length - 1] || '';
export const KEYS = {
  id: (i) => +i.id.replace(/\D+/g, '') || 0, summary: (i) => norm(titleOf(i).rest), state: (i) => i.state || '', priority: rank,
  type: (i) => i.type || '',
  assignee: (i) => norm(i.assignee || 'zzz'), qc: (i) => norm(i.qc || 'zzz'), sprint: lastSp, updated: (i) => -i.updated, // newest first on ▲
  due: (i) => i.due || 9e15,
};
export const cmp = (a, b) => {
  const f = KEYS[S.sort.k], x = f(a), y = f(b);
  let r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'vi');
  if (S.sort.d === 'desc') r = -r;
  return r || b.updated - a.updated;
};
export const GROUPS = { assignee: (i) => i.assignee || 'Chưa assign', sprint: (i) => lastSp(i) || 'Không sprint', module: (i) => titleOf(i).tags[0] || 'Không module' };

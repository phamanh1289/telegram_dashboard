/* ---------- shared state + constants (objects are mutated, never re-imported by value) ---------- */
import { lsGet, lsSet } from './util.js';

export const qp = new URLSearchParams(location.search); // shared links carry project, filters, sort, group, view
export const MOCK = qp.has('mock'); // ?mock=1 swaps in sample tickets covering every state x priority (to review colours)
export const PERIOD = 60; // auto refresh, seconds
export const CAP = 600;   // rows per page; "Hiện thêm" adds another CAP
export const T = { wip: 4, stale: 7, dead: 30 }; // the team's agreed thresholds (days / ticket counts); the server overrides them
export const ME = { name: null };
export const ANDROID_TEAM = ['Lễ Tất Dũng']; // exact YouTrack full name (login dunglt) // "Android team" = the current user + these people

export const sel = { sprint: new Set(), assignee: new Set() }; // multi-select filters
export const msItems = { sprint: [], assignee: [] };           // options offered by each multi-select
export const stateSel = new Set();     // state chips in Ticket active (empty = all states)
// Dashboard "ticket kéo dài": states to watch (upper-case, saved) + when each ticket entered its state ({ u: updated at fetch, t: since })
const savedAg = (() => { try { return JSON.parse(lsGet('ytAgSt')); } catch {} })();
export const aging = { states: new Set(Array.isArray(savedAg) ? savedAg : ['IN PROGRESS', 'BUILT ON DEV']), since: new Map() };
const savedJson = (k) => { try { return JSON.parse(lsGet(k)); } catch {} };
export const flt = { priority: new Set(), type: new Set() }; // Ticket active: priority / type filters (empty = all); restored by persist.js
export const hiddenCols = new Set(savedJson('ytColsOff') || ['due', 'updated']); // new columns are opt-in // Ticket active: columns switched off in the "Cột" menu
export const folded = new Set();       // collapsed group rows
export const picked = new Set();       // Ticket active: ticket ids ticked for a bulk change

// "new since your last visit": tickets updated after the last time this project was looked at (saved when the tab is hidden / closed)
export const seen = { p: '', t: 0 };
export const loadSeen = (p) => { seen.p = p; seen.t = +lsGet('ytSeen:' + p) || 0; };
export const saveSeen = () => { if (seen.p) lsSet('ytSeen:' + seen.p, Date.now()); };
export const sprintDates = new Map();  // sprint name -> { start, finish } (ms)
export const loginOf = new Map();      // display name -> login

// Data is loaded per assignee: only the current user's tickets at first; others are fetched when they are added to the Người filter.
// store[scope] = tickets fetched so far ('active' = unresolved, 'all' = whole history) + which assignees they cover.
export const mkStore = () => ({ everyone: false, who: new Set(), rows: new Map() });
export const store = { active: mkStore(), all: mkStore() };
export const defaultWho = () => (MOCK || !ME.name ? [] : [ME.name]);

export const S = {
  cfg: {},
  all: [],                 // tickets of the scope on screen
  full: null,              // whole-history tickets (Dashboard); null until the Dashboard has been opened
  view: qp.get('view') === 'dash' ? 'dash' : 'active',
  tier: null,              // workflow tier filter: 0 todo · 1 doing · 2 with QC, set by clicking a chart segment / KPI / WIP row
  sort: { k: 'priority', d: 'asc' },
  cap: CAP,
  shown: [],               // last filtered list (CSV export)
  hiOn: lsGet('ytHi') !== '0', // "Highlight High+" mode
  showRes: lsGet('ytRes') !== '0', // Ticket active: tickets with a resolved time are listed (grey, struck through)
  range: +lsGet('ytRange') || 14, // Dashboard charts: 7 / 14 / 30 days
  peopleP: Promise.resolve([]),
};

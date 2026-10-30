/* ---------- CSV export of the filtered list (not just the rows shown), with the columns currently visible ---------- */
import { when } from './util.js';
import { COLS } from './ticket.js';

const cell = (v) => { v = String(v ?? ''); return '"' + (/^[=+\-@]/.test(v) ? "'" + v : v).replace(/"/g, '""') + '"'; }; // cells starting with = + - @ are neutralised for spreadsheets
const VAL = {
  id: (i) => i.id, type: (i) => i.type, summary: (i) => i.summary, state: (i) => i.state, priority: (i) => i.priority, assignee: (i) => i.assignee,
  qc: (i) => i.qc, sprint: (i) => i.sprints.join('; '), due: (i) => (i.due ? new Date(i.due).toLocaleDateString('vi-VN') : ''), updated: (i) => when(i.updated),
};

export function exportCsv(list, project, keys) {
  keys = ['id', 'summary', ...keys.filter((k) => k !== 'id' && k !== 'summary')]; // ID and title always first
  const name = Object.fromEntries(COLS);
  const rows = [keys.map((k) => name[k]), ...list.map((i) => keys.map((k) => VAL[k](i)))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' })); // BOM: Excel reads the Vietnamese text as UTF-8
  a.download = `tickets-${project}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- small HTML fragments reused by several views ---------- */
import { esc, hue, initials, shortName, shortSp } from '../util.js';
import { semOf, stateColor, stateIcon } from '../ticket.js';

export const MS = { sprint: ['Tất cả sprint', 'Sprint'], assignee: ['Tất cả người', 'Người'] }; // multi-select: [all label, chip / count label]
export const LBL = { sprint: shortSp, assignee: shortName };

export const avatar = (n) => `<b class="av" style="--h:${hue(n)}">${esc(initials(n))}</b>`;
export const person = (n) => n ? `<span class="who" title="${esc(n)}">${avatar(n)}${esc(shortName(n))}</span>` : '<span class="age">—</span>';

// read-only state pill
export const stateSelect = (i) => `<span class="pill stwrap ${semOf(i.state)}" style="--sc:${stateColor(i.state)}" aria-label="Trạng thái: ${esc(i.state || '—')}">${stateIcon(i.state)}<span>${esc(i.state || '—')}</span></span>`;

// trend badge: goodUp = true (up is good) / false (up is bad) / null (neutral)
export const dlt = (c, p, goodUp) => {
  if (c == null || !p) return '';
  const pc = Math.round((c - p) / p * 100);
  if (!pc) return '<small class="dl">0%</small>';
  const up = pc > 0;
  return `<small class="dl${goodUp === null ? '' : up === goodUp ? ' good' : ' bad'}">${up ? '▲' : '▼'} ${Math.abs(pc)}%</small>`;
};

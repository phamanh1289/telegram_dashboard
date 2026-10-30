/* ---------- one render pass: persist filters, then paint the filter bar and the current page ---------- */
import { S } from './state.js';
import { saveFilters } from './persist.js';
import { renderFilterBar } from './views/filterbar.js';
import { renderActive } from './views/active.js';
import { renderDashboard } from './views/dashboard.js';

export function render() {
  saveFilters();
  renderFilterBar();
  const now = Date.now();
  if (S.view === 'active') renderActive(now);
  else if (S.full) renderDashboard(now); // dashboard needs every ticket; load() fetches them when the tab is opened
}

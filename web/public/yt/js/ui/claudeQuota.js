/* ---------- Claude quota pill in the top bar, the same as the Telegram module's (src/components/claude.tsx ClaudeQuota) ---------- */
import { $, esc } from '../util.js';
import { api } from '../api.js';

const byUnit = (m) => (m < 60 ? `${m} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ` : `${Math.floor(m / 1440)} ngày`);
const resetIn = (iso) => byUnit(Math.ceil(Math.max(0, (Date.parse(iso) - Date.now()) / 6e4)));
const tone = (p) => (p >= 90 ? 'bad' : p >= 70 ? 'warn' : '');
const GAUGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>';

async function paint() {
  const a = await api('/api/claude/account').catch(() => null);
  const el = $('cq');
  if (!a) return void (el.hidden = true);
  const top = Math.max(0, ...a.usage.map((u) => u.percent));
  const summary = a.loggedIn
    ? a.usage.map((u) => `${u.label}: ${Math.round(u.percent)}%${u.resets_at ? `, đặt lại sau ${resetIn(u.resets_at)}` : ''}`).join('\n') || 'Claude: đã đăng nhập'
    : 'Claude chưa đăng nhập';
  el.title = summary;
  el.setAttribute('aria-label', `Hạn mức Claude. ${summary}`);
  el.className = 'cq ' + (!a.loggedIn || top >= 90 ? 'bad' : top >= 70 ? 'warn' : 'ok');
  el.innerHTML = GAUGE + (a.loggedIn && a.usage.length
    ? a.usage.slice(0, 2).map((u) => `<span class="u"><b>${esc(u.label)}</b><i class="${tone(u.percent)}"><i style="width:${Math.min(100, u.percent)}%"></i></i><span class="n">${Math.round(u.percent)}%</span>${u.resets_at ? `<span>· ${resetIn(u.resets_at)}</span>` : ''}</span>`).join('')
    : `<span class="u${a.loggedIn ? '' : ' off'}">${a.loggedIn ? 'Claude' : 'Claude chưa đăng nhập'}</span>`);
  el.hidden = false;
}

export function initClaudeQuota() {
  paint();
  setInterval(paint, 5 * 6e4);
}

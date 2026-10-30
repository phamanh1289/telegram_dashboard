/* ---------- DOM / format / storage helpers shared by every module ---------- */
export const $ = (id) => document.getElementById(id);
export const DAY = 864e5;
export const EASE = 'cubic-bezier(.2,.8,.2,1)';
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
export const fmt = (n) => n.toLocaleString('vi-VN');
export const when = (t) => (t ? new Date(t).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export const lsGet = (k) => { try { return localStorage[k]; } catch {} }; // storage can be blocked (private window)
export const lsSet = (k, v) => { try { localStorage[k] = v; } catch {} };

export const hue = (s) => 200 + [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7) % 100; // blue→violet only, never reads as ok / warn / bad
export const shortName = (n) => String(n).trim().split(/\s+/).slice(-2).join(' ');
export const initials = (n) => { const w = String(n).trim().split(/\s+/); return ((w.length > 1 ? w[w.length - 2][0] : '') + w[w.length - 1][0]).toUpperCase(); };
export const shortSp = (s) => s.replace(/^Tuần\s*(\d+)\s*-\s*T(\d+)$/i, 'T$1-T$2');

export const swap = (el) => { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }; // replays the rise animation

// "3 ngày", "5 giờ", "vừa xong"
export const ago = (t) => { const m = (Date.now() - t) / 6e4; return m < 1 ? 'vừa xong' : m < 60 ? `${Math.floor(m)} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ` : `${Math.floor(m / 1440)} ngày`; };

// act = { label, fn }: an action button (e.g. Hoàn tác), the toast then stays 6s instead of 1.5s
export const toast = (m, act) => {
  const t = $('toast'); t.textContent = m;
  if (act) { const b = document.createElement('button'); b.textContent = act.label; b.onclick = () => { t.classList.remove('on'); act.fn(); }; t.append(b); }
  t.classList.toggle('act', !!act); t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), act ? 6000 : 1500);
};
export async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); }
  catch { const a = document.createElement('textarea'); a.value = text; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast(msg);
}

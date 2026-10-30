/* ---------- sidebar (collapse, page switch, current user) ---------- */
import { $, EASE, esc, lsGet, lsSet, reduce, swap, toast } from '../util.js';
import { MOCK, S } from '../state.js';
import { filtersChanged } from '../data.js';
import { avatar } from '../views/cells.js';
import { setTheme } from './theme.js';

const body = document.body;
const phone = () => matchMedia('(max-width: 60rem)').matches; // same test as the CSS, so JS and layout never disagree
const syncInert = () => { $('side').inert = phone() && body.classList.contains('collapsed'); }; // off-canvas menu: keep it out of the tab order

export function setView(v) {
  S.view = v;
  $('ptitle').textContent = v === 'dash' ? 'Dashboard' : 'Ticket active';
  document.querySelectorAll('.vd').forEach((e) => (e.hidden = v !== 'dash'));
  document.querySelectorAll('.va').forEach((e) => (e.hidden = v !== 'active'));
  document.querySelectorAll('#view button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  document.querySelectorAll(v === 'dash' ? '.vd' : '.va').forEach(swap);
  if (!reduce) $('ptitle').animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE });
}

export function showUser(name) {
  $('me').hidden = false;
  $('me').innerHTML = `${avatar(name)}<span>${esc(name)}</span>`;
}

// narrow screens start collapsed
export function initSidebar() {
  const hdr = document.querySelector('header'), hh = () => document.documentElement.style.setProperty('--hh', hdr.offsetHeight + 'px'); // sticky table header sits right under the page header, which wraps on narrow screens
  hh(); new ResizeObserver(hh).observe(hdr);
  $('mockBtn').classList.toggle('on', MOCK);
  $('mockT').textContent = MOCK ? 'Dữ liệu mẫu: Bật' : 'Dữ liệu mẫu: Tắt';
  $('mockBtn').onclick = () => { const u = new URL(location.href); MOCK ? u.searchParams.delete('mock') : u.searchParams.set('mock', '1'); location.href = u; }; // MOCK is read once at load, so reload with the flag flipped
  const saved = lsGet('ytSide');
  body.classList.toggle('collapsed', phone() || (saved ? saved === '1' : matchMedia('(max-width:899px)').matches)); // phones always start with the menu closed
  syncInert(); addEventListener('resize', syncInert);
  $('burger').onclick = () => { lsSet('ytSide', body.classList.toggle('collapsed') ? '1' : '0'); syncInert(); };
  // phones: the menu is an off-canvas drawer, close it after picking a page or tapping the content
  const closeNav = (e) => { if (phone() && !e.target.closest('#burger')) { body.classList.add('collapsed'); syncInert(); } };
  $('side').addEventListener('click', (e) => { if (e.target.closest('#view button')) closeNav(e); });
  document.querySelector('.content').addEventListener('click', closeNav);
  document.querySelectorAll('#view button').forEach((b) => (b.onclick = () => { setView(b.dataset.v); filtersChanged(); })); // renders what is loaded, fetches the other scope only if missing
  // TV: full screen, no menu, bigger type; leaving full screen (Esc) leaves TV mode too
  $('tvBtn').onclick = () => {
    body.classList.add('tv');
    document.documentElement.requestFullscreen?.().catch(() => {});
    toast('Chế độ TV, nhấn Esc để thoát');
  };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) body.classList.remove('tv'); });
  // print / PDF always on the light theme (ink, readability), then back to the user's theme
  let theme = null;
  addEventListener('beforeprint', () => { theme = document.documentElement.dataset.theme; setTheme('light'); });
  addEventListener('afterprint', () => { if (theme) setTheme(theme); });
  $('printBtn').onclick = () => print();
}

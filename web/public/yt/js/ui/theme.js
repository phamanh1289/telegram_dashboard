/* ---------- light / dark toggle (the first paint is handled by theme-boot.js) ---------- */
import { $, lsSet, reduce } from '../util.js';
import { S } from '../state.js';
import { render } from '../render.js';

const root = document.documentElement;
const effTheme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');
// both hooks, like the Telegram module: data-theme for this page, class="dark" for the shared tokens / Tailwind
export const setTheme = (t) => { root.dataset.theme = t; root.classList.toggle('dark', t === 'dark'); };
const THEME_ICON = {
  dark: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>', // shows the sun: click for light
  light: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};
const themeIcon = () => ($('ticon').innerHTML = THEME_ICON[effTheme()]);

export function initTheme() {
  try { localStorage.removeItem('pal'); } catch {}
  themeIcon();
  $('theme').onclick = () => {
    const go = () => {
      setTheme(effTheme() === 'dark' ? 'light' : 'dark');
      lsSet('theme', root.dataset.theme);
      themeIcon(); if (S.all.length) render();
    };
    document.startViewTransition && !reduce ? document.startViewTransition(go) : go(); // cross-fade the whole page instead of a hard cut
  };
}

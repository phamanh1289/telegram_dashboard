/* ---------- loading indicators + error banner ---------- */
import { $, EASE, reduce } from '../util.js';

export const say = (t) => {
  const m = $('msg'), was = m.style.display === 'block';
  m.textContent = t; m.style.display = t ? 'block' : 'none';
  if (t && !was && !reduce) m.animate([{ opacity: 0, transform: 'translateY(-100%)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE });
};

// body = shimmer over the cards, logo = spinning brand mark; the refresh pill always spins
export function busyUi(on, { text = '', body = true, logo = true } = {}) {
  document.body.classList.toggle('loading', on && body);
  $('upd').classList.toggle('run', on); $('uic').classList.toggle('spin', on);
  if (logo) $('logo').classList.toggle('spin', on);
  if (on) $('updt').textContent = text;
}

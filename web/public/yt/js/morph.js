import { reduce, EASE } from './util.js';

export const rowKey = (r, i) => r.dataset.id ?? (r.dataset.g != null ? 'g:' + r.dataset.g : r.dataset.who != null ? 'w:' + r.dataset.who : r.querySelector('th') ? 'head' : 'i' + i);
export function morph(parent, html, { key, sync } = {}) {
  const isT = parent.tagName === 'TABLE';
  key ||= isT ? rowKey : (el, i) => el.dataset.k ?? 'i' + i;
  let kids = parent;
  if (isT) { kids = parent.tBodies[0]; if (!kids) { kids = document.createElement('tbody'); parent.appendChild(kids); } }
  clearTimeout(parent._mt);
  kids.querySelectorAll(':scope > .leave').forEach((el) => el.remove());
  const tpl = document.createElement('template');
  let next;
  if (isT) { tpl.innerHTML = '<table>' + html + '</table>'; next = [...tpl.content.querySelectorAll('tr')]; }
  else { tpl.innerHTML = html; next = [...tpl.content.children]; }
  const old = new Map([...kids.children].map((el, i) => [key(el, i), el]));
  const keys = next.map((el, i) => key(el, i)), keep = new Set(keys);
  const gone = [...old].filter(([k]) => !keep.has(k)).map(([, el]) => el);
  const apply = () => {
    const first = new Map();
    if (!reduce) for (const [k, el] of old) if (keep.has(k)) first.set(k, el.getBoundingClientRect().top);
    gone.forEach((el) => el.remove());
    let n = 0;
    const out = next.map((nr, i) => {
      const ex = old.get(keys[i]), h = nr.innerHTML;
      if (!ex) {
        nr._h = h; nr.classList.add('enter'); nr.style.setProperty('--d', Math.min(n++, 14) * 18 + 'ms');
        nr.addEventListener('animationend', (e) => { if (e.target === nr) nr.classList.remove('enter'); });
        return nr;
      }
      for (const a of [...nr.attributes]) if (ex.getAttribute(a.name) !== a.value) ex.setAttribute(a.name, a.value);
      for (const a of [...ex.attributes]) if (!nr.hasAttribute(a.name)) ex.removeAttribute(a.name);
      if (ex._h !== h) {
        sync ? sync(ex, nr) : (ex.innerHTML = h);
        ex._h = h;
        if (isT && !reduce) { ex.classList.remove('flash'); void ex.offsetWidth; ex.classList.add('flash'); }
      }
      return ex;
    });
    let cur = kids.firstElementChild;
    for (const el of out) { if (el === cur) cur = cur.nextElementSibling; else kids.insertBefore(el, cur); }
    while (cur) { const nx = cur.nextElementSibling; cur.remove(); cur = nx; }
    if (reduce) return;
    for (const [k, top] of first) {
      const el = old.get(k), dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 340, easing: EASE });
    }
  };
  if (!gone.length || reduce) apply();
  else { gone.forEach((el) => el.classList.add('leave')); parent._mt = setTimeout(apply, 150); }
}
export const syncMix = (ex, nr) => { // bug / feature bar: only the widths change
  if (ex.classList.contains('mixbar')) [...ex.children].forEach((c, k) => (c.style.width = nr.children[k].style.width));
  else ex.innerHTML = nr.innerHTML;
};
export const fcKey = (el) => el.dataset.k + '|' + (el.dataset.v ?? '');

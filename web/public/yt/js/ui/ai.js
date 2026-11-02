/* ---------- one AI run at a time, shown in a box: busy line with Hủy, then the answer (Markdown) with Copy ---------- */
import { copy, esc } from '../util.js';
import { MOCK, S } from '../state.js';
import { md } from '../markdown.js';

let ctl = null;
export const aiOn = () => !!S.cfg.ai && !S.cfg.mock && !MOCK; // Claude CLI installed + real YouTrack data
export const stopAi = () => { ctl?.abort(); ctl = null; };

// call(signal) -> { text, ... }; after(result, box) runs once the answer is shown
export async function aiInto(box, label, call, after) {
  stopAi();
  const c = ctl = new AbortController();
  box.hidden = false;
  box.innerHTML = `<div class="aib busy" aria-live="polite"><span class="aidot"></span>${esc(label)}…<button type="button" class="btn ghost">Hủy</button></div>`;
  box.querySelector('button').onclick = () => { stopAi(); box.hidden = true; };
  try {
    const r = await call(c.signal);
    if (c !== ctl) return;
    box.innerHTML = `<div class="aib">${md(r.text || '(trống)')}<div class="aia"><button type="button" class="btn ghost">Copy</button></div></div>`;
    box.querySelector('.aia button').onclick = () => copy(r.text, 'Đã copy');
    after?.(r, box);
  } catch (e) {
    if (c === ctl && e.name !== 'AbortError') box.innerHTML = `<div class="aib err">${esc(e.message)}</div>`;
  } finally { if (c === ctl) ctl = null; }
}

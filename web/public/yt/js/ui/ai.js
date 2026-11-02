/* ---------- one AI run at a time, shown in a box: busy line with Hủy, then the answer (Markdown) with Copy ---------- */
import { $, copy, esc, toast } from '../util.js';
import { MOCK, S } from '../state.js';
import { md } from '../markdown.js';
import { yt } from '../api.js';
import { openPanel } from './drawer.js';

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

// the answer in the side panel
export function aiPanel(title, label, call) {
  openPanel(title, '<div id="dai"></div>');
  aiInto($('dai'), label, call);
}

// one AI review over many tickets: next steps, blockers, what needs a decision / design / info, who to ping
const MAX = 40; // the server's cap: details + comments of each ticket go into one prompt
export function aiTickets(ids, scope) {
  if (!ids.length) { toast('Không có ticket nào để rà soát'); return; }
  if (ids.length > MAX) toast(`Chỉ rà soát ${MAX} / ${ids.length} ticket đầu`);
  aiPanel(`Rà soát · ${scope}`, `AI đang đọc ${Math.min(ids.length, MAX)} ticket`, (sig) => yt.aiTickets(ids.slice(0, MAX), scope, sig));
}

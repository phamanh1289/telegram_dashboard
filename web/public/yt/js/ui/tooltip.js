/* ---------- hover preview of a ticket's description ---------- */
import { $, esc } from '../util.js';
import { detail } from '../api.js';
import { findIssue } from '../query.js';
import { snippet } from '../markdown.js';

let tipT, hoverRow = null, mouseX = 0, mouseY = 0;
const tip = $('tip');

export const hideTip = () => { clearTimeout(tipT); tip.hidden = true; };

function placeTip() {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(mouseX + 16, innerWidth - w - 12)) + 'px';
  tip.style.top = (mouseY + 20 + h > innerHeight ? Math.max(8, mouseY - h - 14) : mouseY + 20) + 'px';
}

async function showTip(id) {
  const i = findIssue(id); if (!i) return;
  const head = `<div class="tt"><span>${esc(id)}</span>${esc(i.summary)}</div><div class="tm"><span>${esc(i.state || '—')}</span><span>${esc(i.priority || '—')}</span><span>${esc(i.assignee || 'Chưa assign')}</span></div>`;
  tip.innerHTML = head + '<div class="ts">Đang tải mô tả…</div>'; tip.hidden = false; placeTip();
  try {
    const d = await detail(id);
    if (hoverRow?.dataset.id !== id) return;
    tip.innerHTML = head + `<div class="ts">${esc(snippet(d.description)) || '<i>Không có mô tả</i>'}</div>`;
  } catch { if (hoverRow?.dataset.id === id) tip.innerHTML = head + '<div class="ts">Không tải được mô tả.</div>'; }
  placeTip();
}

export function initTooltip() {
  const t = $('atable');
  document.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  addEventListener('scroll', hideTip, { passive: true });
  t.addEventListener('mouseover', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) { hoverRow = null; hideTip(); return; }
    if (tr === hoverRow) return;
    hoverRow = tr; hideTip(); tipT = setTimeout(() => showTip(tr.dataset.id), 350);
  });
  t.addEventListener('mouseleave', () => { hoverRow = null; hideTip(); });
}

/* ---------- empty state: look a ticket up by ID anywhere in YouTrack (opens the drawer; nothing is merged into the loaded data) ---------- */
import { $ } from '../util.js';
import { detail } from '../api.js';
import { openDrawer } from './drawer.js';

const ticketId = (s) => { s = s.trim().toUpperCase(); return /^\d+$/.test(s) ? `${$('project').value}-${s}` : /^[A-Z][A-Z0-9_]*-\d+$/.test(s) ? s : null; };
let seq = 0; // a newer search makes older answers stale

async function globalFind() {
  const id = ticketId($('gid').value), me = ++seq;
  if (!id) { $('gerr').textContent = 'Nhập số ticket hoặc ID dạng VA-123.'; return; }
  $('gerr').textContent = `Đang tìm ${id}…`; $('gbtn').disabled = true;
  try { await detail(id); if (me !== seq) return; $('gerr').textContent = ''; openDrawer(id); }
  catch (e) { if (me === seq) $('gerr').textContent = `Không tìm thấy ${id} (${e.message})`; }
  finally { if (me === seq) $('gbtn').disabled = false; }
}

export function initGlobalFind() {
  $('gbtn').onclick = globalFind;
  $('gid').addEventListener('keydown', (e) => { if (e.key === 'Enter') globalFind(); });
  $('gid').addEventListener('input', () => { $('gid').dataset.t = '1'; }); // user typed: stop auto-filling from the search box
}

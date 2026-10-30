/* ---------- tiny YouTrack-markdown renderer for ticket descriptions / comments ---------- */
import { esc } from './util.js';

const IMG = /!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g;

export const md = (s) => esc(s || '').replace(IMG, '[ảnh]')
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a target="_blank" rel="noopener" href="$2">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');

export const snippet = (s) => { const t = (s || '').replace(IMG, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`#>_]/g, '').replace(/\s+/g, ' ').trim(); return t.length > 320 ? t.slice(0, 320) + '…' : t; };

/* ---------- sample data for ?mock=1: every state x priority combination ---------- */
import { DAY } from './util.js';

export const mockDetail = () => ({ description: 'Mô tả **mẫu** của ticket mock.\n\n1. Bước một\n2. Bước hai', reporter: 'Mock', comments: [],
  links: [{ rel: 'subtask of', issues: [{ id: 'MOCK-1', summary: 'Ticket cha mẫu', resolved: null }] }, { rel: 'relates to', issues: [{ id: 'MOCK-2', summary: 'Ticket liên quan đã xong', resolved: 1 }] }] });

const WHO = ['Nguyễn Thanh Bình', 'Lê Hồng Lĩnh', 'Trần Thị Mùi', 'Phạm Tuấn Anh', 'Đinh Hữu Luận', null];
export const mockPeople = () => WHO.filter(Boolean).map((n) => ({ login: n, name: n }));
// weekly sprints, the newest one running now
export const mockSprints = () => { const now = Date.now(); return [4, 3, 2].map((w, k) => ({ name: `Tuần ${w} - T10`, start: now - (3 + 7 * k) * DAY, finish: now + (3 - 7 * k) * DAY })); };

export function mockRows(scope) {
  const STATES = ['OPENED', 'TO DO', 'IN PROGRESS', 'Design in Process', 'READY FOR TEST', 'QC - QA', 'BUILT ON DEV', 'DONE ON DEV', 'WAITING TO RELEASE',
    'BLOCKED', 'ASSIGN TO DESIGN', 'Confirm DESIGN', 'DONE', 'DONE ON PROD', 'CLOSED', 'REOPENED'];
  const PR = ['Critical', 'Highest', 'High', 'Medium', 'Low', 'Lowest', null];
  const SPR = ['Tuần 4 - T10', 'Tuần 3 - T10', 'Tuần 2 - T10'];
  const TAG = ['[Android] [C-Bank] ', '[iOS] [C-Agent] ', '[BE] [C-Portal] ', '[WEB] ', ''];
  const AGE = [0, 3, 10, 20, 40, 120], now = Date.now(), rows = [];
  STATES.forEach((s, si) => PR.forEach((p, k) => {
    const age = AGE[(si + k) % 6];
    rows.push({ id: `MOCK-${rows.length + 1}`, summary: `${TAG[(si + k) % 5]}Ticket mẫu · state ${s} · ${p || 'không priority'}`, created: now - (age + 30) * DAY, updated: now - age * DAY,
      resolved: scope === 'all' && ['DONE', 'DONE ON PROD', 'CLOSED'].includes(s) ? now - age * DAY : null, type: 'Task', state: s, priority: p, assignee: WHO[(si + k) % 6], qc: WHO[(si + k + 2) % 6], sprints: [SPR[si % 3]], spent: 0,
      due: k % 3 === 0 ? now + ((si % 5) - 2) * DAY : null, ...(k === 4 && { type: 'Bug' }), ...(k === 5 && { type: 'Feature' }) });
  }));
  return rows; // 'active' scope: all unresolved, so every state shows in Ticket active; 'all' scope also marks the DONE-type states resolved
}

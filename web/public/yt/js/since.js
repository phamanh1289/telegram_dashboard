/* ---------- when each ticket entered its current state (server reads the activity log); shared by the Dashboard aging tile and the Ticket active "Ở state" column ---------- */
import { aging } from './state.js';
import { yt } from './api.js';
import { render } from './render.js';

const tried = new Set(); // id@updated already requested, so a ticket the server could not answer is not retried in a loop
let loading = 0, chain = Promise.resolve();

export const sinceLoading = () => loading > 0;
export const sinceOf = (i) => { const e = aging.since.get(i.id); return e && e.u === i.updated ? e.t : null; }; // ms, null = not loaded yet

// fetch what is missing, 100 tickets per request and one request at a time; repaint after each batch
export function loadSince(tickets) {
  const todo = tickets.filter((i) => sinceOf(i) == null && !tried.has(i.id + '@' + i.updated));
  for (let n = 0; n < todo.length; n += 100) {
    const batch = todo.slice(n, n + 100);
    batch.forEach((i) => tried.add(i.id + '@' + i.updated)); loading++;
    chain = chain.then(() => yt.since(batch.map((i) => i.id + '@' + i.updated))
      .then((r) => { for (const i of batch) if (r[i.id] != null) aging.since.set(i.id, { u: i.updated, t: +r[i.id] || i.created || i.updated }); })
      .catch(() => {}).finally(() => { loading--; render(); }));
  }
}

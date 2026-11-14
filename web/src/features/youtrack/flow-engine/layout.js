import { normalize, parents } from './model.js';
import { COL, GROUP_GAP, ROW, SHIFT } from './constants.js';
import { scr, startOf } from './values.js';

/** Fills x / y of screens that have none; returns a new flow (the input is not touched; x / y already set stay).
 *  - Regions, left to right: the main flow (BFS over `navigate` links from the first screen), then every other
 *    linked group (BFS from its own root: a screen nothing else in the group leads to), ordered by first
 *    appearance, then the screens with no links of their own as a grid.
 *  - In a region a BFS layer is a column, in order of appearance; a column longer than the row cap wraps into
 *    sub-columns beside it. Cap = max(3, ceil(√(0.4·n))) for n screens: a frame cell is 610 × 964, so this many
 *    rows makes a full grid about 16 : 10, landscape like the screens it is read on.
 *  - The k-th popup / sheet / toast of a parent sits 60·k / 60·k right-down of it; the parent's row and its column
 *    grow by that much, so overlays never cover another screen. */
function layout(flow) {
  const f = normalize(flow);
  const by = new Map(f.screens.map((s) => [s.id, s]));
  const par = parents(f);
  const owner = (id) => { for (let n = 0; par.get(id) && n < 20; n++) id = par.get(id); return id; };

  // overlay offsets: nth among its parent's overlays, cumulated up to the owner screen; room = owner's largest
  const nth = new Map(), count = new Map(), off = new Map(), room = new Map();
  for (const s of f.screens) {
    const p = par.get(s.id);
    if (p) { count.set(p, (count.get(p) || 0) + 1); nth.set(s.id, count.get(p)); }
  }
  const offOf = (id, guard = 0) => {
    if (!par.get(id) || guard > 20) return 0;
    if (!off.has(id)) off.set(id, offOf(par.get(id), guard + 1) + SHIFT * nth.get(id));
    return off.get(id);
  };
  for (const s of f.screens) if (par.get(s.id)) room.set(owner(s.id), Math.max(room.get(owner(s.id)) || 0, offOf(s.id)));

  // navigate links between top-level screens (an overlay's links count as its owner's)
  const next = new Map();
  for (const l of f.links) {
    const a = owner(scr(l.src)), b = owner(l.to);
    if ((l.act !== "navigate" && !(l.act === "open" && !par.get(l.to))) || a === b) continue;
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  }
  const tops = f.screens.filter((s) => !par.get(s.id)).map((s) => s.id);
  const order = new Map(tops.map((id, i) => [id, i]));
  const cap = Math.max(3, Math.ceil(Math.sqrt(0.4 * tops.length)));
  const done = new Set();
  /** BFS layers from `root` over screens no region has taken yet; each layer in order of appearance. */
  function layers(root) {
    const out = [[root]];
    done.add(root);
    for (;;) {
      const n = [];
      for (const id of out[out.length - 1]) for (const k of next.get(id) || []) if (!done.has(k)) { done.add(k); n.push(k); }
      if (!n.length) return out;
      out.push(n.sort((p, q) => order.get(p) - order.get(q)));
    }
  }
  const regions = [];
  if (tops.length) regions.push(layers(owner(startOf(f))));
  const rest = tops.filter((id) => !done.has(id)), led = new Set(); // led: something else left over leads to it
  for (const id of rest) for (const k of next.get(id) || []) if (!done.has(k)) led.add(k);
  const linkedTo = new Set([...next.keys(), ...[...next.values()].flat()]); // has a navigate edge, either way
  const groups = [], lone = [];
  for (const id of [...rest.filter((r) => !led.has(r)), ...rest]) { // true roots first; then what cycles left
    if (done.has(id)) continue;
    const g = layers(id);
    if (g.length > 1 || linkedTo.has(id)) groups.push(g); // a root whose target another group took is still linked
    else lone.push(id);
  }
  const first = (g) => Math.min(...g.flat().map((id) => order.get(id)));
  regions.push(...groups.sort((p, q) => first(p) - first(q)));
  if (lone.length) regions.push([lone.sort((p, q) => order.get(p) - order.get(q))]); // one long column: wraps into a grid

  let x = 0;
  regions.forEach((cols, r) => {
    if (r) x += GROUP_GAP;
    for (const col of cols) {
      for (let i = 0; i < col.length; i += cap) {
        const part = col.slice(i, i + cap).map((id) => by.get(id));
        let y = 0;
        for (const s of part) {
          if (s.x === null || s.y === null) { s.x = x; s.y = y; }
          y += ROW + (room.get(s.id) || 0);
        }
        x += COL + Math.max(...part.map((s) => room.get(s.id) || 0));
      }
    }
  });

  const place = (s, guard) => {
    if ((s.x !== null && s.y !== null) || guard > 20) return;
    const p = by.get(par.get(s.id));
    place(p, guard + 1);
    s.x = (p.x ?? 0) + SHIFT * nth.get(s.id);
    s.y = (p.y ?? 0) + SHIFT * nth.get(s.id);
  };
  for (const s of f.screens) if (par.get(s.id)) place(s, 0);
  return f;
}
/** What every screen title starts with, cut back to a word break ("Ban-TSCNY "): frame labels drop it so the part
 *  that tells screens apart is what fits. "" when screens share nothing or it would leave a title empty. */
function sharedLead(f) {
  const titles = f.screens.filter((s) => s.kind === "screen").map((s) => s.title);
  if (titles.length < 2) return "";
  let p = titles[0];
  for (const x of titles) while (!x.startsWith(p)) p = p.slice(0, -1);
  p = p.slice(0, p.lastIndexOf(" ") + 1);
  return titles.some((x) => !x.slice(p.length).trim()) ? "" : p;
}

export { layout, sharedLead };

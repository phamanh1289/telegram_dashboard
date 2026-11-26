/** Geometry of the team workflow canvas (Settings › YouTrack › Workflow): where Tự xếp puts the boxes, and how the arrows run
 *  (square corners, around the boxes). Pure: positions in, positions / paths out. */

export type Pt = [number, number];
export const W = 150, H = 36, GX = 220, GY = 106, PAD = 32; // box size; grid step: gaps of 70 hold 4 lanes 14 apart (M, 2M from each side)
export const key = (e: [string, string]) => `${e[0]}\u0000${e[1]}`;

const START = /^(open|opened|new|submitted|backlog|to ?do)$/i;

/** One row per step down the flow (BFS from a state named like a start, else the one fewest arrows lead to: a flow is often a
 *  loop, Closed → Open), ordered within the row to cross fewer arrows (barycenter sweeps), each box above the mean of the boxes it
 *  links to above so chains run straight down. Boxes with no arrow go last, `cols` per row.
 *  ponytail: barycenter heuristic, not optimal crossing minimisation; drag boxes by hand for the rest. */
export function layout(states: string[], edges: [string, string][], cols: number) {
  edges = edges.filter(([s, t]) => s !== t && states.includes(s) && states.includes(t));
  const inN = (s: string) => edges.filter(([, t]) => t === s).length;
  const level = new Map<string, number>();
  for (;;) {
    const left = states.filter((s) => !level.has(s) && edges.some((e) => e.includes(s)));
    if (!left.length) break;
    const start = left.find((s) => START.test(s.trim())) ?? left.reduce((a, b) => (inN(b) < inN(a) ? b : a));
    const queue = [start];
    level.set(start, 0);
    for (let k = 0; k < queue.length; k++)
      for (const [a, b] of edges) if (a === queue[k] && !level.has(b)) { level.set(b, level.get(a)! + 1); queue.push(b); }
  }
  const rows: string[][] = Array.from({ length: Math.max(-1, ...level.values()) + 1 }, () => []);
  for (const s of states) if (level.has(s)) rows[level.get(s)!].push(s);
  const nb = new Map(states.map((s) => [s, [] as string[]]));
  for (const [a, b] of edges) { nb.get(a)!.push(b); nb.get(b)!.push(a); }
  const idx = new Map<string, number>();
  rows.forEach((r) => r.forEach((s, i) => idx.set(s, i)));
  const mean = (s: string, pick: (t: string) => boolean, at: Map<string, number>) => {
    const n = nb.get(s)!.filter(pick);
    return n.length ? n.reduce((a, t) => a + at.get(t)!, 0) / n.length : null;
  };
  for (let k = 0; k < 7; k++) { // down, up, … down: each row ordered by where its links sit in the rows already swept
    const down = k % 2 === 0;
    for (const r of down ? rows.slice(1) : rows.slice(0, -1).reverse()) {
      const L = level.get(r[0])!, at = new Map(r.map((s, i) => [s, mean(s, (t) => (down ? level.get(t)! < L : level.get(t)! > L), idx) ?? i]));
      r.sort((u, v) => at.get(u)! - at.get(v)!).forEach((s, i) => idx.set(s, i));
    }
  }
  const col = new Map<string, number>(), from = new Map(states.map((s) => [s, edges.filter(([, b]) => b === s).map(([a]) => a)]));
  for (const r of rows) { // under the states one step up that lead to it, else the mean of its links placed above
    const want = r.map((s) => {
      const up = from.get(s)!.filter((t) => level.get(t) === level.get(s)! - 1);
      return up.length ? up.reduce((a, t) => a + col.get(t)!, 0) / up.length : mean(s, (t) => col.has(t), col);
    }), got: number[] = [];
    r.forEach((_, i) => got.push(Math.max(i ? got[i - 1] + 1 : -Infinity, Math.round(want[i] ?? (i ? got[i - 1] + 1 : 0)))));
    const miss = want.flatMap((w, i) => (w === null ? [] : [w - got[i]])); // pushed right by a neighbour: back toward the mean
    const shift = miss.length ? Math.round(miss.reduce((a, b) => a + b, 0) / miss.length) : 0;
    r.forEach((s, i) => col.set(s, got[i] + shift));
  }
  const min = Math.min(0, ...col.values());
  const pos: Record<string, Pt> = {};
  rows.forEach((r, L) => r.forEach((s) => { pos[s] = [PAD + (col.get(s)! - min) * GX, PAD + L * GY]; }));
  const rest = states.filter((s) => !level.has(s));
  rest.forEach((s, i) => { pos[s] = [PAD + (i % cols) * GX, PAD + (rows.length + Math.floor(i / cols)) * GY]; });
  return pos;
}

// lane distance from a box; cost of a corner; of running on / against another arrow's line (end to end reads as one arrow);
// of crossing one (fine, but fewer is tidier)
const M = 14, BEND = 28, SHARED = 300, TOUCH = 150, CROSSING = 16;
const DIR: Pt[] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // a box side, and the heading out of it: top right bottom left

/** Every arrow's path by `key`, with its middle (for the × of a picked one). An arrow leaves / enters square to a side (down the
 *  flow bottom → top, along a row side → side), arrows sharing a side spread along it, and the rest runs on lanes `M` / 2`M` off the
 *  boxes: the cheapest way by length, corners and lanes another arrow already uses (A* over the lanes' crossings), never through a
 *  box. `boxes`: the ones drawn (a hidden state keeps its place in `pos` but is no obstacle). */
export function routes(edges: [string, string][], pos: Record<string, Pt>, boxes: string[]) {
  const on = boxes.filter((s) => pos[s]), drawn = new Set(on);
  const plan = edges.filter(([a, b]) => a !== b && drawn.has(a) && drawn.has(b)).map((e) => {
    const [a, b] = [pos[e[0]], pos[e[1]]], dx = b[0] - a[0], dy = b[1] - a[1];
    const sides: [number, number] = dy >= H ? [2, 0] : dy <= -H ? [0, 2] : dx > 0 ? [1, 3] : [3, 1];
    return { e, k: key(e), sides };
  });
  const off = new Map<string, number>(), groups = new Map<string, { k: string; at: number }[]>();
  for (const p of plan) p.sides.forEach((side, end) => {
    const g = `${p.e[end]}\u0000${side}`, other = pos[p.e[1 - end]];
    (groups.get(g) ?? groups.set(g, []).get(g)!).push({ k: p.k + end, at: side % 2 ? other[1] : other[0] });
  });
  for (const [g, list] of groups) {
    const step = list.length > 1 ? Math.min(16, ((+g.slice(-1) % 2 ? H : W) * 0.6) / (list.length - 1)) : 0;
    list.sort((u, v) => u.at - v.at).forEach((u, i) => off.set(u.k, (i - (list.length - 1) / 2) * step));
  }
  const port = (s: string, side: number, o: number): Pt => {
    const [x, y] = pos[s];
    return side === 0 ? [x + W / 2 + o, y] : side === 2 ? [x + W / 2 + o, y + H] : side === 1 ? [x + W, y + H / 2 + o] : [x, y + H / 2 + o];
  };
  const r = (v: number) => Math.round(v * 2) / 2, stub = (p: Pt, side: number): Pt => [r(p[0] + DIR[side][0] * M), r(p[1] + DIR[side][1] * M)];
  const ends = plan.map((p) => {
    const p0 = port(p.e[0], p.sides[0], off.get(p.k + 0) ?? 0), p3 = port(p.e[1], p.sides[1], off.get(p.k + 1) ?? 0);
    return { ...p, p0, p3, s0: stub(p0, p.sides[0]), s3: stub(p3, p.sides[1]) };
  });
  // the lanes: around every box (and through its middle, so no step jumps over one), and through every arrow's ends
  const xs = new Set<number>(), ys = new Set<number>();
  for (const s of on) {
    const [x, y] = pos[s];
    for (const v of [x - 2 * M, x - M, x + W / 2, x + W + M, x + W + 2 * M]) xs.add(r(v));
    for (const v of [y - 2 * M, y - M, y + H / 2, y + H + M, y + H + 2 * M]) ys.add(r(v));
  }
  for (const p of ends) for (const q of [p.s0, p.s3]) { xs.add(q[0]); ys.add(q[1]); }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b), nx = X.length, ny = Y.length;
  const ix = new Map(X.map((v, i) => [v, i])), iy = new Map(Y.map((v, i) => [v, i]));
  const blocked = new Uint8Array(nx * ny);
  for (const s of on) {
    const [x, y] = pos[s];
    for (let j = 0; j < ny; j++) if (Y[j] > y - M + 0.1 && Y[j] < y + H + M - 0.1)
      for (let i = 0; i < nx; i++) if (X[i] > x - M + 0.1 && X[i] < x + W + M - 0.1) blocked[j * nx + i] = 1;
  }
  const used = new Set<number>(); // lane pieces taken: (node * 2) + 0 the one to its right, + 1 the one below
  const axis = new Uint8Array(nx * ny); // per crossing, the arrows already through it: 1 across, 2 up / down
  const stubs = new Uint8Array(nx * ny); // and every arrow's run out of / into its box, known before any is routed
  const at = (q: Pt) => iy.get(q[1])! * nx + ix.get(q[0])!;
  for (const p of ends) { stubs[at(p.s0)] |= p.sides[0] % 2 ? 1 : 2; stubs[at(p.s3)] |= p.sides[1] % 2 ? 1 : 2; }
  const seg = (a: number, b: number) => Math.min(a, b) * 2 + (Math.abs(a - b) === 1 ? 0 : 1);

  /** Cheapest lane walk from node `a` heading `h0` to node `b`, arriving heading `h1` (into the box). */
  function walk(a: number, h0: number, b: number, h1: number): number[] | null {
    const cost = new Float64Array(nx * ny * 4).fill(Infinity), from = new Int32Array(nx * ny * 4).fill(-1);
    const bi = b % nx, bj = (b - bi) / nx, taken = (q: number) => axis[q] | (q === a || q === b ? 0 : stubs[q]); // not its own ends
    const heap: [number, number][] = []; // [estimate, state = node * 4 + heading], a binary min-heap
    const push = (f: number, st: number) => {
      heap.push([f, st]);
      for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, rr = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    cost[a * 4 + h0] = 0;
    push(0, a * 4 + h0);
    while (heap.length) {
      const [f, st] = pop(), n = st >> 2, h = st & 3, c = cost[st];
      if (f > c + Math.abs(X[n % nx] - X[bi]) + Math.abs(Y[(n - (n % nx)) / nx] - Y[bj]) + 1e-6) continue; // stale: a cheaper way came since
      if (n === b) { const path = [n]; for (let s = st; from[s] >= 0; s = from[s]) path.push(from[s] >> 2); return path.reverse(); }
      const i = n % nx, j = (n - i) / nx;
      for (let d = 0; d < 4; d++) {
        if (d === (h + 2) % 4) continue; // no turning back on itself
        const ni = i + DIR[d][0], nj = j + DIR[d][1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const m = nj * nx + ni;
        if (blocked[m] && m !== b) continue;
        const ax = d % 2 ? 1 : 2, near = (taken(n) | taken(m)) & ax ? TOUCH : taken(m) ? CROSSING : 0;
        const nc = c + Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]) + (d !== h ? BEND : 0) + (used.has(seg(n, m)) ? SHARED : 0) + near + (m === b && d !== h1 ? BEND : 0);
        if (nc < cost[m * 4 + d]) {
          cost[m * 4 + d] = nc; from[m * 4 + d] = st;
          push(nc + Math.abs(X[ni] - X[bi]) + Math.abs(Y[nj] - Y[bj]), m * 4 + d);
        }
      }
    }
    return null;
  }

  const out = new Map<string, ReturnType<typeof path> & { ok: boolean }>();
  const lines: { k: string; ok: boolean; pts: Pt[] }[] = [];
  const far = (p: (typeof ends)[number]) => Math.abs(p.s0[0] - p.s3[0]) + Math.abs(p.s0[1] - p.s3[1]);
  for (const p of [...ends].sort((u, v) => far(u) - far(v))) { // short ones first: the long ones go around them
    const a = at(p.s0), b = at(p.s3);
    const nodes = walk(a, p.sides[0], b, (p.sides[1] + 2) % 4);
    if (nodes) {
      for (let k = 1; k < nodes.length; k++) {
        const ax = Math.abs(nodes[k] - nodes[k - 1]) === 1 ? 1 : 2;
        used.add(seg(nodes[k - 1], nodes[k])); axis[nodes[k - 1]] |= ax; axis[nodes[k]] |= ax;
      }
      axis[a] |= p.sides[0] % 2 ? 1 : 2; axis[b] |= p.sides[1] % 2 ? 1 : 2; // the runs out of / into the boxes
    }
    lines.push({ k: p.k, ok: !!nodes, pts: simplify([p.p0, ...(nodes ? nodes.map((n): Pt => [X[n % nx], Y[(n - (n % nx)) / nx]]) : [p.s0, p.s3]), p.p3]) });
  }
  nudge(lines.map((l) => l.pts));
  for (const l of lines) out.set(l.k, { ...path(l.pts), ok: l.ok });
  return out;
}

/** The corners of a line: no repeated point, none in the middle of a straight run. */
function simplify(raw: Pt[]) {
  const uniq = raw.filter((q, i) => !i || q[0] !== raw[i - 1][0] || q[1] !== raw[i - 1][1]);
  return uniq.filter((q, i) => {
    const a = uniq[i - 1], b = uniq[i + 1];
    return !a || !b || (a[0] - q[0]) * (b[1] - q[1]) - (a[1] - q[1]) * (b[0] - q[0]) !== 0;
  });
}

/** What the lanes could not keep apart: a run between two corners lying on (or end to end with) another arrow's run moves a few
 *  px aside, so two arrows never read as one. Runs out of / into a box stay (they are the box's spread ports). */
function nudge(lines: Pt[][]) {
  const on = (a: Pt, b: Pt, n: number) => {
    const k = a[1] === b[1] ? 1 : 0, j = 1 - k; // k: the coordinate the run keeps, j: the one it runs along
    return lines.some((o, m) => m !== n && o.some((c, i) => {
      const d = o[i + 1];
      return !!d && c[k] === d[k] && c[j] !== d[j] && Math.abs(c[k] - a[k]) < 3
        && Math.min(Math.max(a[j], b[j]), Math.max(c[j], d[j])) - Math.max(Math.min(a[j], b[j]), Math.min(c[j], d[j])) > -3;
    }));
  };
  lines.forEach((pts, n) => {
    for (let i = 1; i + 2 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]], h = a[1] === b[1];
      if (!on(a, b, n)) continue;
      for (const s of [5, -5, 9, -9]) {
        const a2: Pt = h ? [a[0], a[1] + s] : [a[0] + s, a[1]], b2: Pt = h ? [b[0], b[1] + s] : [b[0] + s, b[1]];
        if (!on(a2, b2, n)) { pts[i] = a2; pts[i + 1] = b2; break; }
      }
    }
  });
}

/** A line through its corners `pts`, rounded, and the point halfway along it. */
function path(pts: Pt[]) {
  const len = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const toward = (a: Pt, b: Pt, t: number): Pt => { const l = len(a, b) || 1; return [a[0] + ((b[0] - a[0]) * t) / l, a[1] + ((b[1] - a[1]) * t) / l]; };
  let d = `M${pts[0]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]], rad = Math.min(8, len(a, b) / 2, len(b, c) / 2);
    d += ` L${toward(b, a, rad)} Q${b} ${toward(b, c, rad)}`;
  }
  d += ` L${pts.at(-1)}`;
  let half = pts.slice(1).reduce((s, q, i) => s + len(pts[i], q), 0) / 2, mid = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const l = len(pts[i - 1], pts[i]);
    if (half <= l) { mid = toward(pts[i - 1], pts[i], half); break; }
    half -= l;
  }
  return { d, mid, pts };
}

const CROSS = 120, OVERLAP = 300; // what one arrow crossing / lying on another costs in Tự xếp, in px of length

/** How tidy the routed arrows are: total length, plus `BEND` a corner, `CROSS` a crossing, `OVERLAP` two arrows on one line, a lot
 *  for one with no way through. */
function score(edges: [string, string][], pos: Record<string, Pt>, boxes: string[]) {
  let total = 0;
  const h: [number, number, number, number][] = [], v: [number, number, number, number][] = []; // [fixed, from, to, arrow]
  [...routes(edges, pos, boxes).values()].forEach((r, n) => {
    if (!r.ok) total += 2000;
    total += (r.pts.length - 2) * BEND;
    for (let i = 1; i < r.pts.length; i++) {
      const [a, b] = [r.pts[i - 1], r.pts[i]];
      total += Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      if (a[1] === b[1]) h.push([a[1], Math.min(a[0], b[0]), Math.max(a[0], b[0]), n]);
      else if (a[0] === b[0]) v.push([a[0], Math.min(a[1], b[1]), Math.max(a[1], b[1]), n]);
    }
  });
  for (const [y, x1, x2, n] of h) for (const [x, y1, y2, m] of v)
    if (n !== m && x > x1 + 0.5 && x < x2 - 0.5 && y > y1 + 0.5 && y < y2 - 0.5) total += CROSS;
  for (const runs of [h, v]) runs.forEach(([c, a1, a2, n], i) => {
    for (const [d, b1, b2, m] of runs.slice(i + 1)) if (n !== m && Math.abs(c - d) < 3 && Math.min(a2, b2) - Math.max(a1, b1) > -3) total += OVERLAP;
  });
  return total;
}

/** Tự xếp: `layout`, then each box tried in every column of its row and the cells around it (moved to a free one, or swapped
 *  with the box there), kept where the routed arrows come out shorter, with fewer corners and crossings, and a step of the flow
 *  never above the one before it (beside it is fine); again while a pass still improves.
 *  ponytail: greedy local search (one box at a time), stops after 6 passes or ~0.6 s on a huge flow. */
export function arrange(states: string[], edges: [string, string][], cols: number) {
  const pos = layout(states, edges, cols);
  edges = edges.filter(([a, b]) => a !== b && states.includes(a) && states.includes(b));
  const linked = states.filter((s) => edges.some((e) => e.includes(s)));
  if (!linked.length) return pos;
  const step = new Map(linked.map((s) => [s, pos[s][1]])); // the row `layout` gave: the step down the flow
  const ahead = edges.filter(([a, b]) => step.get(b)! > step.get(a)!);
  const fit = () => (ahead.some(([a, b]) => pos[b][1] < pos[a][1]) ? Infinity : score(edges, pos, states)); // a step above the one before: never
  const top = Math.min(...step.values()), bottom = Math.max(...step.values());
  const t0 = performance.now();
  let best = fit();
  for (let pass = 0; pass < 6 && performance.now() - t0 < 600; pass++) {
    let better = false;
    const xs = linked.map((s) => pos[s][0]), lo = Math.min(...xs) - GX, hi = Math.max(...xs) + GX;
    for (const s of linked) {
      const [x0, y0] = pos[s], cells: Pt[] = [];
      for (let x = lo; x <= hi; x += GX) cells.push([x, y0]);
      for (const y of [y0 - GY, y0 + GY]) if (y >= top && y <= bottom) for (const x of [x0 - GX, x0, x0 + GX]) cells.push([x, y]);
      for (const [x, y] of cells) {
        const [wx, wy] = pos[s];
        if (x === wx && y === wy) continue;
        const t = linked.find((u) => u !== s && pos[u][0] === x && pos[u][1] === y);
        pos[s] = [x, y];
        if (t) pos[t] = [wx, wy];
        const sc = fit();
        if (sc < best - 0.5) { best = sc; better = true; continue; }
        pos[s] = [wx, wy];
        if (t) pos[t] = [x, y];
      }
    }
    if (!better) break;
  }
  // back against the left edge, empty rows (all boxes moved out) closed up
  const shift = PAD - Math.min(...linked.map((s) => pos[s][0]));
  const ys = [...new Set(linked.map((s) => pos[s][1]))].sort((a, b) => a - b);
  for (const s of linked) pos[s] = [pos[s][0] + shift, top + ys.indexOf(pos[s][1]) * GY];
  return pos;
}

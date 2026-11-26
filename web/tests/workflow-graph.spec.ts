import { expect, test } from "@playwright/test";
import { arrange, H, key, layout, type Pt, routes, W } from "../src/features/youtrack/lib/workflow-graph";

// Settings › YouTrack › Workflow geometry (no page): Tự xếp and the square-cornered arrows.
const S = ["Open", "In Progress", "Code Review", "Blocked", "Ready for Test", "Testing", "Reopened", "Verified", "Done", "Closed", "Won't fix", "Duplicate"];
const E: [string, string][] = [["Open", "In Progress"], ["In Progress", "Code Review"], ["Code Review", "In Progress"], ["Code Review", "Ready for Test"],
  ["Ready for Test", "Testing"], ["Testing", "Reopened"], ["Reopened", "In Progress"], ["Testing", "Verified"], ["Verified", "Done"], ["Done", "Reopened"],
  ["Open", "Won't fix"], ["In Progress", "Blocked"], ["Blocked", "In Progress"], ["Testing", "Blocked"], ["Open", "Duplicate"], ["Verified", "Closed"],
  ["Closed", "Reopened"], ["Done", "Closed"]];

test("Tự xếp: one row per step, no overlap, the main chain straight down", () => {
  const pos = layout(S, E, 3);
  expect(Object.keys(pos).sort()).toEqual([...S].sort());
  const at = Object.values(pos).map(([x, y]) => `${x},${y}`);
  expect(new Set(at).size).toBe(S.length);
  for (const s of ["Code Review", "Ready for Test", "Testing"]) expect(pos[s][0]).toBe(pos["In Progress"][0]);
  expect(pos["In Progress"][1]).toBeGreaterThan(pos.Open[1]);
});

test("arrows: square corners only, never through a box", () => {
  const pos = layout(S, E, 3), paths = routes(E, pos, S);
  expect(paths.size).toBe(E.length);
  for (const e of E) {
    // the straight runs: from each point to the next `L` point (a `Q` corner is a rounded turn on a lane, off every box)
    const toks = paths.get(key(e))!.d.match(/[MLQ][^MLQ]+/g)!;
    let prev: number[] = [];
    for (const tk of toks) {
      const nums = tk.slice(1).trim().split(/[ ,]+/).map(Number), end = nums.slice(-2);
      if (tk[0] === "L") {
        const [x1, y1] = prev, [x2, y2] = end;
        expect(Math.abs(x1 - x2) < 0.01 || Math.abs(y1 - y2) < 0.01, `${e} ${tk}`).toBe(true);
        for (const s of S) {
          const [bx, by] = pos[s];
          const crossX = Math.max(x1, x2) > bx + 0.5 && Math.min(x1, x2) < bx + W - 0.5, crossY = Math.max(y1, y2) > by + 0.5 && Math.min(y1, y2) < by + H - 0.5;
          expect(crossX && crossY, `${e.join(" → ")} crosses ${s}`).toBe(false);
        }
      }
      prev = end;
    }
  }
});

test("Tự xếp button: shorter, tidier arrows than the plain rows, no box on another, no step above the one before", () => {
  const tidy = (pos: Record<string, Pt>) => [...routes(E, pos, S).values()].reduce((a, r) =>
    a + (r.pts.length - 2) * 28 + r.pts.slice(1).reduce((l, q, i) => l + Math.abs(q[0] - r.pts[i][0]) + Math.abs(q[1] - r.pts[i][1]), 0), 0);
  const rows = layout(S, E, 3), pos = arrange(S, E, 3);
  expect(tidy(pos)).toBeLessThan(tidy(rows) * 0.8);
  expect(new Set(Object.values(pos).map(String)).size).toBe(S.length);
  for (const [a, b] of E) if (rows[b][1] > rows[a][1]) expect(pos[b][1], `${a} → ${b}`).toBeGreaterThanOrEqual(pos[a][1]);
  expect(arrange(S, E, 3)).toEqual(pos); // the same flow always lays out the same way
});

/** Pairs of runs of two different arrows on one line (overlapping, or end to end: either reads as one arrow). */
function overlaps(paths: ReturnType<typeof routes>) {
  const runs = [...paths].flatMap(([k, r]) => r.pts.slice(1).map((q, i) => ({ k, a: r.pts[i], b: q })));
  const hit: string[] = [];
  runs.forEach((s, i) => {
    for (const o of runs.slice(i + 1)) {
      if (s.k === o.k) continue;
      for (const [f, j] of [[1, 0], [0, 1]]) { // f: the coordinate a run keeps
        const flat = (r: { a: Pt; b: Pt }) => r.a[f] === r.b[f] && r.a[j] !== r.b[j];
        if (flat(s) && flat(o) && Math.abs(s.a[f] - o.a[f]) < 3
          && Math.min(Math.max(s.a[j], s.b[j]), Math.max(o.a[j], o.b[j])) - Math.max(Math.min(s.a[j], s.b[j]), Math.min(o.a[j], o.b[j])) > -3)
          hit.push(`${s.k.replace("\0", " → ")} / ${o.k.replace("\0", " → ")}`);
      }
    }
  });
  return hit;
}

test("arrows never lie on one another, as placed by hand or by Tự xếp", () => {
  expect(overlaps(routes(E, layout(S, E, 3), S))).toEqual([]);
  expect(overlaps(routes(E, arrange(S, E, 3), S))).toEqual([]);
  // a team's flow as placed: IN PROGRESS → CLOSED used to run up the line TO DO → ON HOLD ran down
  const pos: Record<string, Pt> = { OPENED: [252, 32], "ASSIGN TO DEV": [472, 32], "TO DO": [32, 138], CLOSED: [252, 138], "IN PROGRESS": [32, 244],
    "ON HOLD": [472, 244], "BUILT ON DEV": [32, 350], "READY FOR TEST": [252, 350] };
  const s = Object.keys(pos), e: [string, string][] = [["OPENED", "ASSIGN TO DEV"], ["OPENED", "TO DO"], ["OPENED", "CLOSED"], ["CLOSED", "OPENED"],
    ["ON HOLD", "OPENED"], ["TO DO", "CLOSED"], ["TO DO", "IN PROGRESS"], ["TO DO", "ON HOLD"], ["IN PROGRESS", "CLOSED"], ["IN PROGRESS", "BUILT ON DEV"],
    ["BUILT ON DEV", "READY FOR TEST"], ["READY FOR TEST", "CLOSED"]];
  expect(overlaps(routes(e, pos, s))).toEqual([]);
  expect(overlaps(routes(e, arrange(s, e, 3), s))).toEqual([]);
});

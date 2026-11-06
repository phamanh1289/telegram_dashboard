"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, EyeOff, LayoutGrid, Plus, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type PointerEvent as RPointerEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { getPref, put, useRole, YT_ROLES } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { stateColor, type Workflow, yt } from "@/lib/yt";

const W = 150, H = 36, GX = 180, GY = 80, PAD = 24;

const START = /^(open|opened|new|submitted|backlog|to ?do)$/i;

/** Boxes in layers down the flow (BFS), `cols` per row; boxes with no arrow go last. A flow is often a loop (Closed → Open),
 * so each part starts at a state named like a start, else the one fewest arrows lead to.
 * ponytail: BFS layers, no crossing minimisation; drag boxes by hand for the rest. */
function layout(states: string[], edges: [string, string][], cols: number) {
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
  const last = Math.max(0, ...level.values()) + 1;
  const rows: string[][] = [];
  for (const s of states) (rows[level.get(s) ?? last] ??= []).push(s);
  const pos: Record<string, [number, number]> = {};
  let y = PAD;
  for (const row of rows.filter(Boolean))
    for (let k = 0; k < row.length; k += cols) {
      row.slice(k, k + cols).forEach((s, i) => { pos[s] = [PAD + i * GX, y]; });
      y += GY;
    }
  return pos;
}
const key = (e: [string, string]) => `${e[0]}\u0000${e[1]}`;

/** An unsaved edit, kept in this browser per project and role: leaving the page keeps it as a draft, only Lưu applies it. */
const DRAFT = (at: string) => `wfDraft:${at}`;
function readDraft(at: string): Workflow | null {
  try {
    const d = JSON.parse(getPref(DRAFT(at)) ?? "null");
    return d?.pos && Array.isArray(d.edges) ? { on: !!d.on, pos: d.pos, edges: d.edges, hidden: Array.isArray(d.hidden) ? d.hidden : [] } : null;
  } catch { return null; }
}


/** The team's workflow for a project and the current role, as "which states can a ticket in `from` move to" (null: no rule, YouTrack decides). */
export function useFlow(project: string) {
  const role = useRole() ?? "dev"; // the flow shown / saved / applied; no role yet: Dev, as on the server
  const q = useQuery({ queryKey: ["yt", "workflow", project, role], queryFn: () => yt.workflow(project), staleTime: 5 * 60_000, enabled: !!project });
  const wf = q.data;
  return (from: string | null): string[] | null => (wf?.on ? wf.edges.filter(([s]) => s === from).map(([, t]) => t) : null);
}

/** Where an arrow from box a to box b starts / ends: on each box's border, bent sideways when b → a also exists. */
function arrow(a: [number, number], b: [number, number], bend: boolean) {
  const c1 = [a[0] + W / 2, a[1] + H / 2], c2 = [b[0] + W / 2, b[1] + H / 2];
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], len = Math.hypot(dx, dy) || 1;
  const edge = (sign: number) => { const t = Math.min(W / 2 / Math.abs(dx || 1e-9), H / 2 / Math.abs(dy || 1e-9)); return [sign * dx * t, sign * dy * t]; };
  const [ox, oy] = edge(1);
  const off = bend ? 18 : 0, nx = (-dy / len) * off, ny = (dx / len) * off;
  const p1 = [c1[0] + ox + nx, c1[1] + oy + ny], p2 = [c2[0] - ox + nx, c2[1] - oy + ny];
  const m = [(p1[0] + p2[0]) / 2 + nx, (p1[1] + p2[1]) / 2 + ny];
  return { d: `M${p1[0]},${p1[1]} Q${m[0]},${m[1]} ${p2[0]},${p2[1]}`, mid: m };
}

/** Settings › YouTrack › Workflow: drag the state boxes, drag from a box's dot onto another to draw an arrow, click an arrow to remove it. */
export function WorkflowSection() {
  const projects = useQuery({ queryKey: ["yt", "projects"], queryFn: yt.projects, staleTime: Infinity });
  const [project, setProject] = useState(() => getPref("project") || "VA");
  const ps = projects.data;
  const p = !ps?.length || ps.some((x) => x.shortName === project) ? project : ps[0].shortName;
  const role = useRole() ?? "dev"; // the flow shown / saved / applied; no role yet: Dev, as on the server
  const q = useQuery({ queryKey: ["yt", "workflow", p, role], queryFn: () => yt.workflow(p) });
  const qc = useQueryClient();
  const at = `${p}:${role}`; // a draft belongs to the project and role it was drawn for
  const [, redraw] = useState(0);
  const draft = readDraft(at); // null: showing the saved one
  const setDraft = (d: Workflow | null) => { put(DRAFT(at), d && JSON.stringify(d)); redraw((n) => n + 1); }; // ponytail: written on every drag move, ~3 KB
  const states = q.data?.states ?? [];
  const [cols, setCols] = useState(3); // as many boxes as fit across the canvas
  const fit = (el: HTMLDivElement | null) => { if (el) setCols(Math.max(1, Math.floor((el.clientWidth - PAD - W) / GX) + 1)); };
  const saved: Workflow | null = q.data ? { on: q.data.on, pos: { ...layout(states, q.data.edges, cols), ...q.data.pos }, edges: q.data.edges.filter(([s, t]) => states.includes(s) && states.includes(t)), hidden: (q.data.hidden ?? []).filter((s) => states.includes(s)) } : null;
  const wf = draft ?? saved;
  const shown = states.filter((s) => !wf?.hidden.includes(s)); // the boxes on the canvas
  const hide = (s: string) => wf && set({ hidden: [...wf.hidden, s], edges: wf.edges.filter((e) => !e.includes(s)) });
  const set = (patch: Partial<Workflow>) => {
    if (!wf || !saved) return;
    const next = { ...wf, ...patch };
    setDraft(JSON.stringify(next) === JSON.stringify(saved) ? null : next); // back to the saved one: no draft left
  };
  const save = useMutation({
    mutationFn: (w: Workflow) => yt.setWorkflow(p, { on: w.on, pos: Object.fromEntries(states.map((s) => [s, w.pos[s]])), edges: w.edges, hidden: w.hidden }),
    onSuccess: () => { setDraft(null); void qc.invalidateQueries({ queryKey: ["yt", "workflow", p, role] }); },
  });
  const fromYt = useMutation({
    mutationFn: () => yt.youtrackFlow(p),
    onSuccess: (d) => { // hidden boxes stay hidden; nothing placed by hand yet: lay out along the new flow
      const edges = d.edges.filter(([s, t]) => shown.includes(s) && shown.includes(t));
      set({ edges, ...(Object.keys(q.data?.pos ?? {}).length ? {} : { pos: layout(shown, edges, cols) }) });
    },
  });

  if (!q.data || !wf) return <p className="text-sm text-ink-3">{q.isError ? `Không tải được: ${(q.error as Error).message}` : "Đang tải…"}</p>;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Project" value={p} onChange={(e) => { setProject(e.target.value); fromYt.reset(); }}
          className="h-8 rounded-[var(--radius-input)] border border-rule bg-cotton px-2 text-sm">
          {(ps ?? [{ shortName: p, name: p }]).map((x) => <option key={x.shortName} value={x.shortName}>{x.shortName} ({x.name})</option>)}
        </select>
        <Hint title="Lấy từ YouTrack" text="Thay các mũi tên bằng luồng YouTrack đang cho phép (đọc từ mỗi state một ticket). Chưa lưu cho tới khi bấm Lưu.">
          <Button type="button" size="sm" variant="outline" disabled={!states.length || fromYt.isPending} onClick={() => fromYt.mutate()}>
            <Download className="size-3.5" />{fromYt.isPending ? "Đang đọc…" : "Lấy từ YouTrack"}
          </Button>
        </Hint>
        <Hint title="Tự xếp" text="Xếp lại các ô theo luồng: state đầu ở trên, các bước sau xuống dưới.">
          <Button type="button" size="sm" variant="ghost" disabled={!states.length} onClick={() => set({ pos: layout(shown, wf.edges, cols) })}><LayoutGrid className="size-3.5" />Tự xếp</Button>
        </Hint>
        <Hint title="Xóa hết mũi tên" text="Bỏ mọi mũi tên để vẽ lại từ đầu.">
          <Button type="button" size="sm" variant="ghost" disabled={!wf.edges.length} onClick={() => set({ edges: [] })}><Trash2 className="size-3.5" />Xóa hết</Button>
        </Hint>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={wf.on} onChange={(e) => set({ on: e.target.checked })} /> Áp dụng trong app
        </label>
      </div>
      {fromYt.isError && <p role="alert" className="text-xs text-error">Không đọc được: {(fromYt.error as Error).message}</p>}
      {fromYt.data?.unknown.length ? <p className="text-xs text-ink-3">Chưa có ticket nào ở {fromYt.data.unknown.join(", ")} nên chưa biết từ đó đi đâu, tự nối thêm nếu cần.</p> : null}
      {!states.length ? <p className="text-sm text-ink-3">{q.data && !states.length ? "Chưa có state: cần token YouTrack (nhóm Kết nối và báo cáo)." : null}</p>
        : (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-rule">
            <Canvas states={shown} wf={wf} onChange={set} onHide={hide} fit={fit} />
            <HiddenTray hidden={wf.hidden} onShow={(list) => set({ hidden: wf.hidden.filter((x) => !list.includes(x)) })} />
          </div>
        )}
      <EdgeList states={shown} edges={wf.edges} onChange={(edges) => set({ edges })} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate(wf)}>Lưu</Button>
        {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(null); fromYt.reset(); }}>Bỏ nháp</Button>}
        {dirty && <span className="rounded-full bg-warn-wash px-2 py-0.5 text-xs font-medium text-warn">Bản nháp: chưa áp dụng cho ticket, bấm Lưu để áp dụng</span>}
        <span className="flex flex-wrap gap-x-3 text-xs text-ink-3"><span>Vai trò <b className="text-ink-2">{YT_ROLES.find(([r]) => r === role)?.[1]}</b></span><span>{wf.edges.length} mũi tên</span><span>{wf.on ? "app chỉ cho chuyển state theo mũi tên (menu State, kéo thả Board)" : "đang tắt: chỉ YouTrack quyết định"}</span></span>
      </div>
      {save.isError && <p role="alert" className="text-xs text-error">Không lưu được: {(save.error as Error).message}</p>}
    </div>
  );
}

type Drag = { kind: "move"; s: string; dx: number; dy: number } | { kind: "link"; s: string; x: number; y: number; over: string | null };

function Canvas({ states, wf, onChange, onHide, fit }: { states: string[]; wf: Workflow; onChange: (p: Partial<Workflow>) => void; onHide: (s: string) => void; fit: (el: HTMLDivElement | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => fit(box.current), []); // eslint-disable-line react-hooks/exhaustive-deps -- measured once
  const [drag, setDrag] = useState<Drag | null>(null);
  const [sel, setSel] = useState<string | null>(null); // the picked arrow's key
  const has = new Set(wf.edges.map(key));
  const width = Math.max(0, ...states.map((s) => wf.pos[s][0])) + W + PAD;
  const height = Math.max(360, Math.max(0, ...states.map((s) => wf.pos[s][1])) + H + PAD);

  const remove = (k: string) => { onChange({ edges: wf.edges.filter((e) => key(e) !== k) }); setSel(null); };
  useEffect(() => {
    if (!sel) return;
    const down = (e: KeyboardEvent) => { if ((e.key === "Delete" || e.key === "Backspace") && !(e.target as HTMLElement).closest("input,textarea,select")) { e.preventDefault(); remove(sel); } if (e.key === "Escape") setSel(null); };
    addEventListener("keydown", down);
    return () => removeEventListener("keydown", down);
  });

  const at = (e: RPointerEvent) => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left + box.current!.scrollLeft, e.clientY - r.top + box.current!.scrollTop]; };
  const stateAt = (e: RPointerEvent) => (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-state]") as HTMLElement | null)?.dataset.state ?? null;
  function move(e: RPointerEvent) {
    if (!drag) return;
    const [x, y] = at(e);
    if (drag.kind === "move") onChange({ pos: { ...wf.pos, [drag.s]: [Math.max(0, Math.round(x - drag.dx)), Math.max(0, Math.round(y - drag.dy))] } });
    else setDrag({ ...drag, x, y, over: stateAt(e) });
  }
  function up(e: RPointerEvent) {
    if (drag?.kind === "link") {
      const t = stateAt(e);
      if (t && t !== drag.s && !has.has(key([drag.s, t]))) onChange({ edges: [...wf.edges, [drag.s, t]] });
    }
    setDrag(null);
  }

  return (
    <div ref={box} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}
      className="relative h-[420px] touch-none overflow-auto bg-paper-2 select-none"
      style={{ backgroundImage: "radial-gradient(var(--color-rule) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
      <svg width={width} height={height} className="pointer-events-none absolute top-0 left-0" aria-hidden>
        <defs>
          {["n", "s"].map((m) => (
            <marker key={m} id={`wf-${m}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={m === "s" ? "var(--color-hl)" : "var(--color-ink-3)"} />
            </marker>
          ))}
        </defs>
        {wf.edges.map((e) => {
          const k = key(e), on = sel === k, a = arrow(wf.pos[e[0]], wf.pos[e[1]], has.has(key([e[1], e[0]])));
          return (
            <g key={k} className="pointer-events-auto cursor-pointer" onPointerDown={(ev) => { ev.stopPropagation(); setSel(on ? null : k); }}>
              <path d={a.d} fill="none" stroke="transparent" strokeWidth={14} />
              <path d={a.d} fill="none" stroke={on ? "var(--color-hl)" : "var(--color-ink-3)"} strokeWidth={on ? 2.5 : 1.5} markerEnd={`url(#wf-${on ? "s" : "n"})`} />
            </g>
          );
        })}
        {drag?.kind === "link" && (() => { const [x, y] = wf.pos[drag.s]; return <line x1={x + W} y1={y + H / 2} x2={drag.x} y2={drag.y} stroke="var(--color-hl)" strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#wf-s)" />; })()}
      </svg>
      {sel && (() => {
        const e = wf.edges.find((x) => key(x) === sel);
        if (!e) return null;
        const m = arrow(wf.pos[e[0]], wf.pos[e[1]], has.has(key([e[1], e[0]]))).mid;
        return (
          <button type="button" aria-label={`Xóa mũi tên ${e[0]} → ${e[1]}`} onClick={() => remove(sel)} style={{ left: m[0] - 11, top: m[1] - 11 }}
            className="absolute z-10 grid size-[22px] place-items-center rounded-full bg-error text-cotton shadow-stock"><X className="size-3.5" /></button>
        );
      })()}
      {states.map((s) => {
        const [x, y] = wf.pos[s], target = drag?.kind === "link" && drag.over === s && drag.s !== s;
        return (
          <div key={s} data-state={s} style={{ left: x, top: y, width: W, height: H, borderColor: stateColor(s) }}
            onPointerDown={(e) => { if (e.button) return; const [px, py] = at(e); setDrag({ kind: "move", s, dx: px - x, dy: py - y }); setSel(null); box.current!.setPointerCapture(e.pointerId); }}
            className={cn("group absolute flex cursor-grab items-center gap-1.5 rounded-[var(--radius-input)] border-l-4 bg-cotton pr-4 pl-2 text-xs font-medium shadow-stock active:cursor-grabbing",
              target && "ring-2 ring-hl", drag?.kind === "move" && drag.s === s && "z-10 shadow-lg")}>
            <span className="truncate" title={s}>{s}</span>
            <span role="button" aria-label={`Kéo để nối từ ${s}`} onPointerDown={(e) => { e.stopPropagation(); const [px, py] = at(e); setDrag({ kind: "link", s, x: px, y: py, over: null }); setSel(null); box.current!.setPointerCapture(e.pointerId); }}
              className="absolute top-1/2 -right-[7px] size-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-cotton bg-hl shadow-stock hover:scale-125" />
            <button type="button" aria-label={`Ẩn ${s} khỏi workflow`} onPointerDown={(e) => e.stopPropagation()} onClick={() => onHide(s)}
              className="absolute -top-2 right-3 grid size-[18px] place-items-center rounded-full bg-paper-3 text-ink-3 opacity-0 shadow-stock transition-opacity group-hover:opacity-100 hover:bg-error hover:text-cotton focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Under the canvas: the states taken off it, as small boxes like the ones above; a click puts one back where it was. */
function HiddenTray({ hidden, onShow }: { hidden: string[]; onShow: (states: string[]) => void }) {
  return (
    <AnimatePresence initial={false}>
      {hidden.length > 0 && (
        <motion.div key="tray" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }} className="overflow-hidden border-t border-rule bg-cotton">
          <div className="grid gap-2 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-ink-3">
              <EyeOff className="size-3.5" aria-hidden />
              <span className="font-medium text-ink-2">Đã ẩn</span>
              <span className="rounded-full bg-paper-3 px-1.5 font-mono text-[11px] leading-[18px]">{hidden.length}</span>
              <span className="max-sm:hidden">(bấm một state để đưa lại vào sơ đồ)</span>
              {hidden.length > 1 && (
                <button type="button" onClick={() => onShow(hidden)} className="ml-auto rounded px-1.5 py-0.5 font-medium text-hl-2 hover:bg-hl-wash">Hiện tất cả</button>
              )}
            </div>
            <ul className="flex flex-wrap gap-1.5">
              <AnimatePresence initial={false}>
                {hidden.map((s) => (
                  <motion.li key={s} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.15 }}>
                    <button type="button" aria-label={`Hiện lại ${s}`} onClick={() => onShow([s])} style={{ borderLeftColor: stateColor(s) }}
                      className="group inline-flex h-7 max-w-56 items-center gap-1.5 rounded-[var(--radius-input)] border border-l-[3px] border-rule bg-paper-2 pr-1.5 pl-2 text-xs text-ink-2 transition-colors hover:border-hl/60 hover:bg-cotton hover:text-ink focus-visible:ring-2 focus-visible:ring-hl">
                      <span className="truncate">{s}</span>
                      <Plus className="size-3.5 shrink-0 text-ink-3 transition-colors group-hover:text-hl-2" aria-hidden />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The same arrows as a list: add one with two selects, remove with ×. Works by keyboard and on a phone. */
function EdgeList({ states, edges, onChange }: { states: string[]; edges: [string, string][]; onChange: (e: [string, string][]) => void }) {
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const f = states.includes(from) ? from : states[0] ?? "", t = states.includes(to) ? to : states[1] ?? states[0] ?? "";
  const dupe = f === t || edges.some(([a, b]) => a === f && b === t);
  const sel = "h-8 min-w-0 rounded-[var(--radius-input)] border border-rule bg-cotton px-2 text-sm";
  return (
    <details className="grid gap-2 text-sm">
      <summary className="cursor-pointer text-xs text-ink-3">Danh sách mũi tên ({edges.length})</summary>
      <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!dupe) onChange([...edges, [f, t]]); }}>
        <select aria-label="Từ state" className={sel} value={f} onChange={(e) => setFrom(e.target.value)}>{states.map((s) => <option key={s}>{s}</option>)}</select>
        <span aria-hidden>→</span>
        <select aria-label="Sang state" className={sel} value={t} onChange={(e) => setTo(e.target.value)}>{states.map((s) => <option key={s}>{s}</option>)}</select>
        <Button type="submit" size="sm" variant="outline" disabled={dupe}>Thêm</Button>
      </form>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {edges.map(([a, b]) => (
          <li key={key([a, b])} className="inline-flex items-center gap-1 rounded-full bg-paper-2 py-0.5 pr-1 pl-2.5 text-xs">
            {a} → {b}
            <button type="button" aria-label={`Xóa ${a} → ${b}`} onClick={() => onChange(edges.filter((e) => e[0] !== a || e[1] !== b))} className="rounded-full p-0.5 text-ink-3 hover:bg-paper-3 hover:text-error"><X className="size-3" /></button>
          </li>
        ))}
      </ul>
    </details>
  );
}

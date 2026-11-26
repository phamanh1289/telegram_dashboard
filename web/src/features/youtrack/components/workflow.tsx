"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LayoutGrid, Maximize, Minus, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Fold } from "@/shared/components/ui/fold";
import { Dropdown } from "@/shared/components/ui/dropdown";
import { Hint } from "@/shared/components/ui/hint";
import { SetupTip } from "@/shared/components/ai/setup-tip";
import { useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { getPref, useRoleOrDev, YT_ROLES } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { StatePill } from "@/features/youtrack/components/bits";
import { GoneBanner, GonePanel } from "@/features/youtrack/components/workflow-gone";
import { arrange, GX, H, key, layout, PAD, routes, W } from "@/features/youtrack/lib/workflow-graph";
import { goneStates, liveEdges, nextStates, resolveProject, type Workflow, yt, ytFail, ytProjectsQuery, ytWorkflowQuery } from "@/features/youtrack/lib/yt";

/** The team's workflow for a project and the current role (no role yet: Dev, as on the server). */
function useWorkflow(project: string) {
  const role = useRoleOrDev();
  return useQuery({ ...ytWorkflowQuery(project, role), enabled: !!project });
}

/** The role has no arrow at all for the project: no State can be changed (false while it loads). */
export const useNoFlow = (project: string) => { const wf = useWorkflow(project).data; return !!wf && !liveEdges(wf).length; };

/** "Which states can a ticket in `from` move to": only along the team's arrows, none drawn = none. null while it loads (the
 *  server checks anyway); [] when it cannot be read, so nothing is offered that would be refused (WorkflowTip says why). */
export function useFlow(project: string) {
  const q = useWorkflow(project);
  return (from: string | null): string[] | null => (q.isError ? [] : q.data ? nextStates(liveEdges(q.data), from) : null);
}

/** Where a State is changed (the ticket's State menu, the bulk bar's, above the Board): the role has no workflow, so no State
 *  can be changed — say why, with the walk to draw one (not closable: it is the only reason given); or the workflow could not
 *  be read. Nothing while it loads or when there is one. */
export function WorkflowTip({ project, className }: { project: string; className?: string }) {
  const t = useT();
  const role = useRoleOrDev();
  const q = useWorkflow(project), wf = q.data;
  if (q.isError) return <p role="alert" className={cn("text-xs text-error", className)}>{t("Không đọc được workflow nên chưa đổi được State: {msg}", { msg: ytFail(q.error).msg }) }</p>;
  const roleName = t(YT_ROLES.find(([r]) => r === role)![1]), gone = wf ? goneStates(wf) : [];
  if (wf && !liveEdges(wf).length && !gone.length) return <SetupTip id="workflow" must when className={className} go={t("Vẽ workflow")} tour="settings-workflow"
    text={t("Vai trò {role} chưa có workflow nên chưa đổi được State.", { role: roleName })} />;
  // the flow names states YouTrack no longer has (deleted / renamed): the steps through them are gone
  return <SetupTip id="workflow-gone" must when={gone.length > 0} className={className} go={t("Sửa workflow")} tour="settings-workflow"
    text={t("Workflow của vai trò {role} có State đã bị xóa trên YouTrack ({states}), các bước qua đó không đi được.", { role: roleName, states: gone.join(", ") })} />;
}

/** Unsaved edits per "project:role", in this tab's memory: moving between Settings groups keeps them, only Lưu applies one, and
 *  opening Settings again (a reload too) starts from the saved flows (`dropWorkflowDrafts`). No storage write per drag move. */
const drafts = new Map<string, Workflow>();
export const dropWorkflowDrafts = () => drafts.clear();

/** Settings › YouTrack › Workflow: the states in use on the canvas (drag to place, drag a box's dot onto another for an arrow,
 *  or Enter on one box then on another), the rest in a column on the right; drag between them to add / take off, pick a box or
 *  an arrow and press Delete to take it off. */
export function WorkflowSection() {
  const t = useT();
  const projects = useQuery(ytProjectsQuery);
  const [project, setProject] = useState(() => getPref("project") || "VA");
  const ps = projects.data;
  const p = resolveProject(ps, project); // the same fallback as the YouTrack tab and the ticket form
  const role = useRoleOrDev(); // the flow shown / saved / applied; no role yet: Dev, as on the server
  const q = useQuery(ytWorkflowQuery(p, role));
  const qc = useQueryClient();
  const at = `${p}:${role}`; // a draft belongs to the project and role it was drawn for
  const [, redraw] = useState(0);
  const draft = drafts.get(at) ?? null; // null: showing the saved one
  const setDraft = (d: Workflow | null, k = at) => { if (d) drafts.set(k, d); else drafts.delete(k); redraw((n) => n + 1); };
  const [cols, setCols] = useState(3); // as many boxes as fit across the canvas
  const fit = (el: HTMLDivElement | null) => { if (el) setCols(Math.max(1, Math.floor((el.clientWidth - PAD - W) / GX) + 1)); };
  const data = q.data, states = useMemo(() => data?.states ?? [], [data]);
  // arrows to a state YouTrack no longer has stay (its box is drawn as deleted, to be replaced or taken off)
  const saved = useMemo<Workflow | null>(() => !data ? null : {
    // nothing placed yet: Tự xếp's layout; else boxes YouTrack gained since go along the flow (cheap, every refetch)
    pos: { ...(Object.keys(data.pos ?? {}).length ? layout : arrange)([...states, ...goneStates(data)], data.edges, cols), ...data.pos },
    edges: data.edges,
    hidden: (data.hidden ?? []).filter((s) => states.includes(s)),
  }, [data, states, cols]);
  const savedJson = useMemo(() => JSON.stringify(saved), [saved]);
  // a draft's `pos` may miss boxes ("Tự xếp" lays out the shown ones only; YouTrack gained a State since): the saved place
  const wf = draft ? { ...draft, pos: { ...saved?.pos, ...draft.pos } } : saved;
  const shown = states.filter((s) => !wf?.hidden.includes(s)); // the boxes on the canvas
  const set = (patch: Partial<Workflow>) => {
    if (!wf || !saved) return;
    const next = { ...wf, ...patch };
    setDraft(JSON.stringify(next) === savedJson ? null : next); // back to the saved one: no draft left
  };
  // a box off the canvas (its arrows go with it) / back on, `to` where it lands (default: where it was)
  const hide = (s: string, to?: [number, number]) => wf && set({ hidden: [...wf.hidden, s], edges: wf.edges.filter((e) => !e.includes(s)), ...(to && { pos: { ...wf.pos, [s]: to } }) });
  const show = (s: string, to?: [number, number]) => wf && set({ hidden: wf.hidden.filter((x) => x !== s), ...(to && { pos: { ...wf.pos, [s]: to } }) });
  // a state deleted / renamed on YouTrack: `s` takes its arrows (and its place, unless already part of the flow), or it goes with them
  const replace = (g: string, s: string) => wf && set({
    edges: wf.edges.map(([a, b]) => [a === g ? s : a, b === g ? s : b] as [string, string])
      .filter(([a, b], i, all) => a !== b && all.findIndex(([x, y]) => x === a && y === b) === i),
    hidden: wf.hidden.filter((x) => x !== s),
    ...(!wf.edges.some((e) => e.includes(s)) && { pos: { ...wf.pos, [s]: wf.pos[g] } }), // a renamed state: where the old name was
  });
  const dropGone = (g: string) => wf && set({ edges: wf.edges.filter((e) => !e.includes(g)) });
  // project, role and flow go with the call: a switch while it runs cannot point the answer at another draft
  const save = useMutation({
    mutationFn: (v: { p: string; role: string; w: Workflow; d: Workflow; states: string[] }) => // w: the flow shown, d: the draft it came from
      yt.setWorkflow(v.p, { pos: Object.fromEntries(v.states.map((s) => [s, v.w.pos[s]])), edges: v.w.edges, hidden: v.w.hidden }),
    onSuccess: (w, v) => {
      const k = ytWorkflowQuery(v.p, v.role).queryKey;
      qc.setQueryData<Workflow & { states: string[] }>(k, (old) => old && { ...old, ...w }); // no flash of the old flow before the refetch
      if (drafts.get(`${v.p}:${v.role}`) === v.d) setDraft(null, `${v.p}:${v.role}`); // edits made while it saved stay a draft
      void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => { const f = ytFail(e); toast({ text: t("Không lưu được workflow: {msg}", { msg: f.msg }), failure: f.failure }); },
  });
  // "Lấy từ YouTrack" reads one ticket per state (seconds): an answer after a project switch or Bỏ nháp is dropped, and it applies
  // to the flow as it is when it lands, not as it was when asked
  const [gen, setGen] = useState(0);
  const applyYt = useRef<(d: { edges: [string, string][] }, v: { p: string; gen: number }) => void>(() => {});
  useLayoutEffect(() => {
    applyYt.current = (d, v) => {
      if (v.p !== p || v.gen !== gen) return;
      const edges = d.edges.filter(([s, t]) => shown.includes(s) && shown.includes(t)); // hidden boxes stay hidden
      set({ edges, ...(Object.keys(data?.pos ?? {}).length ? {} : { pos: arrange(shown, edges, cols) }) }); // nothing placed by hand yet: lay out along it
    };
  });
  const fromYt = useMutation({
    mutationFn: (v: { p: string; gen: number }) => yt.youtrackFlow(v.p),
    onSuccess: (d, v) => applyYt.current(d, v),
  });
  const ytHere = fromYt.variables?.p === p && fromYt.variables.gen === gen; // its note / error belong to this view
  const discard = () => { setGen((n) => n + 1); setDraft(null); };

  if (!data || !wf) return <p className="text-sm text-ink-3">{q.isError ? t("Không tải được: {msg}", { msg: ytFail(q.error).msg }) : t("Đang tải…")}</p>;
  const dirty = !!draft && JSON.stringify(draft) !== savedJson;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Dropdown label="Project" value={p} onChange={(v) => { setGen((n) => n + 1); setProject(v); }} className="mr-1 w-auto text-sm"
          options={(ps ?? [{ shortName: p, name: p }]).map((x) => ({ value: x.shortName, label: x.shortName, hint: x.name }))} />
        {states.length > 0 && <>
          <Hint title={t("Lấy từ YouTrack")} text={t("Thay các mũi tên bằng luồng YouTrack đang cho phép (đọc từ mỗi state một ticket). Chưa lưu cho tới khi bấm Lưu.")}>
            <Button type="button" size="sm" variant="outline" disabled={fromYt.isPending} onClick={() => fromYt.mutate({ p, gen })}>
              <Download className="size-3.5" />{t(fromYt.isPending ? "Đang đọc…" : "Lấy từ YouTrack")}
            </Button>
          </Hint>
          <Hint title={t("Tự xếp")} text={t("Xếp lại các ô cho mũi tên ngắn và gọn nhất (ít góc rẽ, ít cắt nhau): state đầu ở trên, các bước sau ở dưới hoặc bên cạnh.")}>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("Tự xếp")} onClick={() => set({ pos: arrange(shown, wf.edges, cols) })}><LayoutGrid className="size-4" /></Button>
          </Hint>
          <Hint title={t("Xóa hết mũi tên")} text={t("Bỏ mọi mũi tên để vẽ lại từ đầu.")}>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("Xóa hết mũi tên")} disabled={!wf.edges.length} onClick={() => set({ edges: [] })}><Trash2 className="size-4" /></Button>
          </Hint>
        </>}
      </div>
      {ytHere && fromYt.isError && <p role="alert" className="text-xs text-error">{t("Không đọc được: {msg}", { msg: ytFail(fromYt.error).msg })}</p>}
      {ytHere && fromYt.data?.unknown.length ? <p className="text-xs text-ink-3">{t("Chưa có ticket nào ở {states} nên chưa biết từ đó đi đâu, tự nối thêm nếu cần.", { states: fromYt.data.unknown.join(", ") })}</p> : null}
      {!states.length ? <p className="text-sm text-ink-3">{t("Chưa có state: cần token YouTrack (nhóm Kết nối và báo cáo).")}</p> : (
        <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border border-rule">
          <Canvas states={shown} all={states} gone={goneStates({ states, edges: wf.edges })} hidden={wf.hidden} wf={wf} onChange={set} onHide={hide} onShow={show}
            onReplace={replace} onDropGone={dropGone} fit={fit} />
          {/* only while there is a draft: a strip under the canvas, so it never covers a box */}
          <Fold open={dirty}>
            <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-warn-wash py-1.5 pr-1.5 pl-3">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-signal" />
              <span className="text-xs text-ink-2">{t("Bản nháp chưa lưu, ticket vẫn theo bản đã lưu")}</span>
              <span className="ml-auto flex gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={discard}>{t("Bỏ nháp")}</Button>
                <Button type="button" size="sm" aria-busy={save.isPending} disabled={!dirty || save.isPending} onClick={() => draft && save.mutate({ p, role, w: wf, d: draft, states })}>{t("Lưu")}</Button>
              </span>
            </div>
          </Fold>
        </div>
      )}
    </div>
  );
}

type Drag =
  | { kind: "move"; s: string; dx: number; dy: number; to: [number, number] | null; out: boolean } // to: where it is while dragged; out: over the column
  | { kind: "link"; s: string; x: number; y: number; over: string | null }
  | { kind: "add"; s: string; x: number; y: number; ox: number; oy: number; moved: boolean; into: boolean } // from the column; frame coordinates, o: start
  | { kind: "pan"; ox: number; oy: number; left: number; top: number; moved: boolean }; // empty canvas: the view moves (client px, scroll at the start)
type Sel = { edge: string } | { box: string } | null;

const near0 = (v: number) => Math.max(0, Math.round(v));
const ZOOM_MIN = 0.4, ZOOM_MAX = 1.6;
const clampZoom = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;

/** `states`: the boxes on the canvas; `gone`: states the arrows still name that YouTrack no longer has (drawn as deleted);
 *  `all`: the project's states (what a deleted one can be replaced with). */
function Canvas({ states, all, gone, hidden, wf, onChange, onHide, onShow, onReplace, onDropGone, fit }: {
  states: string[]; all: string[]; gone: string[]; hidden: string[]; wf: Workflow; onChange: (p: Partial<Workflow>) => void;
  onHide: (s: string, to?: [number, number]) => void; onShow: (s: string, to?: [number, number]) => void;
  onReplace: (gone: string, to: string) => void; onDropGone: (gone: string) => void; fit: (el: HTMLDivElement | null) => void;
}) {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null);
  useEffect(() => fit(box.current), []); // eslint-disable-line react-hooks/exhaustive-deps -- measured once
  // the live drag in a ref too: a pointerup in the same frame as the last move still sees it
  const [drag, setDragState] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => { live.current = d; setDragState(d); };
  const [sel, setSel] = useState<Sel>(null);
  const [linking, setLinking] = useState<string | null>(null); // keyboard: Enter on a box, then Enter on the one it leads to
  const [hover, setHover] = useState<string | null>(null);
  const hoverOn = (s: string) => ({ onPointerEnter: () => setHover(s), onPointerLeave: () => setHover((h) => (h === s ? null : h)) });
  // the dragged box is drawn where the pointer is; the flow only changes on letting go (one draft write per drag)
  const pos = drag?.kind === "move" && drag.to && !drag.out ? { ...wf.pos, [drag.s]: drag.to } : wf.pos;
  const has = new Set(wf.edges.map(key));
  const boxes = [...states, ...gone].filter((s) => pos[s]);
  const width = Math.max(0, ...boxes.map((s) => pos[s][0])) + W + PAD + 24; // + room for the loops on the right
  const height = Math.max(0, ...boxes.map((s) => pos[s][1])) + H + PAD + 40; // + room for the empty hint below the boxes
  // zoom for a big flow: the boxes and arrows scale, positions stay in flow units (`at` divides by it)
  const [zoom, setZoomState] = useState(1);
  const zoomNow = useRef(1), zoomGoal = useRef(1); // now: the drawn value (mid-animation too); goal: where it is heading
  const zoomAnim = useRef<ReturnType<typeof animate> | null>(null);
  // the flow point to keep under the anchor while the zoom changes, applied after each render (the scroll extent has changed by then)
  const zoomAnchor = useRef<{ fx: number; fy: number; ox: number; oy: number } | null>(null);
  const still = useReducedMotion();
  /** To `z`, keeping the flow point under `anchor` (client px; default the canvas centre) where it is on screen; eased
   *  (buttons, keys, Vừa khung), or `instant` for a wheel / pinch, which already moves in small steps. */
  const zoomTo = (z: number, anchor?: [number, number], instant = false) => {
    const el = box.current, nz = clampZoom(z);
    if (!el || nz === zoomGoal.current) return;
    const r = el.getBoundingClientRect(), [ax, ay] = anchor ?? [r.left + el.clientWidth / 2, r.top + el.clientHeight / 2];
    const ox = ax - r.left, oy = ay - r.top;
    zoomAnchor.current = { fx: (ox + el.scrollLeft) / zoomNow.current, fy: (oy + el.scrollTop) / zoomNow.current, ox, oy };
    zoomGoal.current = nz;
    zoomAnim.current?.stop();
    const show = (v: number) => { zoomNow.current = v; setZoomState(v); };
    if (instant || still) { show(nz); return; }
    zoomAnim.current = animate(zoomNow.current, nz, { duration: 0.22, ease: [0.2, 0, 0, 1], onUpdate: show });
  };
  useLayoutEffect(() => {
    const el = box.current, a = zoomAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.fx * zoom - a.ox;
    el.scrollTop = a.fy * zoom - a.oy;
    if (zoom === zoomGoal.current) zoomAnchor.current = null; // landed: free scrolling again
  }, [zoom]);
  useEffect(() => () => zoomAnim.current?.stop(), []);
  const zoomStep = (d: number) => zoomTo(Math.round(zoomGoal.current * 10) / 10 + d); // on the 10 % marks (41 % + → 50 %), from where it is heading
  const fitZoom = () => { const el = box.current; if (el) zoomTo(Math.min(1, el.clientWidth / width, el.clientHeight / height)); };
  // Ctrl / ⌘ + wheel, and a trackpad pinch (which comes as one): zoom around the pointer. Not passive, to keep the page's own zoom off
  const zoomRef = useRef(zoomTo);
  useLayoutEffect(() => { zoomRef.current = zoomTo; });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoomRef.current(zoomGoal.current * Math.exp(-e.deltaY / 300), [e.clientX, e.clientY], true); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const boxH = Math.min(480, Math.max(260, height * zoom)); // narrow screens (no full-height card): the canvas's own height

  const link = (from: string, to: string) => { if (to !== from && !gone.includes(to) && !gone.includes(from) && !has.has(key([from, to]))) onChange({ edges: [...wf.edges, [from, to]] }); };
  const drop = (s: Sel) => { // Delete: the picked arrow, or the picked box off the canvas; the keyboard stays on the canvas
    if (!s) return;
    if ("edge" in s) onChange({ edges: wf.edges.filter((e) => key(e) !== s.edge) }); else if (gone.includes(s.box)) onDropGone(s.box); else onHide(s.box);
    setSel(null); setLinking(null); box.current?.focus();
  };
  // keys on the canvas only (a pick left behind never eats a Backspace typed elsewhere); handled here, before the page's Esc
  function keys(e: RKeyboardEvent) {
    const s = (e.target as Element).closest?.("[data-state]")?.getAttribute("data-state") ?? null;
    if (e.key === "Delete" || e.key === "Backspace") { if (sel) { e.preventDefault(); drop(sel); } }
    else if (e.key === "Escape" && (sel || linking)) { e.preventDefault(); setSel(null); setLinking(null); } // the next Esc closes Settings
    else if (e.key === "Enter" && s && gone.includes(s)) { e.preventDefault(); setSel({ box: s }); setLinking(null); } // its fix panel
    else if (e.key === "Enter" && s) { e.preventDefault(); if (linking && linking !== s) { link(linking, s); setLinking(null); } else setLinking(linking === s ? null : s); }
    else if ((e.key === "+" || e.key === "=" || e.key === "-" || e.key === "0") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (e.key === "0") zoomTo(1); else zoomStep(e.key === "-" ? -0.1 : 0.1);
    }
  }

  const at = (e: RPointerEvent) => { const r = box.current!.getBoundingClientRect(); return [(e.clientX - r.left + box.current!.scrollLeft) / zoom, (e.clientY - r.top + box.current!.scrollTop) / zoom]; };
  const inFrame = (e: RPointerEvent) => { const r = frame.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const zone = (e: RPointerEvent) => (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-wf-zone]") as HTMLElement | null)?.dataset.wfZone;
  const stateAt = (e: RPointerEvent) => (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-state]") as HTMLElement | null)?.dataset.state ?? null;
  const grab = (e: RPointerEvent, d: Drag) => { e.stopPropagation(); setDrag(d); setLinking(null); frame.current!.setPointerCapture(e.pointerId); };
  function move(e: RPointerEvent) {
    const d = live.current;
    if (!d) return;
    if (d.kind === "pan") { // straight to the scroll: no re-render per move, one when it starts moving (the cursor)
      const el = box.current!, dx = e.clientX - d.ox, dy = e.clientY - d.oy;
      el.scrollLeft = d.left - dx; el.scrollTop = d.top - dy;
      if (!d.moved && Math.hypot(dx, dy) > 4) setDrag({ ...d, moved: true });
      return;
    }
    if (d.kind === "move") {
      const out = zone(e) === "tray", [x, y] = at(e);
      setDrag({ ...d, out, to: out ? d.to : [near0(x - d.dx), near0(y - d.dy)] });
    } else if (d.kind === "link") { const [x, y] = at(e); setDrag({ ...d, x, y, over: stateAt(e) }); }
    else { const [x, y] = inFrame(e); setDrag({ ...d, x, y, moved: d.moved || Math.hypot(x - d.ox, y - d.oy) > 4, into: zone(e) === "canvas" }); }
  }
  function up(e: RPointerEvent) {
    const d = live.current;
    setDrag(null);
    if (d?.kind === "pan") { if (!d.moved) { setSel(null); setLinking(null); } } // a click on the empty canvas lets go of the pick
    else if (d?.kind === "move") {
      if (d.out) { onHide(d.s); setSel(null); } // dropped on the column: off (back to its old place if it returns)
      else if (d.to) onChange({ pos: { ...wf.pos, [d.s]: d.to } });
      else setSel(sel && "box" in sel && sel.box === d.s ? null : { box: d.s }); // a click: pick / let go
    } else if (d?.kind === "link") {
      const to = stateAt(e);
      if (to) link(d.s, to);
    } else if (d?.kind === "add") {
      if (!d.moved) onShow(d.s); // a click: back where it was
      else if (d.into) { const [x, y] = at(e); onShow(d.s, [near0(x - W / 2), near0(y - H / 2)]); }
    }
  }
  const lit = (k: string) => !!sel && "edge" in sel && sel.edge === k;
  // a picked box (not while dragging): its arrows (in and out) and the states at their other end stand out, the rest fades back
  const focus = !drag && sel && "box" in sel ? sel.box : null;
  const near = focus ? new Set([focus, ...wf.edges.filter((e) => e.includes(focus)).flat()]) : null;
  // its arrows stand out: the picked box's, else the one under the pointer (only the arrows; the boxes stay as they are)
  const trace = focus ?? (drag ? null : hover);
  // routed again only when a box or an arrow changes (not on hover / pick): `pos` and `boxes` are new objects every render
  const geo = JSON.stringify([wf.edges, boxes.map((s) => [s, pos[s]])]);
  const paths = useMemo(() => routes(wf.edges, pos, boxes), [geo]); // eslint-disable-line react-hooks/exhaustive-deps -- `geo` is them
  const pickedEdge = sel && "edge" in sel ? wf.edges.find((x) => key(x) === sel.edge) : undefined, pickedMid = pickedEdge && paths.get(key(pickedEdge))?.mid;
  const arrowSel = pickedEdge && pickedMid ? { e: pickedEdge, m: pickedMid } : null; // the picked arrow: its × at the middle
  // focus only picks from the keyboard (Tab): a pointer press picks on letting go, so drawing an arrow never dims its targets
  const keyFocus = (e: React.FocusEvent<Element>, s: Sel) => { if (e.currentTarget.matches(":focus-visible")) setSel(s); };

  return (
    <div ref={frame} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)} onKeyDown={keys}
      style={{ "--wf-h": `${boxH}px` } as React.CSSProperties} className="relative flex min-h-0 flex-1 touch-none select-none @max-lg:flex-col">
      <div data-wf-zone="canvas" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* boxes and arrows take their own presses; the empty canvas drags the view (the hand), its click lets go of the pick */}
        <GoneBanner gone={gone} onPick={(s) => { setSel({ box: s }); setLinking(null); }} />
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={box} tabIndex={-1} onPointerDown={(e) => { if (e.button || (e.target as Element).closest("button")) return; const el = box.current!; grab(e, { kind: "pan", ox: e.clientX, oy: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false }); }}
          className={cn("relative h-(--wf-h) cursor-grab overflow-auto bg-paper-2 outline-none transition-shadow md:h-auto md:min-h-60 md:flex-1", drag?.kind === "pan" && drag.moved && "cursor-grabbing", drag?.kind === "add" && drag.into && "shadow-[inset_0_0_0_2px_var(--color-hl)]")}
          style={{ backgroundImage: "radial-gradient(var(--color-rule) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
          {/* the scroll extent follows the zoom; the flow inside is drawn at 1 and scaled */}
          <div className="relative" style={{ width: width * zoom, height: height * zoom }}>
          <div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `scale(${zoom})` }}>
          <svg width={width} height={height} overflow="visible" className="pointer-events-none absolute top-0 left-0">
            <defs>
              {["n", "s"].map((m) => (
                <marker aria-hidden key={m} id={`wf-${m}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                  <path d="M0,1 L9,5 L0,9 L2,5 z" fill={m === "s" ? "var(--color-hl)" : "var(--color-ink-3)"} />
                </marker>
              ))}
            </defs>
            {/* the traced box's arrows last: drawn over the rest */}
            {(trace ? [...wf.edges].sort((x, y) => +x.includes(trace) - +y.includes(trace)) : wf.edges).map((e) => {
              const k = key(e), a = paths.get(k);
              if (!a) return null;
              const on = lit(k), rel = !!trace && e.includes(trace);
              const dead = gone.includes(e[0]) || gone.includes(e[1]); // leads to / from a deleted state: drawn broken
              return (
                <g key={k} role="button" tabIndex={0} aria-label={t("Mũi tên {from} → {to}, Delete để xóa", { from: e[0], to: e[1] })} className={cn("group/a pointer-events-auto cursor-pointer outline-none transition-opacity duration-(--dur-short)", trace && !rel && !on && "opacity-15")}
                  onPointerDown={(ev) => { ev.stopPropagation(); setLinking(null); setSel(on ? null : { edge: k }); }} onFocus={(ev) => keyFocus(ev, { edge: k })}>
                  <path d={a.d} fill="none" stroke="transparent" strokeWidth={14} />
                  <path d={a.d} fill="none" stroke={on || rel ? "var(--color-hl)" : dead ? "var(--color-error)" : "var(--color-ink-3)"} strokeWidth={on ? 2.5 : rel ? 2 : 1.5} strokeLinecap="round"
                    strokeDasharray={dead ? "5 4" : undefined} markerEnd={`url(#wf-${on || rel ? "s" : "n"})`}
                    className={cn("transition-opacity duration-(--dur-short)", !on && !rel && "opacity-55 group-hover/a:opacity-100")} />
                </g>
              );
            })}
            {drag?.kind === "link" && (() => { const [x, y] = pos[drag.s]; return <line x1={x + W} y1={y + H / 2} x2={drag.x} y2={drag.y} stroke="var(--color-hl)" strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#wf-s)" />; })()}
          </svg>
          {arrowSel && (
            <button type="button" aria-label={t("Xóa mũi tên {from} → {to}", { from: arrowSel.e[0], to: arrowSel.e[1] })} onClick={() => drop({ edge: key(arrowSel.e) })} style={{ left: arrowSel.m[0] - 11, top: arrowSel.m[1] - 11 }}
              className="absolute z-10 grid size-[22px] place-items-center rounded-full bg-error text-cotton shadow-stock"><X className="size-3.5" /></button>
          )}
          {gone.filter((s) => pos[s]).map((s) => { // a state deleted / renamed on YouTrack: struck out, picked to fix it
            const [x, y] = pos[s], picked = !!sel && "box" in sel && sel.box === s;
            return (
              <div key={s} data-state={s} role="button" tabIndex={0} aria-pressed={picked} aria-label={t("{state} đã bị xóa trên YouTrack: Enter để thay bằng State khác", { state: s })}
                style={{ left: x, top: y, width: W, height: H }} onFocus={(e) => keyFocus(e, { box: s })} {...hoverOn(s)}
                onPointerDown={(e) => { if (e.button) return; const [px, py] = at(e); grab(e, { kind: "move", s, dx: px - x, dy: py - y, to: null, out: false }); }}
                className={cn("absolute flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-input)] border border-dashed border-error/70 bg-cotton pr-2 pl-2.5 text-xs outline-none transition-[box-shadow,opacity,filter] duration-(--dur-short) focus-visible:ring-2 focus-visible:ring-hl/60",
                  picked && "ring-2 ring-error/60", near && !near.has(s) && "opacity-35 blur-[1.5px]")}>
                <TriangleAlert className="size-3.5 shrink-0 text-error" aria-hidden />
                <span className="truncate text-ink-2 line-through decoration-error/60">{s}</span>
              </div>
            );
          })}
          {states.map((s) => {
            const [x, y] = pos[s], target = drag?.kind === "link" && drag.over === s && drag.s !== s;
            const picked = !!sel && "box" in sel && sel.box === s, moving = drag?.kind === "move" && drag.s === s;
            return (
              <div key={s} data-state={s} role="button" tabIndex={0} aria-pressed={picked} aria-label={t("{state}: Enter để nối mũi tên, Delete để bỏ khỏi workflow", { state: s })}
                style={{ left: x, top: y, width: W, height: H }} onFocus={(e) => keyFocus(e, { box: s })} {...hoverOn(s)}
                onPointerDown={(e) => { if (e.button) return; const [px, py] = at(e); grab(e, { kind: "move", s, dx: px - x, dy: py - y, to: null, out: false }); }}
                className={cn("group absolute cursor-grab rounded-[var(--radius-input)] bg-cotton shadow-stock outline-none transition-[box-shadow,opacity,filter] duration-(--dur-short) focus-visible:ring-2 focus-visible:ring-hl/60 active:cursor-grabbing",
                  (target || picked) && "ring-2 ring-hl", linking === s && "outline-2 outline-offset-2 outline-hl outline-dashed", moving && "z-10 shadow-lg", moving && drag.out && "opacity-40",
                  near && !near.has(s) && "opacity-35 blur-[1.5px]")}>
                <StatePill state={s} className="size-full rounded-[var(--radius-input)] pr-5 pl-2.5" />
                <span aria-hidden onPointerDown={(e) => { if (e.button) return; const [px, py] = at(e); grab(e, { kind: "link", s, x: px, y: py, over: null }); setSel(null); }}
                  className="absolute top-1/2 -right-[6px] size-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-cotton bg-hl opacity-70 shadow-stock transition-[opacity,scale] duration-(--dur-micro) group-hover:opacity-100 hover:scale-125" />
                <AnimatePresence>
                  {picked && ( // the picked box's own way off the canvas (same as Delete; the pointer's, and a touch screen's)
                    <motion.button key="x" type="button" tabIndex={-1} aria-label={t("Bỏ {state} khỏi workflow", { state: s })}
                      initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ type: "spring", stiffness: 520, damping: 30 }}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => drop({ box: s })}
                      className="absolute -top-2.5 -right-2.5 z-10 grid size-[22px] place-items-center rounded-full bg-error text-cotton shadow-stock hover:brightness-110">
                      <X className="size-3.5" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          </div>
          </div>
        </div>
        <AnimatePresence>
          {focus && gone.includes(focus) && (
            <GonePanel key={focus} state={focus} arrows={wf.edges.filter((e) => e.includes(focus)).length} states={all} hidden={hidden}
              onReplace={(to) => { onReplace(focus, to); setSel(null); }} onDrop={() => drop({ box: focus })} />
          )}
        </AnimatePresence>
        </div>
        <div role="toolbar" aria-label={t("Zoom sơ đồ")} className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-full bg-cotton/90 p-0.5 shadow-stock backdrop-blur">
          <Hint title={t("Thu nhỏ")} text={t("Phím − khi đang ở sơ đồ; Ctrl / ⌘ + cuộn hoặc chụm hai ngón trên trackpad để zoom quanh con trỏ.")}>
            <Button type="button" size="icon-xs" variant="ghost" className="rounded-full" aria-label={t("Thu nhỏ")} disabled={zoom <= ZOOM_MIN} onClick={() => zoomStep(-0.1)}><Minus /></Button>
          </Hint>
          <Hint title={t("Về 100%")} text={t("Phím 0 khi đang ở sơ đồ.")}>
            <Button type="button" size="xs" variant="ghost" className="min-w-12 rounded-full tabular-nums" aria-label={t("Về 100%")} onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</Button>
          </Hint>
          <Hint title={t("Phóng to")} text={t("Phím + khi đang ở sơ đồ.")}>
            <Button type="button" size="icon-xs" variant="ghost" className="rounded-full" aria-label={t("Phóng to")} disabled={zoom >= ZOOM_MAX} onClick={() => zoomStep(0.1)}><Plus /></Button>
          </Hint>
          <Hint title={t("Vừa khung")} text={t("Thu nhỏ để thấy cả sơ đồ trong khung (không phóng quá 100%).")}>
            <Button type="button" size="icon-xs" variant="ghost" className="rounded-full" aria-label={t("Vừa khung")} onClick={fitZoom}><Maximize /></Button>
          </Hint>
        </div>
        <AnimatePresence>
          {(linking || !wf.edges.length) && ( // over the canvas's foot (left; the zoom bar is right), outside its scroll
            <motion.p key={linking ? "link" : "empty"} role="status" initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-none absolute bottom-3 left-3 w-fit max-w-[calc(100%-13rem)] rounded-2xl bg-cotton/90 px-3 py-1 text-xs text-ink-2 shadow-stock backdrop-blur">
              {linking ? t("Nối từ {state}: Tab tới ô đích rồi Enter (Esc để hủy)", { state: linking }) : t("Kéo chấm tròn của một ô sang ô khác để nối, hoặc Lấy từ YouTrack.")}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      {/* the states not in the workflow: drag one onto the canvas (or click it) to add it, drag a box here to take it off */}
      <ul data-wf-zone="tray" aria-label={t("State chưa dùng trong workflow")}
        className={cn("flex min-h-0 w-48 shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-rule bg-cotton p-3 transition-colors duration-(--dur-micro) @max-lg:max-h-32 @max-lg:w-auto @max-lg:flex-row @max-lg:flex-wrap @max-lg:border-t @max-lg:border-l-0",
          drag?.kind === "move" && drag.out && "bg-hl-wash", "max-md:max-h-(--wf-h)")}>
        <AnimatePresence initial={false}>
          {hidden.map((s) => (
            // layoutDependency: measured only when the column's chips change, not on every drag move
            <motion.li key={s} layout layoutDependency={hidden.length} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.15 }}
              className={cn("min-w-0", drag?.kind === "add" && drag.s === s && drag.moved && "opacity-40")}>
              <button type="button" aria-label={t("Thêm {state} vào workflow", { state: s })} onClick={() => onShow(s)}
                onPointerDown={(e) => { if (e.button) return; const [x, y] = inFrame(e); grab(e, { kind: "add", s, x, y, ox: x, oy: y, moved: false, into: false }); }}
                className="flex w-full max-w-full cursor-grab rounded-[var(--radius-input)] bg-cotton text-left shadow-stock transition-shadow hover:shadow-[0_0_0_1px_var(--color-hl)] focus-visible:ring-2 focus-visible:ring-hl active:cursor-grabbing">
                <StatePill state={s} className="h-9 w-full min-w-0 px-2.5" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
        {(!hidden.length || (drag?.kind === "move" && drag.out)) && (
          <li className="grid min-h-16 flex-1 place-items-center rounded-[var(--radius-input)] border border-dashed border-rule-2 p-2 text-center text-xs text-ink-3">
            {t("Kéo ô vào đây để bỏ khỏi workflow")}
          </li>
        )}
      </ul>
      {drag?.kind === "add" && drag.moved && ( // the chip under the pointer while it is carried to the canvas
        <div aria-hidden className="pointer-events-none absolute z-20 rounded-[var(--radius-input)] bg-cotton shadow-lg" style={{ left: drag.x - W / 2, top: drag.y - H / 2, width: W, height: H }}>
          <StatePill state={drag.s} className="size-full rounded-[var(--radius-input)] pl-2.5" />
        </div>
      )}
    </div>
  );
}

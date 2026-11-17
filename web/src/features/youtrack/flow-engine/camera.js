import { ANIM_MS, ZMAX, ZMIN } from './constants.js';
import { fitCam, zoomAt } from './geometry.js';
import { clamp } from './values.js';

// ------------------------------------------------------------------ camera (pan / zoom of one layer)
/** Owns the transform of `layer` inside `view` and the gestures that drive it (Figma convention): drag pans, two
 *  pointers pinch, ctrl / ⌘ + wheel (also a trackpad pinch) zooms around the cursor, plain wheel / two-finger
 *  scroll pans. One transform write per animation frame; no layout reads while moving. `fit(box)` while the view
 *  has no size (hidden, not laid out yet) waits and applies once it has one; the latest request wins.
 *  onTap(target): a press that did not move. reduced: MediaQueryList for prefers-reduced-motion. */
function camera(view, layer, { onTap, reduced, onZoom }) {
  let cam = { x: 0, y: 0, k: 1 }, rect = view.getBoundingClientRect(), pending = null;
  let raf = 0, anim = 0, idle = 0, wheel = null;
  const pts = new Map();
  let g = null, tapOn = null, moved = false;

  let zk = NaN; // the zoom last reported: a pan does not call onZoom
  const apply = () => {
    layer.style.transform = `translate3d(${cam.x}px,${cam.y}px,0) scale(${cam.k})`;
    if (cam.k !== zk) onZoom?.((zk = cam.k));
  };
  const moving = (on) => view.classList.toggle("uf-moving", on);
  const schedule = () => { if (!raf) raf = requestAnimationFrame(tick); };
  function stopAnim() {
    if (!anim) return;
    cancelAnimationFrame(anim);
    anim = 0;
    moving(false);
  }
  function move(to, animate) {
    stopAnim();
    if (!animate || reduced.matches) { cam = to; apply(); return; }
    const from = cam, t0 = performance.now();
    moving(true);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ANIM_MS), e = 1 - (1 - p) ** 3;
      cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      apply();
      if (p < 1) anim = requestAnimationFrame(step);
      else { anim = 0; moving(false); }
    };
    anim = requestAnimationFrame(step);
  }
  function fit(box, animate) {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) { pending = box; return; }
    pending = null;
    move(fitCam(box, w, h), animate);
  }
  const ro = new ResizeObserver(() => {
    if (!view.clientWidth || !view.clientHeight) return; // hidden: keep the last real size and camera
    rect = view.getBoundingClientRect();
    if (pending) fit(pending, false);
  });
  ro.observe(view);

  const at = (e) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function snap() {
    const p = [...pts.values()];
    g = { cam: { ...cam }, p, mid: p[1] && mid(p[0], p[1]), dist: p[1] && (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1) };
  }
  function gestureCam() {
    const p = [...pts.values()];
    if (p.length < 2 || !g.mid) return { k: g.cam.k, x: g.cam.x + p[0].x - g.p[0].x, y: g.cam.y + p[0].y - g.p[0].y };
    const m = mid(p[0], p[1]), k = clamp((g.cam.k * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)) / g.dist, ZMIN, ZMAX);
    const wx = (g.mid.x - g.cam.x) / g.cam.k, wy = (g.mid.y - g.cam.y) / g.cam.k;
    return { k, x: m.x - wx * k, y: m.y - wy * k };
  }
  function tick() {
    raf = 0;
    if (g && pts.size) cam = gestureCam();
    if (wheel) {
      cam = { ...cam, x: cam.x + wheel.dx, y: cam.y + wheel.dy };
      if (wheel.f !== 1) cam = zoomAt(cam, cam.k * wheel.f, wheel.x, wheel.y);
      wheel = null;
    }
    apply();
  }
  const flush = () => { if (raf) { cancelAnimationFrame(raf); tick(); } };

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("a, button, input, textarea, [contenteditable]")) return;
    stopAnim();
    flush();
    rect = view.getBoundingClientRect();
    try { view.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    pts.set(e.pointerId, at(e));
    if (pts.size === 1) { tapOn = e.target; moved = false; } else moved = true;
    snap();
    moving(true);
  }
  function onMove(e) {
    if (!pts.has(e.pointerId)) return;
    const p = at(e);
    pts.set(e.pointerId, p);
    if (!moved && Math.hypot(p.x - g.p[0].x, p.y - g.p[0].y) > 4) moved = true;
    schedule();
  }
  function onUp(e) {
    if (!pts.has(e.pointerId)) return;
    flush();
    pts.delete(e.pointerId);
    if (pts.size) return snap();
    g = null;
    moving(false);
    if (!moved && e.type === "pointerup") onTap(tapOn);
  }
  function onWheel(e) {
    e.preventDefault();
    stopAnim();
    if (!idle) { rect = view.getBoundingClientRect(); moving(true); } // once per burst: ancestors may have scrolled
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1, p = at(e);
    wheel ||= { f: 1, x: p.x, y: p.y, dx: 0, dy: 0 };
    if (e.ctrlKey || e.metaKey) Object.assign(wheel, { f: wheel.f * Math.exp(-clamp(e.deltaY * unit, -50, 50) * 0.01), x: p.x, y: p.y });
    else { wheel.dx -= e.deltaX * unit; wheel.dy -= e.deltaY * unit; }
    clearTimeout(idle);
    idle = setTimeout(() => { idle = 0; if (!pts.size) moving(false); }, 160);
    schedule();
  }
  view.addEventListener("pointerdown", onDown);
  view.addEventListener("pointermove", onMove);
  view.addEventListener("pointerup", onUp);
  view.addEventListener("pointercancel", onUp);
  view.addEventListener("wheel", onWheel, { passive: false });

  return {
    get: () => ({ ...cam }),
    move,
    fit,
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(raf);
      stopAnim();
      clearTimeout(idle);
    },
  };
}

export { camera };

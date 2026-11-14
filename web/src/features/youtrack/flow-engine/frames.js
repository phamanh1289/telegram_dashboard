import { cardOf, rowsOf } from './geometry.js';
import { shotOf } from './shots.js';
import { box, btn, h, placeFrame, shotImg, svg, zeplinLink } from './dom.js';
import { isOverlay } from './model.js';

/** One frame: phone (screen) or overlay frame with its card; rows positioned from the same geometry as arrows.
 *  `linked`: set of "screen.item" sources that have a link. `edit`: also draw the dots you drag links from.
 *  `lead`: the title prefix every screen shares, left out of the label above the frame. */
function buildFrame(s, t, linked, edit, lead = "", isStart = false) {
  const c = cardOf(s), sh = shotOf(s), rows = rowsOf(s);
  const el = h("div", "uf-screen" + (isOverlay(s) ? " uf-ov uf-" + s.kind : "") + (sh ? " uf-shot" : ""));
  el.dataset.id = s.id;
  const card = h("div", "uf-card" + (s.items.length || sh ? "" : " uf-empty"));
  box(card, c);
  if (sh) {
    const pic = h("div", "uf-imgbox");
    pic.append(shotImg(sh, "", true));
    card.append(pic);
  }
  const head = h("div", "uf-head");
  box(head, { x: 0, y: c.head, w: c.w, h: c.headH });
  if (isStart) {
    const b = h("span", "uf-startb", "▶");
    b.title = t("startBadge");
    b.setAttribute("aria-label", t("startBadge"));
    head.append(b);
  }
  head.append(h("div", "uf-title", s.title));
  if (s.note) { // plain text: textContent / title never parse it
    const m = h("span", "uf-memo", "✎");
    m.title = s.note;
    m.setAttribute("aria-label", t("noteBadge"));
    head.append(m);
  }
  if (s.ac) head.append(h("span", "uf-ac", s.ac));
  if (s.zeplin) head.append(zeplinLink(s.zeplin, t));
  // the name above the frame at a constant on-screen size (Figma style): readable when the map is zoomed out.
  // Pure CSS from the camera's --zk; no per-label work on a pan, none in JS on a zoom.
  const label = h("div", "uf-flabel");
  label.setAttribute("aria-hidden", "true"); // the in-frame title is the accessible name; this one only repeats it
  label.append(h("span", "uf-ltitle", (lead && s.title.startsWith(lead) ? s.title.slice(lead.length) : s.title) || s.title));
  if (s.ac) label.append(h("span", "uf-lac", s.ac));
  card.append(label, head);
  s.items.forEach((it, i) => {
    const { r, hot } = rows[i];
    const rect = hot && it.rect; // hand-drawn and on the frame: edit mode moves / resizes it
    const row = h("div", "uf-item " + (hot ? "uf-hot " : "") + (rect ? "uf-rect " : "") +
      (linked.has(`${s.id}.${it.id}`) ? "uf-linked" : "uf-dead"), it.label);
    row.dataset.item = it.id;
    if (rect && edit) row.append(h("span", "uf-rsz"));
    if (!hot && sh) row.title = t("offShot");
    box(row, r);
    row.style.lineHeight = r.h - 2 + "px";
    card.append(row);
  });
  if (edit) {
    const dot = (src, x, y) => {
      const d = btn(null, "uf-dot");
      d.dataset.src = src;
      d.dataset.x = s.x + c.x + x; // world coordinates: where the new arrow starts
      d.dataset.y = s.y + c.y + y;
      d.style.left = x + "px";
      d.style.top = y + "px";
      d.setAttribute("aria-label", t("dotHint"));
      card.append(d);
    };
    dot(s.id, c.w, c.head + c.headH / 2);
    s.items.forEach((it, i) => {
      const r = rows[i].r;
      dot(`${s.id}.${it.id}`, r.x + r.w, r.y + r.h / 2);
    });
  }
  el.append(card);
  placeFrame(el, s);
  return el;
}
function markers(uid) {
  const defs = svg("defs", {});
  for (const k of ["a", "b"]) {
    const m = svg("marker", { id: `${uid}-${k}`, class: `uf-mk-${k}`, viewBox: "0 0 10 10", refX: 8, refY: 5,
      markerWidth: 14, markerHeight: 14, markerUnits: "userSpaceOnUse", orient: "auto" });
    m.append(svg("path", { d: "M0 0.5L10 5L0 9.5z" }));
    defs.append(m);
  }
  return defs;
}

export { buildFrame, markers };

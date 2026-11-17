import { canFold, cardOf, rowsOf } from './geometry.js';
import { H } from './constants.js';
import { shotOf } from './shots.js';
import { box, btn, h, placeFrame, shotImg, svg, zeplinLink } from './dom.js';
import { isOverlay } from './model.js';

/** One frame: phone (screen) or overlay frame with its card; rows positioned from the same geometry as arrows.
 *  `linked`: set of "screen.item" sources that have a link. `edit`: also draw the dots you drag links from.
 *  `lead`: the title prefix every screen shares, left out of the label above the frame. */
function buildFrame(s, t, linked, edit, lead = "", isStart = false) {
  const c = cardOf(s), sh = shotOf(s), rows = rowsOf(s);
  const el = h("div", "uf-screen" + (isOverlay(s) ? " uf-ov uf-" + s.kind : "") + (sh ? " uf-shot" : "") + (sh && s.fold ? " uf-folded" : ""));
  el.dataset.id = s.id;
  if (c.h !== H && sh) el.style.height = c.h + "px"; // a design that scrolls (or a web page): the frame is as long as it
  const card = h("div", "uf-card" + (s.items.length || sh ? "" : " uf-empty"));
  box(card, c);
  if (sh) {
    const pic = h("div", "uf-imgbox uf-ld");
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
  if (isStart) label.append(h("span", "uf-lstart", "▶")); // the in-frame badge is hidden with its title bar when zoomed out
  label.append(h("span", "uf-ltitle", (lead && s.title.startsWith(lead) ? s.title.slice(lead.length) : s.title) || s.title));
  if (s.ac) label.append(h("span", "uf-lac", s.ac));
  card.append(label, head);
  s.items.forEach((it, i) => {
    const { r, hot, z, more, lead } = rows[i];
    if (more && !lead) return; // drawn by the row that stands for them
    const rect = hot && it.rect; // hand-drawn and on the frame: edit mode moves / resizes it
    const all = more ? s.items.filter((_, j) => rows[j].more) : [it]; // a "+k" row: every button it stands for
    const row = h("div", "uf-item " + (hot ? "uf-hot " : "") + (rect ? "uf-rect " : "") + (more ? "uf-more " : "") +
      (all.some((x) => linked.has(`${s.id}.${x.id}`)) ? "uf-linked" : "uf-dead"), more ? t("moreHidden", { n: more }) : it.label);
    if (more) row.title = all.map((x) => x.label).join(", ");
    row.dataset.item = it.id;
    if (rect && edit) row.append(h("span", "uf-rsz"));
    if (!hot && sh && !more) row.title = t("offShot");
    box(row, r);
    if (hot) row.style.zIndex = z; // a smaller area above a larger one: the press goes to the one on top
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
      const { r, more, lead } = rows[i];
      if (more && !lead) return; // one dot on a "+k" row: pick a button in the panel to link the others
      dot(`${s.id}.${it.id}`, r.x + r.w, r.y + r.h / 2);
    });
  }
  if (edit && canFold(s)) { // a long design: fold it to its top / show it whole again (the editor handles the press)
    const b = btn(t(s.fold ? "unfold" : "fold"), "uf-btn uf-fold");
    b.setAttribute("aria-expanded", String(!s.fold));
    b.style.top = Math.min(c.h, H) - 22 + "px"; // at the end of its first screenful: reachable without scrolling down a long list
    const edge = h("div", "uf-foldh"); // drag the bottom edge: fold to exactly that height (the editor handles it)
    edge.style.top = c.h - 7 + "px";
    edge.setAttribute("aria-hidden", "true"); // the panel's height box is the keyboard way
    card.append(b, edge);
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

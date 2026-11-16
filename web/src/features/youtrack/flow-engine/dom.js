import { SVGNS, W, ZEPLIN } from './constants.js';

// ------------------------------------------------------------------ DOM builders
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(label, cls, onClick) {
  const b = h("button", cls, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
const ICONS = {
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z", undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3", grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  x: "M6 6l12 12M18 6 6 18", back: "M15 6l-6 6 6 6", ret: "M9 10l-5 5 5 5M4 15h11a5 5 0 0 0 5-5V4", check: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
};
function icon(name, size = 16) {
  const i = svg("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
  i.append(svg("path", { d: ICONS[name] }));
  return i;
}
/** A button drawn as an icon (plus `text` when given); `label` stays its accessible name and its tooltip. */
function ibtn(name, label, cls, onClick, text) {
  const b = btn(null, cls + (text ? "" : " uf-icon"), onClick);
  b.setAttribute("aria-label", label);
  b.title = label;
  b.append(icon(name));
  if (text) b.append(h("span", null, text));
  return b;
}
function svg(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
const box = (e, r) => Object.assign(e.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
const placeFrame = (el, s) => { el.style.transform = `translate(${s.x}px,${s.y}px)`; };
/** A Zeplin image at frame width; `lazy`: the map, where most frames start off screen. */
function shotImg(sh, alt, lazy) {
  const img = h("img", "uf-img");
  img.alt = alt;
  img.decoding = "async";
  img.draggable = false;
  if (lazy) img.loading = "lazy";
  img.style.height = (sh.h * W) / sh.w + "px";
  img.src = sh.src;
  return img;
}
function zeplinLink(url, t) {
  const a = h("a", "uf-zeplin");
  a.target = "_blank";
  a.rel = "noopener";
  if (ZEPLIN.test(url)) a.href = url;
  a.setAttribute("aria-label", t("zeplin"));
  const i = svg("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
  i.append(svg("path", { d: "M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" }));
  a.append(i);
  return a;
}

export { h, btn, ibtn, icon, svg, box, placeFrame, shotImg, zeplinLink };

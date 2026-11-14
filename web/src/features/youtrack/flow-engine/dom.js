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

export { h, btn, svg, box, placeFrame, shotImg, zeplinLink };

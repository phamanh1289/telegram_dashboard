

// ------------------------------------------------------------------ model (pure)
const scr = (src) => src.split(".")[0];
const itm = (src) => (src.includes(".") ? src.slice(src.indexOf(".") + 1) : null);
const str = (v, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v) => (Number.isFinite(v) ? v : null);
/** A hand-drawn tap area {x, y, w, h} as fractions of the screen's whole image; null when it is not one (= uiflow.Rect). */
const rectOf = (r) => {
  if (!r || typeof r !== "object") return null;
  const { x, y, w, h: hh } = r;
  const ok = [x, y, w, hh].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && hh > 0 && x + w <= 1 + 1e-9 && y + hh <= 1 + 1e-9;
  return ok ? { x, y, w, h: hh } : null;
};
const ZSCREEN = /\/project\/([0-9a-f]{24})\/screen\/([0-9a-f]{24})/;
/** A Zeplin link's identity (= zeplin.canonical): project/screen ids, else the link without trailing punctuation.
 *  A zpl.io short link only resolves on the server, so two spellings of one screen may still differ here. */
const canon = (u) => { const m = ZSCREEN.exec(str(u)); return m ? `${m[1]}/${m[2]}` : str(u).trim().replace(/[.,:;/]+$/, ""); };
/** The screen the prototype and the test paths start from: the chosen one, else the first. */
const startOf = (f) => (f.start && f.screens.some((s) => s.id === f.start) ? f.start : f.screens[0]?.id ?? null);
const isPop = (s) => s.kind !== "screen";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export { scr, itm, str, num, rectOf, ZSCREEN, canon, startOf, isPop, clamp };

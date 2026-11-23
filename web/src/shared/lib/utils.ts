export { cn } from "cn"

/** The shortcut modifier as the keyboard labels it: ⌘ on Apple, Ctrl elsewhere. Client-only UI (it is "Ctrl" while prerendering). */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** --dur-short in ms ("220ms", or ".22s" once minified); the design look changes it. */
export function durShort() {
  const d = getComputedStyle(document.documentElement).getPropertyValue("--dur-short").trim();
  return parseFloat(d) * (d.endsWith("ms") ? 1 : 1000) || 220;
}

/** Save rows as a CSV file Excel opens as UTF-8; cells starting with = + - @ are neutralised for spreadsheets. */
export function downloadCsv(rows: unknown[][], filename: string) {
  const cell = (v: unknown) => { const s = String(v ?? ""); return '"' + (/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'; };
  downloadText("\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), filename, "text/csv");
}

export function downloadText(text: string, filename: string, type = "text/markdown") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** `Map.groupBy` (ES2024, missing before Safari 17.4): items by key, keeping order. */
export function groupBy<T, K>(items: Iterable<T>, key: (item: T) => K) {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/** Lowercase without accents ("Luận" -> "luan") for forgiving search; anything else becomes its string (null: ""). */
export const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();

/** Scroll behaviour that respects reduced motion. */
export const smooth = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/** Line diff (LCS) of `a` -> `b`: each line kept (" "), removed ("-") or added ("+").
 *  ponytail: O(n·m) table, fine for a story's few hundred lines. */
export function lineDiff(a: string, b: string): [" " | "-" | "+", string][] {
  const x = a.replace(/\r\n/g, "\n").split("\n"), y = b.replace(/\r\n/g, "\n").split("\n");
  const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [" " | "-" | "+", string][] = [];
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { out.push([" ", x[i]]); i++; j++; }
    else if (j < y.length && (i >= x.length || L[i][j + 1] >= L[i + 1][j])) out.push(["+", y[j++]]);
    else out.push(["-", x[i++]]);
  }
  return out;
}

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

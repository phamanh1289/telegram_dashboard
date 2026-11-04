export { cn } from "cn"

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

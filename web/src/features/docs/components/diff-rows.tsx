"use client";

import { useState } from "react";
import { Fold } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { fmtNum, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

// One block of changed lines, read compactly: a removed line and the added line that is a small edit of it (a JSON
// value, a word in a table row) become one row with only the changed words marked; runs of the same kind sit together
// as one band; past `max` rows the rest fold under "Hiện thêm". Lines come as stored (backend docs/parts.changes):
// a block's removed lines, then its added ones, each in document order.

export type Row = { kind: "del" | "add"; text: string } | { kind: "mod"; old: string; text: string };

const W = /[\p{L}\p{N}_]/u;
const LOOK = 8; // added lines searched ahead for a removed line's edit
const SAME = 0.5; // share of a line two lines must have in common (head + tail) to be one edit

/** Lengths of the common head and tail of two lines; `words`: cut back to whole words for display. */
function ends(a: string, b: string, words = false): [number, number] {
  const n = Math.min(a.length, b.length);
  let h = 0, t = 0;
  while (h < n && a[h] === b[h]) h++;
  while (t < n - h && a[a.length - 1 - t] === b[b.length - 1 - t]) t++;
  if (words) {
    const cut = (x: string, y: string, i: number) => W.test(x[i - 1] ?? "") && (W.test(x[i] ?? "") || W.test(y[i] ?? ""));
    while (h > 0 && cut(a, b, h)) h--;
    const ra = [...a].reverse().join(""), rb = [...b].reverse().join("");
    while (t > 0 && cut(ra, rb, t)) t--;
  }
  return [h, t];
}

/** Removed and added lines as rows: each removed line paired with the next added line that is an edit of it. */
export function pairRows(removed: string[], added: string[]): Row[] {
  const rows: Row[] = [];
  let j = 0;
  for (const old of removed.map(tidy)) {
    const k = added.slice(j, j + LOOK).findIndex((l) => {
      const n = tidy(l), [h, t] = ends(old, n);
      // same key, new value: `"gia": 1` → `"gia": 2`, a table row's first cell, `key = …`
      return (h + t) / Math.max(old.length, n.length, 1) >= SAME || (h >= 4 && /[:|=]/.test(old.slice(0, h)));
    });
    if (k < 0) { rows.push({ kind: "del", text: old }); continue; }
    for (const l of added.slice(j, j + k)) rows.push({ kind: "add", text: tidy(l) });
    rows.push({ kind: "mod", old, text: tidy(added[j + k]) });
    j += k + 1;
  }
  for (const l of added.slice(j)) rows.push({ kind: "add", text: tidy(l) });
  return rows;
}

// The Markdown a stored line carries, made easy to read: quote mark and a table row's outer pipes dropped, inner pipes
// faint, **bold** and `code` shown as such (display only: the raw line still finds the change in the document).
const tidy = (s: string) => s.replace(/^>\s*/, "").replace(/^\|\s*(.*?)\s*\|$/, "$1");
const fmt = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`|\s\|\s)/).map((p, i) =>
  /^\*\*.+\*\*$/.test(p) ? <b key={i} className="font-bold">{p.slice(2, -2)}</b>
  : /^`.+`$/.test(p) ? <code key={i} className="rounded-sm bg-paper-3 px-1 font-mono">{p.slice(1, -1)}</code>
  : /^\s\|\s$/.test(p) ? <span key={i} className="px-1.5 text-rule-2">|</span>
  : p);

const BAND = { del: "bg-error-wash", add: "bg-ok-wash", mod: "bg-cotton" } as const;
const SIGN = { del: ["−", "text-error"], add: ["+", "text-ok"], mod: ["±", "text-ink-3"] } as const;

/** The rows of one block in a bordered box; `onLine`: a row clicked (the line in the document now, else the old one). */
export function DiffRows({ removed, added, max, onLine }: {
  removed: string[]; added: string[];
  max?: number; // rows shown before "Hiện thêm"
  onLine?: (line: string) => void;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  const rows = pairRows(removed, added);
  const cut = max && rows.length > max + 1 ? max : rows.length;
  const row = (r: Row, i: number) => (
    <RowLine key={i} r={r} edge={i > 0 && rows[i - 1].kind !== r.kind} onClick={onLine && (() => onLine(r.text))} />
  );
  return (
    <span className="grid min-w-0 overflow-hidden rounded-md border border-rule">
      {rows.slice(0, cut).map(row)}
      {cut < rows.length && (
        <>
          <Fold open={all}><span className="grid">{rows.slice(cut).map((r, i) => row(r, cut + i))}</span></Fold>
          <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
            className="border-t border-rule bg-paper-2 px-2 py-1 text-left text-xs text-ink-2 hover:text-ink">
            {all ? t("Thu gọn") : t("Hiện thêm {n} dòng", { n: fmtNum(rows.length - cut) })}
          </button>
        </>
      )}
    </span>
  );
}

function RowLine({ r, edge, onClick }: { r: Row; edge: boolean; onClick?: () => void }) {
  const t = useT();
  const [sign, tone] = SIGN[r.kind];
  const code = /^\s*[{}[\]"]/.test(r.text); // JSON / code: keep the indent, monospace
  let body;
  if (r.kind === "mod") {
    const [h, tl] = ends(r.old, r.text, true);
    body = <>
      {fmt(r.text.slice(0, h))}
      {r.old.length - tl > h && <del className="rounded-sm bg-error-wash px-0.5 text-error decoration-error/60">{fmt(r.old.slice(h, r.old.length - tl))}</del>}
      {r.text.length - tl > h && <ins className="rounded-sm bg-ok-wash px-0.5 text-ok no-underline">{fmt(r.text.slice(h, r.text.length - tl))}</ins>}
      {fmt(r.text.slice(r.text.length - tl))}
    </>;
  } else body = fmt(r.text);
  const inner = (
    <>
      <span aria-hidden className={cn("shrink-0 font-mono font-bold", tone)}>{sign}</span>
      <span className={cn("min-w-0", code && "font-mono whitespace-pre-wrap")}>{body}</span>
    </>
  );
  const base = cn("flex gap-2 px-2 text-left leading-snug break-words text-ink", code ? "py-px" : "py-1", BAND[r.kind], edge && "border-t border-rule");
  if (!onClick) return <span className={base}>{inner}</span>;
  return (
    <Hint text={t("Xem chỗ đổi này trong tài liệu")} side="bottom">
      <button type="button" onClick={onClick} className={cn(base, "w-full hover:ring-1 hover:ring-rule-2 hover:ring-inset focus-visible:ring-2 focus-visible:ring-inset")}>{inner}</button>
    </Hint>
  );
}

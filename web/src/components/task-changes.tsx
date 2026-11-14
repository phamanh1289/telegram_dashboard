"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, ExternalLink, Folder, FolderOpen, GitBranch, GitPullRequest, Loader2, RotateCw, Rows2, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { AiFetching } from "@/components/ai/fetching";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { api, errorText, type Task } from "@/lib/api";
import { type Key, t as tNow, tMaybe, useT } from "@/lib/i18n";
import { sessionId, toast } from "@/lib/inbox";
import { cn } from "@/lib/utils";

// AI Agent › Thay đổi: a full page over the session list. Only what changed since the session started (the backend
// diffs from a snapshot taken then; older sessions: the whole working tree against HEAD). A folder tree on the left, the diffs
// grouped by the same folders on the right, each file a card that folds (CSS grid-rows, body mounted on hover / first open),
// before / after side by side or in one column, then branch + PR.

type Changes = { root: string; branch: string; baseline: boolean; files: { path: string; status: string; secret: boolean; mixed: boolean }[]; diff: string; truncated: boolean };
type Pr = { url: string | null; branch: string; skipped: string[]; note: string | null };

const ERR_KEYS: Record<string, Key> = {
  not_git_repo: "Thư mục dự án không phải repo git.", git_missing: "Máy chưa cài git.", no_changes: "Không có thay đổi nào để commit.",
  submodule_only: "File đổi đều nằm trong submodule: commit và mở PR trong repo submodule đó.",
  git_push_failed: "Không đẩy được nhánh lên remote (quyền hoặc mạng).", git_failed: "Git báo lỗi.", git_timeout: "Git chạy quá lâu, thử lại.",
  task_busy: "AI đang chạy: đợi xong lượt này.",
  mixed_changes: "Có file đã sửa từ trước phiên: tải lại Thay đổi rồi xác nhận lại.", no_baseline: "Phiên không có mốc lúc bắt đầu: tải lại Thay đổi rồi xác nhận lại.",
};
/** The error texts in the current language (render-time: the caller uses `useT`). */
const errs = () => Object.fromEntries(Object.entries(ERR_KEYS).map(([k, v]) => [k, tNow(v)]));

type Kind = "new" | "edit" | "del" | "rename";
const KIND: Record<Kind, { label: Key; letter: string; badge: string; fg: string }> = {
  new: { label: "Mới", letter: "A", badge: "bg-ok-wash text-ok", fg: "text-ok" },
  edit: { label: "Sửa", letter: "M", badge: "bg-warn-wash text-warn", fg: "text-warn" },
  rename: { label: "Đổi tên", letter: "R", badge: "bg-info-wash text-info", fg: "text-info" },
  del: { label: "Xóa", letter: "D", badge: "bg-error-wash text-error", fg: "text-error" },
};
const kindOf = (s: string): Kind => (s === "??" || s.includes("A") ? "new" : s.includes("D") ? "del" : s.includes("R") ? "rename" : "edit");

type Line = { k: " " | "+" | "-"; text: string; o?: number; n?: number; hl?: [number, number] }; // hl: the changed span of a paired line
type Hunk = { ctx: string; lines: Line[]; rows: { l?: Line; r?: Line }[] }; // rows: the side-by-side pairing
type FileDiff = { hunks: Hunk[]; add: number; del: number; binary: boolean; from?: string }; // from: a rename's old path
type File = FileDiff & { path: string; kind: Kind; secret: boolean; size: number };

/** Where the patch text of `chunk` lives: `+++ b/x`, else `--- a/x` (deleted), else the `diff --git a/x b/x` header. */
function pathOf(head: string, rows: string[]): string {
  const pick = (p: string) => rows.find((r) => r.startsWith(p))?.slice(p.length).replace(/\t$/, "");
  const plus = pick("+++ b/") ?? pick("rename to ") ?? pick("--- a/");
  if (plus) return plus;
  const rest = head.slice("diff --git ".length); // "a/P b/P": both halves the same length
  return rest.slice(2, 2 + (rest.length - 5) / 2);
}

/** The changed middle of two paired lines (common prefix / suffix left plain); none when they share almost nothing. */
function mark(a: Line, b: Line) {
  const x = a.text, y = b.text;
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  if (p + s < 3 || (p === x.length && p === y.length)) return;
  a.hl = [p, x.length - s];
  b.hl = [p, y.length - s];
}

/** `git diff` text → per-path hunks with line numbers, -/+ runs paired (side by side rows and changed spans). */
function parse(diff: string): Map<string, FileDiff> {
  const out = new Map<string, FileDiff>();
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const rows = chunk.split("\n");
    const f: FileDiff = { hunks: [], add: 0, del: 0, binary: false };
    let o = 0, n = 0, h: Hunk | null = null;
    for (const ln of rows.slice(1)) {
      const c = ln[0];
      if (h && (c === "+" || c === "-" || c === " ")) {
        const line: Line = { k: c, text: ln.slice(1) };
        if (c !== "+") line.o = o++;
        if (c !== "-") line.n = n++;
        if (c === "+") f.add++;
        if (c === "-") f.del++;
        h.lines.push(line);
        continue;
      }
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)/.exec(ln);
      if (m) { o = +m[1]; n = +m[2]; h = { ctx: m[3], lines: [], rows: [] }; f.hunks.push(h); }
      else if (!h && ln.startsWith("Binary files")) f.binary = true;
      else if (!h && ln.startsWith("rename from ")) f.from = ln.slice("rename from ".length);
    }
    for (const hk of f.hunks) { // pair each run of - with the + run right after it
      const L = hk.lines;
      for (let i = 0; i < L.length;) {
        if (L[i].k === " ") { hk.rows.push({ l: L[i], r: L[i] }); i++; continue; }
        const dels: Line[] = [], adds: Line[] = [];
        while (i < L.length && L[i].k === "-") dels.push(L[i++]);
        while (i < L.length && L[i].k === "+") adds.push(L[i++]);
        for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
          if (dels[j] && adds[j]) mark(dels[j], adds[j]);
          hk.rows.push({ l: dels[j], r: adds[j] });
        }
      }
    }
    out.set(pathOf(rows[0], rows), f);
  }
  return out;
}

type Dir = { name: string; path: string; dirs: Dir[]; files: File[]; n: number }; // path: "a/b/" ("" = the root), n: files under it

/** The files as a folder tree, folders before files, by name; a folder holding just one folder merges into it (a/b/c). */
function treeOf(files: File[]): Dir {
  const root: Dir = { name: "", path: "", dirs: [], files: [], n: 0 };
  for (const f of files) {
    let d = root;
    d.n++;
    for (const name of f.path.split("/").slice(0, -1)) {
      let c = d.dirs.find((x) => x.name === name);
      if (!c) d.dirs.push((c = { name, path: `${d.path}${name}/`, dirs: [], files: [], n: 0 }));
      d = c;
      d.n++;
    }
    d.files.push(f);
  }
  const tidy = (d: Dir, top: boolean): Dir => {
    while (!top && !d.files.length && d.dirs.length === 1) d = { ...d.dirs[0], name: `${d.name}/${d.dirs[0].name}` };
    d.dirs = d.dirs.map((c) => tidy(c, false)).sort((x, y) => x.name.localeCompare(y.name));
    d.files.sort((x, y) => base(x.path).localeCompare(base(y.path)));
    return d;
  };
  return tidy(root, true);
}

/** The folders holding files, in tree order: the right column's groups. */
const groupsOf = (d: Dir): Dir[] => [...d.dirs.flatMap(groupsOf), ...(d.files.length ? [d] : [])];

const OPEN_MAX = 400; // files longer than this start folded

/** What the session's project changed, as a page: back to the session, the files, branch + PR (push needs a second click). */
export function TaskChanges({ t, onBack }: { t: Task; onBack: () => void }) {
  const tt = useT();
  const q = useQuery({ queryKey: ["task-changes", t.id], queryFn: ({ signal }) => api<Changes>(`/tasks/${t.id}/changes`, { signal }), staleTime: 0, retry: false });
  const [view, setView] = useState<"split" | "unified">(() => (matchMedia("(min-width: 48rem)").matches ? "split" : "unified")); // phones: one column
  const [fold, setFold] = useState<Record<string, boolean>>({}); // user's open / closed per path, over the size default
  const { tree, groups, files } = useMemo(() => {
    const parsed = parse(q.data?.diff ?? "");
    const tree = treeOf((q.data?.files ?? []).map((f) => {
      const d = parsed.get(f.path) ?? { hunks: [], add: 0, del: 0, binary: false };
      return { ...d, path: f.path, kind: kindOf(f.status), secret: f.secret, size: d.hunks.reduce((s, h) => s + h.lines.length, 0) };
    }));
    const groups = groupsOf(tree);
    return { tree, groups, files: groups.flatMap((g) => g.files) };
  }, [q.data]);
  const mixed = useMemo(() => (q.data?.files ?? []).filter((f) => f.mixed && !f.secret).map((f) => f.path), [q.data]);
  const [shut, setShut] = useState<Record<string, boolean>>({}); // tree folders the user closed
  const [cur, setCur] = useState<string | null>(null); // the file last picked in the tree
  const isOpen = (f: File) => fold[f.path] ?? f.size <= OPEN_MAX;
  const allOpen = files.length > 0 && files.every(isOpen);
  const add = files.reduce((s, f) => s + f.add, 0), del = files.reduce((s, f) => s + f.del, 0);
  const jump = (f: File) => {
    setCur(f.path);
    setFold((v) => ({ ...v, [f.path]: true }));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(cardId(f.path))?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="detail-in flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 sm:px-4">
        <Button size="sm" variant="ghost" className="-ml-1" onClick={onBack}><ArrowLeft /> {tt("Phiên")}</Button>
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
          <GitPullRequest className="size-4 shrink-0 text-hl-2" aria-hidden /> {tt("Thay đổi")}
          <span className="font-mono text-xs font-normal text-ink-3 tabular-nums">{sessionId(t)}</span>
        </h2>
        {q.data && (
          <Hint side="bottom" text={q.data.root}>
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-paper-2 px-2 py-0.5 font-mono text-xs text-ink-2">
              <GitBranch className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{q.data.branch || "(detached)"}</span>
            </span>
          </Hint>
        )}
        {files.length > 0 && (
          <span className="flex items-center gap-2 font-mono text-xs tabular-nums">
            <span className="font-sans text-ink-2">{tt("{n} file thay đổi", { n: files.length })}</span>
            <span className="text-ok">+{add}</span><span className="text-error">−{del}</span>
          </span>
        )}
        <span className="flex-1" />
        {files.length > 0 && <>
          <Segmented id="diff-view" label={tt("Kiểu xem")} value={view} onChange={setView} items={[
            { value: "split", label: <span className="flex items-center gap-1.5"><Columns2 className="size-3.5" aria-hidden />{tt("Song song")}</span>, title: tt("Trước sửa bên trái, sau sửa bên phải") },
            { value: "unified", label: <span className="flex items-center gap-1.5"><Rows2 className="size-3.5" aria-hidden />{tt("Một cột")}</span>, title: tt("Một cột: dòng đỏ (−) là trước, dòng xanh (+) là sau") },
          ]} />
          <Hint side="bottom" text={allOpen ? tt("Thu gọn mọi file") : tt("Mở rộng mọi file")}>
            <Button size="icon-sm" variant="ghost" aria-label={allOpen ? tt("Thu gọn mọi file") : tt("Mở rộng mọi file")}
              onClick={() => setFold(Object.fromEntries(files.map((f) => [f.path, !allOpen])))}>
              {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
            </Button>
          </Hint>
        </>}
        <Hint side="bottom" text={tt("Đọc lại thay đổi từ dự án")}>
          <Button size="icon-sm" variant="ghost" aria-label={tt("Tải lại")} disabled={q.isFetching} onClick={() => void q.refetch()}>
            <RotateCw className={cn(q.isFetching && !q.isPending && "animate-spin")} />
          </Button>
        </Hint>
      </header>

      {q.isPending ? <AiFetching kind="agent" lines={[tt("Đang mở dự án"), tt("Đang đọc git status"), tt("Đang lấy diff")]} />
        : q.isError ? (
          <div role="alert" className="grid justify-items-start gap-2 p-5 text-sm">
            <p className="text-error">{errorText(q.error, errs(), tt("Không đọc được thay đổi."))}</p>
            <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}><RotateCw /> {tt("Thử lại")}</Button>
          </div>
        ) : !files.length ? (
          <div className="grid flex-1 content-center justify-items-center gap-3 text-sm text-ink-3">
            <p>{tt("Phiên này chưa thay đổi file nào trong dự án.")}</p>
            <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft /> {tt("Về phiên")}</Button>
          </div>
        ) : <>
          <div className="flex min-h-0 flex-1">
            <nav aria-label={tt("File thay đổi")} className="hidden w-72 shrink-0 overflow-y-auto border-r p-2 md:block">
              <TreeDir d={tree} shut={shut} cur={cur} onDir={(p) => setShut((v) => ({ ...v, [p]: !v[p] }))} onFile={jump} />
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
              <div className="mx-auto grid max-w-[110rem] grid-cols-[minmax(0,1fr)] gap-6">
                {files.some((f) => f.secret) && (
                  <p className="flex items-start gap-2 rounded-md bg-warn-wash px-3 py-2 text-xs text-warn">
                    <ShieldAlert className="size-4 shrink-0" aria-hidden />
                    {tt("File trông như chứa bí mật (.env, khóa, chứng chỉ) sẽ không được commit: {files}", { files: files.filter((f) => f.secret).map((f) => f.path).join(", ") })}
                  </p>
                )}
                {(mixed.length > 0 || !q.data.baseline) && (
                  <p className="flex items-start gap-2 rounded-md bg-warn-wash px-3 py-2 text-xs text-warn">
                    <ShieldAlert className="size-4 shrink-0" aria-hidden />
                    {q.data.baseline ? tt("File đã có sửa từ trước phiên, PR sẽ chứa cả phần đó (không hiện ở dưới): {files}", { files: mixed.join(", ") })
                      : tt("Phiên này không có mốc lúc bắt đầu: PR sẽ chứa mọi thay đổi đang có trong thư mục dự án.")}
                  </p>
                )}
                {groups.map((g) => (
                  <section key={g.path} aria-label={g.path || tt("Thư mục gốc")} className="grid grid-cols-[minmax(0,1fr)] gap-2">
                    <DirLabel path={g.path} n={g.files.length} />
                    {g.files.map((f) => (
                      <FileCard key={f.path} f={f} open={isOpen(f)} split={view === "split"} onToggle={() => setFold((v) => ({ ...v, [f.path]: !isOpen(f) }))} />
                    ))}
                  </section>
                ))}
                {q.data.truncated && <p className="text-center text-xs text-ink-3">{tt("… Diff dài, phần còn lại không hiện.")}</p>}
              </div>
            </div>
          </div>
          <PrBar t={t} count={files.filter((f) => !f.secret).length} mixedOk={mixed.length > 0 || !q.data.baseline} onDone={() => void q.refetch()} />
        </>}
    </div>
  );
}

const cardId = (path: string) => `chg-${path.replace(/[^\w-]/g, "_")}`;
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const ROW = "grid w-full grid-cols-[0.875rem_0.875rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors duration-(--dur-micro) hover:bg-paper-2";

/** One tree level: folders (click folds them) then files (click jumps to the card). Nested levels hang on a guide line. */
function TreeDir({ d, shut, cur, onDir, onFile }: { d: Dir; shut: Record<string, boolean>; cur: string | null; onDir: (path: string) => void; onFile: (f: File) => void }) {
  const tt = useT();
  return (
    <ul className="grid gap-px">
      {d.dirs.map((c) => {
        const on = !shut[c.path];
        return (
          <li key={c.path}>
            <button type="button" aria-expanded={on} onClick={() => onDir(c.path)} className={ROW}>
              <ChevronRight className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-emph)", on && "rotate-90")} aria-hidden />
              {on ? <FolderOpen className="size-3.5 text-ink-3" aria-hidden /> : <Folder className="size-3.5 text-ink-3" aria-hidden />}
              <span className="truncate text-ink-2">{c.name}</span>
              <span className="font-mono text-2xs text-ink-3 tabular-nums">{c.n}</span>
            </button>
            <div className="fold" data-open={on || undefined}>
              <div><div className="ml-[0.8rem] border-l pl-1"><TreeDir d={c} shut={shut} cur={cur} onDir={onDir} onFile={onFile} /></div></div>
            </div>
          </li>
        );
      })}
      {d.files.map((f) => (
        <li key={f.path}>
          <button type="button" onClick={() => onFile(f)} aria-current={cur === f.path || undefined}
            className={cn(ROW, cur === f.path && "bg-hl-wash", f.secret && "text-ink-3 line-through")}>
            <span />
            <span className={cn("text-center font-mono text-2xs font-bold", KIND[f.kind].fg)} aria-hidden>{KIND[f.kind].letter}</span>
            <span className="truncate font-mono text-ink">{base(f.path)}<span className="sr-only"> ({tt(KIND[f.kind].label)})</span></span>
            <span className="font-mono text-2xs tabular-nums">
              {f.add > 0 && <span className="text-ok">+{f.add}</span>} {f.del > 0 && <span className="text-error">−{f.del}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A group's folder over its cards: the far end (last two folders) always shows, the start gives way on narrow screens. */
function DirLabel({ path, n }: { path: string; n: number }) {
  const tt = useT();
  const parts = path.split("/").filter(Boolean);
  const head = parts.slice(0, -2).join("/"), tail = parts.slice(-2).join("/");
  return (
    <h3 className="flex min-w-0 items-center gap-1.5 px-1 font-mono text-xs">
      <Folder className="size-3.5 shrink-0 text-ink-3" aria-hidden />
      {path ? <span className="flex min-w-0">
        {head && <span className="truncate text-ink-3">{head}/</span>}
        <span className="shrink-0 font-medium text-ink-2">{tail}</span>
      </span> : <span className="font-sans text-ink-2">{tt("Thư mục gốc")}</span>}
      <span className="shrink-0 font-sans text-ink-3 tabular-nums">· {n}</span>
    </h3>
  );
}

/** One file: sticky header (kind, path, +/-), the diff folding under it. The body mounts on first open and stays for the fold-up. */
function FileCard({ f, open, split, onToggle }: { f: File; open: boolean; split: boolean; onToggle: () => void }) {
  const tt = useT();
  const [seen, setSeen] = useState(open); // body mounted: on hover already, so a click only animates
  if (open && !seen) setSeen(true);
  const one = !split || f.kind === "new" || f.kind === "del"; // a new / deleted file has one side only
  return (
    <section id={cardId(f.path)} aria-label={f.path} className="scroll-mt-2 rounded-lg border bg-cotton shadow-edge">
      <button type="button" aria-expanded={open} onClick={onToggle} onPointerEnter={() => setSeen(true)} onFocus={() => setSeen(true)}
        className={cn("sticky top-0 z-10 grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-t-lg bg-cotton px-3 py-1.5 text-left transition-[background-color,border-radius] duration-(--dur-short) hover:bg-paper-2",
          !open && "rounded-b-lg")}>
        <ChevronRight className={cn("size-4 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-emph)", open && "rotate-90")} aria-hidden />
        <span className={cn("rounded-sm px-1.5 py-0.5 text-2xs font-bold", KIND[f.kind].badge)}>{tt(KIND[f.kind].label)}</span>
        <span className={cn("truncate font-mono text-sm", f.secret && "line-through")}>
          {f.from && <span className="text-ink-3 line-through decoration-ink-3/60">{f.from}</span>}{f.from && <span className="px-1.5 text-info">→</span>}
          <span className="font-medium text-ink">{base(f.path)}</span>
        </span>
        <span className="flex items-center gap-2 font-mono text-xs tabular-nums">
          {f.add > 0 && <span className="text-ok">+{f.add}</span>}
          {f.del > 0 && <span className="text-error">−{f.del}</span>}
          <Bar add={f.add} del={f.del} />
        </span>
      </button>
      <div className="fold" data-open={open || undefined}>
        <div>
          {seen && (
            <div className="border-t font-mono text-xs leading-5">
              {f.binary ? <Note>{tt("File nhị phân, không xem được nội dung.")}</Note>
                : !f.hunks.length ? <Note>{f.secret ? tt("File bí mật: không đọc nội dung.") : f.from ? tt("Chỉ đổi tên, nội dung giữ nguyên.") : tt("Không có nội dung để xem (file rỗng hoặc diff quá dài).")}</Note>
                : <>
                  {!one && (
                    <div className="grid grid-cols-2 border-b text-2xs font-sans font-medium">
                      <span className="bg-error-wash px-3 py-1 text-error">{tt("Trước khi sửa")}</span>
                      <span className="border-l bg-ok-wash px-3 py-1 text-ok">{tt("Sau khi sửa")}</span>
                    </div>
                  )}
                  {f.hunks.map((h, i) => (
                    <div key={i} className="[contain-intrinsic-size:auto_15rem] [content-visibility:auto]">
                      <p className="truncate bg-info-wash px-3 py-0.5 text-info/90">
                        ⋯ {tt("dòng {n}", { n: h.lines.find((l) => l.n !== undefined)?.n ?? h.lines[0]?.o ?? "" })}{h.ctx && <span className="text-ink-3"> · {h.ctx}</span>}
                      </p>
                      {one ? h.lines.map((l, j) => <Row key={j} l={l} />) : h.rows.map((r, j) => <SplitRow key={j} l={r.l} r={r.r} />)}
                    </div>
                  ))}
                </>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const Note = ({ children }: { children: string }) => <p className="px-3 py-3 font-sans text-ink-3">{children}</p>;

/** Five blocks for the +/− share, as at-a-glance size. */
function Bar({ add, del }: { add: number; del: number }) {
  const g = Math.round((add / Math.max(1, add + del)) * 5);
  return (
    <span className="hidden gap-px sm:flex" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => <span key={i} className={cn("size-2 rounded-[2px]", i < g ? "bg-ok" : add + del ? "bg-error" : "bg-rule")} />)}
    </span>
  );
}

const TONE = { "+": "bg-ok-wash", "-": "bg-error-wash", " ": "" } as const;
const SIGN = { "+": "text-ok", "-": "text-error", " ": "text-ink-3" } as const;
const NUM = "select-none px-2 text-right text-ink-3 tabular-nums";
const CODE = "whitespace-pre-wrap pr-3 [overflow-wrap:anywhere]";

function Code({ l }: { l: Line }) {
  if (!l.hl) return <>{l.text || " "}</>;
  const [a, b] = l.hl;
  return <>{l.text.slice(0, a)}<span className={cn("rounded-[2px]", l.k === "+" ? "bg-ok/25" : "bg-error/25")}>{l.text.slice(a, b)}</span>{l.text.slice(b)}</>;
}

function Row({ l }: { l: Line }) {
  return (
    <div className={cn("grid grid-cols-[3rem_3rem_1.25rem_minmax(0,1fr)]", TONE[l.k])}>
      <span className={NUM}>{l.o ?? ""}</span><span className={NUM}>{l.n ?? ""}</span>
      <span className={cn("select-none", SIGN[l.k])}>{l.k === " " ? "" : l.k === "-" ? "−" : "+"}</span>
      <span className={cn(CODE, "text-ink-2", l.k !== " " && "text-ink")}><Code l={l} /></span>
    </div>
  );
}

function Half({ l, side }: { l?: Line; side: "o" | "n" }) {
  return (
    <div className={cn("grid grid-cols-[3rem_1.25rem_minmax(0,1fr)]", l ? TONE[l.k] : "bg-paper-2/60", side === "n" && "border-l")}>
      {l && <>
        <span className={NUM}>{l[side]}</span>
        <span className={cn("select-none", SIGN[l.k])}>{l.k === " " ? "" : l.k === "-" ? "−" : "+"}</span>
        <span className={cn(CODE, l.k === " " ? "text-ink-2" : "text-ink")}><Code l={l} /></span>
      </>}
    </div>
  );
}

const SplitRow = ({ l, r }: { l?: Line; r?: Line }) => <div className="grid grid-cols-2"><Half l={l} side="o" /><Half l={r} side="n" /></div>;

/** Commit title + "Tạo nhánh + PR", asked twice before anything is pushed. `mixedOk`: the page shows the "carries
 *  earlier edits" warning, so the second click is the user's yes to it (the backend refuses without). */
function PrBar({ t, count, mixedOk, onDone }: { t: Task; count: number; mixedOk: boolean; onDone: () => void }) {
  const tt = useT();
  const qc = useQueryClient();
  const [title, setTitle] = useState(() => (t.title || t.message_text || t.prompt || "").split("\n")[0].slice(0, 120));
  const [sure, setSure] = useState(false);
  const pr = useMutation({
    mutationFn: () => api<Pr>(`/tasks/${t.id}/pr`, { method: "POST", json: { title: title.trim(), body: tNow("Từ phiên AI Agent {id}.", { id: t.id }), mixed_ok: mixedOk } }),
    onSuccess: (r) => {
      toast({ text: r.url ? tNow("Đã mở PR") : tNow("Đã đẩy nhánh {branch}", { branch: r.branch }) });
      void qc.invalidateQueries({ queryKey: ["task-events", t.id] });
      onDone();
    },
    onError: () => setSure(false),
  });
  if (pr.data) {
    return (
      <footer className="flex shrink-0 items-center gap-2 border-t px-4 py-3 text-sm text-ok">
        <GitPullRequest className="size-4" aria-hidden />
        {pr.data.url ? <a href={pr.data.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">{tt("Mở PR")} <ExternalLink className="size-3.5" aria-hidden /></a>
          : <span className="text-ink-2">{pr.data.note && tMaybe(pr.data.note)}</span>}
      </footer>
    );
  }
  if (!count) return null;
  return (
    <footer className="shrink-0 border-t px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label={tt("Tiêu đề commit và PR")} placeholder={tt("Tiêu đề commit và PR")} value={title} maxLength={200} className="h-8 min-w-48 flex-1 text-sm"
          onChange={(e) => { setTitle(e.target.value); setSure(false); }} />
        {sure && <span className="text-xs text-ink-2 animate-in fade-in-0">{tt("Commit {n} file, đẩy lên remote và mở PR?", { n: count })}</span>}
        {sure && <Button size="sm" variant="ghost" disabled={pr.isPending} onClick={() => setSure(false)}>{tt("Hủy")}</Button>}
        <Button size="sm" variant={sure ? "default" : "outline"} disabled={title.trim().length < 3 || pr.isPending} onClick={() => (sure ? pr.mutate() : setSure(true))}>
          {pr.isPending ? <Loader2 className="animate-spin" /> : <GitPullRequest />} {sure ? tt("Xác nhận tạo PR") : tt("Tạo nhánh + PR")}
        </Button>
      </div>
      {pr.isError && <p role="alert" className="mt-1.5 text-xs text-error">{errorText(pr.error, errs(), tt("Không tạo được PR."))}</p>}
    </footer>
  );
}

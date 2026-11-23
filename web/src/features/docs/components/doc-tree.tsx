"use client";

import { ChevronRight, FileText, Folder } from "lucide-react";
import { type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Fold } from "@/shared/components/ui/fold";
import { YtLogo } from "@/shared/components/yt-logo";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { ytProjectsQuery } from "@/features/youtrack/lib/yt";
import { type Doc, type KbNode, kbTreeQuery } from "@/features/docs/lib/docs";
import { FavStar } from "./fav-star";
import { SourceIcon } from "./results";

// The document list as a tree, as YouTrack's Knowledge Base shows it: each project (by its name) with its articles
// nested by parent in YouTrack's order (`ordinal`), each source folder with its sub-folders, then anything else (the
// Agent's cache under its filter). An article whose parent is not in the library (a chosen branch, a cached one) hangs
// under that parent's chain read from the project's tree (grey, not openable), so branches of one project meet where
// they do on YouTrack; until that tree loads (or if it fails) it sits at the project's top. Groups start open, the
// open document's branch opens by itself; a click on an article opens it, the chevron folds its branch.

type Node = { key: string; label: string; icon?: ReactNode; doc?: Doc; kids: Node[]; order?: number | null; code?: string };

const LAST = Number.MAX_SAFE_INTEGER;
const byOrder = (a: Node, b: Node) => (a.order ?? LAST) - (b.order ?? LAST)
  || Number(!!a.doc && !a.kids.length) - Number(!!b.doc && !b.kids.length) || a.label.localeCompare(b.label);
const RANK: Record<string, number> = { yt: 0, f: 1 }; // projects, then folders, then the rest
const rank = (n: Node) => RANK[n.key.split(":")[0]] ?? 2;
const projectOf = (ref: string) => ref.split("-A-")[0];
/** Articles whose parent is not in `docs`: their projects' trees are read to place them. */
const strays = (docs: Doc[]) => {
  const have = new Set(docs.filter((d) => d.source === "youtrack").map((d) => d.ref));
  return [...new Set(docs.filter((d) => d.source === "youtrack" && d.parent && !have.has(d.parent)).map((d) => projectOf(d.ref)))];
};

function build(docs: Doc[], other: string, names: Map<string, string>, trees: Map<string, KbNode[]>): Node[] {
  const groups = new Map<string, Node>();
  const group = (key: string, label: string, icon: ReactNode, code?: string) => {
    if (!groups.has(key)) groups.set(key, { key, label, icon, kids: [], code });
    return groups.get(key)!;
  };
  const art = new Map<string, Node>();
  for (const d of docs) if (d.source === "youtrack") art.set(d.ref, { key: `d${d.id}`, label: d.title || d.ref, doc: d, kids: [], order: d.ordinal });
  const kb = new Map([...trees.values()].flat().map((n) => [n.id, n]));
  const ghosts = new Map<string, Node>();
  /** The node `ref` hangs under: a stored article, a parent known only from the tree (grey), or the project. */
  const under = (ref: string, parent: string | null | undefined, seen = new Set<string>()): Node => {
    const top = projectOf(ref);
    const root = () => group(`yt:${top}`, names.get(top) ?? top, <YtLogo className="size-4 shrink-0" />, names.has(top) ? top : undefined);
    if (!parent || seen.has(parent)) return root();
    const stored = art.get(parent);
    if (stored) return stored;
    const known = kb.get(parent);
    if (!known) return root();
    let g = ghosts.get(parent);
    if (!g) {
      ghosts.set(parent, (g = { key: `a:${parent}`, label: known.title || parent, kids: [], order: known.ordinal,
        icon: <FileText aria-hidden className="size-4 shrink-0 text-ink-3" /> }));
      under(parent, known.parent, seen.add(parent)).kids.push(g);
    }
    return g;
  };
  for (const d of docs) {
    if (d.source === "youtrack") under(d.ref, d.parent).kids.push(art.get(d.ref)!);
    else if (d.folder && d.rel) {
      let at = group(`f:${d.folder}`, d.folder.split(/[\\/]/).filter(Boolean).at(-1) ?? d.folder, <Folder aria-hidden className="size-4 shrink-0 text-ink-3" />);
      const dirs = d.rel.split(/[\\/]/);
      for (const dir of dirs.slice(0, -1)) {
        let next = at.kids.find((k) => !k.doc && k.label === dir);
        if (!next) at.kids.push((next = { key: `${at.key}/${dir}`, label: dir, icon: <Folder aria-hidden className="size-4 shrink-0 text-ink-3" />, kids: [] }));
        at = next;
      }
      at.kids.push({ key: `d${d.id}`, label: d.title || d.ref, doc: d, kids: [] });
    } else group("other", other, <Folder aria-hidden className="size-4 shrink-0 text-ink-3" />).kids.push({ key: `d${d.id}`, label: d.title || d.ref, doc: d, kids: [] });
  }
  const sort = (n: Node) => { n.kids.sort(byOrder); n.kids.forEach(sort); };
  const out = [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  out.forEach(sort);
  return out;
}

/** The keys of the nodes above the one holding `doc`. */
function pathTo(nodes: Node[], doc: number | null, up: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.doc?.id === doc) return up;
    const got = pathTo(n.kids, doc, [...up, n.key]);
    if (got) return got;
  }
  return null;
}

const ROW = "group/row flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm transition-colors duration-(--dur-micro) hover:bg-paper-2";

export function DocTree({ docs, open, onOpen }: { docs: Doc[]; open: number | null; onOpen: (doc: number) => void }) {
  const t = useT();
  const projects = useQuery(ytProjectsQuery);
  const names = useMemo(() => new Map((projects.data ?? []).map((p) => [p.shortName, p.name])), [projects.data]);
  const wanted = useMemo(() => strays(docs), [docs]);
  // ponytail: one listing per project with strays (Nguồn's query, cached a minute); a failure leaves them at the top
  const combine = useCallback((rs: UseQueryResult<KbNode[]>[]) =>
    new Map(wanted.flatMap((p, i) => { const d = rs[i]?.data; return d ? [[p, d] as const] : []; })), [wanted]);
  const trees = useQueries({ queries: wanted.map((p) => ({ ...kbTreeQuery(p), retry: false })), combine });
  const tree = useMemo(() => build(docs, t("Khác"), names, trees), [docs, t, names, trees]);
  // a branch the user folded / opened keeps that; the others: groups open, the open document's branch open, rest closed
  const [set, setSet] = useState<ReadonlyMap<string, boolean>>(new Map());
  const ancestors = useMemo(() => new Set(pathTo(tree, open) ?? []), [tree, open]);
  const isOpen = (n: Node, top: boolean) => set.get(n.key) ?? (top || ancestors.has(n.key));
  const toggle = (n: Node, top: boolean) => setSet((m) => new Map(m).set(n.key, !isOpen(n, top)));

  const row = (n: Node, depth: number): ReactNode => {
    const top = depth === 0, on = n.doc?.id === open, shown = n.kids.length > 0 && isOpen(n, top);
    const chevron = n.kids.length > 0 && (
      <button type="button" aria-expanded={shown} aria-label={shown ? t("Thu nhánh {t}", { t: n.label }) : t("Mở nhánh {t}", { t: n.label })}
        onClick={() => toggle(n, top)} className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
        <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out)", shown && "rotate-90")} />
      </button>
    );
    return (
      <li key={n.key}>
        <div className={cn(ROW, on && "bg-hl-wash text-ink hover:bg-hl-wash")} style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}>
          {chevron || <span className="size-5 shrink-0" />}
          {n.doc ? <>
            <button type="button" aria-current={on || undefined} onClick={() => onOpen(n.doc!.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <SourceIcon doc={n.doc} /><span className={cn("line-clamp-2 leading-snug break-words", on ? "font-medium text-ink" : "text-ink")}>{n.label}</span>
            </button>
            {/* the star beside the open button, not in it; it shows on the row's hover */}
            <FavStar doc={n.doc} quiet />
          </> : (
            <button type="button" onClick={() => toggle(n, top)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {n.icon}<span className={cn("truncate", top ? "text-xs font-medium tracking-wide text-ink-2" : n.key.startsWith("a:") ? "text-ink-3" : "text-ink-2")}>{n.label}</span>
              {n.code && <span className="shrink-0 font-mono text-2xs text-ink-3">{n.code}</span>}
              <span className="ml-auto shrink-0 text-2xs text-ink-3">{count(n)}</span>
            </button>
          )}
        </div>
        {/* the branch folds open / shut (Fold), never popping in and out */}
        {n.kids.length > 0 && <Fold open={shown}><ul className="grid gap-px">{n.kids.map((k) => row(k, depth + 1))}</ul></Fold>}
      </li>
    );
  };
  return <ul aria-label={t("Cây tài liệu")} className="grid gap-px p-1.5">{tree.map((n) => row(n, 0))}</ul>;
}

const count = (n: Node): number => n.kids.reduce((a, k) => a + (k.doc ? 1 : 0) + count(k), 0);

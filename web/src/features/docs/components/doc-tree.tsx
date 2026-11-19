"use client";

import { ChevronRight, Folder } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Fold } from "@/shared/components/ui/fold";
import { YtLogo } from "@/shared/components/yt-logo";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import type { Doc } from "@/features/docs/lib/docs";
import { FavStar } from "./fav-star";
import { SourceIcon } from "./results";

// The document list as a tree: each Knowledge Base project with its articles nested by parent, each source folder with
// its sub-folders, then anything else (the Agent's cache under its filter). Groups start open, the open document's
// branch opens by itself; a click on an article opens it, the chevron folds its branch.

type Node = { key: string; label: string; icon?: ReactNode; doc?: Doc; kids: Node[] };

const byLabel = (a: Node, b: Node) => Number(!!a.doc && !a.kids.length) - Number(!!b.doc && !b.kids.length) || a.label.localeCompare(b.label);

function build(docs: Doc[], other: string): Node[] {
  const groups = new Map<string, Node>();
  const group = (key: string, label: string, icon: ReactNode) => {
    if (!groups.has(key)) groups.set(key, { key, label, icon, kids: [] });
    return groups.get(key)!;
  };
  const art = new Map<string, Node>();
  for (const d of docs) if (d.source === "youtrack") art.set(d.ref, { key: `d${d.id}`, label: d.title || d.ref, doc: d, kids: [] });
  for (const d of docs) {
    if (d.source === "youtrack") {
      const me = art.get(d.ref)!, up = d.parent ? art.get(d.parent) : undefined; // a parent not stored: a root here
      (up ?? group(`yt:${d.ref.split("-A-")[0]}`, d.ref.split("-A-")[0], <YtLogo className="size-4 shrink-0" />)).kids.push(me);
    } else if (d.folder && d.rel) {
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
  const sort = (n: Node) => { n.kids.sort(byLabel); n.kids.forEach(sort); };
  const out = [...groups.values()];
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
  const tree = useMemo(() => build(docs, t("Khác")), [docs, t]);
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
              {n.icon}<span className={cn("truncate", top ? "text-xs font-medium tracking-wide text-ink-2" : "text-ink-2")}>{n.label}</span>
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

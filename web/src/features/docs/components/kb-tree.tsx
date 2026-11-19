"use client";

import { ChevronRight, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Fold } from "@/shared/components/ui/fold";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { cn, fold } from "@/shared/lib/utils";
import { docErrors, kbTreeQuery, type KbNode } from "@/features/docs/lib/docs";

// One Knowledge Base project's article tree in Nguồn: tick an article to read it and every article under it (a branch).
// Articles under a ticked one show ticked and locked; ticking an article drops the ticked ones under it (now implied).

type Tree = { byId: Map<string, KbNode>; kids: Map<string | null, KbNode[]> };

function build(nodes: KbNode[]): Tree {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string | null, KbNode[]>();
  for (const n of nodes) {
    const p = n.parent && byId.has(n.parent) ? n.parent : null; // a parent outside the listing: a root here
    kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  return { byId, kids };
}

const under = (t: Tree, id: string): string[] => (t.kids.get(id) ?? []).flatMap((k) => [k.id, ...under(t, k.id)]);
const above = (t: Tree, id: string): string[] => {
  const out: string[] = [];
  for (let p = t.byId.get(id)?.parent; p && t.byId.has(p) && !out.includes(p); p = t.byId.get(p)?.parent) out.push(p);
  return out;
};

export function KbTree({ project, chosen, onChange, disabled }: {
  project: string; chosen: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const t = useT();
  const q = useQuery(kbTreeQuery(project));
  const tree = useMemo(() => build(q.data ?? []), [q.data]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");

  if (q.isError) return <p role="alert" className="py-1 text-xs text-error">{errorText(q.error, docErrors())}</p>;
  if (!q.data) return <div className="grid gap-1.5 py-1">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-2/3" />)}</div>;
  if (!q.data.length) return <p className="py-1 text-xs text-ink-3">{t("Project này chưa có bài Knowledge Base.")}</p>;

  const mine = chosen.filter((id) => id.startsWith(`${project}-A-`));
  const implied = (id: string) => above(tree, id).some((a) => mine.includes(a));
  const tick = (id: string, on: boolean) => {
    const drop = new Set(under(tree, id));
    onChange(on ? [...chosen.filter((x) => !drop.has(x)), id] : chosen.filter((x) => x !== id));
  };
  const row = (n: KbNode, depth: number, path?: string) => {
    const kids = tree.kids.get(n.id) ?? [];
    const locked = implied(n.id);
    return (
      <li key={n.id}>
        <div className="flex min-w-0 items-center gap-1.5 py-0.5" style={{ paddingLeft: `${depth * 1.25}rem` }}>
          {kids.length > 0 && !path ? (
            <button type="button" aria-expanded={open.has(n.id)} aria-label={open.has(n.id) ? t("Thu nhánh {t}", { t: n.title }) : t("Mở nhánh {t}", { t: n.title })}
              onClick={() => setOpen((s) => { const x = new Set(s); if (!x.delete(n.id)) x.add(n.id); return x; })}
              className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink">
              <ChevronRight className={cn("size-3.5 transition-transform duration-(--dur-short) ease-(--ease-out)", open.has(n.id) && "rotate-90")} />
            </button>
          ) : <span className="size-4 shrink-0" />}
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <Checkbox checked={locked || mine.includes(n.id)} disabled={disabled || locked} onCheckedChange={(v) => tick(n.id, !!v)} />
            <span className="grid min-w-0">
              <span className="truncate text-sm text-ink">{n.title || n.id}</span>
              {path && <span className="truncate text-2xs text-ink-3">{path}</span>}
            </span>
            {kids.length > 0 && <span className="shrink-0 text-2xs text-ink-3">{t("{n} bài con", { n: under(tree, n.id).length })}</span>}
          </label>
        </div>
        {/* folds open / shut (Fold), never popping in and out */}
        {!path && kids.length > 0 && <Fold open={open.has(n.id)}><ul>{kids.map((k) => row(k, depth + 1))}</ul></Fold>}
      </li>
    );
  };

  const f = fold(filter.trim());
  const found = f ? (q.data ?? []).filter((n) => fold(n.title).includes(f) || n.id.toLowerCase().includes(f)).slice(0, 50) : [];
  return (
    <div className="grid gap-1.5">
      <label className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" />
        <Input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Lọc bài theo tên…")}
          aria-label={t("Lọc bài Knowledge Base của {p}", { p: project })} className="h-7 pl-7 text-xs" />
      </label>
      {/* py-2 / pl-3: room for the checkboxes' wider hit area, or it alone makes the list scroll */}
      <ul className="max-h-72 overflow-y-auto py-2 pr-1 pl-3">
        {f ? (found.length ? found.map((n) => row(n, 0, above(tree, n.id).reverse().map((a) => tree.byId.get(a)?.title).join(" › ") || project))
          : <li className="py-1 text-xs text-ink-3">{t("Không có bài nào khớp.")}</li>)
          : (tree.kids.get(null) ?? []).map((n) => row(n, 0))}
      </ul>
    </div>
  );
}

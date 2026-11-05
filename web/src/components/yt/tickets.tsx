"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bookmark, ChevronDown, Columns3, Copy, Download, Link2, Rows3, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { toast, useNow } from "@/lib/inbox";
import { getPref, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import {
  activePool, ago, bucket, type ColKey, COLS, copyText, counts, DAY, exportCsv, type Filters, fmt, groupRows, issueUrl, lastSp, norm, PCOL, rank,
  shortSp, snippet, stateColor, stateSem, tagsOf, ticketId, titleOf, TINT, type Ticket, typeColor, visibleRows, yt,
} from "@/lib/yt";
import { period } from "@/lib/yt-stats";
import { Avatar, MultiSelect, Person, Popover, Prio, StatePill, Tag, TypeTag } from "./bits";
import { type AssigneeActs, AssigneePicker } from "./sheet";
import { CAP_STEP, saveTicket, useYt, type Yt } from "./state";
import { useFlow } from "./workflow";

// The ticket ledger: one toolbar (search + AI filter, Priority / Type / State menus, views, display), then the table or board.

export function TicketsPage() {
  const y = useYt();
  const f = y.filters;
  const q = useDeferredValue(f.q);
  const fq = useMemo(() => ({ ...f, q }), [f, q]);
  const opts = { showRes: y.showRes, me: y.me };
  const pool = useMemo(() => activePool(y.rows, fq, opts), [y.rows, fq, y.showRes, y.me]); // eslint-disable-line react-hooks/exhaustive-deps
  const priPool = useMemo(() => activePool(y.rows, fq, opts, "priority"), [y.rows, fq, y.showRes, y.me]); // eslint-disable-line react-hooks/exhaustive-deps
  const typePool = useMemo(() => activePool(y.rows, fq, opts, "type"), [y.rows, fq, y.showRes, y.me]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownAll = useMemo(() => visibleRows(pool, fq), [pool, fq]);
  const groups = useMemo(() => (f.group === "none" ? null : groupRows(shownAll, f.group, y.sprints)), [shownAll, f.group, y.sprints]);
  const cols = useMemo(() => COLS.map(([k]) => k).filter((k) => !y.hiddenCols.includes(k)), [y.hiddenCols]);
  const tcols = useMemo(() => cols.filter((k) => k !== "id" && k !== "type"), [cols]); // ID and Type sit under the title
  const now = useNow();
  const searchRef = useRef<HTMLInputElement>(null);
  const aiBusy = useAiFilterBusy();
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  // the first `cap` rows in display order (groups first, so more rows append at the end); folded groups keep only their header
  let left = y.cap;
  const parts: [string, Ticket[], Ticket[]][] = [];
  for (const [g, items] of groups ?? [["", shownAll] as [string, Ticket[]]]) {
    if (left <= 0) break;
    const part = folded.has(g) ? [] : items.slice(0, left);
    left -= part.length;
    parts.push([g, items, part]);
  }
  const shown = parts.flatMap((p) => p[2]);
  const more = parts.length < (groups?.length ?? 1) || parts.some(([g, items, part]) => !folded.has(g) && part.length < items.length);

  // stable props for the memoized rows: a keystroke or a tick re-renders only the rows that changed
  const { setPicked, setSheet, people, loginOf, patchTicket, config, me, setCap } = y;
  const togglePick = useCallback((id: string) => setPicked((p) => { const next = new Set(p); if (!next.delete(id)) next.add(id); return next; }), [setPicked]);
  const open = useCallback((i: Ticket) => setSheet({ kind: "ticket", id: i.id, nav: shownAll.map((x) => x.id) }), [setSheet, shownAll]);
  const acts: AssigneeActs = useMemo(() => ({ people, loginOf, patchTicket, config, me }), [people, loginOf, patchTicket, config, me]);
  const row = (i: Ticket) => (
    <Row key={i.id} i={i} cols={tcols} showType={cols.includes("type")} now={now} onOpen={open} onPick={togglePick} acts={acts} picked={y.picked.has(i.id)} dense={y.dense}
      tint={y.hiOn && TINT[rank(i)] && !i.resolved ? TINT[rank(i)] : 0} fresh={y.seen > 0 && i.updated > y.seen} />
  );

  // a ticket filtered out is no longer ticked
  useEffect(() => {
    const ids = new Set(shownAll.map((i) => i.id));
    if ([...y.picked].some((id) => !ids.has(id))) y.setPicked(new Set([...y.picked].filter((id) => ids.has(id))));
  }, [shownAll]); // eslint-disable-line react-hooks/exhaustive-deps

  // the next rows render once the end of the table scrolls into view (a new observer per step: it fires again if the end is still visible)
  useEffect(() => {
    const el = endRef.current;
    if (!el || !more) return;
    const box = el.parentElement!; // the table's own scroll area from md up; below md the page scrolls
    const root = getComputedStyle(box).overflowY === "auto" ? box : null;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setCap((c) => c + CAP_STEP); }, { root, rootMargin: "0px 0px 400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [y.cap, more, setCap]);

  // keys: / search, j / k rows, x tick, Esc clears the search, then the ticked rows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (y.sheet) return;
      const el = e.target as HTMLElement;
      if (e.key === "Escape" && el === searchRef.current && f.q) { y.setFilters({ q: "" }); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input,textarea,select,[contenteditable],[role=dialog]")) return;
      if (e.key === "Escape" && y.picked.size) y.setPicked(new Set());
      else if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const rows = [...(tableRef.current?.querySelectorAll<HTMLElement>("tr[data-id]") ?? [])];
        if (!rows.length) return;
        const k = rows.indexOf(document.activeElement?.closest("tr[data-id]") as HTMLElement);
        const r = rows[k < 0 ? (e.key === "j" ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, k + (e.key === "j" ? 1 : -1)))];
        r.focus();
        r.scrollIntoView({ block: "nearest" });
      } else if (e.key === "x") {
        const id = (document.activeElement?.closest("tr[data-id]") as HTMLElement | null)?.dataset.id;
        if (id) togglePick(id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const fold = (g: string) => setFolded((s) => { const n = new Set(s); if (!n.delete(g)) n.add(g); return n; });
  const anyFilter = !!(f.sprint.length || f.assignee.length || f.tier != null || f.quick || f.state.length || f.priority.length || f.type.length || f.q);
  const facet = (key: "state" | "priority" | "type", from: Ticket[], color: (v: string) => string) => {
    const items = counts(from, key, f[key]), n = new Map(items);
    return (
      <MultiSelect label={key === "state" ? "State" : key === "priority" ? "Priority" : "Type"} all={key === "state" ? "State" : key === "priority" ? "Priority" : "Type"}
        options={items.map(([v]) => v)} value={f[key]} onChange={(v) => y.setFilters({ [key]: v })} count={(v) => n.get(v)} swatch={color} search={items.length > 10}
        className={cn("w-auto", f[key].length > 0 && "border-hl text-hl-2")} />
    );
  };

  return (
    <section aria-label="Ticket" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input ref={searchRef} type="search" value={f.q} onChange={(e) => y.setFilters({ q: e.target.value })} aria-label="Tìm ticket" autoComplete="off" maxLength={500}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && y.aiOn) { e.preventDefault(); void aiFilterApply(y, f.q); } }}
            placeholder={y.aiOn ? "Tìm ID, tiêu đề, người… hoặc gõ một câu cho AI lọc  ( / )" : "Tìm ID, tiêu đề, người…  ( / )"}
            className={cn("h-8 w-full rounded-md border border-rule bg-cotton pl-8 text-sm outline-none focus:border-hl", y.aiOn ? "pr-20" : "pr-2")} />
          {y.aiOn && (
            <Hint text="AI đổi câu này thành bộ lọc State / Priority / Type / Người / Sprint (⌘↵)" side="bottom">
              <button type="button" disabled={!f.q.trim() || aiBusy} onClick={() => void aiFilterApply(y, f.q)}
                className="absolute top-1/2 right-1 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-[var(--radius-input)] px-2 text-xs font-medium text-hl-2 hover:bg-hl-wash disabled:opacity-40">
                <Sparkles className={cn("size-3.5", aiBusy && "animate-pulse")} />AI lọc
              </button>
            </Hint>
          )}
        </label>
        <div role="group" aria-label="Bộ lọc" className="flex flex-wrap items-center gap-1.5">
          {facet("priority", priPool, (v) => PCOL[v] || "var(--color-ink-3)")}
          {facet("type", typePool, typeColor)}
          {facet("state", pool, stateColor)}
        </div>
        <span aria-live="polite" className="px-1 font-mono text-xs whitespace-nowrap text-ink-3 tabular-nums">{fmt(shownAll.length)} ticket</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Views />
          <Segmented id="yt-tickets-view" label="Kiểu xem" value={y.view} onChange={y.setView} items={[
            { value: "table", label: <span className="inline-flex items-center gap-1"><Rows3 className="size-3.5" />Bảng</span> },
            { value: "board", label: <span className="inline-flex items-center gap-1"><Columns3 className="size-3.5" />Board</span> },
          ]} />
          <Display onGroup={() => setFolded(new Set())} />
          <Hint text="Xuất danh sách đang lọc (các cột đang hiện) ra CSV" side="bottom">
            <Button size="icon-sm" variant="outline" onClick={() => exportCsv(shownAll, y.project, cols)} aria-label="Xuất CSV"><Download /></Button>
          </Hint>
        </div>
      </div>

      <AnimatePresence>{y.picked.size > 0 && <BulkBar key="bulk" />}</AnimatePresence>

      {y.view === "board" && shownAll.length > 0 ? <Board rows={shownAll} onOpen={open} /> : parts.some((p) => p[1].length) ? (
        // its own scroll area (both ways) from md up: wide tables keep their right-hand columns and the sticky headers still work
        <div className="overflow-x-auto rounded-lg bg-cotton shadow-stock md:max-h-[calc(100dvh-var(--yt-top)-1rem)] md:overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="z-10 bg-cotton text-left text-xs text-ink-3 shadow-[inset_0_-1px_0_var(--color-rule)] md:sticky md:top-0">
              <tr>
                <th className="w-9 py-2 pr-1 pl-3.5"><input type="checkbox" aria-label="Chọn tất cả ticket đang hiện" checked={shown.every((i) => y.picked.has(i.id))}
                  onChange={(e) => y.setPicked(e.target.checked ? new Set([...y.picked, ...shown.map((i) => i.id)]) : new Set([...y.picked].filter((id) => !shown.some((i) => i.id === id))))} /></th>
                {tcols.map((k) => {
                  const sk: ColKey = k === "summary" ? "id" : k; // the title column sorts by ticket number
                  const on = f.sort.k === sk;
                  return (
                    <th key={k} aria-sort={on ? (f.sort.d === "asc" ? "ascending" : "descending") : undefined} className="px-3 py-2 font-medium whitespace-nowrap">
                      <button type="button" className={cn("inline-flex items-center gap-1 hover:text-ink", on && "text-ink")}
                        onClick={() => y.setFilters({ sort: on ? { k: sk, d: f.sort.d === "asc" ? "desc" : "asc" } : { k: sk, d: "asc" } })}>
                        {k === "summary" ? "Ticket" : COLS.find(([c]) => c === k)![1]}{on && <span aria-hidden>{f.sort.d === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {!groups
                ? shown.map(row)
                : parts.map(([g, items, part]) => (
                  <Fragment key={g}>
                    <tr className="z-[5] bg-paper-2 md:sticky md:top-[33px]">
                      <td colSpan={tcols.length + 1} className="px-3.5 py-1.5">
                        <button type="button" aria-expanded={!folded.has(g)} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-ink" onClick={() => fold(g)}>
                          <ChevronDown className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-in-out)", folded.has(g) && "-rotate-90")} />
                          {f.group === "assignee" && g !== "Chưa assign" ? <Person name={g} /> : g}
                          <b className="font-mono text-xs font-medium text-ink-3">{items.length}</b>
                        </button>
                      </td>
                    </tr>
                    {part.map(row)}
                  </Fragment>
                ))}
            </tbody>
          </table>
          {more && <div ref={endRef} role="status" className="px-3 py-3 text-center text-xs text-ink-3">Đang hiện {fmt(shown.length)} / {fmt(shownAll.length)}…</div>}
        </div>
      ) : y.issues.isPending ? <TableSkeleton /> : (
        <Empty anyFilter={anyFilter} />
      )}
      {y.view === "table" && <HoverPreview body={tableRef} />}
    </section>
  );
}

/** Display options: density, resolved tickets, priority tint, grouping, columns. */
function Display({ onGroup }: { onGroup: () => void }) {
  const y = useYt();
  return (
    <Popover label={<span className="inline-flex items-center gap-1"><SlidersHorizontal className="size-3.5" />Hiển thị</span>} align="right">
      {() => (
        <div className="grid p-1 text-sm">
          {([["Gọn: hàng thấp, tiêu đề 1 dòng", y.dense, y.setDense], ["Hiện ticket đã resolved", y.showRes, y.setShowRes], ["Tô nền ticket High trở lên", y.hiOn, y.setHiOn]] as const).map(([l, on, set]) => (
            <label key={l} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-paper-2"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{l}</label>
          ))}
          {y.view === "table" && <>
            <div className="mx-2 my-1 border-t border-rule" />
            <span className="px-2 pt-1 pb-1.5 text-xs font-medium text-ink-3">Gom nhóm</span>
            <Segmented id="yt-tickets-group" label="Gom nhóm" className="mx-2 mb-1" value={y.filters.group} onChange={(group) => { onGroup(); y.setFilters({ group }); }} items={[
              { value: "none", label: "Không" }, { value: "assignee", label: "Người" }, { value: "sprint", label: "Sprint" }, { value: "module", label: "Module" },
            ]} />
            <div className="mx-2 my-1 border-t border-rule" />
            <span className="px-2 pt-1 pb-0.5 text-xs font-medium text-ink-3">Cột</span>
            {COLS.filter(([k]) => k !== "id" && k !== "summary").map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-paper-2">
                <input type="checkbox" checked={!y.hiddenCols.includes(k)} onChange={(e) => y.setHiddenCols(e.target.checked ? y.hiddenCols.filter((c) => c !== k) : [...y.hiddenCols, k])} />{l}
              </label>
            ))}
          </>}
        </div>
      )}
    </Popover>
  );
}

const Row = memo(function Row({ i, cols, showType, now, onOpen, onPick, acts, picked, dense, tint, fresh }: {
  i: Ticket; cols: ColKey[]; showType: boolean; now: number; onOpen: (i: Ticket) => void; onPick: (id: string) => void; acts: AssigneeActs; picked: boolean; dense: boolean; tint: number; fresh: boolean;
}) {
  const base = acts.config?.base ?? "";
  const pad = dense ? "py-1.5" : "py-2.5";
  const tags = tagsOf(i);
  const id = (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <a href={issueUrl(base, i.id)} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium text-ink-3 no-underline hover:text-hl-2" onClick={(e) => e.stopPropagation()}>{i.id}</a>
      {fresh && <span aria-label="Cập nhật sau lần bạn xem trước" className="rounded-full bg-hl px-1.5 text-xs leading-4 font-semibold text-hl-ink">mới</span>}
      <span className="flex opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
        <button type="button" aria-label={`Copy ID ${i.id}`} className="rounded p-0.5 text-ink-3 hover:text-ink" onClick={(e) => { e.stopPropagation(); void copyText(i.id, `Đã copy ${i.id}`); }}><Copy className="size-3" /></button>
        <button type="button" aria-label={`Copy link ${i.id}`} className="rounded p-0.5 text-ink-3 hover:text-ink" onClick={(e) => { e.stopPropagation(); void copyText(issueUrl(base, i.id), `Đã copy link ${i.id}`); }}><Link2 className="size-3" /></button>
      </span>
    </span>
  );
  const title = <span className={cn("min-w-0 font-medium text-ink", dense ? "truncate" : "line-clamp-2", i.resolved && "font-normal text-ink-3 line-through")}>{titleOf(i)}</span>;
  const cell: Partial<Record<ColKey, React.ReactNode>> = {
    summary: dense ? <span className="flex min-w-0 items-center gap-2">{id}{title}</span> : (
      <span className="grid min-w-0 gap-1">
        {title}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{id}{showType && i.type && <TypeTag type={i.type} />}{tags.map((t) => <Tag key={t} name={t} />)}</span>
      </span>
    ),
    state: <StatePill state={i.state} />,
    priority: <Prio p={i.priority} />,
    assignee: <AssigneePicker ticket={i} acts={acts} className="w-40" />,
    qc: <Person name={i.qc} />,
    sprint: i.sprints.length ? <span className="font-mono text-xs whitespace-nowrap text-ink-2">{shortSp(lastSp(i))}{i.sprints.length > 1 && <small className="ml-1 text-ink-3">+{i.sprints.length - 1}</small>}</span> : <span className="text-ink-3">—</span>,
    due: i.due ? (
      <span className={cn("inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap", i.due < now ? "font-semibold text-error" : i.due - now < 2 * DAY ? "text-warn" : "text-ink-2")}>
        {i.due < now && <AlertTriangle className="size-3" />}{new Date(i.due).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
      </span>
    ) : <span className="text-ink-3">—</span>,
    updated: <span className="text-xs whitespace-nowrap text-ink-3">{ago(i.updated)}</span>,
  };
  return (
    <tr data-id={i.id} tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,select,input")) onOpen(i); }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(i); }}
      style={tint ? { background: `color-mix(in oklch, ${PCOL[i.priority!]} ${tint}%, transparent)` } : undefined}
      className={cn("group/row cursor-pointer border-t border-rule/60 align-middle transition-colors duration-(--dur-micro) first:border-0 hover:bg-paper-2 focus-visible:bg-hl-wash focus-visible:outline-none", picked && "bg-hl-wash/60", i.resolved && "text-ink-3")}>
      <td className={cn("pr-1 pl-3.5", pad)} style={{ boxShadow: `inset 3px 0 0 ${stateColor(i.state)}` }} onClick={(e) => { e.stopPropagation(); onPick(i.id); }}>
        <input type="checkbox" checked={picked} onChange={() => onPick(i.id)} onClick={(e) => e.stopPropagation()} aria-label={`Chọn ${i.id}`} />
      </td>
      {cols.map((k) => <td key={k} className={cn("px-3", pad, k === "summary" ? "w-full max-w-0 min-w-80" : "whitespace-nowrap")}>{cell[k]}</td>)}
    </tr>
  );
});

function BulkBar() {
  const y = useYt();
  const [as, setAs] = useState("-");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const ids = [...y.picked];
  const asLabel = as === "-" ? "Assignee: giữ nguyên" : as === "" ? "Chưa assign" : y.people.find((p) => p.login === as)?.name ?? as;
  async function apply() {
    if (as === "-") { toast({ text: "Chọn assignee cần đổi" }); return; }
    setBusy(true);
    const done: [string, string | null][] = [], fail: string[] = [];
    for (const id of ids) {
      const t = y.rows.find((i) => i.id === id);
      const prev = t?.assigneeLogin ?? null;
      if (prev === (as || null)) continue;
      try { y.patchTicket(await yt.setAssignee(id, as || null)); done.push([id, prev]); } catch (e) { fail.push(`${id}: ${(e as Error).message}`); }
    }
    setBusy(false);
    const label = y.people.find((p) => p.login === as)?.name ?? "Chưa assign";
    if (fail.length) toast({ text: `Lỗi ${fail.length} ticket — ${fail[0]}` });
    else if (done.length) {
      toast({ text: `${done.length === 1 ? done[0][0] : `${done.length} ticket`} → ${label}`, undo: async () => { for (const [id, prev] of done) y.patchTicket(await yt.setAssignee(id, prev)); } });
      y.setPicked(new Set());
      setAs("-");
    } else toast({ text: "Không có gì thay đổi" });
  }
  return (
    <motion.div role="region" aria-label="Thao tác hàng loạt" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      className="flex flex-wrap items-center gap-2 rounded-lg bg-board px-3 py-2 text-sm text-board-type">
      <b className="font-semibold">{ids.length} ticket đã chọn</b>
      <Popover label={asLabel} title="Đổi assignee cho các ticket đã chọn" className="border-0 bg-board-type/15 text-board-type hover:bg-board-type/25 hover:text-board-type">
        {(close) => {
          const pick = (v: string) => { setAs(v); setQ(""); close(); };
          return (
            <>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm người…" aria-label="Tìm người"
                className="m-2 mb-1 h-8 rounded-md border border-rule bg-paper px-2 text-sm text-ink outline-none focus:border-hl" />
              <div className="grid overflow-y-auto p-1 text-ink">
                {!q && <button type="button" onClick={() => pick("")} className="rounded px-2 py-1.5 text-left text-sm text-ink-3 hover:bg-paper-2 hover:text-ink">Chưa assign</button>}
                {y.people.filter((p) => !q || norm(p.name).includes(norm(q)) || norm(p.login).includes(norm(q))).map((p) => (
                  <button key={p.login} type="button" onClick={() => pick(p.login)} aria-current={as === p.login}
                    className={cn("flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-paper-2", as === p.login && "bg-paper-2 font-medium")}>
                    <Avatar name={p.name} /><span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            </>
          );
        }}
      </Popover>
      <Button size="sm" variant="outline" disabled={busy} aria-busy={busy} onClick={() => void apply()}>Áp dụng</Button>
      {y.aiOn && (
        <Button size="sm" variant="outline" title="Hỏi AI về các ticket đã chọn, có thể trace code trong thư mục dự án"
          onClick={() => y.setSheet({ kind: "work", title: "AI · ticket đã chọn", ids })}><Sparkles /> AI</Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto text-board-type hover:bg-board-type/15 hover:text-board-type" onClick={() => y.setPicked(new Set())}>Bỏ chọn</Button>
    </motion.div>
  );
}

/** A sentence becomes the regular filters (state / priority / type / người / sprint / search): the ✨ in the search box and ⌘K. */
let filterBusy = false;
const busyListeners = new Set<() => void>();
const setFilterBusy = (b: boolean) => { filterBusy = b; busyListeners.forEach((f) => f()); };
function useAiFilterBusy() {
  return useSyncExternalStore((f) => { busyListeners.add(f); return () => busyListeners.delete(f); }, () => filterBusy, () => false);
}
export async function aiFilterApply(y: Yt, text: string) {
  const t = text.trim();
  if (!t || filterBusy) return;
  const uniq = (k: "state" | "priority" | "type") => [...new Set(y.rows.map((i) => i[k]).filter((v): v is string => !!v))];
  const options = { state: uniq("state"), priority: uniq("priority"), type: uniq("type"), assignee: y.peopleOptions, sprint: y.sprintOptions.slice(0, 40),
    me: y.me, current_sprint: [...period({ sprints: y.sprints, f: { ...y.filters, sprint: [] }, latestSprint: y.sprintOptions[0] ?? null, now: Date.now() }).set][0] ?? null };
  setFilterBusy(true);
  try {
    const r = await yt.aiFilter(t, options);
    const pick = (k: keyof typeof options) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((v): v is string => typeof v === "string" && (options[k] as string[]).includes(v)) : []);
    y.setFilters({ state: pick("state"), priority: pick("priority"), type: pick("type"), assignee: pick("assignee"), sprint: pick("sprint"), q: typeof r.q === "string" ? r.q.slice(0, 100) : "", tier: null, quick: null });
    toast({ text: "AI đã đặt bộ lọc, xem các chip bên dưới" });
  } catch (e) { toast({ text: `AI lọc lỗi: ${(e as Error).message}` }); }
  finally { setFilterBusy(false); }
}

/** A named set of filters + table / board, per browser; also listed in ⌘K. */
export type SavedView = { name: string; f: Omit<Filters, "assignee"> & { assignee: string[] }; view: "table" | "board" };
export const readViews = (): SavedView[] => { try { const v = JSON.parse(getPref("ytViews") ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export function applyView(y: Yt, v: SavedView) {
  y.setFilters(v.f);
  y.setView(v.view);
  y.setPage("tickets");
  toast({ text: `View “${v.name}”` });
}

/** Built-in views per role: one click sets the whole filter + table / board + grouping for a job the role does every day. */
type RoleView = [label: string, hint: string, f: Partial<Filters>, view?: "table" | "board"];
function roleViews(y: Yt): RoleView[] {
  const me = y.me ? [y.me] : [];
  const sprint = [...period({ sprints: y.sprints, f: { ...y.filters, sprint: [] }, latestSprint: y.sprintOptions[0] ?? null, now: Date.now() }).set];
  return {
    dev: [
      ["Board của tôi", "Ticket của bạn theo cột State, kéo thẻ để chuyển trạng thái", { assignee: me }, "board"],
      ["Sprint này", "Ticket của bạn trong sprint đang chạy", { assignee: me, sprint }],
      ["Chờ QC", "Ticket bạn đã làm xong, đang chờ test / release", { assignee: me, tier: 2 }],
      ["Bug của tôi", "Bug đang mở được assign cho bạn", { assignee: me, quick: "bugopen" }],
      ["Quá hạn", "Ticket của bạn đã quá hạn", { assignee: me, quick: "overdue" }],
    ] as RoleView[],
    qa: [
      ["Board chờ test", "Ticket chờ test của cả team theo cột State, kéo sang Done / Reopen", { tier: 2 }, "board"],
      ["Chưa có QC", "Ticket chờ test chưa ai nhận", { quick: "noqc", group: "assignee" }],
      ["Bug đang mở", "Bug chưa xong, Critical trước, gom theo module", { quick: "bugopen", group: "module" }],
      ["Bug mới 7 ngày", "Bug được tạo trong 7 ngày qua", { quick: "bugnew", group: "none", sort: { k: "updated", d: "asc" } }],
      ["Regression", "Ticket đã build / chờ release, gom theo module để lên checklist", { quick: "built", group: "module" }],
    ] as RoleView[],
    po: [
      ["Backlog", "Ticket mở chưa vào sprint, gom theo module, priority cao trước", { quick: "nosprint", group: "module" }],
      ["Chờ PO chốt", "Ticket đang chờ định nghĩa / xác nhận design", { quick: "waitpo", group: "none" }],
      ["Sprint theo người", "Sprint đang chạy, gom theo người để xem phân việc", { sprint, group: "assignee" }],
      ["Board sprint", "Sprint đang chạy theo cột State", { sprint }, "board"],
      ["Chưa assign", "Ticket mở chưa có người làm", { quick: "unassigned", group: "sprint" }],
    ] as RoleView[],
  }[y.mode];
}

/** "Góc nhìn": the role's built-in views, then the saved ones (a name for the current filters + table / board). */
function Views() {
  const y = useYt();
  const [list, setList] = useState(readViews);
  const [name, setName] = useState("");
  const save = (l: SavedView[]) => { setList(l); setPref("ytViews", JSON.stringify(l)); };
  function add() {
    const n = name.trim();
    if (!n) return;
    save([...list.filter((v) => v.name !== n), { name: n, f: y.filters, view: y.view }]);
    setName("");
    toast({ text: `Đã lưu view “${n}”` });
  }
  function apply([label, , f, view = "table"]: RoleView) {
    y.setFilters({ sprint: [], assignee: [], state: [], priority: [], type: [], q: "", tier: null, quick: null, group: "sprint", sort: { k: "priority", d: "asc" }, ...f });
    y.setView(view);
    toast({ text: `Góc nhìn “${label}”` });
  }
  const head = "px-2 pt-1.5 pb-0.5 text-xs font-medium text-ink-3";
  return (
    <Popover label={<span className="inline-flex items-center gap-1"><Bookmark className="size-3.5" />Góc nhìn{list.length ? <b className="font-mono font-medium text-ink-3">{list.length}</b> : null}</span>} align="right">
      {(close) => (
        <div className="grid gap-0.5 p-1">
          <span className={head}>Gợi ý cho {({ dev: "Dev", qa: "QA/QC", po: "PO/PM" } as const)[y.mode]}</span>
          {roleViews(y).map((v) => (
            <button key={v[0]} type="button" onClick={() => { close(); apply(v); }} disabled={y.mode === "dev" && !y.me}
              className="grid gap-0.5 rounded px-2 py-1.5 text-left hover:bg-paper-2 disabled:pointer-events-none disabled:opacity-50">
              <span className="text-sm">{v[0]}</span><span className="text-xs text-ink-3">{v[1]}</span>
            </button>
          ))}
          <div className="mx-2 my-1 border-t border-rule" />
          <span className={head}>Đã lưu</span>
          {list.map((v) => (
            <div key={v.name} className="flex items-center gap-1 rounded hover:bg-paper-2">
              <button type="button" onClick={() => { close(); applyView(y, v); }} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm">{v.name}</button>
              <button type="button" aria-label={`Xóa view ${v.name}`} onClick={() => save(list.filter((x) => x !== v))} className="rounded p-1 text-ink-3 hover:text-error"><X className="size-3.5" /></button>
            </div>
          ))}
          {!list.length && <p className="px-2 py-1 text-xs text-ink-3">Chưa có. Đặt bộ lọc, chọn Bảng / Board, rồi lưu lại ở đây.</p>}
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-1 pt-1">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Tên view, vd. Bug sprint này" aria-label="Tên view"
              className="h-8 min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 text-sm outline-none focus:border-hl" />
            <Button type="submit" size="sm" disabled={!name.trim()}>Lưu</Button>
          </form>
        </div>
      )}
    </Popover>
  );
}

/** Columns by State (workflow order), cards dragged onto a column change the ticket's State in YouTrack. */
function Board({ rows, onOpen }: { rows: Ticket[]; onOpen: (i: Ticket) => void }) {
  const y = useYt();
  const now = useNow();
  const [over, setOver] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const PER = 60;
  const [showDone, setShowDone] = useState(false); // done columns hold thousands of tickets: folded into one button
  const doneN = useMemo(() => rows.filter((i) => i.resolved).length, [rows]);
  const cols = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const i of rows) {
      if (i.resolved && !showDone) continue; const k = i.state || "—"; (m.get(k) ?? m.set(k, []).get(k)!).push(i); }
    return [...m].sort((a, b) => bucket(a[1][0]) - bucket(b[1][0]) || +(stateSem(a[0]) === "bad") - +(stateSem(b[0]) === "bad") || b[1].length - a[1].length);
  }, [rows, showDone]);
  const write = !y.config?.mock;
  const flow = useFlow(y.project);
  const canGo = (t: Ticket, to: string) => { const f = flow(t.state); return !f || f.includes(to); };
  const moving = drag ? rows.find((i) => i.id === drag) : undefined;
  async function drop(state: string) {
    setOver(null);
    const t = rows.find((i) => i.id === drag);
    setDrag(null);
    if (!t || !write || state === "—" || t.state === state) return;
    if (!canGo(t, state)) return void toast({ text: `Workflow của team không cho ${t.state} → ${state}` });
    const prev = t.state, go = (from: Ticket, to: string) => saveTicket(y.patchTicket, from, { state: to }, () => yt.setField(t.id, "State", to));
    if (await go(t, state)) toast({ text: `${t.id} → ${state}`, undo: prev ? () => void go({ ...t, state }, prev) : undefined });
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 md:max-h-[calc(100dvh-var(--yt-top)-1rem)]">
      {cols.map(([st, list]) => (
        <section key={st} aria-label={`${st}: ${list.length} ticket`}
          onDragOver={(e) => { if (drag && write) { e.preventDefault(); setOver(st); } }} onDragLeave={() => setOver((o) => (o === st ? null : o))} onDrop={(e) => { e.preventDefault(); void drop(st); }}
          className={cn("flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] bg-paper-2 transition-[background-color,opacity] duration-(--dur-micro)", over === st && "bg-hl-wash ring-2 ring-hl",
            moving && moving.state !== st && !canGo(moving, st) && "opacity-40")}>
          <header className="sticky top-0 flex items-center gap-2 px-3 py-2"><StatePill state={st} /><b className="ml-auto rounded-full bg-paper-3 px-1.5 font-mono text-xs font-medium text-ink-3">{list.length}</b></header>
          <ul className="grid min-h-16 content-start gap-1.5 overflow-y-auto px-2 pb-2">
            {list.slice(0, PER).map((i) => (
              <li key={i.id} draggable={write} onDragStart={(e) => { setDrag(i.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDrag(null); setOver(null); }}
                className={cn("rounded-[var(--radius-input)]", drag === i.id && "opacity-40")}>
                <button type="button" onClick={() => onOpen(i)} style={{ boxShadow: `inset 3px 0 0 ${stateColor(i.state)}, var(--edge-stock)` }}
                  className={cn("grid w-full gap-1.5 rounded-[var(--radius-input)] bg-cotton py-2.5 pr-2.5 pl-3.5 text-left hover:bg-paper-2", write && "cursor-grab active:cursor-grabbing")}>
                  <span className="flex items-center gap-2"><b className="font-mono text-xs">{i.id}</b><TypeTag type={i.type} />{i.due && i.due < now && <span className="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold text-error"><AlertTriangle className="size-3" />quá hạn</span>}</span>
                  {tagsOf(i).length > 0 && <span className="flex flex-wrap gap-1">{tagsOf(i).map((t) => <Tag key={t} name={t} />)}</span>}
                  <span className={cn("line-clamp-3 text-sm leading-snug font-medium text-ink", i.resolved && "font-normal text-ink-3 line-through")}>{titleOf(i)}</span>
                  <span className="flex items-center justify-between gap-2"><Prio p={i.priority} /><Person name={i.assignee} empty="Chưa assign" /></span>
                </button>
              </li>
            ))}
            {list.length > PER && <li className="px-1 text-xs text-ink-3">… và {list.length - PER} ticket nữa, lọc bớt để xem</li>}
          </ul>
        </section>
      ))}
      {doneN > 0 && (
        <button type="button" onClick={() => setShowDone(!showDone)} title={showDone ? "Ẩn các cột đã xong" : "Hiện các cột đã xong"}
          className="flex w-12 shrink-0 flex-col items-center gap-2 rounded-[var(--radius-card)] bg-paper-2 py-3 text-xs font-medium text-ink-2 hover:bg-paper-3 hover:text-ink">
          <b className="font-mono font-medium tabular-nums">{fmt(doneN)}</b><span className="[writing-mode:vertical-rl]">{showDone ? "Ẩn đã xong" : "Đã xong"}</span>
        </button>
      )}
    </div>
  );
}

/** Nothing to show: why, clear filters, and a lookup by ID anywhere in YouTrack. */
function Empty({ anyFilter }: { anyFilter: boolean }) {
  const y = useYt();
  const q = y.filters.q.trim();
  const [gid, setGid] = useState(() => (/^([A-Za-z][A-Za-z0-9_]*-)?\d+$/.test(q) ? q : ""));
  const [msg, setMsg] = useState("");
  const qc = useQueryClient();
  async function find() {
    const id = ticketId(gid, y.project);
    if (!id) { setMsg("Nhập số ticket hoặc ID dạng VA-123."); return; }
    setMsg(`Đang tìm ${id}…`);
    try { await qc.fetchQuery({ queryKey: ["yt", "detail", id], queryFn: () => yt.detail(id) }); setMsg(""); y.openTicket(id); }
    catch (e) { setMsg(`Không tìm thấy ${id} (${(e as Error).message})`); }
  }
  return (
    <div className="grid justify-items-center gap-3 rounded-lg bg-cotton px-6 py-14 text-center text-sm text-ink-2 shadow-stock">
      <p>{q ? `Không tìm thấy ticket nào khớp “${q}” trong dữ liệu đã tải.` : "Không có ticket nào."}</p>
      {anyFilter && <Button size="sm" variant="outline" onClick={() => y.setFilters({ q: "", tier: null, quick: null, state: [], priority: [], type: [], sprint: [], assignee: [] })}><X /> Xóa bộ lọc</Button>}
      <div className="flex w-full max-w-md gap-2">
        <input type="search" value={gid} onChange={(e) => setGid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void find(); }} placeholder="Tìm toàn cục theo ID (vd. 123 hoặc VA-123)"
          aria-label="Tìm toàn cục theo ID" className="h-9 flex-1 rounded-md border border-rule bg-paper px-2 text-sm outline-none focus:border-hl" />
        <Button onClick={() => void find()}>Tìm toàn cục</Button>
      </div>
      <p role="status" className="text-xs text-ink-3">{msg}</p>
    </div>
  );
}

function TableSkeleton() {
  // table-shaped rows (check, id, avatar, title, chips) under one shimmer sweep, fading in one after another
  return (
    <div role="status" aria-label="Đang tải…" className="shimmer grid rounded-lg bg-cotton shadow-stock">
      <div className="h-9 border-b border-rule bg-paper-2" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
        <motion.div key={k} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1 - k * 0.09, y: 0 }} transition={{ delay: k * 0.05, duration: 0.3 }}
          className="flex items-center gap-3 border-b border-rule/60 px-3 py-2.5 last:border-0">
          <span className="size-4 rounded bg-paper-3" />
          <span className="h-3.5 w-14 rounded bg-paper-3" />
          <span className="size-6 rounded-full bg-paper-3" />
          <span className="h-3.5 rounded bg-paper-3" style={{ width: `${30 + ((k * 37) % 35)}%` }} />
          <span className="ml-auto h-5 w-16 rounded-full bg-paper-3 max-sm:hidden" />
          <span className="h-5 w-12 rounded-full bg-paper-3 max-sm:hidden" />
        </motion.div>
      ))}
    </div>
  );
}

/** Hover a row for a moment: a card with the description. */
function HoverPreview({ body }: { body: React.RefObject<HTMLTableSectionElement | null> }) {
  const y = useYt();
  const [at, setAt] = useState<{ id: string; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const el = body.current;
    if (!el || matchMedia("(hover: none)").matches) return;
    let cur: string | null = null;
    const over = (e: MouseEvent) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]")?.dataset.id ?? null;
      if (id === cur) return;
      cur = id;
      clearTimeout(timer.current);
      setAt(null);
      if (id) timer.current = setTimeout(() => setAt({ id, x: e.clientX, y: e.clientY }), 450);
    };
    const leave = () => { cur = null; clearTimeout(timer.current); setAt(null); };
    const scroll = () => setAt(null);
    el.addEventListener("mouseover", over);
    el.addEventListener("mouseleave", leave);
    addEventListener("scroll", scroll, { passive: true, capture: true });
    return () => { el.removeEventListener("mouseover", over); el.removeEventListener("mouseleave", leave); removeEventListener("scroll", scroll, { capture: true }); clearTimeout(timer.current); };
  }, [body]);
  const d = useQuery({ queryKey: ["yt", "detail", at?.id], queryFn: () => yt.detail(at!.id), enabled: !!at, staleTime: 60_000 });
  const t = at && y.rows.find((i) => i.id === at.id);
  if (!at || !t || y.sheet) return null;
  const left = Math.max(8, Math.min(at.x + 16, innerWidth - 380)), top = at.y + 220 > innerHeight ? Math.max(8, at.y - 200) : at.y + 18;
  return (
    <div role="tooltip" className="pointer-events-none fixed z-30 grid w-[360px] gap-1.5 rounded-lg bg-cotton p-3 text-xs shadow-pop animate-in fade-in-0 duration-(--dur-short)" style={{ left, top }}>
      <div className="text-sm font-medium"><span className="mr-1.5 font-mono text-ink-3">{t.id}</span>{t.summary}</div>
      <div className="flex gap-3 text-ink-3"><span>{t.state || "—"}</span><span>{t.priority || "—"}</span><span>{t.assignee || "Chưa assign"}</span></div>
      <div className="line-clamp-6 text-ink-2">{d.isPending ? "Đang tải mô tả…" : d.data ? snippet(d.data.description) || <i>Không có mô tả</i> : "Không tải được mô tả."}</div>
    </div>
  );
}


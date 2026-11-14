"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Columns3, Copy, Download, Link2, Rows3, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { Fragment, memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { Segmented } from "@/shared/components/ui/segmented";
import { useNow } from "@/shared/hooks/use-now";
import { copyText } from "@/shared/lib/notifications";
import { ago } from "@/shared/lib/time";
import { fmtDate, type Key, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { activePool, type ColKey, COLS, counts, DAY, exportCsv, fmt, groupRows, issueUrl, lastSp, PCOL, rank, shortSp, snippet, stateColor, tagsOf, ticketId, titleOf, TINT, type Ticket, typeColor, visibleRows, ytDetailQuery } from "@/features/youtrack/lib/yt";
import { MultiSelect, Person, Popover, Prio, StatePill, Tag, TypeTag } from "./bits";
import { type AssigneeActs, AssigneePicker } from "./sheet";
import { CAP_STEP, useYt } from "./state";
import { Board } from "./tickets-board";
import { BulkBar } from "./tickets-bulk";
import { grab, morph, type Snap, useFlip } from "./tickets-morph";
import { aiFilterApply, useAiFilterBusy, Views } from "./tickets-views";

/** Group keys with no real value (lib/yt GROUPS): data keys, translated only for display. */
const NO_GROUP = new Set<string>(["Chưa assign", "Không sprint", "Không module"] satisfies Key[]);

// The ticket ledger: one toolbar (search + AI filter, Priority / Type / State menus, views, display), then the table or board.

export function TicketsPage() {
  const t = useT();
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
  const tcols = useMemo(() => cols.filter((k) => k !== "id"), [cols]); // ID sits under the title
  const now = useNow();
  const searchRef = useRef<HTMLInputElement>(null);
  const aiBusy = useAiFilterBusy();
  const tableRef = useRef<HTMLTableSectionElement>(null);
  // State too, not just the ref: HoverPreview must re-attach when the table first mounts (cold load) or comes back from Empty.
  const [tbody, setTbody] = useState<HTMLTableSectionElement | null>(null);
  const bodyRef = useCallback((el: HTMLTableSectionElement | null) => { tableRef.current = el; setTbody(el); }, []);
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
    <Row key={i.id} i={i} cols={tcols} now={now} onOpen={open} onPick={togglePick} acts={acts} picked={y.picked.has(i.id)} dense={y.dense}
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

  // keys: / search, j / k rows, Space tick (as Telegram's multi-select; x is "done" there), Esc clears the search, then the ticked rows
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
      } else if (e.key === " " && el.matches("tr[data-id]")) { // a button / link in the row keeps its own Space
        e.preventDefault();
        togglePick(el.dataset.id!);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Bảng ↔ Board morph: the view shown lags y.view by one layout pass, so the old view is still on screen to measure
  const still = useReducedMotion();
  const page = useRef<HTMLElement>(null);
  const snap = useRef<Snap | null>(null);
  const [view, setShownView] = useState(y.view);
  useLayoutEffect(() => {
    if (view === y.view) return;
    snap.current = still || !page.current ? null : grab(page.current);
    setShownView(y.view); // eslint-disable-line react-hooks/set-state-in-effect -- the old view had to be measured first; flushes before paint
  }, [y.view, view, still]);
  useLayoutEffect(() => {
    const s = snap.current;
    snap.current = null;
    return s && page.current ? morph(s, page.current) : undefined;
  }, [view]);
  useFlip(page, [fq, folded, y.showRes], still); // filter / sort / fold: the rows glide into their new order

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
    <section ref={page} aria-label="Ticket" className="grid gap-3 md:flex md:min-h-0 md:flex-1 md:flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input ref={searchRef} type="search" value={f.q} onChange={(e) => y.setFilters({ q: e.target.value })} aria-label={t("Tìm ticket")} autoComplete="off" maxLength={500}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && y.aiOn) { e.preventDefault(); void aiFilterApply(y, f.q); } }}
            placeholder={t(y.aiOn ? "Tìm ID, tiêu đề, người… hoặc gõ một câu cho AI lọc  ( / )" : "Tìm ID, tiêu đề, người…  ( / )")}
            className={cn("h-9 w-full rounded-[var(--radius-input)] border border-rule-2 bg-cotton pl-9 text-sm text-ink transition-[border-color] duration-(--dur-micro) placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1", y.aiOn ? "pr-20" : "pr-2")} />
          {y.aiOn && (
            <Hint text={t("AI đổi câu này thành bộ lọc State / Priority / Type / Người / Sprint (⌘↵)")} side="bottom">
              <button type="button" disabled={!f.q.trim() || aiBusy} onClick={() => void aiFilterApply(y, f.q)}
                className="absolute top-1/2 right-1 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-[var(--radius-input)] px-2 text-xs font-medium text-hl-2 hover:bg-hl-wash disabled:opacity-40">
                <Sparkles className={cn("size-3.5", aiBusy && "animate-pulse")} />{t("AI lọc")}
              </button>
            </Hint>
          )}
        </label>
        <div role="group" aria-label={t("Bộ lọc")} className="flex flex-wrap items-center gap-1.5">
          {facet("priority", priPool, (v) => PCOL[v] || "var(--color-ink-3)")}
          {facet("type", typePool, typeColor)}
          {facet("state", pool, stateColor)}
        </div>
        <span aria-live="polite" className="px-1 font-mono text-xs whitespace-nowrap text-ink-3 tabular-nums">{t("{n} ticket", { n: fmt(shownAll.length) })}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Views />
          <Segmented id="yt-tickets-view" label={t("Kiểu xem")} value={y.view} onChange={y.setView} items={[
            { value: "table", label: <span className="inline-flex items-center gap-1"><Rows3 className="size-3.5" />{t("Bảng")}</span> },
            { value: "board", label: <span className="inline-flex items-center gap-1"><Columns3 className="size-3.5" />Board</span> },
          ]} />
          <Display onGroup={() => setFolded(new Set())} />
          <Hint text={t("Xuất danh sách đang lọc (các cột đang hiện) ra CSV")} side="bottom">
            <Button size="icon-sm" variant="outline" onClick={() => exportCsv(shownAll, y.project, cols)} aria-label={t("Xuất CSV")}><Download /></Button>
          </Hint>
        </div>
      </div>

      <AnimatePresence>{y.picked.size > 0 && <BulkBar key="bulk" />}</AnimatePresence>

      {view === "board" && shownAll.length > 0 ? <Board rows={shownAll} onOpen={open} /> : parts.some((p) => p[1].length) ? (
        // its own scroll area (both ways) from md up, shrunk to the space left under the filters: wide tables keep their right-hand columns and the sticky headers still work
        <div data-view className="overflow-x-auto rounded-lg bg-cotton shadow-stock md:min-h-0 md:overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="z-10 bg-cotton text-left text-xs text-ink-3 shadow-[inset_0_-1px_0_var(--color-rule)] md:sticky md:top-0">
              <tr>
                <th className="w-9 py-2 pr-1 pl-3.5"><input type="checkbox" aria-label={t("Chọn tất cả ticket đang hiện")} checked={shown.every((i) => y.picked.has(i.id))}
                  onChange={(e) => y.setPicked(e.target.checked ? new Set([...y.picked, ...shown.map((i) => i.id)]) : new Set([...y.picked].filter((id) => !shown.some((i) => i.id === id))))} /></th>
                {tcols.map((k) => {
                  const sk: ColKey = k === "summary" ? "id" : k; // the title column sorts by ticket number
                  const on = f.sort.k === sk;
                  return (
                    <th key={k} aria-sort={on ? (f.sort.d === "asc" ? "ascending" : "descending") : undefined} className="px-3 py-2 font-medium whitespace-nowrap">
                      <button type="button" className={cn("inline-flex items-center gap-1 hover:text-ink", on && "text-ink")}
                        onClick={() => y.setFilters({ sort: on ? { k: sk, d: f.sort.d === "asc" ? "desc" : "asc" } : { k: sk, d: "asc" } })}>
                        {k === "summary" ? "Ticket" : t(COLS.find(([c]) => c === k)![1])}{on && <span aria-hidden>{f.sort.d === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody ref={bodyRef} className="zebra">
              {!groups
                ? shown.map(row)
                : parts.map(([g, items, part]) => (
                  <Fragment key={g}>
                    <tr data-zebra-off data-g={g} className="z-[5] bg-paper-2 md:sticky md:top-[33px]">
                      <td colSpan={tcols.length + 1} className="px-3.5 py-1.5">
                        <button type="button" aria-expanded={!folded.has(g)} className="flex w-full items-center gap-2 text-left text-sm font-bold text-ink" onClick={() => fold(g)}>
                          <ChevronDown className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-in-out)", folded.has(g) && "-rotate-90")} />
                          {NO_GROUP.has(g) ? t(g as Key) : f.group === "assignee" ? <Person name={g} /> : g}
                          <b className="font-mono text-xs font-medium text-ink-3">{items.length}</b>
                        </button>
                      </td>
                    </tr>
                    {part.map(row)}
                  </Fragment>
                ))}
            </tbody>
          </table>
          {more && <div ref={endRef} role="status" className="px-3 py-3 text-center text-xs text-ink-3">{t("Đang hiện {n} / {all}…", { n: fmt(shown.length), all: fmt(shownAll.length) })}</div>}
        </div>
      ) : (
        <Empty anyFilter={anyFilter} />
      )}
      {view === "table" && <HoverPreview el={tbody} />}
    </section>
  );
}

/** Display options: density, resolved tickets, priority tint, grouping, columns. */
function Display({ onGroup }: { onGroup: () => void }) {
  const t = useT();
  const y = useYt();
  return (
    <Popover label={<span className="inline-flex items-center gap-1"><SlidersHorizontal className="size-3.5" />{t("Hiển thị")}</span>} align="right">
      {() => (
        <div className="grid p-1 text-sm">
          {([["Gọn: hàng thấp, tiêu đề 1 dòng", y.dense, y.setDense], ["Hiện ticket đã resolved", y.showRes, y.setShowRes], ["Tô nền ticket High trở lên", y.hiOn, y.setHiOn]] as const).map(([l, on, set]) => (
            <label key={l} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-paper-2"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{t(l)}</label>
          ))}
          {y.view === "table" && <>
            <div className="mx-2 my-1 border-t border-rule" />
            <span className="px-2 pt-1 pb-1.5 text-xs font-medium text-ink-3">{t("Gom nhóm")}</span>
            <Segmented id="yt-tickets-group" label={t("Gom nhóm")} className="mx-2 mb-1" value={y.filters.group} onChange={(group) => { onGroup(); y.setFilters({ group }); }} items={[
              { value: "none", label: t("Không") }, { value: "assignee", label: t("Người") }, { value: "sprint", label: "Sprint" }, { value: "module", label: "Module" },
            ]} />
            <div className="mx-2 my-1 border-t border-rule" />
            <span className="px-2 pt-1 pb-0.5 text-xs font-medium text-ink-3">{t("Cột")}</span>
            {COLS.filter(([k]) => k !== "id" && k !== "summary").map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-paper-2">
                <input type="checkbox" checked={!y.hiddenCols.includes(k)} onChange={(e) => y.setHiddenCols(e.target.checked ? y.hiddenCols.filter((c) => c !== k) : [...y.hiddenCols, k])} />{t(l)}
              </label>
            ))}
          </>}
        </div>
      )}
    </Popover>
  );
}

const Row = memo(function Row({ i, cols, now, onOpen, onPick, acts, picked, dense, tint, fresh }: {
  i: Ticket; cols: ColKey[]; now: number; onOpen: (i: Ticket) => void; onPick: (id: string) => void; acts: AssigneeActs; picked: boolean; dense: boolean; tint: number; fresh: boolean;
}) {
  const t = useT();
  const base = acts.config?.base ?? "";
  const pad = dense ? "py-1.5" : "py-2.5";
  const tags = tagsOf(i);
  const id = (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <a href={issueUrl(base, i.id)} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium text-ink-3 no-underline hover:text-hl-2" onClick={(e) => e.stopPropagation()}>{i.id}</a>
      {fresh && <span aria-label={t("Cập nhật sau lần bạn xem trước")} className="rounded-full bg-hl px-1.5 text-xs leading-4 font-bold text-hl-ink">{t("mới")}</span>}
      <span className="flex opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
        <button type="button" aria-label={`Copy ID ${i.id}`} className="rounded p-0.5 text-ink-3 hover:text-ink" onClick={(e) => { e.stopPropagation(); void copyText(i.id, t("Đã copy {id}", { id: i.id })); }}><Copy className="size-3" /></button>
        <button type="button" aria-label={`Copy link ${i.id}`} className="rounded p-0.5 text-ink-3 hover:text-ink" onClick={(e) => { e.stopPropagation(); void copyText(issueUrl(base, i.id), t("Đã copy link {id}", { id: i.id })); }}><Link2 className="size-3" /></button>
      </span>
    </span>
  );
  const title = <span className={cn("min-w-0 font-medium text-ink", dense ? "truncate" : "line-clamp-2", i.resolved && "font-normal text-ink-3 line-through")}>{titleOf(i)}</span>;
  const cell: Partial<Record<ColKey, React.ReactNode>> = {
    summary: dense ? <span className="flex min-w-0 items-center gap-2">{id}{title}</span> : (
      <span className="grid min-w-0 gap-1">
        {title}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{id}{tags.map((t) => <Tag key={t} name={t} />)}</span>
      </span>
    ),
    type: i.type ? <TypeTag type={i.type} /> : <span className="text-ink-3">—</span>,
    state: <StatePill state={i.state} />,
    priority: <Prio p={i.priority} />,
    assignee: <AssigneePicker ticket={i} acts={acts} className="w-40" />,
    qc: <Person name={i.qc} />,
    sprint: i.sprints.length ? <span className="font-mono text-xs whitespace-nowrap text-ink-2">{shortSp(lastSp(i))}{i.sprints.length > 1 && <small className="ml-1 text-ink-3">+{i.sprints.length - 1}</small>}</span> : <span className="text-ink-3">—</span>,
    due: i.due ? (
      <span className={cn("inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap", i.due < now ? "font-bold text-error" : i.due - now < 2 * DAY ? "text-warn" : "text-ink-2")}>
        {i.due < now && <AlertTriangle className="size-3" />}{fmtDate(i.due, { day: "2-digit", month: "2-digit" }, t.lang)}
      </span>
    ) : <span className="text-ink-3">—</span>,
    updated: <span className="text-xs whitespace-nowrap text-ink-3">{ago(i.updated)}</span>,
  };
  return (
    <tr data-id={i.id} tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,select,input")) onOpen(i); }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(i); }}
      style={tint ? { backgroundColor: `color-mix(in oklch, ${PCOL[i.priority!]} ${tint}%, transparent)` } : undefined}
      className={cn("group/row cursor-pointer border-t border-rule/60 align-middle transition-colors duration-(--dur-micro) first:border-0 hover:bg-paper-2 focus-visible:bg-hl-wash focus-visible:outline-none", picked && "bg-hl-wash/60", i.resolved && "text-ink-3")}>
      <td className={cn("pr-1 pl-3.5", pad)} style={{ boxShadow: `inset 3px 0 0 ${stateColor(i.state)}` }} onClick={(e) => { e.stopPropagation(); onPick(i.id); }}>
        <input type="checkbox" checked={picked} onChange={() => onPick(i.id)} onClick={(e) => e.stopPropagation()} aria-label={t("Chọn {id}", { id: i.id })} />
      </td>
      {cols.map((k) => <td key={k} className={cn("px-3", pad, k === "summary" ? "w-full max-w-0 min-w-80" : "whitespace-nowrap")}>{cell[k]}</td>)}
    </tr>
  );
});

/** Nothing to show: why, clear filters, and a lookup by ID anywhere in YouTrack. */
function Empty({ anyFilter }: { anyFilter: boolean }) {
  const t = useT();
  const y = useYt();
  const q = y.filters.q.trim();
  const [gid, setGid] = useState(() => (/^([A-Za-z][A-Za-z0-9_]*-)?\d+$/.test(q) ? q : ""));
  const [msg, setMsg] = useState("");
  const qc = useQueryClient();
  async function find() {
    const id = ticketId(gid, y.project);
    if (!id) { setMsg(t("Nhập số ticket hoặc ID dạng VA-123.")); return; }
    setMsg(t("Đang tìm {id}…", { id }));
    try { await qc.fetchQuery(ytDetailQuery(id)); setMsg(""); y.openTicket(id); }
    catch (e) { setMsg(t("Không tìm thấy {id} ({msg})", { id, msg: (e as Error).message })); }
  }
  return (
    <div className="grid justify-items-center gap-3 rounded-lg bg-cotton px-6 py-14 text-center text-sm text-ink-2 shadow-stock">
      <p>{q ? t("Không tìm thấy ticket nào khớp “{q}” trong dữ liệu đã tải.", { q }) : t("Không có ticket nào.")}</p>
      {anyFilter && <Button size="sm" variant="outline" onClick={() => y.setFilters({ q: "", tier: null, quick: null, state: [], priority: [], type: [], sprint: [], assignee: [] })}><X /> {t("Xóa bộ lọc")}</Button>}
      <div className="flex w-full max-w-md gap-2">
        <input type="search" value={gid} onChange={(e) => setGid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void find(); }} placeholder={t("Tìm toàn cục theo ID (vd. 123 hoặc VA-123)")}
          aria-label={t("Tìm toàn cục theo ID")} className="h-9 flex-1 rounded-md border border-rule bg-paper px-2 text-sm focus:border-hl" />
        <Button onClick={() => void find()}>{t("Tìm toàn cục")}</Button>
      </div>
      <p role="status" className="text-xs text-ink-3">{msg}</p>
    </div>
  );
}

/** Hover a row for a moment: a card with the description. */
function HoverPreview({ el }: { el: HTMLTableSectionElement | null }) {
  const t = useT();
  const y = useYt();
  const [at, setAt] = useState<{ id: string; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
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
  }, [el]);
  const d = useQuery({ ...ytDetailQuery(at?.id ?? ""), enabled: !!at });
  const tk = at && y.rows.find((i) => i.id === at.id);
  if (!at || !tk || y.sheet) return null;
  const left = Math.max(8, Math.min(at.x + 16, innerWidth - 380)), top = at.y + 220 > innerHeight ? Math.max(8, at.y - 200) : at.y + 18;
  return (
    <div role="tooltip" className="pointer-events-none fixed z-30 grid w-[360px] gap-1.5 rounded-lg bg-cotton p-3 text-xs shadow-pop animate-in fade-in-0 duration-(--dur-short)" style={{ left, top }}>
      <div className="text-sm font-medium"><span className="mr-1.5 font-mono text-ink-3">{tk.id}</span>{tk.summary}</div>
      <div className="flex gap-3 text-ink-3"><span>{tk.state || "—"}</span><span>{tk.priority || "—"}</span><span>{tk.assignee || t("Chưa assign")}</span></div>
      <div className="line-clamp-6 text-ink-2">{d.isPending ? t("Đang tải mô tả…") : d.data ? snippet(d.data.description) || <i>{t("Không có mô tả")}</i> : t("Không tải được mô tả.")}</div>
    </div>
  );
}

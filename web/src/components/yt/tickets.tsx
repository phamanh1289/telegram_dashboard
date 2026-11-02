"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Columns3, Copy, Download, Link2, Rows3, Search, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useNow } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import {
  activePool, AI_MAX, ago, type ColKey, COLS, copyText, counts, DAY, exportCsv, type Filters, fmt, groupRows, issueUrl, lastSp, PCOL, rank,
  shortSp, snippet, stateColor, tagsOf, ticketId, TINT, type Ticket, typeColor, visibleRows, yt,
} from "@/lib/yt";
import { period } from "@/lib/yt-stats";
import { Chip, Person, Popover, Prio, StatePill, TypeTag } from "./bits";
import { AssigneeSelect } from "./sheet";
import { CAP_STEP, useYt } from "./state";

// The ticket ledger: search + AI filter, chip rows with counts, grouping, columns, bulk changes, CSV.

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
  const shown = shownAll.slice(0, y.cap);
  const cols = COLS.map(([k]) => k).filter((k) => !y.hiddenCols.includes(k));
  const now = useNow();
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());

  // a ticket filtered out is no longer ticked
  useEffect(() => {
    const ids = new Set(shownAll.map((i) => i.id));
    if ([...y.picked].some((id) => !ids.has(id))) y.setPicked(new Set([...y.picked].filter((id) => ids.has(id))));
  }, [shownAll]); // eslint-disable-line react-hooks/exhaustive-deps

  // keys: / or ⌘K search, j / k rows, x tick, Esc clears the search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (y.sheet) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      const el = e.target as HTMLElement;
      if (e.key === "Escape" && el === searchRef.current && f.q) { y.setFilters({ q: "" }); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input,textarea,select,[contenteditable],[role=dialog]")) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
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

  function togglePick(id: string) {
    const next = new Set(y.picked);
    if (!next.delete(id)) next.add(id);
    y.setPicked(next);
  }
  const toggle = (key: "state" | "priority" | "type", v: string | null) =>
    y.setFilters({ [key]: v == null ? [] : f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] });
  const open = (i: Ticket) => y.openTicket(i.id, shownAll);
  const anyFilter = !!(f.sprint.length || f.assignee.length || f.tier != null || f.state.length || f.priority.length || f.type.length || f.q);

  return (
    <section aria-label="Ticket" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input ref={searchRef} type="search" value={f.q} onChange={(e) => y.setFilters({ q: e.target.value })} aria-label="Tìm ticket" autoComplete="off"
            placeholder="Tìm ID, tiêu đề, người…  ( / hoặc ⌘K)" className="h-9 w-full rounded-md border border-rule bg-cotton pr-2 pl-8 text-sm outline-none focus:border-hl" />
        </label>
        {y.aiOn && <AiFilter />}
        <span aria-live="polite" className="text-xs whitespace-nowrap text-ink-3">{fmt(shownAll.length)} ticket{shownAll.length > y.cap ? `, hiện ${fmt(y.cap)} đầu` : ""}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select value={f.group} onChange={(e) => { setFolded(new Set()); y.setFilters({ group: e.target.value as Filters["group"] }); }} aria-label="Gom nhóm"
            className="h-[30px] rounded-md border border-rule bg-cotton px-2 text-[0.8125rem]">
            <option value="none">Không gom nhóm</option><option value="assignee">Gom theo Assignee</option><option value="sprint">Gom theo Sprint</option><option value="module">Gom theo Module / App</option>
          </select>
          <Popover label={<span className="inline-flex items-center gap-1"><Columns3 className="size-3.5" />Cột</span>} align="right" title="Chọn cột">
            {() => (
              <div className="grid p-1">
                {COLS.filter(([k]) => k !== "id" && k !== "summary").map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-paper-2">
                    <input type="checkbox" checked={!y.hiddenCols.includes(k)} onChange={(e) => y.setHiddenCols(e.target.checked ? y.hiddenCols.filter((c) => c !== k) : [...y.hiddenCols, k])} />{l}
                  </label>
                ))}
              </div>
            )}
          </Popover>
          <Button size="sm" variant="outline" aria-pressed={y.dense} onClick={() => y.setDense(!y.dense)} title="Hàng thấp hơn, tiêu đề 1 dòng"><Rows3 /> Gọn</Button>
          <Button size="sm" variant="outline" aria-pressed={y.showRes} onClick={() => y.setShowRes(!y.showRes)} title="Hiện ticket đã resolved (chữ xám, gạch ngang)">Resolved</Button>
          <Button size="sm" variant="outline" aria-pressed={y.hiOn} onClick={() => y.setHiOn(!y.hiOn)} title="Tô nền các ticket từ High trở lên">High+</Button>
          <Button size="icon-sm" variant="outline" onClick={() => exportCsv(shownAll, y.project, cols)} aria-label="Xuất CSV" title="Xuất danh sách đang lọc (các cột đang hiện) ra CSV"><Download /></Button>
        </div>
      </div>

      <div role="group" aria-label="Bộ lọc" className="grid gap-1.5 rounded-lg bg-paper-2 p-2.5">
        <ChipRow label="Priority" items={counts(priPool, "priority", f.priority)} value={f.priority} total={priPool.length} color={(n) => PCOL[n] || "var(--color-ink-3)"} onPick={(v) => toggle("priority", v)} />
        <ChipRow label="Type" items={counts(typePool, "type", f.type)} value={f.type} total={typePool.length} color={typeColor} onPick={(v) => toggle("type", v)} />
        <ChipRow label="State" items={counts(pool, "state", f.state)} value={f.state} total={pool.length} color={stateColor} onPick={(v) => toggle("state", v)} />
      </div>

      <AnimatePresence>{y.picked.size > 0 && <BulkBar key="bulk" />}</AnimatePresence>

      {shown.length > 0 ? (
        <div className="overflow-x-auto rounded-lg bg-cotton shadow-stock">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-paper-2 text-left text-xs text-ink-3">
              <tr>
                <th className="w-9 px-3 py-2"><input type="checkbox" aria-label="Chọn tất cả ticket đang hiện" checked={shown.every((i) => y.picked.has(i.id))}
                  onChange={(e) => y.setPicked(e.target.checked ? new Set([...y.picked, ...shown.map((i) => i.id)]) : new Set([...y.picked].filter((id) => !shown.some((i) => i.id === id))))} /></th>
                {cols.map((k) => {
                  const on = f.sort.k === k;
                  return (
                    <th key={k} aria-sort={on ? (f.sort.d === "asc" ? "ascending" : "descending") : undefined} className="px-2 py-2 font-medium whitespace-nowrap">
                      <button type="button" className={cn("inline-flex items-center gap-1 hover:text-ink", on && "text-ink")}
                        onClick={() => y.setFilters({ sort: on ? { k, d: f.sort.d === "asc" ? "desc" : "asc" } : { k, d: "asc" } })}>
                        {COLS.find(([c]) => c === k)![1]}{on && <span aria-hidden>{f.sort.d === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {f.group === "none"
                ? shown.map((i) => <Row key={i.id} i={i} cols={cols} now={now} onOpen={open} onPick={togglePick} />)
                : groupRows(shown, f.group, y.sprints).map(([g, items]) => (
                  <Fragment key={g}>
                    <tr className="sticky top-[33px] z-[5] bg-paper">
                      <td colSpan={cols.length + 1} className="border-y border-rule px-3 py-1.5">
                        <button type="button" aria-expanded={!folded.has(g)} className="flex w-full items-center gap-2 text-left text-xs font-semibold text-ink-2"
                          onClick={() => setFolded((s) => { const n = new Set(s); if (!n.delete(g)) n.add(g); return n; })}>
                          <ChevronDown className={cn("size-3.5 transition-transform duration-(--dur-micro)", folded.has(g) && "-rotate-90")} />
                          {f.group === "sprint" ? g : f.group === "assignee" && g !== "Chưa assign" ? <Person name={g} /> : g}
                          <b className="rounded-full bg-paper-3 px-1.5 font-mono font-medium text-ink-3">{items.length}</b>
                        </button>
                      </td>
                    </tr>
                    {!folded.has(g) && items.map((i) => <Row key={i.id} i={i} cols={cols} now={now} onOpen={open} onPick={togglePick} />)}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      ) : y.issues.isPending ? <TableSkeleton /> : (
        <Empty anyFilter={anyFilter} />
      )}
      {shownAll.length > y.cap && (
        <Button variant="outline" className="justify-self-center" onClick={() => y.setCap(y.cap + CAP_STEP)}>Hiện thêm {fmt(Math.min(CAP_STEP, shownAll.length - y.cap))} ticket</Button>
      )}
      <HoverPreview body={tableRef} />
    </section>
  );
}

function ChipRow({ label, items, value, total, color, onPick }: { label: string; items: [string, number][]; value: string[]; total: number; color: (v: string) => string; onPick: (v: string | null) => void }) {
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-2 max-sm:grid-cols-1">
      <span className="pt-1.5 text-xs font-medium text-ink-3">{label}</span>
      <div className="flex flex-wrap gap-1">
        <Chip on={!value.length} onClick={() => onPick(null)} count={total}>Tất cả</Chip>
        {items.map(([v, n]) => <Chip key={v} on={value.includes(v)} onClick={() => onPick(v)} swatch={color(v)} count={n}>{v}</Chip>)}
      </div>
    </div>
  );
}

function Row({ i, cols, now, onOpen, onPick }: { i: Ticket; cols: ColKey[]; now: number; onOpen: (i: Ticket) => void; onPick: (id: string) => void }) {
  const y = useYt();
  const r = rank(i), tint = y.hiOn && TINT[r] && !i.resolved ? TINT[r] : 0;
  const picked = y.picked.has(i.id);
  const fresh = y.seen > 0 && i.updated > y.seen;
  const tags = tagsOf(i);
  const cell: Record<ColKey, React.ReactNode> = {
    id: (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <a href={issueUrl(y.config?.base ?? "", i.id)} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium no-underline hover:text-hl-2" onClick={(e) => e.stopPropagation()}>{i.id}</a>
        {fresh && <span title="Cập nhật sau lần bạn xem trước" className="rounded-full bg-hl px-1.5 text-[10px] leading-4 font-semibold text-hl-ink">mới</span>}
        <span className="flex opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
          <button type="button" title="Copy ID" aria-label="Copy ID" className="rounded p-0.5 text-ink-3 hover:text-ink" onClick={(e) => { e.stopPropagation(); void copyText(i.id); toast({ text: `Đã copy ${i.id}` }); }}><Copy className="size-3" /></button>
          <button type="button" title="Copy link" aria-label="Copy link" className="rounded p-0.5 text-ink-3 hover:text-ink" onClick={(e) => { e.stopPropagation(); void copyText(issueUrl(y.config?.base ?? "", i.id)); toast({ text: `Đã copy link ${i.id}` }); }}><Link2 className="size-3" /></button>
        </span>
      </span>
    ),
    type: <TypeTag type={i.type} />,
    summary: (
      <span className="grid gap-0.5">
        {tags.length > 0 && <span className="flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="rounded-[4px] bg-paper-3 px-1 text-[10px] font-medium text-ink-2">{t}</span>)}</span>}
        <span title={i.summary ?? ""} className={cn(y.dense ? "line-clamp-1" : "line-clamp-2", i.resolved && "text-ink-3 line-through")}>{i.summary}</span>
      </span>
    ),
    state: <StatePill state={i.state} />,
    priority: <Prio p={i.priority} />,
    assignee: <AssigneeSelect ticket={i} className="h-7 border-transparent bg-transparent hover:border-rule" />,
    qc: <Person name={i.qc} />,
    sprint: i.sprints.length ? <span title={i.sprints.join(", ")} className="font-mono text-xs whitespace-nowrap text-ink-2">{shortSp(lastSp(i))}{i.sprints.length > 1 && <small className="ml-1 text-ink-3">+{i.sprints.length - 1}</small>}</span> : <span className="text-ink-3">—</span>,
    due: i.due ? (
      <span title={new Date(i.due).toLocaleString("vi-VN")} className={cn("inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap", i.due < now ? "font-semibold text-error" : i.due - now < 2 * DAY ? "text-warn" : "text-ink-2")}>
        {i.due < now && <AlertTriangle className="size-3" />}{new Date(i.due).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
      </span>
    ) : <span className="text-ink-3">—</span>,
    updated: <span title={new Date(i.updated).toLocaleString("vi-VN")} className="text-xs whitespace-nowrap text-ink-3">{ago(i.updated)}</span>,
  };
  return (
    <tr data-id={i.id} tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,select,input")) onOpen(i); }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(i); }}
      style={tint ? { background: `color-mix(in oklch, ${PCOL[i.priority!]} ${tint}%, transparent)` } : undefined}
      className={cn("group/row cursor-pointer border-t border-rule align-middle transition-colors duration-(--dur-micro) hover:bg-paper-2 focus-visible:bg-hl-wash focus-visible:outline-none", picked && "bg-hl-wash/60", i.resolved && "text-ink-3")}>
      <td className={cn("px-3", y.dense ? "py-1" : "py-2")} onClick={(e) => { e.stopPropagation(); onPick(i.id); }}>
        <input type="checkbox" checked={picked} onChange={() => onPick(i.id)} onClick={(e) => e.stopPropagation()} aria-label={`Chọn ${i.id}`} />
      </td>
      {cols.map((k) => <td key={k} className={cn("px-2", y.dense ? "py-1" : "py-2", k === "summary" && "min-w-64")}>{cell[k]}</td>)}
    </tr>
  );
}

function BulkBar() {
  const y = useYt();
  const [as, setAs] = useState("-");
  const [busy, setBusy] = useState(false);
  const ids = [...y.picked];
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
      <select value={as} onChange={(e) => setAs(e.target.value)} aria-label="Đổi assignee cho các ticket đã chọn" className="h-[30px] rounded-md border-0 bg-board-type/15 px-2 text-sm">
        <option value="-">Assignee: giữ nguyên</option><option value="">Chưa assign</option>
        {y.people.map((p) => <option key={p.login} value={p.login}>{p.name}</option>)}
      </select>
      <Button size="sm" variant="outline" disabled={busy} aria-busy={busy} onClick={() => void apply()}>Áp dụng</Button>
      {y.aiOn && (
        <Button size="sm" variant="outline" title="AI đọc chi tiết + bình luận + tin Telegram của các ticket đã chọn: việc cần làm, nghẽn, cần chốt, cần ping ai"
          onClick={() => aiReview(y, ids, `${ids.length} ticket đã chọn`)}><Sparkles /> AI tổng hợp</Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto text-board-type hover:bg-board-type/15 hover:text-board-type" onClick={() => y.setPicked(new Set())}>Bỏ chọn</Button>
    </motion.div>
  );
}

/** One AI review over many tickets, in the side sheet. */
export function aiReview(y: ReturnType<typeof useYt>, ids: string[], scope: string, kind: "review" | "today" = "review") {
  if (!ids.length) { toast({ text: "Không có ticket nào để rà soát" }); return; }
  if (ids.length > AI_MAX) toast({ text: `Chỉ đọc ${AI_MAX} / ${ids.length} ticket đầu` });
  const n = Math.min(ids.length, AI_MAX);
  y.setSheet({ kind: "ai", title: `${kind === "today" ? "Kế hoạch hôm nay" : "Rà soát"} · ${scope}`, label: `AI đang đọc ${n} ticket`, run: (sig) => yt.aiTickets(ids.slice(0, AI_MAX), scope, kind, sig) });
}

/** A sentence becomes the regular filters (state / priority / type / người / sprint / search). */
function AiFilter() {
  const y = useYt();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    const t = text.trim();
    if (!t || busy) return;
    const uniq = (k: "state" | "priority" | "type") => [...new Set(y.rows.map((i) => i[k]).filter((v): v is string => !!v))];
    const options = { state: uniq("state"), priority: uniq("priority"), type: uniq("type"), assignee: y.peopleOptions, sprint: y.sprintOptions.slice(0, 40),
      me: y.me, current_sprint: [...period({ sprints: y.sprints, f: { ...y.filters, sprint: [] }, latestSprint: y.sprintOptions[0] ?? null, now: Date.now() }).set][0] ?? null };
    setBusy(true);
    try {
      const r = await yt.aiFilter(t, options);
      const pick = (k: keyof typeof options) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((v): v is string => typeof v === "string" && (options[k] as string[]).includes(v)) : []);
      y.setFilters({ state: pick("state"), priority: pick("priority"), type: pick("type"), assignee: pick("assignee"), sprint: pick("sprint"), q: typeof r.q === "string" ? r.q.slice(0, 100) : "", tier: null });
      setText("");
      toast({ text: "AI đã đặt bộ lọc, xem các chip bên dưới" });
    } catch (e) { toast({ text: `AI lọc lỗi: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  }
  return (
    <label className="relative min-w-56 flex-1">
      <Sparkles className={cn("pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-hl-2", busy && "animate-pulse")} aria-hidden />
      <input type="search" value={text} disabled={busy} maxLength={500} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void run(); } }}
        placeholder={busy ? "AI đang đặt bộ lọc…" : "AI lọc: vd. bug critical của tôi sprint này ↵"} aria-label="Lọc bằng câu, AI chuyển thành bộ lọc"
        className="h-9 w-full rounded-md border border-hl/40 bg-hl-wash/30 pr-2 pl-8 text-sm outline-none focus:border-hl" />
    </label>
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
      {anyFilter && <Button size="sm" variant="outline" onClick={() => y.setFilters({ q: "", tier: null, state: [], priority: [], type: [], sprint: [], assignee: [] })}><X /> Xóa bộ lọc</Button>}
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
  return (
    <div aria-label="Đang tải…" className="grid gap-3 rounded-lg bg-cotton p-4 shadow-stock">
      {[0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="h-5 animate-pulse rounded bg-paper-3" style={{ width: `${92 - k * 7}%` }} />)}
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


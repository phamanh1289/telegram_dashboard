"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { animate, AnimatePresence, motion, Reorder, useDragControls, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity } from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Hint } from "@/shared/components/ui/hint";
import { useNow } from "@/shared/hooks/use-now";
import { toast } from "@/shared/lib/notifications";
import { useT } from "@/shared/lib/i18n";
import { isString, put, readList } from "@/shared/lib/prefs";
import { cn } from "@/shared/lib/utils";
import { bucket, fmt, stateColor, stateSem, tagsOf, type Ticket, titleOf, yt, ytFieldsQuery } from "@/features/youtrack/lib/yt";
import { Person, Prio, StatePill, Tag, TypeTag } from "./bits";
import { saveTicket, useYt } from "./state";
import { useFlow } from "./workflow";

/** Board drag: one spring for lift, the slots opening / closing and the card flying into place. */
const DND = { type: "spring", stiffness: 460, damping: 36 } as const;
// grab: where the pointer holds the card (0..1 of its width / height); dock: the board's left / width, the dock centres on it; land: set on release, the column the card flies into
type Drag = { t: Ticket; from: string; w: number; h: number; grab: [number, number]; dock: [number, number]; land?: string };
const colAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-col]") ?? null;
const GHOST = "\u0000ghost";
/** order with xs put right after `from` (at the end when it isn't there). */
const after = (order: string[], from: string, xs: string[]) => { const k = order.indexOf(from); return k < 0 ? [...order, ...xs] : [...order.slice(0, k + 1), ...xs, ...order.slice(k + 1)]; };

/**
 * Columns by State (workflow order), cards dragged onto a column change the ticket's State in YouTrack.
 * Drag is pointer-driven (mouse / pen): the card lifts into a floating copy that tilts with its speed, a slot opens where it would land
 * (its place in the list order), the board scrolls at its edges, and on release the copy springs into the card's new place. Esc cancels.
 */
export function Board({ rows, onOpen }: { rows: Ticket[]; onOpen: (i: Ticket) => void }) {
  const t = useT();
  const y = useYt();
  const now = useNow();
  const still = useReducedMotion();
  const [over, setOver] = useState<string | null>(null);
  const [inDock, setInDock] = useState(false); // the pointer is over the dock (any part of it, not only a state)
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pend, setPend] = useState<{ id: string; state: string } | null>(null); // the dropped card sits in its new column while YouTrack answers
  const PER = 60;
  const [showDone, setShowDone] = useState(false); // done columns hold thousands of tickets: folded into one button
  const doneN = useMemo(() => rows.filter((i) => i.resolved).length, [rows]);
  const cols = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const i of rows) {
      if (i.resolved && !showDone) continue; const k = (pend?.id === i.id ? pend.state : i.state) || "—"; (m.get(k) ?? m.set(k, []).get(k)!).push(i); }
    return [...m].sort((a, b) => bucket(a[1][0]) - bucket(b[1][0]) || +(stateSem(a[0]) === "bad") - +(stateSem(b[0]) === "bad") || b[1].length - a[1].length);
  }, [rows, showDone, pend]);
  // columns keep their places while the same states are on the board: a drop that changes counts must not reshuffle them under the pointer
  const sig = cols.map(([s]) => s).sort().join("\n");
  const [keep, setKeep] = useState({ sig, order: cols.map(([s]) => s) });
  // mid-drop (a card landing in a column that just appeared beside its own, or leaving one empty) the others stay put, the new one stays beside it
  if (keep.sig !== sig) setKeep({ sig, order: drag
    ? after(keep.order.filter((s) => cols.some(([c]) => c === s)), drag.from, cols.map(([s]) => s).filter((s) => !keep.order.includes(s)))
    : cols.map(([s]) => s) });
  const lanes = useMemo(() => { const m = new Map(cols); return keep.sig === sig ? keep.order.map((s) => [s, m.get(s)!] as const) : cols; }, [cols, keep, sig]);
  // the user's own column order (dragged by the header), per project; states it never placed keep the default order after it
  const laneKey = `ytLanes:${y.project}`;
  const [placed, setPlaced] = useState(() => ({ key: laneKey, order: readList(laneKey, [], isString) }));
  if (placed.key !== laneKey) setPlaced({ key: laneKey, order: readList(laneKey, [], isString) });
  const ranked = useMemo(() => {
    const at = new Map(placed.order.map((s, k) => [s, k]));
    return [...lanes].sort((a, b) => (at.get(a[0]) ?? 1e9) - (at.get(b[0]) ?? 1e9));
  }, [lanes, placed]);
  const savePlaced = (order: string[]) => { setPlaced({ key: laneKey, order }); put(laneKey, JSON.stringify(order)); };
  const reorder = (next: string[]) => savePlaced([...next, ...placed.order.filter((s) => !next.includes(s))]);
  const order = useMemo(() => new Map(rows.map((i, k) => [i.id, k])), [rows]);
  const write = !y.config?.mock;
  const flow = useFlow(y.project);
  const canGo = (t: Ticket, to: string) => { const f = flow(t.state); return !f || f.includes(to); };
  const live = drag && !drag.land ? drag : null;
  // while a card is dragged, the states it can move to that have no column yet show as drop zones in a dock over the board's foot:
  // the columns never shift under the pointer; dropped on one, that state's column appears right after the card's own
  const fields = useQuery({ ...ytFieldsQuery(y.project), enabled: write && !!y.project });
  const extra = live ? (flow(live.t.state) ?? fields.data?.State ?? []).filter((s) => s !== live.t.state && !lanes.some(([c]) => c === s)) : [];
  const target = live && over && over !== live.from && over !== "—" && canGo(live.t, over) ? over : null; // where the card goes if let go now
  const blocked = !!live && !!over && over !== live.from && !target;

  // the floating copy: position, lift (0 resting → 1 picked up), tilt from horizontal speed
  const ox = useMotionValue(0), oy = useMotionValue(0), lift = useMotionValue(0), fade = useMotionValue(1);
  const px = useMotionValue(0), py = useMotionValue(0); // the pointer, where the compact chip sits
  const vx = useVelocity(ox);
  const rotate = useSpring(useTransform(() => (still ? 0 : Math.max(-7, Math.min(7, vx.get() / 260)) + lift.get() * 1.5)), { stiffness: 380, damping: 28 });
  // over a dock state the copy folds into a chip with only the ticket id (0 card → 1 chip), so the drop zone and its caption stay readable under it;
  // the card collapses into the pointer where the chip grows from, and unfolds again when the pointer leaves the zone or the card is let go
  const chip = useSpring(0, { stiffness: 460, damping: 36 });
  const onDock = !!live && extra.length > 0 && (inDock || (!!target && extra.includes(target)));
  useEffect(() => { if (still) chip.jump(onDock ? 1 : 0); else chip.set(onDock ? 1 : 0); }, [onDock, still, chip]);
  const scale = useTransform(() => (1 + 0.03 * lift.get()) * (1 - 0.75 * chip.get()));
  const cardOpacity = useTransform(() => fade.get() * (1 - chip.get()));
  const chipScale = useTransform(chip, [0, 1], [0.6, 1]);
  const boxShadow = useTransform(lift, (v) => `0 ${1 + 13 * v}px ${3 + 29 * v}px ${-5 * v}px oklch(0% 0 0 / ${0.1 + 0.14 * v}), 0 0 0 1px oklch(0% 0 0 / 0.05)`);
  const ptr = useRef({ x: 0, y: 0 });
  const board = useRef<HTMLDivElement>(null);
  const dragged = useRef(false); // the click that ends a drag must not open the ticket

  function release(to: string | null) {
    if (!drag) return;
    const tk = drag.t, ok = !!to && to !== drag.from && to !== "—" && canGo(tk, to);
    if (to && to !== drag.from && to !== "—" && !ok) toast({ text: t("Workflow của team không cho {from} → {to}", { from: tk.state ?? "—", to }) });
    setOver(null); setInDock(false);
    setDrag({ ...drag, land: ok ? to : drag.from });
    if (!ok) return;
    setPend({ id: tk.id, state: to });
    // dropped on a state from the dock: its new column keeps its place beside the source in the user's own order too
    if (!lanes.some(([c]) => c === to) && placed.order.includes(drag.from)) savePlaced(after(placed.order.filter((s) => s !== to), drag.from, [to]));
    const prev = tk.state, go = (from: Ticket, s: string) => saveTicket(y.patchTicket, from, { state: s }, () => yt.setField(tk.id, "State", s));
    void go(tk, to).then((saved) => {
      setPend(null);
      if (saved) toast({ text: `${tk.id} → ${to}`, undo: prev ? () => void go({ ...tk, state: to }, prev) : undefined });
    });
  }
  const releaseRef = useRef(release);
  useLayoutEffect(() => { releaseRef.current = release; });

  const start = useCallback((e: React.PointerEvent<HTMLElement>, t: Ticket, from: string) => {
    if (e.button !== 0 || e.pointerType === "touch") return; // touch keeps scrolling the board
    const r = e.currentTarget.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    let on = false;
    const move = (ev: PointerEvent) => {
      ptr.current = { x: ev.clientX, y: ev.clientY };
      if (!on) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        on = true;
        document.documentElement.classList.add("yt-dragging");
        ox.jump(r.left); oy.jump(r.top); lift.jump(0); fade.jump(1);
        animate(lift, 1, DND);
        const b = board.current?.getBoundingClientRect();
        setDrag({ t, from, w: r.width, h: r.height, grab: [(sx - r.left) / r.width, (sy - r.top) / r.height], dock: b ? [b.left, b.width] : [0, innerWidth] });
      }
      ox.set(ev.clientX - sx + r.left); oy.set(ev.clientY - sy + r.top); px.set(ev.clientX); py.set(ev.clientY);
    };
    const end = (ev: Event) => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); removeEventListener("keydown", esc, true);
      if (!on) return;
      document.documentElement.classList.remove("yt-dragging");
      dragged.current = true; setTimeout(() => { dragged.current = false; });
      releaseRef.current(ev.type === "pointerup" ? colAt(ptr.current.x, ptr.current.y)?.dataset.col ?? null : null);
    };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape" && on) { ev.stopPropagation(); ev.preventDefault(); end(ev); } };
    addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end); addEventListener("keydown", esc, true);
  }, [ox, oy, px, py, lift, fade]);
  const open = useCallback((i: Ticket) => { if (!dragged.current) onOpen(i); }, [onOpen]);
  useEffect(() => () => document.documentElement.classList.remove("yt-dragging"), []);

  // while dragging: which column is under the pointer, and scroll the board / that column near their edges
  useEffect(() => {
    if (!drag || drag.land) return;
    let raf = 0;
    const speed = (d: number) => (d < 56 ? Math.min(1, (56 - d) / 56) ** 2 * 18 : 0);
    const tick = () => {
      const p = ptr.current, b = board.current;
      if (b) { const r = b.getBoundingClientRect(); b.scrollLeft += speed(r.right - p.x) - speed(p.x - r.left); }
      const hit = document.elementFromPoint(p.x, p.y), col = hit?.closest<HTMLElement>("[data-col]"), ul = col?.querySelector("ul");
      if (ul) { const r = ul.getBoundingClientRect(); ul.scrollTop += speed(r.bottom - p.y) - speed(p.y - r.top); }
      setOver(col?.dataset.col ?? null);
      setInDock(!!hit?.closest("[data-dock]"));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag]);

  // released: the copy springs onto the card's new (or old) place, then hands over to it
  useLayoutEffect(() => {
    if (!drag?.land) return;
    const el = board.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(drag.t.id)}"] > button`);
    const tr = still ? { duration: 0 } : DND;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el?.getBoundingClientRect();
    const runs = r ? [animate(lift, 0, tr), animate(ox, r.left, tr), animate(oy, r.top, tr)] : [animate(fade, 0, { duration: 0.15 })];
    let done = false;
    void Promise.all(runs).then(() => { if (!done) setDrag(null); });
    return () => { done = true; runs.forEach((a) => a.stop()); };
  }, [drag, still, lift, ox, oy, fade]);

  return (
    <Reorder.Group as="div" axis="x" values={ranked.map(([s]) => s)} onReorder={reorder} ref={board} layoutScroll data-view
      className="flex gap-3 overflow-x-auto pb-2 md:max-h-[calc(100dvh-var(--yt-top)-1rem)]">
      <AnimatePresence initial={false}>
      {ranked.map(([st, list]) => {
        const shown: (Ticket | typeof GHOST)[] = list.slice(0, PER);
        if (st === target && live) {
          const at = list.findIndex((i) => order.get(i.id)! > order.get(live.t.id)!);
          shown.splice(Math.min(at < 0 ? list.length : at, PER), 0, GHOST);
        }
        const away = drag && (drag.land ? drag.land !== drag.from : !!target); // the card is leaving its column: close its old slot
        return (
          <Lane key={st} st={st} label={`${st}: ${t("{n} ticket", { n: list.length })}`}
            off={!!live && st !== live.from && (st === "—" || !canGo(live.t, st))}
            head={<><StatePill state={st} /><b className="ml-auto rounded-full bg-paper-3 px-1.5 font-mono text-xs font-medium text-ink-3">{list.length}</b></>}
            className={cn("relative flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] bg-paper-2 transition-[background-color,box-shadow,filter] duration-(--dur-short)",
              st === target && "bg-hl-wash shadow-[inset_0_0_0_2px_var(--color-hl)]")}>
            <ul className="zebra-in flex min-h-16 flex-col overflow-y-auto px-2 pb-1">
              <AnimatePresence initial={false} custom={!!drag?.land}>
                {shown.map((i) => i === GHOST ? <Slot key={GHOST} h={live!.h} open grow />
                  : drag && !drag.land && i.id === drag.t.id ? <Slot key={i.id} h={drag.h} open={!away} />
                  : <BoardCard key={i.id} i={i} now={now} col={st} write={write} hidden={!!drag?.land && i.id === drag.t.id} onOpen={open} onDown={start} />)}
              </AnimatePresence>
              {list.length > PER && <li className="px-1 pb-1 text-xs text-ink-3">{t("… và {n} ticket nữa, lọc bớt để xem", { n: list.length - PER })}</li>}
            </ul>
          </Lane>
        );
      })}
      </AnimatePresence>
      {doneN > 0 && (
        <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone} aria-label={t(showDone ? "Ẩn các cột đã xong" : "Hiện các cột đã xong")}
          className="flex w-12 shrink-0 flex-col items-center gap-2 rounded-[var(--radius-card)] bg-paper-2 py-3 text-xs font-medium text-ink-2 hover:bg-paper-3 hover:text-ink">
          <b className="font-mono font-medium tabular-nums">{fmt(doneN)}</b><span className="[writing-mode:vertical-rl]">{t(showDone ? "Ẩn đã xong" : "Đã xong")}</span>
        </button>
      )}
      {drag && createPortal(<>
        <AnimatePresence>{extra.length > 0 && <Dock key="dock" id={drag.t.id} states={extra} target={target} at={drag.dock} still={!!still} />}</AnimatePresence>
        <motion.div aria-hidden style={{ x: ox, y: oy, width: drag.w, rotate, scale, boxShadow, opacity: cardOpacity, originX: drag.grab[0], originY: drag.grab[1] }}
          className={cn("pointer-events-none fixed top-0 left-0 z-50 grid gap-1.5 rounded-[var(--radius-input)] bg-cotton py-2.5 pr-2.5 pl-3.5 transition-[outline-color] duration-(--dur-micro) outline-2 outline-transparent",
            blocked && "outline-error")}>
          <CardBody i={drag.t} now={now} bar={stateColor(drag.land ?? target ?? drag.t.state)} />
        </motion.div>
        <motion.div aria-hidden style={{ x: px, y: py, scale: chipScale, opacity: chip }}
          className="pointer-events-none fixed top-0 left-0 z-50 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cotton px-3 py-1 font-mono text-xs font-bold text-ink shadow-stock outline-2 outline-hl">
          {drag.t.id}
        </motion.div></>, document.body)}
    </Reorder.Group>
  );
}

/** While a card is dragged: its next states that have no column, as drop zones (`data-col`, found like a column) floating at the window's foot,
 *  centred on the board. Fixed to the window, not the board: the board gets shorter when the card leaves its column, the dock must not move. */
function Dock({ id, states, target, at, still }: { id: string; states: string[]; target: string | null; at: [number, number]; still: boolean }) {
  const t = useT();
  // up to 3 states a row (5 → 3 + 2), each row splitting the dock's width evenly; the dock is 20rem a state wide, narrower boards shrink every state alike
  const cols = Math.min(states.length, 3);
  return (
    <motion.div initial={{ opacity: 0, y: still ? 0 : 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: still ? 0 : 24 }} transition={DND}
      style={{ left: at[0], width: at[1] }} className="pointer-events-none fixed bottom-6 z-40 flex justify-center px-4">
      <div data-dock style={{ width: `min(100%, ${cols * 20 + (cols - 1) * 0.75 + 3}rem)` }}
        className="pointer-events-auto grid gap-4 rounded-[var(--radius-card)] bg-cotton/95 p-6 shadow-stock backdrop-blur">
        {/* the header says what letting go does: above every zone, the dragged card (under the pointer) never covers it */}
        <span className="grid px-1 text-sm">
          <span className={cn("[grid-area:1/1] text-ink-3 transition-opacity duration-(--dur-short)", target && "opacity-0")}>{t("Trạng thái chưa có cột trên board")}</span>
          <span className={cn("[grid-area:1/1] font-medium text-ink transition-opacity duration-(--dur-short)", !target && "opacity-0")}>
            {target && t("Thả ra để chuyển {id} sang {state}", { id, state: target })}</span>
        </span>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {states.map((s, k) => {
            const on = s === target;
            // the one under the card grows (its hit area too, so it stays picked while the pointer wobbles)
            return (
              <motion.div key={s} data-col={s} aria-label={s}
                initial={{ opacity: 0, y: still ? 0 : 10 }} animate={{ opacity: 1, y: still || !on ? 0 : -6, scale: still || !on ? 1 : 1.1 }}
                transition={{ ...DND, opacity: { duration: 0.2, delay: 0.04 * k }, y: { ...DND, delay: on ? 0 : 0.04 * k } }}
                className={cn("relative grid min-w-0 content-center gap-2 rounded-[var(--radius-input)] border-2 border-dashed px-6 py-7 transition-[background-color,border-color,box-shadow] duration-(--dur-short) ease-(--ease-out)",
                  on ? "z-10 border-hl bg-hl-wash shadow-stock" : "border-hl/45 bg-paper-2")}>
                <StatePill state={s} />
                <span className="truncate text-xs text-ink-3">{t("Thả vào để mở cột mới")}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

/** A Board column, dragged by its header to a new place among the others (mouse / pen; touch keeps scrolling the board).
 *  `off`: a card is being dragged and the team workflow does not let it move here; the column fades out (opacity lives in `animate`, a class would be overridden). */
function Lane({ st, off, label, head, className, children }: { st: string; off: boolean; label: string; head: React.ReactNode; className: string; children: React.ReactNode }) {
  const t = useT();
  const ctl = useDragControls();
  return (
    <Reorder.Item as="section" value={st} dragListener={false} dragControls={ctl} data-col={st} aria-label={label} aria-disabled={off || undefined}
      className={cn(className, off && "grayscale")}
      initial={{ opacity: 0 }} animate={{ opacity: off ? 0.35 : 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={DND}
      whileDrag={{ scale: 1.02, zIndex: 20, boxShadow: "0 16px 40px -12px oklch(0% 0 0 / 0.35)" }}>
      <Hint text={t("Kéo để đổi thứ tự cột")} side="bottom">
        <header onPointerDown={(e) => { if (e.button === 0 && e.pointerType !== "touch") ctl.start(e); }}
          className="sticky top-0 flex cursor-grab items-center gap-2 px-3 py-2 select-none active:cursor-grabbing">{head}</header>
      </Hint>
      {children}
    </Reorder.Item>
  );
}

/** A gap in a column: where the dragged card came from (`open` until it heads elsewhere), or where it would land (`grow`s in). */
function Slot({ h, open, grow }: { h: number; open: boolean; grow?: boolean }) {
  return (
    <motion.li aria-hidden initial={grow ? { height: 0, opacity: 0 } : false} animate={{ height: open ? h + 6 : 0, opacity: open ? 1 : 0 }} transition={DND}
      exit="gone" variants={{ gone: (instant: boolean) => ({ height: 0, opacity: 0, transition: instant ? { duration: 0 } : DND }) }} className="shrink-0 overflow-hidden">
      <div style={{ height: h }} className="rounded-[var(--radius-input)] border-2 border-dashed border-hl/45 bg-hl-wash/70" />
    </motion.li>
  );
}

/** One ticket on the board; the floating copy while dragging shows the same body. */
const BoardCard = memo(function BoardCard({ i, now, col, write, hidden, onOpen, onDown }: {
  i: Ticket; now: number; col: string; write: boolean; hidden: boolean; onOpen: (i: Ticket) => void; onDown: (e: React.PointerEvent<HTMLElement>, t: Ticket, from: string) => void;
}) {
  return (
    <li data-card={i.id} className={cn("shrink-0 pb-1.5", hidden && "opacity-0")}>
      <button type="button" onClick={() => onOpen(i)} onPointerDown={write ? (e) => onDown(e, i, col) : undefined}
        className={cn("relative grid w-full gap-1.5 rounded-[var(--radius-input)] bg-cotton py-2.5 pr-2.5 pl-3.5 text-left shadow-edge transition-[translate,box-shadow] duration-(--dur-micro) hover:-translate-y-px hover:shadow-stock",
          write && "cursor-grab select-none")}>
        <CardBody i={i} now={now} bar={stateColor(i.state)} />
      </button>
    </li>
  );
});

function CardBody({ i, now, bar }: { i: Ticket; now: number; bar: string }) {
  const t = useT();
  const tags = tagsOf(i);
  return (
    <>
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-l-[var(--radius-input)] transition-colors duration-(--dur-short)" style={{ backgroundColor: bar }} />
      <span className="flex items-center gap-2"><b className="font-mono text-xs">{i.id}</b><TypeTag type={i.type} />{i.due && i.due < now && <span className="ml-auto inline-flex items-center gap-0.5 text-xs font-bold text-error"><AlertTriangle className="size-3" />{t("quá hạn")}</span>}</span>
      {tags.length > 0 && <span className="flex flex-wrap gap-1">{tags.map((g) => <Tag key={g} name={g} />)}</span>}
      <span className={cn("line-clamp-3 text-sm leading-snug font-medium text-ink", i.resolved && "font-normal text-ink-3 line-through")}>{titleOf(i)}</span>
      <span className="flex items-center justify-between gap-2"><Prio p={i.priority} /><Person name={i.assignee} empty={t("Chưa assign")} /></span>
    </>
  );
}

"use client";

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
import { bucket, fmt, stateColor, stateSem, tagsOf, type Ticket, titleOf, yt } from "@/features/youtrack/lib/yt";
import { Person, Prio, StatePill, Tag, TypeTag } from "./bits";
import { saveTicket, useYt } from "./state";
import { useFlow } from "./workflow";

/** Board drag: one spring for lift, the slots opening / closing and the card flying into place. */
const DND = { type: "spring", stiffness: 460, damping: 36 } as const;
type Drag = { t: Ticket; from: string; w: number; h: number; land?: string }; // land: set on release, the column the card flies into
const colAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-col]") ?? null;
const GHOST = "\u0000ghost";

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
  if (keep.sig !== sig) setKeep({ sig, order: cols.map(([s]) => s) });
  const lanes = useMemo(() => { const m = new Map(cols); return keep.sig === sig ? keep.order.map((s) => [s, m.get(s)!] as const) : cols; }, [cols, keep, sig]);
  // the user's own column order (dragged by the header), per project; states it never placed keep the default order after it
  const laneKey = `ytLanes:${y.project}`;
  const [placed, setPlaced] = useState(() => ({ key: laneKey, order: readList(laneKey, [], isString) }));
  if (placed.key !== laneKey) setPlaced({ key: laneKey, order: readList(laneKey, [], isString) });
  const ranked = useMemo(() => {
    const at = new Map(placed.order.map((s, k) => [s, k]));
    return [...lanes].sort((a, b) => (at.get(a[0]) ?? 1e9) - (at.get(b[0]) ?? 1e9));
  }, [lanes, placed]);
  const reorder = (next: string[]) => {
    const order = [...next, ...placed.order.filter((s) => !next.includes(s))];
    setPlaced({ key: laneKey, order });
    put(laneKey, JSON.stringify(order));
  };
  const order = useMemo(() => new Map(rows.map((i, k) => [i.id, k])), [rows]);
  const write = !y.config?.mock;
  const flow = useFlow(y.project);
  const canGo = (t: Ticket, to: string) => { const f = flow(t.state); return !f || f.includes(to); };
  const live = drag && !drag.land ? drag : null;
  const target = live && over && over !== live.from && over !== "—" && canGo(live.t, over) ? over : null; // where the card goes if let go now
  const blocked = !!live && !!over && over !== live.from && !target;

  // the floating copy: position, lift (0 resting → 1 picked up), tilt from horizontal speed
  const ox = useMotionValue(0), oy = useMotionValue(0), lift = useMotionValue(0), fade = useMotionValue(1);
  const vx = useVelocity(ox);
  const rotate = useSpring(useTransform(() => (still ? 0 : Math.max(-7, Math.min(7, vx.get() / 260)) + lift.get() * 1.5)), { stiffness: 380, damping: 28 });
  const scale = useTransform(lift, [0, 1], [1, 1.03]);
  const boxShadow = useTransform(lift, (v) => `0 ${1 + 13 * v}px ${3 + 29 * v}px ${-5 * v}px oklch(0% 0 0 / ${0.1 + 0.14 * v}), 0 0 0 1px oklch(0% 0 0 / 0.05)`);
  const ptr = useRef({ x: 0, y: 0 });
  const board = useRef<HTMLDivElement>(null);
  const dragged = useRef(false); // the click that ends a drag must not open the ticket

  function release(to: string | null) {
    if (!drag) return;
    const tk = drag.t, ok = !!to && to !== drag.from && to !== "—" && canGo(tk, to);
    if (to && to !== drag.from && to !== "—" && !ok) toast({ text: t("Workflow của team không cho {from} → {to}", { from: tk.state ?? "—", to }) });
    setOver(null);
    setDrag({ ...drag, land: ok ? to : drag.from });
    if (!ok) return;
    setPend({ id: tk.id, state: to });
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
        setDrag({ t, from, w: r.width, h: r.height });
      }
      ox.set(ev.clientX - sx + r.left); oy.set(ev.clientY - sy + r.top);
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
  }, [ox, oy, lift, fade]);
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
      const col = colAt(p.x, p.y), ul = col?.querySelector("ul");
      if (ul) { const r = ul.getBoundingClientRect(); ul.scrollTop += speed(r.bottom - p.y) - speed(p.y - r.top); }
      setOver(col?.dataset.col ?? null);
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
      {ranked.map(([st, list]) => {
        const shown: (Ticket | typeof GHOST)[] = list.slice(0, PER);
        if (st === target && live) {
          const at = list.findIndex((i) => order.get(i.id)! > order.get(live.t.id)!);
          shown.splice(Math.min(at < 0 ? list.length : at, PER), 0, GHOST);
        }
        const away = drag && (drag.land ? drag.land !== drag.from : !!target); // the card is leaving its column: close its old slot
        return (
          <Lane key={st} st={st} label={`${st}: ${t("{n} ticket", { n: list.length })}`}
            head={<><StatePill state={st} /><b className="ml-auto rounded-full bg-paper-3 px-1.5 font-mono text-xs font-medium text-ink-3">{list.length}</b></>}
            className={cn("relative flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] bg-paper-2 transition-[background-color,box-shadow,opacity] duration-(--dur-short)",
              st === target && "bg-hl-wash shadow-[inset_0_0_0_2px_var(--color-hl)]",
              live && st !== live.from && st !== "—" && !canGo(live.t, st) && "opacity-40")}>
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
      {doneN > 0 && (
        <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone} aria-label={t(showDone ? "Ẩn các cột đã xong" : "Hiện các cột đã xong")}
          className="flex w-12 shrink-0 flex-col items-center gap-2 rounded-[var(--radius-card)] bg-paper-2 py-3 text-xs font-medium text-ink-2 hover:bg-paper-3 hover:text-ink">
          <b className="font-mono font-medium tabular-nums">{fmt(doneN)}</b><span className="[writing-mode:vertical-rl]">{t(showDone ? "Ẩn đã xong" : "Đã xong")}</span>
        </button>
      )}
      {drag && createPortal(
        <motion.div aria-hidden style={{ x: ox, y: oy, width: drag.w, rotate, scale, boxShadow, opacity: fade }}
          className={cn("pointer-events-none fixed top-0 left-0 z-50 grid origin-center gap-1.5 rounded-[var(--radius-input)] bg-cotton py-2.5 pr-2.5 pl-3.5 transition-[outline-color] duration-(--dur-micro) outline-2 outline-transparent",
            blocked && "outline-error")}>
          <CardBody i={drag.t} now={now} bar={stateColor(drag.land ?? target ?? drag.t.state)} />
        </motion.div>, document.body)}
    </Reorder.Group>
  );
}

/** A Board column, dragged by its header to a new place among the others (mouse / pen; touch keeps scrolling the board). */
function Lane({ st, label, head, className, children }: { st: string; label: string; head: React.ReactNode; className: string; children: React.ReactNode }) {
  const t = useT();
  const ctl = useDragControls();
  return (
    <Reorder.Item as="section" value={st} dragListener={false} dragControls={ctl} data-col={st} aria-label={label} className={className}
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

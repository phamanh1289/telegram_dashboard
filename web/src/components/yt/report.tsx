"use client";

import { ChevronDown, ChevronUp, Download, FileDown, FileText, Printer, RotateCw, Sheet, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast, useNow } from "@/lib/inbox";
import { getPref, onPrefs, readReportAt, setPref, YT_ROLES } from "@/lib/prefs";
import { cn, downloadCsv, downloadText } from "@/lib/utils";
import { type AiReq, bucket, bugSpike, DAY, isBug, QUICK, rank, type Ticket, when, yt } from "@/lib/yt";
import { reportData } from "@/lib/yt-stats";
import { AiBox, Card, Markdown, Menu, useAi } from "./bits";
import { useQc, useStats } from "./dashboard";
import { useYt } from "./state";

// The release report: written by the AI from the dashboard's own figures, for the role picked in Settings and the project
// picked on the left. Writes itself once a day at the time set in Settings › YouTrack (while the page is open; a missed
// time runs on the next open that day). Kept per browser, per project / role / day; exported as MD, PDF (print) or CSV.

const ymd = (t: number) => new Date(t).toLocaleDateString("sv");
const day0 = (s: string) => +new Date(`${s}T00:00`);
/** Mon-Fri days after today, up to and including the release day. */
function workDays(now: number, release: string) {
  let n = 0;
  for (let t = day0(ymd(now)) + DAY; t <= day0(release); t += DAY) { const w = new Date(t).getDay(); if (w && w < 6) n++; }
  return n;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
type Saved = { text: string; at: number; release: string; req?: AiReq | null };

export function ReportCard() {
  const y = useYt();
  const d = useStats();
  const qc = useQc();
  const now = useNow();
  const ai = useAi();
  const at = useSyncExternalStore(onPrefs, () => getPref("ytReportAt") ?? "", () => "");
  const sched = useMemo(() => readReportAt(), [at]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read on change
  const relKey = `ytRelease:${y.project}`;
  // default release day: the end of the sprint(s) being viewed
  const sprintEnd = Math.max(0, ...[...d.per.set].map((n) => y.sprints.get(n)?.finish ?? 0));
  const relPref = useSyncExternalStore(onPrefs, () => getPref(relKey) ?? "", () => "");
  const release = relPref || (sprintEnd ? ymd(sprintEnd) : ymd(now + 7 * DAY));
  const key = `ytReport:${y.project}:${y.mode}:${ymd(now)}`;
  const [ver, setVer] = useState(0);
  const [full, setFull] = useState(false); // a long report stays folded on the home page
  const saved = useMemo(() => { try { return JSON.parse(getPref(key) ?? "null") as Saved | null; } catch { return null; } }, [key, ver]); // eslint-disable-line react-hooks/exhaustive-deps -- ver re-reads
  const busy = ai.s.status === "busy";
  const role = YT_ROLES.find(([r]) => r === y.mode)?.[1] ?? y.mode;
  const title = `Báo cáo ${y.project} · ${role} · ${ymd(saved?.at ?? now)}`;

  // the tickets the report names, also the CSV
  const lists = useMemo(() => {
    const open = y.rows.filter((i) => !i.resolved);
    const q = (k: string) => open.filter((i) => QUICK[k].fn(i, now));
    return [
      ["Chưa tới QC (sprint)", d.sprintOpen.filter((i) => bucket(i) < 2).sort((a, b) => rank(a) - rank(b))],
      ["Chờ test", open.filter((i) => bucket(i) === 2)],
      ["Bị bỏ quên", q("stale")], ["Quá hạn", q("overdue")], ["Blocked", q("blocked")],
      ["Bug Critical / Highest", open.filter((i) => isBug(i) && rank(i) <= 1)],
      ["Bị QC trả lại / reopen", qc.pong.map((x) => x.i)],
    ] as [string, Ticket[]][];
  }, [y.rows, d.sprintOpen, qc.pong, now]);

  function data() {
    const brief = (i: Ticket) => `${i.id}: ${(i.summary ?? "").slice(0, 80)} [${i.state ?? "—"}${i.assignee ? `, ${i.assignee}` : ""}]`;
    const L = Object.fromEntries(lists);
    const spike = bugSpike(y.rows, now);
    return {
      ...reportData(d, y.wip), role: y.mode, me: y.me,
      release: { date: release, daysLeft: workDays(now, release) },
      handoff: { notYetInQc: L["Chưa tới QC (sprint)"].length, inQcNow: d.sprintOpen.filter((i) => bucket(i) === 2).length, closedPerDay: d.burn ? +d.burn.rate.toFixed(2) : null,
        tickets: L["Chưa tới QC (sprint)"].slice(0, 25).map(brief) },
      stuckByState: Object.fromEntries(d.aging.states.slice(0, 10)),
      forgotten: L["Bị bỏ quên"].slice(0, 15).map(brief),
      qcResult: qc.q.data ? { tested: qc.tested, firstPass: qc.firstPass, pass: qc.pass.length, returned: qc.fail.length, reopened: qc.reopen.length,
        bounced: qc.pong.slice(0, 10).map((x) => `${x.i.id}: trả lại ${x.n} lần${x.re ? ", reopen" : ""}`) } : "chưa đọc được lịch sử state",
      qaQueue: { waitingTest: L["Chờ test"].length, noQc: L["Chờ test"].filter((i) => !i.qc).length, criticalBugs: L["Bug Critical / Highest"].slice(0, 15).map(brief) },
      bugSpike: { new7d: spike.n, weeklyAvgBefore: spike.avg, spike: spike.spike, modules: Object.fromEntries(spike.mods) },
    };
  }

  const keep = (text: string, req: AiReq | null, rel = release) => { setPref(key, JSON.stringify({ text, at: Date.now(), release: rel, req } satisfies Saved)); setVer((n) => n + 1); };
  const run = (sig: AbortSignal) => yt.aiData("release", data(), sig);
  /** The scheduled run: in the background, here. */
  async function go() {
    const r = await ai.run({ label: "AI đang viết báo cáo", run });
    if (r?.text) keep(r.text, r.req);
    ai.cancel(); // the saved copy is shown (and exported) from here on
  }
  /** A click: the AI session, where it can be followed up; the answer is kept here for the exports. */
  const open = (fresh: boolean) => { const rel = release; y.setSheet({ kind: "work", title: `AI · ${title}`, ids: [], auto: {
    label: "AI đang viết báo cáo", run, seed: !fresh && saved ? { text: saved.text, req: saved.req ?? null } : undefined, onDone: (r) => keep(r.text, r.req, rel),
  } }); };

  // the schedule: once a day, on picked weekdays, after the picked time; one try per day and key (an error is not retried)
  const tried = useRef("");
  const hhmm = new Date(now).toTimeString().slice(0, 5);
  const due = sched.on && sched.days.includes((new Date(now).getDay() + 6) % 7) && hhmm >= sched.time;
  const ready = y.aiOn && !y.config?.mock && y.rows.length > 0 && !qc.q.isLoading;
  useEffect(() => {
    if (due && ready && !saved && !busy && tried.current !== key) { tried.current = key; void go(); }
  }); // no deps: checked every render (useNow ticks each minute); `tried` keeps it to one run a day

  const view = useRef<HTMLDivElement>(null);
  const file = `bao-cao-${y.project}-${y.mode}-${ymd(saved?.at ?? now)}`;
  const md = () => `# ${title}\n\nRelease: ${saved!.release} · tạo lúc ${when(saved!.at)}\n\n${saved!.text}\n`;
  function pdf() {
    const w = window.open("", "_blank");
    if (!w) { toast({ text: "Trình duyệt chặn cửa sổ in, cho phép popup rồi thử lại" }); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(file)}</title><style>body{font:14px/1.55 system-ui,sans-serif;max-width:46rem;margin:2rem auto;color:#111}h1{font-size:1.3rem}button{all:unset}ul{padding-left:1.2rem}</style><h1>${esc(title)}</h1><p>Release: ${esc(saved!.release)} · tạo lúc ${esc(when(saved!.at))}</p>${view.current?.innerHTML ?? ""}`);
    w.document.close();
    w.focus();
    w.print(); // "Save as PDF" in the print dialog
  }
  function csv() {
    const s = data();
    const metrics: [string, unknown][] = [["Sprint", s.sprint], ["Ngày release", s.release.date], ["Ngày làm việc còn lại", s.release.daysLeft], ["Ticket sprint", s.tickets],
      ["Tỷ lệ xong (%)", s.doneRatePct], ["Chưa tới QC", s.handoff.notYetInQc], ["Đang chờ test", s.qaQueue.waitingTest], ["Chưa có QC", s.qaQueue.noQc],
      ["Bug mới 7 ngày", s.bugSpike.new7d], ["Bug TB/tuần trước đó", s.bugSpike.weeklyAvgBefore],
      ...(typeof s.qcResult === "object" ? [["QC pass", s.qcResult.pass], ["QC trả lại", s.qcResult.returned], ["Reopen", s.qcResult.reopened]] as [string, unknown][] : [])];
    downloadCsv([["Mục", "Chỉ số / ID", "Tiêu đề", "State", "Assignee", "QC", "Giá trị"],
      ...metrics.map(([k, v]) => ["Số liệu", k, "", "", "", "", v]),
      ...lists.flatMap(([sec, l]) => l.map((i) => [sec, i.id, i.summary, i.state, i.assignee, i.qc, i.due ? new Date(i.due).toLocaleDateString("vi-VN") : ""]))], `${file}.csv`);
  }

  const left = workDays(now, release);
  const stale = !!saved && saved.release !== release;
  const can = y.aiOn && !y.config?.mock && y.rows.length > 0;
  // the figures the report is written from; a number opens its tickets
  const stats = lists.filter(([k]) => k !== "Bị QC trả lại / reopen" || qc.q.data);
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><FileText className="size-4 text-hl-2" />Báo cáo release</span>}
      meta={sched.on ? `Tự tạo ${sched.days.length === 5 && !sched.days.includes(5) && !sched.days.includes(6) ? "T2–T6" : `${sched.days.length} ngày/tuần`} lúc ${sched.time}` : "Tự tạo: tắt"} className="border border-hl/25">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-paper-2 p-3">
        <div className="grid leading-tight">
          <span className={cn("font-mono text-2xl font-semibold tabular-nums", left <= 2 ? "text-error" : left <= 5 ? "text-warn" : "text-ink")}>{left}</span>
          <span className="text-xs text-ink-3">ngày làm việc còn lại</span>
        </div>
        <label className="grid gap-0.5 text-xs text-ink-3">Ngày release{!relPref && sprintEnd ? " (cuối sprint)" : ""}
          <Input type="date" className="h-8 w-40" value={release} onChange={(e) => setPref(relKey, e.target.value || null)} aria-label="Ngày release" />
        </label>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-3" aria-label="Số liệu báo cáo">
        {stats.map(([k, l]) => (
          <button key={k} type="button" disabled={!l.length} onClick={() => y.setSheet({ kind: "list", title: k, rows: l })} title={l.length ? `Xem ${l.length} ticket` : undefined}
            className="flex items-baseline justify-between gap-2 border-b border-rule/60 px-1 py-1.5 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2 disabled:pointer-events-none">
            <span className="truncate text-xs text-ink-2">{k}</span>
            <span className={cn("font-mono text-sm font-semibold tabular-nums", !l.length ? "text-ink-3" : /Quá hạn|Blocked|Critical/.test(k) ? "text-error" : "text-ink")}>{l.length}</span>
          </button>
        ))}
      </div>

      {saved && !busy ? (
        <div className="grid gap-2">
          <p className="text-xs text-ink-3">Viết lúc {when(saved.at)} · cho release {saved.release}</p>
          <div className={cn("relative", !full && "max-h-72 overflow-hidden")}>
            <div ref={view}><Markdown text={saved.text} onTicket={(i) => y.openTicket(i)} /></div>
            {!full && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-cotton" />}
          </div>
          <Button size="xs" variant="ghost" className="justify-self-start" onClick={() => setFull(!full)}>{full ? <><ChevronUp /> Thu gọn</> : <><ChevronDown /> Xem đầy đủ</>}</Button>
          {stale && <p className="text-xs text-warn">Báo cáo viết cho ngày release {saved.release}; bấm Tạo lại để tính theo {release}.</p>}
        </div>
      ) : ai.s.status === "idle" && (
        <p className="text-sm text-ink-2">AI đọc các số liệu trên: kịp release không, ticket nào chưa bàn giao được cho QC, đang stuck ở đâu, kết quả test, việc trễ, ai quá tải, bug.{y.config?.mock ? " Cần token YouTrack." : ""}</p>
      )}
      <AiBox ai={ai} ask={false} />

      <div className="flex flex-wrap items-center gap-1.5">
        {saved && !busy && <Button size="sm" onClick={() => open(false)}><Sparkles /> Mở phiên AI</Button>}
        <Button size="sm" variant={saved && !stale ? "outline" : "default"} disabled={busy || !can} aria-busy={busy} onClick={() => open(true)}>
          {saved ? <><RotateCw /> Tạo lại</> : <><Sparkles /> Tạo báo cáo</>}
        </Button>
        {saved && !busy && <div className="ml-auto"><Menu align="right" title="Tải báo cáo" label={<span className="inline-flex items-center gap-1.5"><Download className="size-4" />Xuất</span>} items={[
          { label: <><FileDown /> Markdown (.md)</>, on: () => downloadText(md(), `${file}.md`) },
          { label: <><Printer /> PDF</>, hint: "Mở bản in, chọn Lưu dạng PDF", on: pdf },
          { label: <><Sheet /> CSV</>, hint: "Số liệu và danh sách ticket theo mục", on: csv },
        ]} /></div>}
      </div>
    </Card>
  );
}

"use client";

import { ChevronDown, ChevronUp, Download, FileDown, FileText, Printer, RotateCw, Sheet, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { fmtClock, fmtDate, fmtDay, type Key, useT } from "@/lib/i18n";
import { toast, useNow } from "@/lib/inbox";
import { ymd } from "@/lib/time";
import { getPref, onPrefs, put, readReportAt, setPref, YT_ROLES } from "@/lib/prefs";
import { cn, downloadCsv, downloadText } from "@/lib/utils";
import { type AiReq, bucket, bugSpike, DAY, inTest, isBug, isBuilt, QUICK, rank, type Ticket, when, yt } from "@/lib/yt";
import { reportData } from "@/lib/yt-stats";
import { AiBox, Card, Markdown, Menu, useAi } from "./bits";
import { useQc, useStats } from "./dashboard";
import { useHistory } from "./history";
import { useYt } from "./state";

// The release report: written by the AI from the dashboard's own figures, for the role picked in Settings and the project
// picked on the left. Two scopes: by sprint (every ticket of the sprint(s) being viewed, against the release day) or by day
// (a snapshot as of now: tested, in test, waiting for test). Writes itself once a day at the time set in Settings › YouTrack (while the page is open; a missed
// time runs on the next open that day). Kept per browser, per project / role / day; exported as MD, PDF (print) or CSV.

const day0 = (s: string) => +new Date(`${s}T00:00`);
/** Mon-Fri days after today, up to and including the release day. */
export function workDays(now: number, release: string) {
  let n = 0;
  for (let t = day0(ymd(now)) + DAY; t <= day0(release); t += DAY) { const w = new Date(t).getDay(); if (w && w < 6) n++; }
  return n;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
type Saved = { text: string; at: number; release: string; req?: AiReq | null };
type By = "sprint" | "day";

export function ReportCard() {
  const y = useYt();
  const t = useT();
  const d = useStats();
  const qc = useQc();
  const now = useNow();
  const at = useSyncExternalStore(onPrefs, () => getPref("ytReportAt") ?? "", () => "");
  const sched = useMemo(() => readReportAt(), [at]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read on change
  const relKey = `ytRelease:${y.project}`;
  // default release day: the end of the sprint(s) being viewed
  const sprintEnd = Math.max(0, ...[...d.per.set].map((n) => y.sprints.get(n)?.finish ?? 0));
  const relPref = useSyncExternalStore(onPrefs, () => getPref(relKey) ?? "", () => "");
  const release = relPref || (sprintEnd ? ymd(sprintEnd) : ymd(now + 7 * DAY));
  const by: By = useSyncExternalStore(onPrefs, () => getPref("ytReportBy") ?? "", () => "") === "day" ? "day" : "sprint";
  const key = `ytReport:${y.project}:${y.mode}:${ymd(now)}${by === "day" ? ":day" : ""}`;
  const [ver, setVer] = useState(0);
  const [full, setFull] = useState(false); // a long report stays folded on the home page
  const saved = useMemo(() => { try { return JSON.parse(getPref(key) ?? "null") as Saved | null; } catch { return null; } }, [key, ver]); // eslint-disable-line react-hooks/exhaustive-deps -- ver re-reads
  const name = YT_ROLES.find(([r]) => r === y.mode)?.[1], role = name ? t(name) : y.mode;
  const title = t("Báo cáo {p} · {r} · {d}", { p: y.project, r: role, d: ymd(saved?.at ?? now) });
  const ai = useAi(useHistory(`AI · ${title}`, []).onTurn); // the scheduled run is in the history too, to follow up
  const busy = ai.s.status === "busy";

  // the tickets the report names, also the CSV
  const lists = useMemo(() => {
    const open = y.rows.filter((i) => !i.resolved);
    const q = (k: string) => open.filter((i) => QUICK[k].fn(i, now));
    if (by === "day") {
      // passed QC: built / waiting release now, or closed after a QC pass (verdicts cover the picked range)
      const done = new Map([...open.filter(isBuilt), ...qc.tickets(qc.pass).filter((i) => i.resolved)].map((i) => [i.id, i]));
      return [
        ["Đã test xong", [...done.values()]],
        ["Đang test", open.filter(inTest)],
        ["Chờ test", open.filter((i) => bucket(i) === 2 && !inTest(i) && !isBuilt(i))],
        ["Bị QC trả lại / reopen", qc.pong.map((x) => x.i)],
      ] as [Key, Ticket[]][];
    }
    return [
      ["Ticket trong sprint", d.sprintRows],
      ["Chưa tới QC (sprint)", d.sprintOpen.filter((i) => bucket(i) < 2).sort((a, b) => rank(a) - rank(b))],
      ["Chờ test", open.filter((i) => bucket(i) === 2)],
      ["Bị bỏ quên", q("stale")], ["Quá hạn", q("overdue")], ["Blocked", q("blocked")],
      ["Bug Critical / Highest", open.filter((i) => isBug(i) && rank(i) <= 1)],
      ["Bị QC trả lại / reopen", qc.pong.map((x) => x.i)],
    ] as [Key, Ticket[]][];
  }, [by, y.rows, d.sprintRows, d.sprintOpen, qc, now]);

  function data() {
    const brief = (i: Ticket) => `${i.id}: ${(i.summary ?? "").slice(0, 80)} [${i.state ?? "—"}${i.assignee ? `, ${i.assignee}` : ""}]`;
    const L = Object.fromEntries(lists);
    const qcResult = qc.q.data ? { tested: qc.tested, firstPass: qc.firstPass, pass: qc.pass.length, returned: qc.fail.length, reopened: qc.reopen.length,
      bounced: qc.pong.slice(0, 10).map((x) => `${x.i.id}: trả lại ${x.n} lần${x.re ? ", reopen" : ""}`) } : "chưa đọc được lịch sử state";
    if (by === "day") {
      const part = (k: string) => ({ n: L[k].length, noQc: L[k].filter((i) => !i.qc).length, tickets: L[k].slice(0, 40).map(brief) });
      return { by, asOf: fmtDate(now), role: y.mode, me: y.me,
        testedDone: part("Đã test xong"), testing: part("Đang test"), waitingTest: part("Chờ test"), qcResult };
    }
    const spike = bugSpike(y.rows, now);
    return {
      by, ...reportData(d, y.wip), role: y.mode, me: y.me,
      sprintTickets: { n: d.sprintRows.length, byState: d.sprintRows.reduce<Record<string, number>>((m, i) => { const k = i.state ?? "—"; m[k] = (m[k] || 0) + 1; return m; }, {}),
        tickets: d.sprintRows.slice(0, 80).map(brief) },
      release: { date: release, daysLeft: workDays(now, release) },
      handoff: { notYetInQc: L["Chưa tới QC (sprint)"].length, inQcNow: d.sprintOpen.filter((i) => bucket(i) === 2).length, closedPerDay: d.burn ? +d.burn.rate.toFixed(2) : null,
        tickets: L["Chưa tới QC (sprint)"].slice(0, 25).map(brief) },
      stuckByState: Object.fromEntries(d.aging.states.slice(0, 10)),
      forgotten: L["Bị bỏ quên"].slice(0, 15).map(brief),
      qcResult,
      qaQueue: { waitingTest: L["Chờ test"].length, noQc: L["Chờ test"].filter((i) => !i.qc).length, criticalBugs: L["Bug Critical / Highest"].slice(0, 15).map(brief) },
      bugSpike: { new7d: spike.n, weeklyAvgBefore: spike.avg, spike: spike.spike, modules: Object.fromEntries(spike.mods) },
    };
  }

  const keep = (text: string, req: AiReq | null, rel = by === "day" ? "" : release) => { setPref(key, JSON.stringify({ text, at: Date.now(), release: rel, req } satisfies Saved)); setVer((n) => n + 1); };
  const run = (sig: AbortSignal) => yt.aiData("release", data(), sig);
  /** The scheduled run: in the background, here. */
  async function go() {
    const r = await ai.run({ label: t("AI đang viết báo cáo"), run });
    if (r?.text) keep(r.text, r.req);
    ai.cancel(); // the saved copy is shown (and exported) from here on
  }
  /** A click: the AI session, where it can be followed up; the answer is kept here for the exports. */
  const open = (fresh: boolean) => { const rel = by === "day" ? "" : release; y.setSheet({ kind: "work", title: `AI · ${title}`, ids: [], auto: {
    label: t("AI đang viết báo cáo"), run, seed: !fresh && saved ? { text: saved.text, req: saved.req ?? null } : undefined, onDone: (r) => keep(r.text, r.req, rel),
  } }); };

  // the schedule: once a day, on picked weekdays, after the picked time; one try per day and key (an error is not retried),
  // kept in localStorage: this card remounts on every page switch and a reload must not start another paid run either
  const hhmm = new Date(now).toTimeString().slice(0, 5);
  const due = sched.on && sched.days.includes((new Date(now).getDay() + 6) % 7) && hhmm >= sched.time;
  const ready = y.aiOn && !y.config?.mock && y.rows.length > 0 && !qc.q.isLoading;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting the scheduled run is this effect's job
    if (due && ready && !saved && !busy && getPref("ytReportTried") !== key) { put("ytReportTried", key); void go(); }
  }); // no deps: checked every render (useNow ticks each minute); the stored key keeps it to one run a day

  const view = useRef<HTMLDivElement>(null);
  const file = `bao-cao-${y.project}-${y.mode}-${ymd(saved?.at ?? now)}`;
  const scope = (x: Saved) => (x.release ? `Release: ${x.release}` : t("Tình trạng test tính tới lúc tạo"));
  const md = () => `# ${title}\n\n${scope(saved!)} · ${t("tạo lúc {w}", { w: when(saved!.at) })}\n\n${saved!.text}\n`;
  function pdf() {
    const w = window.open("", "_blank");
    if (!w) { toast({ text: t("Trình duyệt chặn cửa sổ in, cho phép popup rồi thử lại") }); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(file)}</title><style>body{font:14px/1.55 system-ui,sans-serif;max-width:46rem;margin:2rem auto;color:#111}h1{font-size:1.3rem}button{all:unset}ul{padding-left:1.2rem}</style><h1>${esc(title)}</h1><p>${esc(scope(saved!))} · ${esc(t("tạo lúc {w}", { w: when(saved!.at) }))}</p>${view.current?.innerHTML ?? ""}`);
    w.document.close();
    w.focus();
    w.print(); // "Save as PDF" in the print dialog
  }
  function csv() {
    const s = data();
    const metrics: [string, unknown][] = s.by === "day" ? [[t("Tính tới"), s.asOf], ...lists.map(([k, l]) => [t(k), l.length] as [string, unknown])] : [["Sprint", s.sprint], [t("Ngày release"), s.release.date], [t("Ngày làm việc còn lại"), s.release.daysLeft], [t("Ticket sprint"), s.tickets],
      [t("Tỷ lệ xong (%)"), s.doneRatePct], [t("Chưa tới QC"), s.handoff.notYetInQc], [t("Đang chờ test"), s.qaQueue.waitingTest], [t("Chưa có QC"), s.qaQueue.noQc],
      [t("Bug mới 7 ngày"), s.bugSpike.new7d], [t("Bug TB/tuần trước đó"), s.bugSpike.weeklyAvgBefore],
      ...(typeof s.qcResult === "object" ? [["QC pass", s.qcResult.pass], [t("QC trả lại"), s.qcResult.returned], ["Reopen", s.qcResult.reopened]] as [string, unknown][] : [])];
    downloadCsv([[t("Mục|cột"), t("Chỉ số / ID"), t("Tiêu đề"), "State", "Assignee", "QC", t("Giá trị")],
      ...metrics.map(([k, v]) => [t("Số liệu"), k, "", "", "", "", v]),
      ...lists.flatMap(([sec, l]) => l.map((i) => [t(sec), i.id, i.summary, i.state, i.assignee, i.qc, i.due ? fmtDay(i.due) : ""]))], `${file}.csv`);
  }

  const left = workDays(now, release);
  const stale = by === "sprint" && !!saved && saved.release !== release;
  const can = y.aiOn && !y.config?.mock && y.rows.length > 0;
  // the figures the report is written from; a number opens its tickets
  const stats = lists.filter(([k]) => k !== "Bị QC trả lại / reopen" || qc.q.data);
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><FileText className="size-4 text-hl-2" />{t("Tạo báo cáo")}</span>}
      meta={sched.on ? t("Tự tạo {d} lúc {h}", { d: sched.days.length === 5 && !sched.days.includes(5) && !sched.days.includes(6) ? t("T2–T6") : t("{n} ngày/tuần", { n: sched.days.length }), h: sched.time }) : t("Tự tạo: tắt")} className="border border-hl/25">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-paper-2 p-3">
        <Segmented id="yt-report-by" label={t("Phạm vi báo cáo")} value={by} onChange={(v) => setPref("ytReportBy", v === "day" ? "day" : null)} items={[
          { value: "sprint", label: t("Theo sprint"), title: t("Mọi ticket trong sprint đang xem, so với ngày release") },
          { value: "day", label: t("Theo ngày"), title: t("Tính tới hiện tại: ticket đã test xong, đang test, chờ test") },
        ]} />
        {by === "day" ? <span className="text-xs text-ink-3">{t("Tính tới {h} hôm nay", { h: fmtClock(now) })}</span> : <>
        <div className="grid leading-tight">
          <span className={cn("font-mono text-2xl font-bold tabular-nums", left <= 2 ? "text-error" : left <= 5 ? "text-warn" : "text-ink")}>{left}</span>
          <span className="text-xs text-ink-3">{t("ngày làm việc còn lại")}</span>
        </div>
        <label className="grid gap-0.5 text-xs text-ink-3">{t("Ngày release")}{!relPref && sprintEnd ? ` (${t("cuối sprint")})` : ""}
          <Input type="date" className="h-8 w-40" value={release} onChange={(e) => setPref(relKey, e.target.value || null)} aria-label={t("Ngày release")} />
        </label></>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-3" aria-label={t("Số liệu báo cáo")}>
        {stats.map(([k, l]) => (
          <button key={k} type="button" disabled={!l.length} onClick={() => y.setSheet({ kind: "list", title: t(k), rows: l })} aria-label={t(l.length ? "{x}: {n} ticket, bấm để xem" : "{x}: {n} ticket", { x: t(k), n: l.length })}
            className="flex items-baseline justify-between gap-2 border-b border-rule/60 px-1 py-1.5 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2 disabled:pointer-events-none">
            <span className="truncate text-xs text-ink-2">{t(k)}</span>
            <span className={cn("font-mono text-sm font-bold tabular-nums", !l.length ? "text-ink-3" : /Quá hạn|Blocked|Critical/.test(k) ? "text-error" : "text-ink")}>{l.length}</span>
          </button>
        ))}
      </div>

      {saved && !busy ? (
        <div className="grid gap-2">
          <p className="text-xs text-ink-3">{t("Viết lúc {w}, {x}", { w: when(saved.at), x: saved.release ? t("cho release {r}", { r: saved.release }) : t("tình trạng test tính tới lúc viết") })}</p>
          <div className={cn("relative", !full && "max-h-72 overflow-hidden")}>
            <div ref={view}><Markdown text={saved.text} onTicket={(i) => y.openTicket(i)} /></div>
            {!full && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-cotton" />}
          </div>
          <Button size="xs" variant="ghost" className="justify-self-start" onClick={() => setFull(!full)}>{full ? <><ChevronUp /> {t("Thu gọn")}</> : <><ChevronDown /> {t("Xem đầy đủ")}</>}</Button>
          {stale && <p className="text-xs text-warn">{t("Báo cáo viết cho ngày release {a}; bấm Tạo lại để tính theo {b}.", { a: saved.release, b: release })}</p>}
        </div>
      ) : ai.s.status === "idle" && (
        <p className="text-sm text-ink-2">{t(by === "day" ? "AI đọc các số liệu trên: ticket nào đã test xong, đang test, chờ test, ai đang giữ, cái gì cần đẩy." : "AI đọc các số liệu trên: kịp release không, ticket nào chưa bàn giao được cho QC, đang stuck ở đâu, kết quả test, việc trễ, ai quá tải, bug.")}{y.config?.mock ? ` ${t("Cần token YouTrack.")}` : ""}</p>
      )}
      <AiBox ai={ai} />

      <div className="flex flex-wrap items-center gap-1.5">
        {saved && !busy && <Button size="sm" onClick={() => open(false)}><Sparkles /> {t("Mở phiên AI")}</Button>}
        <Button size="sm" variant={saved && !stale ? "outline" : "default"} disabled={busy || !can} aria-busy={busy} onClick={() => open(true)}>
          {saved ? <><RotateCw /> {t("Tạo lại")}</> : <><Sparkles /> {t("Tạo báo cáo")}</>}
        </Button>
        {saved && !busy && <div className="ml-auto"><Menu align="right" title={t("Tải báo cáo")} label={<span className="inline-flex items-center gap-1.5"><Download className="size-4" />{t("Xuất")}</span>} items={[
          { label: <><FileDown /> Markdown (.md)</>, on: () => downloadText(md(), `${file}.md`) },
          { label: <><Printer /> PDF</>, hint: t("Mở bản in, chọn Lưu dạng PDF"), on: pdf },
          { label: <><Sheet /> CSV</>, hint: t("Số liệu và danh sách ticket theo mục"), on: csv },
        ]} /></div>}
      </div>
    </Card>
  );
}

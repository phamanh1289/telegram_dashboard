"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, Search, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNow } from "@/lib/inbox";
import { getPref, setPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AI_MAX, bucket, DAY, isBlocked, norm, shortName, type Ticket, UNASSIGNED, when, yt } from "@/lib/yt";
import { Avatar, Card, Prio, StatePill } from "./bits";
import { useYt } from "./state";

// One person's work: figures for a period, their tickets, and an AI that answers your own prompt about them.

const PRESETS = [
  ["Tóm tắt công việc", (n: string, d: number) => `Tóm tắt công việc của ${n} trong ${d} ngày qua: đang làm gì, đã xong gì, việc tiếp theo, chỗ đang kẹt hoặc chờ người khác.`],
  ["Review", (n: string) => `Review công việc của ${n}: chất lượng ticket (mô tả, bình luận cập nhật tiến độ), tiến độ so với hạn và sprint, ticket kéo dài hoặc chuyển sprint nhiều lần, rủi ro. Đề xuất cụ thể theo ID.`],
  ["Đánh giá", (n: string, d: number) => `Đánh giá công việc của ${n} trong ${d} ngày qua: khối lượng, tốc độ (lead time), độ ổn định (bug, ticket mở lại), mức độ cập nhật trên ticket. Nêu điểm mạnh, điểm cần cải thiện, mỗi ý kèm căn cứ.`],
  ["Chuẩn bị 1-1", (n: string) => `Gợi ý nội dung buổi 1-1 với ${n}: việc đáng ghi nhận, vấn đề cần hỏi, chỗ có thể cần hỗ trợ, mục tiêu cho tuần tới.`],
] as const;
const TEAM = "__team__";

/** Everyone side by side for a period; a click opens the person, the AI reads the table for load and rebalancing. */
function TeamView({ names, onPick }: { names: string[]; onPick: (n: string) => void }) {
  const y = useYt();
  const now = useNow();
  const [days, setDays] = useState(14);
  const [sort, setSort] = useState(1);
  const q = useQuery({ queryKey: ["yt", "issues", y.project, "*"], queryFn: ({ signal }) => yt.issues(y.project, null, signal), staleTime: 60_000 });
  const COLSET = ["Đang mở", "Đang làm", "Chờ QC", "Blocked", "Quá hạn", "Không cập nhật >7 ngày", `Xong ${days} ngày`, "Bug mở", "Lead time (ngày)"] as const;
  const table = useMemo(() => {
    const from = now - days * DAY, rows = q.data ?? [];
    return names.map((n) => {
      const mine = rows.filter((i) => i.assignee === n), open = mine.filter((i) => !i.resolved), done = mine.filter((i) => i.resolved && i.resolved >= from);
      const lead = done.map((i) => (i.resolved! - i.created) / DAY).sort((a, b) => a - b);
      const v = [open.length, open.filter((i) => bucket(i) === 1).length, open.filter((i) => bucket(i) === 2).length, open.filter(isBlocked).length,
        open.filter((i) => i.due && i.due < now).length, open.filter((i) => now - i.updated > 7 * DAY).length, done.length, open.filter((i) => i.type === "Bug").length,
        lead.length ? +lead[Math.floor(lead.length / 2)].toFixed(1) : null];
      return { n, v, risky: open.filter((i) => isBlocked(i) || (i.due && i.due < now)).map((i) => i.id).slice(0, 8), doing: open.filter((i) => bucket(i) === 1).map((i) => i.id).slice(0, 8) };
    }).filter((r) => r.v.some((x) => x));
  }, [q.data, names, days, now]);
  const sorted = table.toSorted((a, b) => (b.v[sort] ?? -1) - (a.v[sort] ?? -1));
  const max = COLSET.map((_, k) => Math.max(1, ...table.map((r) => r.v[k] ?? 0)));
  const run = () => y.setSheet({ kind: "work", title: "AI · tải team & chia việc", ids: [], auto: { label: "AI đang phân tích tải team", run: (sig) => yt.aiData("team", {
    periodDays: days, wipLimit: y.wip, columns: COLSET, people: table.map((r) => ({ name: r.n, ...Object.fromEntries(COLSET.map((c, k) => [c, r.v[k]])), blockedOrOverdue: r.risky, doing: r.doing })),
  }, sig) } });
  const bad = new Set([3, 4, 5]);
  return (
    <div className="grid content-start gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-semibold">So sánh cả team</h2>
        <span className="text-xs text-ink-3">{q.isError ? <span className="text-error">Lỗi tải ticket: {(q.error as Error).message}</span> : q.isFetching ? "Đang tải ticket cả team…" : `${table.length} người có ticket`}</span>
        <select value={days} onChange={(e) => setDays(+e.target.value)} aria-label="Kỳ" className="h-[30px] rounded-md border border-rule bg-cotton px-2 text-sm">{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} ngày</option>)}</select>
        {y.aiOn && <Button size="sm" onClick={run} disabled={!table.length}><Sparkles /> AI phân tích tải & chia việc</Button>}
      </div>
      <div className="overflow-x-auto rounded-lg bg-cotton shadow-stock">
        <table className="w-full text-sm">
          <thead className="bg-paper-2 text-left text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 font-medium">Người</th>
              {COLSET.map((c, k) => (
                <th key={c} aria-sort={sort === k ? "descending" : undefined} className="px-2 py-2 text-right font-medium">
                  <button type="button" onClick={() => setSort(k)} className={cn("inline-flex items-center gap-0.5 hover:text-ink", sort === k && "text-ink")}>{c}{sort === k && <ArrowDown className="size-3" />}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.n} tabIndex={0} onClick={() => onPick(r.n)} onKeyDown={(e) => { if (e.key === "Enter") onPick(r.n); }} className="cursor-pointer border-t border-rule hover:bg-paper-2">
                <td className="px-3 py-1.5"><span className="flex items-center gap-2 whitespace-nowrap"><Avatar name={r.n} />{shortName(r.n)}</span></td>
                {r.v.map((x, k) => {
                  const heat = x == null || k === 8 ? 0 : x / max[k];
                  return (
                    <td key={k} className="px-2 py-1.5 text-right font-mono tabular-nums">
                      <span className={cn("inline-block min-w-8 rounded px-1.5", bad.has(k) && x ? "font-semibold text-error" : !x && "text-ink-3")}
                        style={heat ? { background: `color-mix(in oklch, ${bad.has(k) ? "var(--color-error)" : "var(--color-hl)"} ${Math.round(heat * 22)}%, transparent)` } : undefined}>{x ?? "—"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {y.wip > 0 && <p className="text-xs text-ink-3">Ngưỡng WIP đang đặt: {y.wip} ticket đang làm / người. Bấm một dòng để xem chi tiết người đó.</p>}
    </div>
  );
}

const SCOPES = [["open", "Đang mở"], ["done", "Đã xong trong kỳ"], ["both", "Cả hai"]] as const;
type Scope = (typeof SCOPES)[number][0];

export function PeoplePage() {
  const y = useYt();
  const names = y.peopleOptions.filter((n) => n !== UNASSIGNED);
  const [who, setWho] = useState(() => getPref("ytPerson") || y.me || "");
  const [q, setQ] = useState("");
  const person = who === TEAM || names.includes(who) ? who : y.me && names.includes(y.me) ? y.me : names[0] ?? "";
  const pick = (n: string) => { setWho(n); setPref("ytPerson", n); };
  // tickets already loaded (the current filter) give each name a count; the chosen person is fetched on their own
  const openBy = useMemo(() => { const c: Record<string, number> = {}; for (const i of y.rows) if (!i.resolved && i.assignee) c[i.assignee] = (c[i.assignee] || 0) + 1; return c; }, [y.rows]);

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Card title="Thành viên" meta={`${names.length} người`} className="content-start lg:sticky lg:top-28 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm người…" aria-label="Tìm người" className="h-8 w-full rounded-md border border-rule bg-paper pr-2 pl-7 text-sm outline-none focus:border-hl" />
        </label>
        <button type="button" aria-current={person === TEAM} onClick={() => pick(TEAM)}
          className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium", person === TEAM ? "bg-hl-wash text-hl-2" : "hover:bg-paper-2")}>
          <Users className="size-5 text-ink-3" />So sánh cả team
        </button>
        <ul className="grid gap-0.5">
          {names.filter((n) => !q || norm(n).includes(norm(q))).map((n) => (
            <li key={n}>
              <button type="button" aria-current={n === person} onClick={() => pick(n)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", n === person ? "bg-hl-wash font-medium text-hl-2" : "hover:bg-paper-2")}>
                <Avatar name={n} /><span className="flex-1 truncate">{n}{n === y.me && <span className="text-ink-3"> (tôi)</span>}</span>
                {openBy[n] ? <b className="font-mono text-xs font-normal text-ink-3">{openBy[n]}</b> : null}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {person === TEAM ? <TeamView names={names} onPick={pick} /> : person ? <PersonView key={person} name={person} /> : <p className="text-sm text-ink-3">Chưa có danh sách thành viên.</p>}
    </div>
  );
}

function PersonView({ name }: { name: string }) {
  const y = useYt();
  const now = useNow();
  const [days, setDays] = useState(30);
  const key = name === y.me ? "me" : y.loginOf.get(name);
  const q = useQuery({ queryKey: ["yt", "issues", y.project, key ?? ""], queryFn: ({ signal }) => yt.issues(y.project, [key!], signal), enabled: !!key, staleTime: 60_000 });
  const mine = useMemo(() => (q.data ?? []).filter((i) => i.assignee === name), [q.data, name]);

  const s = useMemo(() => {
    const from = now - days * DAY;
    const open = mine.filter((i) => !i.resolved), done = mine.filter((i) => i.resolved && i.resolved >= from);
    const lead = done.map((i) => (i.resolved! - i.created) / DAY).sort((a, b) => a - b);
    return {
      open, done,
      figures: [
        ["Đang mở", open.length], ["Đang làm", open.filter((i) => bucket(i) === 1).length], ["Chờ QC", open.filter((i) => bucket(i) === 2).length],
        ["Blocked", open.filter(isBlocked).length], ["Quá hạn", open.filter((i) => i.due && i.due < now).length],
        ["Không cập nhật > 7 ngày", open.filter((i) => now - i.updated > 7 * DAY).length], ["Chuyển sprint ≥ 2 lần", open.filter((i) => i.sprints.length >= 2).length],
        [`Xong trong ${days} ngày`, done.length], ["Bug đã sửa", done.filter((i) => i.type === "Bug").length], ["Bug đang mở", open.filter((i) => i.type === "Bug").length],
        ["Lead time trung vị", lead.length ? `${lead[Math.floor(lead.length / 2)].toFixed(1)} ngày` : "—"],
      ] as [string, number | string][],
    };
  }, [mine, days, now]);

  const [scope, setScope] = useState<Scope>("both");
  const [prompt, setPrompt] = useState(() => PRESETS[0][1](name, 30));
  const ids = (scope === "open" ? s.open : scope === "done" ? s.done : [...s.open, ...s.done]).toSorted((a, b) => b.updated - a.updated).map((i) => i.id);
  function run(text = prompt) {
    const ask = text.trim();
    if (!ask || !ids.length) return;
    const stats = { person: name, periodDays: days, ...Object.fromEntries(s.figures) };
    const pick = ids.slice(0, AI_MAX);
    y.setSheet({ kind: "work", title: `AI · ${shortName(name)}`, ids: pick, auto: { label: `AI đang đọc ${pick.length} ticket của ${shortName(name)}`, q: ask,
      run: (sig) => yt.aiTickets(pick, `${name}, ${SCOPES.find(([k]) => k === scope)![1].toLowerCase()} (${days} ngày)`, "ask", sig, ask, stats) } });
  }

  return (
    <div className="grid content-start gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={name} className="size-10 text-sm" />
        <div className="mr-auto grid"><h2 className="text-lg font-semibold">{name}</h2><span className="text-xs text-ink-3">{q.isFetching ? "Đang tải ticket…" : `${mine.length} ticket trong ${y.config?.hist ?? ""} ngày lịch sử`}</span></div>
        <label className="flex items-center gap-1.5 text-xs text-ink-3">Kỳ
          <select value={days} onChange={(e) => { setDays(+e.target.value); }} className="h-[30px] rounded-md border border-rule bg-cotton px-2 text-sm">{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} ngày</option>)}</select>
        </label>
      </div>
      {!key && <p className="text-sm text-warn">Chưa tìm thấy login YouTrack của {name}.</p>}
      {q.isError && <p role="alert" className="text-sm text-error">Không tải được ticket: {(q.error as Error).message}</p>}

      <div className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] bg-cotton shadow-stock sm:grid-cols-4 xl:grid-cols-6">
        {s.figures.map(([l, v]) => (
          <div key={l} className="px-3 py-2.5 shadow-[inset_-1px_-1px_0_var(--color-rule)]">
            <div className="text-xs leading-tight text-ink-3">{l}</div>
            <b className={cn("font-mono text-2xl font-medium tabular-nums", (l === "Blocked" || l === "Quá hạn") && Number(v) > 0 && "text-error")}>{v}</b>
          </div>
        ))}
      </div>

      {y.aiOn && (
        <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-hl-2" />AI phân tích {shortName(name)}</span>} className="border border-hl/25">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([label, make]) => <Button key={label} size="sm" variant="outline" disabled={!ids.length} title="Chạy ngay; sửa câu lệnh ở ô bên dưới rồi bấm Phân tích để hỏi theo ý bạn"
              onClick={() => { const p = make(name, days); setPrompt(p); run(p); }}>{label}</Button>)}
          </div>
          <Textarea rows={2} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Yêu cầu cho AI"
            placeholder="Nhập yêu cầu: tóm tắt, review, đánh giá… AI chỉ dựa trên ticket và số liệu của người này." />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-3">Ticket gửi cho AI</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="h-[30px] rounded-md border border-rule bg-cotton px-2 text-sm">
              {SCOPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span className="text-xs text-ink-3">{Math.min(ids.length, AI_MAX)} ticket{ids.length > AI_MAX ? ` (mới nhất trong ${ids.length})` : ""}, kèm số liệu ở trên</span>
            <Button size="sm" className="ml-auto" disabled={!prompt.trim() || !ids.length} onClick={() => run()}><Sparkles /> Phân tích</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Đang mở" meta={`${s.open.length} ticket`}><Rows rows={s.open} /></Card>
        <Card title={`Đã xong trong ${days} ngày`} meta={`${s.done.length} ticket`}><Rows rows={s.done} /></Card>
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: Ticket[] }) {
  const y = useYt();
  if (!rows.length) return <p className="text-sm text-ink-3">Không có ticket.</p>;
  const sorted = rows.toSorted((a, b) => b.updated - a.updated);
  return (
    <ul className="divide-y divide-rule">
      {sorted.slice(0, 60).map((i) => (
        <li key={i.id}>
          <button type="button" onClick={() => y.openTicket(i.id, sorted)} className="grid w-full gap-0.5 py-1.5 text-left hover:bg-paper-2">
            <span className="flex flex-wrap items-center gap-x-2.5"><b className="font-mono text-xs">{i.id}</b><StatePill state={i.state} /><Prio p={i.priority} /><span className="ml-auto text-xs text-ink-3">{when(i.resolved ?? i.updated)}</span></span>
            <span className="truncate text-sm">{i.summary}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

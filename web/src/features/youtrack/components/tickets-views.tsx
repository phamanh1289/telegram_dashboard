"use client";

import { Bookmark, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/shared/components/ui/button";
import { toast } from "@/shared/lib/notifications";
import { type Key, t as tNow, useT } from "@/shared/lib/i18n";
import { readJson, setPref } from "@/shared/lib/prefs";
import { type Filters, yt } from "@/features/youtrack/lib/yt";
import { runningSprints } from "@/features/youtrack/lib/yt-stats";
import { Popover } from "./bits";
import { saveOneShot } from "./history";
import { useYt, type Yt } from "./state";


/** A sentence becomes the regular filters (state / priority / type / người / sprint / search): the ✨ in the search box and ⌘K. */
let filterBusy = false;
const busyListeners = new Set<() => void>();
const setFilterBusy = (b: boolean) => { filterBusy = b; busyListeners.forEach((f) => f()); };
export function useAiFilterBusy() {
  return useSyncExternalStore((f) => { busyListeners.add(f); return () => busyListeners.delete(f); }, () => filterBusy, () => false);
}
export async function aiFilterApply(y: Yt, text: string) {
  const ask = text.trim();
  if (!ask || filterBusy) return;
  const uniq = (k: "state" | "priority" | "type") => [...new Set(y.rows.map((i) => i[k]).filter((v): v is string => !!v))];
  const options = { state: uniq("state"), priority: uniq("priority"), type: uniq("type"), assignee: y.peopleOptions, sprint: y.sprintOptions.slice(0, 40),
    me: y.me, current_sprint: runningSprints(y)[0] ?? null };
  setFilterBusy(true);
  const { done, session } = saveOneShot(tNow("AI · Lọc: {q}", { q: ask.slice(0, 60) }), ask, tNow("AI lọc ticket"));
  try {
    const r = await yt.aiFilter(ask, options, session);
    const pick = (k: keyof typeof options) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((v): v is string => typeof v === "string" && (options[k] as string[]).includes(v)) : []);
    const f = { state: pick("state"), priority: pick("priority"), type: pick("type"), assignee: pick("assignee"), sprint: pick("sprint"), q: typeof r.q === "string" ? r.q.slice(0, 100) : "" };
    y.setFilters({ ...f, tier: null, quick: null });
    const rows = ([["State", f.state], ["Priority", f.priority], ["Type", f.type], ["Assignee", f.assignee], ["Sprint", f.sprint], [tNow("Tìm"), f.q ? [f.q] : []]] as const)
      .filter(([, v]) => v.length).map(([k, v]) => `- **${k}:** ${v.join(", ")}`);
    done(rows.length ? `${tNow("Bộ lọc AI đã đặt:")}\n${rows.join("\n")}` : tNow("AI không đặt được bộ lọc nào từ câu này."));
    toast({ text: tNow("AI đã đặt bộ lọc, xem các chip bên dưới") });
  } catch (e) { toast({ text: tNow("AI lọc lỗi: {msg}", { msg: (e as Error).message }) }); }
  finally { setFilterBusy(false); }
}

/** A named set of filters + table / board, per browser; also listed in ⌘K. */
export type SavedView = { name: string; f: Omit<Filters, "assignee"> & { assignee: string[] }; view: "table" | "board" };
export const readViews = (): SavedView[] => { const v = readJson("ytViews", []); return Array.isArray(v) ? v : []; };
export function applyView(y: Yt, v: SavedView) {
  y.setFilters(v.f);
  y.setView(v.view);
  y.setPage("tickets");
  toast({ text: `View “${v.name}”` });
}

/** Built-in views per role: one click sets the whole filter + table / board + grouping for a job the role does every day. */
export type RoleView = [label: Key, hint: Key, f: Partial<Filters>, view?: "table" | "board"];
/** A built-in view replaces the whole filter (unset parts back to the defaults), then opens the ticket page. */
export function applyRoleView(y: Yt, [label, , f, view = "table"]: RoleView) {
  y.setFilters({ sprint: [], assignee: [], state: [], priority: [], type: [], q: "", tier: null, quick: null, group: "sprint", sort: { k: "priority", d: "asc" }, ...f });
  y.setView(view);
  y.setPage("tickets");
  toast({ text: tNow("Góc nhìn “{name}”", { name: tNow(label) }) });
}
export function roleViews(y: Yt): RoleView[] {
  const me = y.me ? [y.me] : [];
  const sprint = runningSprints(y);
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
export function Views() {
  const t = useT();
  const y = useYt();
  const [list, setList] = useState(readViews);
  const [name, setName] = useState("");
  const save = (l: SavedView[]) => { setList(l); setPref("ytViews", JSON.stringify(l)); };
  function add() {
    const n = name.trim();
    if (!n) return;
    save([...list.filter((v) => v.name !== n), { name: n, f: y.filters, view: y.view }]);
    setName("");
    toast({ text: t("Đã lưu view “{name}”", { name: n }) });
  }
  const head = "px-2 pt-1.5 pb-0.5 text-xs font-medium text-ink-3";
  return (
    <Popover label={<span className="inline-flex items-center gap-1"><Bookmark className="size-3.5" />{t("Góc nhìn")}{list.length ? <b className="font-mono font-medium text-ink-3">{list.length}</b> : null}</span>} align="right">
      {(close) => (
        <div className="grid gap-0.5 p-1">
          <span className={head}>{t("Gợi ý cho {role}", { role: ({ dev: "Dev", qa: "QA/QC", po: "PO/PM" } as const)[y.mode] })}</span>
          {roleViews(y).map((v) => (
            <button key={v[0]} type="button" onClick={() => { close(); applyRoleView(y, v); }} disabled={y.mode === "dev" && !y.me}
              className="grid gap-0.5 rounded px-2 py-1.5 text-left hover:bg-paper-2 disabled:pointer-events-none disabled:opacity-50">
              <span className="text-sm">{t(v[0])}</span><span className="text-xs text-ink-3">{t(v[1])}</span>
            </button>
          ))}
          <div className="mx-2 my-1 border-t border-rule" />
          <span className={head}>{t("Đã lưu")}</span>
          {list.map((v) => (
            <div key={v.name} className="flex items-center gap-1 rounded hover:bg-paper-2">
              <button type="button" onClick={() => { close(); applyView(y, v); }} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm">{v.name}</button>
              <button type="button" aria-label={t("Xóa view {name}", { name: v.name })} onClick={() => save(list.filter((x) => x !== v))} className="rounded p-1 text-ink-3 hover:text-error"><X className="size-3.5" /></button>
            </div>
          ))}
          {!list.length && <p className="px-2 py-1 text-xs text-ink-3">{t("Chưa có. Đặt bộ lọc, chọn Bảng / Board, rồi lưu lại ở đây.")}</p>}
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-1 pt-1">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t("Tên view, vd. Bug sprint này")} aria-label={t("Tên view")}
              className="h-8 min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 text-sm focus:border-hl" />
            <Button type="submit" size="sm" disabled={!name.trim()}>{t("Lưu")}</Button>
          </form>
        </div>
      )}
    </Popover>
  );
}

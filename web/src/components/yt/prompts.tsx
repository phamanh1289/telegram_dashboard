"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Pencil, Pin, Play, Plus, RotateCcw, Search, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/inbox";
import type { YtRole } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { type PromptCtx, type PromptLib, type SavedPrompt, yt } from "@/lib/yt";

/** Built-in AI jobs (the session runs them by `kind`); `for`: one ticket, several, or either. The team may delete them, not edit them. */
export const BUILTINS = [
  { kind: "brief", name: "Tóm tắt thread", for: "one", hint: "Hiện trạng, đang chờ ai, bước tiếp theo, rủi ro: đọc cả mô tả và bình luận" },
  { kind: "ready", name: "Kiểm tra đủ AC", for: "one", hint: "Checklist thiếu / đủ (AC, bước tái hiện, môi trường…) kèm bình luận hỏi reporter" },
  { kind: "split", name: "Chia task & estimate", for: "one", hint: "Các việc ≤ 1 ngày, ước lượng giờ, phụ thuộc" },
  { kind: "rewrite", name: "Chuẩn hoá mô tả", for: "one", hint: "Viết lại theo mẫu bug report / feature chuẩn, phần thiếu ghi [cần bổ sung]" },
  { kind: "testcases", name: "Test case", for: "any", hint: "Luồng chính, biên, lỗi, vùng regression (nhiều ticket: tối đa 10 ticket đầu)" },
  { kind: "reply", name: "Soạn trả lời", for: "one", hint: "Nháp trả lời bình luận mới nhất" },
  { kind: "summary", name: "Tóm tắt & việc cần làm", for: "many", hint: "Tóm tắt từng ticket và danh sách việc cần làm tiếp" },
  { kind: "review", name: "Rà soát cho lead", for: "many", hint: "Rủi ro, phụ thuộc, ticket thiếu thông tin, đề xuất thứ tự" },
  { kind: "notes", name: "Release notes", for: "many", hint: "Ghi chú phát hành cho người dùng và cho team" },
] as const;
export type Builtin = (typeof BUILTINS)[number];
type BuiltinName = Builtin["name"];
export const SHOWN_MAX = 5;
/** The 4 buttons each role starts with, for one ticket and for several; the team changes them in the prompt library. */
export const DEFAULT_SHOWN: Record<PromptCtx, BuiltinName[]> = {
  "dev:one": ["Tóm tắt thread", "Kiểm tra đủ AC", "Chia task & estimate", "Soạn trả lời"], // understand, check it is buildable, plan, answer
  "dev:many": ["Tóm tắt & việc cần làm", "Rà soát cho lead", "Test case", "Release notes"],
  "qa:one": ["Test case", "Kiểm tra đủ AC", "Chuẩn hoá mô tả", "Tóm tắt thread"], // test it, is it testable, a clean bug report
  "qa:many": ["Test case", "Tóm tắt & việc cần làm", "Rà soát cho lead", "Release notes"],
  "po:one": ["Tóm tắt thread", "Kiểm tra đủ AC", "Chuẩn hoá mô tả", "Chia task & estimate"], // groom: status, AC, spec, size
  "po:many": ["Tóm tắt & việc cần làm", "Rà soát cho lead", "Release notes", "Test case"],
};
/** The buttons for this context: the team's pick, else the role's default; deleted built-ins never show. */
export const shownFor = (lib: PromptLib, ctx: PromptCtx): string[] => (lib.shown[ctx] ?? DEFAULT_SHOWN[ctx]).filter((n) => !lib.hidden.includes(n));
/** A built-in fits one ticket or several. */
export const fitsCount = (b: Builtin, many: boolean) => b.for === "any" || (b.for === "many") === many;
export const builtin = (name: string) => BUILTINS.find((b) => b.name === name);
const ROLES: [YtRole, string][] = [["dev", "Dev"], ["qa", "QC"], ["po", "PO"]];
const KEY = ["yt", "prompts"];

/** The prompt library (shared, data/) and its save. */
export function usePrompts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => yt.prompts(), staleTime: 60_000 });
  const m = useMutation({
    mutationFn: yt.setPrompts,
    onSuccess: (next) => qc.setQueryData(KEY, next),
    onError: (e) => toast({ text: `Không lưu được prompt: ${(e as Error).message}` }),
  });
  const lib: PromptLib = { prompts: [], shown: {}, hidden: [], ...q.data };
  return { q, lib, save: m.mutate, saving: m.isPending };
}

/** A small segmented control. */
function Seg<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex rounded-md bg-paper-2 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn("rounded px-2.5 py-1 text-xs font-medium transition-colors duration-(--dur-micro)", value === v ? "bg-cotton text-ink shadow-stock" : "text-ink-3 hover:text-ink")}>
          {l}
        </button>
      ))}
    </span>
  );
}

type Item = { name: string; sub: string; mine?: number }; // mine: index in lib.prompts (a team prompt)

/**
 * The prompt library: built-ins and the team's prompts in one list, pinned ones (the session's buttons, ≤ 5 per role and ticket count) first.
 * With `onPick` a click runs the prompt (the session popup); without it a click opens a team prompt to edit (Settings).
 */
export function PromptManager({ onPick, role: role0, many: many0 = false }: { onPick?: (name: string) => void; role: YtRole; many?: boolean }) {
  const { q, lib, save: put, saving } = usePrompts();
  const list = lib.prompts;
  const [role, setRole] = useState(role0);
  const [many, setMany] = useState(many0);
  const [find, setFind] = useState("");
  const [edit, setEdit] = useState<number | "new" | null>(null); // the team prompt open in the form
  const [draft, setDraft] = useState<SavedPrompt>({ name: "", text: "" });
  const [confirm, setConfirm] = useState<string | null>(null); // the row whose delete waits for a second click
  const ctx: PromptCtx = `${role}:${many ? "many" : "one"}`;
  const custom = !!lib.shown[ctx];
  const shown = shownFor(lib, ctx);
  const update = (next: Partial<PromptLib>) => put({ ...lib, ...next });
  const everywhere = (f: (names: string[]) => string[]) => Object.fromEntries(Object.entries(lib.shown).map(([k, v]) => [k, f(v)])); // every context's buttons

  const items: Item[] = [
    ...list.map((p, k) => ({ name: p.name, sub: p.text, mine: k })),
    ...BUILTINS.filter((b) => fitsCount(b, many) && !lib.hidden.includes(b.name)).map((b) => ({ name: b.name, sub: b.hint })),
  ];
  const f = find.trim().toLowerCase();
  const hit = (i: Item) => !f || i.name.toLowerCase().includes(f) || i.sub.toLowerCase().includes(f);
  const pinned = shown.map((n) => items.find((i) => i.name === n)).filter((i): i is Item => !!i && hit(i));
  const rest = items.filter((i) => !shown.includes(i.name) && hit(i));
  const deleted = BUILTINS.filter((b) => lib.hidden.includes(b.name));

  const open = (k: number | "new") => { setEdit(k); setConfirm(null); setDraft(k === "new" ? { name: "", text: "" } : list[k]); };
  const name = draft.name.trim();
  const taken = !!builtin(name) || list.some((p, k) => k !== edit && p.name === name);
  const ok = name && draft.text.trim() && !taken;
  function save() {
    if (!ok) return;
    const p = { name, text: draft.text.trim() };
    if (edit === "new") update({ prompts: [...list, p] });
    else {
      const was = list[edit as number].name; // a renamed prompt keeps its buttons
      update({ prompts: list.map((x, k) => (k === edit ? p : x)), shown: everywhere((v) => v.map((s) => (s === was ? name : s))) });
    }
    setEdit(null);
  }
  function remove(i: Item) {
    const shownNext = everywhere((v) => v.filter((s) => s !== i.name));
    if (i.mine !== undefined) update({ prompts: list.filter((_, j) => j !== i.mine), shown: shownNext });
    else update({ hidden: [...lib.hidden, i.name], shown: shownNext });
    setConfirm(null);
    if (edit === i.mine) setEdit(null);
  }
  function pin(n: string) {
    const set = (v: string[]) => update({ shown: { ...lib.shown, [ctx]: v } }); // the first change starts from the role's default
    if (shown.includes(n)) set(shown.filter((s) => s !== n));
    else if (shown.length < SHOWN_MAX) set([...shown, n]);
  }
  function reset() {
    const { [ctx]: _, ...rest } = lib.shown; // eslint-disable-line @typescript-eslint/no-unused-vars
    update({ shown: rest });
  }

  const form = (
    <form className="grid gap-2 rounded-lg bg-cotton p-3 shadow-stock animate-in fade-in-0 duration-(--dur-short)" onSubmit={(e) => { e.preventDefault(); save(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }}>
      <p className="text-xs font-semibold text-ink-2">{edit === "new" ? "Prompt mới" : "Sửa prompt"}</p>
      <Input aria-label="Tên prompt" placeholder="Tên ngắn, hiện trên nút. Ví dụ: Rủi ro release" value={draft.name} maxLength={40} autoFocus
        aria-invalid={taken || undefined} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      {taken && <p className="-mt-1 text-xs text-error">Đã có prompt tên này.</p>}
      <Textarea aria-label="Nội dung prompt" rows={5} maxLength={2000} placeholder="AI nhận các ticket đã chọn kèm nội dung này. Ví dụ: Liệt kê rủi ro khi release các ticket này, xếp theo mức độ."
        value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className="max-h-72 resize-y"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }} />
      <div className="flex items-center gap-2">
        <span className="font-mono text-[0.6875rem] text-ink-3 tabular-nums">{draft.text.length}/2000</span>
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setEdit(null)}>Huỷ</Button>
        <Button type="submit" size="sm" disabled={!ok || saving}>Lưu</Button>
      </div>
    </form>
  );

  const hover = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100"; // row actions show on hover / focus
  const row = (i: Item) => {
    if (i.mine !== undefined && edit === i.mine) return <li key={i.name}>{form}</li>;
    const on = shown.includes(i.name);
    const full = !on && shown.length >= SHOWN_MAX;
    const sure = confirm === i.name;
    const main = onPick ? () => onPick(i.name) : i.mine !== undefined ? () => open(i.mine!) : undefined;
    return (
      <li key={i.name} className="group relative flex items-center gap-1 rounded-lg pr-1 transition-colors duration-(--dur-micro) hover:bg-paper-2 focus-within:bg-paper-2">
        <button type="button" disabled={!main} onClick={main} title={i.sub}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none">
          <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", i.mine !== undefined ? "bg-hl-wash text-hl-2" : "bg-paper-2 text-ink-3 group-hover:bg-cotton")}>
            {i.mine !== undefined ? <MessageSquareText className="size-3.5" /> : <Sparkles className="size-3.5" />}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <span className="truncate">{i.name}</span>
              {i.mine === undefined && <span className="shrink-0 rounded px-1 text-[0.625rem] leading-4 font-medium tracking-wide text-ink-3 uppercase ring-1 ring-rule">Có sẵn</span>}
            </span>
            <span className="line-clamp-1 text-xs text-ink-3">{i.sub}</span>
          </span>
        </button>
        {sure ? (
          <span className="flex shrink-0 items-center gap-1 animate-in fade-in-0 duration-(--dur-micro)">
            <Button size="xs" variant="destructive" disabled={saving} onClick={() => remove(i)} autoFocus onBlur={() => setConfirm(null)}>Xóa</Button>
            <Button size="xs" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => setConfirm(null)}>Huỷ</Button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center">
            {onPick && <Button size="icon-xs" variant="ghost" className={hover} aria-label={`Chạy “${i.name}”`} title="Chạy ngay" onClick={() => onPick(i.name)}><Play /></Button>}
            {i.mine !== undefined && <Button size="icon-xs" variant="ghost" className={hover} aria-label={`Sửa “${i.name}”`} title="Sửa" onClick={() => open(i.mine!)}><Pencil /></Button>}
            <Button size="icon-xs" variant="ghost" disabled={saving} className={cn(hover, "hover:bg-error-wash hover:text-error")} aria-label={`Xóa “${i.name}”`} title="Xóa" onClick={() => setConfirm(i.name)}><Trash2 /></Button>
            <Button size="icon-xs" variant="ghost" disabled={saving || full} aria-pressed={on} className={cn(on ? "text-hl-2" : hover)}
              aria-label={`${on ? "Bỏ ghim" : "Ghim"} “${i.name}”`} title={full ? `Đã ghim đủ ${SHOWN_MAX}` : on ? "Bỏ ghim khỏi phiên AI" : "Ghim thành nút ở phiên AI"} onClick={() => pin(i.name)}>
              <Pin className={cn(on && "fill-current")} />
            </Button>
          </span>
        )}
      </li>
    );
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input aria-label="Tìm prompt" placeholder="Tìm prompt…" value={find} onChange={(e) => setFind(e.target.value)} className="h-8 pl-8 text-sm"
            autoFocus={!!onPick} onKeyDown={(e) => { const first = pinned[0] ?? rest[0]; if (e.key === "Enter" && onPick && first) { e.preventDefault(); onPick(first.name); } }} />
        </label>
        <Button type="button" size="sm" disabled={edit === "new"} onClick={() => open("new")}><Plus /> Prompt mới</Button>
      </div>
      {edit === "new" && form}

      <div className="flex flex-wrap items-center gap-2 border-y border-rule py-2">
        <span className="text-xs text-ink-3">Nút ở phiên AI cho</span>
        <Seg label="Vai trò" value={role} onChange={setRole} options={ROLES} />
        <Seg label="Số ticket" value={many ? "many" : "one"} onChange={(v) => setMany(v === "many")} options={[["one", "1 ticket"], ["many", "Nhiều ticket"]]} />
      </div>

      {q.isError && <p className="text-sm text-error">Không tải được prompt: {(q.error as Error).message}</p>}

      <section className="grid gap-1" aria-label="Đã ghim">
        <header className="flex items-center gap-2 px-2 text-xs text-ink-3">
          <Pin className="size-3" /><b className="font-semibold text-ink-2">Đã ghim</b>
          <span className="font-mono tabular-nums">{shown.length}/{SHOWN_MAX}</span>
          <span>· {custom ? "team chọn" : "mặc định"}</span>
          {custom && <button type="button" disabled={saving} onClick={reset} className="ml-auto inline-flex items-center gap-1 hover:text-ink"><RotateCcw className="size-3" />Về mặc định</button>}
        </header>
        {pinned.length ? <ul className="grid">{pinned.map(row)}</ul>
          : <p className="px-2 py-3 text-xs text-ink-3">{f ? "Không có prompt ghim nào khớp." : "Chưa ghim prompt nào: phiên AI sẽ không có nút gợi ý. Bấm ghim ở một prompt bên dưới."}</p>}
      </section>

      <section className="grid gap-1" aria-label="Prompt khác">
        <header className="px-2 text-xs font-semibold text-ink-2">Khác</header>
        {rest.length ? <ul className="grid">{rest.map(row)}</ul>
          : <p className="px-2 py-3 text-xs text-ink-3">{f ? `Không có prompt khớp “${find.trim()}”.` : "Mọi prompt đều đã ghim."}</p>}
      </section>

      {deleted.length > 0 && (
        <button type="button" disabled={saving} onClick={() => update({ hidden: [] })} className="inline-flex items-center gap-1.5 justify-self-start px-2 text-xs text-ink-3 hover:text-ink">
          <RotateCcw className="size-3" />Khôi phục {deleted.length} prompt có sẵn đã xóa
        </button>
      )}
    </div>
  );
}

/** The prompt library as a popup; picking one hands its name back and closes. */
export function PromptsDialog({ open, onOpenChange, onPick, role, many }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (name: string) => void; role: YtRole; many: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88dvh,42rem)] flex-col sm:max-w-xl">
        <DialogTitle>Kho prompt</DialogTitle>
        <DialogDescription className="-mt-2">Bấm một prompt để chạy với các ticket đang chọn. Ghim để hiện thành nút. Dùng chung cho cả team.</DialogDescription>
        <div className="-mx-5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-1">
          {open && <PromptManager role={role} many={many} onPick={(n) => { onPick(n); onOpenChange(false); }} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

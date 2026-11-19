"use client";

import { ChevronRight, Eye, FolderPlus, Plus, Trash2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DIALOG_SHEET } from "@/shared/components/ui/dialog";
import { Fold } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { errorText } from "@/shared/lib/api";
import { fmtNum, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";
import { ytProjectsQuery } from "@/features/youtrack/lib/yt";
import { docErrors, docs, type DocSources, docSourcesQuery, syncErrorText } from "@/features/docs/lib/docs";
import { GrowButton } from "./grow-button";
import { KbTree } from "./kb-tree";

// "Thêm" (the sources): what is read into the library — Knowledge Base projects whole or only some branches (an article and those
// under it), folders on this machine — the AI Agent's cache (articles outside them: hidden elsewhere, "Xem" filters
// to them, "Xóa" drops them) and each source's last sync error. Every change saves at once (hidden / shown at once);
// the sync runs once, when the page closes after a change (`onSaved`). A detail page sliding in from the right
// (DIALOG_SHEET), its content mounted only while open (base-ui), so it slides out too; `open` is the screen's, so its
// empty list can open it.

export function Sources({ open, onOpenChange, onSaved, onView }: {
  open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void; onView: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const src = useQuery(docSourcesQuery).data;
  const n = src?.errors.length ?? 0;
  const [changed, setChanged] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const close = () => {
    onOpenChange(false);
    if (changed) onSaved();
    setChanged(false);
  };
  const drop = useMutation({
    mutationFn: docs.dropCache,
    onSuccess: (s) => {
      qc.setQueryData(docSourcesQuery.queryKey, s);
      void qc.invalidateQueries({ queryKey: ["docs"] });
      setConfirm(false);
    },
    onError: () => {}, // shown in the dialog (`error`), which stays open to retry
  });
  return (
    <>
      <Hint side="bottom" text={t("Thêm project / nhánh Knowledge Base và thư mục vào kho; xem lỗi đồng bộ.")}>
        <GrowButton aria-label={n > 0 ? t("Thêm nguồn ({n} lỗi đồng bộ)", { n }) : t("Thêm nguồn")} onClick={() => onOpenChange(true)}
          icon={<Plus />} label={t("Thêm")}
          extra={n > 0 && <span className="ml-1 rounded-full bg-error px-1.5 font-mono text-2xs text-cotton">{n}</span>} />
      </Hint>
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className={cn(DIALOG_SHEET, "sm:max-w-xl")}>
          <DialogHeader className="shrink-0 border-b bg-paper-2 px-5 py-4">
            <DialogTitle>{t("Nguồn tài liệu")}</DialogTitle>
            <DialogDescription>{t("Thay đổi lưu ngay; đóng trang này để đồng bộ theo nguồn mới.")}</DialogDescription>
          </DialogHeader>
          <Panel onChanged={() => setChanged(true)}
            onView={() => { close(); onView(); }} onDrop={() => { close(); setConfirm(true); }} />
        </DialogContent>
      </Dialog>
      {confirm && (
        <ConfirmDialog open onOpenChange={(o) => { if (!o) { setConfirm(false); drop.reset(); } }} icon={Trash2}
          title={t("Xóa bài KB ngoài nguồn?")} confirmLabel={t("Xóa")} busy={drop.isPending}
          error={drop.error ? errorText(drop.error, docErrors()) : undefined} onConfirm={() => drop.mutate()}
          description={t("Xóa {n} bài Knowledge Base AI Agent đã mở (project không có trong \"Nguồn\") cùng bản tóm tắt của chúng. Project đã chọn giữ nguyên; Agent cần lại bài nào sẽ tải lại.", { n: fmtNum(src?.cached ?? 0) })} />
      )}
    </>
  );
}

const H3 = "text-xs font-medium text-ink-3";

function Panel({ onChanged, onView, onDrop }: { onChanged: () => void; onView: () => void; onDrop: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const src = useQuery(docSourcesQuery);
  const projects = useQuery(ytProjectsQuery);
  const [expanded, setExpanded] = useState<string | null>(null);
  const saved = (s: DocSources | undefined) => {
    if (!s) return; // the folder picker was cancelled
    qc.setQueryData(docSourcesQuery.queryKey, s);
    void qc.invalidateQueries({ queryKey: ["docs"], predicate: (q) => q.queryKey[1] !== "sources" && q.queryKey[1] !== "kb-tree" });
    onChanged();
  };
  const onError = (e: unknown) => toast({ text: errorText(e, docErrors()) });
  const save = useMutation({ mutationFn: docs.setSources, onSuccess: saved, onError });
  const pick = useMutation({ mutationFn: docs.pickFolder, onSuccess: saved, onError });
  const busy = save.isPending || pick.isPending;

  if (src.isError) return <p role="alert" className="px-5 py-4 text-sm text-error">{errorText(src.error, docErrors())}</p>;
  if (!src.data) return <p className="px-5 py-4 text-sm text-ink-3">{t("Đang tải…")}</p>;
  const { projects: on, articles, folders, errors, cached } = src.data;
  const base = { projects: on, articles, folders };
  const branchOf = (p: string) => articles.filter((a) => a.startsWith(`${p}-A-`));
  const all = [...new Set([...(projects.data ?? []).map((p) => p.shortName), ...on, ...articles.map((a) => a.split("-A-")[0])])];
  const tick = (p: string, v: boolean) => save.mutate({ ...base, projects: v ? [...on, p] : on.filter((x) => x !== p) });

  return (
    <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-4 text-sm">
      <section className="grid grid-cols-1 gap-1">
        <h3 className={H3}>{t("Knowledge Base (YouTrack)")}</h3>
        <p className="text-xs text-ink-3">{t("Tick project để đọc cả project, hoặc mở ra để chỉ chọn vài nhánh bài.")}</p>
        {projects.isError && <p role="alert" className="text-xs text-error">{t("Không tải được danh sách project: {msg}", { msg: (projects.error as Error).message })}</p>}
        <ul className="grid grid-cols-1 divide-y divide-rule rounded-md border">
          {all.map((p) => {
            const whole = on.includes(p), picked = branchOf(p).length, isOpen = expanded === p && !whole;
            return (
              <li key={p} className="grid grid-cols-1 px-2.5 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-ink">
                    <Checkbox checked={whole} indeterminate={!whole && picked > 0} disabled={busy} onCheckedChange={(v) => tick(p, !!v)} />
                    <span className="font-mono text-xs">{p}</span>
                    <span className="truncate text-xs text-ink-3">{projects.data?.find((x) => x.shortName === p)?.name}</span>
                  </label>
                  {whole ? <span className="text-2xs text-ink-3">{t("cả project")}</span>
                    : picked > 0 && <span className="text-2xs text-hl-2">{t("{n} nhánh", { n: picked })}</span>}
                  {!whole && (
                    <Button size="xs" variant="ghost" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : p)}>
                      {t("Chọn nhánh")}<ChevronRight className={cn("transition-transform duration-(--dur-short) ease-(--ease-out)", isOpen && "rotate-90")} />
                    </Button>
                  )}
                </div>
                <Fold open={isOpen}>
                  <div className="pt-1.5 pb-1">
                    <KbTree project={p} chosen={articles} disabled={busy} onChange={(ids) => save.mutate({ ...base, articles: ids })} />
                  </div>
                </Fold>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="grid grid-cols-1 gap-1.5">
        <h3 className={H3}>{t("Thư mục trên máy")}</h3>
        {folders.length === 0 && <p className="text-xs text-ink-3">{t("Chưa có thư mục nào.")}</p>}
        {folders.map((f) => (
          <div key={f} className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f}</span>
            <Hint side="bottom" text={t("Bỏ thư mục khỏi kho (file trên máy vẫn giữ nguyên).")}>
              <Button size="icon-xs" variant="ghost" aria-label={t("Bỏ thư mục {f}", { f })} disabled={busy}
                onClick={() => save.mutate({ ...base, folders: folders.filter((x) => x !== f) })}><X /></Button>
            </Hint>
          </div>
        ))}
        <Button size="sm" variant="outline" className="justify-self-start" aria-busy={pick.isPending} disabled={busy} onClick={() => pick.mutate()}>
          <FolderPlus />{t("Thêm thư mục")}
        </Button>
      </section>
      {cached > 0 && (
        <section className="grid grid-cols-1 gap-1.5">
          <h3 className={H3}>{t("Bài KB ngoài nguồn")}</h3>
          <p className="text-xs text-ink-3">{t("{n} bài AI Agent đã mở hoặc thuộc nguồn đã bỏ: ẩn khỏi danh sách và tìm, Agent vẫn đọc lại được.", { n: fmtNum(cached) })}</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={onView}><Eye />{t("Xem")}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onDrop}><Trash2 />{t("Xóa")}</Button>
          </div>
        </section>
      )}
      {errors.length > 0 && (
        <section className="grid grid-cols-1 gap-1">
          <h3 className="text-xs font-medium text-error">{t("Lỗi đồng bộ")}</h3>
          <ul className="grid gap-0.5 text-xs text-ink-2">{errors.map((e, i) => <li key={i} className="break-all">{syncErrorText(e)}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

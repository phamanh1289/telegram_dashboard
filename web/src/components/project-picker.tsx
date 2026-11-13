"use client";

import { Menu } from "@base-ui/react/menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, FolderGit2, FolderPlus, Loader2, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { CHIP } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Project } from "@/lib/api";
import { t as tPlain, useT } from "@/lib/i18n";
import { toast } from "@/lib/inbox";
import { cn } from "@/lib/utils";

/** Projects registered for the AI agent; one cache for every picker. */
export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: ({ signal }) => api<Project[]>("/projects", { signal }) });

const POPUP = "grid w-80 max-w-(--available-width) min-w-(--anchor-width) max-h-(--available-height) origin-(--transform-origin) content-start gap-0.5 overflow-y-auto rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";
const ITEM = "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink outline-none select-none transition-colors duration-(--dur-micro) data-highlighted:bg-paper-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-3";

/**
 * The one project-folder picker (AI reads code there): a field opening a menu of the registered folders,
 * then "Thêm thư mục…" (Finder; a typed path when that can't open) and "Gỡ khỏi danh sách". The caller stores the choice.
 * `none`: the folder is optional, an item with that label picks "" (no code read).
 */
/** `chip`: the pill look of a prompt box's tool row. */
export function ProjectPicker({ value, onChange, className, none, chip }: { value: string; onChange: (path: string) => void; className?: string; none?: string; chip?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const projects = useProjects();
  const items = projects.data ?? [];
  const current = items.find((p) => p.path === value); // a stored choice that no longer exists reads as none
  const [typing, setTyping] = useState<string | null>(null); // the typed-path dialog, with why Finder didn't open
  const refresh = () => qc.invalidateQueries({ queryKey: ["projects"] });
  // Opens the native folder dialog on this machine (backend runs locally); 204 = cancelled.
  const pick = useMutation({
    mutationFn: () => api<Project | undefined>("/projects/pick", { method: "POST" }),
    onSuccess: (p) => p && onChange(p.path),
    onError: (e) => setTyping(errorText(e, { not_found: tPlain("Backend cũ: khởi động lại dashboard, hoặc nhập đường dẫn.") }, tPlain("Không mở được hộp chọn thư mục, hãy nhập đường dẫn."))),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (p: string) => api<void>(`/projects?path=${encodeURIComponent(p)}`, { method: "DELETE" }),
    onSuccess: () => onChange(""),
    onError: (e) => toast({ text: errorText(e, {}, tPlain("Không gỡ được dự án, thử lại")) }),
    onSettled: refresh,
  });
  const label = pick.isPending ? t("Đang chọn thư mục…") : current?.name
    ?? (projects.isPending ? t("Đang tải dự án…") : projects.isError ? t("Không tải được dự án") : none ?? t("Chọn dự án"));

  return (
    <>
      <Menu.Root>
        <Menu.Trigger aria-label={t("Dự án tham chiếu cho AI")} aria-busy={pick.isPending} disabled={pick.isPending}
          className={cn("group relative inline-flex h-8 min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-input)] border border-rule-2 bg-cotton pr-2 pl-1 text-sm text-ink transition-[background-color,border-color] duration-(--dur-micro) hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus) data-popup-open:border-hl disabled:opacity-70", chip && [CHIP, "gap-1.5 pl-0.5 [&>span:first-child]:size-5 [&>span:first-child]:rounded-full"], className)}>
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-(--dur-short)", current ? "bg-hl-wash text-hl-2" : "bg-paper-2 text-ink-3")}>
            {pick.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FolderGit2 className="size-3.5" aria-hidden />}
          </span>
          <AnimatePresence initial={false} mode="popLayout">
            {label && <motion.span key={label} className={cn("min-w-0 truncate", current ? "font-medium" : projects.isError ? "text-error" : "text-ink-3")}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
              {label}
            </motion.span>}
          </AnimatePresence>
          {/* none="": just the folder icon (the hint around it says what it does) */}
          {label && <ChevronDown aria-hidden className="ml-auto size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) group-data-popup-open:rotate-180" />}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="start" className="z-50 outline-none">
            <Menu.Popup className={POPUP}>
              <p className="px-2.5 pt-1 pb-0.5 text-xs text-ink-3">{t("AI chỉ đọc code trong thư mục này")}</p>
              {projects.isPending ? (
                <div className="grid gap-1 p-1"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
              ) : projects.isError ? (
                <Menu.Item closeOnClick={false} className={cn(ITEM, "text-error")} onClick={() => void projects.refetch()}>
                  <RotateCcw /> {t("Không tải được danh sách · Thử lại")}
                </Menu.Item>
              ) : !items.length && !none ? (
                <p className="mx-1 rounded-md border border-dashed border-rule-2 px-2.5 py-2 text-xs text-ink-2">{t("Chưa có dự án nào. Thêm thư mục code trên máy để AI đọc.")}</p>
              ) : (
                <Menu.RadioGroup value={current?.path ?? ""} onValueChange={(v) => onChange(String(v))}>
                  {none && (
                    <Menu.RadioItem value="" closeOnClick className={cn(ITEM, "group/item")}>
                      <X className="group-data-checked/item:text-hl-2" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium">{none}</span>
                      <Menu.RadioItemIndicator keepMounted className="shrink-0 transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-unchecked:scale-50 data-unchecked:opacity-0">
                        <Check className="size-4 text-hl" aria-hidden />
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  )}
                  {items.map((p) => (
                    <Menu.RadioItem key={p.path} value={p.path} closeOnClick className={cn(ITEM, "group/item")}>
                      <FolderGit2 className="group-data-checked/item:text-hl-2" aria-hidden />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate font-medium">{p.name}</span>
                        <span className="truncate text-xs text-ink-3" dir="rtl"><bdi dir="ltr">{p.path}</bdi></span>{/* rtl: cut from the left, keep the folder */}
                      </span>
                      <Menu.RadioItemIndicator keepMounted className="shrink-0 transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-unchecked:scale-50 data-unchecked:opacity-0">
                        <Check className="size-4 text-hl" aria-hidden />
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              )}
              <Menu.Separator className="mx-1 my-0.5 h-px bg-rule" />
              <Menu.Item className={ITEM} onClick={() => pick.mutate()}><FolderPlus aria-hidden /> {t("Thêm thư mục…")}</Menu.Item>
              {current && (
                <Menu.Item className={cn(ITEM, "text-ink-2 data-highlighted:bg-error-wash data-highlighted:text-error data-highlighted:[&>svg]:text-error")}
                  disabled={remove.isPending} onClick={() => remove.mutate(current.path)}>
                  <X aria-hidden /><span className="min-w-0 truncate">{t("Gỡ khỏi danh sách")} <span className="text-xs opacity-70">{t("(không xóa thư mục)")}</span></span>
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {typing !== null && <PathDialog why={typing} onAdded={onChange} onClose={() => setTyping(null)} />}
    </>
  );
}

/** Fallback when the folder dialog can't open: paste the path. */
function PathDialog({ why, onAdded, onClose }: { why: string; onAdded: (path: string) => void; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [path, setPath] = useState("");
  const add = useMutation({
    mutationFn: (p: string) => api<Project>("/projects", { method: "POST", json: { path: p } }),
    onSuccess: (p) => { onAdded(p.path); onClose(); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (path.trim()) add.mutate(path.trim()); }}>
          <DialogTitle>{t("Thêm dự án")}</DialogTitle>
          <DialogDescription>
            {why} {t("Dán đường dẫn thư mục dự án trên máy (ví dụ ~/Documents/my-app); mẹo: kéo thư mục từ Finder vào Terminal để lấy đường dẫn. AI chỉ được đọc file trong đó.")}
          </DialogDescription>
          <Input autoFocus aria-label={t("Đường dẫn dự án")} placeholder="/Users/…/my-app" value={path} onChange={(e) => setPath(e.target.value)} maxLength={1000} />
          {add.isError && (
            <p role="alert" className="text-sm text-error">
              {errorText(add.error, { project_not_a_directory: t("Không tìm thấy thư mục này.") }, t("Không thêm được dự án."))}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{t("Hủy")}</DialogClose>
            <Button type="submit" aria-busy={add.isPending} disabled={!path.trim() || add.isPending}>{t("Thêm")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

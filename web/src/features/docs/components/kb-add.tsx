"use client";

import { FilePlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { buttonVariants } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/dialog";
import { errorText } from "@/shared/lib/api";
import { t as tr, useT } from "@/shared/lib/i18n";
import { yt } from "@/features/youtrack/lib/yt";
import { docErrors, docs, docSourcesQuery, syncErrorText } from "@/features/docs/lib/docs";

// A Knowledge Base article named in a document but not in the library (doc-links.tsx): asks whether to add it. Yes: it
// joins the sources as a branch (with the articles under it, as "Chọn nhánh" does), one sync, then it opens here. No:
// the article on YouTrack. `ref_` null closes it; the last one stays while it fades out.

class NotFound extends Error {}

export function KbAdd({ ref_, onClose, onOpen }: { ref_: string | null; onClose: () => void; onOpen: (id: number) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [shown, setShown] = useState(ref_);
  if (ref_ && ref_ !== shown) setShown(ref_);
  const base = useQuery({ queryKey: ["yt", "config"], queryFn: yt.config, staleTime: Infinity, enabled: !!ref_ }).data?.base;
  const add = useMutation({
    mutationFn: async (ref: string) => {
      const src = await docs.sources();
      if (!src.articles.includes(ref)) await docs.setSources({ projects: src.projects, folders: src.folders, articles: [...src.articles, ref] });
      const synced = await docs.sync(true);
      qc.setQueryData(docSourcesQuery.queryKey, synced);
      const d = (await docs.list(null)).find((x) => x.source === "youtrack" && x.ref === ref);
      if (!d) throw new NotFound([tr("YouTrack không trả bài {ref} (đã xóa, hoặc bạn không có quyền đọc).", { ref }),
        ...synced.errors.slice(0, 1).map(syncErrorText)].join(" "));
      return d.id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["docs"] });
      close();
      onOpen(id);
    },
    onError: () => {}, // shown in the dialog (`error`), which stays open
  });
  const close = () => { add.reset(); onClose(); };
  const url = base && shown ? `${base.replace(/\/$/, "")}/articles/${shown}` : "";
  return (
    <ConfirmDialog open={!!ref_} onOpenChange={(o) => { if (!o) close(); }} tone="default" icon={FilePlus}
      title={t("Chưa có {ref} trong Tài liệu", { ref: shown ?? "" })}
      description={t("Thêm bài này (cùng các bài con) vào kho để đọc, tìm và hỏi AI ngay tại đây? App đồng bộ một lần rồi mở bài.")}
      confirmLabel={t("Thêm và mở")} busy={add.isPending} onConfirm={() => shown && add.mutate(shown)}
      error={add.error ? (add.error instanceof NotFound ? add.error.message : errorText(add.error, docErrors())) : undefined}
      footerStart={url && (
        <a href={url} target="_blank" rel="noopener noreferrer" onClick={close} className={buttonVariants({ variant: "ghost", className: "no-underline" })}>
          {t("Không, mở trên YouTrack")}
        </a>
      )} />
  );
}
